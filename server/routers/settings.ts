import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.js";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { SETTINGS_KEYS, type SettingsKey } from "../../shared/constants.js";
import { getMe, discoverChats, sendMessage } from "../lib/telegram.js";
import { TRPCError } from "@trpc/server";

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

    validateTestChatId: publicProcedure
      .input(z.object({ chatId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const tokenRow = database
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "telegram_bot_token"))
          .all()[0];
        if (!tokenRow?.value) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Salve o Telegram Bot Token primeiro.",
          });
        }
        try {
          const r = await sendMessage({
            chatId: input.chatId.trim(),
            token: tokenRow.value,
            text:
              "✅ Teste do Surfsup Conversão — se você está lendo isso, o chat_id está corretamente configurado.",
          });
          return { ok: true as const, messageId: r.messageId };
        } catch (e: any) {
          const desc = e?.response?.data?.description ?? e?.message ?? "Erro desconhecido";
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Telegram rejeitou: ${desc}`,
          });
        }
      }),

    discoverTelegramChats: publicProcedure.mutation(async () => {
      const tokenRow = database
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "telegram_bot_token"))
        .all()[0];
      if (!tokenRow?.value) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Salve o Telegram Bot Token primeiro.",
        });
      }
      try {
        const chats = await discoverChats(tokenRow.value);
        return { ok: true as const, chats };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (e as Error).message,
        });
      }
    }),
  });
}

export const settingsRouter = createSettingsRouter(defaultDb);
