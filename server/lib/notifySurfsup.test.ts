import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { notifySurfsupOfSale } from "./notifySurfsup.js";
import type { DB } from "../db/index.js";

function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0000_initial.sql"),
    "utf-8",
  );
  sqlite.exec(sql);
  return drizzle(sqlite, { schema }) as unknown as DB;
}

function seedSale(db: DB) {
  const c = db
    .insert(schema.clients)
    .values({ surfsupClientId: "C99", name: "Maria", phone: "+5511911112222" })
    .returning().all()[0]!;
  const b = db
    .insert(schema.boards)
    .values({
      surfsupBoardId: "B99",
      model: "Channel Islands",
      size: "5'10",
      precoSite: 6000,
      precoAmigo: 4500,
    })
    .returning().all()[0]!;
  const r = db
    .insert(schema.rentals)
    .values({
      surfsupRentalId: "R99",
      clientId: c.id,
      boardId: b.id,
      startDate: 1,
      endDate: 2,
    })
    .returning().all()[0]!;
  const o = db
    .insert(schema.conversionOffers)
    .values({ rentalId: r.id, clientId: c.id, boardId: b.id, score: 80, status: "Accepted" })
    .returning().all()[0]!;
  const s = db
    .insert(schema.sales)
    .values({
      offerId: o.id,
      rentalId: r.id,
      clientId: c.id,
      boardId: b.id,
      salePrice: 4500,
      paymentStatus: "paid",
      paidAt: Math.floor(Date.now() / 1000),
    })
    .returning().all()[0]!;
  return { s };
}

describe("notifySurfsupOfSale", () => {
  let db: DB;
  beforeEach(() => {
    db = setupTestDb();
  });

  it("popula surfsupNotifiedAt + cria notification surfsup_notified", async () => {
    const { s } = seedSale(db);
    db.update(schema.settings).set({ value: "ops@surfsup.com.br" }).where(eq(schema.settings.key, "surfsup_notify_email")).run();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await notifySurfsupOfSale(s.id, db);
    spy.mockRestore();

    const sale2 = db.select().from(schema.sales).where(eq(schema.sales.id, s.id)).all()[0]!;
    expect(sale2.surfsupNotifiedAt).toBeTruthy();

    const notifs = db.select().from(schema.notifications).all();
    expect(notifs.some((n) => n.type === "surfsup_notified")).toBe(true);
  });

  it("funciona sem setting (email placeholder)", async () => {
    const { s } = seedSale(db);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await notifySurfsupOfSale(s.id, db);
    spy.mockRestore();
    const sale2 = db.select().from(schema.sales).where(eq(schema.sales.id, s.id)).all()[0]!;
    expect(sale2.surfsupNotifiedAt).toBeTruthy();
  });
});
