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
  path.join(__dirname, "probe-core-runtime-electron.cjs"),
], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let errorOutput = "";
let settled = false;
const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "probe timeout",
    stdoutTail: output.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: errorOutput.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  process.exit(1);
}, 120000);

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  output += text;
  process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  errorOutput += text;
  process.stderr.write(text);
});

child.on("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (signal) process.exit(1);
  process.exit(code || 0);
});
