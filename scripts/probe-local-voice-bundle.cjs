const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const python = path.join(root, ".venv", "Scripts", "python.exe");
const whisperModel = path.join(root, "models", "whisper", "tiny.pt");
const ttsModel = path.join(root, "models", "jarvis", "en", "en_GB", "jarvis", "high", "jarvis-high.onnx");

const checks = [
  ["bundled Python runtime", fs.existsSync(python)],
  ["Whisper tiny model", fs.existsSync(whisperModel) && fs.statSync(whisperModel).size > 50 * 1024 * 1024],
  ["Jarvis TTS model", fs.existsSync(ttsModel) && fs.statSync(ttsModel).size > 100 * 1024 * 1024],
];

if (fs.existsSync(python)) {
  const imports = childProcess.spawnSync(python, ["-c", "import torch, whisper, websockets; print('ok')"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  checks.push(["local ASR Python dependencies", imports.status === 0 && /ok/.test(imports.stdout || "")]);
}

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
