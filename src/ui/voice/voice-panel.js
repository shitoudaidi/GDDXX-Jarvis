// voice-panel.js —— 语音面板编排层
//
// 组装共享会话引擎（voice-core）+ 两个模式策略（常开 voice-continuous / 按住空格 voice-ptt），
// Exposes initVoicePanel + window.jarvisVoice for TTS interruption and media coordination.
//
// 解耦结构：
//   voice-core.js       共享机制——点云渲染 + 麦克风采集 + ASR 传输/转录 + 会话生命周期
//   voice-continuous.js  常开策略——自动断句发送 + barge-in 打断检测（会话默认策略）
//   voice-ptt.js         PTT 策略——按住门控 + 松手立即发送（在常开策略之上叠加）
//
// 改一个模式的策略只动对应文件，底层机制集中在 core；两模式共用同一个 core 会话，
// 以保持「常开在跑时按空格 = 强制立即发一次」的叠加语义。

import { createVoiceCore } from './voice-core.js';
import { createContinuousPolicy } from './voice-continuous.js';
import { createPttController } from './voice-ptt.js';

export function initVoicePanel({
  btnId, panelId, canvasId, statusId, transcriptId,
  getChatInput, getSendBtn, getSendMessage, getLang, getAutoSend, getAutoMic, getSingleTurn,
}) {
  const btn        = document.getElementById(btnId);
  const panel      = document.getElementById(panelId);
  const canvas     = document.getElementById(canvasId);
  const status     = document.getElementById(statusId);
  const transcript = document.getElementById(transcriptId);

  if (!panel || !canvas) return;

  // ─── 组装 core + 两个模式策略 ───
  const core = createVoiceCore({ canvas, transcript, getChatInput, getSendMessage, getLang });
  const continuous = createContinuousPolicy(core, { getAutoSend, getSingleTurn, finishVoiceTurn: finishCurrentVoiceTurn });
  let finishingVoiceTurn = false;

  const STATUS_TEXT = {
    idle: '正在监听',
    listening: '正在监听',
    recognizing: '正在识别',
    processing: '正在发送',
    speaking: '正在播报',
    done: '已识别',
    error: '语音错误',
    event: '语音事件',
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function describeNoTranscript(diag = {}) {
    if (diag.lastError) return `语音识别错误：${diag.lastError}`;
    if (!diag.chunks || !diag.bytes) {
      return '没有采集到麦克风音频。请检查系统输入设备、麦克风权限，或重新选择默认麦克风。';
    }
    if ((diag.peakVol || 0) < 0.006) {
      return `麦克风输入过低或接近静音。当前峰值 ${diag.peakVol || 0}，请检查输入音量或换一个麦克风。`;
    }
    if (!diag.transcripts) {
      return `ASR 已收到音频但没有返回文字。麦克风：${diag.micLabel || '默认输入'}，云端事件：${diag.lastCloudEvent || '未返回'}`;
    }
    return '未收到可发送的识别文本，请再说一次。';
  }

  function reportVoiceProblem(message, diagnostics = {}) {
    try {
      window.dispatchEvent(new CustomEvent('jarvis:voice-error', {
        detail: {
          message,
          diagnostics: {
            captureMode: diagnostics.captureMode,
            chunks: diagnostics.chunks,
            bytes: diagnostics.bytes,
            transcripts: diagnostics.transcripts,
            peakVol: diagnostics.peakVol,
            lastVol: diagnostics.lastVol,
            micLabel: diagnostics.micLabel,
            micReadyState: diagnostics.micReadyState,
            cloudReadyState: diagnostics.cloudReadyState,
            lastCloudEvent: diagnostics.lastCloudEvent,
            lastError: diagnostics.lastError,
            durationMs: diagnostics.durationMs,
          }
        }
      }));
    } catch {}
  }

  function syncVoiceUi(statusText = '') {
    const active = core.micActive || core.userWantedMic;
    const monitoring = core.monitorActive;
    const sk = core.getStatus?.() || 'idle';
    const text = statusText || (active ? (STATUS_TEXT[sk] || '正在监听') : monitoring ? '麦克风待命，点击开始对话' : '点击麦克风开始');
    btn?.classList.toggle('active', active);
    if (status) status.textContent = text;
    window.dispatchEvent(new CustomEvent('jarvis:voice-state', {
      detail: {
        active,
        micActive: core.micActive,
        wanted: core.userWantedMic,
        monitoring,
        status: sk,
        statusText: text
      }
    }));
  }

  async function finishCurrentVoiceTurn() {
    if (finishingVoiceTurn) return false;
    finishingVoiceTurn = true;
    try {
      continuous.cancelAutoSend();
      core.setStatus('processing');
      core.flushAsr?.();
      // Wake phrases are short and often arrive in several cloud-ASR packets. Give the
      // standby recognizer a wider finalization window than a normal conversation turn.
      const wakeMode = window.__JARVIS_INTERFACE_MODE__ === 'standby';
      const waitUntil = Date.now() + (wakeMode ? 4200 : 2600);
      let text = (core.getText?.() || '').trim();
      while (!text && Date.now() < waitUntil) {
        await sleep(120);
        text = (core.getText?.() || '').trim();
      }
      if (text) {
        core.sendRecognizedVoiceText();
        if (getSingleTurn?.() !== false) core.stopSession({ keepMonitor: window.__JARVIS_INTERFACE_MODE__ === 'active' });
        else core.setStatus('listening');
        syncVoiceUi();
        return true;
      }

      const diagnostics = core.getDiagnostics?.() || {};
      const reason = describeNoTranscript(diagnostics);
      reportVoiceProblem(reason, diagnostics);
      if (diagnostics.selectedMicDeviceId && (!diagnostics.chunks || (diagnostics.peakVol || 0) < 0.006)) {
        core.clearSelectedMicDevice?.();
      }
      core.stopSession({ keepMonitor: window.__JARVIS_INTERFACE_MODE__ === 'active' });
      if (transcript) transcript.textContent = reason;
      syncVoiceUi('语音未识别');
      setTimeout(() => {
        if (!core.micActive && transcript?.textContent === reason) {
          transcript.textContent = '';
          syncVoiceUi();
        }
      }, 2400);
      return false;
    } finally {
      finishingVoiceTurn = false;
    }
  }

  // 常开会话开关：点球/按钮触发，也被 PTT 在「mic 未开」时复用（保持叠加语义）
  async function toggleVoice() {
    if (!core.micActive) {
      // startSession 内部已处理失败回退 + 状态同步
      const started = Boolean(await core.startSession());
      syncVoiceUi();
      return started;
    }
    await finishCurrentVoiceTurn();
    return false;
  }

  const ptt = createPttController(core, {
    toggleVoice,
    cancelAutoSend: continuous.cancelAutoSend,
  });

  // 安装模式策略钩子：continuous = 会话默认策略；PTT 通过 core.pttHolding 在其上叠加。
  core.setOnFrame(continuous.onFrame);
  core.setOnTranscript(continuous.onTranscript);
  core.setOnSessionStop(continuous.onSessionStop);
  core.setOnSuspendForTTS(continuous.onSuspendForTTS);
  core.setOnResume(continuous.onResume);
  // 会话状态变化 → 同步按钮高亮（mic 开着或用户保留了开麦意图时高亮）
  core.setOnState(syncVoiceUi);

  window.jarvisVoice = {
    isActive: () => core.micActive,
    // 视频/音乐模式：完全停止 mic（不需要打断能力）
    suspendForMedia: () => core.suspendForMedia(),
    // TTS 模式：只停云端 ASR WebSocket，保持 mic 硬件 + ScriptProcessor，开启打断预缓冲
    suspendForTTS: () => core.suspendForTTS(),
    // TTS 正常结束：清掉续播计时再恢复会话
    resumeAfterMedia: () => {
      continuous.clearNoSpeechTimer();
      if (getSingleTurn?.() !== false) {
        core.stopSession({ keepMonitor: window.__JARVIS_INTERFACE_MODE__ === 'active' });
        return;
      }
      core.resumeSession(false);
    },
    resumeMicAfterTTS: () => {
      window.jarvisVoice.resumeAfterMedia();
    },
    stop: () => core.stopSession(),
    enterPassiveMode: () => core.stopSession({ keepMonitor: true }),
    ensureMonitor: () => core.startMonitor(),
    isMonitoring: () => core.monitorActive,
    getDiagnostics: () => core.getDiagnostics?.(),
    clearSelectedMicDevice: () => core.clearSelectedMicDevice?.(),
    setTTSAnalyser: (analyser) => core.setTTSAnalyser(analyser),
    resetTranscriptAccumulation: () => {
      continuous.cancelAutoSend();
      core.resetTranscriptAccumulation();
      core.setText('');
    },
    pttStart: ptt.pttStart,
    pttEnd: ptt.pttEnd,
  };

  window.addEventListener('jarvis:video-mode', (event) => {
    if (event.detail?.active) {
      window.jarvisVoice.suspendForMedia();
    } else {
      window.jarvisVoice.resumeAfterMedia();
    }
  });

  window.addEventListener('jarvis:music-mode', (event) => {
    if (event.detail?.active) {
      window.jarvisVoice.suspendForMedia();
    } else {
      window.jarvisVoice.resumeAfterMedia();
    }
  });

  // ─── 面板初始化 ───
  function openPanel() {
    panel.hidden = false;
    core.startRenderLoop();
  }

  btn?.addEventListener('click', toggleVoice);
  canvas.addEventListener('click', toggleVoice);

  core.setStatus('idle');
  openPanel();
  syncVoiceUi();
  if (getAutoMic?.()) toggleVoice();
}
