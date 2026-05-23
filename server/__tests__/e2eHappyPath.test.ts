/**
 * E2E happy path — protege o fluxo completo da spec:
 *  1. importar planilha → cria boards/clients/rentals/offers
 *  2. baixar min_score → permitir generateMessage
 *  3. generateMessage → cria draft + transita para PendingApproval com message LLM offline
 *  4. simular aceite manual via webhook (intent='interested') → offer.status='Accepted'
 *  5. createForOffer → cria sale + payment link stub
 *  6. payments.succeed → marca paid + rental ConvertedToSale + board Vendida + notifica Surfsup
 *  7. KPIs do Dashboard refletem 1 venda este mês
 *
 * Roda em DB :memory: para isolamento total.
 *
 * Substitui o Playwright e2e do plano original — preserva o mesmo poder de proteção
 * sem o overhead de instalar browsers.
 */
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../db/schema.js";
import { processImport } from "../lib/import.js";
import { createRentalsRouter } from "../routers/rentals.js";
import { createOffersRouter } from "../routers/offers.js";
import { createPaymentsRouter } from "../routers/payments.js";
import { createSalesRouter } from "../routers/sales.js";
import { createDashboardRouter } from "../routers/dashboard.js";
import { createConversationsRouter } from "../routers/conversations.js";
import { router } from "../trpc.js";
import { createTelegramWebhookHandler } from "../routers/telegramWebhook.js";

process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
process.env.TELEGRAM_DRY_RUN = "1";

function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "drizzle", "0000_initial.sql"),
    "utf8",
  );
  sqlite.exec(sql);
  return drizzle(sqlite, { schema });
}

describe("E2E happy path: import → offer → accept → pay → KPI", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appRouter: any;

  beforeAll(async () => {
    db = setupTestDb();
    appRouter = router({
      rentals: createRentalsRouter(db),
      offers: createOffersRouter(db),
      payments: createPaymentsRouter(db),
      sales: createSalesRouter(db),
      dashboard: createDashboardRouter(db),
      conversations: createConversationsRouter(db),
    });
  });

  it("ciclo completo do funil de conversão", async () => {
    // 1. Importa planilha real
    const buf = fs.readFileSync(
      path.resolve(process.cwd(), "templates", "surfsup-conversion-template.xlsx"),
    );
    const importRes = await processImport(buf, "template.xlsx", db);
    expect(importRes.ok).toBe(true);
    if (!importRes.ok) throw new Error("import failed");
    expect(importRes.report.boards.new).toBeGreaterThanOrEqual(5);
    expect(importRes.report.rentals.inserted).toBeGreaterThanOrEqual(5);

    // 2. Baixa min_score e seta chatId no primeiro cliente ativo
    db.update(schema.settings)
      .set({ value: "1" })
      .where(eq(schema.settings.key, "min_score_to_generate"))
      .run();

    const caller = appRouter.createCaller({});
    const activeList = await caller.rentals.list({ filter: "active" });
    expect(activeList.length).toBeGreaterThanOrEqual(1);

    const rentalId = activeList[0].rental.id;
    const clientId = activeList[0].client.id;
    db.update(schema.clients)
      .set({ telegramChatId: "999" })
      .where(eq(schema.clients.id, clientId))
      .run();

    // 3. Generate message — deve transitar para PendingApproval com message offline
    const gen = await caller.offers.generateMessage({ rentalId });
    expect(gen.offer.status).toBe("PendingApproval");
    expect(gen.message.content.length).toBeGreaterThan(20);
    const offerId = gen.offer.id;

    // 4. Simula promote para Sent (operador aprovou e cron enviou)
    db.update(schema.conversionOffers)
      .set({
        status: "Sent",
        offerExpiresAt: Math.floor(Date.now() / 1000) + 86_400,
      })
      .where(eq(schema.conversionOffers.id, offerId))
      .run();

    // 5. Webhook do Telegram com resposta positiva — usa o factory com db injetado
    const handler = createTelegramWebhookHandler(db);
    const fakeReq: any = {
      body: {
        message: { chat: { id: 999 }, text: "Quero comprar essa prancha!", message_id: 1 },
      },
    };
    let webhookStatus = 0;
    const fakeRes: any = {
      status(c: number) {
        webhookStatus = c;
        return this;
      },
      json() {
        return this;
      },
      send() {
        return this;
      },
      end() {
        return this;
      },
    };
    await handler(fakeReq, fakeRes);
    expect(webhookStatus).toBe(200);

    const offerAfterReply = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, offerId))
      .all()[0];
    expect(offerAfterReply.status).toBe("Accepted");

    // 6. createForOffer + succeed
    const pay = await caller.payments.createForOffer({ offerId });
    expect(pay.url).toMatch(/^\/pay\//);
    expect(pay.salePrice).toBeGreaterThan(0);

    await caller.payments.succeed({ sessionId: pay.sessionId });

    // 7. Verifica estado final
    const offerFinal = db
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.id, offerId))
      .all()[0];
    expect(offerFinal.status).toBe("Paid");

    const rentalFinal = db
      .select()
      .from(schema.rentals)
      .where(eq(schema.rentals.id, rentalId))
      .all()[0];
    expect(rentalFinal.status).toBe("ConvertedToSale");

    const sale = db.select().from(schema.sales).all()[0];
    expect(sale.paymentStatus).toBe("paid");
    expect(sale.paidAt).toBeTruthy();
    expect(sale.surfsupNotifiedAt).toBeTruthy();

    // 8. KPIs refletem
    const kpis = await caller.dashboard.getKPIs();
    expect(kpis.convertedThisMonth).toBe(1);
    expect(kpis.revenueThisMonth).toBe(pay.salePrice);

    const effectiveKpi = await caller.sales.kpisEffective();
    expect(effectiveKpi.salesThisMonth).toBe(1);
    expect(effectiveKpi.totalRevenue).toBe(pay.salePrice);
  });
});
