'use strict';
/* <<core:neural */
/* 星环 · Jarvis core (Claude, 2026-10-28). Rewritten for the Jarvis scene after studying the NEURAL theme. The centre
   cluster is the brain; the thirteen clusters round it are Jarvis's real abilities (hearing, voice, memory, schedule,
   weather, route, home, system, hologram, harness, gesture, voiceprint, look), named on the sector ring outside them.
   Signals run along synapse bundles in the direction the work actually flows:
   idle = slow breathing, system telemetry trickles into the brain; listening = the hearing cluster lights with the
   mic level and streams into the brain; thinking = the brain scans its abilities (a lit sector sweeps round, the
   barcode ring charges) and pulses out to them; speaking = the brain streams into the voice cluster and ripples with
   each syllable. When a real event arrives (weather, route, schedule, hologram, harness job...) that ability's cluster
   fires: pulses go out from the brain, a ripple runs through the cluster, and the answer flows back. */
SKCORES.neural = function () {
  const TAU = Math.PI * 2, S = 0.6;                                    /* theme units -> world units */
  const grp = new THREE.Group(); scene.add(grp);                       /* zoom */
  const tilt = new THREE.Group(); grp.add(tilt);                       /* base tilt + drag / palm */
  const spinG = new THREE.Group(); spinG.scale.setScalar(S); tilt.add(spinG);   /* brain + sector ring: abilities keep fixed places */
  const seeded = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = seeded(20261028), gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += R(); return (u - 2) * 0.866; };
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const pri = (typeof SKC !== 'undefined' && SKC.pri ? SKC.pri : '166,241,255').split(',').map(v => +v / 255);

  /* ---- the abilities: 0 = brain in the middle, 1..13 round it clockwise from the top ---- */
  const MODS = [
    { id: 'brain', zh: '大脑', en: 'CORTEX', c: '#f3f4f8' },
    { id: 'ear', zh: '听觉', en: 'HEARING', c: '#2fd27a' },
    { id: 'voice', zh: '语音', en: 'VOICE', c: '#25d6f0' },
    { id: 'memory', zh: '记忆', en: 'MEMORY', c: '#9aa6ff' },
    { id: 'plan', zh: '日程', en: 'SCHEDULE', c: '#ffd23f' },
    { id: 'weather', zh: '天气', en: 'WEATHER', c: '#45e6f5' },
    { id: 'nav', zh: '导航', en: 'ROUTE', c: '#b5ef3a' },
    { id: 'home', zh: '米家', en: 'HOME', c: '#ff9a1f' },
    { id: 'sys', zh: '系统', en: 'SYSTEM', c: '#62e6c7' },
    { id: 'holo', zh: '全息', en: 'HOLOGRAM', c: '#3b7cff' },
    { id: 'harness', zh: '工坊', en: 'HARNESS', c: '#a774ff' },
    { id: 'hand', zh: '手势', en: 'GESTURE', c: '#ff5cae' },
    { id: 'ident', zh: '声纹', en: 'VOICEPRINT', c: '#ff7b54' },
    { id: 'skin', zh: '外观', en: 'APPEARANCE', c: '#ff4458' }
  ];
  const NM = MODS.length, NO = NM - 1, M = Object.fromEntries(MODS.map((m, i) => [m.id, i]));
  const COL = MODS.map(m => hex(m.c));
  const CL = MODS.map((m, i) => {
    if (!i) return [0, 0, 0];
    const a = Math.PI / 2 - (i - 1) * TAU / NO, r = 1.1 + (R() - 0.5) * 0.12, z = (0.14 + R() * 0.26) * (R() < 0.5 ? -1 : 1);
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  });

  /* ---- 1. neurons: a dense soma core + bent dendrites per cluster, grey matter filling the ellipsoid between ---- */
  const lite = typeof small !== 'undefined' && small;
  const P = [], G = [], SZ = [], DD = [], CC = [];                     /* position, group, size, distance to own centre, colour */
  const push = (x, y, z, g, sz, col, k) => { P.push(x, y, z); G.push(g); SZ.push(sz); DD.push(Math.hypot(x - CL[g][0], y - CL[g][1], z - CL[g][2]));
    CC.push(col[0] * k, col[1] * k, col[2] * k); };
  const somaOf = [];                                                  /* a few bright somata per cluster: where pulses land */
  for (let g = 0; g < NM; g++) {
    const c = CL[g], chief = !g, n = Math.round((chief ? 1500 : 820) * (lite ? 0.5 : 1)), sig = chief ? 0.19 : 0.13;
    const col = COL[g], hot = col.map(v => v + (1 - v) * 0.55);
    const dends = [];
    for (let d = 0; d < (chief ? 18 : 12); d++) {
      let dx = gauss(), dy = gauss(), dz = gauss() * 0.5; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const len = chief ? 0.62 + R() * 0.55 : 0.3 + R() * 0.42, bend = [gauss() * 0.16, gauss() * 0.16, gauss() * 0.08];
      dends.push({ dx, dy, dz, len, bend });
    }
    somaOf[g] = [];
    for (let i = 0; i < n; i++) {
      if (i < n * 0.42) {                                              /* soma core */
        const x = c[0] + gauss() * sig, y = c[1] + gauss() * sig, z = c[2] + gauss() * sig * 0.8;
        const q = Math.exp(-Math.hypot(x - c[0], y - c[1], z - c[2]) / sig), big = R() < 0.012;
        push(x, y, z, g, big ? 2.6 : 0.7 + R() * 1.1 + q * 0.6, q > 0.5 ? hot : col, 0.8 + q * 0.4);
        if (big) somaOf[g].push(P.length / 3 - 1);
      } else {                                                         /* along a dendrite, thinning toward the tip */
        const d = dends[(R() * dends.length) | 0], t = Math.pow(R(), 0.75), j = 0.028 * (1 - t * 0.6);
        const x = c[0] + d.dx * d.len * t + d.bend[0] * t * t + gauss() * j, y = c[1] + d.dy * d.len * t + d.bend[1] * t * t + gauss() * j,
          z = c[2] + d.dz * d.len * t + d.bend[2] * t * t + gauss() * j;
        push(x, y, z, g, 0.55 + R() * 0.7 * (1 - t), col, 0.95 - t * 0.35);
      }
    }
  }
  const nCore = P.length / 3;
  for (let i = 0, n = lite ? 3000 : 7000; i < n; i++) {               /* grey matter */
    let x, y, z; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; } while (x * x + y * y + z * z > 1);
    x *= 1.78; y *= 1.78; z *= 1.45 * 0.6;
    let g = 0, bd = 1e9; for (let k = 0; k < NM; k++) { const d = (x - CL[k][0]) ** 2 + (y - CL[k][1]) ** 2 + (z - CL[k][2]) ** 2; if (d < bd) { bd = d; g = k; } }
    const col = COL[g].map(v => v * 0.55 + 0.3 * 0.45);
    push(x, y, z, g, 0.45 + R() * 0.55, col, 0.72);
  }
  const NP = P.length / 3;

  /* ---- 2. links: nearest neighbours through a grid (the tissue), a few long filaments (the white matter) ---- */
  const LV = [], LG = [], LC = [], LS = [];
  const link = (a, b, shade) => { LV.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]); LG.push(G[a], G[b]);
    LC.push(CC[a * 3], CC[a * 3 + 1], CC[a * 3 + 2], CC[b * 3], CC[b * 3 + 1], CC[b * 3 + 2]); LS.push(shade, shade); };
  { const cs = 0.16, cell = new Map(), key = (x, y, z) => (Math.floor(x / cs) + 64) * 16384 + (Math.floor(y / cs) + 64) * 128 + (Math.floor(z / cs) + 64);
    for (let i = 0; i < NP; i++) { const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); (cell.get(k) || cell.set(k, []).get(k)).push(i); }
    const near = [];
    for (let i = 0; i < NP; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], bg = i >= nCore, maxD = bg ? 0.26 : 0.2; near.length = 0;
      const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const L = cell.get((cx + a + 64) * 16384 + (cy + b + 64) * 128 + (cz + c + 64)); if (!L) continue;
        for (const j of L) { if (j <= i) continue; const d = (P[j * 3] - x) ** 2 + (P[j * 3 + 1] - y) ** 2 + (P[j * 3 + 2] - z) ** 2; if (d < maxD * maxD) near.push([d, j]); }
      }
      near.sort((p, q) => p[0] - q[0]);
      for (let k = 0; k < Math.min(bg ? 2 : 3, near.length); k++) { const j = near[k][1]; link(i, j, G[i] === G[j] ? (bg ? 0.22 : 0.5) : 0.26); }
    }
    for (let f = 0, n = lite ? 2500 : 6000; f < n; f++) {             /* long filaments */
      const i = (R() * NP) | 0;
      for (let tries = 0; tries < 6; tries++) { const j = (R() * NP) | 0, d = Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]);
        if (d > 0.22 && d < 0.6) { link(i, j, 0.11); break; } }
    }
  }

  /* ---- 3. synapse bundles: brain <-> every ability (12 strands), and each ability to its neighbours (6 strands) ---- */
  const STR = [];                                                     /* { a, b, p0, p1, p2 } quadratic Béziers */
  const bundle = (a, b, n, bow) => { const A = CL[a], B = CL[b];
    for (let s = 0; s < n; s++) {
      const j = () => gauss() * 0.05, p0 = [A[0] + j(), A[1] + j(), A[2] + j()], p2 = [B[0] + j(), B[1] + j(), B[2] + j()];
      const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2, dx = p2[0] - p0[0], dy = p2[1] - p0[1], l = Math.hypot(dx, dy) || 1;
      const off = bow * (0.6 + R() * 0.8) + gauss() * 0.05;
      STR.push({ a, b, p0, p1: [mx - dy / l * off, my + dx / l * off, (p0[2] + p2[2]) / 2 + gauss() * 0.12], p2 });
    } };
  for (let k = 1; k < NM; k++) bundle(0, k, 12, (R() - 0.5) * 0.25);
  for (let k = 1; k < NM; k++) bundle(k, k % NO + 1, 6, 0.16);
  const bz = (s, t, o, k) => { const u = 1 - t; o[k] = u * u * s.p0[0] + 2 * u * t * s.p1[0] + t * t * s.p2[0];
    o[k + 1] = u * u * s.p0[1] + 2 * u * t * s.p1[1] + t * t * s.p2[1]; o[k + 2] = u * u * s.p0[2] + 2 * u * t * s.p1[2] + t * t * s.p2[2]; };
  { const SEG = 14, tmp = [0, 0, 0, 0, 0, 0];
    for (const s of STR) for (let q = 0; q < SEG; q++) {
      const t0 = q / SEG, t1 = (q + 1) / SEG; bz(s, t0, tmp, 0); bz(s, t1, tmp, 3); LV.push(...tmp); LG.push(t0 < 0.5 ? s.a : s.b, t1 < 0.5 ? s.a : s.b);
      [t0, t1].forEach(t => LC.push(...COL[s.a].map((v, i) => v + (COL[s.b][i] - v) * t))); LS.push(0.2, 0.2);
    } }
  const strandsTo = (a, b) => STR.filter(s => (s.a === a && s.b === b) || (s.a === b && s.b === a));

  /* ---- shared uniforms ---- */
  const FU = { uTime: { value: 0 }, uPixel: U.uPixel, uFade: { value: 0 }, uZoomP: { value: 1 }, uAf: { value: new Float32Array(NM) },
    uFa: { value: new Float32Array(NM).fill(-1) }, uWave: { value: -1 }, uEnergy: { value: 0.5 }, uPri: { value: new THREE.Vector3(...pri) },
    uCharge: { value: 0 }, uEq: { value: 0 }, uSweep: { value: 0 }, uScan: { value: -10 } };
  const COMMON = `uniform float uTime,uPixel,uFade,uZoomP,uWave,uEnergy; uniform float uAf[${NM}]; uniform float uFa[${NM}];
    float sq(float x){ return x*x; }`;
  const PT_V = `${COMMON} attribute float aG,aS,aD,aR; attribute vec3 aCol; varying vec3 vC; varying float vA;
    void main(){
      int g=int(aG+0.5); float a=uAf[g], fa=uFa[g];
      float rip=fa>=0.0?exp(-sq((aD-fa*0.95)/0.07))*(1.0-fa)*1.6:0.0;              /* a fire ripple runs out through the cluster */
      float wr=uWave*2.4, wave=uWave>=0.0?exp(-sq((length(position.xy)-wr)/0.09))*(1.0-uWave)*0.9:0.0;   /* speech ripple from the brain */
      float tw=0.72+0.28*sin(uTime*(1.3+aR*2.2)+aR*40.0);
      vec3 p=position*(1.0+a*0.025*sin(uTime*3.0+aR*9.0));
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_PointSize=aS*uPixel*(6.4/-mv.z)*uZoomP*(1.0+rip*0.6+a*0.25);
      gl_Position=projectionMatrix*mv;
      float cg=g==0?0.45:1.0;                                                     /* the brain is dense: keep it from burning out */
      vC=aCol*(1.0+rip*0.8+wave*0.6); vA=(0.08+a*0.7*cg+rip+wave)*tw*uFade*(0.75+uEnergy*0.3)*(g==0?0.75:1.0);
    }`;
  const PT_F = `varying vec3 vC; varying float vA; void main(){ vec2 q=gl_PointCoord-0.5; float r=length(q); if(r>0.5) discard;
      float k=smoothstep(0.5,0.0,r); k=k*k*(0.6+0.4*smoothstep(0.18,0.0,r)); gl_FragColor=vec4(vC*vA*k,1.0); }`;
  const LN_V = `${COMMON} attribute float aG,aSh; attribute vec3 aCol; varying vec3 vC; varying float vA;
    void main(){ int g=int(aG+0.5); float a=uAf[g], fa=uFa[g];
      float rip=fa>=0.0?(1.0-fa)*0.8:0.0;
      vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
      vC=aCol; vA=aSh*(0.22+a*(g==0?0.55:1.2)+rip)*uFade*(0.7+uEnergy*0.3); }`;
  const LN_F = `varying vec3 vC; varying float vA; void main(){ gl_FragColor=vec4(vC*vA,1.0); }`;
  const addMat = (v, f, u) => new THREE.ShaderMaterial({ uniforms: u || FU, vertexShader: v, fragmentShader: f, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const sphere = new THREE.Sphere(new THREE.Vector3(), 4);

  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); pg.setAttribute('aG', new THREE.Float32BufferAttribute(G, 1));
  pg.setAttribute('aS', new THREE.Float32BufferAttribute(SZ, 1)); pg.setAttribute('aD', new THREE.Float32BufferAttribute(DD, 1));
  pg.setAttribute('aR', new THREE.Float32BufferAttribute(Array.from({ length: NP }, R), 1)); pg.setAttribute('aCol', new THREE.Float32BufferAttribute(CC, 3));
  pg.boundingSphere = sphere;
  const neurons = new THREE.Points(pg, addMat(PT_V, PT_F)); neurons.renderOrder = 901;
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(LV, 3)); lg.setAttribute('aG', new THREE.Float32BufferAttribute(LG, 1));
  lg.setAttribute('aCol', new THREE.Float32BufferAttribute(LC, 3)); lg.setAttribute('aSh', new THREE.Float32BufferAttribute(LS, 1));
  lg.boundingSphere = sphere;
  const links = new THREE.LineSegments(lg, addMat(LN_V, LN_F)); links.renderOrder = 900;
  spinG.add(links, neurons);

  /* ---- 4. signals: a pool of pulses, each a bright head with a fading tail, flying along one strand ---- */
  const NPU = 700, TAIL = 8, puPos = new Float32Array(NPU * TAIL * 3), puCol = new Float32Array(NPU * TAIL * 3), puA = new Float32Array(NPU * TAIL);
  const pulses = []; let puNext = 0;
  const pug = new THREE.BufferGeometry();
  pug.setAttribute('position', new THREE.BufferAttribute(puPos, 3).setUsage(THREE.DynamicDrawUsage));
  pug.setAttribute('aCol', new THREE.BufferAttribute(puCol, 3).setUsage(THREE.DynamicDrawUsage));
  pug.setAttribute('aA', new THREE.BufferAttribute(puA, 1).setUsage(THREE.DynamicDrawUsage)); pug.boundingSphere = sphere;
  const puMat = addMat(`uniform float uPixel,uFade,uZoomP; attribute vec3 aCol; attribute float aA; varying vec3 vC; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=(1.2+aA*3.2)*uPixel*(6.4/-mv.z)*uZoomP; gl_Position=projectionMatrix*mv; vC=aCol; vA=aA*uFade; }`, PT_F);
  const sig = new THREE.Points(pug, puMat); sig.renderOrder = 902; spinG.add(sig);
  /* fire n pulses from ability a to ability b (0 = brain) */
  const send = (a, b, n, dur = 0.9, delay = 0) => {
    const L = strandsTo(a, b); if (!L.length) return;
    for (let i = 0; i < n; i++) { const s = L[(R() * L.length) | 0];
      pulses[puNext] = { s, rev: s.a !== a, t: -delay - R() * 0.25, sp: 1 / (dur * (0.8 + R() * 0.4)), col: COL[b === 0 ? a : b] }; puNext = (puNext + 1) % NPU; }
  };
  const tmp3 = [0, 0, 0];
  const stepPulses = (dt) => {
    puA.fill(0);
    for (let i = 0; i < NPU; i++) { const p = pulses[i]; if (!p) continue;
      p.t += dt * p.sp; if (p.t >= 1.12) { pulses[i] = null; continue; }
      for (let k = 0; k < TAIL; k++) { const tt = p.t - k * 0.028; if (tt < 0 || tt > 1) continue;
        bz(p.s, p.rev ? 1 - tt : tt, tmp3, 0); const o = (i * TAIL + k) * 3; puPos[o] = tmp3[0]; puPos[o + 1] = tmp3[1]; puPos[o + 2] = tmp3[2];
        const w = k ? 1 - k / TAIL : 1, hot = k ? 0 : 0.55; puCol[o] = p.col[0] + (1 - p.col[0]) * hot; puCol[o + 1] = p.col[1] + (1 - p.col[1]) * hot; puCol[o + 2] = p.col[2] + (1 - p.col[2]) * hot;
        puA[i * TAIL + k] = (k ? 0.5 * w * w : 1) * Math.min(1, (1.12 - p.t) * 6); }
    }
    pug.attributes.position.needsUpdate = pug.attributes.aCol.needsUpdate = pug.attributes.aA.needsUpdate = true;
  };

  /* ---- 5. the instrument rings (theme units, in the brain's plane) ---- */
  const rings = new THREE.Group(); tilt.add(rings); rings.scale.setScalar(S);
  const RV = `${COMMON} attribute float aO; uniform vec3 uPri; varying float vO; void main(){ vO=aO; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const RF = `uniform float uFade; uniform vec3 uPri; varying float vO; void main(){ gl_FragColor=vec4(mix(uPri,vec3(1.0),0.25)*vO*uFade,1.0); }`;
  const ringMat = addMat(RV, RF);
  const lineSet = (fn) => { const v = [], o = []; fn((x0, y0, x1, y1, a) => { v.push(x0, y0, 0, x1, y1, 0); o.push(a, a); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('aO', new THREE.Float32BufferAttribute(o, 1));
    const L = new THREE.LineSegments(g, ringMat); L.renderOrder = 903; return L; };
  const circle = (r, a, seg = 256, a0 = 0, a1 = TAU, dash = 0) => (add) => { for (let i = 0; i < seg; i++) { if (dash && i % dash >= dash / 2) continue;
    const u0 = a0 + (a1 - a0) * i / seg, u1 = a0 + (a1 - a0) * (i + 1) / seg; add(Math.cos(u0) * r, Math.sin(u0) * r, Math.cos(u1) * r, Math.sin(u1) * r, a); } };
  const ticks = (r, n, l, a, every = 0, la = 0) => (add) => { for (let i = 0; i < n; i++) { const u = i / n * TAU, big = every && i % every === 0, ll = big ? l * 2.2 : l;
    add(Math.cos(u) * r, Math.sin(u) * r, Math.cos(u) * (r + ll), Math.sin(u) * (r + ll), big ? la : a); } };
  const inner = lineSet((add) => { circle(1.9, 0.26)(add); circle(1.885, 0.1)(add); });
  const tickA = lineSet(ticks(1.915, 240, 0.022, 0.16, 10, 0.34));
  const dashR = lineSet(circle(2.72, 0.2, 360, 0, TAU, 4));
  const tickB = lineSet(ticks(2.765, 360, 0.018, 0.12, 30, 0.3));
  const arcsA = lineSet((add) => { for (let k = 0; k < 4; k++) circle(2.85, 0.3, 40, k * TAU / 4, k * TAU / 4 + 0.55)(add); });
  const arcsB = lineSet((add) => { for (let k = 0; k < 3; k++) circle(2.91, 0.18, 40, k * TAU / 3 + 0.4, k * TAU / 3 + 0.4 + 0.9, 2)(add); });
  rings.add(inner, tickA, dashR, tickB, arcsA, arcsB);
  /* the barcode equaliser: 72 columns x 6 cells; idle = low noise, listening = mic level, thinking = charges round, speaking = voice */
  const BC = 72, BR = 6, bv = [], bcol = [], brow = [];
  for (let c = 0; c < BC; c++) for (let r = 0; r < BR; r++) {
    const a0 = c / BC * TAU + 0.012, a1 = (c + 1) / BC * TAU - 0.012, r0 = 1.965 + r * 0.033, r1 = r0 + 0.024;
    const q = [[a0, r0], [a1, r0], [a1, r1], [a0, r0], [a1, r1], [a0, r1]];
    q.forEach(([a, rr]) => { bv.push(Math.cos(a) * rr, Math.sin(a) * rr, 0); bcol.push(c); brow.push(r); });
  }
  const bcg = new THREE.BufferGeometry(); bcg.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
  bcg.setAttribute('aC', new THREE.Float32BufferAttribute(bcol, 1)); bcg.setAttribute('aRw', new THREE.Float32BufferAttribute(brow, 1));
  const bars = new THREE.Mesh(bcg, addMat(`uniform float uTime,uCharge,uEq,uSweep; attribute float aC,aRw; varying float vOn,vRw,vHead;
      void main(){ float u=aC/${BC}.0;
        float n=0.5+0.5*sin(aC*0.71+uTime*4.3)*sin(aC*0.23-uTime*2.9+1.3);
        float h=0.12+0.18*n+uEq*(0.35+0.65*n);                                         /* equaliser height 0..1 */
        float ch=fract(u-uSweep*0.159);                                                  /* charging: lit up to the sweep */
        float c=uCharge>0.0?step(ch,uCharge)*(0.5+0.5*n)+0.3*n:0.0;
        h=max(h,c); vOn=step(aRw/${BR}.0,h*0.999); vRw=aRw; vHead=exp(-ch*30.0)*step(0.001,uCharge);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    `uniform float uFade; uniform vec3 uPri; varying float vOn,vRw,vHead; void main(){ float a=(0.05+vOn*(0.32+vRw*0.04)+vHead*0.5)*uFade; gl_FragColor=vec4(mix(uPri,vec3(1.0),vHead*0.6+0.1)*a,1.0); }`));
  bars.renderOrder = 903; rings.add(bars);
  /* the radar sweep: a 70 degree trail at r 1.87 */
  const sweep = lineSet((add) => { for (let i = 0; i < 70; i++) { const u0 = -i / 70 * 1.22, u1 = -(i + 1) / 70 * 1.22;
    add(Math.cos(u0) * 1.87, Math.sin(u0) * 1.87, Math.cos(u1) * 1.87, Math.sin(u1) * 1.87, 0.55 * Math.pow(1 - i / 70, 2)); } });
  rings.add(sweep);

  /* ---- 6. the sector ring: one sector per ability, its name on it, lit while that ability works ---- */
  const sectors = new THREE.Group(); spinG.add(sectors);
  const cv = document.createElement('canvas'); cv.width = 4096; cv.height = 192; const cx = cv.getContext('2d');
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  for (let k = 0; k < NO; k++) { const x = (k + 0.5) / NO * cv.width, low = Math.sin(Math.PI / 2 - k * TAU / NO) < -0.2;
    cx.save(); cx.translate(x, 96); if (low) cx.rotate(Math.PI);      /* the lower half is turned round so every name reads upright */
    cx.fillStyle = '#fff'; cx.font = '600 66px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'; cx.fillText(MODS[k + 1].zh, 0, -24);
    cx.globalAlpha = 0.7; cx.font = '500 30px Michroma,"JetBrains Mono",monospace'; cx.fillText(MODS[k + 1].en, 0, 42); cx.globalAlpha = 1;
    cx.fillRect(-70, 72, 140, 3); cx.restore(); }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const sv = [], suv = [], sk = [], SEGS = 28, r0s = 2.32, r1s = 2.66;
  for (let k = 0; k < NO; k++) {
    const c = Math.PI / 2 - k * TAU / NO, half = TAU / NO / 2 - 0.012;
    for (let i = 0; i < SEGS; i++) {
      const f0 = i / SEGS, f1 = (i + 1) / SEGS, a0 = c + half - f0 * 2 * half, a1 = c + half - f1 * 2 * half;   /* clockwise, so text reads left to right */
      const u0 = (k + f0) / NO, u1 = (k + f1) / NO;
      const quad = [[a0, r0s, u0, 0], [a1, r0s, u1, 0], [a1, r1s, u1, 1], [a0, r0s, u0, 0], [a1, r1s, u1, 1], [a0, r1s, u0, 1]];
      quad.forEach(([a, r, u, v]) => { sv.push(Math.cos(a) * r, Math.sin(a) * r, 0); suv.push(u, v); sk.push(k + 1); });
    }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2)); sg.setAttribute('aK', new THREE.Float32BufferAttribute(sk, 1));
  const SCOL = new Float32Array(NM * 3); COL.forEach((c, i) => SCOL.set(c, i * 3));
  const secMat = addMat(`${COMMON} attribute float aK; varying vec2 vUv; varying float vA,vK; varying vec3 vC; uniform vec3 uCol[${NM}];
      void main(){ int k=int(aK+0.5); float fa=uFa[k]; vA=uAf[k]+(fa>=0.0?(1.0-fa)*0.8:0.0); vK=aK; vC=uCol[k]; vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    `uniform sampler2D uTex; uniform float uFade; varying vec2 vUv; varying float vA; varying vec3 vC;
      void main(){ float t=texture2D(uTex,vUv).a; float edge=smoothstep(0.0,0.04,vUv.y)*smoothstep(1.0,0.96,vUv.y);
        float rim=smoothstep(0.93,1.0,vUv.y)+smoothstep(0.07,0.0,vUv.y);
        float a=clamp(vA,0.0,1.5);
        vec3 c=vC*(0.025*edge+rim*(0.08+a*0.5)) + mix(vec3(0.75),vC*1.2+0.15,min(a*1.6,1.0))*t*(0.28+a*0.9);
        gl_FragColor=vec4(c*uFade,1.0); }`,
    Object.assign({}, FU, { uTex: { value: tex }, uCol: { value: COL.map(c => new THREE.Vector3(...c)) } }));
  const secMesh = new THREE.Mesh(sg, secMat); secMesh.renderOrder = 903; sectors.add(secMesh);
  /* leader lines: each sector's centre to its cluster */
  sectors.add(lineSet((add) => { for (let k = 1; k < NM; k++) { const a = Math.PI / 2 - (k - 1) * TAU / NO, c = CL[k], l = Math.hypot(c[0], c[1]);
    add(Math.cos(a) * 2.3, Math.sin(a) * 2.3, Math.cos(a) * 1.99, Math.sin(a) * 1.99, 0.18); add(c[0] / l * (l + 0.36), c[1] / l * (l + 0.36), Math.cos(a) * 1.86, Math.sin(a) * 1.86, 0.08); } }));

  /* ---- 7. depth: a slow shell of dust, and a soft glow at the brain ---- */
  const DN = lite ? 600 : 1400, dv = [], ds = [];
  for (let i = 0; i < DN; i++) { const u = R() * TAU, v = Math.acos(R() * 2 - 1), r = 3.2 + R() * 3.6;
    dv.push(Math.sin(v) * Math.cos(u) * r, Math.sin(v) * Math.sin(u) * r, Math.cos(v) * r * 0.7); ds.push(0.4 + R() * 0.8); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dv, 3)); dg.setAttribute('aS', new THREE.Float32BufferAttribute(ds, 1)); dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  const dust = new THREE.Points(dg, addMat(`uniform float uPixel,uFade,uZoomP; uniform vec3 uPri; attribute float aS; varying vec3 vC; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aS*uPixel*(6.4/-mv.z)*uZoomP; gl_Position=projectionMatrix*mv; vC=mix(uPri,vec3(1.0),0.4); vA=0.16*aS*uFade; }`, PT_F));
  dust.renderOrder = 899; spinG.add(dust);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), addMat(`varying vec2 vQ; void main(){ vQ=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    `${COMMON} uniform vec3 uPri; varying vec2 vQ; void main(){ float r=length(vQ)/0.8; float a=uAf[0];
      float g=exp(-r*r*9.0)*(0.18+a*0.3)+exp(-r*3.5)*0.05*(0.5+a); gl_FragColor=vec4(mix(uPri,vec3(1.0),0.55)*g*uFade,1.0); }`));
  glow.renderOrder = 898; spinG.add(glow);

  /* ---- what Jarvis is doing -> which ability fires ---- */
  const ev = new Float32Array(NM), fa = FU.uFa.value, af = FU.uAf.value;
  let micLvl = 0, lastHand = 0;
  const fire = (id, opts = {}) => { const k = typeof id === 'number' ? id : M[id]; if (k == null) return;
    ev[k] = Math.max(ev[k], opts.k || 1); fa[k] = 0;
    if (k && !opts.quiet) { send(0, k, opts.n || 12, 0.8); send(k, 0, opts.n || 12, 0.9, 0.55); }   /* the request goes out, the answer comes back */
  };
  const TOOL = { control_home: 'home', home: 'home', get_system_status: 'sys', manage_schedule: 'plan', get_weather: 'weather', plan_route: 'nav',
    save_place: 'nav', ask_harness: 'harness', harness_jobs: 'harness', set_screen: 'skin', set_skin: 'skin', show_machine_hologram: 'holo', remember: 'memory', recall: 'memory' };
  const onMsg = (m) => {
    const t = m && m.type; if (!t) return;
    if (t === 'wake') { fire('ear', { quiet: true }); send(M.ear, 0, 18, 0.7); }
    else if (t === 'you') { fire('ear', { quiet: true }); send(M.ear, 0, 30, 0.75); ev[0] = 1; fa[0] = 0; }   /* what you said reaches the brain */
    else if (t === 'jarvis') { fire('voice', { quiet: true }); send(0, M.voice, 26, 0.7); }
    else if (t === 'level') micLvl = Math.max(micLvl, Math.min(1, (m.mic || 0) * 6));
    else if (t === 'sys') { ev[M.sys] = Math.max(ev[M.sys], 0.3); send(M.sys, 0, 2, 1.4); }
    else if (t === 'schedule') fire('plan');
    else if (t === 'weather') fire('weather');
    else if (t === 'trip') fire('nav');
    else if (t === 'machine' || t === 'starship' || t === 'roadster' || t === 'optimus' || t === 'earth') fire('holo');
    else if (t === 'brain') fire('harness', { n: 8 });
    else if (t === 'hand' || t === 'hand_frame') { if (performance.now() - lastHand > 900) { lastHand = performance.now(); fire('hand', { n: 4 }); } }
    else if (t === 'enroll' || t === 'not_you') fire('ident');
    else if (t === 'skin') fire('skin');
    else if (t === 'history') fire('memory');
    else if (t === 'tool' || t === 'tool_call') { const k = TOOL[m.name] || (MODS.find(x => x.id === m.name) || {}).id; if (k) fire(k); }
  };

  /* ---- motion + control ---- */
  let uYaw = 0, uPitch = 0, zoom = 1, zoomGoal = 1;
  const onWheel = (e) => { if (typeof machLive === 'function' && machLive()) return; e.preventDefault(); zoomGoal = Math.min(2.6, Math.max(0.55, zoomGoal * Math.exp(-e.deltaY * 0.0016))); };
  const onDbl = () => { zoomGoal = 1; uPitch = 0; uYaw = 0; };
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl);
  const ease = (x, y, k, dt) => x + (y - x) * (1 - Math.pow(k, dt));
  let t = 0, fade = 0, energy = 0.5, spin = 0,   /* abilities keep their places, so the brain itself does not spin */
    sweepA = 0, sweepSp = 0.85, charge = 0, eq = 0, wave = -1, lastWave = 0, scan = 0, prevSt = 'idle';
  let accIdle = 0, accEar = 0, accThink = 0, accVoice = 0, pitch = -0.62, lastIn = 0;
  const base = new Float32Array(NM);
  return {
    msg: onMsg,
    frame(dt) {
      dt = Math.min(dt, 0.1);
      const st = typeof state === 'string' ? state : 'idle', vib = st === 'speaking' ? U.uVib.value : 0;
      t += dt; fade = Math.min(1, fade + dt / 0.9);
      if (st !== prevSt) { if (st === 'thinking') { charge = 0.001; scan = 0; } prevSt = st; }
      micLvl *= Math.pow(0.15, dt);
      /* per-state base activity of each ability */
      const breath = 0.5 + 0.5 * Math.sin(t * TAU / 6);
      base.fill(0.06 + 0.06 * breath); base[0] = 0.22 + 0.12 * breath;
      let eT = 0.45 + 0.25 * breath, sweepT = 0.85, eqT = 0.04, pitchT = -0.62;
      if (st === 'listening') { base[M.ear] = 0.45 + micLvl * 0.9; base[0] = 0.4; eT = 0.95; sweepT = 0.5; eqT = 0.15 + micLvl * 0.8; pitchT = -0.55; }
      else if (st === 'thinking') {
        base[0] = 1; eT = 1.15; sweepT = 2.6; eqT = 0.1; pitchT = -0.48;
        scan += dt * 2.2;                                              /* the brain looks round its abilities, one after another */
        for (let k = 1; k < NM; k++) { const d = Math.abs(((k - 1 - scan) % NO + NO * 1.5) % NO - NO * 0.5); base[k] = Math.max(base[k], 0.55 * Math.exp(-d * d * 1.2)); }
        charge = Math.min(1, charge + dt / 3.2);
      }
      else if (st === 'speaking') { base[M.voice] = 0.5 + vib * 0.9; base[0] = 0.5 + vib * 0.4; eT = 0.8 + vib * 0.5; sweepT = 1.2; eqT = 0.2 + vib * 0.9; pitchT = -0.58; }
      if (st !== 'thinking') charge = Math.max(0, charge - dt / 0.8);
      for (let k = 0; k < NM; k++) { ev[k] *= Math.pow(0.35, dt); af[k] = ease(af[k], Math.max(base[k], ev[k]), 0.02, dt);
        if (fa[k] >= 0) { fa[k] += dt / 1.3; if (fa[k] >= 1) fa[k] = -1; } }
      /* signal traffic, in the direction the work flows */
      accIdle += dt * (st === 'idle' ? 0.9 : 0.4);
      while (accIdle > 1) { accIdle -= 1; const k = 1 + ((R() * NO) | 0); R() < 0.5 ? send(k, k % NO + 1, 2, 1.3) : send(k, 0, 2, 1.2); }
      if (st === 'listening') { accEar += dt * (5 + micLvl * 45); while (accEar > 1) { accEar -= 1; send(M.ear, 0, 1, 0.75); } }
      if (st === 'thinking') { accThink += dt * 14; while (accThink > 1) { accThink -= 1;
          const k = 1 + ((Math.round(scan) % NO + NO) % NO); send(0, k, 1, 0.65); if (R() < 0.45) send(1 + ((R() * NO) | 0), 0, 1, 0.8); } }
      if (st === 'speaking') { accVoice += dt * (5 + vib * 32); while (accVoice > 1) { accVoice -= 1; send(0, M.voice, 1, 0.6); }
        if (vib > 0.55 && t - lastWave > 0.5) { wave = 0; lastWave = t; } }
      if (wave >= 0) { wave += dt / 1.4; if (wave >= 1) wave = -1; }
      stepPulses(dt);
      energy = ease(energy, eT, 0.2, dt); sweepSp = ease(sweepSp, sweepT, 0.25, dt); eq = ease(eq, eqT, 0.05, dt); pitch = ease(pitch, pitchT, 0.3, dt);
      sweepA += dt * sweepSp;
      /* view: tilted plane, a slow look-around like the original's orbit camera, plus drag / palm */
      uYaw += rotV.y * 1.8; uPitch = Math.max(-0.9, Math.min(1.1, uPitch + rotV.x * 1.4));
      zoom = ease(zoom, zoomGoal, 0.05, dt); grp.scale.setScalar(zoom); FU.uZoomP.value = Math.sqrt(zoom);
      tilt.rotation.set(pitch + uPitch + 0.06 * Math.sin(t * 0.051), 0.22 * Math.sin(t * 0.07) + uYaw, 0, 'YXZ');
      spinG.rotation.z = spin;
      tickA.rotation.z = t * 0.02; tickB.rotation.z = -t * 0.008; dashR.rotation.z = t * 0.05; arcsA.rotation.z = t * 0.09; arcsB.rotation.z = -t * 0.06;
      sweep.rotation.z = -sweepA; bars.rotation.z = spin * 0.5; dust.rotation.z = -t * 0.006;
      const g = U.uGain.value;
      FU.uTime.value = t; FU.uFade.value = fade * g; FU.uEnergy.value = energy; FU.uWave.value = wave; FU.uCharge.value = charge;
      FU.uEq.value = eq; FU.uSweep.value = sweepA - spin * 0.5; FU.uScan.value = scan;
      grp.visible = g > 0.02;
      orbits.visible = false; labelBox.style.opacity = '0';
      rainM.opacity *= 0.2; rpM.opacity *= 0.2;
      bloom.strength *= 0.97;
    },
    dispose() { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('dblclick', onDbl); scene.remove(grp);
      grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); tex.dispose(); }
  };
};
/* core:neural>> */
