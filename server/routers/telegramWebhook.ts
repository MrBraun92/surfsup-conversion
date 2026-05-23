/**
 * telegramWebhook — Express handler para `POST /api/integrations/telegram/webhook`.
 *
 * Recebe updates do Telegram (message ou edited_message). Comportamento:
 *  - Procura cliente por telegramChatId == String(chat.id). Se não acha → 200 silencioso.
 *  - Procura última offer ativa (Sent | Accepted) do cliente.
 *    - Sem offer ativa + cliente em cooldown → registra mensagem stand-alone na última offer
 *      conhecida do cliente (modo consultoria). Sem offer histórica → ignora.
 *    - Sem offer ativa + sem cooldown → ignora (não pushea oferta sem trigger).
 *  - Com offer ativa: classifica intent, registra response, aplica side-effects.
 */
import type { Request, Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { classifyInboundIntent, type InboundIntent } from "../lib/llm.js";
import {
  buildCooldownPatch,
  isClientInCooldown,
} from "../lib/clientCooldown.js";

const DEFAULT_COOLDOWN_DAYS = 90;

function readCooldownDays(database: DB): number {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cooldown_days"))
    .all()[0];
  if (!row) return DEFAULT_COOLDOWN_DAYS;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_COOLDOWN_DAYS;
}

function mapIntentToResponseType(intent: InboundIntent): string {
  switch (intent) {
    case "interested":
      return "Interested";
    case "not_interested":
      return "NotInterested";
    case "paid":
      return "Interested";
    case "question":
    default:
      return "Responding";
  }
}

export function createTelegramWebhookHandler(database: DB = defaultDb) {
  return async function telegramWebhookHandler(req: Request, res: Response) {
    try {
      const body = req.body ?? {};
      const msg = body.message ?? body.edited_message;
      if (!msg || !msg.chat || typeof msg.text !== "string") {
        res.status(200).json({ ok: true, ignored: "no_message" });
        return;
      }
      const chatId = String(msg.chat.id);
      const text = msg.text;

      const client = database
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.telegramChatId, chatId))
        .all()[0];
      if (!client) {
        res.status(200).json({ ok: true, ignored: "unknown_client" });
        return;
      }

      const activeOffer = database
        .select()
        .from(schema.conversionOffers)
        .where(
          inArray(schema.conversionOffers.status, ["Sent", "Accepted"]),
        )
        .all()
        .filter((o) => o.clientId === client.id)
        .sort((a, b) => {
          const at = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
          const bt = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
          return bt - at;
        })[0];

      const nowSec = Math.floor(Date.now() / 1000);
      const nowDate = new Date();

      if (!activeOffer) {
        const inCooldown = isClientInCooldown(
          {
            cooldownUntil: client.cooldownUntil,
            cooldownReason: client.cooldownReason,
            cooldownTriggerAt: client.cooldownTriggerAt,
          },
          nowSec,
        );
        if (!inCooldown) {
          res.status(200).json({ ok: true, ignored: "no_active_offer" });
          return;
        }
        // Modo consultoria: registra na última offer histórica
        const lastOffer = database
          .select()
          .from(schema.conversionOffers)
          .where(eq(schema.conversionOffers.clientId, client.id))
          .orderBy(desc(schema.conversionOffers.updatedAt))
          .all()[0];
        if (!lastOffer) {
          res.status(200).json({ ok: true, ignored: "cooldown_no_history" });
          return;
        }
        const intent = await classifyInboundIntent(text);
        database
          .insert(schema.messages)
          .values({
            offerId: lastOffer.id,
            content: "",
            approved: 0,
            response: text,
            responseAt: nowSec,
            responseType: mapIntentToResponseType(intent.intent),
            operatorTookOver: 0,
          })
          .run();
        res.status(200).json({ ok: true, mode: "consultancy", intent: intent.intent });
        return;
      }

      const intent = await classifyInboundIntent(text);
      const responseType = mapIntentToResponseType(intent.intent);
      database
        .insert(schema.messages)
        .values({
          offerId: activeOffer.id,
          content: "",
          approved: 0,
          response: text,
          responseAt: nowSec,
          responseType,
          operatorTookOver: 0,
        })
        .run();

      if (intent.intent === "interested") {
        database
          .update(schema.conversionOffers)
          .set({ status: "Accepted", updatedAt: nowDate })
          .where(eq(schema.conversionOffers.id, activeOffer.id))
          .run();
        database
          .insert(schema.notifications)
          .values({
            type: "offer_accepted",
            title: `Cliente ${client.name} aceitou!`,
            content: "Gere o link de pagamento.",
            metadata: JSON.stringify({ offerId: activeOffer.id, clientId: client.id }),
          })
          .run();
      } else if (intent.intent === "not_interested") {
        database
          .update(schema.conversionOffers)
          .set({ status: "Rejected", updatedAt: nowDate })
          .where(eq(schema.conversionOffers.id, activeOffer.id))
          .run();
        const cooldownDays = readCooldownDays(database);
        const patch = buildCooldownPatch(
          "rejected",
          cooldownDays,
          activeOffer.boardId,
          nowSec,
        );
        database
          .update(schema.clients)
          .set({ ...patch, updatedAt: nowDate })
          .where(eq(schema.clients.id, client.id))
          .run();
      }
      // intent === 'paid' ou 'question' → não muda status da offer.

      res.status(200).json({ ok: true, intent: intent.intent });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[telegramWebhook] erro:", err);
      // Sempre 200 ao Telegram (evita retries em loop)
      res.status(200).json({ ok: false });
    }
  };
}

export const telegramWebhookHandler = createTelegramWebhookHandler();
