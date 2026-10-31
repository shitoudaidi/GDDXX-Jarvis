/* 地球此刻 · EARTH, RIGHT NOW: a globe with six live cards about the world around the user.
   Every card answers a question somebody actually asks, for where they are (home from the AMap home address):
   flights near you and flight lookup · space-station passes you can see tonight · earthquakes nearest you ·
   typhoons and how far they are · world news hot spots · next rocket launch · wind · aurora and solar storms.
   Data comes from jarvis/plugins/earth.py (public feeds fetched on this computer). Coverage limits are written on screen.
   Own WebGL canvas above the HUD, DOM cards in two columns that scroll, an SVG for the lines.
   install(ctx) -> { command, data, frame, hand, hand2, hide, live, state }. */
export function install(ctx) {
  const { THREE } = ctx;
  const send = ctx.send || (() => false);
  const dim = ctx.dim || (() => {});
  const PI = Math.PI, D2R = PI / 180, R2D = 180 / PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ------------------------------------------------------------------ cards */
  /* order = how they are numbered and read: row by row, left then right (matches earth.py CARDS) */
  const CARDS = [
    { k: 'flights', t: '航班', en: 'FLIGHTS · NEAR YOU', unit: '架', warm: false, q: '这班飞机飞到哪了？我头顶飞过的是哪班？' },
    { k: 'stations', t: '头顶的卫星', en: 'SATELLITES · OVER YOU', unit: '颗', warm: true, q: '我头顶此刻有多少颗卫星？今晚能用肉眼看到哪颗？' },
    { k: 'quakes', t: '地震', en: 'EARTHQUAKES · NEAR YOU', unit: '次', warm: true, q: '刚才是不是地震了？离我多远？' },
    { k: 'storms', t: '台风', en: 'TROPICAL CYCLONES', unit: '', warm: false, q: '台风离我多远？会不会过来？' },
    { k: 'news', t: '全球新闻热点', en: 'NEWS · LAST HOUR', unit: '', warm: true, q: '此刻全世界在关注哪里？' },
    { k: 'launch', t: '火箭发射', en: 'NEXT LAUNCH', unit: '', warm: true, q: '下一次发射是什么时候？' },
  ];
  const IDX = Object.fromEntries(CARDS.map((c, i) => [c.k, i]));
  const D = {};                         /* card -> latest data message */
  const ST = { on: false, ending: false, mode: 'off', card: -1, t: 0, appear: 0, popAt: 0, openAt: 0, hover: -1, pinchWas: false, fistAt: 0, flightQ: '' };

  /* ------------------------------------------------------------------ DOM */
  const css = document.createElement('style');
  css.textContent = `
#ew{position:fixed;inset:0;z-index:8;pointer-events:none;opacity:0;transition:opacity .5s;font-family:var(--f-cn);color:rgb(var(--sk-ink,220,239,247))}
#ew.on{opacity:1}
#ew.wall .ew-gl,#ew.card .ew-gl{pointer-events:auto;cursor:grab}
#ew .ew-gl.drag{cursor:grabbing}
#ew .ew-gl{position:absolute;inset:0;width:100%;height:100%;display:block}
#ew svg.ew-links{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#ew .ew-links path{fill:none;stroke-width:1.1;vector-effect:non-scaling-stroke}
#ew .ew-links circle{vector-effect:non-scaling-stroke}
#ew .ew-col{position:absolute;top:6.5vh;bottom:6.5vh;width:min(23.5vw,410px);display:flex;flex-direction:column;justify-content:space-between;gap:1.6vh}
#ew .ew-col.l{left:max(22px,1.8vw)}#ew .ew-col.r{right:max(22px,1.8vw)}
#ew .ew-card{position:relative;flex:1;min-height:0;border:1px solid rgba(var(--sk-pri),.42);border-radius:3px;overflow:hidden;
  background:linear-gradient(180deg,rgba(var(--sk-pnl),.62),rgba(var(--sk-pnl),.38));-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);
  box-shadow:0 0 0 1px rgba(var(--sk-pri),.06) inset,0 0 26px rgba(var(--sk-pri),.07);opacity:0;transform:translateX(var(--dx)) scale(.9);
  transition:transform .55s cubic-bezier(.2,.9,.25,1.15),opacity .35s,filter .5s,border-color .3s,box-shadow .3s;pointer-events:none;cursor:pointer}
#ew .ew-col.l .ew-card{--dx:-46px}#ew .ew-col.r .ew-card{--dx:46px}
#ew.wall .ew-card.in{opacity:1;transform:none;pointer-events:auto}
#ew .ew-card.flash{border-color:rgba(var(--sk-hi),.95);box-shadow:0 0 0 1px rgba(var(--sk-hi),.35) inset,0 0 42px rgba(var(--sk-pri),.45)}
#ew .ew-card.hover{border-color:rgba(var(--sk-hi),.9);box-shadow:0 0 0 1px rgba(var(--sk-pri),.3) inset,0 0 34px rgba(var(--sk-pri),.3)}
#ew.card .ew-card{opacity:.14;filter:blur(7px);transform:scale(.9);pointer-events:none}
#ew .ew-card.gone{visibility:hidden}
#ew .ew-card::before,#ew .ew-card::after,#ew .ew-panel::before,#ew .ew-panel::after{content:"";position:absolute;width:12px;height:12px;border:1.5px solid rgba(var(--sk-hi),.85);pointer-events:none;z-index:2}
#ew .ew-card::before,#ew .ew-panel::before{left:-1px;top:-1px;border-right:0;border-bottom:0}
#ew .ew-card::after,#ew .ew-panel::after{right:-1px;bottom:-1px;border-left:0;border-top:0}
#ew .ew-card canvas{position:absolute;inset:0;width:100%;height:100%;-webkit-mask-image:linear-gradient(90deg,transparent 4%,rgba(0,0,0,.55) 34%,#000 62%);mask-image:linear-gradient(90deg,transparent 4%,rgba(0,0,0,.55) 34%,#000 62%)}
#ew .ew-txt{position:absolute;left:18px;top:13px;right:14px;bottom:11px;display:flex;flex-direction:column;z-index:1}
#ew .ew-t{display:flex;align-items:center;gap:8px;font-size:clamp(13px,1.05vw,17px);letter-spacing:1px;color:rgb(var(--sk-ink0,232,245,250));text-shadow:0 0 12px rgba(0,0,0,.9)}
#ew .ew-t i{font-style:normal;font:500 10.5px/1 var(--f-latin);letter-spacing:1px;color:rgba(var(--sk-pri),.85);border:1px solid rgba(var(--sk-pri),.45);padding:3px 5px 2px;border-radius:2px}
#ew .ew-en{font:400 9.5px/1 var(--f-latin);letter-spacing:2px;color:rgba(var(--sk-pri),.6);margin-top:5px}
#ew .ew-n{margin-top:auto;display:flex;align-items:baseline;gap:7px;font:300 clamp(28px,2.75vw,48px)/1 var(--f-latin);letter-spacing:.5px;color:rgb(var(--sk-hi,228,248,255));text-shadow:0 0 18px rgba(var(--sk-pri),.55),0 0 2px rgba(0,0,0,.9)}
#ew .ew-card.warm .ew-n{color:rgb(var(--sk-accl,255,194,122));text-shadow:0 0 18px rgba(var(--sk-acc),.5)}
#ew .ew-n small{font:400 clamp(12px,.95vw,15px)/1 var(--f-cn);color:rgba(var(--sk-ink),.75);letter-spacing:1px}
#ew .ew-n.wait{font-size:clamp(16px,1.3vw,20px);color:rgba(var(--sk-ink),.5);text-shadow:none;letter-spacing:2px}
#ew .ew-s{margin-top:7px;font-size:11px;color:rgba(var(--sk-ink),.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 8px #000}
#ew .ew-dot{width:6px;height:6px;border-radius:50%;background:rgba(var(--sk-ink),.3);margin-left:auto;flex:none}
#ew .ew-dot.live{background:#5cf2a0;box-shadow:0 0 8px #5cf2a0;animation:ewBlink 1.6s infinite}
#ew .ew-dot.stale{background:rgb(var(--sk-acc))}#ew .ew-dot.offline{background:#ff5a4a}
@keyframes ewBlink{50%{opacity:.35}}
#ew .ew-head{position:absolute;left:50%;top:3.2vh;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .6s}
#ew.wall .ew-head{opacity:1}
#ew .ew-head b{display:block;font:500 12px/1 var(--f-latin);letter-spacing:6px;color:rgba(var(--sk-pri),.85)}
#ew .ew-head span{display:block;margin-top:7px;font:300 11px/1 var(--f-latin);letter-spacing:2px;color:rgba(var(--sk-ink),.55)}
#ew .ew-flyer{position:fixed;z-index:3;border:1px solid rgba(var(--sk-hi),.9);border-radius:3px;overflow:hidden;pointer-events:none;
  background:rgba(var(--sk-pnl),.45);box-shadow:0 0 60px rgba(var(--sk-pri),.5),0 0 0 1px rgba(var(--sk-pri),.4) inset}
#ew .ew-full{position:absolute;inset:0;opacity:0;transition:opacity .6s;pointer-events:none}
#ew .ew-col{overflow-y:auto;overflow-x:visible;scrollbar-width:none;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent);padding:14px 4px;margin:-14px -4px;justify-content:flex-start}
#ew .ew-col::-webkit-scrollbar{display:none}
#ew .ew-col .ew-card{flex:none;height:calc((87vh - 3.2vh) / 3)}
#ew .ew-q{margin-top:6px;font-size:11px;color:rgba(var(--sk-ink),.5);letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ew .ew-home{position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .4s}
#ew .ew-home.on{opacity:1}
#ew .ew-home i{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;border:2px solid #5cf2a0;box-shadow:0 0 12px #5cf2a0}
#ew .ew-home i::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:1px solid rgba(92,242,160,.7);animation:ewHome 2s ease-out infinite}
@keyframes ewHome{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}
#ew .ew-home span{position:absolute;left:14px;top:-9px;white-space:nowrap;font-size:12px;color:#aaf7cf;text-shadow:0 0 6px #000,0 0 2px #000;letter-spacing:1px}
#ew .ew-tag2{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;font-size:12px;letter-spacing:1px;color:rgb(var(--sk-accl));text-shadow:0 0 6px #000;opacity:0;transition:opacity .4s}
#ew .ew-tag2.on{opacity:1}
#ew .ew-tag2 b{font-weight:400;color:rgba(var(--sk-ink),.7);margin-left:6px;font-size:11px}
#ew .ew-search{display:flex;gap:8px;margin:0 0 12px}
#ew .ew-search input{flex:1;min-width:0;padding:8px 10px;border:1px solid rgba(var(--sk-pri),.45);border-radius:3px;background:rgba(0,0,0,.35);color:rgb(var(--sk-hi));font:14px/1 var(--f-latin);letter-spacing:1px;outline:none}
#ew .ew-search input:focus{border-color:rgb(var(--sk-hi))}
#ew .ew-search button{padding:0 12px;border:1px solid rgba(var(--sk-pri),.55);border-radius:3px;background:rgba(var(--sk-pri),.12);color:rgb(var(--sk-ink));font:13px var(--f-cn);cursor:pointer}
#ew .ew-panel .row.click{cursor:pointer}#ew .ew-panel .row.click:hover span{color:rgb(var(--sk-hi))}
#ew .ew-panel .res{padding:10px 12px;margin-bottom:12px;border:1px solid rgba(var(--sk-acc),.5);border-radius:3px;background:rgba(var(--sk-acc),.06);line-height:1.7}
#ew .ew-panel .res b{font:400 18px/1.3 var(--f-latin);color:rgb(var(--sk-accl))}
#ew .ew-panel .res .rt{font-size:15px;color:rgb(var(--sk-hi))}
#ew .ew-panel .bars{display:flex;align-items:flex-end;gap:2px;height:64px;margin:6px 0 4px}
#ew .ew-panel .bars i{flex:1;background:rgba(var(--sk-pri),.55);min-height:2px}
#ew .ew-panel .bars i.g{background:rgb(var(--sk-acc))}#ew .ew-panel .bars i.now{outline:1px solid rgb(var(--sk-hi))}
#ew .ew-panel .axis{display:flex;justify-content:space-between;font-size:10.5px;color:rgba(var(--sk-ink),.5)}
#ew .ew-panel{max-height:76vh;overflow-y:auto;scrollbar-width:thin}
#ew .ew-hint{position:absolute;left:50%;bottom:4.2vh;transform:translateX(-50%);padding:7px 16px;border:1px solid rgba(var(--sk-pri),.35);border-radius:16px;background:rgba(var(--sk-pnl),.6);font-size:12px;letter-spacing:1px;color:rgba(var(--sk-ink),.75);opacity:0;transition:opacity .8s;white-space:nowrap}
#ew .ew-hint.on{opacity:1}
#ew.card.ready .ew-full{opacity:1}
#ew.card.ready .ew-full .ew-back,#ew.card.ready .ew-full .ew-panel{pointer-events:auto}
#ew .ew-ftitle{position:absolute;left:max(28px,2.4vw);top:6vh;max-width:40vw}
#ew .ew-ftitle .ew-t{font-size:clamp(18px,1.6vw,26px);letter-spacing:3px}
#ew .ew-ftitle .ew-n{font-size:clamp(46px,4.6vw,78px);margin-top:14px}
#ew .ew-ftitle .ew-s{font-size:12.5px;margin-top:12px}
#ew .ew-tag{display:inline-block;margin-top:10px;padding:4px 8px 3px;border:1px dashed rgba(var(--sk-acc),.7);color:rgb(var(--sk-accl));font:400 11px/1 var(--f-cn);letter-spacing:1px;border-radius:2px}
#ew .ew-tag:empty{display:none}
#ew .ew-back{position:absolute;left:max(28px,2.4vw);bottom:5vh;display:flex;align-items:center;gap:8px;padding:8px 16px 8px 12px;border:1px solid rgba(var(--sk-pri),.45);border-radius:20px;
  background:rgba(var(--sk-pnl),.72);color:rgb(var(--sk-ink));font:13px/1 var(--f-cn);letter-spacing:1px;cursor:pointer}
#ew .ew-back:hover{border-color:rgba(var(--sk-hi),.9)}
#ew .ew-panel{position:absolute;right:max(28px,2.4vw);top:14vh;width:min(24vw,380px);padding:18px 20px 16px;border:1px solid rgba(var(--sk-pri),.4);border-radius:3px;
  background:rgba(var(--sk-pnl),.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-size:13px}
#ew .ew-panel:empty{display:none}
#ew .ew-panel.low{top:auto;bottom:6vh;width:min(20vw,320px);padding:14px 16px 12px}
#ew .ew-panel.low .row{padding:4px 0}
#ew .ew-panel h3{margin:0 0 12px;font:500 11px/1 var(--f-latin);letter-spacing:3px;color:rgba(var(--sk-pri),.8)}
#ew .ew-panel .row{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-top:1px solid rgba(var(--sk-pri),.12)}
#ew .ew-panel .row:first-of-type{border-top:0}
#ew .ew-panel .row b{font:400 15px/1 var(--f-latin);color:rgb(var(--sk-hi));min-width:52px}
#ew .ew-panel .row.warm b{color:rgb(var(--sk-accl))}
#ew .ew-panel .row span{flex:1;min-width:0;color:rgba(var(--sk-ink),.82);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ew .ew-panel .row em{font-style:normal;font-size:11px;color:rgba(var(--sk-ink),.5);white-space:nowrap}
#ew .ew-panel .bar{height:3px;margin-top:5px;background:rgba(var(--sk-pri),.12)}
#ew .ew-panel .bar i{display:block;height:100%;background:linear-gradient(90deg,rgba(var(--sk-pri),.5),rgb(var(--sk-pri)))}
#ew .ew-panel .big{font:300 34px/1.1 var(--f-latin);color:rgb(var(--sk-accl));letter-spacing:1px;margin:2px 0 10px}
#ew .ew-panel .note{margin-top:12px;font-size:11px;line-height:1.5;color:rgba(var(--sk-ink),.5)}
#ew .ew-lock{position:absolute;left:0;top:0;opacity:0;transition:opacity .4s;pointer-events:none}
#ew .ew-lock.on{opacity:1}
#ew .ew-lock .box{position:absolute;left:-23px;top:-23px;width:46px;height:46px}
#ew .ew-lock .box i{position:absolute;width:12px;height:12px;border:1.5px solid rgb(var(--sk-hi))}
#ew .ew-lock .box i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}#ew .ew-lock .box i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
#ew .ew-lock .box i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}#ew .ew-lock .box i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
#ew .ew-lock .box{animation:ewLock 2.4s ease-in-out infinite}
@keyframes ewLock{50%{transform:scale(1.12)}}
#ew .ew-lock svg{position:absolute;left:0;top:0;overflow:visible}
#ew .ew-lock .info{position:absolute;left:150px;top:-44px;min-width:210px;padding:12px 16px;border:1px solid rgba(var(--sk-pri),.55);border-radius:4px;
  background:rgba(var(--sk-pnl),.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-size:13px;line-height:1.95;white-space:nowrap}
#ew .ew-lock .info b{display:inline-block;width:44px;font-weight:400;color:rgba(var(--sk-ink),.6)}
#ew .ew-lock .info span{font:400 15px/1 var(--f-latin);color:rgb(var(--sk-hi));letter-spacing:.5px}
`;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = 'ew';
  root.innerHTML = `<canvas class="ew-gl"></canvas><svg class="ew-links"></svg>
    <div class="ew-head"><b>EARTH · NOW</b><span class="ew-clock"></span></div>
    <div class="ew-col l"></div><div class="ew-col r"></div>
    <div class="ew-full">
      <div class="ew-ftitle"><div class="ew-t"></div><div class="ew-n"></div><div class="ew-s"></div><span class="ew-tag"></span></div>
      <div class="ew-panel"></div>
      <button type="button" class="ew-back"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>全部卡片</button>
    </div>
    <div class="ew-hint"></div><div class="ew-home"><i></i><span></span></div><div class="ew-tag2" data-i="0"></div><div class="ew-tag2" data-i="1"></div><div class="ew-tag2 ap"></div><div class="ew-tag2 ap"></div><div class="ew-lock"><svg width="1" height="1"><path d="" stroke="rgba(160,225,255,.7)" stroke-width="1" fill="none"/><circle r="2.5" fill="rgb(228,248,255)"/></svg><div class="box"><i></i><i></i><i></i><i></i></div><div class="info"></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const svg = $('svg.ew-links'), clockEl = $('.ew-clock'), full = $('.ew-full'), panel = $('.ew-panel');
  const fT = $('.ew-ftitle .ew-t'), fN = $('.ew-ftitle .ew-n'), fS = $('.ew-ftitle .ew-s'), fTag = $('.ew-ftitle .ew-tag');
  const homeEl = $('.ew-home'), homeTx = $('.ew-home span'), stTags = [...root.querySelectorAll('.ew-tag2:not(.ap)')], apTags = [...root.querySelectorAll('.ew-tag2.ap')];
  const lockEl = $('.ew-lock'), lockInfo = $('.ew-lock .info'), lockPath = $('.ew-lock path'), lockDot = $('.ew-lock circle');
  $('.ew-back').addEventListener('click', () => close());
  document.addEventListener('click', (e) => {
    if (ST.mode === 'card' && e.target && e.target.closest && e.target.closest('#demoBack')) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  const hint = $('.ew-hint');
  let hintT = 0;
  function showHint(text) { hint.textContent = text; hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove('on'), 4200); }

  const cardEls = CARDS.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'ew-card' + (c.warm ? ' warm' : '');
    el.innerHTML = `<canvas></canvas><div class="ew-txt"><div class="ew-t"><i>${pad2(i + 1)}</i><span>${c.t}</span><span class="ew-dot"></span></div>
      <div class="ew-en">${c.en}</div><div class="ew-q">${c.q}</div><div class="ew-n wait">获取中…</div><div class="ew-s">&nbsp;</div></div>`;
    (i % 2 ? $('.ew-col.r') : $('.ew-col.l')).appendChild(el);
    el.addEventListener('click', () => { if (ST.mode === 'wall') open(i); });
    el.addEventListener('mouseenter', () => { if (ST.mode === 'wall') el.classList.add('hover'); });
    el.addEventListener('mouseleave', () => el.classList.remove('hover'));
    return el;
  });
  const cardCv = cardEls.map(el => el.querySelector('canvas'));
  const cardN = cardEls.map(el => el.querySelector('.ew-n'));
  const cardS = cardEls.map(el => el.querySelector('.ew-s'));
  const cardDot = cardEls.map(el => el.querySelector('.ew-dot'));
  const shown = CARDS.map(() => ({ v: null, from: 0, to: 0, at: 0 }));   /* number tween per card */

  const NS = 'http://www.w3.org/2000/svg';
  const links = CARDS.map((c) => {
    const g = document.createElementNS(NS, 'g');
    const p = document.createElementNS(NS, 'path'), r = document.createElementNS(NS, 'circle'), d = document.createElementNS(NS, 'circle'), e = document.createElementNS(NS, 'circle');
    const col = c.warm ? 'rgba(var(--sk-acc),.75)' : 'rgba(var(--sk-pri),.7)';
    p.setAttribute('stroke', col); r.setAttribute('fill', 'none'); r.setAttribute('stroke', col); r.setAttribute('r', '7');
    d.setAttribute('r', '2.6'); d.setAttribute('fill', c.warm ? 'rgb(var(--sk-accl))' : 'rgb(var(--sk-hi))');
    e.setAttribute('r', '2.2'); e.setAttribute('fill', col);
    g.append(p, r, d, e); svg.appendChild(g);
    return { g, p, r, d, e, k: 0, len: 0 };
  });

  /* ------------------------------------------------------------------ three */
  const canvas = $('.ew-gl');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  const PR = Math.min(devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 100);
  camera.position.set(0, 0, 5.4);
  const globe = new THREE.Group(); globe.rotation.order = 'XYZ'; scene.add(globe);
  const SUN = new THREE.Vector3(1, 0, 0);
  const COL = { pri: [0.5, 0.86, 1.0], hi: [0.89, 0.97, 1.0], acc: [1.0, 0.68, 0.42], red: [1.0, 0.38, 0.28], fire: [1.0, 0.5, 0.18] };
  function skinCol() {   /* follow the HUD skin colours where they exist */
    try {
      const cs = getComputedStyle(document.body);
      const g = (v, f) => { const s = cs.getPropertyValue(v).trim(); if (!s) return f; const a = s.split(',').map(x => +x / 255); return a.length === 3 && a.every(x => x >= 0) ? a : f; };
      COL.pri = g('--sk-pri', COL.pri); COL.hi = g('--sk-hi', COL.hi); COL.acc = g('--sk-acc', COL.acc);
    } catch (_) {}
  }

  const ll = (lat, lon, r = 1, out = new THREE.Vector3()) => {
    const a = lat * D2R, b = lon * D2R, c = Math.cos(a);
    return out.set(r * c * Math.cos(b), r * Math.sin(a), -r * c * Math.sin(b));
  };

  /* --- the planet: night lights + day side split by the real terminator, hologram tint, rim, scan band */
  let base = null;
  const loader = new THREE.TextureLoader();
  const texNight = loader.load('media/earth/earth-night.jpg', () => { baseReady(); });
  const texDay = loader.load('media/earth/earth-day.jpg');
  [texNight, texDay].forEach(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  const U = { uNight: { value: texNight }, uDay: { value: texDay }, uSun: { value: SUN }, uTime: { value: 0 }, uAlpha: { value: 0 },
    uPri: { value: new THREE.Vector3(...COL.pri) }, uTerm: { value: 0 } };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vWN; varying vec3 vV;
      void main(){ vUv = uv; vN = normalize(position); vec4 wp = modelMatrix*vec4(position,1.0);
        vWN = normalize(mat3(modelMatrix)*position); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D uNight, uDay; uniform vec3 uSun, uPri; uniform float uTime, uAlpha, uTerm;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWN; varying vec3 vV;
      void main(){
        float s = dot(normalize(vN), normalize(uSun));
        float day = smoothstep(-0.10, 0.20, s);
        vec3 n = texture2D(uNight, vUv).rgb, d = texture2D(uDay, vUv).rgb;
        float lum = dot(n, vec3(.3,.55,.15));
        vec3 lights = smoothstep(0.07, 0.42, lum) * vec3(1.0,0.74,0.45) * 2.6;
        vec3 nightC = n*vec3(.6,.8,1.1)*1.25 + lights + vec3(0.012,0.03,0.05);
        vec3 dayC = mix(d, d*vec3(.55,.82,1.15), .6) * 0.64;
        vec3 col = mix(nightC, dayC, day);
        float ter = exp(-pow(s/0.035, 2.0)) * uTerm;                    /* the terminator line, when the day/night card is open */
        col += vec3(1.0,.75,.45) * ter * 0.9;
        float fr = 1.0 - max(0.0, dot(normalize(vWN), normalize(vV)));
        col += uPri * pow(fr, 2.6) * 0.95;
        float band = fract(uTime*0.07);
        col += uPri * 0.05 * exp(-pow((vN.y*0.5+0.5 - band)/0.006, 2.0));     /* a slow hologram scan */
        gl_FragColor = vec4(col, uAlpha);
      }`
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat);
  earth.renderOrder = -1;     /* always first: every data layer is drawn after it (their sort centres move with the data) */
  globe.add(earth);
  /* atmosphere glow */
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uPri: U.uPri, uAlpha: U.uAlpha }, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vWN; varying vec3 vV; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWN = normalize(mat3(modelMatrix)*position); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 uPri; uniform float uAlpha; varying vec3 vWN; varying vec3 vV;
      void main(){ float k = pow(clamp(0.62 + dot(normalize(vWN), normalize(vV)), 0.0, 1.0), 3.2); gl_FragColor = vec4(uPri*k*1.35, k*uAlpha); }`
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 48), atmoMat);
  globe.add(atmo);

  /* graticule (every 30 degrees), faint */
  const LINE_V = `attribute float aA; varying float vA; uniform vec3 uC; uniform float uOcc;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec3 c = (modelMatrix*vec4(0.,0.,0.,1.)).xyz;
      float f = dot(normalize(wp.xyz-c), normalize(cameraPosition-wp.xyz)); vA = aA*smoothstep(uOcc, uOcc+0.18, f);
      gl_Position = projectionMatrix*viewMatrix*wp; }`;
  const LINE_F = `uniform vec3 uC; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uC, vA*uAlpha); }`;
  const lineMat = (col, occ = -0.02) => new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Vector3(...col) }, uAlpha: { value: 0 }, uOcc: { value: occ } },
    vertexShader: LINE_V, fragmentShader: LINE_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const p = [], a = [];
    const push = (A, B) => { p.push(A.x, A.y, A.z, B.x, B.y, B.z); a.push(0.16, 0.16); };
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 3) push(ll(lat, lon, 1.002), ll(lat, lon + 3, 1.002));
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -84; lat < 84; lat += 3) push(ll(lat, lon, 1.002), ll(lat + 3, lon, 1.002));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aA', new THREE.Float32BufferAttribute(a, 1));
    var grat = new THREE.LineSegments(g, lineMat(COL.pri)); globe.add(grat);
  }
  /* two dotted orbit rings around the planet (the look of reference 01) */
  const ringG = new THREE.Group(); scene.add(ringG);
  function dotRing(r, n, tiltX, tiltZ) {
    const p = [], c = [], s = [], e = [];
    for (let i = 0; i < n; i++) { const a = i / n * PI * 2; p.push(Math.cos(a) * r, 0, Math.sin(a) * r); c.push(...COL.pri); s.push(i % 9 === 0 ? 2.2 : 0.9); e.push(Math.random()); }
    const m = makePts(p, c, s, e, { kind: 0, occ: -2 }); m.rotation.set(tiltX, 0, tiltZ); ringG.add(m); return m;
  }

  /* --- points with a soft glow, optional pulse ring / flicker; fade on the far side of the globe */
  const PT_V = `uniform float uPx, uScale, uOcc, uTime; attribute vec3 aCol; attribute float aSize; attribute float aSeed; varying vec3 vC; varying float vA; varying float vSeed;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec3 c = (modelMatrix*vec4(0.,0.,0.,1.)).xyz;
      float f = dot(normalize(wp.xyz-c), normalize(cameraPosition-wp.xyz)); vA = smoothstep(uOcc, uOcc+0.16, f); vC = aCol; vSeed = aSeed;
      vec4 mv = viewMatrix*wp; gl_Position = projectionMatrix*mv; gl_PointSize = aSize*uPx*uScale/max(0.05,-mv.z); }`;
  const PT_F = `uniform float uAlpha, uTime, uKind; varying vec3 vC; varying float vA; varying float vSeed;
    void main(){ vec2 q = gl_PointCoord-0.5; float r = length(q)*2.0; if (r>1.0) discard; float a;
      if (uKind < 0.5) { a = exp(-r*r*5.0) + 0.6*smoothstep(0.32,0.0,r); }
      else if (uKind < 1.5) { float ph = fract(uTime*0.45 + vSeed); a = smoothstep(0.09,0.0,abs(r-ph))*(1.0-ph) + smoothstep(0.24,0.0,r)*0.9 + smoothstep(0.08,0.0,abs(r-0.55))*0.35; }
      else { a = (exp(-r*r*6.0) + 0.5*smoothstep(0.3,0.0,r)) * (0.55+0.45*sin(uTime*11.0 + vSeed*60.0)); }
      gl_FragColor = vec4(vC, a*vA*uAlpha); }`;
  function ptsMat(kind, occ) {
    return new THREE.ShaderMaterial({ uniforms: { uPx: { value: PR }, uScale: { value: 60 }, uOcc: { value: occ }, uTime: U.uTime, uAlpha: { value: 0 }, uKind: { value: kind } },
      vertexShader: PT_V, fragmentShader: PT_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  function makePts(p, c, s, e, o = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(s, 1)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(e, 1));
    const m = new THREE.Points(g, ptsMat(o.kind || 0, o.occ == null ? -0.02 : o.occ)); m.frustumCulled = false; return m;
  }
  function livePts(max, kind, occ) {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(new Float32Array(max * 3), 3); col.setUsage(THREE.DynamicDrawUsage);
    const siz = new THREE.BufferAttribute(new Float32Array(max), 1); siz.setUsage(THREE.DynamicDrawUsage);
    const sd = new Float32Array(max); for (let i = 0; i < max; i++) sd[i] = Math.random();
    g.setAttribute('position', pos); g.setAttribute('aCol', col); g.setAttribute('aSize', siz); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.Points(g, ptsMat(kind, occ)); m.frustumCulled = false; globe.add(m);
    return { m, g, pos, col, siz, n: 0, max };
  }
  function liveLines(max, col, occ) {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3); pos.setUsage(THREE.DynamicDrawUsage);
    const aa = new THREE.BufferAttribute(new Float32Array(max * 2), 1); aa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos); g.setAttribute('aA', aa); g.setDrawRange(0, 0);
    const m = new THREE.LineSegments(g, lineMat(col, occ)); m.frustumCulled = false; globe.add(m);
    return { m, g, pos, aa, max };
  }

  /* a small airliner seen from above, nose pointing right (+x); the shader turns it to each flight's heading */
  const planeTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.translate(32, 32); x.fillStyle = '#fff'; x.beginPath();
    x.moveTo(27, 0); x.quadraticCurveTo(25, -3, 20, -3);            /* nose */
    x.lineTo(4, -3); x.lineTo(-6, -24); x.lineTo(-11, -24); x.lineTo(-5, -3);   /* right wing (top of the icon) */
    x.lineTo(-19, -3); x.lineTo(-24, -11); x.lineTo(-27, -11); x.lineTo(-24, -2);   /* tail */
    x.lineTo(-24, 2); x.lineTo(-27, 11); x.lineTo(-24, 11); x.lineTo(-19, 3);
    x.lineTo(-5, 3); x.lineTo(-11, 24); x.lineTo(-6, 24); x.lineTo(4, 3);
    x.lineTo(20, 3); x.quadraticCurveTo(25, 3, 27, 0); x.closePath(); x.fill();
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  })();
  const PLANE_V = `uniform float uPx, uScale, uOcc; uniform vec2 uRes; attribute vec3 aCol; attribute float aSize; attribute float aSeed; attribute float aTrk;
    varying vec3 vC; varying float vA; varying float vAng; varying float vIcon;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec3 c = (modelMatrix*vec4(0.,0.,0.,1.)).xyz;
      float f = dot(normalize(wp.xyz-c), normalize(cameraPosition-wp.xyz)); vA = smoothstep(uOcc, uOcc+0.16, f); vC = aCol;
      vec3 n = normalize(position); vec3 e = normalize(cross(vec3(0.,1.,0.), n) + vec3(1e-6,0.,0.)); vec3 no = cross(n, e);
      float t = radians(aTrk); vec3 d = no*cos(t) + e*sin(t);
      vec4 c0 = projectionMatrix*viewMatrix*wp; vec4 c1 = projectionMatrix*viewMatrix*modelMatrix*vec4(position + d*0.004, 1.0);
      vec2 sd = (c1.xy/c1.w - c0.xy/c0.w) * uRes; vAng = atan(sd.y, sd.x);
      vec4 mv = viewMatrix*wp; gl_Position = c0;
      float ps = min(aSize*uPx*uScale/max(0.05,-mv.z), 20.0*uPx); gl_PointSize = ps; vIcon = smoothstep(7.0, 12.0, ps/uPx); }`;
  const PLANE_F = `uniform sampler2D uTex; uniform float uAlpha; varying vec3 vC; varying float vA; varying float vAng; varying float vIcon;
    void main(){ vec2 q = gl_PointCoord - 0.5; q.y = -q.y; float cs = cos(vAng), sn = sin(vAng);
      vec2 uv = vec2(cs*q.x + sn*q.y, -sn*q.x + cs*q.y) + 0.5;
      float r = length(q)*2.0; float dotA = exp(-r*r*5.0) + 0.6*smoothstep(0.32, 0.0, r);
      float ic = texture2D(uTex, uv).a; float a = mix(min(1.0, dotA), min(1.0, ic*1.1 + exp(-r*r*6.0)*0.12), vIcon);
      if (a < 0.01) discard; gl_FragColor = vec4(vC, a*vA*uAlpha); }`;
  function planePts(max) {
    const g = new THREE.BufferGeometry();
    const mk = (n, k) => { const a = new THREE.BufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const pos = mk(3), col = mk(3), siz = mk(1), trk = mk(1);
    const sd = new Float32Array(max); for (let i = 0; i < max; i++) sd[i] = Math.random();
    g.setAttribute('position', pos); g.setAttribute('aCol', col); g.setAttribute('aSize', siz); g.setAttribute('aTrk', trk); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ uniforms: { uPx: { value: PR }, uScale: { value: 60 }, uOcc: { value: -0.02 }, uAlpha: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uTex: { value: planeTex } },
      vertexShader: PLANE_V, fragmentShader: PLANE_F, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    const m = new THREE.Points(g, mat); m.frustumCulled = false; globe.add(m);
    return { m, g, pos, col, siz, trk, n: 0, max };
  }

  /* layers: each has a target alpha (wall vs its own card vs another card) */
  const L = {
    flights: planePts(16000), track: liveLines(3000, COL.acc, -0.05), route: liveLines(200, COL.acc, -0.3), ring: liveLines(360, [0.36, 0.95, 0.63], -0.05),
    sats: livePts(17000, 0, -0.3), stations: livePts(4, 0, -0.45), stTrack: liveLines(800, COL.acc, -0.3),
    quakes: livePts(3000, 1, -0.02), storms: livePts(40, 1, -0.02), dist: liveLines(600, COL.acc, -0.3),
    news: livePts(400, 1, -0.02), launch: livePts(16, 1, -0.02), arc: liveLines(160, COL.acc, -0.6),
    wind: liveLines(6000, COL.hi, -0.02), aurora: livePts(30000, 0, -0.05)
  };
  const LAYER_OF = { flights: ['flights', 'track', 'route', 'ring'], stations: ['sats', 'stations', 'stTrack', 'ring'], quakes: ['quakes', 'ring'], storms: ['storms', 'dist'],
    news: ['news'], launch: ['launch', 'arc'], wind: ['wind'], aurora: ['aurora'] };
  const WALL_A = { sats: 0.4, flights: 0.7, track: 0, route: 0, ring: 0, stations: 1, stTrack: 0.35, quakes: 0.9, storms: 1, dist: 0, news: 0.75, launch: 1, arc: 0.8, wind: 0, aurora: 0 };
  const layerA = Object.fromEntries(Object.keys(L).map(k => [k, 0]));

  /* storm glyph: a spinning spiral sprite per storm */
  const spiralTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    x.translate(128, 128);
    for (let arm = 0; arm < 3; arm++) {
      x.beginPath();
      for (let t = 0; t < 1; t += 0.01) { const a = t * 5.2 + arm * 2.094, r = 10 + t * 108; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.strokeStyle = 'rgba(235,248,255,.85)'; x.lineWidth = 9; x.lineCap = 'round'; x.shadowColor = 'rgba(140,220,255,.9)'; x.shadowBlur = 16; x.stroke();
    }
    x.beginPath(); x.arc(0, 0, 9, 0, PI * 2); x.fillStyle = 'rgba(10,20,30,1)'; x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const stormSprites = [];


  /* ------------------------------------------------------------------ data -> layers */
  const FL = { n: 0, lat: null, lon: null, trk: null, vel: null, alt: null, cs: [], co: [], ic: [], t0: 0, lock: -1, lockAt: 0, trackOf: '' };
  const HOME = { lat: 39.9042, lon: 116.4074, name: '北京（默认）', src: 'default' };
  const ST2 = { st: [], tracksAt: 0 };          /* the two crewed stations: elements + passes */
  const SAT = { n: 0, c: null, kind: null, at: 0, up: 0, upK: {}, upFlag: null, cur: 0 };   /* every active satellite */
  const SAT_COL = [[0.5, 0.62, 0.82], [0.72, 0.84, 1], [0.72, 0.6, 1], COL.acc, [0.45, 1, 0.65], COL.hi, [1, 0.86, 0.5], [0.45, 0.95, 0.95]];
  const SAT_NAME = ['其他', '星链', '一网', '中国', '导航', '空间站', '同步轨道', '柯伊伯'];
  const WD = { lats: null, lons: null, g: null, parts: null };   /* wind grid and particles */

  function setFlights(m) {
    const p = m.p || [], n = Math.min(L.flights.max, Math.floor(p.length / 5));
    FL.n = n; FL.lat = new Float32Array(n); FL.lon = new Float32Array(n); FL.trk = new Float32Array(n); FL.vel = new Float32Array(n); FL.alt = new Float32Array(n);
    for (let i = 0; i < n; i++) { FL.lon[i] = p[i * 5]; FL.lat[i] = p[i * 5 + 1]; FL.trk[i] = p[i * 5 + 2]; FL.vel[i] = p[i * 5 + 3]; FL.alt[i] = p[i * 5 + 4]; }
    const keep = FL.lock >= 0 ? (FL.ic[FL.lock] || FL.cs[FL.lock]) : null;
    FL.cs = m.cs || []; FL.co = m.co || []; FL.ic = m.ic || []; FL.t0 = m.t || Date.now(); FL.lock = -1;
    if (keep) { const j = FL.ic.indexOf(keep); FL.lock = j >= 0 ? j : FL.cs.indexOf(keep); }
    const near = new Set((m.near || []).map(x => x[1]));
    const col = L.flights.col.array, siz = L.flights.siz.array, tr = L.flights.trk.array;
    for (let i = 0; i < n; i++) { const nr = near.has(i); col.set(nr ? [0.55, 1, 0.75] : (i % 3 ? COL.hi : COL.pri), i * 3); siz[i] = nr ? 1.25 : 1.0; tr[i] = FL.trk[i]; }
    L.flights.col.needsUpdate = L.flights.siz.needsUpdate = L.flights.trk.needsUpdate = true;
    L.flights.g.setDrawRange(0, n); stepFlights();
  }
  function setPts(layer, list, fn) {
    const P = L[layer], n = Math.min(P.max, list.length), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const r = fn(list[i], i); ll(r.lat, r.lon, r.r || 1.004, v); P.pos.setXYZ(i, v.x, v.y, v.z); P.col.setXYZ(i, ...r.c); P.siz.setX(i, r.s); }
    P.pos.needsUpdate = P.col.needsUpdate = P.siz.needsUpdate = true; P.g.setDrawRange(0, n); P.n = n;
  }
  function setQuakes(m) {
    setPts('quakes', m.q || [], (q) => ({ lat: q.lat, lon: q.lon, c: q.m >= 5 ? COL.red : q.m >= 3 ? COL.acc : COL.pri, s: 1.2 + Math.max(0, q.m) * 1.15 }));
  }
  function setStorms(m) {
    const s = m.s || [];
    setPts('storms', s, () => ({ lat: 0, lon: 0, c: COL.hi, s: 0 }));
    setPts('storms', s, (x) => ({ lat: x.lat, lon: x.lon, c: COL.hi, s: 4 }));
    stormSprites.forEach(sp => globe.remove(sp)); stormSprites.length = 0;
    s.slice(0, 12).forEach(x => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spiralTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      ll(x.lat, x.lon, 1.012, sp.position); const k = 0.05 + clamp((x.wind || 100) / 260, 0, 1) * 0.07; sp.scale.set(k, k, 1); sp.userData.k = k;
      globe.add(sp); stormSprites.push(sp);
    });
    if (s[0]) arcLine(L.dist, HOME.lat, HOME.lon, s[0].lat, s[0].lon, 0.004, 0.9); else L.dist.g.setDrawRange(0, 0);
    /* real tracks: where each storm has been (dim) and the official forecast path (bright) */
    let n = s[0] ? L.dist.g.drawRange.count / 2 : 0; const v = new THREE.Vector3(), w = new THREE.Vector3();
    const seg = (a, b, al) => { if (n >= L.dist.max) return; ll(a[0], a[1], 1.006, v); ll(b[0], b[1], 1.006, w); L.dist.pos.setXYZ(n * 2, v.x, v.y, v.z); L.dist.pos.setXYZ(n * 2 + 1, w.x, w.y, w.z); L.dist.aa.setX(n * 2, al); L.dist.aa.setX(n * 2 + 1, al); n++; };
    const path = (p, al) => { for (let i = 0; i + 1 < (p || []).length; i++) { const a = p[i], b = p[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5)); for (let j = 0; j < k; j++) seg([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k], [a[0] + (b[0] - a[0]) * (j + 1) / k, a[1] + (b[1] - a[1]) * (j + 1) / k], al); } };
    s.slice(0, 5).forEach(x => { path(x.past, 0.35); path(x.fut, 1); });
    L.dist.pos.needsUpdate = L.dist.aa.needsUpdate = true; L.dist.g.setDrawRange(0, n * 2);
  }
  function setNews(m) {
    const p = m.p || [], mx = Math.max(1, ...p.map(x => x.n));
    setPts('news', p, (x) => ({ lat: x.lat, lon: x.lon, c: x.tone <= -3 ? [1, 0.45, 0.35] : x.tone >= 1 ? COL.pri : [1, 0.85, 0.55], s: 2.4 + 7 * Math.sqrt(x.n / mx) }));
  }
  function setLaunch(m) {
    const l = m.l || [];
    setPts('launch', l, (x, i) => ({ lat: x.lat, lon: x.lon, c: i ? COL.pri : COL.acc, s: i ? 2.6 : 5 }));
    buildArc(l[0]);
  }
  function buildArc(x) {
    const A = L.arc; if (!x) { A.g.setDrawRange(0, 0); return; }
    /* an illustrative ascent: up from the pad and bending east (most launches head east); drawn, not a trajectory */
    const n = 80, v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const pt = (j, o) => { const t = j / n; return ll(x.lat + t * 6, x.lon + t * t * 26, 1 + 0.22 * Math.sin(t * PI * 0.55), o); };
      pt(i, v); pt(i + 1, w); A.pos.setXYZ(i * 2, v.x, v.y, v.z); A.pos.setXYZ(i * 2 + 1, w.x, w.y, w.z); A.aa.setX(i * 2, 0); A.aa.setX(i * 2 + 1, 0);
    }
    A.pos.needsUpdate = true; A.g.setDrawRange(0, n * 2); A.n = n;
  }
  function setAurora(m) {
    const ov = m.ov || [];
    setPts('aurora', ov, (x) => { const p = clamp(x[2] / 60, 0, 1); return { lat: x[1], lon: x[0], r: 1.018, c: [0.25 + 0.75 * p * p, 1 - 0.55 * p * p, 0.45 - 0.2 * p], s: 0.9 + 1.6 * p }; });
  }
  function setWind(m) {
    WD.lats = m.lats; WD.lons = m.lons; WD.g = m.g;
    if (!WD.parts) { WD.parts = []; for (let i = 0; i < L.wind.max; i++) WD.parts.push(spawnWind({})); }
  }
  /* elements -> per-satellite constants (J2 secular rates), so each frame only does Kepler + two rotations */
  function setSats(m) {
    const e = m.els || [], n = Math.min(L.sats.max, Math.floor(e.length / 8)), c = new Float64Array(n * 11), kind = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const o = j * 8, n0 = e[o] * 2 * PI / 86400, ec = e[o + 1], inc = e[o + 2], a = Math.cbrt(MU / (n0 * n0)), p = a * (1 - ec * ec), k = 1.5 * J2 * (RK / p) ** 2 * n0, q = j * 11;
      c[q] = a; c[q + 1] = ec; c[q + 2] = Math.cos(inc); c[q + 3] = Math.sin(inc); c[q + 4] = e[o + 3]; c[q + 5] = -k * Math.cos(inc);
      c[q + 6] = e[o + 4]; c[q + 7] = 0.5 * k * (5 * Math.cos(inc) ** 2 - 1); c[q + 8] = e[o + 5]; c[q + 9] = n0 + 0.5 * k * Math.sqrt(1 - ec * ec) * (3 * Math.cos(inc) ** 2 - 1); c[q + 10] = e[o + 6];
      kind[j] = e[o + 7];
    }
    SAT.n = n; SAT.c = c; SAT.kind = kind; SAT.upFlag = new Uint8Array(n); SAT.cur = 0;
    const P = L.sats; for (let j = 0; j < n; j++) { P.col.setXYZ(j, ...SAT_COL[kind[j]]); P.siz.setX(j, kind[j] === 1 ? 0.6 : 0.9); }
    P.col.needsUpdate = P.siz.needsUpdate = true; P.g.setDrawRange(0, n); P.n = n;
    stepSats(n);
  }
  /* high orbits are squeezed (GPS/BeiDou ~20,000 km, geostationary 35,786 km) so they stay on screen; low ones are to scale */
  const SKY_KM = 2560;   /* a satellite 550 km up is above your horizon when it is inside this circle */
  const squeeze = (r) => 1 + 0.35 * Math.log(1 + (r - 1) / 0.35);
  function stepSats(count) {
    if (!SAT.n) return;
    const P = L.sats, pos = P.pos.array, c = SAT.c, t = Date.now() / 1000, g = sunNow(t * 1000).gmst, cg = Math.cos(g), sg = Math.sin(g);
    const la = HOME.lat * D2R, lo = HOME.lon * D2R, hx = Math.cos(la) * Math.cos(lo), hy = Math.cos(la) * Math.sin(lo), hz = Math.sin(la);   /* home 'up', Earth-fixed */
    let flagCh = false;
    for (let s = 0; s < count; s++) {
      const j = SAT.cur; SAT.cur = (SAT.cur + 1) % SAT.n; const q = j * 11, dt = t - c[q + 10], ec = c[q + 1];
      const raan = c[q + 4] + c[q + 5] * dt, u0 = c[q + 6] + c[q + 7] * dt, M = (c[q + 8] + c[q + 9] * dt) % (2 * PI);
      let E = M; for (let it = 0; it < 4; it++) E = E - (E - ec * Math.sin(E) - M) / (1 - ec * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + ec) * Math.sin(E / 2), Math.sqrt(1 - ec) * Math.cos(E / 2)), r = c[q] * (1 - ec * Math.cos(E)), u = u0 + nu;
      const cO = Math.cos(raan), sO = Math.sin(raan), cu = Math.cos(u), su = Math.sin(u), ci = c[q + 2], si = c[q + 3];
      const x = r * (cO * cu - sO * su * ci), y = r * (sO * cu + cO * su * ci), z = r * su * si;
      const X = (x * cg + y * sg) / RK, Y = (-x * sg + y * cg) / RK, Z = z / RK, R = Math.hypot(X, Y, Z), f = squeeze(R) / R;
      pos[j * 3] = X * f; pos[j * 3 + 1] = Z * f; pos[j * 3 + 2] = -Y * f;
      const up = (X - hx) * hx + (Y - hy) * hy + (Z - hz) * hz > 0 ? 1 : 0;      /* above the user's horizon */
      if (up !== SAT.upFlag[j]) { SAT.upFlag[j] = up; flagCh = true; }
    }
    P.pos.needsUpdate = true;
    if (!SAT.at || performance.now() - SAT.at > (flagCh ? 500 : 2000)) {
      SAT.at = performance.now(); let n = 0; const K = {}; const card = ST.mode === 'card' && CARDS[ST.card].k === 'stations';
      for (let j = 0; j < SAT.n; j++) if (SAT.upFlag[j]) { n++; K[SAT.kind[j]] = (K[SAT.kind[j]] || 0) + 1; }
      for (let j = 0; j < SAT.n; j++) { const b = SAT.upFlag[j] && card; const cc = b ? [0.55, 1, 0.75] : SAT_COL[SAT.kind[j]]; P.col.setXYZ(j, ...cc); P.siz.setX(j, b ? 1.3 : SAT.kind[j] === 1 ? 0.6 : 0.9); }
      P.col.needsUpdate = P.siz.needsUpdate = true; SAT.up = n; SAT.upK = K;
    }
  }
  function setStations(m) {
    setSats(m);
    ST2.st = (m.s || []).map(s => ({ k: s.k, name: s.name, el: s.el, passes: s.passes || [] }));
    const P = L.stations;
    ST2.st.forEach((s, i) => { P.col.setXYZ(i, ...(s.k === 'css' ? COL.acc : COL.hi)); P.siz.setX(i, 7); });
    P.col.needsUpdate = P.siz.needsUpdate = true; P.g.setDrawRange(0, ST2.st.length); P.n = ST2.st.length;
    ST2.tracksAt = 0;
  }
  /* a great-circle line between two places, lifted a little, on one of the line layers */
  function arcLine(A, la1, lo1, la2, lo2, lift = 0.004, a = 0.85, n = 64) {
    const p1 = ll(la1, lo1, 1), p2 = ll(la2, lo2, 1), ang = p1.angleTo(p2), v = new THREE.Vector3(), w = new THREE.Vector3();
    const at = (t, o) => { if (ang < 1e-6) return o.copy(p1); const s = Math.sin(ang); o.copy(p1).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(p2, Math.sin(t * ang) / s); return o.multiplyScalar(1.004 + lift * Math.sin(t * PI) * Math.min(1, ang * 3)); };
    n = Math.min(n, A.max);
    for (let i = 0; i < n; i++) { at(i / n, v); at((i + 1) / n, w); A.pos.setXYZ(i * 2, v.x, v.y, v.z); A.pos.setXYZ(i * 2 + 1, w.x, w.y, w.z); A.aa.setX(i * 2, a); A.aa.setX(i * 2 + 1, a); }
    A.pos.needsUpdate = A.aa.needsUpdate = true; A.g.setDrawRange(0, n * 2);
  }
  /* a circle of radius km around a place (the 300 km flight ring, the 1000 km quake ring) */
  function ringAround(A, lat, lon, kmR, a = 0.75) {
    const n = Math.min(180, A.max), v = new THREE.Vector3(), w = new THREE.Vector3(), d = kmR / 6371;
    const pt = (b, o) => { const p1 = lat * D2R, l1 = lon * D2R; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return ll(p2 * R2D, l2 * R2D, 1.005, o); };
    for (let i = 0; i < n; i++) { pt(i / n * PI * 2, v); pt((i + 1) / n * PI * 2, w); A.pos.setXYZ(i * 2, v.x, v.y, v.z); A.pos.setXYZ(i * 2 + 1, w.x, w.y, w.z); const on = (i % 4) < 3 ? a : 0; A.aa.setX(i * 2, on); A.aa.setX(i * 2 + 1, on); }
    A.pos.needsUpdate = A.aa.needsUpdate = true; A.g.setDrawRange(0, n * 2);
  }
  function askTrack() {
    const j = FL.lock; if (j < 0) return;
    const id = FL.ic[j]; if (!id || id === FL.trackOf) return;
    FL.trackOf = id; FL.trackPts = 0; L.track.g.setDrawRange(0, 0); send({ type: 'earth_track', icao24: id });
  }
  function setTrack(m) {
    if (m.icao24 !== FL.trackOf) return;
    const A = L.track, p = m.path || [], v = new THREE.Vector3(), w = new THREE.Vector3(); let k = 0;
    for (let i = 1; i < p.length && k < A.max; i++) {
      ll(p[i - 1][0], p[i - 1][1], 1.006, v); ll(p[i][0], p[i][1], 1.006, w);
      const a0 = 0.3 + 0.7 * (i - 1) / p.length, a1 = 0.3 + 0.7 * i / p.length;
      A.pos.setXYZ(k * 2, v.x, v.y, v.z); A.pos.setXYZ(k * 2 + 1, w.x, w.y, w.z); A.aa.setX(k * 2, a0); A.aa.setX(k * 2 + 1, a1); k++;
    }
    A.pos.needsUpdate = A.aa.needsUpdate = true; A.g.setDrawRange(0, k * 2);
    FL.trackPts = p.length; FL.trackErr = m.error || '';
  }
  function setFlightQ(m) {
    D.flightq = m; ST.flightQ = m.q; if (m.icao24) { FL.trackOf = m.icao24; FL.trackPts = 0; L.track.g.setDrawRange(0, 0); }
    if (m.found && FL.n) {
      let j = m.icao24 ? FL.ic.indexOf(m.icao24) : -1; if (j < 0) j = FL.cs.findIndex(c => c && c.toUpperCase() === m.callsign);
      if (j >= 0) { FL.lock = j; FL.lockUser = true; }
    }
    const r = m.route;
    if (r && r.from && r.to && r.from.lat != null && r.to.lat != null) arcLine(L.route, r.from.lat, r.from.lon, r.to.lat, r.to.lon, 0.03, 0.7, 96);
    else L.route.g.setDrawRange(0, 0);
    if (ST.mode === 'card' && CARDS[ST.card].k === 'flights') { cardView('flights'); fillFull(); }
  }
  function setHome(m) {
    Object.assign(HOME, { lat: +m.lat, lon: +m.lon, name: m.name || '家', src: m.src || '' });
    if (D.storms) setStorms(D.storms);
    if (ST.mode === 'card') { const k = CARDS[ST.card].k; if (k === 'flights') ringAround(L.ring, HOME.lat, HOME.lon, 300); if (k === 'quakes') ringAround(L.ring, HOME.lat, HOME.lon, 1000); if (k === 'stations') ringAround(L.ring, HOME.lat, HOME.lon, SKY_KM); }
    CARDS.forEach((_, i) => renderCard(i));
  }

  function data(m) {
    if (m.card === 'track') { setTrack(m); return; }
    if (m.card === 'home') { setHome(m); return; }
    if (m.card === 'flightq') { setFlightQ(m); return; }
    if (m.card === 'near') { D.near = m; if (ST.mode === 'card' && CARDS[ST.card].k === 'flights') fillFull(); renderCard(IDX.flights); return; }
    const k = m.card; if (!(k in IDX)) return;
    if (m.state === 'offline' && D[k] && D[k].state !== 'offline') { D[k].state = 'offline'; renderCard(IDX[k]); return; }
    m.rx = Date.now();
    D[k] = m;
    try {
      if (k === 'flights') setFlights(m);
      else if (k === 'stations') setStations(m);
      else if (k === 'quakes') setQuakes(m);
      else if (k === 'storms') setStorms(m);
      else if (k === 'news') setNews(m);
      else if (k === 'launch') setLaunch(m);
      else if (k === 'wind') setWind(m);
      else if (k === 'aurora') setAurora(m);
    } catch (e) { console.warn('earth data', k, e); }
    renderCard(IDX[k]);
    if (ST.mode === 'card' && CARDS[ST.card].k === k) fillFull();
  }

  /* ------------------------------------------------------------------ the sun (for the real day/night on the globe) */
  function sunNow(t = Date.now()) {
    const d = (t / 86400000) + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
    const Lr = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, e = (23.439 - 0.00000036 * d) * D2R;
    const dec = Math.asin(Math.sin(e) * Math.sin(Lr));
    const ra = Math.atan2(Math.cos(e) * Math.sin(Lr), Math.cos(Lr));
    const gmst = ((280.46061837 + 360.98564736629 * d) % 360) * D2R;
    let lon = (ra - gmst) * R2D; lon = ((lon + 540) % 360) - 180;
    return { lat: dec * R2D, lon, gmst };
  }

  /* ------------------------------------------------------------------ per-frame motion */
  const RE = 6371000;
  function dest(lat, lon, trk, dist, out) {
    const p1 = lat * D2R, l1 = lon * D2R, th = trk * D2R, sd = Math.sin(dist), cd = Math.cos(dist), sp = Math.sin(p1), cp = Math.cos(p1);
    const p2 = Math.asin(sp * cd + cp * sd * Math.cos(th));
    out[0] = p2; out[1] = l1 + Math.atan2(Math.sin(th) * sd * cp, cd - sp * Math.sin(p2));
  }
  const tmp2 = [0, 0];
  function stepFlights() {     /* real positions: each plane moved along its own heading from the moment it was heard (max 5 minutes) */
    const P = L.flights, n = FL.n; if (!n) return;
    const pos = P.pos.array, el = clamp((Date.now() - FL.t0) / 1000, 0, 300);
    for (let i = 0; i < n; i++) {
      dest(FL.lat[i], FL.lon[i], FL.trk[i], FL.vel[i] * el / RE, tmp2);
      const c = Math.cos(tmp2[0]); pos[i * 3] = 1.006 * c * Math.cos(tmp2[1]); pos[i * 3 + 1] = 1.006 * Math.sin(tmp2[0]); pos[i * 3 + 2] = -1.006 * c * Math.sin(tmp2[1]);
    }
    P.pos.needsUpdate = true;
  }
  /* space stations: the same J2 mean-element propagation as earth.py, so the HUD and the pass list agree */
  const MU = 398600.4418, RK = 6371, J2 = 1.08263e-3;
  function satECI(el, t) {
    const n0 = el.n * 2 * PI / 86400, dt = t / 1000 - el.ep, a = Math.cbrt(MU / (n0 * n0)), e = el.e, i = el.i, p = a * (1 - e * e);
    const k = 1.5 * J2 * (RK / p) ** 2 * n0;
    const raan = el.raan - k * Math.cos(i) * dt, argp = el.argp + 0.5 * k * (5 * Math.cos(i) ** 2 - 1) * dt;
    const M = el.M + (n0 + 0.5 * k * Math.sqrt(1 - e * e) * (3 * Math.cos(i) ** 2 - 1)) * dt + (el.ndot || 0) * 2 * PI / 86400 / 86400 * dt * dt;
    let E = M; for (let j = 0; j < 6; j++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = a * (1 - e * Math.cos(E)), u = argp + nu;
    const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i), cu = Math.cos(u), su = Math.sin(u);
    return [r * (cO * cu - sO * su * ci), r * (sO * cu + cO * su * ci), r * (su * si)];
  }
  function satLL(el, t) {    /* -> [lat, lon, r in Earth radii] */
    const s = satECI(el, t), g = sunNow(t).gmst, r = Math.hypot(s[0], s[1], s[2]);
    let lon = (Math.atan2(s[1], s[0]) - g) * R2D; lon = ((lon + 540) % 360) - 180;
    return [Math.asin(s[2] / r) * R2D, lon, r / RK];
  }
  const stPos = [];
  function stepStations() {
    const P = L.stations, now = Date.now(), v = new THREE.Vector3();
    ST2.st.forEach((s, i) => { const [la, lo, r] = satLL(s.el, now); stPos[i] = [la, lo]; ll(la, lo, r, v); P.pos.setXYZ(i, v.x, v.y, v.z); });
    P.pos.needsUpdate = true;
    if (now - ST2.tracksAt > 20000 && ST2.st.length) {     /* where each will be over the next 95 minutes */
      ST2.tracksAt = now; const A = L.stTrack, per = Math.floor(A.max / 2 / ST2.st.length); let k = 0;
      ST2.st.forEach((s) => { let prev = null;
        for (let j = 0; j <= per; j++) { const [la, lo] = satLL(s.el, now + j * 95 * 60000 / per); const cur = ll(la, lo, 1.012); if (prev) { A.pos.setXYZ(k * 2, prev.x, prev.y, prev.z); A.pos.setXYZ(k * 2 + 1, cur.x, cur.y, cur.z); const a = 0.8 * (1 - j / per) + 0.1; A.aa.setX(k * 2, a); A.aa.setX(k * 2 + 1, a); k++; } prev = cur; } });
      A.pos.needsUpdate = A.aa.needsUpdate = true; A.g.setDrawRange(0, k * 2);
    }
  }
  /* wind: particles carried by the 10 m wind field (bilinear), drawn as short streaks; time is sped up a lot (labelled) */
  function windAt(lat, lon) {
    if (!WD.g) return [0, 0];
    const la0 = WD.lats[0], dla = WD.lats[1] - WD.lats[0], nla = WD.lats.length, dlo = WD.lons[1] - WD.lons[0], nlo = WD.lons.length;
    const fi = clamp((lat - la0) / dla, 0, nla - 1.001), fj = (((lon - WD.lons[0]) % 360) + 360) % 360 / dlo;
    const i0 = Math.floor(fi), j0 = Math.floor(fj) % nlo, j1 = (j0 + 1) % nlo, a = fi - i0, b = fj - Math.floor(fj), i1 = Math.min(nla - 1, i0 + 1);
    const G = (i, j, c) => WD.g[(i * nlo + j) * 2 + c];
    const u = (G(i0, j0, 0) * (1 - b) + G(i0, j1, 0) * b) * (1 - a) + (G(i1, j0, 0) * (1 - b) + G(i1, j1, 0) * b) * a;
    const v = (G(i0, j0, 1) * (1 - b) + G(i0, j1, 1) * b) * (1 - a) + (G(i1, j0, 1) * (1 - b) + G(i1, j1, 1) * b) * a;
    return [u, v];
  }
  function spawnWind(p) { p.lat = Math.asin(Math.random() * 2 - 1) * R2D * 0.92; p.lon = Math.random() * 360 - 180; p.age = Math.random() * 4; p.life = 3 + Math.random() * 4; return p; }
  const WIND_K = 0.32;     /* degrees per (m/s · s): about 35,000x real speed */
  function stepWind(dt, count) {
    const A = L.wind, pos = A.pos.array, aa = A.aa.array, v = new THREE.Vector3(), w = new THREE.Vector3(); let k = 0;
    for (let i = 0; i < count; i++) {
      const p = WD.parts[i]; p.age += dt;
      if (p.age > p.life || Math.abs(p.lat) > 80) spawnWind(p);
      const [u, vv] = windAt(p.lat, p.lon), sp = Math.hypot(u, vv);
      const c = Math.max(0.2, Math.cos(p.lat * D2R));
      p.lat += vv * WIND_K * dt; p.lon += u * WIND_K * dt / c; if (p.lon > 180) p.lon -= 360; if (p.lon < -180) p.lon += 360;
      ll(p.lat, p.lon, 1.008, v); ll(p.lat - vv * WIND_K * 0.7, p.lon - u * WIND_K * 0.7 / c, 1.008, w);
      const fade = Math.min(1, p.age * 2, (p.life - p.age) * 2), a = fade * clamp(0.25 + sp / 12, 0.25, 1);
      pos.set([v.x, v.y, v.z, w.x, w.y, w.z], k * 6); aa[k * 2] = a; aa[k * 2 + 1] = 0; k++;
    }
    A.pos.needsUpdate = A.aa.needsUpdate = true; A.g.setDrawRange(0, k * 2);
  }

  /* ------------------------------------------------------------------ anchors (where each card's line lands) */
  const anchorV = CARDS.map(() => new THREE.Vector3());
  function nearQuake(d) { const n = (d.q || []).filter(x => x.km <= 1000); return n[0] || (d.q || []).slice().sort((a, b) => b.m - a.m)[0]; }
  function anchorLL(k) {
    const d = D[k] || {};
    if (k === 'flights' || k === 'wind') return [HOME.lat, HOME.lon];
    if (k === 'stations') return [HOME.lat, HOME.lon];
    if (k === 'quakes') { const q = nearQuake(d); return q ? [q.lat, q.lon] : [HOME.lat, HOME.lon]; }
    if (k === 'storms') return d.s && d.s[0] ? [d.s[0].lat, d.s[0].lon] : [18, 132];
    if (k === 'news') return d.p && d.p[0] ? [d.p[0].lat, d.p[0].lon] : [HOME.lat, HOME.lon];
    if (k === 'launch') return d.l && d.l[0] ? [d.l[0].lat, d.l[0].lon] : [19.6, 110.95];
    if (k === 'aurora') { const o = (d.ov || []).filter(x => x[1] > 0).sort((a, b) => b[2] - a[2])[0]; return o ? [o[1], o[0]] : [67, HOME.lon]; }
    return [HOME.lat, HOME.lon];
  }
  function anchorOf(i) {
    const k = CARDS[i].k, a = anchorLL(k);
    return ll(a[0], a[1], k === 'stations' ? 1.07 : k === 'aurora' ? 1.018 : 1.006, anchorV[i]);
  }

  /* ------------------------------------------------------------------ views */
  const V = { lat: 18, lon: 112, dist: 9, sx: 0, sy: 0 }, VT = { lat: 18, lon: 112, dist: 5.4, sx: 0, sy: 0 };
  const USER = { at: -1e9, vlon: 0, vlat: 0, zoom: 1 };     /* last touch, fling speed (deg/s), the user's zoom on top of the view's */
  function degPerPx() { const R = (innerHeight / 2) / (Math.tan(15 * D2R) * Math.max(1.05, V.dist - 0.6)); return R2D / R; }
  function rotateBy(dx, dy, dt) {
    const k = degPerPx();
    V.lon -= dx * k; VT.lon = V.lon; V.lat = clamp(V.lat + dy * k, -75, 75); VT.lat = V.lat;
    if (dt > 0) { USER.vlon = -dx * k / dt; USER.vlat = dy * k / dt; }
    USER.at = performance.now();
  }
  function zoomBy(f) { USER.zoom = clamp(USER.zoom * f, 0.32, 2.4); USER.at = performance.now(); }
  const DIST_MIN = 1.22;
  function wallView() {
    const h = innerHeight, w = innerWidth;
    /* the globe fills the gap between the two card columns */
    const gap = w - 2 * (Math.min(w * 0.235, 410) + Math.max(22, w * 0.018)) - 30;
    const rPx = Math.min(h * 0.39, gap * 0.5);
    VT.dist = h / (2 * rPx * Math.tan(15 * D2R)); VT.sx = 0; VT.sy = 0;
  }
  function cardView(k) {
    const asp = innerWidth / innerHeight, d = D[k] || {};
    let la = HOME.lat, lo = HOME.lon, dist = 3.0, cx = 0.4, cy = 0.5;
    if (k === 'flights') {
      const q = D.flightq, r = q && q.q === ST.flightQ ? q.route : null;
      if (q && q.q === ST.flightQ && q.found) { la = q.lat; lo = q.lon; dist = 2.2; }
      else if (r && r.from && r.to && r.from.lat != null) { la = (r.from.lat + r.to.lat) / 2; lo = r.from.lon + ((((r.to.lon - r.from.lon) + 540) % 360) - 180) / 2;
        dist = clamp(1.8 + (q.route_km || 0) / 2500 + Math.hypot(r.from.lat - r.to.lat, r.from.lon - r.to.lon) / 40, 1.9, 4.6); }
      else { dist = 1.75; }
    }
    else if (k === 'stations') { la = clamp(HOME.lat - 8, -50, 50); dist = 3.6; }
    else if (k === 'quakes') { dist = 3.2; }
    else if (k === 'storms' && d.s && d.s[0]) { const s = d.s[0]; la = (HOME.lat + s.lat) / 2; lo = HOME.lon + ((((s.lon - HOME.lon) + 540) % 360) - 180) / 2; dist = clamp(3.4 + s.km / 1500, 4.0, 6.0); }
    else if (k === 'news') { la = 22; dist = 5.0; }
    else if (k === 'launch' && d.l && d.l[0]) { la = d.l[0].lat + 4; lo = d.l[0].lon + 8; dist = 4.8; }
    else if (k === 'wind') { dist = 4.4; }
    else if (k === 'aurora') { la = 55; dist = 4.4; }
    const half = dist * Math.tan(15 * D2R);
    Object.assign(VT, { lat: clamp(la, -70, 75), lon: lo, dist, sx: (cx - 0.5) * 2 * half * asp, sy: -(cy - 0.5) * 2 * half });
  }

  /* ------------------------------------------------------------------ cards: text, numbers, mini maps */
  function ago(ms) { const m = Math.round(ms / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; }
  function hms(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 3600) % 24)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; }
  function countdown(ms) { const d = Math.floor(Math.max(0, ms) / 86400000); return (d ? `${d}<small>天</small> ` : '') + hms(ms); }
  const local = (t) => new Date(t);
  function hm(t) { const d = local(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function dayWord(t) {        /* 今晚 / 明早 / 明晚 / 10月31日, by local time */
    const d = local(t), now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - d0) / 86400000), h = d.getHours();
    const part = h < 5 ? '凌晨' : h < 11 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
    if (day === 0) return h >= 18 ? '今晚' : '今天' + part;
    if (day === 1) return (h < 11 ? '明早' : h >= 18 ? '明晚' : '明天' + part);
    return `${d.getMonth() + 1}月${d.getDate()}日${part}`;
  }
  function shortPlace(s) { return (s || '').split(',')[0]; }
  function placeCN(s) {        /* 'Kyiv, Kyyiv, Misto, Ukraine' -> 'Kyiv · 乌克兰' */
    const p = (s || '').split(',').map(x => x.trim()).filter(Boolean); if (!p.length) return '—';
    const c = p[p.length - 1], cc = CN2[c] || cn(c);
    return p.length === 1 ? cc : `${p[0]} · ${cc}`;
  }
  const homeName = () => HOME.src === 'default' ? '北京（未设置家的位置）' : HOME.name;
  function cardValue(i) {
    const c = CARDS[i], d = D[c.k];
    if (!d) return null;
    if (d.state === 'offline' && !d.count && !(d.l && d.l.length) && !(d.s && d.s.length)) return { html: '数据源连不上', wait: true, sub: '稍后会自动重试', state: 'offline' };
    const st = d.state;
    if (c.k === 'flights') {
      const n = d.near_n != null ? d.near_n : (d.near || []).length;
      return { num: n, sub: `你附近 300 公里 · 全球共收到 ${fmt(d.count)} 架`, state: st };
    }
    if (c.k === 'stations') {
      const now = Date.now(), nx = (d.next || []).find(p => p.end > now);
      const n = SAT.n ? SAT.up : d.up;
      if (n == null) return { html: '暂无', wait: true, sub: d.src || '', state: st };
      const sub = !nx ? '今晚没有肉眼能看到的过境' : nx.start <= now ? `肉眼可见：${nx.who} 正在头顶，往${nx.to}看` : `肉眼可见：${dayWord(nx.start)} ${hm(nx.start)} ${nx.who} ` + (nx.from === nx.to ? `在${nx.from}方低空掠过` : `从${nx.from}飞向${nx.to}`);
      return { num: n, sub, state: st };
    }
    if (c.k === 'quakes') {
      const near = (d.q || []).filter(x => x.km <= 1000);
      if (!near.length) return { html: '附近无', wait: false, sub: `1000 公里内 24 小时没有记录 · 全球 M5+ ${d.big || 0} 次`, state: st };
      const q = near[0];
      return { num: near.length, sub: `最近：M${q.m.toFixed(1)} ${q.place} · 距你 ${fmt(q.km)} 公里 · ${ago(Date.now() - q.t)}`, state: st };
    }
    if (c.k === 'storms') {
      const s = (d.s || [])[0];
      if (!s) return { html: '没有', sub: '此刻全球没有活动的热带气旋', state: st };
      const c2 = s.close, comes = c2 && c2.km < s.km - 100;
      return { html: `${fmt(s.km)}<small>公里</small>`, sub: comes ? `${s.name} 在你${s.dir}方，预报会靠近到 ${fmt(c2.km)} 公里` : `${s.name} 在你${s.dir}方 · ${c2 ? '预报不会再靠近你' : (s.sev || s.alert)}`, state: st };
    }
    if (c.k === 'news') {
      const p = (d.p || [])[0]; if (!p) return { html: '暂无', wait: true, sub: d.src, state: st };
      return { html: `<span style="font-size:.62em;letter-spacing:1px">${esc(placeCN(p.name))}</span>`, sub: `${fmt(p.n)} 篇报道` + ((p.kinds || []).length ? ` · ${p.kinds.slice(0, 2).join('、')}` : ''), state: st };
    }
    if (c.k === 'launch') {
      const l = (d.l || []).find(x => Date.parse(x.net) > Date.now() - 3600000); if (!l) return { html: '暂无排期', wait: true, sub: d.src, state: st };
      const cn = (d.cn || [])[0];
      return { html: countdown(Date.parse(l.net) - Date.now()), sub: `${l.rocket || l.name} · ${shortPlace(l.where)}` + (cn && cn !== l ? ` · 国内下一次 ${dayWord(Date.parse(cn.net))}` : ''), state: st };
    }
    if (c.k === 'wind') {
      const lo = d.local || {};
      const big = lo.text ? lo.text.replace('风', '风 ') : lo.ms != null ? `${lo.ms.toFixed(1)}<small>米/秒</small>` : '—';
      return { html: `<span style="font-size:.72em">${big}</span>`, sub: `${lo.city || homeName()}${lo.now ? ' · ' + lo.now : ''}${lo.temp != null && lo.temp !== '' ? ' ' + lo.temp + '°C' : ''} · 全球最强 ${d.max ? d.max.ms : '—'} 米/秒`, state: st };
    }
    if (c.k === 'aurora') {
      if (d.kp == null) return { html: '—', wait: true, sub: d.src, state: st };
      const pk = d.peak ? ` · 3 天内最高 Kp ${d.peak[1].toFixed(1)}` : '';
      return { html: `<small>Kp</small>${d.kp.toFixed(1)}`, sub: (d.storm ? `${d.storm} 地磁暴` : '没有地磁暴') + pk + ` · 你那里约需 Kp ${d.need}`, state: st };
    }
    return null;
  }
  function renderCard(i) {
    const v = cardValue(i), c = CARDS[i];
    cardDot[i].className = 'ew-dot ' + (v ? v.state : '');
    if (!v) { cardN[i].className = 'ew-n wait'; cardN[i].textContent = ST.voice === false ? '语音服务未连接' : '获取中…'; cardS[i].textContent = ST.voice === false ? '实时数据由语音服务获取' : ' '; return; }
    cardS[i].textContent = v.sub || '';
    if (v.num != null) {
      const s = shown[i];
      if (s.to !== v.num) { s.from = s.v == null ? 0 : s.v; s.to = v.num; s.at = performance.now(); }
      cardN[i].className = 'ew-n';
      if (!cardN[i].firstChild || cardN[i].firstChild.nodeType !== 3) cardN[i].innerHTML = `0<small>${c.unit}</small>`;
    } else { cardN[i].className = 'ew-n' + (v.wait ? ' wait' : ''); if (cardN[i].innerHTML !== v.html) cardN[i].innerHTML = v.html; shown[i].to = null; }
  }
  function tickNumbers() {
    const now = performance.now();
    shown.forEach((s, i) => {
      if (s.to == null || cardN[i].classList.contains('wait')) return;
      const k = clamp((now - s.at) / 1400, 0, 1), v = s.from + (s.to - s.from) * easeOut(k);
      if (v === s.v) return; s.v = v;
      const tn = cardN[i].firstChild; if (tn && tn.nodeType === 3) tn.nodeValue = fmt(v);
    });
  }
  let tick1 = 0;
  function tickClockCards() {   /* countdowns and "minutes ago" keep moving */
    const now = Date.now(); if (now - tick1 < 1000) return; tick1 = now;
    [IDX.launch, IDX.stations].forEach(i => renderCard(i));
    if (now % 30000 < 1000) CARDS.forEach((_, i) => renderCard(i));
    const d = new Date(now); clockEl.textContent = `UTC ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}  ·  ${homeName()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    if (ST.mode === 'card' && ['launch', 'stations'].includes(CARDS[ST.card].k)) fillFull(true);
  }

  /* mini maps: an equirectangular crop of the night Earth, with that card's own data on it */
  function baseReady() {
    const img = texNight.image; if (!img) return;
    base = document.createElement('canvas'); base.width = 1024; base.height = 512;
    base.getContext('2d').drawImage(img, 0, 0, 1024, 512);
  }
  const miniT = CARDS.map(() => 0);
  function drawMini(i, t) {
    const cv = cardCv[i], w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const k = CARDS[i].k, d = D[k] || {};
    const whole = k === 'news' || k === 'wind' || k === 'aurora';
    const a = whole ? [k === 'aurora' ? 45 : 10, k === 'aurora' ? HOME.lon : 30] : (anchorLL(k) || [HOME.lat, HOME.lon]);
    const span = whole ? 360 : k === 'flights' ? 14 : k === 'quakes' ? 30 : k === 'stations' ? 160 : k === 'storms' ? Math.max(40, Math.abs(((d.s && d.s[0] ? d.s[0].lon : HOME.lon) - HOME.lon)) * 2.4) : 110;
    const cx = k === 'stations' ? HOME.lon : k === 'storms' && d.s && d.s[0] ? (HOME.lon + d.s[0].lon) / 2 : a[1];
    const cy = k === 'stations' ? HOME.lat : k === 'storms' && d.s && d.s[0] ? (HOME.lat + d.s[0].lat) / 2 : whole ? a[0] : clamp(a[0], -60, 70);
    const sc = whole ? Math.max(w / 360, h / 180) * (k === 'aurora' ? 1.6 : 1) : w * 0.62 / span, ox = whole ? w * 0.5 : w * 0.66, oy = h * 0.5;
    const X = (lon) => { let dl = lon - cx; dl = ((dl + 540) % 360) - 180; return ox + dl * sc; }, Y = (lat) => oy - (lat - cy) * sc;
    if (base) {
      x.globalAlpha = 0.85;
      const bw = 360 * sc, bh = 180 * sc, by = oy - (90 - cy) * sc;
      for (const sh of [-360, 0, 360]) { const bx = ox + (-180 - cx + sh) * sc; if (bx > w || bx + bw < 0) continue; x.drawImage(base, bx, by, bw, bh); }
      x.globalAlpha = 1;
    }
    x.globalCompositeOperation = 'lighter';
    const pri = `rgba(${COL.pri.map(v => v * 255 | 0)},`, acc = `rgba(${COL.acc.map(v => v * 255 | 0)},`, hi = `rgba(${COL.hi.map(v => v * 255 | 0)},`;
    const dot = (px, py, r, c) => { x.beginPath(); x.arc(px, py, r, 0, PI * 2); x.fillStyle = c; x.fill(); };
    const homeDot = () => { const px = X(HOME.lon), py = Y(HOME.lat); dot(px, py, 3, 'rgba(92,242,160,1)'); x.beginPath(); x.arc(px, py, 6 + 4 * ((t * 0.8) % 1), 0, PI * 2); x.strokeStyle = `rgba(92,242,160,${0.8 * (1 - (t * 0.8) % 1)})`; x.lineWidth = 1; x.stroke(); };
    if (k === 'flights' && FL.n) {
      const kmPx = sc / 111; x.beginPath(); x.arc(X(HOME.lon), Y(HOME.lat), 300 * kmPx, 0, PI * 2); x.setLineDash([3, 3]); x.strokeStyle = 'rgba(92,242,160,.6)'; x.stroke(); x.setLineDash([]);
      for (let j = 0; j < FL.n; j++) { const px = X(FL.lon[j]), py = Y(FL.lat[j]); if (px < 0 || px > w || py < 0 || py > h) continue;
        x.save(); x.translate(px, py); x.rotate((FL.trk[j] - 90) * D2R); x.fillStyle = hi + '.9)'; x.beginPath(); x.moveTo(4, 0); x.lineTo(-3, -3); x.lineTo(-1.5, 0); x.lineTo(-3, 3); x.closePath(); x.fill(); x.restore(); }
      homeDot();
    } else if (k === 'stations' && (ST2.st.length || SAT.n)) {
      const now = Date.now(), sp = L.sats.pos.array;
      if (SAT.n) { x.fillStyle = hi + '.55)'; for (let j = 0; j < SAT.n; j += 3) { const X0 = sp[j * 3], Y0 = sp[j * 3 + 1], Z0 = sp[j * 3 + 2], r = Math.hypot(X0, Y0, Z0); if (r > 1.3) continue; const px = X(Math.atan2(-Z0, X0) * R2D), py = Y(Math.asin(Y0 / r) * R2D); if (px < 0 || px > w || py < 0 || py > h) continue; x.fillRect(px, py, 1, 1); } }
      ST2.st.forEach((s, si) => { x.beginPath(); let pl = null; for (let j = 0; j <= 95; j += 1) { const [la, lo] = satLL(s.el, now + j * 60000); const px = X(lo), py = Y(la); if (pl != null && Math.abs(px - pl) > w * 0.5) x.moveTo(px, py); else x.lineTo(px, py); pl = px; }
        x.strokeStyle = (s.k === 'css' ? acc : pri) + '.75)'; x.lineWidth = 1.2; x.stroke(); const p = stPos[si]; if (p) dot(X(p[1]), Y(p[0]), 3.5, (s.k === 'css' ? acc : hi) + '1)'); });
      homeDot();
    } else if (k === 'quakes' && d.q) {
      const kmPx = sc / 111; x.beginPath(); x.arc(X(HOME.lon), Y(HOME.lat), 1000 * kmPx, 0, PI * 2); x.setLineDash([3, 3]); x.strokeStyle = 'rgba(92,242,160,.45)'; x.stroke(); x.setLineDash([]);
      d.q.slice(0, 600).forEach((q, j) => { const px = X(q.lon), py = Y(q.lat); if (px < -20 || px > w + 20 || py < -20 || py > h + 20) return; const ph = (t * 0.5 + j * 0.37) % 1, r = 2 + q.m * 2;
        x.beginPath(); x.arc(px, py, r * (0.4 + ph), 0, PI * 2); x.strokeStyle = (q.m >= 5 ? 'rgba(255,90,70,' : acc) + (0.9 * (1 - ph)) + ')'; x.lineWidth = 1.2; x.stroke(); dot(px, py, 1.6, acc + '.9)'); });
      homeDot();
    } else if (k === 'storms') {
      (d.s || []).slice(0, 4).forEach((s, j) => { const px = X(s.lon), py = Y(s.lat); x.save(); x.translate(px, py); x.rotate(-t * 1.4); x.globalAlpha = 0.9; const r = j ? 14 : 24; x.drawImage(spiralTex.image, -r, -r, r * 2, r * 2); x.restore(); });
      const s = (d.s || [])[0]; if (s) { x.beginPath(); x.moveTo(X(HOME.lon), Y(HOME.lat)); x.lineTo(X(s.lon), Y(s.lat)); x.setLineDash([4, 4]); x.strokeStyle = acc + '.8)'; x.stroke(); x.setLineDash([]); }
      homeDot();
    } else if (k === 'news' && d.p) {
      const mx = d.p[0] ? d.p[0].n : 1;
      d.p.forEach((p, j) => { const r = 1.2 + 6 * Math.sqrt(p.n / mx), ph = (t * 0.4 + j * 0.21) % 1; dot(X(p.lon), Y(p.lat), r * 0.5, acc + '.85)');
        if (j < 10) { x.beginPath(); x.arc(X(p.lon), Y(p.lat), r * (0.6 + ph), 0, PI * 2); x.strokeStyle = acc + (0.7 * (1 - ph)) + ')'; x.stroke(); } });
    } else if (k === 'launch' && d.l && d.l[0]) {
      const l = d.l[0], px = X(l.lon), py = Y(l.lat), ph = (t * 0.22) % 1;
      x.beginPath(); for (let s = 0; s <= ph; s += 0.02) x.lineTo(px + s * s * w * 0.3, py - Math.sin(s * 1.4) * h * 0.75); x.strokeStyle = acc + '.9)'; x.lineWidth = 1.5; x.stroke();
      dot(px + ph * ph * w * 0.3, py - Math.sin(ph * 1.4) * h * 0.75, 3, hi + '1)'); dot(px, py, 3.2, acc + '1)');
    } else if (k === 'wind' && WD.g) {
      x.lineWidth = 1;
      for (let la = -60; la <= 60; la += 10) for (let lo = -180; lo < 180; lo += 10) {
        const [u, v] = windAt(la, lo), sp = Math.hypot(u, v); if (sp < 0.5) continue;
        const px = X(lo), py = Y(la), ph = ((t * 0.6 + (la * 7 + lo) * 0.013) % 1), L2 = 2 + sp * 0.9;
        x.beginPath(); x.moveTo(px + u / sp * L2 * (ph - 0.5), py - v / sp * L2 * (ph - 0.5)); x.lineTo(px + u / sp * L2 * (ph + 0.2), py - v / sp * L2 * (ph + 0.2));
        x.strokeStyle = (sp > 10 ? hi : pri) + Math.min(0.95, 0.3 + sp / 14) + ')'; x.stroke(); }
      homeDot();
    } else if (k === 'aurora' && d.ov) {
      d.ov.forEach((o) => { if (o[1] < 20) return; const p = clamp(o[2] / 60, 0, 1); x.fillStyle = `rgba(${80 + 175 * p * p | 0},${255 - 140 * p * p | 0},${120},${0.25 + 0.6 * p})`; x.fillRect(X(o[0]), Y(o[1]), 2, 2); });
      homeDot();
    }
    x.globalCompositeOperation = 'source-over';
    const sxp = ((t * 0.12 + i * 0.13) % 1) * w; const gr = x.createLinearGradient(sxp - 40, 0, sxp, 0); gr.addColorStop(0, pri + '0)'); gr.addColorStop(1, pri + '.18)');
    x.fillStyle = gr; x.fillRect(sxp - 40, 0, 40, h);
  }

  /* ------------------------------------------------------------------ full-screen card: title + right panel */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (b, s, e, warm, attrs = '') => `<div class="row${warm ? ' warm' : ''}${attrs ? ' click' : ''}" ${attrs}><b>${b}</b><span>${s}</span>${e ? `<em>${e}</em>` : ''}</div>`;
  const apName = (a) => a ? esc((a.city || a.name || '').replace(/ International Airport| Airport/, '')) + (a.iata ? ` <small style="opacity:.6">${esc(a.iata)}</small>` : '') : '—';
  function flightPanel(d) {
    let h = `<div class="ew-search"><input class="ew-in" placeholder="输入航班号，如 MU5101" value="${esc(ST.flightQ || '')}" spellcheck="false" autocomplete="off"><button type="button" class="ew-go">查询</button></div>`;
    const q = D.flightq;
    if (ST.flightQ && (!q || q.q !== ST.flightQ)) h += `<div class="res">正在查 ${esc(ST.flightQ)}…</div>`;
    else if (q && q.q === ST.flightQ) {
      const r = q.route;
      h += `<div class="res"><b>${esc(q.q)}</b>${q.callsign !== q.q ? ` <small style="opacity:.6">${esc(q.callsign)}</small>` : ''}${r && r.airline ? ` · ${esc(r.airline)}` : ''}<br>`;
      h += r ? `<span class="rt">${apName(r.from)} → ${apName(r.to)}</span><br>` : '查不到它的航线（航线库里没有这个航班号）<br>';
      if (q.found) h += `高度 ${fmt(q.alt)} 米 · 速度 ${fmt(q.vel * 3.6)} km/h` + (q.done_km != null ? `<br>已飞 ${fmt(q.done_km)} 公里 · 还剩 ${fmt(q.left_km)} 公里` + (q.eta_min != null ? ` · 按现在的速度约 ${q.eta_min} 分钟` : '') : '');
      else h += `<span style="color:rgba(var(--sk-ink),.65)">现在收不到它的信号：可能还没起飞、已经落地，或者正飞在没有接收站的地方（海上、国内很多空域）。</span>`;
      h += '</div>';
    }
    const near = (D.near && D.near.items) || (d.near || []).slice(0, 8).map(([km, i]) => ({ i, km, cs: FL.cs[i], route: null }));
    h += `<h3>OVER YOU · 你附近 ${D.near ? D.near.radius : 300} 公里</h3>`;
    h += near.length ? near.map(it => row(esc(it.cs || '—'), it.route ? `${apName(it.route.from)} → ${apName(it.route.to)}` : (it.cs ? '航线未知' : '无呼号'), `${fmt(it.km)} km`, false, `data-i="${it.i}"`)).join('')
      : `<div class="note">现在你附近 300 公里内没有收到任何飞机的信号。</div>`;
    h += `<div class="note">${esc(d.note || '')}。航线来自开源航线库 adsbdb，可能过时。点一架飞机看它的真实航迹（橙线）。` + (HOME.src === 'default' ? ' 还没有设置家的位置，对贾维斯说「记住我家在……」就行。' : '') + '</div>';
    return h;
  }
  function fillFull(onlyClock) {
    const i = ST.card; if (i < 0) return; const c = CARDS[i], d = D[c.k] || {}, v = cardValue(i);
    fT.innerHTML = `<i>${pad2(i + 1)}</i><span>${c.t}</span>`;
    if (v) { fN.className = 'ew-n' + (v.wait ? ' wait' : ''); const html = v.num != null ? `${fmt(v.num)}<small>${c.unit}</small>` : v.html; if (fN.innerHTML !== html) fN.innerHTML = html; fS.textContent = v.sub || ''; }
    else { fN.className = 'ew-n wait'; fN.textContent = '获取中…'; fS.textContent = ''; }
    if (onlyClock) return;
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('ew-in')) return;   /* do not rebuild under the user's typing */
    fTag.textContent = c.k === 'stations' ? '高轨卫星的高度压缩显示' : c.k === 'launch' ? '上升轨迹为示意' : c.k === 'news' ? '是新闻里被提到的地点，不是核实过的事件' : '';
    let h = '';
    const now = Date.now();
    if (c.k === 'flights') { h = flightPanel(d); }
    else if (c.k === 'stations') {
      const nx = (d.next || []).filter(p => p.end > now).slice(0, 8);
      const K = SAT.n ? SAT.upK : {}, order = [1, 3, 2, 7, 4, 6, 5, 0].filter(k => K[k]);
      h = `<h3>ABOVE YOU · 此刻在你地平线以上</h3>` + (SAT.n ? `<div class="row"><b>${fmt(SAT.up)}</b><span>颗（全球在轨 ${fmt(SAT.n)} 颗）</span></div>` + order.map(k => row(fmt(K[k]), SAT_NAME[k], '', k === 3)).join('') : '<div class="note">正在计算…</div>');
      h += `<h3 style="margin-top:14px">NAKED EYE · 今晚肉眼能看到</h3>` + (nx.length ? nx.map(p => row(`${dayWord(p.start).replace(/(早上|下午|中午|晚上|凌晨)$/, '')} ${hm(p.start)}`, esc(p.who), `${p.from}→${p.to} · ${p.max}° · ${p.min}分`, p.k === 'station' || p.k === 'china')).join('')
        : '<div class="note">未来一天没有够亮、够高的过境（要天黑、卫星被太阳照亮、从你头顶高处经过）。</div>');
      h += `<div class="note">${esc(d.note || '')}。仰角越大越好找：在开始的方向等它出现，看起来像一颗匀速移动、不闪的星。</div>`;
    } else if (c.k === 'quakes' && d.q) {
      const near = d.q.filter(x => x.km <= 1000).slice(0, 6), big = d.q.filter(x => x.m >= 5).sort((a, b) => b.m - a.m).slice(0, 6);
      h = `<h3>NEAR YOU · 离你 1000 公里内</h3>` + (near.length ? near.map(q => row('M' + q.m.toFixed(1), esc(q.place), `${fmt(q.km)}km · ${ago(now - q.t)}`, q.m >= 4)).join('') : '<div class="note">过去 24 小时，你附近 1000 公里内没有记录到地震。</div>')
        + `<h3 style="margin-top:14px">WORLD · 全球 M5 以上</h3>` + (big.length ? big.map(q => row('M' + q.m.toFixed(1), esc(q.place), ago(now - q.t), true)).join('') : '<div class="note">过去 24 小时全球没有 M5 以上地震。</div>')
        + `<div class="note">数据：${esc(d.src)}。${esc(d.note || '')}。</div>`;
    } else if (c.k === 'storms') {
      h = d.s && d.s.length ? `<h3>ACTIVE · 当前活动（按离你远近）</h3>` + d.s.slice(0, 6).map(s => row(`${fmt(s.km)}km`, esc(s.name) + (s.head ? ` · 往${s.head}` : ''), `${s.dir}方` + (s.close ? (s.close.km < s.km - 100 ? ` · 预报最近 ${fmt(s.close.km)}km` : ' · 在远离你') : ` · ${esc((s.sev || s.alert).split(' · ')[0])}`), (s.close ? s.close.km : s.km) < 1500)).join('') + `<div class="note">地球上：亮线是官方预报路径，暗线是它走过的路。</div>` + `<div class="note">${esc(d.note || '')}。</div>`
        : `<h3>ACTIVE · 当前活动</h3><div class="note">此刻全球没有活动的热带气旋。</div>`;
    } else if (c.k === 'news' && d.p) {
      const nt = (p) => `<div class="row"><b>${fmt(p.n)}</b><span>${esc(placeCN(p.name))}${(p.kinds || []).length ? ` · <small>${esc(p.kinds.join('、'))}</small>` : ''}<br><small style="opacity:.65">${esc(((p.titles || [])[0] || {}).t || '')}</small></span></div>`;
      h = `<h3>WORLD · 最近 1 小时报道最多的地方</h3>` + d.p.filter(p => !p.country_level).slice(0, 6).map(nt).join('')
        + ((d.near || []).length ? `<h3 style="margin-top:14px">NEAR YOU · 离你 1500 公里内</h3>` + d.near.slice(0, 4).map(nt).join('') : '')
        + ((d.cn || []).length ? `<h3 style="margin-top:14px">CHINA · 涉及中国</h3>` + d.cn.slice(0, 4).map(nt).join('') : '')
        + `<div class="note">共 ${fmt(d.articles || 0)} 篇报道。${esc(d.note || '')}。</div>`;
    } else if (c.k === 'launch' && d.l && d.l[0]) {
      const l = d.l.find(x => Date.parse(x.net) > now - 3600000) || d.l[0];
      h = `<h3>NEXT · 下一次</h3><div class="big">${esc(l.rocket || l.name)}</div>` + row('任务', esc(l.mission || l.name)) + row('机构', esc(l.provider)) + row('发射场', `${esc(l.pad)}，${esc(l.where)}`) + row('状态', esc(l.st_cn || l.status) + (l.live ? ' · 正在直播' : l.vid && l.vid.length ? ' · 有官方直播' : ''));
      if (d.cn && d.cn.length) h += `<h3 style="margin-top:14px">CHINA · 国内</h3>` + d.cn.slice(0, 3).map(x => row(`${dayWord(Date.parse(x.net)).replace(/(早上|下午|中午|晚上|凌晨)$/, '')} ${hm(Date.parse(x.net))}`, esc(x.rocket || x.name), esc(shortPlace(x.where)), true)).join('');
      h += `<h3 style="margin-top:14px">AFTER · 之后</h3>` + d.l.filter(x => x !== l).slice(0, 4).map(x => row(`${new Date(Date.parse(x.net)).getMonth() + 1}/${new Date(Date.parse(x.net)).getDate()}`, esc(x.name), esc(shortPlace(x.where)))).join('') + `<div class="note">本机时间。${esc(d.note)}。数据：${esc(d.src)}。</div>`;
    } else if (c.k === 'wind') {
      const lo = d.local || {};
      h = `<h3>YOUR CITY · ${esc(lo.city || homeName())}</h3>` + (lo.text ? row(esc(lo.text), esc(lo.now || ''), lo.temp != null ? lo.temp + '°C' : '') : lo.ms != null ? row(`${lo.ms.toFixed(1)}`, `米/秒 · 从${lo.from}方吹来`, lo.gust != null ? `阵风 ${lo.gust} 米/秒` : '') : '<div class="note">本地风速暂时拿不到。</div>')
        + `<div class="note" style="margin-top:6px">本地数据：${esc(lo.src || '—')}</div>`
        + `<h3 style="margin-top:14px">WORLD · 全球</h3>` + (d.max ? row(`${d.max.ms}`, '米/秒 · 此刻网格里最强的风', `${Math.abs(d.max.lat)}°${d.max.lat >= 0 ? 'N' : 'S'} ${Math.abs(d.max.lon)}°${d.max.lon >= 0 ? 'E' : 'W'}`, true) : '')
        + `<div class="note">${esc(d.note || '')}。流线的方向就是风吹去的方向，越亮越快。</div>`;
    } else if (c.k === 'aurora' && d.kp != null) {
      const fc = d.fc || [], mx = 9;
      h = `<h3>KP · 未来 3 天预报（每 3 小时）</h3><div class="bars">` + fc.map(f => `<i class="${f[1] >= 5 ? 'g' : ''}${Math.abs(f[0] - now) < 5400000 ? ' now' : ''}" style="height:${Math.max(3, f[1] / mx * 100)}%" title="${new Date(f[0]).toLocaleString()} Kp ${f[1]}"></i>`).join('') + `</div>`
        + (fc.length ? `<div class="axis"><span>${dayWord(fc[0][0])}</span><span>Kp 5 以上 = 地磁暴（橙）</span><span>${dayWord(fc[fc.length - 1][0])}</span></div>` : '')
        + row(`Kp ${d.kp.toFixed(1)}`, d.storm ? `${d.storm} 地磁暴` : '没有地磁暴', '此刻', !!d.storm)
        + row(`Kp ${d.need}`, d.need >= 9 ? `${esc(homeName())}（地磁纬度 ${d.gmlat}°）离极光带太远，只有特大磁暴才偶尔看到` : `${esc(homeName())}（地磁纬度 ${d.gmlat}°）大约需要这么强才可能看到`, '', d.peak && d.peak[1] >= d.need)
        + `<div class="note">地球上的绿光就是 NOAA 模型算出的此刻极光带，越红越强。${esc(d.note || '')}。</div>`;
    }
    panel.innerHTML = h; panel.classList.toggle('low', false);
    const inp = panel.querySelector('.ew-in');
    if (inp) {
      const go = () => { const q = inp.value.trim().toUpperCase().replace(/\s+/g, ''); if (!q) return; ST.flightQ = q; send({ type: 'earth_flight', q }); fillFull(); };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') inp.blur(); });
      panel.querySelector('.ew-go').addEventListener('click', go);
    }
    panel.querySelectorAll('.row.click[data-i]').forEach(r => r.addEventListener('click', () => { FL.lock = +r.dataset.i; FL.lockUser = true; askTrack(); }));
  }

  /* ------------------------------------------------------------------ flight lock (reference 04) */
  const lockV = new THREE.Vector3();
  const CN = { 'China': '中国', 'United States': '美国', 'Japan': '日本', 'Republic of Korea': '韩国', 'Germany': '德国', 'United Kingdom': '英国', 'France': '法国',
    'India': '印度', 'Russian Federation': '俄罗斯', 'Canada': '加拿大', 'Australia': '澳大利亚', 'Singapore': '新加坡', 'Thailand': '泰国', 'Malaysia': '马来西亚',
    'Indonesia': '印度尼西亚', 'Philippines': '菲律宾', 'Viet Nam': '越南', 'United Arab Emirates': '阿联酋', 'Qatar': '卡塔尔', 'Turkey': '土耳其', 'Türkiye': '土耳其',
    'Netherlands': '荷兰', 'Switzerland': '瑞士', 'Spain': '西班牙', 'Italy': '意大利', 'Ireland': '爱尔兰', 'Brazil': '巴西', 'Mexico': '墨西哥', 'Taiwan': '中国台湾',
    'Hong Kong': '中国香港', 'Macao': '中国澳门', 'Kingdom of the Netherlands': '荷兰', 'Saudi Arabia': '沙特阿拉伯', 'New Zealand': '新西兰', 'Austria': '奥地利',
    'Poland': '波兰', 'Sweden': '瑞典', 'Norway': '挪威', 'Denmark': '丹麦', 'Finland': '芬兰', 'Belgium': '比利时', 'Portugal': '葡萄牙', 'Israel': '以色列', 'Egypt': '埃及' };
  const cn = (x) => CN[x] || x || '—';
  const CN2 = { 'Ukraine': '乌克兰', 'Israel': '以色列', 'Iran': '伊朗', 'Iraq': '伊拉克', 'Syria': '叙利亚', 'Lebanon': '黎巴嫩', 'Gaza Strip': '加沙', 'West Bank': '约旦河西岸',
    'Pakistan': '巴基斯坦', 'Afghanistan': '阿富汗', 'Bangladesh': '孟加拉国', 'Nigeria': '尼日利亚', 'Kenya': '肯尼亚', 'South Africa': '南非', 'Sudan': '苏丹', 'Ethiopia': '埃塞俄比亚',
    'Venezuela': '委内瑞拉', 'Argentina': '阿根廷', 'Chile': '智利', 'Colombia': '哥伦比亚', 'Peru': '秘鲁', 'Cuba': '古巴', 'North Korea': '朝鲜', 'South Korea': '韩国',
    'Russia': '俄罗斯', 'Greece': '希腊', 'Hungary': '匈牙利', 'Romania': '罗马尼亚', 'Czech Republic': '捷克', 'Serbia': '塞尔维亚', 'Belarus': '白俄罗斯', 'Georgia': '格鲁吉亚',
    'Armenia': '亚美尼亚', 'Azerbaijan': '阿塞拜疆', 'Kazakhstan': '哈萨克斯坦', 'Myanmar': '缅甸', 'Cambodia': '柬埔寨', 'Laos': '老挝', 'Nepal': '尼泊尔', 'Sri Lanka': '斯里兰卡',
    'Mongolia': '蒙古', 'Yemen': '也门', 'Jordan': '约旦', 'Kuwait': '科威特', 'Oman': '阿曼', 'Libya': '利比亚', 'Morocco': '摩洛哥', 'Algeria': '阿尔及利亚', 'Tunisia': '突尼斯',
    'Ghana': '加纳', 'Somalia': '索马里', 'Congo': '刚果', 'Haiti': '海地', 'Ecuador': '厄瓜多尔', 'Bolivia': '玻利维亚', 'Panama': '巴拿马', 'Greenland': '格陵兰' };
  function pickLock(w, h) {
    if (!FL.n) return;
    const P = L.flights.pos.array, m = globe.matrixWorld, tx = w * 0.5, ty = h * 0.5, cam = camera.position;
    let best = -1, bd = 1e9;
    for (let j = 0; j < FL.n; j += 3) {
      if (!FL.cs[j]) continue;
      lockV.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]).applyMatrix4(m);
      const nrm = lockV.clone().sub(globe.position).normalize(); if (nrm.dot(cam.clone().sub(lockV).normalize()) < 0.25) continue;
      lockV.project(camera); const sx = (lockV.x + 1) / 2 * w, sy = (1 - lockV.y) / 2 * h; const dd = Math.hypot(sx - tx, sy - ty);
      if (dd < bd) { bd = dd; best = j; }
    }
    if (best >= 0) { FL.lock = best; FL.lockAt = performance.now(); askTrack(); }
  }
  function placeLock(w, h) {
    const on = ST.mode === 'card' && CARDS[ST.card].k === 'flights' && FL.lock >= 0 && root.classList.contains('ready');
    lockEl.classList.toggle('on', on); if (!on) return;
    const P = L.flights.pos.array, j = FL.lock;
    lockV.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]).applyMatrix4(globe.matrixWorld);
    const facing = lockV.clone().sub(globe.position).normalize().dot(camera.position.clone().sub(lockV).normalize());
    lockV.project(camera); const sx = (lockV.x + 1) / 2 * w, sy = (1 - lockV.y) / 2 * h;
    if (facing < 0.1 || sx < 0 || sx > w || sy < 0 || sy > h) { lockEl.classList.remove('on'); if (!FL.lockUser && !drag) pickLock(w, h); return; }
    lockInfo.style.left = sx > w - 420 ? '-260px' : '150px';
    lockPath.setAttribute('d', sx > w - 420 ? 'M-23,-6 L-78,-6 L-110,-26' : 'M23,-6 L118,-6 L150,-26'); lockDot.setAttribute('cx', sx > w - 420 ? -23 : 23);
    lockEl.style.transform = `translate(${sx}px,${sy}px)`;
    lockDot.setAttribute('cy', -6);
    const alt = FL.alt[j], spd = FL.vel[j] * 3.6;
    const html = `<div><b>航班</b><span>${FL.cs[j] || '—'}</span></div><div><b>高度</b><span>${alt ? fmt(alt) : '—'}</span> 米</div>` +
      `<div><b>速度</b><span>${spd ? fmt(spd) : '—'}</span> km/h</div><div><b>航向</b><span>${Math.round(FL.trk[j])}°</span></div><div><b>注册</b>${cn(FL.co[j])}</div>` +
      (FL.trackOf === FL.ic[j] && FL.trackPts ? `<div style="color:rgb(var(--sk-accl));font-size:12px">橙线：本航班真实航迹 · ${FL.trackPts} 个点</div>` : '');
    if (lockInfo.dataset.k !== html) { lockInfo.innerHTML = html; lockInfo.dataset.k = html; }
  }
  function pickables(k) {
    const d = D[k] || {}, now = Date.now();
    if (k === 'quakes') return (d.q || []).map(q => ({ lat: q.lat, lon: q.lon, html: `<div><b>震级</b><span>M${q.m.toFixed(1)}</span></div><div><b>深度</b><span>${Math.round(q.dep)}</span> 公里</div><div><b>位置</b>${esc(q.place) || '—'}</div><div><b>距你</b><span>${fmt(q.km)}</span> 公里</div><div><b>时间</b>${ago(now - q.t)} · ${esc(q.src)}</div>` }));
    if (k === 'storms') return (d.s || []).map(x => ({ lat: x.lat, lon: x.lon, html: `<div><b>名称</b><span>${esc(x.name)}</span></div><div><b>强度</b>${esc(x.sev) || '—'}</div>${x.close ? `<div><b>预报</b>${x.close.km < x.km - 100 ? `最近会到离你 <span>${fmt(x.close.km)}</span> 公里` : '不会再靠近你'}${x.head ? ` · 正往${x.head}走` : ''}</div>` : ''}<div><b>距你</b><span>${fmt(x.km)}</span> 公里 · ${x.dir}方</div><div><b>预警</b>${esc(x.alert) || '—'}</div>` }));
    if (k === 'launch') return (d.l || []).map(x => ({ lat: x.lat, lon: x.lon, html: `<div><b>任务</b>${esc(x.name)}</div><div><b>时间</b>${dayWord(Date.parse(x.net))} ${hm(Date.parse(x.net))}</div><div><b>地点</b>${esc(shortPlace(x.where))}</div>` }));
    if (k === 'news') return (d.p || []).map(x => ({ lat: x.lat, lon: x.lon, html: `<div><b>地点</b>${esc(placeCN(x.name))}</div><div><b>报道</b><span>${fmt(x.n)}</span> 篇${(x.kinds || []).length ? ' · ' + esc(x.kinds.join('、')) : ''}</div>` + (x.titles || []).slice(0, 2).map(t => `<div style="white-space:normal;max-width:300px;line-height:1.4;margin-top:4px;font-size:12px;opacity:.8">${esc(t.t || t)}</div>`).join('') }));
    if (k === 'stations') return ST2.st.map((s, i) => stPos[i] ? { lat: stPos[i][0], lon: stPos[i][1], r: 1.07, html: `<div><b>名称</b><span>${esc(s.name)}</span></div><div><b>高度</b>约 ${Math.round((satLL(s.el, Date.now())[2] - 1) * 6371)} 公里</div><div><b>速度</b>约 2.76 万 km/h</div>` } : null).filter(Boolean);
    return [];
  }
  function pickAt(sx, sy) {
    const k = CARDS[ST.card].k, list = pickables(k), w = innerWidth, h = innerHeight, v = new THREE.Vector3(); let best = null, bd = 40;
    for (const it of list) {
      ll(it.lat, it.lon, it.r || 1.006, v).applyMatrix4(globe.matrixWorld);
      if (v.clone().sub(globe.position).normalize().dot(camera.position.clone().sub(v).normalize()) < 0.05) continue;
      v.project(camera); const dd = Math.hypot((v.x + 1) / 2 * w - sx, (1 - v.y) / 2 * h - sy); if (dd < bd) { bd = dd; best = it; }
    }
    ST.pick = best; return !!best;
  }
  function placePick(w, h) {
    const it = ST.pick, on = !!it && root.classList.contains('ready');
    lockEl.classList.toggle('on', on); if (!on) return;
    if (ST.card >= 0 && CARDS[ST.card].k === 'stations') { const j = ST2.st.findIndex(s => it.html.includes(s.name)); if (j >= 0 && stPos[j]) { it.lat = stPos[j][0]; it.lon = stPos[j][1]; } }
    ll(it.lat, it.lon, it.r || 1.006, lockV).applyMatrix4(globe.matrixWorld);
    const facing = lockV.clone().sub(globe.position).normalize().dot(camera.position.clone().sub(lockV).normalize());
    lockV.project(camera); const sx = (lockV.x + 1) / 2 * w, sy = (1 - lockV.y) / 2 * h;
    if (facing < 0.05) { lockEl.classList.remove('on'); return; }
    const flip = sx > w - 420; lockInfo.style.left = flip ? '-260px' : '150px';
    lockPath.setAttribute('d', flip ? 'M-23,-6 L-78,-6 L-110,-26' : 'M23,-6 L118,-6 L150,-26'); lockDot.setAttribute('cx', flip ? -23 : 23); lockDot.setAttribute('cy', -6);
    lockEl.style.transform = `translate(${sx}px,${sy}px)`;
    if (lockInfo.dataset.k !== it.html) { lockInfo.innerHTML = it.html; lockInfo.dataset.k = it.html; }
  }
  function lockAt(sx, sy) {       /* the plane (or quake, fire, storm, pad) nearest a click or a pinch is picked */
    if (ST.mode !== 'card') return false;
    if (CARDS[ST.card].k !== 'flights') return pickAt(sx, sy);
    if (!FL.n) return false;
    const P = L.flights.pos.array, m = globe.matrixWorld, w = innerWidth, h = innerHeight; let best = -1, bd = 44;
    const cpos = camera.position, c = globe.position;
    for (let j = 0; j < FL.n; j++) {
      lockV.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]).applyMatrix4(m);
      if (lockV.clone().sub(c).normalize().dot(cpos.clone().sub(lockV).normalize()) < 0.05) continue;
      lockV.project(camera); const dd = Math.hypot((lockV.x + 1) / 2 * w - sx, (1 - lockV.y) / 2 * h - sy); if (dd < bd) { bd = dd; best = j; }
    }
    if (best >= 0) { FL.lock = best; FL.lockUser = true; askTrack(); return true; }
    return false;
  }
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!live() || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; USER.vlon = USER.vlat = 0; USER.at = performance.now();
    canvas.classList.add('drag'); try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    rotateBy(dx, dy, Math.max(0.008, (now - drag.t) / 1000)); drag.t = now;
  });
  const endDrag = (e) => {
    if (!drag) return; const d = drag; drag = null; canvas.classList.remove('drag');
    if (performance.now() - d.t > 120) USER.vlon = USER.vlat = 0;   /* held still before letting go: no fling */
    if (d.moved < 6 && e && e.type === 'pointerup') lockAt(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!live()) return; e.preventDefault(); e.stopPropagation();
    zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));      /* ctrlKey: a trackpad pinch */
  }, { passive: false });

  /* ------------------------------------------------------------------ show / open / close / hide */
  function show() {
    skinCol(); U.uPri.value.set(...COL.pri);
    if (!ringG.children.length) { dotRing(1.32, 420, 1.2, 0.3); dotRing(1.5, 520, 1.45, -0.5); }
    ST.on = true; ST.ending = false; ST.mode = 'wall'; ST.card = -1; ST.popAt = performance.now() + 650;
    root.classList.add('on', 'wall'); root.classList.remove('card', 'ready');
    cardEls.forEach(el => el.classList.remove('in', 'gone', 'flash'));
    links.forEach(l => { l.k = 0; });
    Object.assign(V, { lat: HOME.lat - 14, lon: HOME.lon - 16, dist: 11, sx: 0, sy: 0 }); Object.assign(VT, { lat: clamp(HOME.lat - 8, -60, 60), lon: HOME.lon }); wallView();
    FL.lock = -1; USER.zoom = 1; USER.vlon = USER.vlat = 0; USER.at = -1e9;
    ST.voice = send({ type: 'earth_fetch' }); send({ type: 'earth_state', on: true }); ST.fetchAt = performance.now(); ST.shownAt = performance.now();
    CARDS.forEach((_, i) => renderCard(i));
    setTimeout(() => showHint('拖动旋转地球 · 滚轮缩放 · 卡片列可以上下滑 · 点卡片或捏合打开 · 说「打开第几张」'), 2200);
  }
  function open(i) {
    if (typeof i === 'string') i = IDX[i];
    if (!(i >= 0 && i < CARDS.length)) return false;
    if (!ST.on) { show(); ST.popAt = performance.now() - 2000; }
    if (ST.mode === 'card') { cardEls[ST.card].classList.remove('gone'); }
    const el = cardEls[i], r = el.getBoundingClientRect();
    ST.mode = 'card'; ST.card = i; ST.openAt = performance.now();
    root.classList.add('card'); root.classList.remove('wall', 'ready');
    cardEls.forEach(c => c.classList.remove('hover'));
    /* the flyer: a copy of the card that grows from its place to the whole screen, then fades into the scene */
    if (r.width > 10 && el.classList.contains('in')) {
      const fl = el.cloneNode(true); fl.className = 'ew-flyer'; fl.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      try { const a = el.querySelector('canvas'), b = fl.querySelector('canvas'); b.width = a.width; b.height = a.height; b.getContext('2d').drawImage(a, 0, 0); } catch (_) {}
      root.appendChild(fl); el.classList.add('gone');
      const anim = fl.animate([
        { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', opacity: 1, borderRadius: '3px' },
        { left: '-1px', top: '-1px', width: (innerWidth + 2) + 'px', height: (innerHeight + 2) + 'px', opacity: 0.85, borderRadius: '0px', offset: 0.62 },
        { left: '-1px', top: '-1px', width: (innerWidth + 2) + 'px', height: (innerHeight + 2) + 'px', opacity: 0, borderRadius: '0px' }], { duration: 1100, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' });
      anim.onfinish = () => fl.remove();
    } else el.classList.add('gone');
    send({ type: 'earth_fetch', cards: [CARDS[i].k] });
    USER.zoom = 1; USER.vlon = USER.vlat = 0; FL.lockUser = false; ST.pick = null; lockInfo.dataset.k = '';
    cardView(CARDS[i].k);
    const k = CARDS[i].k;
    const HINTS = { flights: '右边输入航班号查它在哪 · 点一架飞机看它的真实航迹 · 拖动旋转、滚轮缩放', stations: '绿色的是此刻在你地平线以上的卫星（虚线圈≈离地 550 公里的星链能被你看到的范围） · 蓝白=星链 · 橙=中国 · 绿=导航 · 黄=同步轨道 · 虚线是两个空间站接下来的路线',
      quakes: '绿色虚线圈是离你 1000 公里 · 点一个地震看详情', storms: '亮线是官方预报路径 · 点台风看强度', news: '红点 = 冲突/负面报道多，蓝点 = 合作/正面 · 点光点看详情',
      launch: '点发射场看任务', wind: '流线就是风吹去的方向，越亮越快', aurora: '绿色是此刻的极光带，越红越强' };
    setTimeout(() => showHint(HINTS[k] + ' · 握拳或 Esc 返回'), 1000);
    if (k === 'flights') { if (!(D.flightq && D.flightq.q === ST.flightQ && D.flightq.found)) FL.lock = -1; ringAround(L.ring, HOME.lat, HOME.lon, 300); }
    if (k === 'quakes') ringAround(L.ring, HOME.lat, HOME.lon, 1000);
    if (k === 'stations') { ringAround(L.ring, HOME.lat, HOME.lon, SKY_KM); SAT.at = 0; }
    if (k !== 'flights') L.route.g.setDrawRange(0, 0); else if (!(D.flightq && D.flightq.q === ST.flightQ)) L.route.g.setDrawRange(0, 0);
    fillFull();
    setTimeout(() => { if (ST.mode === 'card' && ST.card === i) { root.classList.add('ready'); if (k === 'flights' && FL.lock < 0) pickLock(innerWidth, innerHeight); fillFull(); } }, 900);
    return true;
  }
  function close() {
    if (ST.mode !== 'card') return;
    const i = ST.card;
    root.classList.remove('card', 'ready'); root.classList.add('wall');
    const el = cardEls[i];
    el.classList.remove('gone');
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect(); if (r.width < 10) return;
      const fl = el.cloneNode(true); fl.className = 'ew-flyer'; root.appendChild(fl);
      try { const a = el.querySelector('canvas'), b = fl.querySelector('canvas'); b.width = a.width; b.height = a.height; b.getContext('2d').drawImage(a, 0, 0); } catch (_) {}
      fl.animate([
        { left: '-1px', top: '-1px', width: (innerWidth + 2) + 'px', height: (innerHeight + 2) + 'px', opacity: 0 },
        { left: '-1px', top: '-1px', width: (innerWidth + 2) + 'px', height: (innerHeight + 2) + 'px', opacity: 0.7, offset: 0.25 },
        { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', opacity: 1 }], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => fl.remove();
    });
    USER.zoom = 1; USER.vlon = USER.vlat = 0;
    ST.mode = 'wall'; ST.card = -1; SAT.at = 0; Object.assign(VT, { lat: clamp(HOME.lat - 8, -60, 60), lon: V.lon }); wallView();
    links.forEach(l => { l.k = 0; }); ST.popAt = performance.now() + 250;
    cardEls.forEach((c, j) => { if (j !== i) c.classList.remove('in'); });
    FL.lock = -1;
  }
  function hide() {
    if (!ST.on) return;
    ST.ending = true; ST.mode = 'off'; root.classList.remove('wall', 'card', 'ready');
    cardEls.forEach(el => el.classList.remove('in'));
    setTimeout(() => { if (ST.ending) { ST.on = false; ST.ending = false; root.classList.remove('on'); } }, 700);
    send({ type: 'earth_state', on: false });
  }
  function command(m) {
    const a = (m && m.action) || 'show';
    if (a === 'show' || a === 'play') { if (ST.on && ST.mode === 'card') close(); else if (!ST.on || ST.ending) show(); return { ok: true }; }
    if (a === 'open') { if (m.flight) { ST.flightQ = String(m.flight).toUpperCase(); if (ST.mode === 'card' && CARDS[ST.card].k === 'flights') { fillFull(); return { ok: true }; } } return { ok: open(m.card) }; }
    if (a === 'close' || a === 'back') { if (ST.mode === 'card') close(); else hide(); return { ok: true }; }
    if (a === 'hide') { hide(); return { ok: true }; }
    return { ok: false };
  }
  addEventListener('keydown', (e) => {
    if (!ST.on || ST.ending || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/input|textarea/i.test((document.activeElement || {}).tagName || '')) return;
    if (ST.mode === 'card' && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    const n = +e.key; if (n >= 1 && n <= 8) { e.preventDefault(); e.stopImmediatePropagation(); open(n - 1); }
  }, true);

  /* ------------------------------------------------------------------ hand: point at a card, pinch to open; a held fist goes back */
  let handPrev = null, twoBase = null;
  function hand2(o) {             /* both hands pinching, pulled apart or together: zoom */
    if (!live()) return;
    if (!o.both) { twoBase = null; return; }
    if (!twoBase) twoBase = { d: o.d, z: USER.zoom }; else { USER.zoom = clamp(twoBase.z * twoBase.d / Math.max(0.02, o.d), 0.32, 2.4); USER.at = performance.now(); }
  }
  function hand(h) {
    if (!ST.on || ST.ending) return;
    const now = performance.now();
    twoBase = null;
    const overCol = ST.mode === 'wall' ? [...root.querySelectorAll('.ew-col')].find(c => { const r = c.getBoundingClientRect(); return h.sx >= r.left && h.sx <= r.right && h.sy >= r.top && h.sy <= r.bottom; }) : null;
    if (h.open && handPrev && handPrev.open) { const dt = (now - handPrev.t) / 1000; if (dt > 0 && dt < 0.3) { if (overCol) overCol.scrollTop -= (h.sy - handPrev.sy) * 1.8; else rotateBy((h.sx - handPrev.sx) * 1.6, (h.sy - handPrev.sy) * 1.6, dt); } }
    else if (handPrev && handPrev.open && !h.open) { USER.vlon *= 0.5; USER.vlat *= 0.5; }
    handPrev = { sx: h.sx, sy: h.sy, open: h.open, t: now };
    if (ST.mode === 'wall') {
      let hit = -1;
      cardEls.forEach((el, i) => { const r = el.getBoundingClientRect(); if (h.sx >= r.left - 12 && h.sx <= r.right + 12 && h.sy >= r.top - 12 && h.sy <= r.bottom + 12) hit = i; });
      if (hit !== ST.hover) { cardEls.forEach((el, i) => el.classList.toggle('hover', i === hit)); ST.hover = hit; }
      if (h.pinch && !ST.pinchWas && hit >= 0) open(hit);
    } else if (ST.mode === 'card') {
      if (h.fist) { if (!ST.fistAt) ST.fistAt = now; else if (now - ST.fistAt > 550) { ST.fistAt = 0; close(); } }
      else ST.fistAt = 0;
      if (h.pinch && !ST.pinchWas) lockAt(h.sx, h.sy);
    }
    ST.pinchWas = !!h.pinch;
  }

  /* ------------------------------------------------------------------ frame */
  let W = 0, H = 0, fr = 0, RA = 0;
  const wv = new THREE.Vector3(), cam = new THREE.Vector3();
  let frameErr = 0;
  function frame(dt) { try { frame1(dt); } catch (e) { if (frameErr++ < 3) console.warn('earth frame', e); } }
  function frame1(dt) {
    const want = ST.on;
    ST.appear = clamp(ST.appear + (want && !ST.ending ? dt / 0.9 : -dt / 0.5), 0, 1);
    if (!ST.on && ST.appear <= 0) return;
    const w = innerWidth, h = innerHeight;
    if (w !== W || h !== H) { W = w; H = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (ST.mode === 'wall') wallView(); else if (ST.mode === 'card') cardView(CARDS[ST.card].k); }
    const t = performance.now() / 1000; fr++;
    U.uTime.value = t;
    const ap = easeOut(ST.appear);
    dim(ap);

    /* view */
    const idle = performance.now() - USER.at;
    if (!drag && (USER.vlon || USER.vlat)) {          /* a fling keeps turning the globe and slows down */
      VT.lon += USER.vlon * dt; VT.lat = clamp(VT.lat + USER.vlat * dt, -75, 75); V.lon += USER.vlon * dt; V.lat = clamp(V.lat + USER.vlat * dt, -75, 75);
      const f = Math.pow(0.08, dt); USER.vlon *= f; USER.vlat *= f; if (Math.abs(USER.vlon) + Math.abs(USER.vlat) < 0.05) USER.vlon = USER.vlat = 0;
    }
    if (ST.mode === 'wall' && idle > 6000 && !drag) VT.lon += 3 * dt;     /* left alone: the planet turns slowly */
    const kv = 1 - Math.pow(ST.mode === 'card' ? 0.12 : 0.2, dt);
    let dl = VT.lon - V.lon; dl = ((dl + 540) % 360) - 180;
    const distT = Math.max(DIST_MIN, VT.dist * USER.zoom);
    V.lon += dl * kv; V.lat += (VT.lat - V.lat) * kv; V.dist += (distT - V.dist) * (1 - Math.pow(0.02, dt)); V.sx += (VT.sx - V.sx) * kv; V.sy += (VT.sy - V.sy) * kv;
    globe.rotation.set(V.lat * D2R, -V.lon * D2R - PI / 2, 0);
    globe.position.set(V.sx, V.sy, 0); ringG.position.copy(globe.position);
    camera.position.set(0, 0, V.dist); camera.lookAt(0, 0, 0);
    const scale0 = 0.82 + 0.18 * ap; globe.scale.setScalar(scale0); ringG.scale.setScalar(scale0 * (ST.mode === 'card' ? 1.4 : 1));
    ringG.rotation.y += dt * 0.05; ringG.children.forEach((r, i) => r.rotation.y += dt * (i ? -0.03 : 0.04));
    const s = sunNow(); ll(s.lat, s.lon, 1, SUN);
    U.uAlpha.value = ap;
    grat.material.uniforms.uAlpha.value = ap * (ST.mode === 'card' ? 0.35 : 0.7);
    RA += ((ST.mode === 'card' ? 0 : 0.4) - RA) * (1 - Math.pow(0.05, dt));
    ringG.children.forEach(r => { r.material.uniforms.uAlpha.value = ap * RA; r.material.uniforms.uScale.value = h * 0.05; }); ringG.visible = RA * ap > 0.004;

    /* layers */
    const open_k = ST.mode === 'card' ? CARDS[ST.card].k : null;
    for (const k in L) {
      const mine = open_k && LAYER_OF[open_k].includes(k);
      const target = !ST.on || ST.ending ? 0 : open_k ? (mine ? 1 : (k === 'wind' || k === 'aurora' ? 0.04 : 0.1)) : WALL_A[k];
      layerA[k] += (target - layerA[k]) * (1 - Math.pow(0.06, dt));
      const m = L[k].m.material; m.uniforms.uAlpha.value = layerA[k] * ap;
      if (m.uniforms.uScale) m.uniforms.uScale.value = h * (k === 'flights' ? (open_k === 'flights' ? 0.024 : 0.016) : k === 'aurora' ? 0.012 : k === 'stations' ? 0.02 : 0.014) * (mine && k !== 'flights' && k !== 'aurora' ? 1.8 : 1);
      L[k].m.visible = m.uniforms.uAlpha.value > 0.003;
    }
    stormSprites.forEach(sp => { sp.material.opacity = layerA.storms * ap; sp.material.rotation -= dt * 1.6; const kk = sp.userData.k * (open_k === 'storms' ? 1.6 : 1); sp.scale.set(kk, kk, 1); });
    if (FL.n && (fr % 30 === 0)) stepFlights();
    if (ST2.st.length && fr % 3 === 0) stepStations();
    if (SAT.n && layerA.sats * ap > 0.01) stepSats(Math.ceil(SAT.n / (open_k === 'stations' ? 4 : 10)));   /* each satellite moves every 4-10 frames */
    if (WD.parts && layerA.wind * ap > 0.01 && (open_k === 'wind' || fr % 2 === 0)) stepWind(Math.min(open_k === 'wind' ? dt : dt * 2, 0.08), open_k === 'wind' ? L.wind.max : 1000);   /* on the wall: fewer streaks, half rate */
    if (L.arc.n) { const ph = (t * 0.25) % 1, a = L.arc.aa.array; for (let j = 0; j < L.arc.n; j++) { const u = j / L.arc.n, v = u < ph ? 0.9 * Math.max(0.15, 1 - (ph - u) * 1.5) : 0; a[j * 2] = a[j * 2 + 1] = v; } L.arc.aa.needsUpdate = true; }

    L.flights.m.material.uniforms.uRes.value.set(w, h);
    globe.updateMatrixWorld(true);
    renderer.render(scene, camera);

    /* cards pop in one by one, then their lines draw */
    if (ST.mode === 'wall') {
      const since = performance.now() - ST.popAt;
      cardEls.forEach((el, i) => {
        if (since > i * 120 && !el.classList.contains('in')) { el.classList.add('in', 'flash'); setTimeout(() => el.classList.remove('flash'), 420); }
      });
    }
    drawLinks(w, h);
    placeMarks(w, h);
    tickNumbers(); tickClockCards();
    const pn = performance.now();
    if (ST.on && !ST.ending && pn - ST.fetchAt > (ST.voice ? 120000 : 5000)) {    /* keep the feeds fresh; retry soon while the service is not there */
      ST.fetchAt = pn; const ok = send({ type: 'earth_fetch', cards: ST.mode === 'card' ? [CARDS[ST.card].k] : undefined });
      if (ok && !ST.voice) send({ type: 'earth_state', on: true });
      if (ok !== ST.voice) { ST.voice = ok; CARDS.forEach((_, i) => renderCard(i)); }
    }
    if (ST.mode === 'wall') { const i = fr % CARDS.length; try { drawMini(i, t); } catch (e) { if (!miniT[i]) { miniT[i] = 1; console.warn('earth mini', CARDS[i].k, e); } } }
    if (ST.mode === 'card' && CARDS[ST.card].k === 'flights') placeLock(w, h); else if (ST.mode === 'card') placePick(w, h); else lockEl.classList.remove('on');
  }
  const mv = new THREE.Vector3();
  function project(lat, lon, r) {     /* -> [x, y, facing] in CSS pixels */
    ll(lat, lon, r, mv).applyMatrix4(globe.matrixWorld);
    const f = mv.clone().sub(globe.position).normalize().dot(camera.position.clone().sub(mv).normalize());
    mv.project(camera); return [(mv.x + 1) / 2 * innerWidth, (1 - mv.y) / 2 * innerHeight, f];
  }
  function placeMarks(w, h) {
    const on = ST.on && !ST.ending && ST.appear > 0.6;
    const q = D.flightq, r = on && ST.mode === 'card' && CARDS[ST.card].k === 'flights' && q && q.q === ST.flightQ ? q.route : null;     /* the looked-up flight's airports */
    apTags.forEach((el, i) => {
      const a = r && (i ? r.to : r.from); if (!a || a.lat == null) { el.classList.remove('on'); return; }
      const [x, y, f] = project(a.lat, a.lon, 1.006); el.classList.toggle('on', f > 0.02); el.style.transform = `translate(${x + 8}px,${y - 8}px)`;
      const tx = (i ? '到 ' : '从 ') + (a.city || a.name || '') + (a.iata ? `<b>${a.iata}</b>` : ''); if (el.innerHTML !== tx) el.innerHTML = tx;
    });
    const [hx, hy, hf] = project(HOME.lat, HOME.lon, 1.006);
    const showHome = on && hf > 0.05; homeEl.classList.toggle('on', showHome);
    if (showHome) { homeEl.style.transform = `translate(${hx}px,${hy}px)`; const tx = '你在这里 · ' + homeName(); if (homeTx.textContent !== tx) homeTx.textContent = tx; }
    stTags.forEach((el, i) => {
      const s = ST2.st[i], p = stPos[i]; const vis = on && s && p && (ST.mode === 'wall' || CARDS[ST.card].k === 'stations');
      if (!vis) { el.classList.remove('on'); return; }
      const [x, y, f] = project(p[0], p[1], satLL(s.el, Date.now())[2]);
      el.classList.toggle('on', f > -0.3); el.style.transform = `translate(${x + 10}px,${y - 18}px)`;
      const tx = s.name + (ST.mode === 'card' ? `<b>${Math.abs(p[0]).toFixed(1)}°${p[0] >= 0 ? 'N' : 'S'} ${Math.abs(p[1]).toFixed(1)}°${p[1] >= 0 ? 'E' : 'W'}</b>` : '');
      if (el.innerHTML !== tx) el.innerHTML = tx;
    });
  }
  function drawLinks(w, h) {
    const vis = ST.mode === 'wall' && !ST.ending;
    const since = performance.now() - ST.popAt;
    links.forEach((L1, i) => {
      const el = cardEls[i];
      const tgt = vis && el.classList.contains('in') ? clamp((since - i * 120 - 260) / 520, 0, 1) : 0;
      L1.k = tgt ? easeOut(tgt) : Math.max(0, L1.k - 0.2);
      if (L1.k < 0.01) { L1.g.style.display = 'none'; return; }
      L1.g.style.display = '';
      const r = el.getBoundingClientRect(), left = i % 2 === 0, cr = el.parentElement.getBoundingClientRect();
      if (r.top + r.height * 0.5 < cr.top || r.top + r.height * 0.5 > cr.bottom) { L1.g.style.display = 'none'; return; }
      const ex = left ? r.right : r.left, ey = r.top + r.height * 0.5;
      anchorOf(i); wv.copy(anchorV[i]).applyMatrix4(globe.matrixWorld);
      const facing = wv.clone().sub(globe.position).normalize().dot(cam.copy(camera.position).sub(wv).normalize());
      wv.project(camera); const ax = (wv.x + 1) / 2 * w, ay = (1 - wv.y) / 2 * h;
      const bx = ex + (left ? 28 : -28);
      const d = `M${ex},${ey} L${bx},${ey} L${ax},${ay}`;
      L1.p.setAttribute('d', d);
      const len = 28 + Math.hypot(ax - bx, ay - ey);
      L1.p.style.strokeDasharray = `${len} ${len}`; L1.p.style.strokeDashoffset = `${len * (1 - L1.k)}`;
      const back = facing < 0.02;
      if (back) {     /* the place is round the back: end the line at the globe's rim instead of on top of the near side */
        const c = globe.position.clone().project(camera), cx = (c.x + 1) / 2 * w, cy = (1 - c.y) / 2 * h;
        const rs = (h / 2) / Math.tan(15 * D2R) * Math.tan(Math.asin(Math.min(0.99, globe.scale.x / camera.position.z)));
        const dx = ax - cx, dy = ay - cy, dd = Math.hypot(dx, dy) || 1; const lx = cx + dx / dd * rs, ly = cy + dy / dd * rs;
        L1.p.setAttribute('d', `M${ex},${ey} L${bx},${ey} L${lx},${ly}`);
        L1.p.style.strokeDasharray = L1.k < 0.99 ? `${len} ${len}` : '3 5';
      }
      L1.g.style.opacity = back ? 0.45 : 1;
      const pulse = 7 + 5 * ((performance.now() / 1000 * 0.8 + i * 0.3) % 1);
      L1.r.setAttribute('cx', ax); L1.r.setAttribute('cy', ay); L1.r.setAttribute('r', pulse); L1.r.style.opacity = back || L1.k < 0.95 ? 0 : 1 - (pulse - 7) / 5;
      L1.d.setAttribute('cx', ax); L1.d.setAttribute('cy', ay); L1.d.style.opacity = L1.k > 0.95 && !back ? 1 : 0;
      L1.e.setAttribute('cx', ex); L1.e.setAttribute('cy', ey);
    });
  }

  function live() { return ST.on && !ST.ending; }
  function dbg() { const mini = CARDS.map((c, i) => { try { drawMini(i, 1); const cv = cardCv[i], x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let j = 3; j < d.length; j += 4) if (d[j] > 10) n++; return [c.k, cv.width, cv.height, n]; } catch (e) { return [c.k, 'ERR ' + e.message]; } });
    return { mini, home: HOME, lock: FL.lock, st: stPos, a: CARDS.map((c, i) => { anchorOf(i); const v = anchorV[i].clone().applyMatrix4(globe.matrixWorld).project(camera); return [c.k, Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; }) }; }
  return { command, data, frame, hand, hand2, hide, show, open, close, live, dbg, snap() { Object.assign(V, VT); for (const k in L) layerA[k] = ST.mode === 'card' ? (LAYER_OF[CARDS[ST.card].k].includes(k) ? 1 : 0.1) : WALL_A[k]; ST.appear = 1; }, state: ST, cards: CARDS.map(c => c.k), _D: D, _SAT: SAT, _L: L, _A: layerA };
}
