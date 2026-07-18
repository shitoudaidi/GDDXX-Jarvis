const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-config-repair-"));
  try {
    process.env.JARVIS_USER_DIR = userDir;
    process.env.JARVIS_USER_DIR = userDir;
    process.env.JARVIS_RESOURCES_DIR = root;
    process.env.JARVIS_RESOURCES_DIR = root;

    const llmDir = path.join(userDir, "llm");
    fs.mkdirSync(llmDir, { recursive: true });
    fs.writeFileSync(
      path.join(llmDir, "deepseek.json"),
      JSON.stringify({
        provider: "deepseek",
        apiKey: "sk-test-local-config-repair-1234567890",
        model: "deepseek-v4-pro",
        activatedAt: "2026-01-01T00:00:00.000Z",
      }, null, 2),
      "utf8"
    );

    const moduleUrl = `${pathToFileURL(path.join(root, "src", "core", "config.js")).href}?probe=${Date.now()}`;
    const configModule = await import(moduleUrl);
    const status = configModule.getActivationStatus();
    const repairedConfigFile = path.join(userDir, "config.json");
    const repairedConfig = JSON.parse(fs.readFileSync(repairedConfigFile, "utf8"));

    const ok = status.activated === true
      && status.provider === "deepseek"
      && status.model === "deepseek-v4-pro"
      && repairedConfig.provider === "deepseek";

    if (!ok) {
      fail("config repair did not activate DeepSeek from llm/deepseek.json", {
        status: {
          activated: status.activated,
          provider: status.provider,
          model: status.model,
        },
        repairedConfig: {
          provider: repairedConfig.provider,
          schemaVersion: repairedConfig.schemaVersion,
        },
      });
    }

    console.log(JSON.stringify({
      ok: true,
      status: {
        activated: status.activated,
        provider: status.provider,
        model: status.model,
      },
      repairedConfig: {
        provider: repairedConfig.provider,
        schemaVersion: repairedConfig.schemaVersion,
      },
    }, null, 2));
  } catch (error) {
    fail(error.message || String(error));
  } finally {
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
})();
