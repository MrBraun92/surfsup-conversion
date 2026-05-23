import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { runDispatcher } from "./dispatcher.js";
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

function seedScheduled(db: DB, opts: { chatId: string | null }) {
  const now = Math.floor(Date.now() / 1000);
  const [client] = db
    .insert(schema.clients)
    .values({
      surfsupClientId: "C1",
      name: "João",
      phone: "+5511999998888",
      telegramChatId: opts.chatId,
    })
    .returning()
    .all();
  const [board] = db
    .insert(schema.boards)
    .values({
      surfsupBoardId: "B1",
      model: "Pyzel",
      size: "6'0",
      precoSite: 5000,
      precoAmigo: 4000,
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
  const [offer] = db
    .insert(schema.conversionOffers)
    .values({
      rentalId: rental!.id,
      clientId: client!.id,
      boardId: board!.id,
      score: 80,
      status: "Scheduled",
      scheduledFor: now - 60,
    })
    .returning()
    .all();
  const [message] = db
    .insert(schema.messages)
    .values({
      offerId: offer!.id,
      content: "oi joão",
      approved: 1,
      approvedAt: now - 120,
    })
    .returning()
    .all();
  return { client: client!, board: board!, rental: rental!, offer: offer!, message: message! };
}

describe("runDispatcher", () => {
  beforeEach(() => {
    process.env.TELEGRAM_DRY_RUN = "1";
  });
  afterEach(() => {
    delete process.env.TELEGRAM_DRY_RUN;
  });

  it("envia message Scheduled cujo scheduledFor já passou e promove offer para Sent", async () => {
    const db = setupTestDb();
    const seeded = seedScheduled(db, { chatId: "12345" });

    const result = await runDispatcher(db);
    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);

    const offer = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .all()[0]!;
    expect(offer.status).toBe("Sent");
    expect(offer.offerExpiresAt).toBe(seeded.rental.endDate);

    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, seeded.message.id))
      .all()[0]!;
    expect(msg.sentAt).toBeTruthy();
    expect(msg.telegramMessageId).toBe(-1); // dry-run
  });

  it("pula (não expira) quando cliente não tem telegramChatId e cria notification", async () => {
    const db = setupTestDb();
    const seeded = seedScheduled(db, { chatId: null });

    const result = await runDispatcher(db);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.sent).toBe(0);

    // Offer continua Scheduled — não foi expirado
    const offer = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .all()[0]!;
    expect(offer.status).toBe("Scheduled");

    // Notification criada
    const notif = db.select().from(schema.notifications).all();
    expect(notif.length).toBeGreaterThan(0);
    expect(notif[0]!.type).toMatch(/missing_chat_id/);

    // Rodar de novo: não duplica notification
    await runDispatcher(db);
    const notif2 = db.select().from(schema.notifications).all();
    expect(notif2.length).toBe(notif.length);
  });

  it("usa telegram_test_chat_id como fallback quando cliente não tem chat_id", async () => {
    const db = setupTestDb();
    const seeded = seedScheduled(db, { chatId: null });
    // Insere setting global de fallback
    db.insert(schema.settings)
      .values({ key: "telegram_test_chat_id", value: "777" })
      .run();

    const result = await runDispatcher(db);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);

    const offer = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .all()[0]!;
    expect(offer.status).toBe("Sent");
  });

  it("não envia se scheduledFor ainda está no futuro", async () => {
    const db = setupTestDb();
    const seeded = seedScheduled(db, { chatId: "12345" });
    db.update(schema.conversionOffers)
      .set({ scheduledFor: Math.floor(Date.now() / 1000) + 3600 })
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .run();

    const result = await runDispatcher(db);
    expect(result.sent).toBe(0);
  });
});
