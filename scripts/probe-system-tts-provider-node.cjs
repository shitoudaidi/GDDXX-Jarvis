const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");
const port = Number(process.env.JARVIS_PORT || process.env.JARVIS_PORT || (39000 + Math.floor(Math.random() * 20000)));

process.env.JARVIS_HOST = "127.0.0.1";
process.env.JARVIS_HOST = "127.0.0.1";
process.env.JARVIS_PORT = String(port);
process.env.JARVIS_PORT = String(port);
process.env.JARVIS_RESOURCES_DIR = root;
process.env.JARVIS_RESOURCES_DIR = root;
process.env.JARVIS_DISABLE_SOCIAL = "1";
process.env.JARVIS_DISABLE_SOCIAL = "1";
process.env.DOUBAO_TTS_API_KEY = "";
process.env.DOUBAO_TTS_ACCESS_KEY = "";
process.env.DOUBAO_TTS_APP_ID = "";

function requestJson(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      timeout: options.timeout || 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch {}
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout GET ${pathname}`)));
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
      if (Date.now() - started > timeoutMs) return reject(new Error(`core did not become ready on port ${port}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

(async () => {
  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp();
    const tts = await requestJson("/settings/tts");
    const readiness = await requestJson("/readiness");
    const ttsCfg = tts.data?.tts || {};
    const caps = readiness.data?.capabilities || {};
    const blockers = readiness.data?.blockers || [];
    const result = {
      ok: tts.status === 200
        && readiness.status === 200
        && ttsCfg.ttsProvider === "system"
        && ttsCfg.ttsVoiceId === "default"
        && ttsCfg.systemKey?.configured === true
        && caps.tts?.provider === "system"
        && caps.tts?.nativeReady === true
        && blockers.every((item) => !String(item).includes("Cloud TTS")),
      port,
      tts: {
        status: tts.status,
        provider: ttsCfg.ttsProvider,
        voiceId: ttsCfg.ttsVoiceId,
        systemKey: !!ttsCfg.systemKey?.configured,
      },
      readiness: {
        status: readiness.status,
        tts: caps.tts,
        blockers,
      },
    };
    console.log(`JARVIS_SYSTEM_TTS_PROVIDER_RESULT ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_SYSTEM_TTS_PROVIDER_RESULT ${JSON.stringify({ ok: false, port, error: error.message || String(error) })}`);
    process.exit(1);
  }
})();
