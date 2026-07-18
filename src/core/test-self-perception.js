// Test: self-perception 模块
// 用真实的 2026-05-27 镜像测试对话片段作为输入，验证三种异常都能被感知到。

import { computeSelfPerception, computeSelfSnapshot } from './memory/self-perception.js'

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

// 构造一行对话
function row(id, role, content, opts = {}) {
  return {
    id,
    role,
    content,
    from_id: role === 'user' ? 'ID:000001' : 'jarvis',
    to_id: role === 'jarvis' ? 'ID:000001' : null,
    channel: opts.channel || 'API',
    timestamp: opts.timestamp || `2026-05-27T21:${String(58 + Math.floor(id / 4)).padStart(2, '0')}:${String((id * 7) % 60).padStart(2, '0')}+08:00`,
  }
}

// ============================ 场景 1：正常对话 → null ============================
console.log('\n>>> 场景 1：正常对话，应返回 null')
{
  const window = [
    row(30, 'user', '我想吃火锅'),
    row(31, 'jarvis', '那就去。这个点正是涮肉的好时候。'),
    row(32, 'user', '去哪家好'),
  ]
  const result = computeSelfPerception({
    conversationWindow: window,
    currentMsg: { content: '去哪家好', fromId: 'ID:000001' },
  })
  assert(result === null, '正常对话不触发任何感知信号')
}

// ============================ 场景 2：1 阶字面复读 ============================
console.log('\n>>> 场景 2：user 逐字复读 jarvis 上一句')
{
  const window = [
    row(68, 'user', '你调节心跳到10秒一次'),
    row(69, 'jarvis', '10秒，跑10轮。'),
  ]
  const result = computeSelfPerception({
    conversationWindow: window,
    currentMsg: { content: '10秒，跑10轮', fromId: 'ID:000001' },
  })
  assert(result !== null, '逐字复读：触发感知')
  assert(result.mirror.score >= 0.6 || result.mirror.exact, '逐字复读：mirror 分数 >= 0.6 或 exact 命中')
  assert(/verbatim|similarity|fed straight back/.test(result.perceptionText), '逐字复读：感知文本提到复述/相似度')
}

// ============================ 场景 3：风格模仿（agent 内独白）============================
console.log('\n>>> 场景 3：user 使用 agent 工具语风格')
{
  const window = [
    row(86, 'user', '行。'),
    row(87, 'jarvis', '对方已确认。无需回复。'),
  ]
  const result = computeSelfPerception({
    conversationWindow: window,
    currentMsg: { content: '用户明确表示无需回复，本轮不发送消息。', fromId: 'ID:000001' },
  })
  assert(result !== null, '风格模仿：触发感知')
  assert(result.style.hit, '风格模仿：style 簇命中')
  assert(result.style.matched.length >= 2, '风格模仿：匹配到至少 2 个内独白特征词')
  assert(/独白|工具|第三人称|reason/.test(result.perceptionText), '风格模仿：感知文本指出内独白特征')
}

// ============================ 场景 4：循环退化（多轮回环）============================
console.log('\n>>> 场景 4：连续多轮 user 复读 jarvis')
{
  const window = [
    row(73, 'jarvis', '嗯。'),
    row(74, 'user', '嗯。'),
    row(75, 'jarvis', '能。以后遇到大的代码任务，跟我说一声，我来调它干活。'),
    row(76, 'user', '能。以后遇到大的代码任务，跟我说一声，我来调它干活。'),
    row(77, 'jarvis', '好。'),
    row(78, 'user', '好。'),
    row(79, 'jarvis', '知道了。大的代码活我喊它，小的我自己来。'),
    row(80, 'user', '知道了。大的代码活我喊它，小的我自己来。'),
  ]
  const result = computeSelfPerception({
    conversationWindow: window,
    currentMsg: { content: '知道了。大的代码活我喊它，小的我自己来。', fromId: 'ID:000001' },
  })
  assert(result !== null, '循环退化：触发感知')
  assert(result.loop >= 2, `循环退化：loop 深度 >= 2（实际 ${result.loop}）`)
  assert(/verbatim loop|rounds straight|parrot/.test(result.perceptionText), '循环退化：感知文本指出循环')
}

