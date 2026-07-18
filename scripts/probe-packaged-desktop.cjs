const childProcess = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const executable = path.join(root, 'dist', 'win-unpacked', 'Jarvis.exe')
const child = childProcess.spawn(executable, [], {
  cwd: path.dirname(executable),
  env: {
    ...process.env,
    JARVIS_DESKTOP_PROBE: '1',
    JARVIS_SKIP_STARTUP_SELF_CHECK: '1',
    JARVIS_HOME: root,
    JARVIS_USER_DIR: path.join(root, 'runtime', 'jarvis'),
    JARVIS_RESOURCES_DIR: path.dirname(executable),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let output = ''
let result = null
const capture = (chunk, stream) => {
  const text = chunk.toString('utf8')
  output += text
  stream.write(text)
  const match = output.match(/JARVIS_DESKTOP_PROBE_RESULT\s+(\{[\s\S]*?\})\s*$/m)
  if (match) {
    try { result = JSON.parse(match[1]) } catch {}
  }
}
child.stdout.on('data', (chunk) => capture(chunk, process.stdout))
child.stderr.on('data', (chunk) => capture(chunk, process.stderr))

const timeout = setTimeout(() => {
  try { child.kill() } catch {}
  console.error(JSON.stringify({ ok: false, error: 'packaged desktop probe timed out' }))
  process.exit(1)
}, 90_000)

child.on('exit', (code) => {
  clearTimeout(timeout)
  if (!result) {
    console.error(JSON.stringify({ ok: false, error: 'packaged probe result marker missing', code, outputTail: output.split(/\r?\n/).filter(Boolean).slice(-20) }))
    process.exit(1)
    return
  }
  process.exit(code || (result.ok ? 0 : 1))
})
