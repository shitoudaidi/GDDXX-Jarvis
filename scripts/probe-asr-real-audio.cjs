const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

const port = Number(process.env.JARVIS_PORT || 3721);
const url = process.argv[2] || `ws://127.0.0.1:${port}/voice/cloud`;
const provider = process.argv[3] || "local";
const timeoutMs = Number(process.argv[4] || 30000);
const phrase = process.argv[5] || "\u6d4b\u8bd5\u8bed\u97f3\u8bc6\u522b"; // 测试语音识别

function fail(stage, detail = {}) {
  console.log(JSON.stringify({ ok: false, stage, ...detail }, null, 2));
  process.exit(1);
}

function generateWindowsSpeechWav(file, text) {
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('Microsoft Huihui Desktop') } catch {}
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:JARVIS_ASR_WAV, $fmt)
$s.Speak($env:JARVIS_ASR_TEXT)
$s.Dispose()
`;
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    env: { ...process.env, JARVIS_ASR_WAV: file, JARVIS_ASR_TEXT: text },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail("speech-synthesis", { error: (result.stderr || result.stdout || "").trim() });
  }
}

function readWavPcm(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    fail("wav-parse", { error: "not a RIFF/WAVE file" });
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "data") return buf.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  fail("wav-parse", { error: "data chunk missing" });
}

function pcmRms(pcm) {
  let sumSquares = 0;
  let samples = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 8) {
    const sample = pcm.readInt16LE(offset);
    sumSquares += sample * sample;
    samples += 1;
  }
  return samples ? Math.round(Math.sqrt(sumSquares / samples)) : 0;
}

async function run() {
  if (process.platform !== "win32") fail("unsupported-platform", { platform: process.platform });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-asr-real-"));
  const wavFile = path.join(dir, "sample.wav");
  generateWindowsSpeechWav(wavFile, phrase);
  const pcm = readWavPcm(wavFile);

  const result = await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const transcripts = [];
    const diags = [];
    const errors = [];
    let sent = false;
    let finished = false;
    let settleTimer = null;

    const done = (ok, stage, extra = {}) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      try { ws.close(); } catch {}
      resolve({
        ok,
        stage,
        provider,
        phrase,
        audio: { bytes: pcm.length, seconds: Number((pcm.length / 2 / 16000).toFixed(2)), rms: pcmRms(pcm) },
        transcripts,
        diags,
        errors,
        ...extra,
      });
    };

    const timer = setTimeout(() => {
      done(false, "timeout", { timeoutMs });
    }, timeoutMs);

    const sendAudio = () => {
      if (sent) return;
      sent = true;
      const chunkBytes = 4096;
      let offset = 0;
      const tick = () => {
        if (finished) return;
        if (offset >= pcm.length) {
          setTimeout(() => {
            try { ws.send(JSON.stringify({ type: "flush" })); } catch {}
            settleTimer = setTimeout(() => {
              done(transcripts.length > 0, transcripts.length > 0 ? "transcript" : "no-transcript");
            }, 2200);
          }, 450);
          return;
        }
        try { ws.send(pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length))); } catch {}
        offset += chunkBytes;
        setTimeout(tick, 128);
      };
      tick();
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "config", provider, lang: "zh" }));
    });
    ws.on("message", (raw) => {
      let msg = null;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "diag") {
        diags.push({ event: msg.event || "", info: msg.info || null });
        if (msg.event === "cloud-asr-armed" || msg.event === "task-started" || msg.event === "local-asr-selected") sendAudio();
      } else if (msg.type === "transcript") {
        if (String(msg.text || "").trim()) {
          transcripts.push({ text: msg.text, final: !!msg.is_final, seg: msg.seg || null });
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => done(true, "transcript"), msg.is_final ? 300 : 1400);
        }
      } else if (msg.type === "error") {
        errors.push(msg.message || "unknown ASR error");
        done(false, "error");
      }
    });
    ws.on("error", (error) => done(false, "socket-error", { error: error.message }));
    ws.on("close", () => {
      if (!finished) done(transcripts.length > 0, transcripts.length > 0 ? "closed-with-transcript" : "closed");
    });
  });

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

run().catch((error) => fail("unexpected", { error: error.message }));