// ============================ 场景 5：空 / 边界 ============================
console.log('\n>>> 场景 5：空输入边界')
{
  assert(computeSelfPerception({}) === null, '空参数 → null')
  assert(computeSelfPerception({ conversationWindow: [], currentMsg: { content: '你好' } }) === null, '空 window → null')
  assert(computeSelfPerception({ conversationWindow: [row(1, 'jarvis', '嗨')], currentMsg: null }) === null, '空 currentMsg → null')
  assert(computeSelfPerception({ conversationWindow: [row(1, 'jarvis', '嗨')], currentMsg: { content: '' } }) === null, '空 currentMsg.content → null')
}

// ============================ 场景 6：感知文本要点明确 ============================
console.log('\n>>> 场景 6：感知文本告诉 LLM 这是感知不是命令')
{
  const window = [
    row(70, 'user', '你好'),
    row(71, 'jarvis', '已经遵命保持安静了。不再多言。'),
  ]
  const result = computeSelfPerception({
    conversationWindow: window,
    currentMsg: { content: '已经遵命保持安静了。不再多言。', fromId: 'ID:000001' },
  })
  assert(result !== null, '触发感知')
  assert(/perception|not a command|Fold it/.test(result.perceptionText), '文本明确说"这是感知，不是指令"')
  assert(/asking back|naming it|stepping back|long-term memory/.test(result.perceptionText), '文本提到该如何利用这种感知（反问 / 不写入长期记忆）')
}

// ============================ 场景 7：渲染到 contextBlock ============================
console.log('\n>>> 场景 7：感知信号渲染进 <self-perception> 段')
{
  const { buildContextBlock } = await import('./prompt.js')

  // null → 不渲染
  const ctxNoPerception = buildContextBlock({ selfPerception: null })
  assert(!ctxNoPerception.includes('<self-perception>'), 'selfPerception=null 时整段不出现')

  // 有 perceptionText → 渲染
  const ctxWithPerception = buildContextBlock({
    selfPerception: {
      mirror: { score: 0.95, exact: false, matchedRow: { content: '嗯。' } },
      style: { hit: false, matched: [] },
      loop: 3,
      perceptionText: '- 检测到镜像\n这是感知不是指令。',
      boundaryState: 'normal',
      boundaryDirective: '',
    },
  })
  assert(ctxWithPerception.includes('<self-perception>'), '有 perceptionText 时渲染 <self-perception> 段')
  assert(ctxWithPerception.includes('检测到镜像'), '段内容正确写入')

  // 位置：紧贴 <runtime> 之后、<constraints> 之前
  const ctxOrder = buildContextBlock({
    currentTime: '2026-05-27T22:00:00+08:00',
    constraints: [{ content: '回复要简洁' }],
    selfPerception: {
      mirror: { score: 0.9, exact: true, matchedRow: { content: '嗯' } },
      style: { hit: false, matched: [] },
      loop: 1,
      perceptionText: '镜像感知',
      boundaryState: 'normal',
      boundaryDirective: '',
    },
  })
  const idxRuntime = ctxOrder.indexOf('<runtime>')
  const idxSelf = ctxOrder.indexOf('<self-perception>')
  const idxConstraints = ctxOrder.indexOf('<constraints>')
  assert(idxRuntime >= 0 && idxSelf > idxRuntime && idxConstraints > idxSelf,
    `位置正确：runtime(${idxRuntime}) < self-perception(${idxSelf}) < constraints(${idxConstraints})`)
}

