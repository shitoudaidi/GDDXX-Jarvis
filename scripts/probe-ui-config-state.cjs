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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ui-config-state-"));
const child = childProcess.spawn(electronPath, [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--use-gl=swiftshader",
  ".",
], {
  cwd: root,
  env: {
    ...process.env,
    JARVIS_DESKTOP_PROBE: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_USER_DIR: userDir,
    JARVIS_USER_DIR: userDir,
    JARVIS_RESOURCES_DIR: root,
    JARVIS_RESOURCES_DIR: root,
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
    error: "UI config state probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-20),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 180000);

function parseResult() {
  if (parsed) return;
  const match = `${stdout}\n${stderr}`.match(/JARVIS_DESKTOP_PROBE_RESULT\s+(\{.*\})/);
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

child.on("exit", (code) => {
  clearTimeout(timeout);
  parseResult();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  if (!parsed) {
    console.error(JSON.stringify({
      ok: false,
      error: "desktop probe marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-20),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
    }, null, 2));
    process.exit(1);
    return;
  }

  const tokens = Object.fromEntries((parsed.capabilities || []).map((item) => [item.label, item]));
  const issues = parsed.issues || [];
  const result = {
    ok: parsed.ok === true
      && tokens.DeepSeek?.on === false
      && tokens.DeepSeek?.value === "SET"
      && tokens.TTS?.on === true
      && tokens.TTS?.value === "SYSTEM"
      && tokens.Social?.on === false
      && tokens.Social?.value === "SET"
      && issues.some((text) => text.includes("DeepSeek 未激活"))
      && issues.some((text) => text.includes("Seedance")),
    tokens,
    issues,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
});
