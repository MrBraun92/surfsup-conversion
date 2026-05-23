import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../db/schema.js";
import { createClientsLogRouter } from "./clientsLog.js";
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

function seedClient(db: DB, idx: number, extra: Partial<typeof schema.clients.$inferInsert> = {}) {
  return db
    .insert(schema.clients)
    .values({
      surfsupClientId: `C${idx}`,
      name: `Cliente ${idx}`,
      phone: `+551199990000${idx}`,
      ...extra,
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
    })
    .returning()
    .all()[0]!;
}

describe("clientsLogRouter", () => {
  let db: DB;
  let caller: ReturnType<ReturnType<typeof createClientsLogRouter>["createCaller"]>;

  beforeEach(() => {
    db = setupTestDb();
    caller = createClientsLogRouter(db).createCaller({});
  });

  it("listQualified retorna apenas clientes com pelo menos 1 rental", async () => {
    const c1 = seedClient(db, 1);
    seedClient(db, 2); // sem rental → não deve aparecer
    const b = seedBoard(db, 1);
    seedRental(db, c1.id, b.id, 1);
    const rows = await caller.listQualified();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.client.id).toBe(c1.id);
    expect(rows[0]!.totalRentals).toBe(1);
  });

  it("filter=cooldown retorna apenas clientes em cooldown", async () => {
    const now = Math.floor(Date.now() / 1000);
    const c1 = seedClient(db, 1, {
      cooldownUntil: now + 30 * 86_400,
      cooldownReason: "rejected",
    });
    const c2 = seedClient(db, 2);
    const b = seedBoard(db, 1);
    seedRental(db, c1.id, b.id, 1);
    seedRental(db, c2.id, b.id, 2);

    const all = await caller.listQualified({ filter: "all" });
    expect(all).toHaveLength(2);
    const cool = await caller.listQualified({ filter: "cooldown" });
    expect(cool).toHaveLength(1);
    expect(cool[0]!.client.id).toBe(c1.id);
    expect(cool[0]!.cooldown.inCooldown).toBe(true);
  });

  it("search por nome filtra corretamente", async () => {
    const c1 = seedClient(db, 1, { name: "João Silva" });
    const c2 = seedClient(db, 2, { name: "Maria Souza" });
    const b = seedBoard(db, 1);
    seedRental(db, c1.id, b.id, 1);
    seedRental(db, c2.id, b.id, 2);
    const rows = await caller.listQualified({ search: "João" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.client.id).toBe(c1.id);
  });

  it("getClientDetail retorna rentals + offers + sales + cooldown", async () => {
    const c1 = seedClient(db, 1);
    const b = seedBoard(db, 1);
    const r = seedRental(db, c1.id, b.id, 1);
    db.insert(schema.conversionOffers)
      .values({ rentalId: r.id, clientId: c1.id, boardId: b.id, score: 80, status: "Sent" })
      .run();
    const detail = await caller.getClientDetail({ clientId: c1.id });
    expect(detail.client.id).toBe(c1.id);
    expect(detail.rentals).toHaveLength(1);
    expect(detail.offers).toHaveLength(1);
    expect(detail.sales).toHaveLength(0);
    expect(detail.cooldown.inCooldown).toBe(false);
  });
});
