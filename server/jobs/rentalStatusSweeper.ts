/**
 * rentalStatusSweeper.ts — marca rentals Active com endDate < now e returnedAt NULL como Overdue.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { db as defaultDb, schema, type DB } from "../db/index.js";

export async function runRentalStatusSweeper(database: DB = defaultDb): Promise<{ overdue: number }> {
  const now = Math.floor(Date.now() / 1000);
  const due = database
    .select()
    .from(schema.rentals)
    .where(
      and(
        eq(schema.rentals.status, "Active"),
        isNull(schema.rentals.returnedAt),
        lt(schema.rentals.endDate, now),
      ),
    )
    .all();

  for (const r of due) {
    database
      .update(schema.rentals)
      .set({ status: "Overdue", updatedAt: new Date() })
      .where(eq(schema.rentals.id, r.id))
      .run();
  }
  return { overdue: due.length };
}
