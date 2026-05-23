import { router, publicProcedure } from "./trpc.js";
import { importRouter } from "./routers/import.js";
import { rentalsRouter } from "./routers/rentals.js";
import { offersRouter } from "./routers/offers.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { salesRouter } from "./routers/sales.js";
import { paymentsRouter } from "./routers/payments.js";

export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  importData: importRouter,
  rentals: rentalsRouter,
  offers: offersRouter,
  dashboard: dashboardRouter,
  sales: salesRouter,
  payments: paymentsRouter,
});

export type AppRouter = typeof appRouter;
