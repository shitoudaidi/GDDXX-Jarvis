import assert from 'node:assert/strict'
import { isTerminalInternalToolRound, TERMINAL_INTERNAL_TOOLS } from './runtime/tool-protocol.js'

assert.equal(TERMINAL_INTERNAL_TOOLS.has('skip_recognition'), true)
assert.equal(TERMINAL_INTERNAL_TOOLS.has('skip_consolidation'), true)

assert.equal(isTerminalInternalToolRound([]), false)
assert.equal(isTerminalInternalToolRound([{ name: 'skip_recognition' }]), true)
assert.equal(isTerminalInternalToolRound([{ name: 'skip_consolidation' }]), true)
assert.equal(
  isTerminalInternalToolRound([{ name: 'skip_recognition' }, { name: 'skip_consolidation' }]),
  true,
)
assert.equal(
  isTerminalInternalToolRound([{ name: 'skip_recognition' }, { name: 'search_memory' }]),
  false,
)
assert.equal(isTerminalInternalToolRound([{ name: 'send_message' }]), false)
assert.equal(isTerminalInternalToolRound([{ name: 'skip_recognition' }], { mustReply: true }), false)

console.log('test-tool-protocol passed')
