const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");

function requestJson(port, pathname, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: {
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
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

function waitForHttp(port, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await requestJson(port, "/activation-status", { timeout: 1200 });
        if (res.status >= 200 && res.status < 500) return resolve(res);
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

function waitForSseConnected(port, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/events",
      method: "GET",
      headers: { accept: "text/event-stream" },
      timeout: timeoutMs,
    });
    let settled = false;
    let buf = "";
    const done = (error, payload) => {
      if (settled) return;
      settled = true;
      req.destroy();
      error ? reject(error) : resolve(payload);
    };
    req.on("response", (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const match = buf.match(/data:\s*(\{[^\n]+\})/);
        if (match) {
          try { done(null, JSON.parse(match[1])); } catch (error) { done(error); }
        }
      });
    });
    req.on("timeout", () => done(new Error("SSE connected event timeout")));
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
    req.end();
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function summarizeEndpoint(name, res) {
  return {
    name,
    status: res.status,
    ok: res.status >= 200 && res.status < 300 && (res.data?.ok !== false),
    data: res.data,
  };
}

function summarizeMessageGate(name, res, activation) {
  const inactive = activation.data?.activated === false;
  return {
    name,
    status: res.status,
    ok: inactive
      ? res.status === 409 && res.data?.code === "LLM_NOT_ACTIVATED"
      : res.status >= 200 && res.status < 300 && res.data?.ok !== false,
    data: res.data,
  };
}

app.whenReady().then(async () => {
  const port = await findFreePort();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-core-probe-"));
  const logs = [];
  const oldLog = console.log;
  const oldWarn = console.warn;
  const oldError = console.error;
  const record = (level, args) => {
    logs.push(`${level} ${args.map((arg) => {
      if (typeof arg === "string") return arg;
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }).join(" ")}`);
  };
  console.log = (...args) => { record("log", args); oldLog(...args); };
  console.warn = (...args) => { record("warn", args); oldWarn(...args); };
  console.error = (...args) => { record("error", args); oldError(...args); };

  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_DISABLE_SOCIAL = "1";

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp(port);

    const activation = await requestJson(port, "/activation-status");
    const status = await requestJson(port, "/status");
    const settings = await requestJson(port, "/settings");
    const voice = await requestJson(port, "/settings/voice");
    const tts = await requestJson(port, "/settings/tts");
    const webSearch = await requestJson(port, "/settings/web-search");
    const embedding = await requestJson(port, "/settings/embedding");
    const seedance = await requestJson(port, "/settings/seedance");
    const memories = await requestJson(port, "/memories?limit=3");
    const sse = await waitForSseConnected(port);
    const message = await requestJson(port, "/message", {
      method: "POST",
      body: {
        from_id: "ID:probe",
        channel: "PROBE",
        content: "health probe message",
        strict_evaluation: true,
        forbidden_tools: ["send_message"],
      },
    });

    const checks = [
      summarizeEndpoint("activation-status", activation),
      summarizeEndpoint("status", status),
      summarizeEndpoint("settings", settings),
      summarizeEndpoint("settings/voice", voice),
      summarizeEndpoint("settings/tts", tts),
      summarizeEndpoint("settings/web-search", webSearch),
      summarizeEndpoint("settings/embedding", embedding),
      summarizeEndpoint("settings/seedance", seedance),
      { ...summarizeEndpoint("memories", memories), ok: memories.status === 200 && Array.isArray(memories.data) },
      { name: "events", ok: sse.type === "connected", data: sse },
      summarizeMessageGate("message", message, activation),
    ];
    const ok = checks.every((check) => check.ok);
    console.log(JSON.stringify({
      ok,
      runtime: "electron",
      electron: process.versions.electron,
      node: process.versions.node,
      port,
      userDir,
      checks,
      logTail: logs.slice(-16),
    }, null, 2));
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      runtime: "electron",
      electron: process.versions.electron,
      node: process.versions.node,
      port,
      userDir,
      error: error.message || String(error),
      logTail: logs.slice(-30),
    }, null, 2));
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    app.exit(1);
  }
});
