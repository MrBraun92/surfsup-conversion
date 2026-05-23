/**
 * stripeStub.ts — wrapper de Stripe em modo stub para o MVP.
 *
 * Modos (lidos de settings.stripe_mode):
 *  - 'stub' (default): cria link interno /pay/:sessionId; markPaid/markFailed mutam DB.
 *  - 'test' | 'live': não implementado — lança erro.
 *
 * Interface preparada para swap futuro por Stripe SDK real.
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db as defaultDb, schema, type DB } from "../db/index.js";

function readMode(database: DB): string {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "stripe_mode"))
    .all()[0];
  return row?.value ?? "stub";
}

export interface CreatePaymentLinkInput {
  amount: number;
  metadata: Record<string, string | number>;
}

export interface CreatePaymentLinkResult {
  url: string;
  sessionId: string;
}

export async function createPaymentLink(
  input: CreatePaymentLinkInput,
  database: DB = defaultDb,
): Promise<CreatePaymentLinkResult> {
  const mode = readMode(database);
  if (mode === "stub") {
    const sessionId = nanoid();
    return { url: `/pay/${sessionId}`, sessionId };
  }
  throw new Error(`Modo Stripe "${mode}" não implementado — use stub`);
}

/**
 * markPaid — promove sale para paid e atualiza offer/rental/board atomicamente.
 */
export async function markPaid(sessionId: string, database: DB = defaultDb): Promise<void> {
  const sale = database
    .select()
    .from(schema.sales)
    .where(eq(schema.sales.stripeSessionId, sessionId))
    .all()[0];
  if (!sale) throw new Error(`Sale com sessionId ${sessionId} não encontrada`);

  const now = new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);

  // Drizzle SQLite better-sqlite3 — usa transaction síncrona via .transaction
  (database as unknown as { transaction: (fn: (tx: DB) => void) => void }).transaction((tx) => {
    tx.update(schema.sales)
      .set({ paymentStatus: "paid", paidAt: nowUnix, updatedAt: now })
      .where(eq(schema.sales.id, sale.id))
      .run();
    tx.update(schema.conversionOffers)
      .set({ status: "Paid", updatedAt: now })
      .where(eq(schema.conversionOffers.id, sale.offerId))
      .run();
    tx.update(schema.rentals)
      .set({ status: "ConvertedToSale", updatedAt: now })
      .where(eq(schema.rentals.id, sale.rentalId))
      .run();
    tx.update(schema.boards)
      .set({ status: "Vendida", updatedAt: now })
      .where(eq(schema.boards.id, sale.boardId))
      .run();
  });
}

export async function markFailed(sessionId: string, database: DB = defaultDb): Promise<void> {
  const sale = database
    .select()
    .from(schema.sales)
    .where(eq(schema.sales.stripeSessionId, sessionId))
    .all()[0];
  if (!sale) throw new Error(`Sale com sessionId ${sessionId} não encontrada`);
  database
    .update(schema.sales)
    .set({ paymentStatus: "failed", updatedAt: new Date() })
    .where(eq(schema.sales.id, sale.id))
    .run();
}
