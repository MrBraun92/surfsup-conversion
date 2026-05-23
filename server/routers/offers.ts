import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { getCooldownState } from "../lib/clientCooldown.js";

const DEFAULT_MIN_SCORE = 50;

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

        // Defensivo: cria offer NoOffer com score 0 se ausente — improvável (rescoreActiveRentals popula).
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

        database
          .update(schema.conversionOffers)
          .set({ status: "Draft", updatedAt: new Date() })
          .where(eq(schema.conversionOffers.id, offer.id))
          .run();

        const updated = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, offer.id))
          .all()[0]!;
        return updated;
      }),
  });
}

export const offersRouter = createOffersRouter(defaultDb);
