/**
 * expirer.ts — sweeper que expira ofertas vencidas:
 *
 *  - Sent + offerExpiresAt < now + última message sem responseType → Expired
 *    (aplica cooldown "no_response" no cliente)
 *  - Accepted + offerExpiresAt < now + sem sale.paidAt → Expired
 *    (aplica cooldown "accepted_unpaid" no cliente)
 */
import { and, desc, eq, inArray, isNull, lt, isNotNull } from "drizzle-orm";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { buildCooldownPatch } from "../lib/clientCooldown.js";

const DEFAULT_COOLDOWN_DAYS = 90;

function readCooldownDays(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cooldown_days"))
    .all()[0];
  if (!row) return DEFAULT_COOLDOWN_DAYS;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) ? n : DEFAULT_COOLDOWN_DAYS;
}

export async function runExpirer(database: DB = defaultDb): Promise<{ noResponse: number; acceptedUnpaid: number }> {
  const now = Math.floor(Date.now() / 1000);
  const cooldownDays = readCooldownDays(database);
  let noResponse = 0;
  let acceptedUnpaid = 0;

  // --- 1) Sent + expirado + última message sem responseType ---
  const sentExpired = database
    .select()
    .from(schema.conversionOffers)
    .where(
      and(
        eq(schema.conversionOffers.status, "Sent"),
        isNotNull(schema.conversionOffers.offerExpiresAt),
        lt(schema.conversionOffers.offerExpiresAt, now),
      ),
    )
    .all();

  for (const offer of sentExpired) {
    const lastMsg = database
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.offerId, offer.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1)
      .all()[0];
    if (lastMsg && lastMsg.responseType) continue;

    database
      .update(schema.conversionOffers)
      .set({ status: "Expired", updatedAt: new Date() })
      .where(eq(schema.conversionOffers.id, offer.id))
      .run();
    const patch = buildCooldownPatch("no_response", cooldownDays, offer.boardId, now);
    database
      .update(schema.clients)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.clients.id, offer.clientId))
      .run();
    noResponse++;
  }

  // --- 2) Accepted + expirado + sale não paga ---
  const acceptedExpired = database
    .select()
    .from(schema.conversionOffers)
    .where(
      and(
        eq(schema.conversionOffers.status, "Accepted"),
        isNotNull(schema.conversionOffers.offerExpiresAt),
        lt(schema.conversionOffers.offerExpiresAt, now),
      ),
    )
    .all();

  if (acceptedExpired.length > 0) {
    const offerIds = acceptedExpired.map((o) => o.id);
    const salesRows = database
      .select()
      .from(schema.sales)
      .where(inArray(schema.sales.offerId, offerIds))
      .all();
    const paidByOffer = new Map<number, boolean>();
    for (const s of salesRows) {
      if (s.paidAt) paidByOffer.set(s.offerId, true);
    }
    for (const offer of acceptedExpired) {
      if (paidByOffer.get(offer.id)) continue;
      database
        .update(schema.conversionOffers)
        .set({ status: "Expired", updatedAt: new Date() })
        .where(eq(schema.conversionOffers.id, offer.id))
        .run();
      const patch = buildCooldownPatch("accepted_unpaid", cooldownDays, offer.boardId, now);
      database
        .update(schema.clients)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.clients.id, offer.clientId))
        .run();
      acceptedUnpaid++;
    }
  }

  // Reference para tirar warning de unused imports
  void isNull;

  return { noResponse, acceptedUnpaid };
}
