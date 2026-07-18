const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const python = path.join(root, '.venv', 'Scripts', 'python.exe')
const script = path.join(root, 'src', 'core', 'voice', 'jarvis_tts.py')
const output = path.join(os.tmpdir(), `jarvis-voice-probe-${process.pid}.wav`)

assert.ok(fs.existsSync(python), 'Project Python environment is missing')
const result = spawnSync(python, [script, '--text', 'Systems online, sir.', '--output', output], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
})
assert.equal(result.status, 0, result.stderr || result.stdout)
assert.ok(fs.statSync(output).size > 4096, 'Synthesized WAV is unexpectedly small')
fs.rmSync(output, { force: true })
console.log('Jarvis Piper voice probe passed')
