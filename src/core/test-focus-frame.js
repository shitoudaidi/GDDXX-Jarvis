// Focus Stack 多帧栈 + 压缩回填准备函数的纯算法测试。
// 不动数据库、不动 LLM、不动网络。
//
// focus.js 直接从 keywords.js 拿 extractKeywords（绕开 injector.js 与 SQLite），
// 所以这里可以裸 import，不需要 ESM resolve hook 来桥 focus 本身。
//
// buildContextBlock 来自 prompt.js，prompt.js 依赖 agents/registry.js（间接接 DB），
// 因此在测试 prompt 集成时仍需上 test-prompt-split-loader 同款 stub hook。
//
// 第 5b 步后 updateFocusFrame 变 async；本测试所有调用统一禁用 classifier（classifierEnabled:false），
// 让 v0 启发式路径单独跑通，不依赖 LLM。
//
// Run: node src/test-focus-frame.js
import { register } from 'node:module'
register('./test-prompt-split-loader.mjs', import.meta.url)

import {
  updateFocusFrame as _updateFocusFrame,
  FOCUS_FRAME_STALE_TICKS,
  MAX_FOCUS_DEPTH,
  describeFocusFrameAge,
  getFocusFrame,
} from './memory/focus.js'
import { extractKeywords } from './memory/keywords.js'
import { buildCompressionInput, __internal as compressInternal } from './memory/focus-compress.js'

// 测试 helper：永远禁用 v1 仲裁，跑纯 v0 启发式路径。
function updateFocusFrame(state, message, opts = {}) {
  return _updateFocusFrame(state, message, { ...opts, classifierEnabled: false })
}

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

function makeState() {
  return { focusStack: [], tickCounter: 0 }
}

function top(state) {
  return state.focusStack[state.focusStack.length - 1] || null
}

// 直接构造一个帧（白盒测试用，绕开 token 切分的偶然性）
function makeFrame(topic, { startedAtTick = 1, lastSeenTick = 1, hitCount = 1 } = {}) {
  return {
    topic,
    startedAtTick,
    lastSeenTick,
    hitCount,
    startedAt: new Date().toISOString(),
    conclusions: [],
  }
}

// ========== Round 1-5 主线场景（基线行为，3a 步保留下来）==========
{
  const state = makeState()

  // round 1: created
  state.tickCounter = 1
  const r1 = await updateFocusFrame(state, '我想学一下 prompt caching 的原理', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r1.event === 'created', `round1 event=${r1.event} (expect created)`)
  assert(state.focusStack.length === 1, `round1 stack depth=${state.focusStack.length} (expect 1)`)
  assert(top(state).hitCount === 1, `round1 hitCount=${top(state).hitCount}`)
  assert(top(state).startedAtTick === 1, `round1 startedAtTick=${top(state).startedAtTick}`)
  assert(typeof top(state).startedAt === 'string' && top(state).startedAt.includes('T'),
    'round1 frame has ISO startedAt')
  assert(Array.isArray(top(state).conclusions) && top(state).conclusions.length === 0,
    'round1 frame has empty conclusions list')

  // round 2: kept or switched (heuristic-dependent)
  state.tickCounter = 2
  const r2 = await updateFocusFrame(state, '再说说 prompt 的 prefix cache 怎么命中', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r2.event === 'kept' || r2.event === 'pushed', `round2 event=${r2.event} (kept or pushed)`)
  assert(r2.poppedFrames.length === 0, 'round2 has no popped frames')

  // round 3: 天气 → 完全无交集 → pushed
  state.tickCounter = 3
  const r3 = await updateFocusFrame(state, '今天广州的天气怎么样啊', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r3.event === 'pushed', `round3 event=${r3.event} (expect pushed)`)
  assert(r3.poppedFrames.length === 0, 'round3 push within depth limit → no pops')
  assert(state.focusStack.length >= 2, `round3 stack depth=${state.focusStack.length} (expect >=2)`)

  // round 4: TICK → 不动
  state.tickCounter = 4
  const stackBefore = JSON.stringify(state.focusStack.map(f => f.topic))
  const r4 = await updateFocusFrame(state, 'TICK 2026-05-19-10:30:00', {
    isTick: true,
    tickCounter: state.tickCounter,
  })
  assert(r4.event === 'noop' || r4.event === 'cleared', `round4 TICK event=${r4.event}`)
  const stackAfter = JSON.stringify(state.focusStack.map(f => f.topic))
  assert(stackBefore === stackAfter, 'round4 TICK does not change stack topics')
}

