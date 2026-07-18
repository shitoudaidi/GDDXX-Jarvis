const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

if (!fs.existsSync(electronPath)) {
  console.error(JSON.stringify({ ok: false, error: `Electron executable missing: ${electronPath}` }, null, 2));
  process.exit(1);
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-readiness-endpoint-"));
const child = childProcess.spawn(electronPath, [
  path.join(__dirname, "probe-capability-readiness-node.cjs"),
], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_USER_DIR: userDir,
    JARVIS_USER_DIR: userDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
let parsed = null;
const timeout = setTimeout(() => {
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "readiness endpoint probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-20),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 180000);

function parseResult() {
  if (parsed) return;
  const match = `${stdout}\n${stderr}`.match(/JARVIS_CAPABILITY_READINESS_RESULT\s+(\{[^\r\n]*\})/);
  if (!match) return;
  try { parsed = JSON.parse(match[1]); } catch {}
}

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
  parseResult();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
  parseResult();
});

child.on("exit", async (code) => {
  clearTimeout(timeout);
  parseResult();
  try {
    if (!parsed?.endpoints?.readiness) throw new Error("readiness runner did not report /readiness endpoint status");
    const caps = parsed.capabilities || {};
    const required = ["core", "deepseek", "asr", "tts", "memory", "search", "vector", "seedance", "tools", "social", "security", "traces"];
    const missing = required.filter((key) => !(key in caps));
    const capabilityStates = Object.fromEntries(required.map((key) => {
      if (key === "security") return [key, !!(caps.security?.fileSandbox && caps.security?.execSandbox)];
      return [key, caps[key]?.ready ?? null];
    }));
    const result = {
      ok: code === 0
        && parsed.endpoints.readiness === 200
        && parsed.ok === true
        && Array.isArray(parsed.blockers)
        && missing.length === 0
        && caps.tts?.provider === "jarvis"
        && caps.tts?.localReady === true
        && caps.tts?.systemFallbackAvailable === false
        && caps.deepseek?.ready === false
        && caps.seedance?.ready === false,
      status: parsed.endpoints.readiness,
      missing,
      blockers: parsed.blockers || [],
      capabilities: capabilityStates,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
  }
});
