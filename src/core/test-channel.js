// Run: node src/test-channel.js

import { PUBLIC_CHANNELS, normalizeChannel } from './runtime/channel.js'

let failed = 0
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    failed++
    process.exitCode = 1
    console.error(`FAIL: ${label}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  } else {
    console.log(`PASS: ${label}`)
  }
}

function assert(cond, label) {
  if (!cond) {
    failed++
    process.exitCode = 1
    console.error(`FAIL: ${label}`)
  } else {
    console.log(`PASS: ${label}`)
  }
}

assertEqual(normalizeChannel(''), 'TUI', 'empty channel defaults to TUI')
assertEqual(normalizeChannel(null), 'TUI', 'null channel defaults to TUI')
assertEqual(normalizeChannel('API'), 'TUI', 'API normalizes to TUI')
assertEqual(normalizeChannel('voice'), 'TUI', 'voice normalizes to TUI')
assertEqual(normalizeChannel('语音识别'), 'TUI', 'Chinese voice channel normalizes to TUI')
assertEqual(normalizeChannel('FocusBanner'), 'TUI', 'FocusBanner normalizes to TUI')
assertEqual(normalizeChannel('WECHAT_CLAWBOT'), 'WECHAT', 'wechat clawbot normalizes to WECHAT')
assertEqual(normalizeChannel('WECHAT_OFFICIAL'), 'WECHAT', 'wechat official normalizes to WECHAT')
assertEqual(normalizeChannel('REMINDER'), 'SYSTEM', 'REMINDER normalizes to SYSTEM')
assertEqual(normalizeChannel('APP_SIGNAL'), 'SYSTEM', 'APP_SIGNAL normalizes to SYSTEM')
assertEqual(normalizeChannel('custom_channel'), 'CUSTOM_CHANNEL', 'unknown channels uppercase')
assert(PUBLIC_CHANNELS.includes('AUTO'), 'PUBLIC_CHANNELS includes AUTO')

if (failed === 0) {
  console.log('\nAll channel checks complete.')
} else {
  console.log(`\n${failed} channel check(s) failed.`)
}
