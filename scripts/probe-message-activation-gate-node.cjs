const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");
let port = Number(process.env.JARVIS_PORT || process.env.JARVIS_PORT || 0);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

function requestJson(pathname, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: body ? {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      } : {},
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

function waitForHttp(timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await requestJson("/activation-status", { timeout: 1200 });
        if (res.status >= 200 && res.status < 500) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`core did not become ready on port ${port}`));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

(async () => {
  if (!port) port = await findFreePort();

  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_RESOURCES_DIR = root;

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp();

    const beforeStatus = await requestJson("/status");
    const activation = await requestJson("/activation-status");
    const message = await requestJson("/message", {
      method: "POST",
      body: {
        from_id: "ID:000001",
        channel: "TUI",
        content: "message should not enter queue while llm is inactive",
      },
    });
    const afterStatus = await requestJson("/status");

    const beforeQueue = beforeStatus.data?.queue || {};
    const afterQueue = afterStatus.data?.queue || {};
    const result = {
      ok: activation.data?.activated === false
        && message.status === 409
        && message.data?.code === "LLM_NOT_ACTIVATED"
        && beforeQueue.user === afterQueue.user
        && beforeQueue.background === afterQueue.background,
      port,
      runtime: "electron-node",
      activation: activation.data || null,
      message: { status: message.status, data: message.data },
      beforeQueue,
      afterQueue,
    };

    console.log(`JARVIS_MESSAGE_GATE_RESULT ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`JARVIS_MESSAGE_GATE_RESULT ${JSON.stringify({
      ok: false,
      port,
      runtime: "electron-node",
      error: error.message || String(error),
    })}`);
    process.exit(1);
  }
})();
