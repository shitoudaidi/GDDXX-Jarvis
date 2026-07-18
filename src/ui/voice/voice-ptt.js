// voice-ptt.js —— 按住空格说话（Push-To-Talk）模式策略
//
// 按下 → 开麦 / 从 TTS 恢复；松开 → flush + 立即发送。按住期间通过 core.pttHolding
// 屏蔽常开策略的自动发送，由 pttEnd 在松手时统一发送。
//
// 「叠加」语义：常开会话正在跑时按空格，不重开麦克风、只「强制立即发一次」
// （pttStart 走 micActive no-op 分支，pttEnd 对同一会话 flush+send，不停麦）。
// 底层会话由 core 持有；本控制器只做门控 + 松手发送策略。
//
// 依赖（由编排层 voice-panel.js 注入）：
//   toggleVoice()    常开会话开关（开麦 + 接 ASR）——与点球/按钮共用同一入口
//   cancelAutoSend() 取消常开策略已排程的自动发送计时器

export function createPttController(core, { toggleVoice, cancelAutoSend }) {
  // press → 开 mic / 从 TTS 恢复，release → 立即发送
  let pttStartedMic = false;

  async function pttStart() {
    // 让 release 时不会发出旧的累积识别结果
    core.pttHolding = true;
    core.setText('');
    // 同时清掉上一段未定稿的 interim，否则恰好碰上 WS 重连时它会被提级进 committed
    core.clearPendingInterim?.();
    cancelAutoSend?.();
    // 上一次松手发送可能还在「吞尾」窗口内；这是一次新的说话意图，立刻解除，
    // 否则新一句的开头转录会被当作旧句尾随而吞掉。
    core.suppressIncomingTranscripts?.(0);

    if (core.suspendedByMedia) {
      // Pressing Space is an explicit push-to-talk intent. Previous TTS/PTT
      // cleanup can clear userWantedMic while the voice stack is still suspended.
      const wasUserWantedMic = core.userWantedMic;
      core.userWantedMic = true;
      // mic 硬件仍在，只是 ASR WS 被 TTS 暂停 → 重连即可，不算 PTT 开的 mic
      pttStartedMic = !wasUserWantedMic;
      await core.resumeSession(false);
      if (!core.micActive) {
        pttStartedMic = true;
        await toggleVoice();
      }
      return;
    }
    if (core.micActive) {
      // 已经在听 → 不改状态，但 release 时仍要"立即发送"
      pttStartedMic = false;
      return;
    }
    pttStartedMic = true;
    await toggleVoice();
  }

  // send=false：用于窗口失焦等"非主动松手"场景——只结束这次 PTT、不把半句发出去。
  // 否则失焦（如点开 DevTools / 切窗口）会把没说完的半句直接发送，正是要避免的误发。
  function pttEnd({ send = true } = {}) {
    core.pttHolding = false;
    const startedMic = pttStartedMic;
    pttStartedMic = false;
    if (!core.micActive) return;

    if (!send) {
      cancelAutoSend?.();
      if (startedMic) {
        // PTT 自己开的 mic → 连 mic 一起停，避免残留
        core.stopSession();
      } else {
        // 叠加在常开会话上 → 丢弃这次按住期间的半句，并吞掉 flush 尾随 final，
        // 否则常开策略随后会把这半句误发出去
        core.resetTranscriptAccumulation();
        core.setText('');
        core.suppressIncomingTranscripts?.(1500);
      }
      return;
    }

    // 通知云端 ASR 立刻给最终结果
    core.flushAsr();

    const finalize = () => {
      if (core.getText()) {
        cancelAutoSend?.();
        core.setStatus('processing');
        core.sendRecognizedVoiceText();
        // 常开模式 mic 不停：flushAsr 触发的尾随 final 属同一句，吞掉它，
        // 否则常开策略会 onTranscript → scheduleAutoSend 把整条消息再发一次。
        // PTT 自开的 mic 走下面的 stopSession，吞尾窗口对它无副作用。
        core.suppressIncomingTranscripts?.(1500);
        if (startedMic) setTimeout(() => core.stopSession(), 120);
      } else if (startedMic) {
        core.stopSession();
      }
    };

    // 给云端 800ms 把最终结果吐出来
    let waited = 0;
    const tick = () => {
      if (core.getText()) { finalize(); return; }
      if (waited >= 800) { finalize(); return; }
      waited += 100;
      setTimeout(tick, 100);
    };
    tick();
  }

  return { pttStart, pttEnd };
}
