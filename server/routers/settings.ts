import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { SETTINGS_KEYS, type SettingsKey } from "../../shared/constants.js";
import { getMe } from "../lib/telegram.js";

const settingsKeyEnum = z.enum(SETTINGS_KEYS as unknown as [SettingsKey, ...SettingsKey[]]);

export function createSettingsRouter(database: DB) {
  return router({
    getAll: publicProcedure.query(async () => {
      const rows = database.select().from(schema.settings).all();
      return rows.reduce<Record<string, string>>((acc, r) => {
        acc[r.key] = r.value;
        return acc;
      }, {});
    }),

    set: publicProcedure
      .input(z.object({ key: settingsKeyEnum, value: z.string() }))
      .mutation(async ({ input }) => {
        const existing = database
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, input.key))
          .all();
        if (existing.length === 0) {
          database.insert(schema.settings).values({ key: input.key, value: input.value }).run();
        } else {
          database
            .update(schema.settings)
            .set({ value: input.value, updatedAt: new Date() })
            .where(eq(schema.settings.key, input.key))
            .run();
        }
        return { ok: true };
      }),

    validateTelegram: publicProcedure
      .input(z.object({ token: z.string().min(10) }))
      .mutation(async ({ input }) => {
        const r = await getMe(input.token);
        return r;
      }),
  });
}

export const settingsRouter = createSettingsRouter(defaultDb);
