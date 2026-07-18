const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

if (!fs.existsSync(electronPath)) {
  console.error(JSON.stringify({ ok: false, error: `Electron executable missing: ${electronPath}` }, null, 2));
  process.exit(1);
}

const child = childProcess.spawn(electronPath, [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--use-gl=swiftshader",
  path.join(__dirname, "probe-asr-routing-electron.cjs"),
], {
  cwd: root,
  env: {
    ...process.env,
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_ASR_ROUTE_PROBE: "1",
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
    error: "ASR route probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  process.exit(1);
}, 60000);

function parseResult() {
  if (parsed) return;
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/JARVIS_ASR_ROUTE_PROBE_RESULT\s+(\{[^\r\n]*\})/);
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
  if (!parsed) {
    console.error(JSON.stringify({
      ok: false,
      error: "ASR route probe result marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2));
    process.exit(1);
    return;
  }
  process.exit(code || (parsed.ok ? 0 : 1));
});
