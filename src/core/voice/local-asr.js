import { WebSocket } from 'ws'
import { startVoiceServer, getVoiceStatus } from './manager.js'

const CONNECT_TIMEOUT_MS = Number(process.env.JARVIS_LOCAL_ASR_CONNECT_TIMEOUT_MS || 120000)
const RETRY_DELAY_MS = 700
const MAX_PENDING_CHUNKS = 256

function localAsrUrl() {
  const status = getVoiceStatus()
  return `ws://127.0.0.1:${status.port}`
}

export function createLocalASRSession(config, onTranscript, onError, onClose, onEvent) {
  const serverStatus = startVoiceServer({ model: config.whisperModel || config.localWhisperModel })
  if (serverStatus.status === 'error') {
    onError?.(serverStatus.message || 'Local Whisper ASR failed to start')
    return null
  }

  if (/^(1|true|yes|on)$/i.test(String(process.env.JARVIS_ASR_ROUTE_PROBE || ''))) {
    setTimeout(() => onEvent?.('local-asr-ready', { status: serverStatus.status, probe: true }), 0)
    return {
      sendAudio() {},
      flush() {},
      close() {
        onClose?.()
      },
    }
  }

  const pending = []
  let ready = false
  let closed = false
  let ws = null
  let retryTimer = null
  let attempts = 0
  const startedAt = Date.now()

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const scheduleConnect = (delay = RETRY_DELAY_MS, lastError = '') => {
    if (closed) return
    if (Date.now() - startedAt > CONNECT_TIMEOUT_MS) {
      pending.length = 0
      onError?.(`Local Whisper ASR did not become ready within ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s${lastError ? `: ${lastError}` : ''}`)
      onClose?.()
      return
    }
    clearRetry()
    retryTimer = setTimeout(connect, delay)
  }

  const connect = () => {
    if (closed) return
    attempts++
    ws = new WebSocket(localAsrUrl())
    ws.binaryType = 'arraybuffer'

    ws.on('open', () => {
      ready = true
      onEvent?.('local-asr-connected', { status: getVoiceStatus().status, attempts })
      ws.send(JSON.stringify({
        type: 'config',
        lang: config.lang || 'zh',
      }))
      while (pending.length && ws.readyState === WebSocket.OPEN) {
        ws.send(pending.shift())
      }
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'transcript' && msg.text) {
          onTranscript?.(msg.text, msg.is_final !== false, msg.seg || null)
        } else if (msg.type === 'config_ok') {
          onEvent?.('local-asr-ready', msg)
        } else if (msg.type === 'sound_event') {
          onEvent?.('local-sound-event', msg)
        }
      } catch {}
    })

    ws.on('error', (err) => {
      ready = false
      onEvent?.('local-asr-waiting', { attempt: attempts, error: err.message, status: getVoiceStatus().status })
    })

    ws.on('close', () => {
      ready = false
      if (!closed) scheduleConnect(RETRY_DELAY_MS, 'socket closed')
    })
  }

  onEvent?.('local-asr-starting', { status: serverStatus.status, message: serverStatus.message })
  scheduleConnect(0)

  return {
    sendAudio(pcmBuffer) {
      const frame = Buffer.from(pcmBuffer)
      if (!ready || ws?.readyState !== WebSocket.OPEN) {
        pending.push(frame)
        while (pending.length > MAX_PENDING_CHUNKS) pending.shift()
        return
      }
      ws.send(frame)
    },
    flush() {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flush' }))
    },
    close() {
      closed = true
      clearRetry()
      pending.length = 0
      try { ws?.close() } catch {}
    },
  }
}
