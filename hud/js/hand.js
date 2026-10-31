'use strict';
/* <<hand: steer holograms with one hand through the camera (gesture set designed with the first user).
   The voice service runs Apple's hand-pose detector and sends {type:'hand', hands:[{x,y,ix,iy,ext,fx,pinch,ip,s}]}
   about 20 times a second while a demo is on screen (we ask for the camera only then).
   raise an open palm and hold it still a moment: gestures on (a ring cursor appears); hand gone 1.5 s: off
   open hand moving: turn the model
   pinch thumb and index (tips touching), then open them: bigger, close them again: smaller
   (no more starting from a wide "C": pointing with the thumb out looked the same and kept zooming)
   quick fist, then open: take it apart          open hand, then close it and hold the fist: put it back together
   point with the index finger (or a V sign) at a part for a second: it is picked and brought forward;
   then a V sign (index + middle out) moves it with the hand; one finger or a fist holds it still; open hand: let go
   both hands pinching, pulled apart or together: zoom
   a small camera window top right shows what the camera sees, the hand skeleton, and which pose was recognised */
const HAND = { cam: false, camSent: 0, on: true, engaged: false, still: 0, lastSeen: 0, sm: [], prev: null, status: '',
  twoBase: null, zoom0: 1, zoom: null, cSince: 0, fistSince: 0, fistUsed: false, openAt: 0, actAt: 0, pointAt: 0, pointI: -2, pointSeen: 0, ptLost: 0, pt: null, grab: null, pose: '', frameAt: 0 };
