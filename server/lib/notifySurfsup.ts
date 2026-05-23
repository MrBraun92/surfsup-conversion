/**
 * notifySurfsup.ts — placeholder V2 (sem ação). Substituído em V3.
 */
import type { DB } from "../db/index.js";
import { db as defaultDb } from "../db/index.js";

export async function notifySurfsupOfSale(
  _saleId: number,
  _database: DB = defaultDb,
): Promise<void> {
  // no-op em V2; implementado em V3
}
