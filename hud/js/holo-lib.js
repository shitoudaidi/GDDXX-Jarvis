/* 3D 拆解 library. Header button (and menu entry) opens a wall of every stored teardown; a click
   projects it straight away (no voice round trip). The list comes from the voice service ({type:'holo_list'}). */
(() => {
  const css = document.createElement('style');
  css.textContent = `
#holoLibBtn{width:auto;padding:0 12px;border-radius:18px;gap:6px;display:flex;align-items:center;font:600 11px/1 var(--mono,ui-monospace,monospace);letter-spacing:.14em;color:var(--ink-2);border:1px solid rgba(var(--sk-pri,127,219,255),.28)}
#holoLibBtn svg{width:16px;height:16px}
#holoLibBtn:hover{color:var(--ink);border-color:rgba(var(--sk-pri,127,219,255),.6);box-shadow:0 0 14px rgba(var(--sk-pri,127,219,255),.25)}
#holoLib{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 40%,rgba(4,14,22,.82),rgba(0,0,0,.94));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .35s}
#holoLib.on{opacity:1}
#holoLib[hidden]{display:none}
#holoLib .hl-box{width:min(1180px,92vw);height:min(760px,86vh);display:flex;flex-direction:column;border:1px solid rgba(var(--sk-pri,127,219,255),.25);background:linear-gradient(180deg,rgba(10,26,36,.72),rgba(4,10,16,.82));box-shadow:0 0 60px rgba(var(--sk-pri,127,219,255),.12),inset 0 0 40px rgba(var(--sk-pri,127,219,255),.05);clip-path:polygon(0 18px,18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%);position:relative}
#holoLib .hl-head{display:flex;align-items:center;gap:16px;padding:18px 24px 12px;border-bottom:1px solid rgba(var(--sk-pri,127,219,255),.15)}
#holoLib h2{margin:0;font:600 18px/1 var(--mono,ui-monospace,monospace);letter-spacing:.28em;color:var(--ink)}
#holoLib h2 small{display:block;margin-top:6px;font-size:10px;letter-spacing:.3em;color:var(--ink-3)}
#holoLib .hl-grow{flex:1}
#holoLib .hl-chips{display:flex;gap:6px}
#holoLib .hl-chips button,#holoLib .hl-x{background:transparent;border:1px solid rgba(var(--sk-pri,127,219,255),.25);color:var(--ink-2);font:11px/1 var(--mono,ui-monospace,monospace);letter-spacing:.12em;padding:7px 12px;cursor:pointer}
#holoLib .hl-chips button[aria-pressed="true"]{color:#001018;background:rgba(var(--sk-pri,127,219,255),.85);border-color:transparent}
#holoLib input{background:rgba(0,0,0,.35);border:1px solid rgba(var(--sk-pri,127,219,255),.25);color:var(--ink);font:12px/1 var(--mono,ui-monospace,monospace);padding:8px 10px;width:180px;outline:none}
#holoLib .hl-grid{flex:1;overflow:auto;padding:18px 24px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;align-content:start;grid-auto-rows:max-content;min-height:0}
#holoLib .hl-card{position:relative;display:flex;flex-direction:column;text-align:left;cursor:pointer;background:rgba(6,18,26,.6);border:1px solid rgba(var(--sk-pri,127,219,255),.16);color:var(--ink-2);padding:0;overflow:hidden;transition:border-color .2s,transform .2s,box-shadow .2s;animation:hlIn .5s both}
#holoLib .hl-card:hover{border-color:rgba(var(--sk-pri,127,219,255),.7);transform:translateY(-2px);box-shadow:0 0 24px rgba(var(--sk-pri,127,219,255),.22)}
#holoLib .hl-card svg{flex:none;display:block;width:100%;height:170px;color:rgb(var(--sk-pri,127,219,255));background:radial-gradient(circle at 50% 55%,rgba(var(--sk-pri,127,219,255),.1),transparent 65%);transition:transform .6s}
#holoLib .hl-card:hover svg{transform:scale(1.06)}
#holoLib .hl-card path{filter:drop-shadow(0 0 2px rgba(var(--sk-pri,127,219,255),.8))}
#holoLib .hl-card::after{content:"";position:absolute;left:0;right:0;top:0;height:170px;background:linear-gradient(180deg,transparent 45%,rgba(var(--sk-pri,127,219,255),.16) 50%,transparent 55%);background-size:100% 200%;animation:hlScan 3.2s linear infinite;pointer-events:none;opacity:0;transition:opacity .3s}
#holoLib .hl-card:hover::after{opacity:1}
#holoLib .hl-meta{flex:none;display:block;padding:10px 12px 12px;border-top:1px solid rgba(var(--sk-pri,127,219,255),.12)}
#holoLib .hl-meta b{display:block;color:var(--ink);font-size:14px;font-weight:500;margin-bottom:6px}
#holoLib .hl-meta em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:normal;font:10px/1 var(--mono,ui-monospace,monospace);letter-spacing:.14em;color:var(--ink-3)}
#holoLib .hl-meta em i{font-style:normal;color:rgb(var(--sk-pri,127,219,255));margin-right:8px}
#holoLib .hl-meta p{display:-webkit-box;margin:7px 0 0;font-size:11px;line-height:1.5;color:var(--ink-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#holoLib .hl-tag{position:absolute;top:8px;right:8px;font:9px/1 var(--mono,ui-monospace,monospace);letter-spacing:.16em;padding:4px 6px;border:1px solid rgba(var(--sk-pri,127,219,255),.35);color:var(--ink-2);background:rgba(0,0,0,.4)}
#holoLib .hl-empty{grid-column:1/-1;text-align:center;padding:80px 0;color:var(--ink-3);font:12px/1.8 var(--mono,ui-monospace,monospace);letter-spacing:.12em}
#holoLib .hl-foot{padding:8px 24px;font:10px/1 var(--mono,ui-monospace,monospace);letter-spacing:.16em;color:var(--ink-3);border-top:1px solid rgba(var(--sk-pri,127,219,255),.12);display:flex;gap:18px}
@keyframes hlIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes hlScan{from{background-position:0 100%}to{background-position:0 -100%}}`;
  document.head.appendChild(css);
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3l7 4v4"/><path d="M12 3L5 7v4"/><path d="M5 13v4l7 4 7-4v-4"/><path d="M12 13v8"/><path d="M5 7l7 4 7-4"/><path d="M14.5 9.5l3-1.7"/></svg>';
  const btn = Object.assign(document.createElement('button'), { className: 'icon-btn', type: 'button', id: 'holoLibBtn', title: '3D 拆解库' });
  btn.setAttribute('aria-label', '3D 拆解库');
  btn.innerHTML = icon + '<span>3D 拆解</span>';
  const wrap = document.querySelector('.icons .menu-wrap');
  if (wrap) wrap.parentNode.insertBefore(btn, wrap);
  const mb = Object.assign(document.createElement('button'), { type: 'button', textContent: '3D 拆解库' });
  const pop = document.getElementById('menuPop'); if (pop) pop.appendChild(mb);
  const box = document.createElement('div');
  box.id = 'holoLib'; box.hidden = true;
  box.innerHTML = `<div class="hl-box" role="dialog" aria-label="3D 拆解库">
    <div class="hl-head"><h2>3D 拆解库<small>HOLOGRAPHIC TEARDOWN ARCHIVE</small></h2><span class="hl-grow"></span>
      <div class="hl-chips"><button type="button" data-f="" aria-pressed="true">全部</button><button type="button" data-f="内置">内置</button><button type="button" data-f="Anatomy">Anatomy</button><button type="button" data-f="SimReady">SimReady</button></div>
      <input type="search" placeholder="搜索 发动机 / 机械臂 …" aria-label="搜索拆解资产">
      <button type="button" class="hl-x" aria-label="关闭">关闭 ESC</button></div>
    <div class="hl-grid"></div>
    <div class="hl-foot"><span class="hl-count">--</span><span>点卡片直接投影 · 也可以对贾维斯说「拆解 ×××」</span></div></div>`;
  document.body.appendChild(box);
  const grid = box.querySelector('.hl-grid'), q = box.querySelector('input');
  let items = null, filt = '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function draw() {
    if (!items) { grid.innerHTML = '<div class="hl-empty">正在读取全息资产 …</div>'; return; }
    const w = q.value.trim().toLowerCase();
    const L = items.filter(i => (!filt || i.src === filt) && (!w || (i.title + ' ' + i.file + ' ' + i.names.join(' ') + ' ' + i.desc).toLowerCase().includes(w)));
    box.querySelector('.hl-count').textContent = `${L.length} / ${items.length} 件资产`;
    grid.innerHTML = L.length ? L.map((i, k) => `<div class="hl-card" role="button" tabindex="0" data-file="${esc(i.file)}" style="animation-delay:${Math.min(k, 16) * 40}ms">
      <svg viewBox="-6 -6 112 112" aria-hidden="true"><path d="${esc(i.thumb)}" stroke="currentColor" stroke-width=".75" opacity=".85" stroke-linecap="round" fill="none"/></svg>
      <span class="hl-tag">${esc(i.src)}</span>
      <span class="hl-meta"><b>${esc(i.title)}</b><em><i>${i.parts} 个部件</i>${esc(i.names.slice(0, 3).join(' · '))}</em>${i.desc ? `<p>${esc(i.desc)}</p>` : ''}</span></div>`).join('')
      : '<div class="hl-empty">没有找到。新的拆解资产放进 ~/.jarvis/holo 就会出现在这里。</div>';
  }
  function open() {
    box.hidden = false; requestAnimationFrame(() => box.classList.add('on'));
    if (pop) pop.hidden = true;
    draw();
    const asked = Date.now(); window.holoLibAsked = asked;
    setTimeout(() => { if (!items && window.holoLibAsked === asked && !box.hidden) grid.innerHTML = '<div class="hl-empty">语音服务没有回应，稍后再打开。</div>'; }, 5000);
    if (!liveSend({ type: 'holo_list' })) { items = items || []; draw(); grid.innerHTML = '<div class="hl-empty">还没连上贾维斯的语音服务，稍后再打开。</div>'; }
  }
  function close() { box.classList.remove('on'); setTimeout(() => { box.hidden = true; }, 300); }
  window.holoLibOpen = open; window.holoLibClose = close;
  window.holoLibData = m => { items = m.items || []; if (!box.hidden) draw(); };
  btn.addEventListener('click', e => { e.stopPropagation(); open(); });
  mb.addEventListener('click', e => { e.stopPropagation(); open(); });
  box.addEventListener('click', e => {
    if (e.target === box || e.target.closest('.hl-x')) return close();
    const c = e.target.closest('.hl-chips button');
    if (c) { filt = c.dataset.f; box.querySelectorAll('.hl-chips button').forEach(b => b.setAttribute('aria-pressed', String(b === c))); return draw(); }
    const card = e.target.closest('.hl-card');
    if (card) { liveSend({ type: 'holo_show', file: card.dataset.file }); close(); }
  });
  q.addEventListener('input', draw);
  grid.addEventListener('keydown', e => { const card = e.target.closest('.hl-card'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); } });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); close(); } }, true);
})();
