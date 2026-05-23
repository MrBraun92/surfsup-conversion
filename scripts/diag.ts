import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

console.log("=== Settings ===");
const set = db.select().from(schema.settings).all();
for (const s of set) {
  const v = s.key.includes("token") ? (s.value ? `***${s.value.slice(-6)}` : "(vazio)") : s.value;
  console.log("  ", s.key, "=", v);
}

console.log("\n=== Clientes (chat_id) ===");
const cs = db.select().from(schema.clients).all();
for (const c of cs) {
  console.log("  ", c.name, "| phone:", c.phone, "| telegramChatId:", c.telegramChatId ?? "(vazio)");
}

console.log("\n=== Offers ===");
const offers = db.select().from(schema.conversionOffers).all();
for (const o of offers) {
  console.log("  offer", o.id, "rentalId:", o.rentalId, "status:", o.status,
    "score:", o.score, "scheduledFor:", o.scheduledFor ? new Date(o.scheduledFor * 1000).toISOString() : null);
}

console.log("\n=== Messages ===");
const ms = db.select().from(schema.messages).all();
for (const m of ms) {
  console.log("  msg", m.id, "offer:", m.offerId, "approved:", m.approved,
    "sentAt:", m.sentAt ? new Date(m.sentAt * 1000).toISOString() : "(não enviado)",
    "tgMsgId:", m.telegramMessageId ?? "—", "response:", m.response ?? "—");
}
