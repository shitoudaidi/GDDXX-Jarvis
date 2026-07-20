const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mode = String(process.env.JARVIS_SHORTCUT_MODE || process.argv[2] || "desktop").trim().toLowerCase();
const isWebMode = mode === "web" || mode === "--web";
const target = isWebMode
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")
  : path.join(root, "dist", "win-unpacked", "GDDXX-Jarvis.exe");
const desktop = path.join(os.homedir(), "Desktop");
const linkPath = path.join(desktop, "GDDXX-Jarvis.lnk");
const startMenuLinkPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "GDDXX-Jarvis.lnk"
);
const description = isWebMode
  ? "Jarvis web Agent - source fallback launcher"
  : "Jarvis desktop Agent - current local build";
const argumentsValue = isWebMode
  ? `/c npm.cmd run start:web`
  : "";
const workdir = isWebMode
  ? root
  : path.dirname(target);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    ok: false,
    error: `Packaged Jarvis executable is missing: ${target}`,
    hint: isWebMode ? "Windows cmd.exe was not found." : "Run npm run pack first, or use: npm run shortcut:web"
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(desktop, { recursive: true });
fs.mkdirSync(path.dirname(startMenuLinkPath), { recursive: true });

const command = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($env:JARVIS_SHORTCUT_PATH, $env:JARVIS_START_MENU_SHORTCUT_PATH)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $env:JARVIS_SHORTCUT_TARGET
  $shortcut.Arguments = $env:JARVIS_SHORTCUT_ARGUMENTS
  $shortcut.WorkingDirectory = $env:JARVIS_SHORTCUT_WORKDIR
  $shortcut.IconLocation = $env:JARVIS_SHORTCUT_ICON
  $shortcut.Description = $env:JARVIS_SHORTCUT_DESCRIPTION
  $shortcut.WindowStyle = 1
  $shortcut.Save()
}
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
    JARVIS_START_MENU_SHORTCUT_PATH: startMenuLinkPath,
    JARVIS_SHORTCUT_TARGET: target,
    JARVIS_SHORTCUT_ARGUMENTS: argumentsValue,
    JARVIS_SHORTCUT_WORKDIR: workdir,
    JARVIS_SHORTCUT_ICON: fs.existsSync(path.join(root, "build", "icon.ico"))
      ? path.join(root, "build", "icon.ico")
      : `${target},0`,
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
  mode: isWebMode ? "web" : "desktop",
  shortcut: linkPath,
  startMenuShortcut: startMenuLinkPath,
  target,
  arguments: argumentsValue,
  workingDirectory: workdir,
}, null, 2)}\n`);
