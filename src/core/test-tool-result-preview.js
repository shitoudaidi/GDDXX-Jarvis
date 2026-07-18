// Run: node src/test-tool-result-preview.js

import {
  compactToolPayload,
  truncateToolResultForUI,
} from './runtime/tool-result-preview.js'

let failed = 0
function assert(cond, label) {
  if (!cond) {
    failed++
    process.exitCode = 1
    console.error(`FAIL: ${label}`)
  } else {
    console.log(`PASS: ${label}`)
  }
}

const longText = 'x'.repeat(700)
const compacted = compactToolPayload({
  ok: true,
  stdout: longText,
  nested: { content: longText },
  rows: Array.from({ length: 12 }, (_, i) => ({ i })),
})

assert(compacted.stdout.length < longText.length, 'compactToolPayload truncates long top-level strings')
assert(compacted.nested.content.length < longText.length, 'compactToolPayload truncates nested strings')
assert(compacted.rows.length === 10, 'compactToolPayload caps arrays at 10 items')

const preview = truncateToolResultForUI({ ok: true, stdout: longText }, '')
let parsedPreview = null
try {
  parsedPreview = JSON.parse(preview)
} catch {}
assert(parsedPreview?.ok === true, 'truncateToolResultForUI keeps object previews valid JSON')
assert(String(parsedPreview?.stdout || '').includes('已截断'), 'truncateToolResultForUI marks truncated fields')

const raw = 'a'.repeat(1200)
assert(
  truncateToolResultForUI(null, raw).length === 1000,
  'truncateToolResultForUI preserves raw-text 1000-char cap',
)

if (failed === 0) {
  console.log('\nAll tool-result-preview checks complete.')
} else {
  console.log(`\n${failed} tool-result-preview check(s) failed.`)
}
