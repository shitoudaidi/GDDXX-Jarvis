import { applyOutputSink } from "./audio-output.js";

let cachedUrl = "";

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function makeWakeBuffer() {
  const sampleRate = 48000;
  const duration = 0.62;
  const frames = Math.floor(sampleRate * duration);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const twoPi = Math.PI * 2;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const env = (t, start, attack, hold, release) => {
    const x = t - start;
    if (x < 0) return 0;
    if (x < attack) return x / attack;
    if (x < attack + hold) return 1;
    if (x < attack + hold + release) return 1 - (x - attack - hold) / release;
    return 0;
  };

  let seed = 0x51f15e;
  let noiseL = 0;
  let noiseR = 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff * 2 - 1;
  };

  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const rise = env(t, 0.01, 0.18, 0.16, 0.24);
    const lock = env(t, 0.25, 0.012, 0.025, 0.22);
    const resolve = env(t, 0.29, 0.08, 0.07, 0.2);
    const subFreq = 44 + 34 * Math.min(1, t / 0.36);
    const sub = Math.sin(twoPi * subFreq * t) * rise * 0.16;
    const core = (
      Math.sin(twoPi * (104 + 220 * t) * t) * 0.09 +
      Math.sin(twoPi * (208 + 440 * t) * t + 0.35) * 0.045
    ) * rise;

    noiseL += (random() - noiseL) * 0.055;
    noiseR += (random() - noiseR) * 0.052;
    const airShape = Math.pow(Math.min(1, t / 0.36), 1.6) * env(t, 0, 0.06, 0.34, 0.18);
    const airL = (random() - noiseL) * airShape * 0.038;
    const airR = (random() - noiseR) * airShape * 0.038;

    const impact = Math.sin(twoPi * (64 - 24 * Math.min(1, Math.max(0, t - 0.25) / 0.18)) * t) * lock * 0.25;
    const shimmerL = (
      Math.sin(twoPi * 523.25 * t) +
      Math.sin(twoPi * 659.25 * t + 0.3) * 0.72 +
      Math.sin(twoPi * 783.99 * t + 0.7) * 0.5
    ) * resolve * 0.035;
    const shimmerR = (
      Math.sin(twoPi * 523.25 * t + 0.18) +
      Math.sin(twoPi * 659.25 * t + 0.56) * 0.72 +
      Math.sin(twoPi * 783.99 * t + 0.92) * 0.5
    ) * resolve * 0.035;

    left[i] = clamp(Math.tanh((sub + core + impact + airL + shimmerL) * 1.45));
    right[i] = clamp(Math.tanh((sub + core * 0.96 + impact + airR + shimmerR) * 1.45));
  }

  const delays = [0.035, 0.075, 0.13].map((s) => Math.floor(s * sampleRate));
  for (let i = frames - 1; i >= 0; i -= 1) {
    for (let d = 0; d < delays.length; d += 1) {
      const from = i - delays[d];
      if (from >= 0) {
        left[i] += right[from] * [0.16, 0.09, 0.045][d];
        right[i] += left[from] * [0.16, 0.09, 0.045][d];
      }
    }
    left[i] = clamp(left[i] * 0.82);
    right[i] = clamp(right[i] * 0.82);
  }

  const channels = 2;
  const bytes = 44 + frames * channels * 2;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, frames * channels * 2, true);
  for (let i = 0; i < frames; i += 1) {
    view.setInt16(44 + i * 4, clamp(left[i]) * 32767, true);
    view.setInt16(46 + i * 4, clamp(right[i]) * 32767, true);
  }
  return buffer;
}

export async function playWakeTransitionSfx() {
  if (!cachedUrl) cachedUrl = URL.createObjectURL(new Blob([makeWakeBuffer()], { type: "audio/wav" }));
  const audio = new Audio(cachedUrl);
  audio.volume = 0.38;
  await applyOutputSink(audio).catch(() => {});
  await audio.play();
  return new Promise((resolve) => {
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
  });
}
