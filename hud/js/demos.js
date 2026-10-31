'use strict';
/* <<starship: Starship V3 launch-to-recovery hologram (hud/starship.js) */
let SHIP = null, SHIPYAW = 0, OP = null;
import('../demos/starship.js?v=20261022h').then(m => {
  SHIP = window.SHIP = m.install({ THREE, scene, camera, pixel: DPR, spin: () => SHIPYAW,
    dim: (p) => { if (p > 0.001) { U.uGain.value = Math.min(U.uGain.value, 1 - Math.min(1, p * 1.6)); rainM.opacity *= 1 - p * 0.85; rpM.opacity *= 1 - p * 0.85;
      if (p > 0.3) orbits.visible = false; if (p > 0.05) labelBox.style.opacity = '0'; } } });
}).catch(e => console.warn('starship hologram:', e));
function shipCommand(m) {
  if (!SHIP) return;
  if ((m.action || 'play') !== 'hide') { try { dormHold = false; wakeUI(); machineHide(); holoHide(); if (OP && OP.state.on) OP.hide(); } catch (_) {} }
  SHIP.command(m);
}
/* keyboard: Ctrl+Shift+S start/stop, Ctrl+Shift+← → previous/next stage, Ctrl+Shift+P pause */
addEventListener('keydown', e => {
  if (!SHIP || !e.ctrlKey || !e.shiftKey) return;
  const st = SHIP.state, cur = Math.max(0, SHIP.stages.findIndex(s => st.t < s.at + s.dur));
  if (e.code === 'KeyS') { e.preventDefault(); st.on && !st.ending ? SHIP.hide() : shipCommand({ action: 'play' }); }
  else if (e.code === 'KeyP' && st.on) { e.preventDefault(); st.paused = !st.paused; }
  else if (e.code === 'ArrowRight' && st.on && !st.ending) { e.preventDefault(); SHIP.seek(Math.min(SHIP.stages.length - 1, cur + 1)); }
  else if (e.code === 'ArrowLeft' && st.on && !st.ending) { e.preventDefault(); SHIP.seek(Math.max(0, cur - 1)); }
});
/* starship>> */

/* <<roadster: Tesla Roadster cold-gas thrusters + suicide burn hologram (hud/roadster.js), added 2026-10-23 for the 特斯拉悬停 video */
let RD = null;
import('../demos/roadster.js?v=20261023a').then(m => {
  RD = window.RD = m.install({ THREE, scene, camera, pixel: DPR, spin: () => SHIPYAW,
    dim: (p) => { if (p > 0.001) { U.uGain.value = Math.min(U.uGain.value, 1 - Math.min(1, p * 1.6)); rainM.opacity *= 1 - p * 0.85; rpM.opacity *= 1 - p * 0.85;
      if (p > 0.3) orbits.visible = false; if (p > 0.05) labelBox.style.opacity = '0'; } } });
}).catch(e => console.warn('roadster hologram:', e));
function roadsterCommand(m) {
  if (!RD) return;
  if ((m.action || 'play') !== 'hide') { try { dormHold = false; wakeUI(); machineHide(); holoHide(); if (SHIP && SHIP.state.on) SHIP.hide(); if (OP && OP.state.on) OP.hide(); } catch (_) {} }
  RD.command(m);
}
/* keyboard: Ctrl+Shift+R start/stop, Ctrl+Shift+← → previous/next scene, Ctrl+Shift+P pause (while it plays) */
addEventListener('keydown', e => {
  if (!RD || !e.ctrlKey || !e.shiftKey) return;
  const st = RD.state, cur = Math.max(0, RD.stages.findIndex(s => st.t < s.at + s.dur));
  if (e.code === 'KeyR') { e.preventDefault(); st.on && !st.ending ? RD.hide() : roadsterCommand({ action: 'play' }); }
  else if (!st.on || st.ending) return;
  else if (OP && OP.state.on && !OP.state.ending) return;
  else if (e.code === 'KeyP') { e.preventDefault(); e.stopImmediatePropagation(); st.paused = !st.paused; }
  else if (e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); RD.seek(Math.min(RD.stages.length - 1, cur + 1)); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); RD.seek(Math.max(0, cur - 1)); }
}, true);
/* roadster>> */

/* <<optimus: Optimus walking hologram (hud/optimus.js), added 2026-10-23 */
import('../demos/optimus.js?v=20261023c').then(m => {
  OP = window.OP = m.install({ THREE, scene, camera, pixel: DPR, spin: () => SHIPYAW,
    dim: (p) => { if (p > 0.001) { U.uGain.value = Math.min(U.uGain.value, 1 - Math.min(1, p * 1.6)); rainM.opacity *= 1 - p * 0.85; rpM.opacity *= 1 - p * 0.85;
      if (p > 0.3) orbits.visible = false; if (p > 0.05) labelBox.style.opacity = '0'; } } });
}).catch(e => console.warn('optimus hologram:', e));
function optimusCommand(m) {
  if (!OP) return;
  if ((m.action || 'play') !== 'hide') { try { dormHold = false; wakeUI(); machineHide(); holoHide(); if (SHIP && SHIP.state.on) SHIP.hide(); if (RD && RD.state.on) RD.hide(); } catch (_) {} }
  OP.command(m);
}
/* keyboard: Ctrl+Shift+O start/stop, Ctrl+Shift+← → previous/next scene, Ctrl+Shift+P pause (while it plays) */
addEventListener('keydown', e => {
  if (!OP || !e.ctrlKey || !e.shiftKey) return;
  const st = OP.state, cur = Math.max(0, OP.stages.findIndex(s => st.t < s.at + s.dur));
  if (e.code === 'KeyO') { e.preventDefault(); st.on && !st.ending ? OP.hide() : optimusCommand({ action: 'play' }); }
  else if (!st.on || st.ending) return;
  else if (e.code === 'KeyP') { e.preventDefault(); e.stopImmediatePropagation(); st.paused = !st.paused; }
  else if (e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); OP.seek(Math.min(OP.stages.length - 1, cur + 1)); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); OP.seek(Math.max(0, cur - 1)); }
}, true);
/* optimus>> */

/* <<earth: 地球此刻 · Earth-now card wall (hud/demos/earthwatch.js) */
let EW = null, frameOdd = false;
import('../demos/earthwatch.js?v=20261031a').then(m => {
  EW = window.EW = m.install({ THREE, send: (o) => liveSend(o),
    dim: (p) => { if (p > 0.001) { U.uGain.value = Math.min(U.uGain.value, 1 - Math.min(1, p * 1.6)); rainM.opacity *= 1 - p * 0.85; rpM.opacity *= 1 - p * 0.85;
      if (p > 0.3) orbits.visible = false; if (p > 0.05) labelBox.style.opacity = '0'; } } });
}).catch(e => console.warn('earth wall:', e));
function earthCommand(m) {
  if (!EW) return;
  const a = (m && m.action) || 'show';
  if (a === 'show' || a === 'open') { try { dormHold = false; wakeUI(); machineHide(); holoHide(); if (SHIP && SHIP.state.on) SHIP.hide(); if (RD && RD.state.on) RD.hide(); if (OP && OP.state.on) OP.hide(); } catch (_) {} }
  EW.command(m);
}
/* keyboard: Ctrl+Shift+E show/hide the wall; while it is up, 1-6 open a card and Esc goes back */
addEventListener('keydown', e => {
  if (!EW || !e.ctrlKey || !e.shiftKey || e.code !== 'KeyE') return;
  e.preventDefault(); EW.live() ? EW.hide() : earthCommand({ action: 'show' });
}, true);
/* earth>> */
