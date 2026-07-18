const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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

function requestAudio(port, pathname, body) {
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
      timeout: 45000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          length: buffer.length,
          magic: buffer.slice(0, 4).toString("ascii"),
          bodyText: res.statusCode >= 400 ? buffer.toString("utf8").slice(0, 300) : "",
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout POST ${pathname}`)));
    req.write(payload);
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

(async () => {
  const port = await findFreePort();
  const userDir = path.join(os.tmpdir(), `jarvis-tts-local-${Date.now()}`);

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
  process.env.DOUBAO_TTS_API_KEY = "";
  process.env.DOUBAO_TTS_ACCESS_KEY = "";
  process.env.DOUBAO_TTS_APP_ID = "";
  process.env.MINIMAX_API_KEY = "";

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp(port);

    const settings = await requestJson(port, "/settings/tts");
    const audio = await requestAudio(port, "/tts/stream", {
      text: "Systems online, sir.",
    });
    const tts = settings.data?.tts || {};
    const result = {
      ok: audio.status === 200
        && audio.magic === "RIFF"
        && Number(audio.length || 0) > 1000
        && !audio.headers["x-jarvis-tts-fallback"]
        && tts.ttsProvider === "jarvis",
      port,
      runtime: "node",
      ttsProvider: tts.ttsProvider,
      systemFallbackAvailable: !!tts.systemFallbackAvailable,
      audio,
    };
    console.log(`JARVIS_TTS_BACKEND_NO_FALLBACK_RESULT ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_TTS_BACKEND_NO_FALLBACK_RESULT ${JSON.stringify({
      ok: false,
      port,
      runtime: "node",
      error: error.message || String(error),
    })}`);
    process.exit(1);
  }
})();
