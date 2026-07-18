// Unit tests for installed software context formatting.

import {
  __setInstalledSoftwareForTest,
  getInstalledSoftwareBlock,
} from './installed-software-scanner.js'

let failed = 0

function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

function indexOf(text, needle) {
  return String(text || '').indexOf(needle)
}

__setInstalledSoftwareForTest([])
assert(getInstalledSoftwareBlock() === '', 'empty software list produces no context block')

__setInstalledSoftwareForTest([
  { name: 'Visual Studio Code' },
  { name: 'Clash Verge Rev - 快捷方式', version: '2.0.0', publisher: 'Clash Team' },
  { name: 'WireGuard' },
  { name: 'Adobe Photoshop' },
  { name: '回收站' },
  { name: 'Uninstall Example App' },
])

const block = getInstalledSoftwareBlock()
assert(block.includes('Installed Software Snapshot'), 'non-empty list produces installed software block')
assert(block.includes('4 apps found'), 'block includes total app count')
assert(block.includes('Network / proxy / VPN candidates (2)'), 'network/proxy candidates are grouped')
assert(block.includes('Clash Verge Rev v2.0.0 (Clash Team)'), 'shortcut suffix is normalized and metadata is shown')
assert(block.includes('WireGuard'), 'VPN app is detected as network candidate')
assert(block.includes('Do not claim an app is installed unless it appears here.'), 'block warns against unsupported claims')
assert(indexOf(block, 'Clash Verge Rev') < indexOf(block, 'Adobe Photoshop'), 'network candidates appear before ordinary apps')
assert(!block.includes('回收站'), 'system shell entries are filtered')
assert(!block.includes('Uninstall Example App'), 'uninstall helper entries are filtered')

if (failed === 0) {
  console.log('\nAll installed-software tests passed.')
}

process.exit(process.exitCode || 0)
