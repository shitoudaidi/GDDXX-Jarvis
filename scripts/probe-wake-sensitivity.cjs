const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = {
  main: path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"),
  voiceCore: path.join(root, "src", "ui", "voice", "voice-core.js"),
  api: path.join(root, "src", "core", "api.js"),
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")])
);

function numericConstant(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  return match ? Number(match[1].replaceAll("_", "")) : NaN;
}

const conversationThreshold = numericConstant(source.api, "ASR_SPEECH_RMS_THRESHOLD");
const wakeThreshold = numericConstant(source.api, "ASR_WAKE_RMS_THRESHOLD");
const conversationPreroll = numericConstant(source.api, "ASR_PREROLL_MAX_CHUNKS");
const wakePreroll = numericConstant(source.api, "ASR_WAKE_PREROLL_MAX_CHUNKS");

const checks = [
  {
    name: "standby UI labels ASR sessions as wake mode",
    ok: /__JARVIS_INTERFACE_MODE__\s*=\s*interfaceMode/.test(source.main)
      && /__JARVIS_INTERFACE_MODE__\s*===\s*'standby'\s*\?\s*'wake'\s*:\s*'conversation'/.test(source.voiceCore)
      && /makeCloudAsrConfig\(getLang\)/.test(source.voiceCore),
  },
  {
    name: "wake mode starts ASR from quieter speech",
    ok: Number.isFinite(wakeThreshold)
      && Number.isFinite(conversationThreshold)
      && wakeThreshold <= 140
      && wakeThreshold < conversationThreshold
      && /rms\s*>=\s*activationThreshold/.test(source.api),
    detail: `wake=${wakeThreshold}, conversation=${conversationThreshold}`,
  },
  {
    name: "wake mode retains a longer phrase preroll",
    ok: Number.isFinite(wakePreroll)
      && Number.isFinite(conversationPreroll)
      && wakePreroll >= 20
      && wakePreroll > conversationPreroll
      && /preroll\.length\s*>\s*prerollMaxChunks/.test(source.api),
    detail: `wake=${wakePreroll} chunks, conversation=${conversationPreroll} chunks`,
  },
  {
    name: "wake matcher covers common Jarvis misrecognitions",
    ok: ["jervis", "travis", "贾威斯", "贾伟思", "佳维斯", "家维斯", "贾维", "加维"]
      .every((token) => source.main.includes(`"${token}"`)),
  },
  {
    name: "normal conversation keeps its original ASR threshold",
    ok: conversationThreshold === 240
      && /recognitionMode\s*===\s*'wake'\s*\?\s*ASR_WAKE_RMS_THRESHOLD\s*:\s*ASR_SPEECH_RMS_THRESHOLD/.test(source.api),
  },
  {
    name: "standby microphone rearms after an idle session",
    ok: /interfaceModeRef\.current\s*===\s*"standby"\s*&&\s*!wakeAcceptedRef\.current\)\s*scheduleWakeListen\(\)/.test(source.main),
  },
  {
    name: "wake finalization gives short phrases a wider cloud-ASR window",
    ok: /wakeMode\s*=\s*window\.__JARVIS_INTERFACE_MODE__\s*===\s*'standby'/.test(fs.readFileSync(files.voiceCore.replace('voice-core.js', 'voice-panel.js'), 'utf8'))
      && /wakeMode\s*\?\s*4200\s*:\s*2600/.test(fs.readFileSync(files.voiceCore.replace('voice-core.js', 'voice-panel.js'), 'utf8')),
  },
  {
    name: "standby wake matcher covers 扎维斯 variants",
    ok: ["扎维思", "扎维司", "扎维"].every((token) => source.main.includes(`"${token}"`)),
  },
];

console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);
