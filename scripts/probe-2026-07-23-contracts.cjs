const { spawnSync } = require('node:child_process')
const path = require('node:path')

const scripts = [
  'probe-conversation-continuity-contract.cjs',
  'probe-control-state-contract.cjs',
  'probe-voice-surface-contract.cjs',
  'probe-news-surface-continuity-contract.cjs',
  'probe-first-run-form-contract.cjs',
  'probe-engineering-continuity-contract.cjs',
  'probe-settings-continuity-contract.cjs',
  'probe-tts-continuity-contract.cjs',
  'probe-reduced-motion-contract.cjs',
  'probe-message-surface-contract.cjs',
  'probe-visual-hierarchy-contract.cjs',
  'probe-turn-cleanup-contract.cjs',
  'probe-minimum-window-contract.cjs',
  'probe-settings-visual-contract.cjs',
  'probe-compact-news-contract.cjs',
  'probe-layout-render-readiness-contract.cjs'
]

const results = scripts.map((script) => {
  const child = spawnSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8' })
  return {
    probe: script,
    ok: child.status === 0,
    output: String(child.stdout || child.stderr || '').trim()
  }
})
const failed = results.filter((item) => !item.ok)
console.log(JSON.stringify({ ok: failed.length === 0, count: results.length, results }, null, 2))
if (failed.length) process.exit(1)