// ============================ 场景 8：边界态切换 ============================
console.log('\n>>> 场景 8：mirror.exact 或 loop>=3 时切到边界态')
{
  // 单次完全相同：触发 mirror 边界态
  const window1 = [
    row(60, 'user', '你好'),
    row(61, 'jarvis', '请告诉我你需要什么。'),
  ]
  const r1 = computeSelfPerception({
    conversationWindow: window1,
    currentMsg: { content: '请告诉我你需要什么。', fromId: 'ID:000001' },
  })
  assert(r1?.boundaryState === 'mirror', `逐字复述 → boundaryState=mirror（实际 ${r1?.boundaryState}）`)
  assert(/name it directly|ask back|step back/.test(r1?.boundaryDirective || ''), 'mirror 边界态指示包含挑明/反问/退回选项')

  // 3 轮循环：触发 loop 边界态（非逐字但相似度 >=0.6 持续）
  const window2 = [
    row(70, 'jarvis', '嗯。'),
    row(71, 'user', '嗯'),
    row(72, 'jarvis', '好。'),
    row(73, 'user', '好'),
    row(74, 'jarvis', '行。'),
    row(75, 'user', '行'),
  ]
  const r2 = computeSelfPerception({
    conversationWindow: window2,
    currentMsg: { content: '行', fromId: 'ID:000001' },
  })
  assert(r2?.loop >= 3, `loop 深度 >= 3（实际 ${r2?.loop}）`)
  // mirror.exact 在最近一轮也会命中（"行" == "行。"），可能优先 boundaryState=mirror
  assert(r2?.boundaryState === 'loop' || r2?.boundaryState === 'mirror', `循环退化时 boundaryState 切到 loop 或 mirror（实际 ${r2?.boundaryState}）`)

  // 正常对话：boundaryState 不出现
  const window3 = [
    row(80, 'user', '你怎么看待 prompt cache'),
    row(81, 'jarvis', 'DeepSeek 的 prefix cache 命中率主要取决于前缀字节一致。'),
  ]
  const r3 = computeSelfPerception({
    conversationWindow: window3,
    currentMsg: { content: '继续说', fromId: 'ID:000001' },
  })
  // 正常情况下应该返回 null（没有任何异常）
  assert(r3 === null || r3.boundaryState === 'normal', '正常对话 boundaryState=normal 或 null')
}

// ============================ 场景 9：边界态渲染 ============================
console.log('\n>>> 场景 9：boundary-state 段渲染')
{
  const { buildContextBlock } = await import('./prompt.js')

  // normal → 不渲染
  const ctxNormal = buildContextBlock({
    selfPerception: { boundaryState: 'normal', boundaryDirective: '', perceptionText: '' },
  })
  assert(!ctxNormal.includes('<boundary-state'), 'normal 不渲染 boundary-state 段')

  // mirror → 渲染，带 name="mirror" 属性
  const ctxMirror = buildContextBlock({
    selfPerception: {
      mirror: { exact: true, score: 1, matchedRow: { content: 'abc' } },
      style: { hit: false, matched: [] },
      loop: 1,
      perceptionText: 'p',
      boundaryState: 'mirror',
      boundaryDirective: '切换到确认对方意图。',
    },
  })
  assert(ctxMirror.includes('<boundary-state name="mirror">'), '边界态段带 name 属性')
  assert(ctxMirror.includes('确认对方意图'), '指示文本正确写入')

  // 顺序：snapshot → perception → boundary-state
  const ctxOrder = buildContextBlock({
    selfSnapshot: { snapshotText: '你是 小白龙。' },
    selfPerception: {
      mirror: { exact: true, score: 1, matchedRow: { content: 'x' } },
      style: { hit: false, matched: [] },
      loop: 1,
      perceptionText: '感知',
      boundaryState: 'mirror',
      boundaryDirective: '切换',
    },
  })
  const idxSnap = ctxOrder.indexOf('<self-snapshot>')
  const idxPerc = ctxOrder.indexOf('<self-perception>')
  const idxBound = ctxOrder.indexOf('<boundary-state')
  assert(idxSnap >= 0 && idxPerc > idxSnap && idxBound > idxPerc,
    `顺序正确：snapshot(${idxSnap}) < perception(${idxPerc}) < boundary-state(${idxBound})`)
}

