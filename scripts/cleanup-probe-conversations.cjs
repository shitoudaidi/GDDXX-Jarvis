const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..");

function uniqueExistingFiles(files) {
  const seen = new Set();
  const result = [];
  for (const file of files) {
    if (!file) continue;
    const resolved = path.resolve(file);
    const key = resolved.toLowerCase();
    if (seen.has(key) || !fs.existsSync(resolved)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function candidateDbFiles() {
  return uniqueExistingFiles([
    process.env.JARVIS_DB_PATH,
    process.env.JARVIS_USER_DIR ? path.join(process.env.JARVIS_USER_DIR, "data", "jarvis.db") : "",
    process.env.JARVIS_USER_DIR ? path.join(process.env.JARVIS_USER_DIR, "data", "jarvis.db") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "JarvisLocalAgent", "data", "jarvis.db") : "",
    path.join(root, "data", "jarvis.db"),
  ]);
}

const patterns = [
  "%geoResult is not defined%",
  "%ReferenceError%",
  "%1783603209131%",
  "%1783603242288%",
  "%1783603274622%",
  "%\u94fe\u8def\u6d4b\u8bd5%",
  "%\u6838\u5fc3\u5bf9\u8bdd\u94fe\u8def\u6d4b\u8bd5%",
  "%\u5bf9\u8bdd\u94fe\u8def\u6b63\u5e38%",
  "%\u5bf9\u8bdd\u6b63\u5e38%",
  "%??????????????%",
  "%\u8fd8\u662f\u4e71\u7801%",
  "%\u8bed\u97f3\u8f93\u5165\u88ab\u7f16\u7801\u6210%",
  "%\u8bf7\u53ea\u56de\u590d\uff1a\u5bf9\u8bdd\u6b63\u5e38%",
];
const probeFromIds = [
  "probe-dialogue",
];

function cleanupDb(dbFile) {
  const db = new Database(dbFile);
  const where = [
    ...patterns.map(() => "content LIKE ?"),
    ...probeFromIds.map(() => "from_id = ?"),
    ...probeFromIds.map(() => "to_id = ?"),
  ].join(" OR ");
  const args = [...patterns, ...probeFromIds, ...probeFromIds];
  const rows = db.prepare(`SELECT id, role, content FROM conversations WHERE ${where} ORDER BY id`).all(...args);

  const removeRows = db.transaction(() => {
    const stmt = db.prepare("DELETE FROM conversations WHERE id = ?");
    for (const row of rows) stmt.run(row.id);
  });

  removeRows();
  const remaining = db.prepare(`SELECT COUNT(*) AS count FROM conversations WHERE ${where}`).get(...args).count;
  db.close();

  return {
    dbFile,
    deleted: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: String(row.content || "").slice(0, 100),
    })),
    remaining,
  };
}

const results = candidateDbFiles().map(cleanupDb);

console.log(JSON.stringify({
  ok: results.every((result) => result.remaining === 0),
  results,
}, null, 2));

process.exit(results.every((result) => result.remaining === 0) ? 0 : 1);
