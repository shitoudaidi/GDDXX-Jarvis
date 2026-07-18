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
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch {}
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
    const text = [
      "火山视频 sk-seedance-probe-abcdefghijklmnopqrstuvwxyz123456 模型 ep-20260622probe",
      "DISCORD_BOT_TOKEN=discord-probe-token-abcdefghijklmnopqrstuvwxyz",
    ].join("\n");
    const intake = await requestJson("/settings/key-intake", {
      method: "POST",
      body: { mode: "auto", text },
    });
    const seedance = await requestJson("/settings/seedance");
    const social = await requestJson("/settings/social");
    const readiness = await requestJson("/readiness");
    const applied = intake.data?.applied || [];
    const result = {
      ok: intake.status === 200
        && applied.some((item) => item.service === "seedance")
        && applied.some((item) => item.service === "social")
        && seedance.data?.seedance?.configured === true
        && seedance.data?.seedance?.model === "ep-20260622probe"
        && social.data?.social?.DISCORD_BOT_TOKEN?.configured === true
        && readiness.data?.capabilities?.seedance?.ready === true
        && readiness.data?.capabilities?.social?.ready === true,
      port,
      intake: { status: intake.status, applied, errors: intake.data?.errors || [] },
      seedance: seedance.data?.seedance,
      social: social.data?.social,
      readiness: {
        status: readiness.status,
        blockers: readiness.data?.blockers || [],
        seedance: readiness.data?.capabilities?.seedance,
        social: readiness.data?.capabilities?.social,
      },
    };
    console.log(`JARVIS_KEY_INTAKE_RESULT ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_KEY_INTAKE_RESULT ${JSON.stringify({ ok: false, port, error: error.message || String(error) })}`);
    process.exit(1);
  }
})();
