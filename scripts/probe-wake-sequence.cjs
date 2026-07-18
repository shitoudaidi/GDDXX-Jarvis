const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const packaged = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_PROBE_PACKAGED || ''))
const electronPath = packaged
  ? path.join(root, 'dist', 'win-unpacked', 'Jarvis.exe')
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!fs.existsSync(electronPath)) {
  console.error(JSON.stringify({ ok: false, error: `Electron executable missing: ${electronPath}` }, null, 2))
  process.exit(1)
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wake-sequence-'))
const child = childProcess.spawn(electronPath, packaged ? [] : ['.'], {
  cwd: packaged ? path.dirname(electronPath) : root,
  env: {
    ...process.env,
    JARVIS_WAKE_SEQUENCE_PROBE: '1',
    JARVIS_DISABLE_SOCIAL: '1',
    JARVIS_SKIP_STARTUP_SELF_CHECK: '1',
    JARVIS_USER_DIR: userDir,
    JARVIS_RESOURCES_DIR: packaged ? path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar') : root,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let output = ''
let parsedResult = null
let settled = false

function capture(chunk, stream) {
  const value = chunk.toString('utf8')
  output += value
  stream.write(value)
  const match = output.match(/JARVIS_WAKE_SEQUENCE_PROBE_RESULT\s+(\{[^\r\n]*\})/)
  if (match) {
    try { parsedResult = JSON.parse(match[1]) } catch {}
  }
}

child.stdout.on('data', chunk => capture(chunk, process.stdout))
child.stderr.on('data', chunk => capture(chunk, process.stderr))

const timeout = setTimeout(() => {
  if (settled) return
  settled = true
  try { child.kill() } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: 'wake sequence probe timed out',
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-30),
  }, null, 2))
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
  process.exit(1)
}, 60_000)

child.on('exit', code => {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
  if (!parsedResult) {
    console.error(JSON.stringify({
      ok: false,
      error: 'wake sequence result marker missing',
      code,
      outputTail: output.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2))
    process.exit(1)
    return
  }
  process.exit(code || (parsedResult.ok ? 0 : 1))
})
