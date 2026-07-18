const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function requestJson(port, pathname, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {},
      timeout: options.timeout || 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout ${method} ${pathname}`)));
    if (body) req.write(body);
    req.end();
  });
}

function waitForHttp(port, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await requestJson(port, "/activation-status", { timeout: 1200 });
        if (res.status >= 200 && res.status < 500) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error(`core did not become ready on port ${port}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function waitForBackfill(port, timeoutMs = 45000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const res = await requestJson(port, "/memory/embedding-backfill", { timeout: 3000 });
    last = res.data?.status || null;
    if (last && !last.running && last.finishedAt) return last;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

app.whenReady().then(async () => {
  const port = await findFreePort();
  const userDir = path.join(os.tmpdir(), `jarvis-vector-memory-${Date.now()}`);

  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_DISABLE_SOCIAL = "1";

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp(port);

    const config = await requestJson(port, "/settings/embedding");
    const test = await requestJson(port, "/settings/embedding/test", { method: "POST", body: {} });
    const before = await requestJson(port, "/memory/embedding-stats");
    const start = await requestJson(port, "/memory/embedding-backfill", { method: "POST", body: {} });
    const backfill = await waitForBackfill(port);
    const after = await requestJson(port, "/memory/embedding-stats");

    const dbMod = await import(pathToFileURL(path.join(root, "src", "core", "db.js")).href);
    const embedMod = await import(pathToFileURL(path.join(root, "src", "core", "embedding.js")).href);
    const db = dbMod.getDB();
    const row = db.prepare(`
      SELECT mem_id, title, content
      FROM memories
      WHERE embedding IS NOT NULL AND visibility = 1
      ORDER BY id DESC
      LIMIT 1
    `).get();

    let recall = { ok: false, hitCount: 0, topMemId: null, expectedMemId: row?.mem_id || null };
    if (row) {
      const query = [row.title, row.content].filter(Boolean).join(" ");
      const queryEmbedding = await embedMod.computeEmbedding(query);
      const hits = dbMod.searchByEmbedding(queryEmbedding, 5);
      recall = {
        ok: hits.some((hit) => hit.mem_id === row.mem_id),
        hitCount: hits.length,
        topMemId: hits[0]?.mem_id || null,
        expectedMemId: row.mem_id,
        topScore: hits[0]?._vecScore ?? null,
      };
    }

    const embedding = config.data?.embedding || {};
    const statsBefore = before.data?.stats || {};
    const statsAfter = after.data?.stats || {};
    const result = {
      ok: config.status === 200
        && test.data?.ok === true
        && start.data?.ok === true
        && Number(statsAfter.embedded || 0) > 0
        && recall.ok,
      port,
      runtime: "electron",
      embedding,
      test: {
        ok: !!test.data?.ok,
        dims: test.data?.dims || null,
        elapsedMs: test.data?.elapsedMs || null,
      },
      statsBefore,
      statsAfter,
      backfill,
      recall,
    };

    console.log(`JARVIS_VECTOR_MEMORY_RESULT ${JSON.stringify(result)}`);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_VECTOR_MEMORY_RESULT ${JSON.stringify({
      ok: false,
      port,
      runtime: "electron",
      error: error.message || String(error),
    })}`);
    app.exit(1);
  }
});
