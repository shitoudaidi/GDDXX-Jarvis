const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = {
  main: path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"),
  voiceCore: path.join(root, "src", "ui", "voice", "voice-core.js"),
  voicePanel: path.join(root, "src", "ui", "voice", "voice-panel.js"),
  wakePhrase: path.join(root, "src", "ui", "voice", "wake-phrase.js"),
  api: path.join(root, "src", "core", "api.js"),
};

function numericConstant(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  return match ? Number(match[1].replaceAll("_", "")) : NaN;
}

(async () => {
  const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
  const wakeModuleUrl = `data:text/javascript;base64,${Buffer.from(source.wakePhrase, "utf8").toString("base64")}`;
  const { isWakePhrase, normalizeWakeText, WAKE_PHRASE_FIXTURES } = await import(wakeModuleUrl);
  const conversationThreshold = numericConstant(source.api, "ASR_SPEECH_RMS_THRESHOLD");
  const wakeThreshold = numericConstant(source.api, "ASR_WAKE_RMS_THRESHOLD");
  const conversationPreroll = numericConstant(source.api, "ASR_PREROLL_MAX_CHUNKS");
  const wakePreroll = numericConstant(source.api, "ASR_WAKE_PREROLL_MAX_CHUNKS");

  const checks = [
    {
      name: "standby ASR uses bilingual wake mode",
      ok: /__JARVIS_INTERFACE_MODE__\s*=\s*interfaceMode/.test(source.main)
        && /mode\s*=\s*window\.__JARVIS_INTERFACE_MODE__\s*===\s*'standby'\s*\?\s*'wake'\s*:\s*'conversation'/.test(source.voiceCore)
        && /mode\s*===\s*'wake'\s*\?\s*'zh,en'/.test(source.voiceCore),
    },
    {
      name: "wake mode starts from quieter speech",
      ok: Number.isFinite(wakeThreshold) && wakeThreshold <= 140 && wakeThreshold < conversationThreshold,
      detail: `wake=${wakeThreshold}, conversation=${conversationThreshold}`,
    },
    {
      name: "wake mode keeps longer preroll",
      ok: Number.isFinite(wakePreroll) && wakePreroll >= 20 && wakePreroll > conversationPreroll,
      detail: `wake=${wakePreroll}, conversation=${conversationPreroll}`,
    },
    {
      name: "all positive wake fixtures match",
      ok: WAKE_PHRASE_FIXTURES.accepted.every((text) => isWakePhrase(text, { loose: true })),
      detail: WAKE_PHRASE_FIXTURES.accepted.filter((text) => !isWakePhrase(text, { loose: true })).join(", "),
    },
    {
      name: "unrelated names do not trigger wake",
      ok: WAKE_PHRASE_FIXTURES.rejected.every((text) => !isWakePhrase(text, { loose: true })),
      detail: WAKE_PHRASE_FIXTURES.rejected.filter((text) => isWakePhrase(text, { loose: true })).join(", "),
    },
    {
      name: "time-of-day greetings and traditional Chinese are covered",
      ok: isWakePhrase("早上好，贾维斯", { loose: true }) && isWakePhrase("晚上好，賈維斯", { loose: true }),
    },
    {
      name: "punctuation and spacing normalize consistently",
      ok: normalizeWakeText(" Hi,  Jarvis! ") === "hijarvis" && isWakePhrase("Hi, Jar vis!", { loose: true }),
    },
    {
      name: "risky English hypotheses require a greeting",
      ok: !isWakePhrase("Travis", { loose: true }) && isWakePhrase("Hello Travis", { loose: true }),
    },
    {
      name: "wake finalization gives short phrases more time",
      ok: /wakeMode\s*\?\s*4200\s*:\s*2600/.test(source.voicePanel),
    },
    {
      name: "microphone startup and fallback errors remain diagnosable",
      ok: /diagLastError\s*=\s*`\$\{e\?\.name/.test(source.voiceCore)
        && /diag\('mic-start-error'/.test(source.voiceCore)
        && /diag\('mic-fallback-error'/.test(source.voiceCore),
    },
  ];

  console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
  if (checks.some((check) => !check.ok)) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
