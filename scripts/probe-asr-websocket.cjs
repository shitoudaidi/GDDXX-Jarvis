const WebSocket = require('ws');

const url = process.argv[2] || 'ws://127.0.0.1:3721/voice/cloud';
const provider = process.argv[3] || 'aliyun';
const timeoutMs = Number(process.argv[4] || 10000);

let done = false;
let ws;
function finish(result) {
  if (done) return;
  done = true;
  try { ws?.close(); } catch {}
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const timer = setTimeout(() => {
  finish({ ok: false, stage: 'timeout', message: `No ASR diagnostic event within ${timeoutMs}ms` });
}, timeoutMs);

ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'config', provider, lang: 'zh' }));
});
ws.on('message', (raw) => {
  let data;
  try { data = JSON.parse(raw.toString()); } catch { return; }
  if (data.type === 'diag') {
    clearTimeout(timer);
    finish({ ok: true, stage: 'diag', event: data.event, info: data.info || null });
  } else if (data.type === 'error') {
    clearTimeout(timer);
    finish({ ok: false, stage: 'error', message: data.message || 'unknown ASR error' });
  } else if (data.type === 'transcript') {
    clearTimeout(timer);
    finish({ ok: true, stage: 'transcript', text: data.text || '', final: !!data.is_final });
  }
});
ws.on('error', (error) => {
  clearTimeout(timer);
  finish({ ok: false, stage: 'socket-error', message: error.message });
});
ws.on('close', () => {
  if (!done) {
    clearTimeout(timer);
    finish({ ok: false, stage: 'closed', message: 'ASR socket closed before diagnostics' });
  }
});
