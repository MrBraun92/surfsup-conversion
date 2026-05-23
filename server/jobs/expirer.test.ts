import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { runExpirer } from "./expirer.js";
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

function seedSentExpired(db: DB, withResponse = false) {
  const now = Math.floor(Date.now() / 1000);
  const [client] = db
    .insert(schema.clients)
    .values({ surfsupClientId: "C1", name: "João", phone: "+5511999998888" })
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
      startDate: now - 10 * 86_400,
      endDate: now - 86_400, // já passou
      status: "Overdue",
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
      status: "Sent",
      offerExpiresAt: now - 3600,
    })
    .returning()
    .all();
  db.insert(schema.messages)
    .values({
      offerId: offer!.id,
      content: "oi",
      approved: 1,
      sentAt: now - 86_400,
      responseType: withResponse ? "Interested" : null,
    })
    .run();
  return { client: client!, board: board!, offer: offer! };
}

describe("runExpirer — no_response", () => {
  it("move Sent expirado sem responseType para Expired e aplica cooldown", async () => {
    const db = setupTestDb();
    const seeded = seedSentExpired(db, false);

    const result = await runExpirer(db);
    expect(result.noResponse).toBe(1);

    const offer = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .all()[0]!;
    expect(offer.status).toBe("Expired");

    const client = db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, seeded.client.id))
      .all()[0]!;
    expect(client.cooldownReason).toBe("no_response");
    expect(client.cooldownUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(client.cooldownTriggerBoardId).toBe(seeded.board.id);
  });

  it("não expira Sent quando última message tem responseType", async () => {
    const db = setupTestDb();
    const seeded = seedSentExpired(db, true);

    const result = await runExpirer(db);
    expect(result.noResponse).toBe(0);

    const offer = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .all()[0]!;
    expect(offer.status).toBe("Sent");
  });
});

describe("runExpirer — accepted_unpaid", () => {
  it("move Accepted expirado sem sale paga para Expired com cooldown", async () => {
    const db = setupTestDb();
    const seeded = seedSentExpired(db, false);
    // Vira Accepted
    db.update(schema.conversionOffers)
      .set({ status: "Accepted" })
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .run();
    // Cria sale não paga
    db.insert(schema.sales)
      .values({
        offerId: seeded.offer.id,
        rentalId: db.select().from(schema.rentals).all()[0]!.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        salePrice: 4000,
        paymentStatus: "pending",
      })
      .run();

    const result = await runExpirer(db);
    expect(result.acceptedUnpaid).toBe(1);

    const client = db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, seeded.client.id))
      .all()[0]!;
    expect(client.cooldownReason).toBe("accepted_unpaid");
  });

  it("não expira Accepted quando sale.paidAt existe", async () => {
    const db = setupTestDb();
    const seeded = seedSentExpired(db, false);
    const now = Math.floor(Date.now() / 1000);
    db.update(schema.conversionOffers)
      .set({ status: "Accepted" })
      .where(eq(schema.conversionOffers.id, seeded.offer.id))
      .run();
    db.insert(schema.sales)
      .values({
        offerId: seeded.offer.id,
        rentalId: db.select().from(schema.rentals).all()[0]!.id,
        clientId: seeded.client.id,
        boardId: seeded.board.id,
        salePrice: 4000,
        paymentStatus: "paid",
        paidAt: now - 100,
      })
      .run();

    const result = await runExpirer(db);
    expect(result.acceptedUnpaid).toBe(0);
  });
});
