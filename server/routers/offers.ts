import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, or } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { getCooldownState } from "../lib/clientCooldown.js";
import { draftOfferMessage } from "../lib/llm.js";

const DEFAULT_MIN_SCORE = 50;
const DEFAULT_OFFER_WINDOW_DAYS = 2;

function readMinScore(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "min_score_to_generate"))
    .all()[0];
  if (!row) return DEFAULT_MIN_SCORE;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_SCORE;
}

function readOfferWindowDays(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "offer_window_days"))
    .all()[0];
  if (!row) return DEFAULT_OFFER_WINDOW_DAYS;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_OFFER_WINDOW_DAYS;
}

function formatDateBR(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Calcula scheduledFor default: rental.endDate - offer_window_days dias, às 09:00 BRT (= 12:00 UTC).
 */
function computeDefaultScheduledFor(endDate: number, windowDays: number): number {
  const d = new Date(endDate * 1000);
  d.setUTCDate(d.getUTCDate() - windowDays);
  // 09:00 BRT == 12:00 UTC (BRT = UTC-3, sem DST atualmente).
  d.setUTCHours(12, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function createOffersRouter(database: DB) {
  return router({
    getByRentalId: publicProcedure
      .input(z.object({ rentalId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.rentalId, input.rentalId))
          .all()[0];
        if (!offer) return null;
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, offer.clientId))
          .all()[0];
        const board = database
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, offer.boardId))
          .all()[0];
        const lastMessage = database
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.offerId, offer.id))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1)
          .all()[0];
        return { offer, client: client ?? null, board: board ?? null, lastMessage: lastMessage ?? null };
      }),

    getMinScoreSetting: publicProcedure.query(async () => {
      return { minScore: readMinScore(database) };
    }),

    getPaymentDefault: publicProcedure
      .input(z.object({ rentalId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const rental = database
          .select()
          .from(schema.rentals)
          .where(eq(schema.rentals.id, input.rentalId))
          .all()[0];
        if (!rental) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Aluguel não encontrado." });
        }
        const windowDays = readOfferWindowDays(database);
        const defaultScheduledFor = computeDefaultScheduledFor(rental.endDate, windowDays);
        return { defaultScheduledFor };
      }),

    listPendingApproval: publicProcedure.query(async () => {
      const offers = database
        .select()
        .from(schema.conversionOffers)
        .where(
          or(
            eq(schema.conversionOffers.status, "PendingApproval"),
            eq(schema.conversionOffers.status, "Draft"),
          ),
        )
        .orderBy(desc(schema.conversionOffers.updatedAt))
        .all();

      if (offers.length === 0) return [];

      const clientIds = Array.from(new Set(offers.map((o) => o.clientId)));
      const boardIds = Array.from(new Set(offers.map((o) => o.boardId)));
      const rentalIds = Array.from(new Set(offers.map((o) => o.rentalId)));
      const offerIds = offers.map((o) => o.id);

      const clientsRows = database
        .select()
        .from(schema.clients)
        .where(inArray(schema.clients.id, clientIds))
        .all();
      const boardsRows = database
        .select()
        .from(schema.boards)
        .where(inArray(schema.boards.id, boardIds))
        .all();
      const rentalsRows = database
        .select()
        .from(schema.rentals)
        .where(inArray(schema.rentals.id, rentalIds))
        .all();
      const messagesRows = database
        .select()
        .from(schema.messages)
        .where(inArray(schema.messages.offerId, offerIds))
        .orderBy(desc(schema.messages.createdAt))
        .all();

      const clientById = new Map(clientsRows.map((c) => [c.id, c]));
      const boardById = new Map(boardsRows.map((b) => [b.id, b]));
      const rentalById = new Map(rentalsRows.map((r) => [r.id, r]));
      const lastMsgByOffer = new Map<number, typeof messagesRows[number]>();
      for (const m of messagesRows) {
        if (!lastMsgByOffer.has(m.offerId)) lastMsgByOffer.set(m.offerId, m);
      }

      return offers
        .map((offer) => {
          const client = clientById.get(offer.clientId);
          const board = boardById.get(offer.boardId);
          const rental = rentalById.get(offer.rentalId);
          const lastMessage = lastMsgByOffer.get(offer.id) ?? null;
          if (!client || !board || !rental) return null;
          return { offer, client, board, rental, lastMessage };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }),

    generateMessage: publicProcedure
      .input(z.object({ rentalId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const rental = database
          .select()
          .from(schema.rentals)
          .where(eq(schema.rentals.id, input.rentalId))
          .all()[0];
        if (!rental) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Aluguel não encontrado." });
        }
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, rental.clientId))
          .all()[0];
        if (!client) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        }
        const board = database
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, rental.boardId))
          .all()[0];
        if (!board) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Prancha não encontrada." });
        }

        const cooldown = getCooldownState({
          cooldownUntil: client.cooldownUntil,
          cooldownReason: client.cooldownReason,
          cooldownTriggerAt: client.cooldownTriggerAt,
        });
        if (cooldown.inCooldown) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cliente em cooldown (${cooldown.daysRemaining}d restantes) — oferta bloqueada.`,
          });
        }

        let offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.rentalId, input.rentalId))
          .all()[0];

        if (!offer) {
          database
            .insert(schema.conversionOffers)
            .values({
              rentalId: rental.id,
              clientId: rental.clientId,
              boardId: rental.boardId,
              score: 0,
              scoringReason: "Offer criada sob demanda — sem score prévio.",
              status: "NoOffer",
            })
            .run();
          offer = database
            .select()
            .from(schema.conversionOffers)
            .where(eq(schema.conversionOffers.rentalId, input.rentalId))
            .all()[0]!;
        }

        if (offer.status !== "NoOffer") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Offer já está no estado "${offer.status}" — não pode regenerar a partir daqui.`,
          });
        }

        const minScore = readMinScore(database);
        if (offer.score < minScore) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Score ${offer.score} abaixo do mínimo (${minScore}) — não vamos incomodar o cliente.`,
          });
        }

        // Stats deste cliente x esta prancha (para o prompt)
        const cbs = database
          .select()
          .from(schema.clientBoardStats)
          .where(eq(schema.clientBoardStats.clientId, client.id))
          .all()
          .find((s) => s.boardId === board.id);
        const days = cbs?.daysCount ?? 0;
        const rentalsCount = cbs?.rentalsCount ?? 0;

        const content = await draftOfferMessage({
          clientName: client.name,
          boardModel: board.model,
          boardSize: board.size,
          days,
          rentals: rentalsCount,
          endDateBR: formatDateBR(rental.endDate),
          precoSite: board.precoSite,
          precoAmigo: board.precoAmigo,
        });

        database
          .update(schema.conversionOffers)
          .set({ status: "PendingApproval", updatedAt: new Date() })
          .where(eq(schema.conversionOffers.id, offer.id))
          .run();

        database
          .insert(schema.messages)
          .values({
            offerId: offer.id,
            content,
            approved: 0,
          })
          .run();

        const updatedOffer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, offer.id))
          .all()[0]!;
        const message = database
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.offerId, offer.id))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1)
          .all()[0]!;

        return { offer: updatedOffer, message };
      }),

    approveAndSchedule: publicProcedure
      .input(
        z.object({
          messageId: z.number().int().positive(),
          content: z.string().min(1),
          scheduledFor: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        const message = database
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, input.messageId))
          .all()[0];
        if (!message) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
        }
        const offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, message.offerId))
          .all()[0];
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Oferta não encontrada." });
        }
        if (offer.status !== "PendingApproval" && offer.status !== "Draft") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Oferta no estado "${offer.status}" — não pode ser aprovada.`,
          });
        }
        const now = new Date();
        database
          .update(schema.messages)
          .set({
            content: input.content,
            approved: 1,
            approvedAt: Math.floor(now.getTime() / 1000),
            updatedAt: now,
          })
          .where(eq(schema.messages.id, input.messageId))
          .run();
        database
          .update(schema.conversionOffers)
          .set({
            status: "Scheduled",
            scheduledFor: input.scheduledFor,
            updatedAt: now,
          })
          .where(eq(schema.conversionOffers.id, offer.id))
          .run();
        const updatedOffer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, offer.id))
          .all()[0]!;
        const updatedMessage = database
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, input.messageId))
          .all()[0]!;
        return { offer: updatedOffer, message: updatedMessage };
      }),

    rejectDraft: publicProcedure
      .input(z.object({ offerId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, input.offerId))
          .all()[0];
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Oferta não encontrada." });
        }
        database
          .update(schema.conversionOffers)
          .set({ status: "NoOffer", updatedAt: new Date() })
          .where(eq(schema.conversionOffers.id, input.offerId))
          .run();
        const updated = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, input.offerId))
          .all()[0]!;
        return { offer: updated };
      }),
  });
}

export const offersRouter = createOffersRouter(defaultDb);
