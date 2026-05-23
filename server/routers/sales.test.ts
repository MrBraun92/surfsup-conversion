import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../db/schema.js";
import { createSalesRouter } from "./sales.js";
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

function seedClient(db: DB, idx: number) {
  return db
    .insert(schema.clients)
    .values({
      surfsupClientId: `C${idx}`,
      name: `Cliente ${idx}`,
      phone: `+551199999000${idx}`,
    })
    .returning()
    .all()[0]!;
}
function seedBoard(db: DB, idx: number) {
  return db
    .insert(schema.boards)
    .values({
      surfsupBoardId: `B${idx}`,
      model: `Modelo ${idx}`,
      size: "6'0",
      precoSite: 5000,
      precoAmigo: 4000,
    })
    .returning()
    .all()[0]!;
}
function seedRental(db: DB, clientId: number, boardId: number, idx: number) {
  const now = Math.floor(Date.now() / 1000);
  return db
    .insert(schema.rentals)
    .values({
      surfsupRentalId: `R${idx}`,
      clientId,
      boardId,
      startDate: now - 10 * 86_400,
      endDate: now - 1 * 86_400,
      status: "Returned",
    })
    .returning()
    .all()[0]!;
}

describe("salesRouter — KPIs e listagens", () => {
  let db: DB;
  let caller: ReturnType<ReturnType<typeof createSalesRouter>["createCaller"]>;

  beforeEach(() => {
    db = setupTestDb();
    caller = createSalesRouter(db).createCaller({});
  });

  it("kpisEffective: 1 sale paid + 1 Rejected + 1 Expired → conversionRate = 33.3", async () => {
    // sale paid
    const c1 = seedClient(db, 1);
    const b1 = seedBoard(db, 1);
    const r1 = seedRental(db, c1.id, b1.id, 1);
    const o1 = db
      .insert(schema.conversionOffers)
      .values({ rentalId: r1.id, clientId: c1.id, boardId: b1.id, score: 80, status: "Paid" })
      .returning()
      .all()[0]!;
    db.insert(schema.sales)
      .values({
        offerId: o1.id,
        rentalId: r1.id,
        clientId: c1.id,
        boardId: b1.id,
        salePrice: 4000,
        paymentStatus: "paid",
        paidAt: Math.floor(Date.now() / 1000),
      })
      .run();

    // Rejected
    const c2 = seedClient(db, 2);
    const b2 = seedBoard(db, 2);
    const r2 = seedRental(db, c2.id, b2.id, 2);
    db.insert(schema.conversionOffers)
      .values({ rentalId: r2.id, clientId: c2.id, boardId: b2.id, score: 70, status: "Rejected" })
      .run();

    // Expired
    const c3 = seedClient(db, 3);
    const b3 = seedBoard(db, 3);
    const r3 = seedRental(db, c3.id, b3.id, 3);
    db.insert(schema.conversionOffers)
      .values({ rentalId: r3.id, clientId: c3.id, boardId: b3.id, score: 60, status: "Expired" })
      .run();

    const k = await caller.kpisEffective();
    expect(k.totalRevenue).toBe(4000);
    expect(k.ticketAverage).toBe(4000);
    expect(k.conversionRate).toBe(33.3); // 1/(1+2)*100
    expect(k.salesThisMonth).toBeGreaterThanOrEqual(0);

    const eff = await caller.listEffective();
    expect(eff).toHaveLength(1);
    expect(eff[0]!.client.name).toBe("Cliente 1");

    const rej = await caller.listRejected();
    expect(rej).toHaveLength(2);

    const kr = await caller.kpisRejected();
    expect(kr.totalRejected).toBe(2);
    expect(kr.byReason.rejected + kr.byReason.no_response + kr.byReason.accepted_unpaid).toBe(2);
  });

  it("kpisEffective: zero dados → conversionRate = 0", async () => {
    const k = await caller.kpisEffective();
    expect(k.totalRevenue).toBe(0);
    expect(k.conversionRate).toBe(0);
    const eff = await caller.listEffective();
    expect(eff).toHaveLength(0);
    const rej = await caller.listRejected();
    expect(rej).toHaveLength(0);
    const kr = await caller.kpisRejected();
    expect(kr.totalRejected).toBe(0);
    expect(kr.byReason).toEqual({ rejected: 0, no_response: 0, accepted_unpaid: 0 });
  });

  it("classifica reason: Interested + Expired → accepted_unpaid", async () => {
    const c1 = seedClient(db, 1);
    const b1 = seedBoard(db, 1);
    const r1 = seedRental(db, c1.id, b1.id, 1);
    const o1 = db
      .insert(schema.conversionOffers)
      .values({ rentalId: r1.id, clientId: c1.id, boardId: b1.id, score: 80, status: "Expired" })
      .returning()
      .all()[0]!;
    db.insert(schema.messages)
      .values({ offerId: o1.id, content: "msg", approved: 1, responseType: "Interested" })
      .run();
    const rej = await caller.listRejected();
    expect(rej[0]!.reason).toBe("accepted_unpaid");
  });
});
