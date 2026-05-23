import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createTelegramWebhookHandler } from "./telegramWebhook.js";
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

function mockReqRes(body: any) {
  const req = { body } as any;
  let statusCode = 0;
  let payload: any = null;
  const res = {
    status(c: number) {
      statusCode = c;
      return this;
    },
    json(p: any) {
      payload = p;
      return this;
    },
  } as any;
  return {
    req,
    res,
    get status() { return statusCode; },
    get body() { return payload; },
  };
}

function seedClient(db: DB, chatId: string | null) {
  return db
    .insert(schema.clients)
    .values({
      surfsupClientId: "C1",
      name: "João",
      phone: "+5511",
      telegramChatId: chatId,
    })
    .returning()
    .all()[0]!;
}

function seedOffer(db: DB, clientId: number, status: string) {
  const [board] = db
    .insert(schema.boards)
    .values({
      surfsupBoardId: `B-${Math.random()}`,
      model: "Pyzel",
      size: "6'0",
      precoSite: 5000,
      precoAmigo: 4000,
    })
    .returning()
    .all();
  const now = Math.floor(Date.now() / 1000);
  const [rental] = db
    .insert(schema.rentals)
    .values({
      surfsupRentalId: `R-${Math.random()}`,
      clientId,
      boardId: board!.id,
      startDate: now - 5 * 86_400,
      endDate: now + 3 * 86_400,
    })
    .returning()
    .all();
  return db
    .insert(schema.conversionOffers)
    .values({
      rentalId: rental!.id,
      clientId,
      boardId: board!.id,
      score: 80,
      status,
    })
    .returning()
    .all()[0]!;
}

describe("telegramWebhookHandler", () => {
  let db: DB;
  let handler: ReturnType<typeof createTelegramWebhookHandler>;

  beforeEach(() => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
    process.env.TELEGRAM_DRY_RUN = "1";
    delete process.env.OPENAI_API_KEY;
    db = setupTestDb();
    handler = createTelegramWebhookHandler(db);
  });

  it("cliente desconhecido → 200 silencioso", async () => {
    const m = mockReqRes({
      message: { chat: { id: 99999 }, text: "oi", message_id: 1 },
    });
    await handler(m.req, m.res);
    expect(m.status).toBe(200);
    expect(m.body.ignored).toBe("unknown_client");
  });

  it("offer Sent + intent interested → offer vira Accepted + notification", async () => {
    const client = seedClient(db, "12345");
    const offer = seedOffer(db, client.id, "Sent");
    const m = mockReqRes({
      message: { chat: { id: 12345 }, text: "Quero sim! Topo ficar com ela.", message_id: 5 },
    });
    await handler(m.req, m.res);
    expect(m.status).toBe(200);
    const updated = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, offer.id))
      .all()[0]!;
    expect(updated.status).toBe("Accepted");
    const notifs = db.select().from(schema.notifications).all();
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("offer_accepted");
  });

  it("offer Sent + intent not_interested → offer Rejected + cooldown aplicado", async () => {
    const client = seedClient(db, "12345");
    const offer = seedOffer(db, client.id, "Sent");
    const m = mockReqRes({
      message: { chat: { id: 12345 }, text: "Não quero, obrigado.", message_id: 6 },
    });
    await handler(m.req, m.res);
    expect(m.status).toBe(200);
    const updated = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, offer.id))
      .all()[0]!;
    expect(updated.status).toBe("Rejected");
    const updatedClient = db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, client.id))
      .all()[0]!;
    expect(updatedClient.cooldownReason).toBe("rejected");
    expect(updatedClient.cooldownUntil).toBeTruthy();
  });

  it("sem offer ativa + sem cooldown → 200 ignora", async () => {
    seedClient(db, "12345");
    const m = mockReqRes({
      message: { chat: { id: 12345 }, text: "alô?", message_id: 7 },
    });
    await handler(m.req, m.res);
    expect(m.status).toBe(200);
    expect(m.body.ignored).toBe("no_active_offer");
  });

  it("edited_message também é processado", async () => {
    const client = seedClient(db, "12345");
    const offer = seedOffer(db, client.id, "Sent");
    const m = mockReqRes({
      edited_message: { chat: { id: 12345 }, text: "Aceito!", message_id: 8 },
    });
    await handler(m.req, m.res);
    const updated = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, offer.id))
      .all()[0]!;
    expect(updated.status).toBe("Accepted");
  });
});
