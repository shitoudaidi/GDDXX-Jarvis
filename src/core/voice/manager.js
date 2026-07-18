import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const VOICE_WS_PORT = Number(
  process.env.JARVIS_LOCAL_ASR_PORT ||
  process.env.JARVIS_LOCAL_ASR_PORT ||
  3723
)

let proc = null
let status = 'stopped'
let statusMessage = ''

function resolveServer() {
  const explicitExe = process.env.JARVIS_WHISPER_SERVER_EXE || process.env.JARVIS_WHISPER_SERVER_EXE
  if (explicitExe && fs.existsSync(explicitExe)) return { mode: 'exe', path: explicitExe }

  const resourcesDir = process.env.JARVIS_RESOURCES_DIR || process.env.JARVIS_RESOURCES_DIR
  if (resourcesDir && resourcesDir.endsWith('.asar')) {
    const resourcesPath = path.dirname(resourcesDir)
    const exe = path.join(resourcesPath, 'voice', 'whisper_server.exe')
    if (fs.existsSync(exe)) return { mode: 'exe', path: exe }

    const unpacked = resourcesDir.replace(/\.asar$/, '.asar.unpacked')
    const unpackedPy = path.join(unpacked, 'src', 'core', 'voice', 'whisper_server.py')
    if (fs.existsSync(unpackedPy)) return { mode: 'python', path: unpackedPy }
  }

  if (resourcesDir) {
    const bundledPy = path.join(resourcesDir, 'src', 'core', 'voice', 'whisper_server.py')
    if (fs.existsSync(bundledPy)) return { mode: 'python', path: bundledPy }
  }

  return { mode: 'python', path: path.join(__dirname, 'whisper_server.py') }
}

function findPython() {
  return process.env.JARVIS_PYTHON ||
    (process.platform === 'win32' ? 'python' : 'python3')
}

export function getVoiceStatus() {
  const server = resolveServer()
  return {
    status,
    message: statusMessage,
    port: VOICE_WS_PORT,
    pid: proc?.pid ?? null,
    available: fs.existsSync(server.path),
    server,
  }
}

export function startVoiceServer({ model = process.env.JARVIS_WHISPER_MODEL || 'tiny' } = {}) {
  if (proc) return getVoiceStatus()

  if (/^(1|true|yes|on)$/i.test(String(process.env.JARVIS_ASR_ROUTE_PROBE || ''))) {
    status = 'running'
    statusMessage = `Local Whisper route probe on port ${VOICE_WS_PORT}`
    return getVoiceStatus()
  }

  const server = resolveServer()
  if (server.mode !== 'exe' && !fs.existsSync(server.path)) {
    status = 'error'
    statusMessage = `Local Whisper server file not found: ${server.path}`
    console.error(`[Voice] ${statusMessage}`)
    return getVoiceStatus()
  }

  status = 'starting'
  statusMessage = `Loading local Whisper model (${model})`

  const spawnArgs = ['--model', model, '--port', String(VOICE_WS_PORT)]
  const command = server.mode === 'exe' ? server.path : findPython()
  const args = server.mode === 'exe' ? spawnArgs : [server.path, ...spawnArgs]

  console.log(`[Voice] starting local ASR: ${command} ${args.join(' ')}`)
  proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })

  proc.stdout.on('data', (data) => {
    for (const line of data.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      console.log(`[Voice] ${trimmed}`)
      if (trimmed.includes('ws://')) {
        status = 'running'
        statusMessage = `Local Whisper running on port ${VOICE_WS_PORT}`
      } else if (/whisper|load|model/i.test(trimmed)) {
        statusMessage = trimmed
      }
    }
  })

  proc.stderr.on('data', (data) => {
    const text = data.toString('utf8').trim()
    if (text) console.error(`[Voice] ${text}`)
  })

  proc.on('exit', (code, signal) => {
    console.log(`[Voice] exited code=${code} signal=${signal}`)
    proc = null
    status = code === 0 ? 'stopped' : 'error'
    statusMessage = code === 0 ? 'Stopped' : `Exited unexpectedly (code ${code})`
  })

  proc.on('error', (err) => {
    console.error('[Voice] failed to start local ASR:', err.message)
    proc = null
    status = 'error'
    statusMessage = `Failed to start local ASR: ${err.message}`
  })

  return getVoiceStatus()
}

export function stopVoiceServer() {
  if (!proc) return getVoiceStatus()
  try { proc.kill('SIGTERM') } catch {}
  proc = null
  status = 'stopped'
  statusMessage = 'Stopped'
  return getVoiceStatus()
}

export function restartVoiceServer(model = process.env.JARVIS_WHISPER_MODEL || 'tiny') {
  stopVoiceServer()
  setTimeout(() => startVoiceServer({ model }), 500)
  return getVoiceStatus()
}
