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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-desktop-e2e-"));
const env = {
  ...process.env,
  JARVIS_DESKTOP_PROBE: "1",
  JARVIS_DISABLE_SOCIAL: "1",
  JARVIS_USER_DIR: userDir,
  JARVIS_RESOURCES_DIR: root,
};

const child = childProcess.spawn(electronPath, [
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--use-gl=swiftshader",
  ".",
], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
let parsedResult = null;

const timeout = setTimeout(() => {
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "desktop e2e probe timeout",
    userDir,
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 180000);

function capture(text, target) {
  const match = text.match(/JARVIS_DESKTOP_PROBE_RESULT\s+(\{.*\})/);
  if (match) {
    try { parsedResult = JSON.parse(match[1]); } catch {}
  }
  target.write(text);
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
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  if (!parsedResult) {
    console.error(JSON.stringify({
      ok: false,
      error: "desktop e2e result marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2));
    process.exit(1);
    return;
  }
  process.exit(code || (parsedResult.ok ? 0 : 1));
});
