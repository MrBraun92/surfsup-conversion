import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../db/schema.js";
import { createConversationsRouter } from "./conversations.js";
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

function seedOffer(db: DB, status: string, chatId: string | null = "12345") {
  const [client] = db
    .insert(schema.clients)
    .values({
      surfsupClientId: `C-${Math.random()}`,
      name: "Cliente Teste",
      phone: "+5511",
      telegramChatId: chatId,
    })
    .returning()
    .all();
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
      clientId: client!.id,
      boardId: board!.id,
      startDate: now - 5 * 86_400,
      endDate: now + 3 * 86_400,
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
      status,
    })
    .returning()
    .all();
  return { client: client!, board: board!, rental: rental!, offer: offer! };
}

describe("conversationsRouter", () => {
  let db: DB;
  let caller: ReturnType<ReturnType<typeof createConversationsRouter>["createCaller"]>;

  beforeEach(() => {
    process.env.TELEGRAM_DRY_RUN = "1";
    db = setupTestDb();
    caller = createConversationsRouter(db).createCaller({});
  });

  it("listOffers (ativas) retorna Sent + Accepted com shape correto", async () => {
    seedOffer(db, "Sent");
    seedOffer(db, "Accepted");
    seedOffer(db, "Expired"); // não deve aparecer
    const rows = await caller.listOffers({ tab: "ativas" });
    expect(rows).toHaveLength(2);
    const r = rows[0]!;
    expect(r.offer).toBeDefined();
    expect(r.client).toBeDefined();
    expect(r.board).toBeDefined();
    expect(r.rental).toBeDefined();
    expect(Array.isArray(r.messages)).toBe(true);
  });

  it("listOffers (expiradas) retorna Expired/Rejected/Paid", async () => {
    seedOffer(db, "Sent");
    seedOffer(db, "Expired");
    seedOffer(db, "Rejected");
    seedOffer(db, "Paid");
    const rows = await caller.listOffers({ tab: "expiradas" });
    expect(rows).toHaveLength(3);
  });

  it("listOffers default = ativas", async () => {
    seedOffer(db, "Sent");
    seedOffer(db, "Expired");
    const rows = await caller.listOffers();
    expect(rows).toHaveLength(1);
  });

  it("sendOperatorMessage cria message operatorTookOver=1 e marca sentAt", async () => {
    const seeded = seedOffer(db, "Sent", "12345");
    const result = await caller.sendOperatorMessage({
      offerId: seeded.offer.id,
      content: "Olá, aqui é o atendimento.",
    });
    expect(result.message.operatorTookOver).toBe(1);
    expect(result.message.approved).toBe(1);
    expect(result.message.sentAt).toBeTruthy();
  });

  it("sendOperatorMessage falha sem telegramChatId", async () => {
    const seeded = seedOffer(db, "Sent", null);
    await expect(
      caller.sendOperatorMessage({ offerId: seeded.offer.id, content: "oi" }),
    ).rejects.toThrow();
  });
});
