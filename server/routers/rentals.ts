import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, lte, desc, asc } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { getCooldownState, type CooldownState } from "../lib/clientCooldown.js";
import { rescoreActiveRentals } from "../lib/import.js";

const filterEnum = z.enum([
  "all",
  "active",
  "ending_2d",
  "ending_5d",
  "ending_7d",
  "converted",
  "rejected",
  "expired",
]);
export type RentalsListFilter = z.infer<typeof filterEnum>;

export interface RentalListItem {
  rental: typeof schema.rentals.$inferSelect;
  client: typeof schema.clients.$inferSelect;
  board: typeof schema.boards.$inferSelect;
  stats: { rentalsOfThisBoard: number; daysOfThisBoard: number };
  offer: typeof schema.conversionOffers.$inferSelect | null;
  cooldown: CooldownState;
}

export function createRentalsRouter(database: DB) {
  return router({
    list: publicProcedure
      .input(z.object({ filter: filterEnum.optional() }).optional())
      .query(async ({ input }) => {
        const filter: RentalsListFilter = input?.filter ?? "all";
        const now = Math.floor(Date.now() / 1000);

        // 1) Decide quais rentals trazer
        let rentalsRows: (typeof schema.rentals.$inferSelect)[] = [];

        if (filter === "all") {
          rentalsRows = database
            .select()
            .from(schema.rentals)
            .orderBy(desc(schema.rentals.endDate))
            .all();
        } else if (filter === "active") {
          rentalsRows = database
            .select()
            .from(schema.rentals)
            .where(
              and(
                eq(schema.rentals.status, "Active"),
                isNull(schema.rentals.returnedAt),
              ),
            )
            .orderBy(asc(schema.rentals.endDate))
            .all();
        } else if (
          filter === "ending_2d" ||
          filter === "ending_5d" ||
          filter === "ending_7d"
        ) {
          const days = filter === "ending_2d" ? 2 : filter === "ending_5d" ? 5 : 7;
          const horizon = now + days * 86_400;
          rentalsRows = database
            .select()
            .from(schema.rentals)
            .where(
              and(
                eq(schema.rentals.status, "Active"),
                isNull(schema.rentals.returnedAt),
                lte(schema.rentals.endDate, horizon),
              ),
            )
            .orderBy(asc(schema.rentals.endDate))
            .all();
        } else if (filter === "converted") {
          rentalsRows = database
            .select()
            .from(schema.rentals)
            .where(eq(schema.rentals.status, "ConvertedToSale"))
            .orderBy(desc(schema.rentals.endDate))
            .all();
        } else if (filter === "rejected" || filter === "expired") {
          const offerStatus = filter === "rejected" ? "Rejected" : "Expired";
          const offerRows = database
            .select({ rentalId: schema.conversionOffers.rentalId })
            .from(schema.conversionOffers)
            .where(eq(schema.conversionOffers.status, offerStatus))
            .all();
          const rentalIds = offerRows.map((o) => o.rentalId);
          rentalsRows = rentalIds.length
            ? database
                .select()
                .from(schema.rentals)
                .where(inArray(schema.rentals.id, rentalIds))
                .orderBy(desc(schema.rentals.endDate))
                .all()
            : [];
        }

        if (rentalsRows.length === 0) return [] as RentalListItem[];

        const clientIds = Array.from(new Set(rentalsRows.map((r) => r.clientId)));
        const boardIds = Array.from(new Set(rentalsRows.map((r) => r.boardId)));
        const rentalIds = rentalsRows.map((r) => r.id);

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
        const offersRows = database
          .select()
          .from(schema.conversionOffers)
          .where(inArray(schema.conversionOffers.rentalId, rentalIds))
          .all();
        const statsRows = database
          .select()
          .from(schema.clientBoardStats)
          .where(inArray(schema.clientBoardStats.clientId, clientIds))
          .all();

        const clientById = new Map(clientsRows.map((c) => [c.id, c]));
        const boardById = new Map(boardsRows.map((b) => [b.id, b]));
        const offerByRental = new Map(offersRows.map((o) => [o.rentalId, o]));
        const statsByPair = new Map(
          statsRows.map((s) => [`${s.clientId}:${s.boardId}`, s]),
        );

        const out: RentalListItem[] = [];
        for (const rental of rentalsRows) {
          const client = clientById.get(rental.clientId);
          const board = boardById.get(rental.boardId);
          if (!client || !board) continue;
          const stats = statsByPair.get(`${rental.clientId}:${rental.boardId}`);
          out.push({
            rental,
            client,
            board,
            stats: {
              rentalsOfThisBoard: stats?.rentalsCount ?? 0,
              daysOfThisBoard: stats?.daysCount ?? 0,
            },
            offer: offerByRental.get(rental.id) ?? null,
            cooldown: getCooldownState(
              {
                cooldownUntil: client.cooldownUntil,
                cooldownReason: client.cooldownReason,
                cooldownTriggerAt: client.cooldownTriggerAt,
              },
              now,
            ),
          });
        }
        return out;
      }),

    markReturned: publicProcedure
      .input(
        z.object({
          rentalId: z.number().int().positive(),
          returnedAt: z.number().int().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const now = input.returnedAt ?? Math.floor(Date.now() / 1000);
        const existing = database
          .select()
          .from(schema.rentals)
          .where(eq(schema.rentals.id, input.rentalId))
          .all()[0];
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Aluguel não encontrado." });
        }
        // Idempotente: se já devolvido, retorna o estado atual.
        if (existing.returnedAt && existing.status === "Returned") {
          return { ok: true, alreadyReturned: true, rental: existing };
        }
        database
          .update(schema.rentals)
          .set({ returnedAt: now, status: "Returned", updatedAt: new Date() })
          .where(eq(schema.rentals.id, input.rentalId))
          .run();
        database
          .update(schema.boards)
          .set({ status: "Disponivel", updatedAt: new Date() })
          .where(eq(schema.boards.id, existing.boardId))
          .run();
        const updated = database
          .select()
          .from(schema.rentals)
          .where(eq(schema.rentals.id, input.rentalId))
          .all()[0]!;
        return { ok: true, alreadyReturned: false, rental: updated };
      }),

    recompute: publicProcedure.mutation(async () => {
      const rescored = rescoreActiveRentals(database);
      return { rescored };
    }),
  });
}

export const rentalsRouter = createRentalsRouter(defaultDb);
