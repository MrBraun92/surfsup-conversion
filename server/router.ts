import { router, publicProcedure } from "./trpc.js";
import { importRouter } from "./routers/import.js";

export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  importData: importRouter,
});

export type AppRouter = typeof appRouter;
