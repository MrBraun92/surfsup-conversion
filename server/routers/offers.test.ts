import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
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
  return drizzle(sqlite, { schema }) as unknown as DB;
}

function seedScenario(db: DB, score = 80) {
  const now = Math.floor(Date.now() / 1000);
  const [client] = db
    .insert(schema.clients)
    .values({
      surfsupClientId: "C1",
      name: "João Silva",
      phone: "+5511999998888",
      telegramChatId: "12345",
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
      precoSite: 5000,
      precoAmigo: 4000,
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
      startDate: now - 5 * 86_400,
      endDate: now + 3 * 86_400,
      status: "Active",
    })
    .returning()
    .all();
  db.insert(schema.clientBoardStats)
    .values({
      clientId: client!.id,
      boardId: board!.id,
      rentalsCount: 4,
      daysCount: 18,
      lastRentalAt: now - 5 * 86_400,
    })
    .run();
  db.insert(schema.conversionOffers)
    .values({
      rentalId: rental!.id,
      clientId: client!.id,
      boardId: board!.id,
      score,
      status: "NoOffer",
    })
    .run();
  return { client: client!, board: board!, rental: rental! };
}

describe("offersRouter — generateMessage (LLM offline)", () => {
  beforeEach(() => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
  });

  it("cria draft + message e transita para PendingApproval", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db, 80);
    const caller = createOffersRouter(db).createCaller({});

    const result = await caller.generateMessage({ rentalId: seeded.rental.id });
    expect(result.offer.status).toBe("PendingApproval");
    expect(result.message.approved).toBe(0);
    expect(result.message.content).toContain("João");
    expect(result.message.offerId).toBe(result.offer.id);
  });
});

describe("offersRouter — approveAndSchedule", () => {
  beforeEach(() => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
  });
  afterEach(() => {
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
  });

  it("aprova mensagem e move offer para Scheduled", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db, 80);
    const caller = createOffersRouter(db).createCaller({});
    const draft = await caller.generateMessage({ rentalId: seeded.rental.id });
    const scheduledFor = Math.floor(Date.now() / 1000) + 3600;

    const res = await caller.approveAndSchedule({
      messageId: draft.message.id,
      content: "Mensagem editada manualmente",
      scheduledFor,
    });
    expect(res.offer.status).toBe("Scheduled");
    expect(res.offer.scheduledFor).toBe(scheduledFor);
    expect(res.message.approved).toBe(1);
    expect(res.message.content).toBe("Mensagem editada manualmente");
    expect(res.message.approvedAt).toBeTruthy();
  });

  it("rejeita aprovação se offer já estiver fora de PendingApproval/Draft", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db, 80);
    const caller = createOffersRouter(db).createCaller({});
    const draft = await caller.generateMessage({ rentalId: seeded.rental.id });

    // Move artificialmente para Sent
    db.update(schema.conversionOffers)
      .set({ status: "Sent" })
      .where(eq(schema.conversionOffers.id, draft.offer.id))
      .run();

    await expect(
      caller.approveAndSchedule({
        messageId: draft.message.id,
        content: "x",
        scheduledFor: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).rejects.toThrow(/não pode ser aprovada/);
  });
});

describe("offersRouter — rejectDraft", () => {
  beforeEach(() => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
  });
  afterEach(() => {
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
  });

  it("volta offer para NoOffer", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db, 80);
    const caller = createOffersRouter(db).createCaller({});
    const draft = await caller.generateMessage({ rentalId: seeded.rental.id });
    expect(draft.offer.status).toBe("PendingApproval");

    const res = await caller.rejectDraft({ offerId: draft.offer.id });
    expect(res.offer.status).toBe("NoOffer");
  });
});

describe("offersRouter — getPaymentDefault", () => {
  it("retorna scheduledFor = endDate - window dias às 12:00 UTC (= 09:00 BRT)", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db);
    const caller = createOffersRouter(db).createCaller({});
    const res = await caller.getPaymentDefault({ rentalId: seeded.rental.id });

    const expectedDate = new Date(seeded.rental.endDate * 1000);
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 2);
    expectedDate.setUTCHours(12, 0, 0, 0);
    expect(res.defaultScheduledFor).toBe(Math.floor(expectedDate.getTime() / 1000));
  });
});

describe("offersRouter — listPendingApproval", () => {
  beforeEach(() => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
  });
  afterEach(() => {
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
  });

  it("lista offers em PendingApproval com client/board/rental/lastMessage", async () => {
    const db = setupTestDb();
    const seeded = seedScenario(db, 80);
    const caller = createOffersRouter(db).createCaller({});
    await caller.generateMessage({ rentalId: seeded.rental.id });

    const rows = await caller.listPendingApproval();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.offer.status).toBe("PendingApproval");
    expect(row.client.name).toBe("João Silva");
    expect(row.board.model).toBe("Pyzel Ghost");
    expect(row.rental.id).toBe(seeded.rental.id);
    expect(row.lastMessage).toBeTruthy();
    expect(row.lastMessage!.approved).toBe(0);
  });
});
