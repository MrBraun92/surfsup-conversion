/**
 * scripts/seed-from-template.ts
 * Atalho de dev: importa templates/surfsup-conversion-template.xlsx no DB,
 * baixa min_score para 30, e mostra resumo final.
 *
 * Uso: pnpm tsx scripts/seed-from-template.ts
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../server/db/index.js";
import { processImport } from "../server/lib/import.js";

async function main() {
  const file = path.resolve("templates", "surfsup-conversion-template.xlsx");
  if (!fs.existsSync(file)) {
    console.error("Template não encontrado:", file);
    process.exit(1);
  }
  const buf = fs.readFileSync(file);
  const res = await processImport(buf, "template.xlsx");
  if (!res.ok) {
    console.error("Import falhou:", res.headerErrors);
    process.exit(1);
  }
  // Baixa min_score para liberar geração de mensagens com o template (scores ~20-30)
  db.update(schema.settings)
    .set({ value: "20" })
    .where(eq(schema.settings.key, "min_score_to_generate"))
    .run();

  console.log("Import OK:", JSON.stringify(res.report, null, 2));
  console.log("\nDB:");
  console.log("  clients:", db.select().from(schema.clients).all().length);
  console.log("  boards:", db.select().from(schema.boards).all().length);
  console.log("  rentals:", db.select().from(schema.rentals).all().length);
  console.log("  offers:", db.select().from(schema.conversionOffers).all().length);
  console.log("\nmin_score_to_generate ajustado para 20 (dev only).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
