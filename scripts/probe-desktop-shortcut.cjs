const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const expectedTarget = path.join(root, "dist", "win-unpacked", "Jarvis.exe");
const linkPath = path.join(os.homedir(), "Desktop", "Jarvis.lnk");

function readShortcut() {
  const command = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($env:JARVIS_SHORTCUT_PATH)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine((@{
  target = $shortcut.TargetPath
  arguments = $shortcut.Arguments
  workingDirectory = $shortcut.WorkingDirectory
  iconLocation = $shortcut.IconLocation
  description = $shortcut.Description
} | ConvertTo-Json -Compress))
`;
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ], {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_SHORTCUT_PATH: linkPath,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`read shortcut failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

if (!fs.existsSync(linkPath)) {
  console.error(JSON.stringify({ ok: false, error: `Shortcut missing: ${linkPath}` }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(expectedTarget)) {
  console.error(JSON.stringify({ ok: false, error: `Expected target missing: ${expectedTarget}` }, null, 2));
  process.exit(1);
}

let shortcut;
try {
  shortcut = readShortcut();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
  process.exit(1);
}

const targetMatches = path.resolve(shortcut.target || "") === path.resolve(expectedTarget);
const workdirMatches = path.resolve(shortcut.workingDirectory || "") === path.resolve(path.dirname(expectedTarget));

if (!targetMatches || !workdirMatches) {
  console.error(JSON.stringify({
    ok: false,
    error: "Desktop shortcut does not point at the current packaged Jarvis build.",
    shortcut,
    expectedTarget,
    expectedWorkingDirectory: path.dirname(expectedTarget),
  }, null, 2));
  process.exit(1);
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-shortcut-probe-"));
const child = childProcess.spawn(shortcut.target, [], {
  cwd: shortcut.workingDirectory || path.dirname(shortcut.target),
  env: {
    ...process.env,
    JARVIS_DESKTOP_PROBE: "1",
    JARVIS_DISABLE_SOCIAL: "1",
    JARVIS_USER_DIR: userDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
let parsedResult = null;
let settled = false;

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  try { child.kill(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: "desktop shortcut probe timeout",
    shortcut,
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, 180000);

function capture(text, targetStream) {
  const match = text.match(/JARVIS_DESKTOP_PROBE_RESULT\s+(\{.*\})/);
  if (match) {
    try { parsedResult = JSON.parse(match[1]); } catch {}
  }
  targetStream.write(text);
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
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  const result = {
    ok: code === 0 && parsedResult?.ok === true,
    code,
    shortcut,
    probe: parsedResult,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
});
