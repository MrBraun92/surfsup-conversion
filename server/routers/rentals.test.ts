import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createRentalsRouter } from "./rentals.js";
import { createOffersRouter } from "./offers.js";
import type { DB } from "../db/index.js";

function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0000_initial.sql"),
    "utf-8",
  );
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  return db;
}

function seedBasic(db: DB) {
  const now = Math.floor(Date.now() / 1000);
  const startA = now - 5 * 86_400;
  const endA = now + 3 * 86_400; // active

  const [client] = db
    .insert(schema.clients)
    .values({
      surfsupClientId: "C1",
      name: "João",
      phone: "+5511999998888",
      totalRentals: 6,
      totalDaysRented: 30,
    })
    .returning()
    .all();

  const [board] = db
    .insert(schema.boards)
    .values({
      surfsupBoardId: "B1",
      model: "Pyzel Ghost",
      size: "6'0",
      boardType: "Shortboard",
      precoSite: 5000,
      precoAmigo: 4000,
      precoMinimo: 3500,
      status: "EmAluguel",
    })
    .returning()
    .all();

  const [rental] = db
    .insert(schema.rentals)
    .values({
      surfsupRentalId: "R1",
      clientId: client!.id,
      boardId: board!.id,
      startDate: startA,
      endDate: endA,
      status: "Active",
    })
    .returning()
    .all();

  db.insert(schema.clientBoardStats)
    .values({
      clientId: client!.id,
      boardId: board!.id,
      rentalsCount: 5,
      daysCount: 25,
      lastRentalAt: startA,
    })
    .run();

  return { client: client!, board: board!, rental: rental! };
}

describe("rentalsRouter — list", () => {
  it("retorna shape correto com cooldown null e stats agregados", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    const router = createRentalsRouter(db);
    const caller = router.createCaller({});

    const rows = await caller.list({ filter: "all" });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.rental.id).toBe(seeded.rental.id);
    expect(row.client.name).toBe("João");
    expect(row.board.model).toBe("Pyzel Ghost");
    expect(row.stats.rentalsOfThisBoard).toBe(5);
    expect(row.stats.daysOfThisBoard).toBe(25);
    expect(row.cooldown.inCooldown).toBe(false);
    expect(row.offer).toBeNull();
  });

  it("filtro 'active' só traz aluguéis ativos não devolvidos", async () => {
    const db = setupTestDb();
    seedBasic(db);
    const router = createRentalsRouter(db);
    const caller = router.createCaller({});
    const rows = await caller.list({ filter: "active" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.rental.status).toBe("Active");
  });

  it("filtro 'ending_2d' só traz aluguéis terminando nos próximos 2 dias", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db); // termina em +3d
    const router = createRentalsRouter(db);
    const caller = router.createCaller({});

    const rows2 = await caller.list({ filter: "ending_2d" });
    expect(rows2.length).toBe(0);

    const rows7 = await caller.list({ filter: "ending_7d" });
    expect(rows7.length).toBe(1);
    expect(rows7[0]!.rental.id).toBe(seeded.rental.id);
  });
});

describe("rentalsRouter — markReturned", () => {
  it("marca como devolvido e libera prancha", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    const router = createRentalsRouter(db);
    const caller = router.createCaller({});

    const res = await caller.markReturned({ rentalId: seeded.rental.id });
    expect(res.ok).toBe(true);
    expect(res.alreadyReturned).toBe(false);
    expect(res.rental.status).toBe("Returned");
    expect(res.rental.returnedAt).toBeTruthy();

    const board = db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, seeded.board.id))
      .all()[0];
    expect(board!.status).toBe("Disponivel");
  });

  it("é idempotente — chamar 2x não regride estado", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    const router = createRentalsRouter(db);
    const caller = router.createCaller({});

    await caller.markReturned({ rentalId: seeded.rental.id });
    const second = await caller.markReturned({ rentalId: seeded.rental.id });
    expect(second.ok).toBe(true);
    expect(second.alreadyReturned).toBe(true);
    expect(second.rental.status).toBe("Returned");
  });
});

describe("offersRouter — generateMessage", () => {
  it("lança PRECONDITION_FAILED quando score abaixo do mínimo", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    // Cria offer NoOffer com score baixo
    db.insert(schema.conversionOffers)
      .values({
        rentalId: seeded.rental.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        score: 10,
        status: "NoOffer",
      })
      .run();

    const router = createOffersRouter(db);
    const caller = router.createCaller({});
    await expect(caller.generateMessage({ rentalId: seeded.rental.id })).rejects.toThrow(
      /abaixo do mínimo/,
    );
  });

  it("promove NoOffer → Draft quando score >= mínimo", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    db.insert(schema.conversionOffers)
      .values({
        rentalId: seeded.rental.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        score: 80,
        status: "NoOffer",
      })
      .run();

    const router = createOffersRouter(db);
    const caller = router.createCaller({});
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
    const result = await caller.generateMessage({ rentalId: seeded.rental.id });
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
    expect(result.offer.status).toBe("PendingApproval");
    expect(result.message.content.length).toBeGreaterThan(10);
  });

  it("respeita setting min_score_to_generate quando presente", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    db.update(schema.settings)
      .set({ value: "75" })
      .where(eq(schema.settings.key, "min_score_to_generate"))
      .run();
    db.insert(schema.conversionOffers)
      .values({
        rentalId: seeded.rental.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        score: 60,
        status: "NoOffer",
      })
      .run();

    const router = createOffersRouter(db);
    const caller = router.createCaller({});
    await expect(caller.generateMessage({ rentalId: seeded.rental.id })).rejects.toThrow(
      /abaixo do mínimo \(75\)/,
    );

    const setting = await caller.getMinScoreSetting();
    expect(setting.minScore).toBe(75);
  });

  it("rejeita quando offer já saiu de NoOffer", async () => {
    const db = setupTestDb();
    const seeded = seedBasic(db);
    db.insert(schema.conversionOffers)
      .values({
        rentalId: seeded.rental.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        score: 80,
        status: "Draft",
      })
      .run();

    const router = createOffersRouter(db);
    const caller = router.createCaller({});
    await expect(caller.generateMessage({ rentalId: seeded.rental.id })).rejects.toThrow(
      /já está no estado/,
    );
  });
});
