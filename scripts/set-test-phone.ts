import { db, schema } from "../server/db/index.js";

db.update(schema.clients).set({ phone: "+4740346834" }).run();
const all = db.select().from(schema.clients).all();
console.log("clients updated:", all.length);
for (const c of all) console.log("  ", c.name, "→", c.phone);
