const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { checkWebInstall } = require("./check-web-install.cjs");

const root = path.resolve(__dirname, "..");
const jarvisHome = path.resolve(process.env.JARVIS_HOME || path.join(root, ".jarvis-data"));
const userDir = path.resolve(process.env.JARVIS_USER_DIR || path.join(jarvisHome, "runtime", "jarvis"));
const host = process.env.JARVIS_HOST || "127.0.0.1";
const port = Number(process.env.JARVIS_PORT || 3721);
const url = `http://${host}:${port}/`;

fs.mkdirSync(jarvisHome, { recursive: true });
fs.mkdirSync(userDir, { recursive: true });

const installCheck = checkWebInstall({ root });
if (!installCheck.ok) {
  console.error("[Jarvis] Cannot start web mode because the Node.js installation is incomplete:");
  for (const issue of installCheck.issues) console.error(`- ${issue}`);
  console.error("Run npm.cmd run rebuild:web, then npm.cmd run start:web again.");
  process.exit(1);
}

function waitForServer(deadlineMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(`${url}status`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    }
    function retry() {
      if (Date.now() - startedAt > deadlineMs) {
        reject(new Error(`Jarvis web server did not become ready at ${url}`));
        return;
      }
      setTimeout(probe, 500);
    }
    probe();
  });
}

const env = {
  ...process.env,
  JARVIS_HOME: jarvisHome,
  JARVIS_USER_DIR: userDir,
  JARVIS_RESOURCES_DIR: root,
  JARVIS_HOST: host,
  JARVIS_PORT: String(port),
};
delete env.ELECTRON_RUN_AS_NODE;

const child = childProcess.spawn(process.execPath, [path.join(root, "src", "core", "index.js")], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false
});

console.log(`[Jarvis] Web mode starting: ${url}`);
console.log(`[Jarvis] User data: ${userDir}`);

waitForServer()
  .then(() => {
    console.log(`[Jarvis] Opening ${url}`);
    childProcess.spawn("cmd.exe", ["/c", "start", "", url], {
      cwd: root,
      stdio: "ignore",
      detached: true,
      windowsHide: true
    }).unref();
  })
  .catch((error) => {
    console.error(`[Jarvis] ${error.message || String(error)}`);
  });

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
