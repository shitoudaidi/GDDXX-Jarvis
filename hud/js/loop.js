'use strict';
/* state targets */
const STATES = {
  boot: { speed: 0.3, turb: 0.22, expand: 1, bright: 1.0, warm: 0.5, bloom: 0.4 },
  idle: { speed: 0.3, turb: 0.22, expand: 1, bright: 1.0, warm: 0.5, bloom: 0.4 },
  listening: { speed: 0.2, turb: 0.12, expand: 0.94, bright: 1.25, warm: 0.25, bloom: 0.55 },
  thinking: { speed: 0.45, turb: 0.3, expand: 1.0, bright: 1.15, warm: 0.8, bloom: 0.5, mob: 1 },
  speaking: { speed: 0.3, turb: 0.18, expand: 1, bright: 1.08, warm: 0.5, bloom: 0.45, mob: 1 }
};
let state = 'boot';
const clock = new THREE.Clock(); let simT = 0; let speakEnv = 0;
const tmp = new THREE.Vector3();
function lerp(a, b, t) { return a + (b - a) * t; }
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const S = STATES[state]; const f = 1 - Math.pow(0.04, dt);
  U.uSpeed.value = lerp(U.uSpeed.value, S.speed * (reduced ? 0.3 : 1), f);
  U.uPhase.value += U.uSpeed.value * dt;
  U.uRoll.value += dt * 0.12 * (reduced ? 0.3 : 1);
  U.uMob.value = lerp(U.uMob.value, S.mob || 0, 1 - Math.pow(0.25, dt));   /* ~1.5 s to gather or release */
  U.uTurb.value = lerp(U.uTurb.value, S.turb, f);
  U.uExpand.value = lerp(U.uExpand.value, S.expand, state === 'boot' ? 1 - Math.pow(0.25, dt) : f);
  U.uBright.value = lerp(U.uBright.value, S.bright, f);
  U.uWarm.value = lerp(U.uWarm.value, S.warm, f * 0.6);
  bloom.strength = lerp(bloom.strength, S.bloom, f);
  const t = simT;
  speakEnv = state === 'speaking' ? Math.max(0, 0.25 + 0.75 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1) + 0.25 * Math.sin(t * 13.7)) : 0;
  U.uVib.value = lerp(U.uVib.value, Math.min(1, speakEnv), 0.35);
  simT += dt; U.uTime.value = simT;

  rotV.x *= 0.93; rotV.y *= 0.93;
  SHIPYAW += rotV.y; target.y += rotV.y + (reduced ? 0.0002 : 0.0011) * (state === 'thinking' ? 1.4 : 1); target.x += rotV.x;
  target.x *= 0.995;
  core.rotation.z = fibers.rotation.z = target.y * 0.6; world.rotation.y = Math.sin(target.y * 0.5) * 0.35; world.rotation.x = -1.08 + target.x; world.rotation.z = 0.35;
  camera.position.x = lerp(camera.position.x, mouse.x * 0.35, 0.03);
  camera.position.y = lerp(camera.position.y, -mouse.y * 0.25, 0.03);
  camera.lookAt(0, -0.28, 0);

  const rp = rpG.attributes.position.array;
  rainSeeds.forEach((r, i) => { const y = r.top - ((r.o + simT * r.sp * 0.25) % 1) * r.h; rp[i * 3] = r.x; rp[i * 3 + 1] = y; rp[i * 3 + 2] = r.z; });
  rpG.attributes.position.needsUpdate = true;

  const w = canvas.clientWidth, h = canvas.clientHeight;
  nodes.forEach((n, i) => {
    n.a += n.sp * dt * (state === 'thinking' ? 1.5 : 1);
    n.m.position.set(Math.cos(n.a) * n.rx, Math.sin(n.a) * n.ry, 0);
    n.m.getWorldPosition(tmp); tmp.project(camera);
    const s = labels[i];
    s.style.left = ((tmp.x + 1) / 2 * w) + 'px'; s.style.top = ((1 - tmp.y) / 2 * h) + 'px';
    s.style.opacity = tmp.z < 1 ? '.9' : '0';
    if (i === 1) {
      const rr = routeCv.getBoundingClientRect(); const ex = rr.left + routePts[0][0] * rr.width, ey = rr.top + routePts[0][1] * rr.height;
      const sx = (tmp.x + 1) / 2 * w, sy = (1 - tmp.y) / 2 * h;
      if (rr.width > 0 && innerWidth > 900 && tmp.z < 1 && sx < ex) { linkDash = (linkDash + dt * 40) % 400; linkPath.setAttribute('d', `M${sx},${sy} C${(sx + ex) / 2},${sy} ${(sx + ex) / 2},${ey} ${ex},${ey}`); linkPath.setAttribute('stroke-dasharray', '2 6'); linkPath.setAttribute('stroke-dashoffset', String(-linkDash)); linkPath.style.opacity = '1'; }
      else linkPath.style.opacity = '0';
    }
  });
  orbits.rotation.z += dt * 0.01;
  holoFrame(dt, w, h);
  machFrame(dt, w, h);
  if (SHIP) SHIP.frame(dt, w, h);
  if (RD) RD.frame(dt, w, h);
  if (OP) OP.frame(dt, w, h);
  if (EW) EW.frame(dt);
  demoFrame();
  if (SK.core) SK.core.frame(dt);   /* skins: a skin's own centrepiece */
  /* earth wall fully up: the dimmed core behind it only needs every other frame (two WebGL scenes at full rate stutter) */
  if (!(EW && EW.live() && EW.state.appear >= 1 && (frameOdd = !frameOdd))) composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
