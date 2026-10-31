/* 流浪地球计划 (github.com/oxomkbk/earth-migration, MIT; a fan work of 《流浪地球》, so it is an optional download, not part
   of Jarvis). The menu entry opens a full-screen player; the first time it offers the download (the voice service fetches
   the author's files, checks every one against a sha256 list and serves them on 127.0.0.1). Jarvis's own scene stops
   rendering while the film is up: two WebGL scenes at once stutter. Voice: 「打开流浪地球」「第二部」「关闭流浪地球」. */
(() => {
  const css = document.createElement('style');
  css.textContent = `
#emBox{position:fixed;inset:0;z-index:9500;background:#000;opacity:0;transition:opacity .5s}
#emBox.on{opacity:1}
#emBox[hidden]{display:none}
#emBox iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
#emBar{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:2;opacity:.35;transition:opacity .3s}
#emBar:hover,#emBox.get #emBar{opacity:1}
#emBar button{background:rgba(0,0,0,.55);border:1px solid rgba(var(--sk-pri,127,219,255),.4);color:var(--ink,#e8f5fa);font:600 11px/1 var(--mono,ui-monospace,monospace);letter-spacing:.14em;padding:8px 12px;cursor:pointer}
#emBar button[aria-pressed="true"]{background:rgba(var(--sk-pri,127,219,255),.85);color:#001018;border-color:transparent}
#emBar .em-x{border-color:rgba(255,174,107,.6);color:rgb(255,194,122)}
#emGet{position:absolute;inset:0;display:grid;place-items:center;padding:16px}
#emGet[hidden]{display:none}
#emGet .eg{max-width:520px;border:1px solid rgba(var(--sk-pri,127,219,255),.3);background:rgba(6,18,26,.85);padding:26px 28px;color:var(--ink-2,#b8d4de);font-size:13px;line-height:1.7}
#emGet h2{margin:0 0 4px;color:var(--ink,#e8f5fa);font:600 20px/1.2 var(--mono,ui-monospace,monospace);letter-spacing:.24em}
#emGet h2 small{display:block;margin-top:6px;font-size:10px;letter-spacing:.3em;color:var(--ink-3,#6f8d99)}
#emGet p{margin:12px 0 0}
#emGet .note{color:var(--ink-3,#6f8d99);font-size:12px}
#emGet button{margin-top:18px;background:rgba(var(--sk-pri,127,219,255),.85);color:#001018;border:0;font:600 12px/1 var(--mono,ui-monospace,monospace);letter-spacing:.16em;padding:11px 18px;cursor:pointer}
#emGet button:disabled{opacity:.5;cursor:default}
#emGet .bar{margin-top:14px;height:3px;background:rgba(var(--sk-pri,127,219,255),.15)}
#emGet .bar i{display:block;height:100%;width:0;background:rgb(var(--sk-pri,127,219,255));transition:width .4s}
#emGet .msg{margin-top:8px;font:11px/1.5 var(--mono,ui-monospace,monospace);color:var(--ink-3,#6f8d99)}`;
  document.head.appendChild(css);
  const box = document.createElement('div');
  box.id = 'emBox'; box.hidden = true;
  box.innerHTML = `<div id="emBar"><button type="button" data-p="1">第一部 · 地球发动机</button><button type="button" data-p="2">第二部 · 飞出银河</button><button type="button" class="em-x">返回贾维斯 ✕</button></div>
    <iframe title="流浪地球计划" allow="autoplay; fullscreen"></iframe>
    <div id="emGet" hidden><div class="eg"><h2>流浪地球计划<small>THE EARTH MIGRATION PROJECT</small></h2>
      <p>两部 WebGL 影片：第一部是行星发动机点火、地球启程离开太阳系；第二部从发动机一路拉远到整个银河系。</p>
      <p class="note">这是 oxomkbk 制作的《流浪地球》同人作品（MIT 许可，<span class="em-src"></span>），不随贾维斯附带。点下载后从作者的 GitHub 仓库（或它的公共 CDN 镜像）下载，每个文件都会核对校验码。</p>
      <button type="button" class="em-dl">下载（约 <span class="em-mb">36</span> MB）</button>
      <div class="bar"><i></i></div><div class="msg"></div></div></div>`;
  document.body.appendChild(box);
  const fr = box.querySelector('iframe'), get = box.querySelector('#emGet'), dl = box.querySelector('.em-dl');
  const bar = box.querySelector('.bar i'), note = box.querySelector('.msg');
  box.querySelector('.em-src').textContent = 'github.com/oxomkbk/earth-migration';
  let part = 0, want = 1, base = '';
  function load(p) {
    want = p;
    box.querySelectorAll('#emBar [data-p]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.p === p)));
    if (!base) { get.hidden = false; box.classList.add('get'); fr.style.visibility = 'hidden'; part = 0; return; }
    get.hidden = true; box.classList.remove('get'); fr.style.visibility = '';
    part = p;
    fr.src = base + (p === 2 ? 'beyond.html?q=low' : 'index.html?lite');   // the film's own low-quality settings
    fr.onload = () => { try { fr.contentWindow.focus(); } catch (_) {} };
  }
  function open(p) {
    p = p === 2 ? 2 : 1;
    window.EM_ON = true;
    if (typeof EW !== 'undefined' && EW && EW.live && EW.live()) { try { EW.hide(); } catch (_) {} }
    box.hidden = false; requestAnimationFrame(() => box.classList.add('on'));
    if (part !== p) load(p);
    if (window.liveSend) { liveSend({ type: 'em_state', on: true }); if (!base) liveSend({ type: 'em_status' }); }
  }
  function close() {
    box.classList.remove('on');
    if (window.liveSend) liveSend({ type: 'em_state', on: false });
    setTimeout(() => { box.hidden = true; fr.style.visibility = 'hidden'; fr.src = 'about:blank'; part = 0; window.EM_ON = false; }, 500);
  }
  window.emOpen = open; window.emClose = close;
  window.emMsg = m => {
    if (m.size_mb) box.querySelector('.em-mb').textContent = m.size_mb;
    if (m.url) base = m.url;
    if (m.error) { dl.disabled = false; dl.textContent = '重试下载'; note.textContent = '下载没成功：' + m.error; }
    else if (m.busy || (m.progress != null && m.progress < 1)) { dl.disabled = true; dl.textContent = '正在下载…'; }
    if (m.progress != null) { bar.style.width = Math.round(m.progress * 100) + '%'; if (!m.error) note.textContent = Math.round(m.progress * 100) + '%'; }
    if (m.on === false) return close();
    if (m.on === true) return open(m.part);
    if (base && !box.hidden && !part) load(want);
  };
  dl.addEventListener('click', () => {
    if (!window.liveSend || !liveSend({ type: 'em_install' })) { note.textContent = '还没连上贾维斯的语音服务，稍后再试。'; return; }
    dl.disabled = true; dl.textContent = '正在下载…'; note.textContent = '';
  });
  box.querySelector('#emBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('em-x')) close(); else load(+b.dataset.p);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); close(); } }, true);
  const pop = document.getElementById('menuPop');
  if (pop) {
    const mb = Object.assign(document.createElement('button'), { type: 'button', textContent: '流浪地球计划' });
    mb.addEventListener('click', e => { e.stopPropagation(); pop.hidden = true; open(1); });
    pop.appendChild(mb);
  }
})();
