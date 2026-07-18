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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-message-gate-"));
const child = childProcess.spawn(electronPath, [
  path.join(__dirname, "probe-message-activation-gate-node.cjs"),
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
    error: "message activation gate probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 180000);

function parseResult() {
  if (parsed) return;
  const match = `${stdout}\n${stderr}`.match(/JARVIS_MESSAGE_GATE_RESULT\s+(\{[^\r\n]*\})/);
  if (!match) return;
  try {
    parsed = JSON.parse(match[1]);
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
  } catch {}
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
      error: "message activation gate result marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2));
    process.exit(1);
    return;
  }
  process.exit(code || (parsed.ok ? 0 : 1));
});
