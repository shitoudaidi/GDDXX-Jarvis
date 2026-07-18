const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-turn-lifecycle-'))

const child = childProcess.spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    JARVIS_TURN_LIFECYCLE_PROBE: '1',
    JARVIS_DISABLE_SOCIAL: '1',
    JARVIS_SKIP_STARTUP_SELF_CHECK: '1',
    JARVIS_USER_DIR: userDir,
    JARVIS_RESOURCES_DIR: root,
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
  const match = output.match(/JARVIS_TURN_LIFECYCLE_PROBE_RESULT\s+(\{[^\r\n]*\})/)
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
  console.error(JSON.stringify({ ok: false, error: 'turn lifecycle probe timed out' }, null, 2))
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
  process.exit(1)
}, 90_000)

child.on('exit', code => {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
  if (!parsedResult) {
    console.error(JSON.stringify({
      ok: false,
      error: 'turn lifecycle result marker missing',
      code,
      outputTail: output.split(/\r?\n/).filter(Boolean).slice(-30),
    }, null, 2))
    process.exit(1)
    return
  }
  process.exit(code || (parsedResult.ok ? 0 : 1))
})
