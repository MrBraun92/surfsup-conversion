import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { processImport } from "../lib/import.js";

export const importRouter = router({
  processFile: publicProcedure
    .input(z.object({ base64: z.string().min(1), filename: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const buf = Buffer.from(input.base64, "base64");
      const result = await processImport(buf, input.filename);
      return result;
    }),
});
