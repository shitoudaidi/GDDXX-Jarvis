const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "dist", "win-unpacked", "Jarvis.exe");
const desktop = path.join(os.homedir(), "Desktop");
const linkPath = path.join(desktop, "Jarvis.lnk");
const description = "Jarvis desktop Agent - current local build";

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    ok: false,
    error: `Packaged Jarvis executable is missing: ${target}`,
    hint: "Run npm run pack first."
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(desktop, { recursive: true });

const command = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($env:JARVIS_SHORTCUT_PATH)
$shortcut.TargetPath = $env:JARVIS_SHORTCUT_TARGET
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $env:JARVIS_SHORTCUT_WORKDIR
$shortcut.IconLocation = "$env:JARVIS_SHORTCUT_TARGET,0"
$shortcut.Description = $env:JARVIS_SHORTCUT_DESCRIPTION
$shortcut.WindowStyle = 1
$shortcut.Save()
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
    JARVIS_SHORTCUT_TARGET: target,
    JARVIS_SHORTCUT_WORKDIR: path.dirname(target),
    JARVIS_SHORTCUT_DESCRIPTION: description,
  },
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  console.error(JSON.stringify({
    ok: false,
    error: "failed to create desktop shortcut",
    stdout: result.stdout,
    stderr: result.stderr,
  }, null, 2));
  process.exit(result.status || 1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  shortcut: linkPath,
  target,
  workingDirectory: path.dirname(target),
}, null, 2)}\n`);
