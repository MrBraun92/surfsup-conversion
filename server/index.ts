import express from "express";
import cors from "cors";
import cron from "node-cron";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { runDispatcher } from "./jobs/dispatcher.js";
import { runExpirer } from "./jobs/expirer.js";
import { runRentalStatusSweeper } from "./jobs/rentalStatusSweeper.js";
import { telegramWebhookHandler } from "./routers/telegramWebhook.js";
import { surfsupSyncHandler } from "./integrations/surfsupSync.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post("/api/integrations/telegram/webhook", telegramWebhookHandler);
app.post("/api/integrations/surfsup/sync", surfsupSyncHandler);

// Cron jobs — desabilitáveis via SURFSUP_DISABLE_CRON=1 (útil em testes / scripts)
if (process.env.SURFSUP_DISABLE_CRON === "1") {
  // eslint-disable-next-line no-console
  console.log("[cron] disabled (SURFSUP_DISABLE_CRON=1)");
} else {
  cron.schedule("* * * * *", async () => {
    try {
      await runDispatcher();
      await runExpirer();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[cron:1min] erro:", err);
    }
  });
  cron.schedule("*/5 * * * *", async () => {
    try {
      await runRentalStatusSweeper();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[cron:5min] erro:", err);
    }
  });
  // eslint-disable-next-line no-console
  console.log("[cron] enabled (dispatcher+expirer @ 1min, rentalStatusSweeper @ 5min)");
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] http://localhost:${PORT}`);
});
