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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-desktop-close-"));
const startedAt = Date.now();
const child = childProcess.spawn(electronPath, ["."], {
  cwd: root,
  env: {
    ...process.env,
    JARVIS_DESKTOP_CLOSE_PROBE: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_SKIP_STARTUP_SELF_CHECK: "1",
    JARVIS_USER_DIR: userDir,
    JARVIS_RESOURCES_DIR: root,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let ready = false;
let settled = false;

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "desktop close probe timeout",
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 60_000);

const capture = (chunk) => {
  const text = chunk.toString("utf8");
  output += text;
  if (text.includes("JARVIS_DESKTOP_CLOSE_PROBE_READY")) ready = true;
};
child.stdout.on("data", capture);
child.stderr.on("data", capture);

child.on("exit", (code) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  const result = {
    ok: ready && code === 0,
    ready,
    code,
    elapsedMs: Date.now() - startedAt,
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-20),
  };
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
});
