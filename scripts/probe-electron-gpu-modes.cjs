const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const childScript = path.join(__dirname, "probe-electron-gpu-mode-child.cjs");

if (!fs.existsSync(electronPath)) {
  console.error(JSON.stringify({ ok: false, error: `Electron executable missing: ${electronPath}` }, null, 2));
  process.exit(1);
}

const modes = [
  { name: "baseline", switches: [] },
  { name: "disable-gpu", switches: ["--disable-gpu", "--disable-gpu-compositing"] },
  { name: "disable-gpu-sandbox", switches: ["--disable-gpu-sandbox"] },
  { name: "disable-gpu-with-gpu-sandbox", switches: ["--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-sandbox"] },
  { name: "swiftshader-gpu-sandbox", switches: ["--disable-gpu-sandbox", "--use-gl=swiftshader"] },
  { name: "software-gl", switches: ["--disable-gpu", "--disable-gpu-compositing", "--use-gl=swiftshader"] },
  { name: "in-process-gpu", switches: ["--in-process-gpu", "--disable-gpu-compositing", "--use-angle=swiftshader"] },
  { name: "single-process", switches: ["--single-process", "--disable-gpu", "--disable-gpu-compositing"] },
  { name: "no-sandbox", switches: ["--no-sandbox", "--disable-gpu", "--disable-gpu-compositing", "--use-gl=swiftshader"] },
];

function runMode(mode) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(electronPath, [...mode.switches, childScript], {
      cwd: root,
      env: {
        ...process.env,
        JARVIS_GPU_MODE: mode.name,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
    }, 20000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      const marker = `${stdout}\n${stderr}`.match(/JARVIS_GPU_MODE_RESULT\s+(\{[^\r\n]*\})/);
      let parsed = null;
      try { parsed = marker ? JSON.parse(marker[1]) : null; } catch {}
      resolve({
        name: mode.name,
        switches: mode.switches,
        code,
        ok: !!parsed?.ok && code === 0,
        parsed,
        stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-6),
      });
    });
  });
}

(async () => {
  const results = [];
  for (const mode of modes) {
    results.push(await runMode(mode));
  }
  console.log(JSON.stringify({ ok: results.some((item) => item.ok), results }, null, 2));
  process.exit(results.some((item) => item.ok) ? 0 : 1);
})();
