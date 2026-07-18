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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-work-modules-"));
const child = childProcess.spawn(electronPath, [
  path.join(__dirname, "probe-work-modules-node.cjs"),
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
let settled = false;

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "work modules probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 120000);

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  stdout += text;
  process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  stderr += text;
  process.stderr.write(text);
});

child.on("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  if (signal) process.exit(1);
  process.exit(code || 0);
});
