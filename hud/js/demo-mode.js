'use strict';
/* <<demo-mode: 演示模式. While a hologram plays (machine teardown, Starship launch, route map) the panels step aside,
   the starfield comes up and a back button sits top-right. A governor watches frame times and lowers the render
   resolution when the GPU can't keep up, so a heavy hologram slows down instead of freezing the whole Mac. */
const demoBack = document.createElement('button');
demoBack.type = 'button'; demoBack.id = 'demoBack'; demoBack.setAttribute('aria-label', '退出演示模式');
demoBack.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>返回<small>DEMO</small>';
document.body.appendChild(demoBack);
function demoExit() {
  try { machineHide(); } catch (_) {}
  try { holoHide(); } catch (_) {}
  try { if (SHIP && SHIP.state.on) SHIP.hide(); } catch (_) {}
  try { if (RD && RD.state.on) RD.hide(); } catch (_) {}
  try { if (OP && OP.state.on) OP.hide(); } catch (_) {}
  try { if (EW) EW.hide(); } catch (_) {}
}
demoBack.addEventListener('click', demoExit);
addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('demo')) demoExit(); });
function demoLive() { return !!((MACH.on && MACH.mesh) || HOLO.on || (SHIP && SHIP.state.on && !SHIP.state.ending) || (RD && RD.state.on && !RD.state.ending) || (OP && OP.state.on && !OP.state.ending) || (EW && EW.live())); }
const GOV = { last: 0, ema: 16, slow: 0, good: 0, lv: 0, levels: [DPR, Math.min(DPR, 1.5), Math.min(DPR, 1.25), 1], stalls: [] };
function govSet(lv) {
  GOV.lv = lv; GOV.slow = GOV.good = 0;
  const r = GOV.levels[lv];
  renderer.setPixelRatio(r); composer.setPixelRatio(r); U.uPixel.value = r; resize();
  console.log('render scale', r);
}
function demoFrame() {
  const on = demoLive();
  if (on !== document.body.classList.contains('demo')) document.body.classList.toggle('demo', on);
  const now = performance.now(), gap = GOV.last ? now - GOV.last : 16; GOV.last = now;
  if (document.hidden) { GOV.last = 0; return; }
  if (gap > 1200 && on) {                             /* a stall mid-hologram: drop straight to the lightest setting */
    GOV.stalls = GOV.stalls.filter(t => now - t < 20000); GOV.stalls.push(now);
    if (GOV.lv < GOV.levels.length - 1) govSet(GOV.levels.length - 1);
    return;
  }
  GOV.ema += (Math.min(gap, 200) - GOV.ema) * 0.05;
  if (GOV.ema > 36) { GOV.good = 0; if (++GOV.slow > 75 && GOV.lv < GOV.levels.length - 1) govSet(GOV.lv + 1); }
  else if (GOV.ema < 20) { GOV.slow = 0; if (++GOV.good > 1800 && GOV.lv > 0 && !GOV.stalls.length) govSet(GOV.lv - 1); }
  else { GOV.slow = Math.max(0, GOV.slow - 1); }
  if (GOV.stalls.length && now - GOV.stalls[GOV.stalls.length - 1] > 120000) GOV.stalls = [];
}
/* demo-mode>> */