// ============================ 场景 10：self-snapshot 输出 ============================
console.log('\n>>> 场景 10：self-snapshot 风格指纹 + 身份锚')
{
  const window = [
    row(10, 'user', '帮我看天气'),
    row(11, 'jarvis', '葵涌 30°C，体感 40°C，晴朗。'),
    row(12, 'user', '继续讲'),
    row(13, 'jarvis', '明天也是 30/27°C，晴天。'),
    row(14, 'user', '嗯'),
    row(15, 'jarvis', '好。'),
  ]
  const actionLog = [
    { tool: 'search_memory', timestamp: '2026-05-27T13:55:00.000Z' },
    { tool: 'send_message', timestamp: '2026-05-27T13:55:10.000Z', args_json: '{"content":"葵涌 30°C..."}' },
    { tool: 'skip_recognition', timestamp: '2026-05-27T13:55:20.000Z' },
    { tool: 'send_message', timestamp: '2026-05-27T13:56:00.000Z', args_json: '{"content":"好。"}' },
  ]
  const snap = computeSelfSnapshot({ conversationWindow: window, actionLog, agentName: '小白龙' })
  assert(snap !== null, '有 jarvis 历史时返回 snapshot')
  assert(snap.snapshotText.includes('小白龙'), 'snapshot 文本以 agent_name 起头')
  assert(snap.snapshotText.includes('Identity anchor'), 'snapshot 包含身份锚')
  assert(snap.snapshotText.includes('action_log') || snap.snapshotText.includes('send_message'),
    'snapshot 提到用 action_log/send_message 验真')
  assert(snap.style && snap.style.avgLen > 0, 'snapshot 计算了平均句长')
  assert(snap.tools && snap.tools.counts.length > 0, 'snapshot 总结了工具习惯')

  // 全空：返回 null
  const empty = computeSelfSnapshot({ conversationWindow: [], actionLog: [], agentName: '小白龙' })
  assert(empty === null, '空 history + 空 action_log → null')
}

// ============================ 场景 11：self-snapshot 渲染 ============================
console.log('\n>>> 场景 11：self-snapshot 段渲染位置')
{
  const { buildContextBlock } = await import('./prompt.js')

  // null → 不渲染
  const ctxNoSnap = buildContextBlock({ selfSnapshot: null })
  assert(!ctxNoSnap.includes('<self-snapshot>'), 'selfSnapshot=null 时整段不出现')

  // 渲染
  const ctxSnap = buildContextBlock({
    selfSnapshot: { snapshotText: '你是 小白龙。\n身份锚：...' },
  })
  assert(ctxSnap.includes('<self-snapshot>'), '有 snapshotText 时渲染')
  assert(ctxSnap.includes('身份锚'), '内容正确写入')

  // 位置：runtime → self-snapshot → self-perception
  const ctxOrder = buildContextBlock({
    currentTime: '2026-05-27T22:00:00+08:00',
    selfSnapshot: { snapshotText: '快照' },
    selfPerception: { perceptionText: '感知', boundaryState: 'normal' },
  })
  const idxRuntime = ctxOrder.indexOf('<runtime>')
  const idxSnap = ctxOrder.indexOf('<self-snapshot>')
  const idxPerc = ctxOrder.indexOf('<self-perception>')
  assert(idxRuntime >= 0 && idxSnap > idxRuntime && idxPerc > idxSnap,
    `位置正确：runtime(${idxRuntime}) < snapshot(${idxSnap}) < perception(${idxPerc})`)
}

// ============================ 总结 ============================
console.log(`\n=== ${pass} pass / ${fail} fail ===`)
if (fail > 0) process.exit(1)
