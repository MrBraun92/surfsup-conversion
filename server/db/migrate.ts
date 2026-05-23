import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_URL ?? "./data/surfsup.db";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const migrationsDir = path.resolve("drizzle");
const files = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  : [];

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const applied = new Set(
  sqlite.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name),
);

for (const file of files) {
  if (applied.has(file)) {
    console.log(`[migrate] skip ${file}`);
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  console.log(`[migrate] apply ${file}`);
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(sql);
    sqlite.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    sqlite.exec("COMMIT");
  } catch (e) {
    sqlite.exec("ROLLBACK");
    console.error(`[migrate] FAIL ${file}`, e);
    process.exit(1);
  }
}

console.log("[migrate] done");
sqlite.close();