// ========== 白盒 kept：栈顶 topic 与新关键词有交集 ==========
{
  const state = makeState()
  state.focusStack = [makeFrame(['caching', 'prompt', 'prefix'])]
  state.tickCounter = 2
  const r = await updateFocusFrame(state, '再说一下 prompt 的工作机制吧', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  const kws = extractKeywords('再说一下 prompt 的工作机制吧', 8)
  assert(kws.includes('prompt'), `K contains 'prompt' (got ${JSON.stringify(kws)})`)
  assert(r.event === 'kept', `kept-path event=${r.event} (expect kept)`)
  assert(r.poppedFrames.length === 0, 'kept-path no pops')
  assert(state.focusStack.length === 1, 'kept-path stack depth stays at 1')
  assert(top(state).hitCount === 2, `kept-path hitCount=${top(state).hitCount}`)
  assert(top(state).lastSeenTick === 2, `kept-path lastSeenTick=${top(state).lastSeenTick}`)
  assert(top(state).startedAtTick === 1, 'kept-path startedAtTick unchanged')
}

// ========== 白盒 returned：栈深 2，新关键词命中栈底，pop 栈顶 ==========
{
  const state = makeState()
  state.focusStack = [
    makeFrame(['design', 'prompt', 'caching']),  // 主线
    makeFrame(['weather', 'guangzhou', 'today']),  // 子主题
  ]
  state.tickCounter = 5
  const r = await updateFocusFrame(state, '继续说 prompt 那个 caching design', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r.event === 'returned', `returned-path event=${r.event} (expect returned)`)
  assert(r.poppedFrames.length === 1, `returned-path popped 1 frame (got ${r.poppedFrames.length})`)
  assert(r.poppedFrames[0].topic.includes('weather'), 'returned-path popped the weather frame')
  assert(state.focusStack.length === 1, `returned-path stack depth=${state.focusStack.length}`)
  assert(top(state).topic.includes('prompt'), 'returned-path top is now the prompt frame')
  assert(top(state).lastSeenTick === 5, 'returned-path top lastSeenTick updated')
}

// ========== 三层栈 returned：A → B → C，回到 A，pop B、C ==========
{
  const state = makeState()
  state.focusStack = [
    makeFrame(['alpha', 'mainline', 'project']),
    makeFrame(['beta', 'detour']),
    makeFrame(['gamma', 'sidequest']),
  ]
  state.tickCounter = 10
  const r = await updateFocusFrame(state, '回到 alpha mainline project 那个事', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r.event === 'returned', `three-layer returned event=${r.event}`)
  assert(r.poppedFrames.length === 2, `three-layer popped 2 frames (got ${r.poppedFrames.length})`)
  // popped 顺序：splice 出去的数组按原栈顺序 → [B, C]，栈底先出栈顶后出
  const poppedTopics = r.poppedFrames.map(f => f.topic.join(','))
  assert(poppedTopics[0].includes('beta'), `first popped is beta-detour (got ${poppedTopics[0]})`)
  assert(poppedTopics[1].includes('gamma'), `second popped is gamma-sidequest (got ${poppedTopics[1]})`)
  assert(state.focusStack.length === 1, 'three-layer stack collapses to 1')
  assert(top(state).topic.includes('alpha'), 'three-layer top is alpha')
}

// ========== pushed：与栈中所有帧都无交集 → push 新帧 ==========
{
  const state = makeState()
  state.focusStack = [makeFrame(['prompt', 'caching'])]
  state.tickCounter = 5
  const r = await updateFocusFrame(state, '广州今天天气怎么样啊预报呢', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r.event === 'pushed', `pushed-path event=${r.event}`)
  assert(state.focusStack.length === 2, `pushed-path stack depth=${state.focusStack.length}`)
  assert(r.poppedFrames.length === 0, 'pushed within depth → no pops')
}

// ========== 栈深超限：MAX_FOCUS_DEPTH+1 帧时 shift 栈底 ==========
{
  const state = makeState()
  // 先手工塞满到 MAX_FOCUS_DEPTH
  state.focusStack = []
  for (let i = 0; i < MAX_FOCUS_DEPTH; i++) {
    state.focusStack.push(makeFrame([`topic${i}a`, `topic${i}b`, `topic${i}c`]))
  }
  state.tickCounter = MAX_FOCUS_DEPTH + 1
  // 一条与所有现有 topic 都不相交的消息 → 强 push → 栈深超限 → shift 栈底
  const r = await updateFocusFrame(state, '完全无关的新主题 freshunique keywords', {
    isTick: false,
    tickCounter: state.tickCounter,
  })
  assert(r.event === 'pushed', `overflow event=${r.event}`)
  assert(state.focusStack.length === MAX_FOCUS_DEPTH,
    `overflow stack capped at MAX_FOCUS_DEPTH=${MAX_FOCUS_DEPTH} (got ${state.focusStack.length})`)
  assert(r.poppedFrames.length === 1, `overflow popped 1 (bottom) frame (got ${r.poppedFrames.length})`)
  assert(r.poppedFrames[0].topic.includes('topic0a'), 'overflow popped the bottom-most frame')
}

// ========== Stale 清理：TICK 把 idle 太久的栈顶 pop 进 poppedFrames ==========
{
  const state = makeState()
  const staleFrame = makeFrame(['老', '帧', '残留'], { startedAtTick: 1, lastSeenTick: 5, hitCount: 3 })
  state.focusStack = [staleFrame]
  state.tickCounter = 5 + FOCUS_FRAME_STALE_TICKS + 1
  const r = await updateFocusFrame(state, 'TICK 2026-05-19-11:00:00', {
    isTick: true,
    tickCounter: state.tickCounter,
  })
  assert(r.event === 'cleared', `stale clear event=${r.event}`)
  assert(state.focusStack.length === 0, 'stale clear empties the stack')
  assert(r.poppedFrames.length === 1, 'stale clear puts old top into poppedFrames')
  assert(r.poppedFrames[0] === staleFrame, 'stale clear preserves the frame object reference for compression')
}

// ========== 太短消息不动 ==========
{
  const state = makeState()
  state.tickCounter = 1
  const r = await updateFocusFrame(state, '好', { isTick: false, tickCounter: 1 })
  assert(r.event === 'noop', `very short msg event=${r.event}`)
  assert(state.focusStack.length === 0, 'very short msg does not create frame')
  assert(r.poppedFrames.length === 0, 'very short msg has no pops')
}

// ========== 关键词太少不动 ==========
{
  const state = makeState()
  state.tickCounter = 1
  const r = await updateFocusFrame(state, '好的好的', { isTick: false, tickCounter: 1 })
  assert(
    (r.event === 'noop' && state.focusStack.length === 0) ||
      (r.event === 'created' && state.focusStack.length === 1),
    `sparse msg outcome consistent (event=${r.event}, depth=${state.focusStack.length})`
  )
}

// ========== describeFocusFrameAge ==========
{
  const just = makeFrame(['a'], { startedAtTick: 5, lastSeenTick: 5, hitCount: 1 })
  assert(
    describeFocusFrameAge(just, 5) === 'just started focusing on this',
    'age desc: just started',
  )
  const ongoing = makeFrame(['a'], { startedAtTick: 1, lastSeenTick: 5, hitCount: 4 })
  assert(
    describeFocusFrameAge(ongoing, 5).includes('last seen this round'),
    'age desc: last seen this round',
  )
  const cooling = makeFrame(['a'], { startedAtTick: 1, lastSeenTick: 5, hitCount: 4 })
  const ad = describeFocusFrameAge(cooling, 8)
  assert(ad.includes('3 rounds ago'), `age desc cooling: ${ad}`)
}

// ========== getFocusFrame 便捷读取栈顶 ==========
{
  const state = makeState()
  assert(getFocusFrame(state) === null, 'getFocusFrame empty stack → null')
  const f = makeFrame(['x', 'y', 'z'])
  state.focusStack.push(f)
  assert(getFocusFrame(state) === f, 'getFocusFrame returns top frame')
}

// ========== buildContextBlock 集成：focusStack 渲染 <focus> + <focus-history> ==========
{
  const { buildContextBlock } = await import('./prompt.js')

  // 单帧 → 只有 <focus>
  const ctx1 = buildContextBlock({
    focusStack: [makeFrame(['prompt', 'cache'], { startedAtTick: 1, lastSeenTick: 3, hitCount: 3 })],
    focusTickCounter: 3,
  })
  assert(ctx1.includes('<focus '), 'single-frame stack: <focus> emitted')
  assert(ctx1.includes('topic="prompt, cache"'), 'single-frame stack: topic attr set')
  assert(!ctx1.includes('<focus-history>'), 'single-frame stack: no <focus-history>')

  // 空栈 → 没有 <focus>
  const ctxEmpty = buildContextBlock({ focusStack: [] })
  assert(!ctxEmpty.includes('<focus'), 'empty stack: no <focus>')

  // 两帧栈 → <focus> + <focus-history>
  // 历史帧有结论时：以结论为主，不再把不可靠的 n-gram topic 当标题展示，
  // 也不再用「unfinished / walked away」这种暗示「回去续上」的措辞。
  const ctx2 = buildContextBlock({
    focusStack: [
      { ...makeFrame(['mainline', 'goal']), conclusions: ['Decided to keep design A'] },
      makeFrame(['subtopic', 'detail']),
    ],
    focusTickCounter: 5,
  })
  assert(ctx2.includes('<focus '), 'two-frame stack: <focus> emitted for top')
  assert(ctx2.includes('topic="subtopic, detail"'), 'two-frame stack: <focus> shows TOP topic')
  assert(ctx2.includes('<focus-history>'), 'two-frame stack: <focus-history> emitted')
  assert(ctx2.includes('Decided to keep design A'), 'two-frame stack: history shows last conclusion')
  assert(!ctx2.includes('mainline, goal'), 'two-frame stack: conclusion frames do NOT show raw n-gram topic as a title')
  assert(!/walked away|unfinished background/.test(ctx2), 'two-frame stack: no "walked away / unfinished" framing')
  assert(ctx2.includes('NOT tasks to resume'), 'two-frame stack: framed as background context, not a todo')

  // 历史帧无结论时：退回展示关键词，并明确标注「还没成形」。
  const ctxNoConcl = buildContextBlock({
    focusStack: [
      makeFrame(['half', 'baked', 'idea']),
      makeFrame(['active', 'top']),
    ],
    focusTickCounter: 5,
  })
  assert(ctxNoConcl.includes('still forming'), 'no-conclusion history: marked as still forming')
  assert(ctxNoConcl.includes('half / baked / idea'), 'no-conclusion history: shows keywords fallback')

  // 完全相同的历史结论去重，避免复读同一情绪（同一对话被切成多帧时的近重复）。
  const ctxDup = buildContextBlock({
    focusStack: [
      { ...makeFrame(['a', 'b']), conclusions: ['同一个结论'] },
      { ...makeFrame(['c', 'd']), conclusions: ['同一个结论'] },
      makeFrame(['active', 'top']),
    ],
    focusTickCounter: 5,
  })
  assert((ctxDup.match(/同一个结论/g) || []).length === 1, 'duplicate history conclusions are deduped')

  // 栈顶有 conclusions → 出现在 <focus> 段末尾
  const topWithConclusions = makeFrame(['top', 'with', 'sub'])
  topWithConclusions.conclusions = ['Wrapped up sub-search on X']
  const ctx3 = buildContextBlock({
    focusStack: [topWithConclusions],
    focusTickCounter: 1,
  })
  const focusBlock = ctx3.match(/<focus [^>]*>([\s\S]*?)<\/focus>/)
  assert(!!focusBlock, '<focus> block extracted')
  assert(focusBlock[1].includes('Wrapped up sub-search on X'),
    '<focus> body includes top frame conclusions')

  // 向后兼容：只传 focusFrame，不传 focusStack
  const ctx4 = buildContextBlock({
    focusFrame: makeFrame(['legacy', 'compat'], { startedAtTick: 1, lastSeenTick: 1, hitCount: 1 }),
    focusTickCounter: 1,
  })
  assert(ctx4.includes('<focus '), 'legacy focusFrame still works')
  assert(ctx4.includes('topic="legacy, compat"'), 'legacy focusFrame topic attr correct')

  // 集成位置：<focus> 仍在 <task> 之后、<task-knowledge> 之前
  const ctxOrder = buildContextBlock({
    hasActiveTask: true,
    task: 'do thing',
    taskKnowledge: 'some artifact',
    focusStack: [makeFrame(['x', 'y', 'z'])],
    focusTickCounter: 1,
  })
  const idxTask = ctxOrder.indexOf('<task active="true">')
  const idxFocus = ctxOrder.indexOf('<focus ')
  const idxKnowledge = ctxOrder.indexOf('<task-knowledge>')
  assert(idxTask >= 0 && idxFocus > idxTask && idxKnowledge > idxFocus,
    `section order: task(${idxTask}) < focus(${idxFocus}) < task-knowledge(${idxKnowledge})`)
}

// ========== focus-compress pure-data helpers ==========
{
  // cleanConclusion: strip <think> blocks, trim, strip wrapping quotes
  const { cleanConclusion, estimateLookbackHours, filterSince } = compressInternal
  assert(cleanConclusion('  hello world  ') === 'hello world', 'cleanConclusion trims whitespace')
  assert(
    cleanConclusion('<think>internal\nstuff</think>\n\nfinal answer') === 'final answer',
    'cleanConclusion strips <think> block',
  )
  assert(cleanConclusion('"wrapped in quotes"') === 'wrapped in quotes',
    'cleanConclusion strips wrapping quotes')
  assert(cleanConclusion('') === '', 'cleanConclusion empty → empty')

  // estimateLookbackHours
  const hourAgo = new Date(Date.now() - 3600000).toISOString()
  const h = estimateLookbackHours(hourAgo)
  assert(h >= 1 && h <= 3, `estimateLookbackHours(1h ago) ≈ 1-2 (got ${h})`)
  assert(estimateLookbackHours(null) === 24, 'estimateLookbackHours(null) caps at 24')
  const longAgo = new Date(Date.now() - 100 * 3600000).toISOString()
  assert(estimateLookbackHours(longAgo) === 24, 'estimateLookbackHours caps at 24 for old frames')

  // filterSince
  const since = new Date(Date.now() - 3600000).toISOString()
  const rows = [
    { timestamp: new Date(Date.now() - 7200000).toISOString(), content: 'too old' },
    { timestamp: new Date(Date.now() - 1800000).toISOString(), content: 'recent' },
    { timestamp: new Date().toISOString(), content: 'now' },
  ]
  const filtered = filterSince(rows, since)
  assert(filtered.length === 2, `filterSince keeps rows >= since (got ${filtered.length})`)
  assert(filtered.every(r => r.content !== 'too old'), 'filterSince drops too-old rows')

  // buildCompressionInput: shape & truncation
  const popped = makeFrame(['prompt', 'caching'])
  popped.startedAt = '2026-05-19T10:00:00.000Z'
  const input = buildCompressionInput(popped, {
    conversations: [
      { from_id: 'ID:000001', to_id: 'jarvis', timestamp: '2026-05-19T10:05:00Z', content: 'how does prefix cache work' },
      { from_id: 'jarvis', to_id: 'ID:000001', timestamp: '2026-05-19T10:06:00Z', content: 'cache hits when prefix matches token-for-token' },
    ],
    actionLogs: [
      { timestamp: '2026-05-19T10:07:00Z', tool: 'fetch_url', summary: 'fetched anthropic docs', status: 'ok' },
    ],
  })
  assert(input.includes('prompt, caching'), 'buildCompressionInput includes topic')
  assert(input.includes('how does prefix cache work'), 'buildCompressionInput includes conversation content')
  assert(input.includes('ID:000001 -> You'), 'buildCompressionInput labels messages to Jarvis as addressed to You')
  assert(input.includes('You -> ID:000001'), 'buildCompressionInput labels Jarvis messages as from You')
  assert(!input.includes('jarvis ->'), 'buildCompressionInput does not expose raw jarvis sender label')
  assert(input.includes('[Conversation during this focus: last 30 rounds]'), 'buildCompressionInput declares 30-round focus history')
  assert(input.includes('fetch_url'), 'buildCompressionInput includes tool name')

  const longHistory = Array.from({ length: 70 }, (_, i) => ({
    from_id: i % 2 === 0 ? 'ID:000001' : 'jarvis',
    to_id: i % 2 === 0 ? 'jarvis' : 'ID:000001',
    timestamp: `2026-05-19T10:${String(i).padStart(2, '0')}:00Z`,
    content: `history-${String(i).padStart(2, '0')}`,
  }))
  const longInput = buildCompressionInput(popped, { conversations: longHistory })
  assert(!longInput.includes('history-09'), 'buildCompressionInput drops rows older than the latest 30 rounds')
  assert(longInput.includes('history-10'), 'buildCompressionInput keeps the first row inside the latest 30 rounds')
  assert(longInput.includes('history-69'), 'buildCompressionInput keeps the newest row inside the latest 30 rounds')
  assert((longInput.match(/history-\d\d/g) || []).length === 60,
    'buildCompressionInput keeps exactly 60 messages for 30 conversation rounds')

  // empty case
  const emptyInput = buildCompressionInput(popped, { conversations: [], actionLogs: [] })
  assert(emptyInput.includes('prompt, caching'), 'buildCompressionInput still shows topic with no data')
  assert(!emptyInput.includes('[Conversation during this focus]'),
    'buildCompressionInput omits conversation header when empty')
}

if (failed === 0) {
  console.log('\nAll focus-stack + focus-compress sanity checks complete.')
} else {
  console.log(`\n${failed} check(s) failed.`)
}