try { HAND.on = localStorage.getItem('jarvis.hand') !== 'off'; } catch (_) {}
const handStyle = document.createElement('style');
handStyle.textContent = `
#handCur{position:fixed;left:0;top:0;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;pointer-events:none;z-index:60;opacity:0;
  transition:opacity .35s,width .25s,height .25s,margin .25s;
  background:conic-gradient(rgba(var(--sk-acc),.95) calc(var(--p,0)*1turn),transparent 0);
  -webkit-mask:radial-gradient(circle,transparent 21px,#000 22px,#000 25px,transparent 26px);mask:radial-gradient(circle,transparent 21px,#000 22px,#000 25px,transparent 26px)}
#handCur::after{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(var(--sk-pri),.85);box-shadow:0 0 14px rgba(var(--sk-pri),.6),inset 0 0 10px rgba(var(--sk-pri),.35)}
#handCur::before{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:rgb(var(--sk-hi));box-shadow:0 0 10px rgb(var(--sk-pri))}
#handCur.on{opacity:1}
#handCur.two{width:34px;height:34px;margin:-17px 0 0 -17px}
#handCur2{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid rgba(var(--sk-pri),.85);box-shadow:0 0 14px rgba(var(--sk-pri),.6);pointer-events:none;z-index:60;opacity:0;transition:opacity .3s}
#handCur2.on{opacity:1}
#handLine{position:fixed;left:0;top:0;height:1px;transform-origin:0 50%;background:linear-gradient(90deg,rgba(var(--sk-pri),0),rgba(var(--sk-pri),.8),rgba(var(--sk-pri),0));pointer-events:none;z-index:59;opacity:0;transition:opacity .3s}
#handLine.on{opacity:1}
#handChip{position:fixed;right:max(18px,2vw);top:76px;z-index:30;padding:6px 12px;border-radius:999px;border:1px solid rgba(var(--sk-pri),.3);
  background:rgba(var(--sk-pnl),.6);color:rgba(var(--sk-ink),.85);font-size:12px;letter-spacing:.5px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .4s}
body.demo.mach #handChip{opacity:1;pointer-events:auto}
#handChip b{color:rgb(var(--sk-pri));font-weight:500;margin-right:6px}
#handChip.live b{color:rgb(var(--sk-acc))}
#handToast{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:60;padding:8px 18px;border:1px solid rgba(var(--sk-acc),.5);background:rgba(var(--sk-pnl),.7);
  color:rgb(var(--sk-accp));font-size:14px;letter-spacing:2px;opacity:0;transition:opacity .3s;pointer-events:none}
#handToast.on{opacity:1}
#handCam{position:fixed;right:max(18px,2vw);top:112px;z-index:30;width:176px;height:132px;border:1px solid rgba(var(--sk-pri),.35);border-radius:6px;overflow:hidden;
  background:rgb(var(--sk-bg));box-shadow:0 0 18px rgba(var(--sk-pri),.12);opacity:0;pointer-events:none;transition:opacity .4s}
#handCam.on{opacity:1}
#handCam img{display:block;width:100%;height:100%;object-fit:cover}
#handCam .pose{position:absolute;left:0;right:0;bottom:0;padding:4px 8px;font-size:11.5px;letter-spacing:1px;color:rgb(var(--sk-ink));background:linear-gradient(0deg,rgba(var(--sk-bg),.9),rgba(var(--sk-bg),0))}
#handCam .pose b{color:rgb(var(--sk-acc));font-weight:500}
#handCam .tag{position:absolute;left:7px;top:5px;font:600 9px var(--f-latin,monospace);letter-spacing:1.6px;color:rgb(var(--sk-pri))}
#handCam.live{border-color:rgba(var(--sk-acc),.6)}`;
document.head.appendChild(handStyle);
const handCur = Object.assign(document.createElement('div'), { id: 'handCur' }), handCur2 = Object.assign(document.createElement('div'), { id: 'handCur2' });
const handLine = Object.assign(document.createElement('div'), { id: 'handLine' }), handChip = Object.assign(document.createElement('div'), { id: 'handChip' });
const handToastEl = Object.assign(document.createElement('div'), { id: 'handToast' });
const handCam = Object.assign(document.createElement('div'), { id: 'handCam' });
handCam.innerHTML = '<img alt=""><span class="tag">CAM · HAND</span><div class="pose"></div>';
const handCamImg = handCam.querySelector('img'), handCamPose = handCam.querySelector('.pose');
document.body.append(handCur, handCur2, handLine, handChip, handToastEl, handCam);
/* the camera's picture with the hand skeleton drawn on it, from the voice service about 10 times a second */
function handFrame(m) {
  if (!HAND.on || !document.body.classList.contains('demo') || !m.jpg) return;
  handCamImg.src = 'data:image/jpeg;base64,' + m.jpg; HAND.frameAt = performance.now();
}
function handCamShow() {
  const on = HAND.on && document.body.classList.contains('demo') && !!(MACH.on && MACH.mesh) && performance.now() - HAND.frameAt < 2500;
  handCam.classList.toggle('on', on); handCam.classList.toggle('live', HAND.engaged);
  handCamPose.innerHTML = !on ? '' : !HAND.engaged ? (HAND.pose ? HAND.pose + ' · ' : '') + '举起手掌停一下' : HAND.pose ? '<b>' + HAND.pose + '</b>' : '没看到手';
  const hh = on ? handCam.offsetTop + handCam.offsetHeight + 12 - 150 : 0;   /* starship's right-hand panels move down to make room */
  if (window.HANDCAM_H !== hh) window.HANDCAM_H = hh;
}
function handToast(t) { handToastEl.textContent = t; handToastEl.classList.add('on'); clearTimeout(handToastEl._t); handToastEl._t = setTimeout(() => handToastEl.classList.remove('on'), 1400); }
function handChipText() {
  const st = HAND.status;
  handChip.classList.toggle('live', HAND.engaged);
  handChip.innerHTML = !HAND.on ? '<b>✋</b>手势已关闭 · 点击开启'
    : st === 'no_camera' ? '<b>✋</b>请在弹窗里允许 Jarvis 使用摄像头'
    : st === 'missing' ? '<b>✋</b>手势组件未安装'
    : st === 'denied' ? '<b>✋</b>摄像头被拒绝：系统设置 › 隐私与安全性 › 摄像头 › 打开 Jarvis Voice'
    : st !== 'on' ? '<b>✋</b>手势 · 正在打开摄像头…'
    : HAND.engaged ? '<b>✋</b>手势控制中 · 放下手即可停止' : '<b>✋</b>举起手掌停一下，开始手势控制';
}
handChip.addEventListener('click', () => {
  HAND.on = !HAND.on; try { localStorage.setItem('jarvis.hand', HAND.on ? 'on' : 'off'); } catch (_) {}
  if (!HAND.on) handIdle(); HAND.camSent = 0; handChipText();
});
handChipText();
/* the camera is wanted while a demo is on screen; re-sent every few seconds so a restarted voice service picks it up */
setInterval(() => {
  /* only for a machine teardown: the Starship launch and the route map are watched, not handled, and the camera costs CPU
     (the Starship launch stuttered with the camera on) */
  const want = HAND.on && document.body.classList.contains('demo') && (!!(MACH.on && MACH.mesh) || !!(typeof EW !== 'undefined' && EW && EW.live())), now = performance.now();
  if (want !== HAND.cam || (want && now - HAND.camSent > 5000)) { if (liveSend({ type: 'camera', on: want })) { HAND.cam = want; HAND.camSent = now; } }
  if (!want && HAND.engaged) handIdle();
}, 500);
setInterval(() => { document.body.classList.toggle('mach', !!(MACH.on && MACH.mesh)); handCamShow(); }, 250);
function handIdle() {
  HAND.engaged = false; HAND.still = 0; HAND.sm = []; HAND.prev = null; HAND.twoBase = null; HAND.zoom = null; HAND.fistSince = 0; HAND.pointI = -2; handLetGo();
  handCur.classList.remove('on', 'two'); handCur2.classList.remove('on'); handLine.classList.remove('on'); handCur.style.setProperty('--p', 0); handChipText();
}
/* the camera image's middle 70% maps to the whole screen, so nobody has to reach for the edges */
const handScr = (x, y) => [Math.min(1, Math.max(0, (x - 0.5) / 0.7 + 0.5)) * innerWidth, Math.min(1, Math.max(0, (y - 0.48) / 0.7 + 0.5)) * innerHeight];
/* thumb and index tips touching, index not curled into the palm (a fist with the thumb over the fingers also has the tips close) */
const handPinch = (h) => h.pinch < 0.22 && (h.im != null ? h.im > 0.55 : h.ip > 0.75);
const handFist = (h) => h.ext === 0 && !handPinch(h);
const handOpen = (h) => h.ext >= 3;
const handThree = (h) => (h.fx || '0000').slice(1).split('').filter(c => c === '1').length;   /* middle, ring, little stretched */
const handV = (h) => (h.fx || '').startsWith('11') && handThree(h) <= 1;   /* index and middle out: the "V" that drags */
const handPoint = (h) => (h.fx || '')[0] === '1' && handThree(h) <= 1 && (h.fx || '')[1] === '0' && h.pinch > 0.45;   /* thumb may stick out */
/* like machPick, but more forgiving: a wider reach, and the part already under the finger wins ties so the dwell does not reset */
function handPick(x, y, keep) {
  const r = canvas.getBoundingClientRect(); let best = -1, bd = 48 * 48;
  MACH.picks.forEach((list, i) => {
    if (MACH.focus >= 0 && MACH.focus !== i) return;
    const bias = i === keep ? 0.45 : 1;
    for (const p of list) { machPartPos(i, p, machW); const [sx, sy] = machToScreen(machW, r); const d = ((sx - x) * (sx - x) + (sy - y) * (sy - y)) * bias; if (d < bd) { bd = d; best = i; } }
  });
  return best;
}
/* One-Euro filter (screen px): heavy smoothing while the hand is nearly still, little lag when it moves fast */
function handEuro(f, x, y, now) {
  if (!f.t) { f.x = x; f.y = y; f.dx = 0; f.dy = 0; f.t = now; return f; }
  const dt = Math.max(0.016, (now - f.t) / 1000), a = (fc) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  f.t = now;
  const ad = a(1.0); f.dx += ((x - f.x) / dt - f.dx) * ad; f.dy += ((y - f.y) / dt - f.dy) * ad;
  const k = a(0.6 + 0.004 * Math.hypot(f.dx, f.dy));
  f.x += (x - f.x) * k; f.y += (y - f.y) * k;
  return f;
}
function handPoseName(h, n) {
  if (n === 2) return '双手';
  if (HAND.grab) return handV(h) ? '比耶 · 拖动零件' : '已选中 · 比耶拖动 / 张开放开';
  if (handV(h)) return '比耶';
  if (HAND.zoom) return '捏合 · 缩放';
  if (handOpen(h)) return '张开';
  if (handPinch(h)) return '捏合';
  if (handPoint(h)) return '指向';
  if (handFist(h)) return '握拳';
  return '…';
}
function handLetGo() {
  const g = HAND.grab; HAND.grab = null; window.HAND_GRAB_I = -1;
  if (g && MACH.mesh && MACH.focus === g.i) { MACH.scaleGoal[g.i] = 1; MACH.focus = -1; }   /* the part stays where it was put */
}
function handMsg(m) {
  if (m.status) { HAND.status = m.status; if (m.status !== 'on') handIdle(); handChipText(); return; }
  if (!HAND.on || !document.body.classList.contains('demo')) return;
  if (HAND.status !== 'on') { HAND.status = 'on'; handChipText(); }
  const now = performance.now(), hs = (m.hands || []).slice().sort((a, b) => a.x - b.x);
  hs.forEach(h => { if (h.fx == null) h.fx = h.ext >= 3 ? '1111' : h.ext === 0 ? '0000' : '1000'; if (h.ip == null) h.ip = h.ext === 0 ? 0.45 : 1; });   /* an older voice service sends less */
  if (!hs.length) { HAND.pose = ''; if (HAND.engaged && now - HAND.lastSeen > 1500) handIdle(); return; }
  HAND.lastSeen = now;
  HAND.prevRaw = hs.length === 1 ? { x: hs[0].x, y: hs[0].y } : null;
  if (HAND.sm.length !== hs.length) HAND.sm = hs.map(h => ({ ...h }));
  else HAND.sm = HAND.sm.map((p, i) => { const h = hs[i], k = 0.55; return { ...h, x: p.x + (h.x - p.x) * k, y: p.y + (h.y - p.y) * k, ix: p.ix + (h.ix - p.ix) * k, iy: p.iy + (h.iy - p.iy) * k, s: p.s + (h.s - p.s) * k, pinch: p.pinch + (h.pinch - p.pinch) * 0.6 }; });
  const H = HAND.sm, prev = HAND.prev; HAND.prev = H.map(h => ({ ...h }));
  HAND.pose = handPoseName(H[0], H.length);
  const mach = machLive();
  if (!HAND.engaged) {                                   /* wake-up: one open palm, held still for about half a second */
    const h = H[0], p = prev && prev.length === H.length ? prev[0] : null;
    if (H.length === 1 && handOpen(h) && p && Math.hypot(h.x - p.x, h.y - p.y) < 0.012) HAND.still++; else HAND.still = 0;
    if (HAND.still >= 9) { HAND.engaged = true; HAND.openAt = now; handCur.classList.add('on'); handToast('手势控制'); handChipText(); }
    return;
  }
  if (H.length === 2) {                                  /* two hands, both pinching: pull apart or together to zoom */
    const [a, b] = H, [ax, ay] = handScr(a.x, a.y), [bx, by] = handScr(b.x, b.y);
    handCur.classList.add('on', 'two'); handCur2.classList.add('on'); handCur.style.setProperty('--p', 0);
    handCur.style.transform = `translate(${ax}px,${ay}px)`; handCur2.style.transform = `translate(${bx}px,${by}px)`;
    const both = a.pinch < 0.35 && b.pinch < 0.35;
    handLine.classList.toggle('on', both); handLine.style.width = Math.hypot(bx - ax, by - ay) + 'px';
    handLine.style.transform = `translate(${ax}px,${ay}px) rotate(${Math.atan2(by - ay, bx - ax)}rad)`;
    if (typeof EW !== 'undefined' && EW && EW.live()) {   /* earth wall: both hands pinching, apart or together, zoom the globe */
      EW.hand2({ both, d: Math.hypot((b.x - a.x) * 1.33, b.y - a.y) }); HAND.zoom = null; HAND.fistSince = 0; HAND.pointI = -2; return;
    }
    if (both && mach) {
      const d = Math.hypot((b.x - a.x) * 1.33, b.y - a.y);
      if (!HAND.twoBase) { HAND.twoBase = d; HAND.zoom0 = MACH.zoomGoal; }
      else { machTakeOver(); MACH.zoomGoal = Math.min(6, Math.max(0.45, HAND.zoom0 * d / HAND.twoBase)); if (MACH.zoomGoal <= 1.02) MACH.panGoal.multiplyScalar(0.9); }
    } else HAND.twoBase = null;
    HAND.zoom = null; HAND.fistSince = 0; HAND.pointI = -2;
    return;
  }
  HAND.twoBase = null; handCur.classList.remove('two'); handCur2.classList.remove('on'); handLine.classList.remove('on');
  const h = H[0], p = prev && prev.length === 1 ? prev[0] : null;
  const open = handOpen(h), fist = handFist(h), pinch = handPinch(h), three = handThree(h);
  /* pointing: a frame or two that look different (the finger blurs) do not break it */
  let vee = handV(h) && !HAND.zoom;
  if (vee) HAND.vLost = 0;
  else if (HAND.grab && HAND.grab.drag && !open && (h.fx || '')[0] === '1') { if (!HAND.vLost) HAND.vLost = now; vee = now - HAND.vLost < 300; }
  let point = (handPoint(h) || vee) && !HAND.zoom;
  if (point) HAND.ptLost = 0;
  else if ((HAND.pointI >= 0 || HAND.grab) && !HAND.zoom && !open && !pinch && (h.fx || '')[0] === '1') { if (!HAND.ptLost) HAND.ptLost = now; point = now - HAND.ptLost < 300; }
  let cx, cy;
  if (point || HAND.grab) {                              /* the fingertip shakes more than the palm: smooth it harder, ignore tiny moves */
    const [tx, ty] = handScr(h.ix, h.iy), q = HAND.pt;
    if (!q) HAND.pt = { x: tx, y: ty };
    else { const d = Math.hypot(tx - q.x, ty - q.y), k = d < 6 ? 0 : d < 40 ? 0.22 : 0.5; q.x += (tx - q.x) * k; q.y += (ty - q.y) * k; }
    cx = HAND.pt.x; cy = HAND.pt.y;
  } else { HAND.pt = null; [cx, cy] = handScr(h.x, h.y); }
  HAND.pose = handPoseName(h, 1) === '…' && point ? '指向' : handPoseName(h, 1);
  if (HAND.grab) point = false;                          /* once picked, the finger no longer picks */
  handCur.classList.add('on'); handCur.style.transform = `translate(${cx}px,${cy}px)`;
  if (typeof EW !== 'undefined' && EW && EW.live()) {      /* earth wall: point at a card and pinch to open it; hold a fist to go back */
    const [px, py] = handScr(h.ix != null ? h.ix : h.x, h.iy != null ? h.iy : h.y);
    handCur.style.transform = `translate(${px}px,${py}px)`; handCur.style.setProperty('--p', pinch ? 1 : 0);
    EW.hand({ sx: px, sy: py, pinch, fist, open });
    return;
  }
  let ring = 0;
  /* thumb-index zoom: starts on a pinch (open them: bigger) or on a still, wide "C" (close them: smaller) */
  if (!HAND.zoom && three <= 1 && pinch && !HAND.grab) HAND.zoom = { last: Math.max(0.12, h.pinch), still: now };
  if (HAND.zoom) {
    const g = Math.max(0.12, h.pinch), z = HAND.zoom;
    if (three >= 2 || open) HAND.zoom = null;           /* the other fingers came out: done */
    else {
      if (Math.abs(g - z.last) > 0.04) z.still = now;
      if (mach && Math.abs(g - z.last) > 0.01) { machTakeOver(); MACH.zoomGoal = Math.min(6, Math.max(0.45, MACH.zoomGoal * Math.pow(g / z.last, 0.9))); if (MACH.zoomGoal <= 1.02) MACH.panGoal.multiplyScalar(0.95); }
      z.last = g;
      if (now - z.still > 1200) HAND.zoom = null;        /* held still: leave zoom so pointing works again */
      HAND.fistSince = 0; HAND.pointI = -2;
      handCur.style.setProperty('--p', 0);
      HAND.prev = H.map(x => ({ ...x }));
      return;
    }
  }
  if (open) {
    if (HAND.grab) { handLetGo(); handToast('放开'); }
    if (p && handOpen(p)) { const dx = h.x - p.x, dy = h.y - p.y; if (Math.abs(dx) + Math.abs(dy) > 0.002) { rotV.y += dx * 1.6; rotV.x += dy * 1.0; if (mach) machTakeOver(); } }
    /* quick fist then open: take it apart */
    if (HAND.fistSince && !HAND.fistUsed && mach && now - HAND.actAt > 1500) {
      const held = now - HAND.fistSince;
      if (held > 200 && held < 900) { HAND.actAt = now; machineCommand({ action: 'disassemble' }); handToast('拆解'); }
    }
    HAND.fistSince = 0; HAND.openAt = now;
  } else if (fist) {
    if (!HAND.fistSince) { HAND.fistSince = now; HAND.fistUsed = false; HAND.fistFromOpen = now - HAND.openAt < 700; }
    const held = now - HAND.fistSince;
    if (HAND.fistFromOpen && !HAND.fistUsed) ring = Math.min(1, Math.max(0, (held - 300) / 600));
    /* open hand, then a fist held: put it back together */
    if (HAND.fistFromOpen && !HAND.fistUsed && held >= 900 && mach && now - HAND.actAt > 1500) { HAND.fistUsed = true; HAND.actAt = now; machineCommand({ action: 'assemble' }); handToast('组装'); }
  } else if (!pinch) HAND.fistSince = 0;
  /* point at a part and hold: pick it; then a V sign moves it with the palm (steadier than any fingertip) */
  if (HAND.grab && mach) {
    const g = HAND.grab, [px, py] = handScr(h.x, h.y);
    if (vee) {
      if (!g.drag) {                                       /* V starts: anchor here, so nothing jumps */
        machPartPos(g.i, MACH.cent[g.i], machW); MACH.mesh.localToWorld(machW); machW.project(camera);
        g.f = handEuro({}, px, py, now); g.drag = { x: g.f.x, y: g.f.y, z: machW.z, shift: MACH.shiftGoal[g.i].clone() };
        window.HAND_GRAB_I = g.i;                          /* the render loop stops pulling the focused part back to the centre */
      }
      const d = g.drag, f = handEuro(g.f, px, py, now), a = machLocalAt(d.x, d.y, d.z), b = machLocalAt(f.x, f.y, d.z);
      MACH.shiftGoal[g.i].copy(d.shift).add(b.sub(a));    /* the render loop eases toward it */
      handCur.style.transform = `translate(${f.x}px,${f.y}px)`;
    } else { if (g.drag) g.drag = null; }                                  /* one finger or a fist: it stays where it is */
  } else if (point && mach) {
    let i = handPick(cx, cy, HAND.pointI);
    if (i >= 0) HAND.pointSeen = now;
    else if (HAND.pointI >= 0 && now - HAND.pointSeen < 350) i = HAND.pointI;   /* slipped off the part for a moment: keep counting */
    if (i !== HAND.pointI) { HAND.pointI = i; HAND.pointAt = now; if (i >= 0) MACH.hover = i; }
    if (i >= 0) {
      ring = Math.max(0, Math.min(1, (now - HAND.pointAt) / 1000));
      if (ring >= 1) {
        machFocus(i); handToast('已选中 · 比耶两指拖动'); HAND.grab = { i, drag: null, f: null }; HAND.pointI = -2; ring = 0;
      }
    }
  } else HAND.pointI = -2;
  handCur.style.setProperty('--p', ring);
  HAND.pose = handPoseName(h, 1) === '…' && point ? '指向' : handPoseName(h, 1);
}
/* hand>> */
