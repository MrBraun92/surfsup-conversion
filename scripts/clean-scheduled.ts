import { db, schema } from "../server/db/index.js";
import { eq, inArray } from "drizzle-orm";

// Pega todas as offers Scheduled (ou PendingApproval) e reseta
const targets = db
  .select()
  .from(schema.conversionOffers)
  .where(inArray(schema.conversionOffers.status, ["Scheduled", "PendingApproval", "Draft", "Sent"]))
  .all();

console.log("Resetando", targets.length, "offers e suas messages...");
for (const o of targets) {
  db.delete(schema.messages).where(eq(schema.messages.offerId, o.id)).run();
  db.update(schema.conversionOffers)
    .set({ status: "NoOffer", scheduledFor: null, offerExpiresAt: null })
    .where(eq(schema.conversionOffers.id, o.id))
    .run();
}

// Limpa também notifications de missing_chat_id antigas
db.delete(schema.notifications)
  .where(eq(schema.notifications.type, "missing_chat_id:1"))
  .run();

console.log("Done. Estado atual:");
const offers = db.select().from(schema.conversionOffers).all();
for (const o of offers) console.log("  offer", o.id, "status:", o.status, "score:", o.score);
const msgs = db.select().from(schema.messages).all();
console.log("messages restantes:", msgs.length);
