const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, ".cache", "electron-builder");
fs.mkdirSync(cacheDir, { recursive: true });

const cli = path.join(root, "node_modules", "electron-builder", "cli.js");
const args = process.argv.slice(2);
const localElectronDist = path.join(root, "node_modules", "electron", "dist");
if (fs.existsSync(path.join(localElectronDist, "electron.exe"))) {
  args.push(`--config.electronDist=${localElectronDist}`);
}
const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: cacheDir,
    CSC_IDENTITY_AUTO_DISCOVERY: "false"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
