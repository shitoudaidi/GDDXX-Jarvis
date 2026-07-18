const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = {
  main: path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"),
  voiceContinuous: path.join(root, "src", "ui", "voice", "voice-continuous.js"),
  voiceCore: path.join(root, "src", "ui", "voice", "voice-core.js"),
  api: path.join(root, "src", "core", "api.js"),
};

const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
const checks = [
  {
    name: "No browser speechSynthesis fallback in product shell",
    file: files.main,
    ok: !/speechSynthesis/.test(source.main),
  },
  {
    name: "Duplicate spoken reply guard is active",
    file: files.main,
    ok: /SELF_ECHO_GUARD_MS/.test(source.main)
      && /lastSpokenTextRef\.current === text/.test(source.main)
      && /lastSpokenAtRef\.current/.test(source.main),
  },
  {
    name: "New TTS playback cancels previous audio first",
    file: files.main,
    ok: /stopTTSPlayback\(\);\s*ttsIsActiveRef\.current = true/s.test(source.main),
  },
  {
    name: "TTS playback suspends live ASR and reconnects analyser",
    file: files.main,
    ok: /suspendForTTS/.test(source.main)
      && /setTTSAnalyser/.test(source.main)
      && /markVoiceReadyForNextTurn\("tts"\)/.test(source.main),
  },
  {
    name: "Post-TTS speaker echo fragments are blocked before send",
    file: files.main,
    ok: /VOICE_POST_TTS_BLOCK_MS/.test(source.main)
      && /voiceBlockedUntilRef/.test(source.main)
      && /now < voiceBlockedUntilRef\.current/.test(source.main),
  },
  {
    name: "Repeated voice text is blocked for a long window",
    file: files.main,
    ok: /VOICE_REPEAT_GUARD_MS\s*=\s*10\s*\*\s*60_000/.test(source.main)
      && /lastVoiceSend\.text === normalized/.test(source.main)
      && /已忽略重复语音/.test(source.main),
  },
  {
    name: "Known ASR hallucination phrase is filtered",
    file: files.main,
    ok: /\^\(chinese\(light\|like\|lite\|right\)\)\{1,3\}\$/.test(source.main)
      && /sent\?\.ignored/.test(source.main),
  },
  {
    name: "Backend blocks repeated voice text after app restart",
    file: files.api,
    ok: /VOICE_MESSAGE_REPEAT_GUARD_MS\s*=\s*10\s*\*\s*60_000/.test(source.api)
      && /getVoiceMessageIgnore/.test(source.api)
      && /duplicate_voice/.test(source.api)
      && /ignored:\s*true/.test(source.api),
  },
  {
    name: "Wake feedback leaves the mic closed",
    file: files.main,
    ok: /const playWakeFeedback = useCallback\(\(\) =>/.test(source.main)
      && !/listenAfter && interfaceModeRef\.current === "active" && startVoiceListening/.test(source.main),
  },
  {
    name: "Voice policy ends single-turn speech after silence",
    file: files.voiceContinuous,
    ok: /SILENCE_FINISH_MS/.test(source.voiceContinuous)
      && /finishVoiceTurn/.test(source.voiceContinuous)
      && /speech-silence/.test(source.voiceContinuous),
  },
  {
    name: "Voice core suppresses transcripts during media/TTS",
    file: files.voiceCore,
    ok: /suppressIncomingTranscripts/.test(source.voiceCore)
      && /suspendedByMedia/.test(source.voiceCore),
  },
];

const result = {
  ok: checks.every((check) => check.ok),
  checks,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
