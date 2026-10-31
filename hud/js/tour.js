'use strict';
/* 自动演示: one button runs Jarvis through its abilities by itself, for live streams. Each step types a request into
   Jarvis as if the user had asked it (the real brain answers and the real tools run), waits for the answer and for
   the hologram to play, then moves on. Listening is paused while it runs so the audience's voices don't cut in.
   Edit the steps in hud/tour.json (same shape as TOUR below) to change the show. */
const TOUR = [
  { ask: '用两句话介绍一下你自己', hold: 2 },
  { ask: '现在电脑状态怎么样？', hold: 3 },
  { ask: '今天天气怎么样？', hold: 4 },
  { ask: '今天有什么安排？', hold: 3 },
  { ask: '从这里去机场怎么走？', hold: 14 },
  { ask: '拆解一台汽车发动机', hold: 20 },
  { ask: '把它组装回去', hold: 8 },
  { ask: '收起全息', hold: 2 },
  { ask: '演示猛禽发动机点火的工作原理', hold: 40 },
  { ask: '收起全息', hold: 2 },
  { ask: '展示星舰发射的全过程', hold: 115 },
  { ask: '收起星舰', hold: 2 },
  { ask: '看看地球上此刻正在发生什么', hold: 40 },
  { ask: '收起地球', hold: 2 },
  { skins: 3, hold: 5 },
  { ask: '演示结束了，跟直播间的朋友们说声再见', hold: 2 },
];
const tourBtn = Object.assign(document.createElement('button'), { id: 'tourBtn', type: 'button' });
const liveCtl = Object.assign(document.createElement('div'), { id: 'liveCtl' });
liveCtl.append(document.getElementById('listenToggle') || '', tourBtn);
document.body.appendChild(liveCtl);
let touring = null;                 // { stop: bool } while a tour runs
function tourShow() {
  tourBtn.innerHTML = touring ? '<i class="sq"></i><span>停止演示</span>' : '<i class="tri"></i><span>自动演示</span>';
  tourBtn.title = touring ? '停止自动演示（Esc）' : '让贾维斯自己把各项功能演示一遍（直播用）';
  document.body.classList.toggle('touring', !!touring);
}
const tourSleep = (s, run) => new Promise(r => { const t0 = performance.now(); const k = () => (run.stop || performance.now() - t0 >= s * 1000) ? r() : setTimeout(k, 200); k(); });
let tourBusyAt = 0;                 // last moment Jarvis was thinking or speaking (set on every state change)
const tourSetState = setState;
setState = st => { if (st === 'thinking' || st === 'speaking') tourBusyAt = performance.now(); return tourSetState(st); };
const tourBusy = () => state === 'thinking' || state === 'speaking';
async function tourAsk(q, run) {
  const t0 = performance.now();
  handle(q);                                            // typed into Jarvis like a user request
  while (!run.stop && tourBusyAt < t0 && performance.now() - t0 < 20000) await tourSleep(0.2, run);
  while (!run.stop && performance.now() - t0 < 150000) {    // the answer is done once it has been quiet for 1.5 s
    if (tourBusy()) tourBusyAt = performance.now();
    else if (performance.now() - tourBusyAt >= 1500) break;
    await tourSleep(0.25, run);
  }
}
async function tourSkins(n, hold, run) {
  if (typeof SKINS === 'undefined' || typeof applySkin !== 'function') return;
  const home = SK.id, L = SKINS.filter(k => typeof skReady !== 'function' || skReady(k)).filter(k => k.id !== home);
  for (const sk of L.slice(0, n)) { if (run.stop) break; applySkin(sk.id); if (typeof skinToast === 'function') skinToast(sk); await tourSleep(hold, run); }
  applySkin(home);
}
async function tourRun() {
  const run = touring = { stop: false };
  tourShow();
  let steps = TOUR;
  try { const r = await fetch('tour.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) steps = j; } } catch (_) {}
  const wasListening = typeof listening === 'undefined' ? true : listening;
  if (wasListening && document.body.dataset.listen) liveSend({ type: 'listen', on: false });
  if (typeof wakeUI === 'function') { try { dormHold = false; } catch (_) {} wakeUI(); }
  for (const s of steps) {
    if (run.stop || !live) break;
    if (s.ask) await tourAsk(s.ask, run);
    if (s.skins) await tourSkins(s.skins, s.hold || 5, run);
    else await tourSleep(s.hold || 2, run);
  }
  if (run.stop) liveSend({ type: 'interrupt' });
  if (wasListening && document.body.dataset.listen) liveSend({ type: 'listen', on: true });
  if (touring === run) touring = null;
  tourShow();
}
function tourToggle() { if (touring) touring.stop = true; else if (live) tourRun(); tourShow(); }
window.tourToggle = tourToggle;
tourBtn.addEventListener('click', e => { e.stopPropagation(); tourToggle(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && touring) { touring.stop = true; tourShow(); } }, true);
tourShow();
