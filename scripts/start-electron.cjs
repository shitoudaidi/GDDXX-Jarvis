const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

if (!fs.existsSync(electronPath)) {
  console.error("Electron executable was not found in this project.");
  console.error(`Tried: ${electronPath}`);
  console.error("Run npm install first.");
  process.exit(1);
}

const child = childProcess.spawn(electronPath, [
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--use-gl=swiftshader",
  ".",
], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: false
});

console.log(`[Jarvis] Electron runtime: ${electronPath}`);

function stopChild() {
  if (!child.killed) child.kill();
}

process.on("SIGINT", stopChild);
process.on("SIGTERM", stopChild);
process.on("exit", stopChild);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
