import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createPaymentsRouter } from "./payments.js";
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

function seedAcceptedOffer(db: DB) {
  const now = Math.floor(Date.now() / 1000);
  const c = db
    .insert(schema.clients)
    .values({ surfsupClientId: "C1", name: "Joana", phone: "+5511987654321" })
    .returning()
    .all()[0]!;
  const b = db
    .insert(schema.boards)
    .values({
      surfsupBoardId: "B1",
      model: "Pyzel Ghost",
      size: "6'0",
      precoSite: 5000,
      precoAmigo: 4000,
    })
    .returning()
    .all()[0]!;
  const r = db
    .insert(schema.rentals)
    .values({
      surfsupRentalId: "R1",
      clientId: c.id,
      boardId: b.id,
      startDate: now - 5 * 86_400,
      endDate: now + 2 * 86_400,
      status: "Active",
    })
    .returning()
    .all()[0]!;
  const o = db
    .insert(schema.conversionOffers)
    .values({
      rentalId: r.id,
      clientId: c.id,
      boardId: b.id,
      score: 80,
      status: "Accepted",
    })
    .returning()
    .all()[0]!;
  return { c, b, r, o };
}

describe("paymentsRouter", () => {
  let db: DB;
  let caller: ReturnType<ReturnType<typeof createPaymentsRouter>["createCaller"]>;

  beforeEach(() => {
    db = setupTestDb();
    caller = createPaymentsRouter(db).createCaller({});
  });

  it("createForOffer cria sale com sessionId/url e status pending", async () => {
    const { o, b } = seedAcceptedOffer(db);
    const res = await caller.createForOffer({ offerId: o.id });
    expect(res.url.startsWith("/pay/")).toBe(true);
    expect(res.sessionId).toBeTruthy();
    expect(res.salePrice).toBe(b.precoAmigo);
    const sale = db.select().from(schema.sales).where(eq(schema.sales.offerId, o.id)).all()[0]!;
    expect(sale.paymentStatus).toBe("pending");
    expect(sale.stripeSessionId).toBe(res.sessionId);
  });

  it("succeed: marca paid + atualiza offer/rental/board + cria notificação", async () => {
    const { o, b, r } = seedAcceptedOffer(db);
    const { sessionId } = await caller.createForOffer({ offerId: o.id });
    await caller.succeed({ sessionId });

    const sale = db.select().from(schema.sales).where(eq(schema.sales.stripeSessionId, sessionId)).all()[0]!;
    expect(sale.paymentStatus).toBe("paid");
    expect(sale.paidAt).toBeTruthy();

    const offer2 = db.select().from(schema.conversionOffers).where(eq(schema.conversionOffers.id, o.id)).all()[0]!;
    expect(offer2.status).toBe("Paid");

    const rental2 = db.select().from(schema.rentals).where(eq(schema.rentals.id, r.id)).all()[0]!;
    expect(rental2.status).toBe("ConvertedToSale");

    const board2 = db.select().from(schema.boards).where(eq(schema.boards.id, b.id)).all()[0]!;
    expect(board2.status).toBe("Vendida");

    const notifs = db.select().from(schema.notifications).all();
    expect(notifs.some((n) => n.type === "sale_paid")).toBe(true);
  });

  it("fail: marca failed e cria notificação payment_failed", async () => {
    const { o } = seedAcceptedOffer(db);
    const { sessionId } = await caller.createForOffer({ offerId: o.id });
    await caller.fail({ sessionId });

    const sale = db.select().from(schema.sales).where(eq(schema.sales.stripeSessionId, sessionId)).all()[0]!;
    expect(sale.paymentStatus).toBe("failed");
    const notifs = db.select().from(schema.notifications).all();
    expect(notifs.some((n) => n.type === "payment_failed")).toBe(true);
  });

  it("getBySession retorna sale+board+client", async () => {
    const { o } = seedAcceptedOffer(db);
    const { sessionId } = await caller.createForOffer({ offerId: o.id });
    const got = await caller.getBySession({ sessionId });
    expect(got).not.toBeNull();
    expect(got!.client?.name).toBe("Joana");
    expect(got!.board?.model).toBe("Pyzel Ghost");
  });

  it("createForOffer rejeita oferta NoOffer", async () => {
    const { o } = seedAcceptedOffer(db);
    db.update(schema.conversionOffers).set({ status: "NoOffer" }).where(eq(schema.conversionOffers.id, o.id)).run();
    await expect(caller.createForOffer({ offerId: o.id })).rejects.toThrow();
  });
});
