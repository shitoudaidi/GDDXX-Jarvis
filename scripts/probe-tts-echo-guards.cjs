const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = {
  main: path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"),
  uiCore: path.join(root, "src", "ui", "voice", "voice-core.js"),
  uiContinuous: path.join(root, "src", "ui", "voice", "voice-continuous.js"),
  uiPanel: path.join(root, "src", "ui", "voice", "voice-panel.js"),
  ttsProviders: path.join(root, "src", "core", "voice", "tts-providers.js"),
  api: path.join(root, "src", "core", "api.js"),
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));

const checks = [
  {
    name: "UI remembers spoken TTS text",
    file: files.main,
    ok: /rememberSpokenText/.test(source.main) && /lastSpokenTextRef/.test(source.main) && /lastSpokenAtRef/.test(source.main),
  },
  {
    name: "UI filters likely self echo before sending",
    file: files.main,
    ok: /isLikelySelfEcho/.test(source.main) && /normalizeEchoText/.test(source.main),
  },
  {
    name: "UI filters active TTS text before voice send",
    file: files.main,
    ok: /ttsIsActive/.test(source.main) && /ttsCurrentTextRef/.test(source.main) && /currentSegment/.test(source.main) && /SELF_ECHO_GUARD_MS/.test(source.main),
  },
  {
    name: "UI blocks duplicate voice submissions",
    file: files.main,
    ok: /lastVoiceSendTextRef/.test(source.main)
      && /VOICE_REPEAT_GUARD_MS\s*=\s*8_000/.test(source.main)
      && /now - lastVoiceSend\.at < VOICE_REPEAT_GUARD_MS/.test(source.main)
      && /setVoiceStatusText\("已忽略重复语音/.test(source.main),
  },
  {
    name: "UI filters known ASR hallucination noise",
    file: files.main,
    ok: source.main.includes("function isAsrEchoNoise")
      && source.main.includes("chinese(?:light|like|lite|right)")
      && /已忽略语音回声或噪声/.test(source.main),
  },
  {
    name: "Backend ignores repeated or hallucinated voice messages",
    file: files.api,
    ok: /VOICE_MESSAGE_REPEAT_GUARD_MS\s*=\s*8_000/.test(source.api)
      && /getVoiceMessageIgnore/.test(source.api)
      && /ignored:\s*true/.test(source.api),
  },
  {
    name: "UI handles backend ignored voice responses",
    file: files.main,
    ok: /sent\?\.ignored/.test(source.main) && /已忽略重复语音/.test(source.main),
  },
  {
    name: "UI blocks post-TTS speaker echo fragments",
    file: files.main,
    ok: /VOICE_POST_TTS_BLOCK_MS/.test(source.main)
      && /voiceBlockedUntilRef/.test(source.main)
      && /now < voiceBlockedUntilRef\.current/.test(source.main),
  },
  {
    name: "Wake sequence enters passive monitoring after narration",
    file: files.main,
    ok: /WAKE_LISTEN_DELAY_MS\s*=\s*1000/.test(source.main)
      && /playWakeSequence = useCallback/.test(source.main)
      && /postWakeListenRef\.current = window\.setTimeout/.test(source.main)
      && /resumeMicAfterTTS\(\)/.test(source.main)
      && /系统检查完成，点击麦克风开始对话/.test(source.main),
  },
  {
    name: "UI suspends microphone during TTS",
    file: files.main,
    ok: /suspendForTTS/.test(source.main) && /resumeMicAfterTTS/.test(source.main),
  },
  {
    name: "UI routes Jarvis TTS through audio graph and output sink",
    file: files.main,
    ok: /attachJarvisAudioGraph/.test(source.main)
      && /resumeJarvisAudioContext/.test(source.main)
      && /setTTSAnalyser/.test(source.main)
      && /applyOutputSink/.test(source.main),
  },
  {
    name: "Voice bridge exposes transcript reset used by UI echo guard",
    file: files.uiPanel,
    ok: /resetTranscriptAccumulation:\s*\(\)\s*=>/.test(source.uiPanel) && /continuous\.cancelAutoSend/.test(source.uiPanel),
  },
  {
    name: "Voice core supports passive microphone monitoring without ASR",
    file: files.uiCore,
    ok: /let monitorActive = false/.test(source.uiCore)
      && /async function startMonitor\(\)/.test(source.uiCore)
      && /startMonitor,/.test(source.uiCore)
      && /get monitorActive/.test(source.uiCore),
  },
  {
    name: "Passive monitoring is exposed separately from the conversation button",
    file: files.uiPanel,
    ok: /enterPassiveMode/.test(source.uiPanel)
      && /ensureMonitor/.test(source.uiPanel)
      && /isMonitoring/.test(source.uiPanel),
  },
  {
    name: "Continuous policy cancels queued auto-send during TTS",
    file: files.uiContinuous,
    ok: /function onSuspendForTTS\(\)\s*{[\s\S]*?cancelAutoSend\(\)/.test(source.uiContinuous) && /if \(core\.suspendedByMedia\) return/.test(source.uiContinuous),
  },
  {
    name: "Jarvis voice shell is single-turn by default",
    file: files.main,
    ok: /getSingleTurn:\s*\(\)\s*=>\s*true/.test(source.main)
      && /interfaceMode/.test(source.main)
      && /isWakePhrase/.test(source.main),
  },
  {
    name: "Continuous policy returns to passive monitoring after a single turn",
    file: files.uiContinuous,
    ok: /getSingleTurn/.test(source.uiContinuous) && /core\.sendRecognizedVoiceText\(\);\s*if \(getSingleTurn\?\.\(\) !== false\) \{\s*core\.stopSession\(\{ keepMonitor:/.test(source.uiContinuous),
  },
  {
    name: "Voice bridge closes recognition but keeps passive microphone monitoring",
    file: files.uiPanel,
    ok: /resumeAfterMedia:\s*\(\)\s*=>\s*{[\s\S]*?getSingleTurn\?\.\(\)\s*!==\s*false[\s\S]*?core\.stopSession\(\{ keepMonitor:/.test(source.uiPanel)
      && /enterPassiveMode/.test(source.uiPanel),
  },
  {
    name: "UI requires a button press for the next recognized turn",
    file: files.main,
    ok: /markVoiceReadyForNextTurn\("tts"\)/.test(source.main)
      && /schedulePostReplyListen/.test(source.main)
      && /麦克风待命，点击按钮开始对话/.test(source.main)
      && !/1 秒后继续聆听/.test(source.main),
  },
  {
    name: "Voice bridge forwards single-turn option",
    file: files.uiPanel,
    ok: /getSingleTurn/.test(source.uiPanel)
      && /createContinuousPolicy\(core,\s*\{[\s\S]*?getAutoSend[\s\S]*?getSingleTurn[\s\S]*?\}\)/.test(source.uiPanel),
  },
  {
    name: "Voice core drops PCM immediately after TTS",
    file: files.uiCore,
    ok: /dropPcmUntil/.test(source.uiCore) && /TTS_RESUME_PCM_GUARD_MS/.test(source.uiCore),
  },
  {
    name: "Voice core drops transcripts immediately after TTS",
    file: files.uiCore,
    ok: /dropTranscriptUntil/.test(source.uiCore) && /TTS_RESUME_TRANSCRIPT_GUARD_MS/.test(source.uiCore) && /suspendedByMedia && bargeinBuffering/.test(source.uiCore),
  },
  {
    name: "Backend Jarvis local TTS provider exists",
    file: files.ttsProviders,
    ok: /id:\s*'jarvis'/.test(source.ttsProviders)
      && /streamJarvisTTS/.test(source.ttsProviders)
      && /jarvis-high/.test(source.ttsProviders),
  },
  {
    name: "Backend TTS stream does not auto-fallback to system",
    file: files.api,
    ok: !/fallbackProvider = 'system'/.test(source.api) && !/X-Jarvis-TTS-Fallback/.test(source.api),
  },
];

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  checks: checks.map((check) => ({
    name: check.name,
    ok: check.ok,
    file: path.relative(root, check.file).replace(/\\/g, "/"),
  })),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
