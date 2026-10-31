'use strict';
/* <<core:kit */
/* Shared pieces for the rewritten skin cores (Claude, 2026-10-29): Jarvis's abilities, which message means which ability
   is at work, the 3D control every core shares (drag / palm turns it, wheel zooms, double-click resets), and small helpers. */
const SKAB = [
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
const SKAB_I = Object.fromEntries(SKAB.map((a, i) => [a.id, i]));
const SK_TOOL = { control_home: 'home', home: 'home', get_system_status: 'sys', manage_schedule: 'plan', get_weather: 'weather', plan_route: 'nav',
  save_place: 'nav', ask_harness: 'harness', harness_jobs: 'harness', set_screen: 'skin', set_skin: 'skin', show_machine_hologram: 'holo', remember: 'memory', recall: 'memory' };
let skHandT = 0;
/* a voice-service message -> what it means for a core: wake / heard / reply / level / sys tick / an ability put to use */
function skEvent(m) {
  const t = m && m.type; if (!t) return null;
  if (t === 'wake') return { k: 'wake' };
  if (t === 'you') return { k: 'heard' };
  if (t === 'jarvis') return { k: 'reply' };
  if (t === 'level') return { k: 'level', v: Math.min(1, (m.mic || 0) * 6) };
  if (t === 'sys') return { k: 'sys' };
  const use = (id) => ({ k: 'use', id, i: SKAB_I[id] });
  if (t === 'schedule') return use('plan');
  if (t === 'weather') return use('weather');
  if (t === 'trip') return use('nav');
  if (t === 'machine' || t === 'starship' || t === 'roadster' || t === 'optimus' || t === 'earth') return use('holo');
  if (t === 'brain') return use('harness');
  if (t === 'hand' || t === 'hand_frame') { const n = performance.now(); if (n - skHandT < 900) return null; skHandT = n; return use('hand'); }
  if (t === 'enroll' || t === 'not_you') return use('ident');
  if (t === 'skin') return use('skin');
  if (t === 'history') return use('memory');
  if (t === 'tool' || t === 'tool_call') { const id = SK_TOOL[m.name] || (SKAB_I[m.name] != null ? m.name : null); return id ? use(id) : null; }
  return null;
}
const skHex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const skSeeded = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const skEase = (x, y, k, dt) => x + (y - x) * (1 - Math.pow(k, dt));
/* the 3D control every rewritten core shares */
function skControl(pitch0 = 0) {
  const c = { yaw: 0, pitch: 0, zoom: 1, goal: 1 };
  const onWheel = (e) => { if (typeof machLive === 'function' && machLive()) return; e.preventDefault(); c.goal = Math.min(2.6, Math.max(0.55, c.goal * Math.exp(-e.deltaY * 0.0016))); };
  const onDbl = () => { c.goal = 1; c.pitch = 0; c.yaw = 0; };
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl);
  c.step = (dt) => { c.yaw += rotV.y * 1.8; c.pitch = Math.max(-1.0, Math.min(1.0, c.pitch + rotV.x * 1.4)); c.zoom = skEase(c.zoom, c.goal, 0.05, dt); };
  c.dispose = () => { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('dblclick', onDbl); };
  return c;
}
/* the default look's silk-core labels and light rain do not belong to a rewritten core */
function skQuiet(bloomK = 0.97) { orbits.visible = false; labelBox.style.opacity = '0'; rainM.opacity *= 0.2; rpM.opacity *= 0.2; bloom.strength *= bloomK; }
/* a name card for an ability: Chinese name over the English one, white on transparent (tinted by the sprite colour) */
function skLabelTex(zh, en, w = 256, h = 96) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.font = `600 ${Math.round(h * 0.4)}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`; x.fillText(zh, w / 2, h * 0.36);
  x.globalAlpha = 0.65; x.font = `500 ${Math.round(h * 0.17)}px Michroma,"JetBrains Mono",monospace`; x.fillText(en, w / 2, h * 0.8);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
}
/* soft round points, additive; vC / vA from the vertex shader */
const SK_SOFT_F = `varying vec3 vC; varying float vA; void main(){ vec2 q=gl_PointCoord-0.5; float r=length(q); if(r>0.5) discard;
  float k=smoothstep(0.5,0.0,r); k=k*k*(0.6+0.4*smoothstep(0.18,0.0,r)); gl_FragColor=vec4(vC*vA*k,1.0); }`;
const skAdd = (uniforms, vertexShader, fragmentShader, extra) => new THREE.ShaderMaterial(Object.assign({ uniforms, vertexShader, fragmentShader,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }, extra || {}));
/* core:kit>> */
