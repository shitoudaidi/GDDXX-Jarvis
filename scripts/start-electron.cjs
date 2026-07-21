const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { checkInstall } = require("./check-install.cjs");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

if (!fs.existsSync(electronPath)) {
  console.error("Electron executable was not found in this project.");
  console.error(`Tried: ${electronPath}`);
  console.error("Run npm install first.");
  process.exit(1);
}

const installCheck = checkInstall({ root });
if (!installCheck.ok) {
  console.error("[Jarvis] Cannot start because the local installation is incomplete:");
  for (const issue of installCheck.issues) console.error(`- ${issue}`);
  console.error("Run npm.cmd run repair:electron, then npm.cmd run rebuild:native.");
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const forceSoftware = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_FORCE_SOFTWARE_RENDERING || ""));
const launchArgs = forceSoftware
  ? ["--disable-gpu", "--disable-gpu-compositing", "--use-gl=swiftshader", "."]
  : ["."];

const child = childProcess.spawn(electronPath, launchArgs, {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
  windowsHide: false
});

console.log(`[Jarvis] Electron runtime: ${electronPath}`);
console.log(`[Jarvis] Rendering: ${forceSoftware ? "software compatibility mode" : "hardware accelerated"}`);

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
