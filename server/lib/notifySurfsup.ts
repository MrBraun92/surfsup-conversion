/**
 * notifySurfsup.ts — notifica a Surfsup quando uma venda é confirmada.
 *
 * MVP: apenas loga em console e persiste sales.surfsupNotifiedAt + cria notification.
 * Email actually sending: out of scope.
 */
import { eq } from "drizzle-orm";
import { db as defaultDb, schema, type DB } from "../db/index.js";

function readSetting(database: DB, key: string): string | null {
  const row = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .all()[0];
  return row?.value ?? null;
}

export async function notifySurfsupOfSale(
  saleId: number,
  database: DB = defaultDb,
): Promise<void> {
  const sale = database
    .select()
    .from(schema.sales)
    .where(eq(schema.sales.id, saleId))
    .all()[0];
  if (!sale) throw new Error(`Sale ${saleId} não encontrada`);

  const client = database
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, sale.clientId))
    .all()[0];
  const board = database
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.id, sale.boardId))
    .all()[0];

  const email = readSetting(database, "surfsup_notify_email") ?? "(email não configurado)";
  const priceBR = sale.salePrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // eslint-disable-next-line no-console
  console.log(
    `[notify-surfsup] EMAIL TO ${email}: Venda confirmada — ${client?.name ?? "?"} comprou ${board?.model ?? "?"} ${board?.size ?? ""} por ${priceBR}. ` +
      `Telefone: ${client?.phone ?? "?"}. Surfsup ID: cliente=${client?.surfsupClientId ?? "?"}, prancha=${board?.surfsupBoardId ?? "?"}`,
  );

  const now = new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);
  database
    .update(schema.sales)
    .set({ surfsupNotifiedAt: nowUnix, updatedAt: now })
    .where(eq(schema.sales.id, saleId))
    .run();

  database
    .insert(schema.notifications)
    .values({
      type: "surfsup_notified",
      title: `Surfsup notificada: venda ${client?.name ?? "?"} → ${board?.model ?? "?"}`,
      content: `Email: ${email} · ${priceBR}`,
      metadata: JSON.stringify({ saleId, email }),
    })
    .run();
}
