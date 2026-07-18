// Run: node src/test-runtime-messages.js

import {
  buildLLMMessages,
  buildRuntimeContextMessages,
  formatConversationMessage,
  formatTaskSteps,
} from './runtime/messages.js'

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

const currentMsg = {
  fromId: 'ID:000001',
  timestamp: '2026-05-25T10:02:13+08:00',
  content: '那现在呢？',
  channel: 'WECHAT_CLAWBOT',
}

const conversationWindow = [
  {
    role: 'user',
    from_id: 'ID:000001',
    timestamp: '2026-05-25T10:00:00+08:00',
    content: '先在本地看一下',
    channel: 'TUI',
  },
  {
    role: 'jarvis',
    from_id: 'jarvis',
    to_id: 'ID:000001',
    timestamp: '2026-05-25T10:01:00+08:00',
    content: '我看到了，随时为您效劳！',
    channel: 'TUI',
  },
  {
    role: 'user',
    from_id: 'ID:000001',
    timestamp: currentMsg.timestamp,
    content: currentMsg.content,
    channel: currentMsg.channel,
  },
]

const messages = buildLLMMessages({
  systemPrompt: 'SYSTEM_PROMPT',
  contextBlock: '<context>CTX</context>',
  conversationWindow,
  input: '[ID:000001] 2026-05-25T10:02:13+08:00 [WECHAT_CLAWBOT] 那现在呢？',
  msg: currentMsg,
  recentActions: [{ ts: '2026-05-25T10:01:30+08:00', summary: 'read_file(foo)' }],
  actionLog: [{ timestamp: '2026-05-25T10:01:40+08:00', tool: 'read_file', summary: 'read_file(foo)', detail: 'ok' }],
  lastToolResult: { name: 'read_file', args: { path: 'foo.txt' }, result: 'hello world' },
  taskSteps: [{ text: '检查文件', status: 'done', note: 'ok' }, { text: '回复用户', status: 'pending' }],
  batteryBlock: 'Battery: 80%',
})

assertEqual(messages[0].role, 'system', 'first message is system')
assertEqual(messages[0].content, 'SYSTEM_PROMPT', 'system content preserved')
assertEqual(messages[1].role, 'user', 'runtime context is injected after system')
assert(messages[1].content.includes('[runtime context]'), 'runtime context marker present')
assert(messages[1].content.includes('Battery: 80%'), 'runtime context includes battery')
assert(messages[1].content.includes('Task step progress (1/2)'), 'runtime context includes task progress')
assert(messages[1].content.includes('Recent assistant actions'), 'runtime context includes recent actions')
assert(messages[1].content.includes('Recent tool/action log'), 'runtime context includes action log')
assert(messages[1].content.includes('Previous tool result'), 'runtime context includes last tool result')

const historicalUser = messages.find(m => m.content.includes('先在本地看一下'))
assert(historicalUser && !historicalUser.content.includes('<context>CTX</context>'), 'historical user message is not prefixed with current context')

const currentUser = messages.find(m => m.content.startsWith('<context>CTX</context>'))
assert(currentUser, 'current user message is identified')
assert(currentUser.content.startsWith('<context>CTX</context>'), 'context is prefixed to current user message')
assert(currentUser.content.includes('· WECHAT'), 'current user message shows normalized WECHAT channel')
assert(currentUser.content.includes('channel switch: TUI → WECHAT'), 'current user message marks channel switch')

const assistant = messages.find(m => m.role === 'assistant')
// The assistant line immediately preceding the current user message is the "last reply":
// it carries the salience anchor tag, then the verbatim original content.
assert(assistant.content.includes('我看到了，随时为您效劳！'), 'assistant history content preserved verbatim')
assert(assistant.content.includes('your last reply'), 'last reply is tagged as the salience anchor')
assert(assistant.content.includes('[you · '), 'assistant line carries the symmetric in-band speaker heading')
assert(assistant.content.endsWith('我看到了，随时为您效劳！'), 'tag is prepended, original content kept verbatim at the end')

const fallbackMessages = buildLLMMessages({
  systemPrompt: 'SYS',
  contextBlock: '<context>TICK</context>',
  conversationWindow: [],
  input: 'TICK 2026-05-25-10:03:00',
})
assertEqual(fallbackMessages.length, 2, 'fallback path has system + one user message')
assert(fallbackMessages[1].content.startsWith('<context>TICK</context>'), 'fallback user message gets context prefix')
assert(fallbackMessages[1].content.includes('TICK 2026-05-25-10:03:00'), 'fallback user message keeps input')
assert(!fallbackMessages[1].content.includes('[heartbeat tick'), 'fallback without isTick stays unmarked (non-tick callers unaffected)')

const tickMessages = buildLLMMessages({
  systemPrompt: 'SYS',
  contextBlock: '<context>TICK</context>',
  conversationWindow: [],
  input: 'TICK 2026-05-25-10:03:00',
  isTick: true,
})
assertEqual(tickMessages.length, 2, 'tick path has system + one user message')
assertEqual(tickMessages[1].role, 'user', 'tick fallback uses user role')
assert(tickMessages[1].content.startsWith('<context>TICK</context>'), 'tick fallback gets context prefix')
assert(tickMessages[1].content.includes('[heartbeat tick · no new user message]'), 'tick fallback carries heartbeat marker')
assert(tickMessages[1].content.includes('NOT a user message'), 'tick fallback tells the model this is not a user message')
assert(tickMessages[1].content.includes('TICK 2026-05-25-10:03:00'), 'tick fallback preserves the tick payload')

const systemSignal = formatConversationMessage({
  role: 'user',
  from_id: 'SYSTEM',
  timestamp: '2026-05-25T10:04:00+08:00',
  content: 'Reminder fired',
  channel: 'REMINDER',
})
assertEqual(systemSignal.role, 'user', 'system signal is represented as user message')
assert(systemSignal.content.includes('[system signal'), 'system signal marker present')
assert(systemSignal.content.includes('Do NOT call send_message'), 'system signal forbids send_message')

assertEqual(
  formatTaskSteps([{ text: 'A', status: 'done' }, { text: 'B', status: 'failed', note: 'nope' }]),
  'Task step progress (1/2):\n  1. [✓] A\n  2. [✗] B (nope)',
  'formatTaskSteps renders done count and notes',
)

assertEqual(buildRuntimeContextMessages({}).length, 0, 'empty runtime context emits no messages')

if (failed === 0) {
  console.log('\nAll runtime message checks complete.')
} else {
  console.log(`\n${failed} runtime message check(s) failed.`)
}
