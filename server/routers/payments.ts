import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { createPaymentLink, markPaid, markFailed } from "../lib/stripeStub.js";
import { notifySurfsupOfSale } from "../lib/notifySurfsup.js";

export function createPaymentsRouter(database: DB) {
  return router({
    getBySession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1) }))
      .query(async ({ input }) => {
        const sale = database
          .select()
          .from(schema.sales)
          .where(eq(schema.sales.stripeSessionId, input.sessionId))
          .all()[0];
        if (!sale) return null;
        const board = database
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, sale.boardId))
          .all()[0];
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, sale.clientId))
          .all()[0];
        return { sale, board: board ?? null, client: client ?? null };
      }),

    succeed: publicProcedure
      .input(z.object({ sessionId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await markPaid(input.sessionId, database);
        const sale = database
          .select()
          .from(schema.sales)
          .where(eq(schema.sales.stripeSessionId, input.sessionId))
          .all()[0];
        if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale não encontrada após markPaid" });
        const client = database
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, sale.clientId))
          .all()[0];
        const board = database
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, sale.boardId))
          .all()[0];
        database
          .insert(schema.notifications)
          .values({
            type: "sale_paid",
            title: `Venda confirmada: ${client?.name ?? "?"} → ${board?.model ?? "?"}`,
            content: `R$ ${sale.salePrice.toFixed(2)} — sale #${sale.id}`,
            metadata: JSON.stringify({ saleId: sale.id, sessionId: input.sessionId }),
          })
          .run();
        // Notifica Surfsup (V3)
        await notifySurfsupOfSale(sale.id, database);
        return { ok: true, saleId: sale.id };
      }),

    fail: publicProcedure
      .input(z.object({ sessionId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await markFailed(input.sessionId, database);
        const sale = database
          .select()
          .from(schema.sales)
          .where(eq(schema.sales.stripeSessionId, input.sessionId))
          .all()[0];
        database
          .insert(schema.notifications)
          .values({
            type: "payment_failed",
            title: `Pagamento falhou`,
            content: sale ? `sale #${sale.id} — operador deve revisar` : `sessionId ${input.sessionId}`,
            metadata: JSON.stringify({ saleId: sale?.id, sessionId: input.sessionId }),
          })
          .run();
        return { ok: true, saleId: sale?.id ?? null };
      }),

    createForOffer: publicProcedure
      .input(z.object({ offerId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const offer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.id, input.offerId))
          .all()[0];
        if (!offer) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta não encontrada" });
        if (offer.status !== "Accepted" && offer.status !== "Sent") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Oferta no estado "${offer.status}" — esperado Accepted/Sent.`,
          });
        }
        const board = database
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, offer.boardId))
          .all()[0];
        if (!board) throw new TRPCError({ code: "NOT_FOUND", message: "Prancha não encontrada" });

        const existingSale = database
          .select()
          .from(schema.sales)
          .where(eq(schema.sales.offerId, offer.id))
          .all()[0];
        if (existingSale && existingSale.paymentStatus === "paid") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Esta oferta já tem venda paga.",
          });
        }

        const { url, sessionId } = await createPaymentLink(
          {
            amount: board.precoAmigo,
            metadata: {
              offerId: offer.id,
              clientId: offer.clientId,
              boardId: offer.boardId,
            },
          },
          database,
        );

        const now = new Date();
        if (existingSale) {
          database
            .update(schema.sales)
            .set({
              salePrice: board.precoAmigo,
              paymentStatus: "pending",
              stripeSessionId: sessionId,
              stripeLinkUrl: url,
              updatedAt: now,
            })
            .where(eq(schema.sales.id, existingSale.id))
            .run();
        } else {
          database
            .insert(schema.sales)
            .values({
              offerId: offer.id,
              rentalId: offer.rentalId,
              clientId: offer.clientId,
              boardId: offer.boardId,
              salePrice: board.precoAmigo,
              paymentStatus: "pending",
              stripeSessionId: sessionId,
              stripeLinkUrl: url,
            })
            .run();
        }

        return { url, sessionId, salePrice: board.precoAmigo };
      }),
  });
}

export const paymentsRouter = createPaymentsRouter(defaultDb);
