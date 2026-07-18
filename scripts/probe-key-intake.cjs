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

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-key-intake-"));
const child = childProcess.spawn(electronPath, [
  path.join(__dirname, "probe-key-intake-node.cjs"),
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
const timeout = setTimeout(() => {
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "key intake probe timeout",
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-20),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 120000);

child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

child.on("exit", (code) => {
  clearTimeout(timeout);
  const match = `${stdout}\n${stderr}`.match(/JARVIS_KEY_INTAKE_RESULT\s+(\{[^\r\n]*\})/);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  if (!match) {
    console.error(JSON.stringify({
      ok: false,
      error: "key intake result marker missing",
      code,
      stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-20),
      stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
    }, null, 2));
    process.exit(1);
  }
  const result = JSON.parse(match[1]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
});
