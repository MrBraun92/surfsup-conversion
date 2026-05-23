import { z } from "zod";
import { and, eq, gte, isNull, desc, inArray, sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { getCooldownState, type CooldownState } from "../lib/clientCooldown.js";

function startOfMonthUnix(now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export interface DashboardKPIs {
  activeRentals: number;
  inOfferWindow: number;
  offerWindowDays: number;
  convertedThisMonth: number;
  revenueThisMonth: number;
}

export interface UpcomingConversionRow {
  rentalId: number;
  clientId: number;
  boardId: number;
  clientName: string;
  boardLabel: string;
  endDate: number;
  daysRemaining: number;
  score: number;
  offerStatus: string;
  cooldown: CooldownState;
  stats: { rentalsOfThisBoard: number; daysOfThisBoard: number };
}

function getOfferWindowDays(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "offer_window_days"))
    .all()[0];
  const v = Number.parseInt(row?.value ?? "2", 10);
  return Number.isFinite(v) ? v : 2;
}

function getMinScore(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "min_score_to_generate"))
    .all()[0];
  const v = Number.parseFloat(row?.value ?? "50");
  return Number.isFinite(v) ? v : 50;
}

export function createDashboardRouter(database: DB) {
  return router({
    getKPIs: publicProcedure.query(async (): Promise<DashboardKPIs> => {
      const now = Math.floor(Date.now() / 1000);
      const offerWindowDays = getOfferWindowDays(database);
      const horizon = now + offerWindowDays * 86_400;
      const startMonth = startOfMonthUnix();

      const activeRows = database
        .select({ id: schema.rentals.id, endDate: schema.rentals.endDate })
        .from(schema.rentals)
        .where(and(eq(schema.rentals.status, "Active"), isNull(schema.rentals.returnedAt)))
        .all();

      const activeRentals = activeRows.length;
      const inOfferWindow = activeRows.filter((r) => r.endDate <= horizon).length;

      const paidSales = database
        .select({ price: schema.sales.salePrice, paidAt: schema.sales.paidAt })
        .from(schema.sales)
        .where(and(eq(schema.sales.paymentStatus, "paid"), gte(schema.sales.paidAt, startMonth)))
        .all();

      const revenueThisMonth = paidSales.reduce((acc, s) => acc + (s.price ?? 0), 0);
      const convertedThisMonth = paidSales.length;

      return {
        activeRentals,
        inOfferWindow,
        offerWindowDays,
        convertedThisMonth,
        revenueThisMonth,
      };
    }),

    getUpcomingConversions: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
      .query(async ({ input }): Promise<UpcomingConversionRow[]> => {
        const limit = input?.limit ?? 10;
        const minScore = getMinScore(database);

        // Pega offers elegíveis (NoOffer ou Draft) ordenadas por score DESC com score >= minScore
        const offers = database
          .select()
          .from(schema.conversionOffers)
          .where(
            and(
              gte(schema.conversionOffers.score, minScore),
              inArray(schema.conversionOffers.status, ["NoOffer", "Draft"]),
            ),
          )
          .orderBy(desc(schema.conversionOffers.score))
          .limit(limit * 3)
          .all();

        if (offers.length === 0) return [];

        const rentalIds = offers.map((o) => o.rentalId);
        const clientIds = [...new Set(offers.map((o) => o.clientId))];
        const boardIds = [...new Set(offers.map((o) => o.boardId))];

        const rentals = database
          .select()
          .from(schema.rentals)
          .where(inArray(schema.rentals.id, rentalIds))
          .all();
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

        const cbs = database
          .select()
          .from(schema.clientBoardStats)
          .where(
            sql`${schema.clientBoardStats.clientId} IN (${sql.join(
              clientIds.map((id) => sql`${id}`),
              sql`,`,
            )})`,
          )
          .all();

        const rentalMap = new Map(rentals.map((r) => [r.id, r]));
        const clientMap = new Map(clients.map((c) => [c.id, c]));
        const boardMap = new Map(boards.map((b) => [b.id, b]));
        const statsMap = new Map(cbs.map((s) => [`${s.clientId}:${s.boardId}`, s]));
        const now = Math.floor(Date.now() / 1000);

        const rows: UpcomingConversionRow[] = [];
        for (const offer of offers) {
          const rental = rentalMap.get(offer.rentalId);
          const client = clientMap.get(offer.clientId);
          const board = boardMap.get(offer.boardId);
          if (!rental || !client || !board) continue;
          // só rentals ativas
          if (rental.status !== "Active" || rental.returnedAt) continue;
          const cooldown = getCooldownState(client, now);
          if (cooldown.inCooldown) continue;
          const stat = statsMap.get(`${client.id}:${board.id}`);
          rows.push({
            rentalId: rental.id,
            clientId: client.id,
            boardId: board.id,
            clientName: client.name,
            boardLabel: `${board.model} ${board.size}`,
            endDate: rental.endDate,
            daysRemaining: Math.ceil((rental.endDate - now) / 86_400),
            score: offer.score,
            offerStatus: offer.status,
            cooldown,
            stats: {
              rentalsOfThisBoard: stat?.rentalsCount ?? 0,
              daysOfThisBoard: stat?.daysCount ?? 0,
            },
          });
          if (rows.length >= limit) break;
        }
        return rows;
      }),
  });
}

export const dashboardRouter = createDashboardRouter(defaultDb);
