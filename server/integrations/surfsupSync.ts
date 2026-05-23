/**
 * surfsupSync — stub do webhook futuro de sincronização com a Surfsup.
 *
 * Hoje: apenas registra um log + cria notification "received_sync_payload".
 * Futuro: parsear body e chamar `processImport` em modo "delta" para upsert
 * incremental sem precisar de planilha manual.
 */
import type { Request, Response } from "express";
import { db, schema } from "../db/index.js";

export async function surfsupSyncHandler(req: Request, res: Response) {
  const body = req.body ?? {};
  const summary = {
    receivedAt: Math.floor(Date.now() / 1000),
    bodyKeys: Object.keys(body),
    bodySize: JSON.stringify(body).length,
  };
  // eslint-disable-next-line no-console
  console.log("[surfsup-sync] payload received:", summary);

  db.insert(schema.notifications)
    .values({
      type: "surfsup_sync_received",
      title: "Webhook Surfsup recebido (stub)",
      content: `Payload com chaves: ${summary.bodyKeys.join(", ")}`,
      metadata: JSON.stringify(summary),
    })
    .run();

  res.status(202).json({
    ok: true,
    accepted: true,
    message: "Stub endpoint — payload registrado em notifications. Implementação real pendente.",
  });
}
