const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

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

function redactSettings(settings) {
  return {
    activated: !!settings?.llm?.activated,
    provider: settings?.llm?.provider || null,
    model: settings?.llm?.model || null,
    thinking: !!settings?.llm?.thinking,
    temperature: settings?.llm?.temperature,
    providers: Object.fromEntries(Object.entries(settings?.providers || {}).map(([id, item]) => [
      id,
      {
        configured: !!item?.configured,
        model: item?.model || item?.defaultModel || "",
      },
    ])),
  };
}

app.whenReady().then(async () => {
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

    const [
      activation,
      status,
      settings,
      voice,
      tts,
      voiceStatus,
      webSearch,
      embedding,
      seedance,
      social,
      security,
      toolCatalog,
      traces,
      readiness,
    ] = await Promise.all([
      requestJson("/activation-status"),
      requestJson("/status"),
      requestJson("/settings"),
      requestJson("/settings/voice"),
      requestJson("/settings/tts"),
      requestJson("/voice/status"),
      requestJson("/settings/web-search"),
      requestJson("/settings/embedding"),
      requestJson("/settings/seedance"),
      requestJson("/settings/social"),
      requestJson("/settings/security"),
      requestJson("/capabilities"),
      requestJson("/admin/traces?limit=1"),
      requestJson("/readiness"),
    ]);

    const result = {
      ...(readiness.data || {}),
      port,
      runtime: "electron",
      settings: redactSettings(settings.data || {}),
      endpoints: {
        activation: activation.status,
        status: status.status,
        settings: settings.status,
        voice: voice.status,
        tts: tts.status,
        voiceStatus: voiceStatus.status,
        webSearch: webSearch.status,
        embedding: embedding.status,
        seedance: seedance.status,
        social: social.status,
        security: security.status,
        capabilities: toolCatalog.status,
        traces: traces.status,
        readiness: readiness.status,
      },
    };

    console.log(`JARVIS_CAPABILITY_READINESS_RESULT ${JSON.stringify(result)}`);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`JARVIS_CAPABILITY_READINESS_RESULT ${JSON.stringify({
      ok: false,
      runtime: "electron",
      port,
      error: error.message || String(error),
    })}`);
    app.exit(1);
  }
});
