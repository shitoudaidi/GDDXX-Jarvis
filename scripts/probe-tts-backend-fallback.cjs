const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

if (!fs.existsSync(electronPath)) {
  console.error(JSON.stringify({ ok: false, error: `Electron executable missing: ${electronPath}` }, null, 2));
  process.exit(1);
}

const child = childProcess.spawn(electronPath, [path.join(__dirname, "probe-tts-backend-fallback-node.cjs")], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    DOUBAO_TTS_API_KEY: "",
    DOUBAO_TTS_ACCESS_KEY: "",
    DOUBAO_TTS_APP_ID: "",
    MINIMAX_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
let parsed = null;
let printedResult = false;
const verbose = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_PROBE_VERBOSE || ""));
const timeout = setTimeout(() => {
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "Jarvis local TTS backend probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  process.exit(1);
}, 120000);

function parseResult() {
  if (parsed) return;
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/JARVIS_TTS_BACKEND_NO_FALLBACK_RESULT\s+(\{[^\r\n]*\})/);
  if (!match) return;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return;
  }
  if (!printedResult) {
    printedResult = true;
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
  }
}

function capture(text, stream) {
  parseResult();
  if (verbose) stream.write(text);
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  stdout += text;
  capture(text, process.stdout);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  stderr += text;
  capture(text, process.stderr);
});

child.on("exit", (code) => {
  clearTimeout(timeout);
  parseResult();
  if (!parsed) {
    console.error(JSON.stringify({
      ok: false,
      error: "Jarvis local TTS backend result marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2));
    process.exit(1);
    return;
  }
  process.exit(code || (parsed.ok ? 0 : 1));
});
