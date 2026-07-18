const path = require("node:path");
const Database = require("better-sqlite3");

const runtimeRoot = process.env.JARVIS_USER_DIR
  || path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(), "JarvisLocalAgent");
const dbFile = process.env.JARVIS_DB_PATH || path.join(runtimeRoot, "data", "jarvis.db");
const limit = Math.max(1, Math.min(Number(process.argv[2] || 120), 500));
const db = new Database(dbFile, { readonly: true });

console.log(`DB ${dbFile}`);
const rows = db.prepare(`
  SELECT id, role, from_id, to_id, channel, timestamp, content
  FROM conversations
  ORDER BY id DESC
  LIMIT ?
`).all(limit).reverse();

for (const row of rows) {
  const content = String(row.content || "").replace(/\s+/g, " ").slice(0, 260);
  console.log([row.id, row.timestamp, row.role, row.channel, content].join("\t"));
}

const hits = db.prepare(`
  SELECT id, role, channel, timestamp, content
  FROM conversations
  WHERE lower(content) LIKE '%chinese%' OR lower(content) LIKE '%light%'
  ORDER BY id DESC
  LIMIT 30
`).all().reverse();

console.log("\nHITS");
for (const row of hits) {
  const content = String(row.content || "").replace(/\s+/g, " ").slice(0, 300);
  console.log([row.id, row.timestamp, row.role, row.channel, content].join("\t"));
}

db.close();
