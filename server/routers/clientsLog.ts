import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, like, or } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { getCooldownState } from "../lib/clientCooldown.js";

export type ClientFilter = "all" | "cooldown" | "has_offer" | "paid";

export function createClientsLogRouter(database: DB) {
  return router({
    listQualified: publicProcedure
      .input(
        z
          .object({
            search: z.string().optional(),
            filter: z.enum(["all", "cooldown", "has_offer", "paid"]).optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const filter = input?.filter ?? "all";
        const search = (input?.search ?? "").trim();

        const baseWhere = search
          ? or(
              like(schema.clients.name, `%${search}%`),
              like(schema.clients.phone, `%${search}%`),
            )
          : undefined;

        const allClients = baseWhere
          ? database.select().from(schema.clients).where(baseWhere).all()
          : database.select().from(schema.clients).all();

        if (allClients.length === 0) return [];

        const clientIds = allClients.map((c) => c.id);
        const allRentals = database
          .select()
          .from(schema.rentals)
          .where(inArray(schema.rentals.clientId, clientIds))
          .all();
        const rentalsByClient = new Map<number, typeof allRentals>();
        for (const r of allRentals) {
          const list = rentalsByClient.get(r.clientId) ?? [];
          list.push(r);
          rentalsByClient.set(r.clientId, list);
        }

        const qualified = allClients.filter((c) => (rentalsByClient.get(c.id) ?? []).length > 0);
        if (qualified.length === 0) return [];
        const qualifiedIds = qualified.map((c) => c.id);

        const allOffers = database
          .select()
          .from(schema.conversionOffers)
          .where(inArray(schema.conversionOffers.clientId, qualifiedIds))
          .all();
        const offersByClient = new Map<number, typeof allOffers>();
        for (const o of allOffers) {
          const list = offersByClient.get(o.clientId) ?? [];
          list.push(o);
          offersByClient.set(o.clientId, list);
        }

        const allSales = database
          .select()
          .from(schema.sales)
          .where(inArray(schema.sales.clientId, qualifiedIds))
          .all();
        const salesByClient = new Map<number, typeof allSales>();
        for (const s of allSales) {
          const list = salesByClient.get(s.clientId) ?? [];
          list.push(s);
          salesByClient.set(s.clientId, list);
        }

        const boardIds = [...new Set(allRentals.map((r) => r.boardId))];
        const boards = boardIds.length
          ? database
              .select()
              .from(schema.boards)
              .where(inArray(schema.boards.id, boardIds))
              .all()
          : [];
        const boardMap = new Map(boards.map((b) => [b.id, b]));

        const now = Math.floor(Date.now() / 1000);

        const rows = qualified.map((client) => {
          const rentals = (rentalsByClient.get(client.id) ?? []).slice().sort(
            (a, b) => b.endDate - a.endDate,
          );
          const offers = offersByClient.get(client.id) ?? [];
          const sales = salesByClient.get(client.id) ?? [];
          const totalRentals = rentals.length;
          const totalDaysRented = rentals.reduce((acc, r) => {
            const days = Math.max(0, Math.floor((r.endDate - r.startDate) / 86_400));
            return acc + days;
          }, 0);
          const lastRental = rentals[0];
          const lastBoard = lastRental ? boardMap.get(lastRental.boardId) : undefined;
          const cooldown = getCooldownState(
            {
              cooldownUntil: client.cooldownUntil,
              cooldownReason: client.cooldownReason,
              cooldownTriggerAt: client.cooldownTriggerAt,
            },
            now,
          );
          const hasActiveOffer = offers.some((o) =>
            ["Sent", "Accepted", "PendingApproval"].includes(o.status),
          );
          const hasPaidSale = sales.some((s) => s.paymentStatus === "paid");
          return {
            client,
            totalRentals,
            totalDaysRented,
            lastRentalAt: lastRental?.endDate ?? null,
            lastBoardModel: lastBoard?.model ?? null,
            cooldown,
            hasActiveOffer,
            hasPaidSale,
          };
        });

        return rows.filter((r) => {
          if (filter === "cooldown") return r.cooldown.inCooldown;
          if (filter === "has_offer") return r.hasActiveOffer;
          if (filter === "paid") return r.hasPaidSale;
          return true;
        });
      }),

    getClientDetail: publicProcedure
      .input(z.object({ clientId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, input.clientId))
          .all()[0];
        if (!client) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        }
        const rentals = database
          .select()
          .from(schema.rentals)
          .where(eq(schema.rentals.clientId, client.id))
          .orderBy(desc(schema.rentals.endDate))
          .all();
        const offers = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.clientId, client.id))
          .orderBy(desc(schema.conversionOffers.updatedAt))
          .all();
        const sales = database
          .select()
          .from(schema.sales)
          .where(eq(schema.sales.clientId, client.id))
          .orderBy(desc(schema.sales.createdAt))
          .all();
        const boardIds = [
          ...new Set([
            ...rentals.map((r) => r.boardId),
            ...offers.map((o) => o.boardId),
            ...sales.map((s) => s.boardId),
          ]),
        ];
        const boards = boardIds.length
          ? database
              .select()
              .from(schema.boards)
              .where(inArray(schema.boards.id, boardIds))
              .all()
          : [];
        const cooldown = getCooldownState({
          cooldownUntil: client.cooldownUntil,
          cooldownReason: client.cooldownReason,
          cooldownTriggerAt: client.cooldownTriggerAt,
        });
        return { client, rentals, offers, sales, boards, cooldown };
      }),

    setTelegramChatId: publicProcedure
      .input(
        z.object({
          clientId: z.number().int().positive(),
          telegramChatId: z.string().nullable(),
        }),
      )
      .mutation(async ({ input }) => {
        const exists = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, input.clientId))
          .all()[0];
        if (!exists) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        }
        const value = input.telegramChatId?.trim() || null;
        database
          .update(schema.clients)
          .set({ telegramChatId: value, updatedAt: new Date() })
          .where(eq(schema.clients.id, input.clientId))
          .run();
        return { ok: true, telegramChatId: value };
      }),
  });
}

export const clientsLogRouter = createClientsLogRouter(defaultDb);
