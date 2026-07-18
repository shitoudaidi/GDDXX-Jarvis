const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");
const { WebSocket } = require("ws");

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
      timeout: options.timeout || 3000,
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

function probeWs(port) {
  return new Promise((resolve) => {
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/voice/cloud`);
    const finish = (result) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve({ ...result, events });
    };
    const timer = setTimeout(() => finish({ ok: false, error: "ASR route probe timeout" }), 8000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "config", provider: "aliyun", lang: "zh" }));
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        events.push(msg);
        if (msg.type === "diag" && msg.event === "local-asr-selected") {
          finish({ ok: true, selected: "local", requestedProvider: msg.info?.requestedProvider || null });
        } else if (msg.type === "error" && /api key|未配置/i.test(msg.message || "")) {
          finish({ ok: false, error: msg.message, selected: "cloud" });
        }
      } catch {}
    });
    ws.on("error", (err) => finish({ ok: false, error: err.message }));
  });
}

app.whenReady().then(async () => {
  const port = await findFreePort();
  const userDir = path.join(os.tmpdir(), `jarvis-asr-route-${Date.now()}`);

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
  process.env.JARVIS_ASR_ROUTE_PROBE = "1";

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp(port);
    const route = await probeWs(port);
    const status = await requestJson(port, "/voice/status");
    const result = {
      ok: route.ok,
      port,
      runtime: "electron",
      route,
      voiceStatus: status.data?.voice || null,
    };
    console.log(`JARVIS_ASR_ROUTE_PROBE_RESULT ${JSON.stringify(result)}`);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_ASR_ROUTE_PROBE_RESULT ${JSON.stringify({ ok: false, port, runtime: "electron", error: error.message || String(error) })}`);
    app.exit(1);
  }
});
