const fs = require("fs");
const path = require("path");

function checkWebInstall({ root = path.resolve(__dirname, "..") } = {}) {
  const issues = [];
  try {
    const Database = require(path.join(root, "node_modules", "better-sqlite3"));
    const db = new Database(":memory:");
    db.close();
  } catch (error) {
    issues.push(`better-sqlite3 is not usable under the current Node.js runtime. Run npm.cmd run rebuild:web. Output: ${String(error && error.message || error).slice(0, 800)}`);
  }
  return { ok: issues.length === 0, issues };
}

if (require.main === module) {
  const result = checkWebInstall();
  if (result.ok) {
    console.log(`[Jarvis] web install check passed: Node ${process.version}`);
    process.exit(0);
  }
  console.error("[Jarvis] web install check failed:");
  for (const issue of result.issues) console.error(`- ${issue}`);
  process.exit(1);
}

module.exports = { checkWebInstall };
