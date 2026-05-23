/**
 * dispatcher.ts — envia mensagens aprovadas cujo offer está Scheduled
 * e scheduledFor <= agora. Marca message.sentAt + telegramMessageId,
 * promove offer para Sent e seta offerExpiresAt = rental.endDate.
 *
 * Em caso de cliente sem telegramChatId: apenas pula este ciclo e cria
 * uma notification "missing_chat_id" (operador precisa preencher o chat_id).
 * NÃO expira a oferta — vai retentar nos próximos ticks.
 *
 * Em caso de settings.telegram_bot_token vazio: log warn e early return.
 */
import { and, eq, isNull, isNotNull, lte } from "drizzle-orm";
import { db as defaultDb, schema, type DB } from "../db/index.js";
import { sendMessage } from "../lib/telegram.js";

function readSetting(database: DB, key: string): string | null {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .all()[0];
  return row?.value ?? null;
}

export async function runDispatcher(database: DB = defaultDb): Promise<{ sent: number; errors: number; skipped: number }> {
  const now = Math.floor(Date.now() / 1000);
  const token = readSetting(database, "telegram_bot_token") ?? "";
  const tokenMissing = !token && process.env.TELEGRAM_DRY_RUN !== "1";

  if (tokenMissing) {
    // eslint-disable-next-line no-console
    console.warn("[dispatcher] telegram_bot_token vazio — pulando ciclo");
    return { sent: 0, errors: 0, skipped: 0 };
  }

  // Pega todos os Scheduled cujo scheduledFor <= now
  const dueOffers = database
    .select()
    .from(schema.conversionOffers)
    .where(
      and(
        eq(schema.conversionOffers.status, "Scheduled"),
        isNotNull(schema.conversionOffers.scheduledFor),
        lte(schema.conversionOffers.scheduledFor, now),
      ),
    )
    .all();

  let sent = 0;
  let errors = 0;
  let skipped = 0;

  for (const offer of dueOffers) {
    // Pega a última message aprovada e não enviada deste offer
    const message = database
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.offerId, offer.id),
          eq(schema.messages.approved, 1),
          isNull(schema.messages.sentAt),
        ),
      )
      .all()[0];

    if (!message) {
      skipped++;
      continue;
    }

    const client = database
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, offer.clientId))
      .all()[0];
    const rental = database
      .select()
      .from(schema.rentals)
      .where(eq(schema.rentals.id, offer.rentalId))
      .all()[0];

    if (!client || !rental) {
      skipped++;
      continue;
    }

    if (!client.telegramChatId) {
      // Não expira — apenas avisa o operador uma vez por offer.
      const already = database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.type, `missing_chat_id:${offer.id}`))
        .all()[0];
      if (!already) {
        database
          .insert(schema.notifications)
          .values({
            type: `missing_chat_id:${offer.id}`,
            title: `Cliente sem chat_id Telegram: ${client.name}`,
            content: `A oferta #${offer.id} está agendada mas não consegue enviar — preencha o chat_id em /clientes.`,
            metadata: JSON.stringify({ offerId: offer.id, clientId: client.id }),
          })
          .run();
      }
      skipped++;
      continue;
    }

    try {
      const result = await sendMessage({
        chatId: client.telegramChatId,
        text: message.content,
        token,
      });
      const nowDate = new Date();
      database
        .update(schema.messages)
        .set({
          sentAt: Math.floor(nowDate.getTime() / 1000),
          telegramMessageId: result.messageId,
          updatedAt: nowDate,
        })
        .where(eq(schema.messages.id, message.id))
        .run();
      database
        .update(schema.conversionOffers)
        .set({
          status: "Sent",
          offerExpiresAt: rental.endDate,
          updatedAt: nowDate,
        })
        .where(eq(schema.conversionOffers.id, offer.id))
        .run();
      sent++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[dispatcher] erro enviando offer", offer.id, err);
      errors++;
      // Não marca sentAt — será retentado no próximo tick.
    }
  }

  return { sent, errors, skipped };
}
