import { desc, eq, inArray, or } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";

export interface EffectiveSaleRow {
  sale: typeof schema.sales.$inferSelect;
  client: typeof schema.clients.$inferSelect;
  board: typeof schema.boards.$inferSelect;
  rental: typeof schema.rentals.$inferSelect;
  offer: typeof schema.conversionOffers.$inferSelect;
}

export type RejectionReason = "rejected" | "no_response" | "accepted_unpaid";

export interface RejectedOfferRow {
  offer: typeof schema.conversionOffers.$inferSelect;
  client: typeof schema.clients.$inferSelect;
  board: typeof schema.boards.$inferSelect;
  rental: typeof schema.rentals.$inferSelect;
  reason: RejectionReason;
}

function startOfMonthUnix(now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function classifyReason(
  offerStatus: string,
  lastResponseType: string | null,
  cooldownReason: string | null,
): RejectionReason {
  if (lastResponseType === "Interested") return "accepted_unpaid";
  if (cooldownReason === "accepted_unpaid") return "accepted_unpaid";
  if (offerStatus === "Rejected" || lastResponseType === "NotInterested" || cooldownReason === "rejected") {
    return "rejected";
  }
  // Expired sem resposta positiva nem cooldown de accepted_unpaid
  return "no_response";
}

export function createSalesRouter(database: DB) {
  return router({
    listEffective: publicProcedure.query(async (): Promise<EffectiveSaleRow[]> => {
      const sales = database
        .select()
        .from(schema.sales)
        .where(eq(schema.sales.paymentStatus, "paid"))
        .orderBy(desc(schema.sales.paidAt))
        .all();
      if (sales.length === 0) return [];

      const clientIds = [...new Set(sales.map((s) => s.clientId))];
      const boardIds = [...new Set(sales.map((s) => s.boardId))];
      const rentalIds = [...new Set(sales.map((s) => s.rentalId))];
      const offerIds = [...new Set(sales.map((s) => s.offerId))];

      const clients = database.select().from(schema.clients).where(inArray(schema.clients.id, clientIds)).all();
      const boards = database.select().from(schema.boards).where(inArray(schema.boards.id, boardIds)).all();
      const rentals = database.select().from(schema.rentals).where(inArray(schema.rentals.id, rentalIds)).all();
      const offers = database
        .select()
        .from(schema.conversionOffers)
        .where(inArray(schema.conversionOffers.id, offerIds))
        .all();

      const clientMap = new Map(clients.map((c) => [c.id, c]));
      const boardMap = new Map(boards.map((b) => [b.id, b]));
      const rentalMap = new Map(rentals.map((r) => [r.id, r]));
      const offerMap = new Map(offers.map((o) => [o.id, o]));

      return sales
        .map((sale) => {
          const client = clientMap.get(sale.clientId);
          const board = boardMap.get(sale.boardId);
          const rental = rentalMap.get(sale.rentalId);
          const offer = offerMap.get(sale.offerId);
          if (!client || !board || !rental || !offer) return null;
          return { sale, client, board, rental, offer };
        })
        .filter((x): x is EffectiveSaleRow => x !== null);
    }),

    listRejected: publicProcedure.query(async (): Promise<RejectedOfferRow[]> => {
      const offers = database
        .select()
        .from(schema.conversionOffers)
        .where(
          or(
            eq(schema.conversionOffers.status, "Rejected"),
            eq(schema.conversionOffers.status, "Expired"),
          ),
        )
        .orderBy(desc(schema.conversionOffers.updatedAt))
        .all();
      if (offers.length === 0) return [];

      const clientIds = [...new Set(offers.map((o) => o.clientId))];
      const boardIds = [...new Set(offers.map((o) => o.boardId))];
      const rentalIds = [...new Set(offers.map((o) => o.rentalId))];
      const offerIds = offers.map((o) => o.id);

      const clients = database.select().from(schema.clients).where(inArray(schema.clients.id, clientIds)).all();
      const boards = database.select().from(schema.boards).where(inArray(schema.boards.id, boardIds)).all();
      const rentals = database.select().from(schema.rentals).where(inArray(schema.rentals.id, rentalIds)).all();
      const allMessages = database
        .select()
        .from(schema.messages)
        .where(inArray(schema.messages.offerId, offerIds))
        .orderBy(desc(schema.messages.createdAt))
        .all();

      const clientMap = new Map(clients.map((c) => [c.id, c]));
      const boardMap = new Map(boards.map((b) => [b.id, b]));
      const rentalMap = new Map(rentals.map((r) => [r.id, r]));
      const lastMsgByOffer = new Map<number, (typeof allMessages)[number]>();
      for (const m of allMessages) {
        if (!lastMsgByOffer.has(m.offerId)) lastMsgByOffer.set(m.offerId, m);
      }

      return offers
        .map((offer) => {
          const client = clientMap.get(offer.clientId);
          const board = boardMap.get(offer.boardId);
          const rental = rentalMap.get(offer.rentalId);
          if (!client || !board || !rental) return null;
          const lastMsg = lastMsgByOffer.get(offer.id);
          const reason = classifyReason(
            offer.status,
            lastMsg?.responseType ?? null,
            client.cooldownReason ?? null,
          );
          return { offer, client, board, rental, reason };
        })
        .filter((x): x is RejectedOfferRow => x !== null);
    }),

    kpisEffective: publicProcedure.query(async () => {
      const paid = database
        .select({
          price: schema.sales.salePrice,
          paidAt: schema.sales.paidAt,
        })
        .from(schema.sales)
        .where(eq(schema.sales.paymentStatus, "paid"))
        .all();

      const rejectedCount = database
        .select({ id: schema.conversionOffers.id })
        .from(schema.conversionOffers)
        .where(
          or(
            eq(schema.conversionOffers.status, "Rejected"),
            eq(schema.conversionOffers.status, "Expired"),
          ),
        )
        .all().length;

      const totalRevenue = paid.reduce((acc, s) => acc + (s.price ?? 0), 0);
      const paidCount = paid.length;
      const ticketAverage = paidCount > 0 ? totalRevenue / paidCount : 0;
      const denom = paidCount + rejectedCount;
      const conversionRate = denom > 0 ? Number(((paidCount / denom) * 100).toFixed(1)) : 0;

      const startMonth = startOfMonthUnix();
      const thisMonth = paid.filter((s) => s.paidAt != null && s.paidAt >= startMonth);
      const salesThisMonth = thisMonth.length;
      const salesThisMonthRevenue = thisMonth.reduce((acc, s) => acc + (s.price ?? 0), 0);

      return {
        totalRevenue,
        ticketAverage,
        conversionRate,
        salesThisMonth,
        salesThisMonthRevenue,
      };
    }),

    kpisRejected: publicProcedure.query(async () => {
      const offers = database
        .select()
        .from(schema.conversionOffers)
        .where(
          or(
            eq(schema.conversionOffers.status, "Rejected"),
            eq(schema.conversionOffers.status, "Expired"),
          ),
        )
        .all();
      if (offers.length === 0) {
        return {
          totalRejected: 0,
          totalCooldownGenerated: 0,
          byReason: { rejected: 0, no_response: 0, accepted_unpaid: 0 },
        };
      }

      const clientIds = [...new Set(offers.map((o) => o.clientId))];
      const offerIds = offers.map((o) => o.id);

      const clients = database
        .select()
        .from(schema.clients)
        .where(inArray(schema.clients.id, clientIds))
        .all();
      const clientMap = new Map(clients.map((c) => [c.id, c]));

      const allMessages = database
        .select()
        .from(schema.messages)
        .where(inArray(schema.messages.offerId, offerIds))
        .orderBy(desc(schema.messages.createdAt))
        .all();
      const lastMsgByOffer = new Map<number, (typeof allMessages)[number]>();
      for (const m of allMessages) {
        if (!lastMsgByOffer.has(m.offerId)) lastMsgByOffer.set(m.offerId, m);
      }

      const byReason = { rejected: 0, no_response: 0, accepted_unpaid: 0 };
      const cooldownClientIds = new Set<number>();
      const now = Math.floor(Date.now() / 1000);

      for (const offer of offers) {
        const client = clientMap.get(offer.clientId);
        const lastMsg = lastMsgByOffer.get(offer.id);
        const reason = classifyReason(
          offer.status,
          lastMsg?.responseType ?? null,
          client?.cooldownReason ?? null,
        );
        byReason[reason]++;
        if (client?.cooldownUntil && client.cooldownUntil > now) {
          cooldownClientIds.add(client.id);
        }
      }

      return {
        totalRejected: offers.length,
        totalCooldownGenerated: cooldownClientIds.size,
        byReason,
      };
    }),
  });
}

export const salesRouter = createSalesRouter(defaultDb);
