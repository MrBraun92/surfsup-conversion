import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { sendMessage } from "../lib/telegram.js";

function readSetting(database: DB, key: string): string | null {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .all()[0];
  return row?.value ?? null;
}

const TAB_STATUSES: Record<"ativas" | "expiradas", string[]> = {
  ativas: ["Sent", "Accepted"],
  expiradas: ["Expired", "Rejected", "Paid"],
};

export function createConversationsRouter(database: DB) {
  return router({
    listOffers: publicProcedure
      .input(
        z
          .object({ tab: z.enum(["ativas", "expiradas"]).optional() })
          .optional(),
      )
      .query(async ({ input }) => {
        const tab = input?.tab ?? "ativas";
        const statuses = TAB_STATUSES[tab];
        const offers = database
          .select()
          .from(schema.conversionOffers)
          .where(inArray(schema.conversionOffers.status, statuses))
          .orderBy(desc(schema.conversionOffers.updatedAt))
          .all();
        if (offers.length === 0) return [];
        const clientIds = [...new Set(offers.map((o) => o.clientId))];
        const boardIds = [...new Set(offers.map((o) => o.boardId))];
        const rentalIds = [...new Set(offers.map((o) => o.rentalId))];
        const offerIds = offers.map((o) => o.id);
        const clients = database
          .select()
          .from(schema.clients)
          .where(inArray(schema.clients.id, clientIds))
          .all();
        const boards = database
          .select()
          .from(schema.boards)
          .where(inArray(schema.boards.id, boardIds))
          .all();
        const rentals = database
          .select()
          .from(schema.rentals)
          .where(inArray(schema.rentals.id, rentalIds))
          .all();
        const msgs = database
          .select()
          .from(schema.messages)
          .where(inArray(schema.messages.offerId, offerIds))
          .orderBy(asc(schema.messages.createdAt))
          .all();
        const clientMap = new Map(clients.map((c) => [c.id, c]));
        const boardMap = new Map(boards.map((b) => [b.id, b]));
        const rentalMap = new Map(rentals.map((r) => [r.id, r]));
        const msgsByOffer = new Map<number, typeof msgs>();
        for (const m of msgs) {
          const list = msgsByOffer.get(m.offerId) ?? [];
          list.push(m);
          msgsByOffer.set(m.offerId, list);
        }
        return offers
          .map((offer) => {
            const client = clientMap.get(offer.clientId);
            const board = boardMap.get(offer.boardId);
            const rental = rentalMap.get(offer.rentalId);
            if (!client || !board || !rental) return null;
            return {
              offer,
              client,
              board,
              rental,
              messages: msgsByOffer.get(offer.id) ?? [],
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      }),

    sendOperatorMessage: publicProcedure
      .input(
        z.object({
          offerId: z.number().int().positive(),
          content: z.string().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        const offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, input.offerId))
          .all()[0];
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Oferta não encontrada." });
        }
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, offer.clientId))
          .all()[0];
        if (!client) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        }
        if (!client.telegramChatId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Cliente sem telegram_chat_id — não é possível enviar.",
          });
        }
        const token = readSetting(database, "telegram_bot_token") ?? "";
        if (!token && process.env.TELEGRAM_DRY_RUN !== "1") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "telegram_bot_token não configurado.",
          });
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const nowDate = new Date();
        const inserted = database
          .insert(schema.messages)
          .values({
            offerId: offer.id,
            content: input.content,
            approved: 1,
            approvedAt: nowSec,
            operatorTookOver: 1,
          })
          .returning()
          .all()[0]!;
        const result = await sendMessage({
          chatId: client.telegramChatId,
          text: input.content,
          token,
        });
        database
          .update(schema.messages)
          .set({
            sentAt: Math.floor(Date.now() / 1000),
            telegramMessageId: result.messageId,
            updatedAt: nowDate,
          })
          .where(eq(schema.messages.id, inserted.id))
          .run();
        const updated = database
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, inserted.id))
          .all()[0]!;
        return { message: updated };
      }),
  });
}

export const conversationsRouter = createConversationsRouter(defaultDb);
