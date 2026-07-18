// section-gate.js 的纯算法测试：统一相关度门的打分 + 门控行为。
// 不动数据库、不动 LLM、不动网络——section-gate 只依赖纯函数 extractKeywords。
//
// Run: node src/test-section-gate.js
import { selectContextSections, scoreSection } from './context/section-gate.js'
import { extractKeywords } from './memory/keywords.js'

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

function auditFor(result, section) {
  return result.audit.find(a => a.section === section)
}

// —— scoreSection 基础行为 ——
{
  const ref = extractKeywords('北京今天的天气怎么样', 12)
  const hit = scoreSection('北京天气：晴，气温 25 度', ref)
  const miss = scoreSection('这是一段和实体清单完全无关的文字', ref)
  assert(hit && hit.hits >= 1, 'scoreSection: 相关文本命中 >= 1')
  assert(miss && miss.hits === 0, 'scoreSection: 无关文本命中 = 0')
  assert(scoreSection('', ref) === null, 'scoreSection: 空文本返回 null')
  assert(scoreSection('任意文本', []) === null, 'scoreSection: 无参照系返回 null')
}

// —— known-others（enforce=true）：消息不提任何实体时被真剔除 ——
{
  const args = {
    entities: [{ id: '张三', label: '同事' }, { id: '李四', label: '朋友' }],
    extraContext: '',
  }
  const result = selectContextSections(args, { referenceFrame: '帮我写一段快速排序的代码' })
  const ko = auditFor(result, 'known-others')
  assert(ko && ko.hits === 0, 'known-others: 与代码话题零重叠')
  assert(ko && ko.dropped === true, 'known-others: enforce 生效，被剔除')
  assert(Array.isArray(result.args.entities) && result.args.entities.length === 0,
    'known-others: 剔除后 entities 被置空，buildContextBlock 会跳过该段')
}

// —— known-others：消息提到了实体时保留 ——
{
  const args = { entities: [{ id: '张三', label: '同事' }] }
  const result = selectContextSections(args, { referenceFrame: '张三今天找我了吗' })
  const ko = auditFor(result, 'known-others')
  assert(ko && ko.hits >= 1, 'known-others: 提到张三 → 命中 >= 1')
  assert(ko && ko.dropped === false, 'known-others: 命中则保留')
  assert(result.args.entities.length === 1, 'known-others: 保留时 entities 不变')
}

// —— measure-only 段（extra/self-snapshot/...）：零重叠也算分但绝不剔除 ——
{
  const args = {
    extraContext: '当前热点：某地发生地震，相关讨论激增',
    selfSnapshot: { snapshotText: '你刚才在用简洁直接的语气，多用列表' },
    entities: [],
  }
  const result = selectContextSections(args, { referenceFrame: '解释一下快速傅里叶变换' })
  const extra = auditFor(result, 'extra')
  const snap = auditFor(result, 'self-snapshot')
  assert(extra && extra.enforce === false, 'extra: 标记为 measure-only')
  assert(extra && extra.hits === 0 && extra.dropped === false, 'extra: 零重叠但 measure-only 不剔除')
  assert(result.args.extraContext === args.extraContext, 'extra: 内容原样保留')
  assert(snap && snap.dropped === false && result.args.selfSnapshot === args.selfSnapshot,
    'self-snapshot: measure-only 不剔除')
}

// —— 参照系信号不足（极短消息）→ 整轮跳过门控，保留全部（连续感红线） ——
{
  const args = { entities: [{ id: '张三', label: '同事' }] }
  const result = selectContextSections(args, { referenceFrame: '现在呢？' })
  assert(result.meta.enoughSignal === false, '短消息: 参照系关键词不足')
  assert(result.meta.gated === false, '短消息: 整轮不门控')
  const ko = auditFor(result, 'known-others')
  assert(ko && ko.hits === null && ko.dropped === false, '短消息: 不打分、不剔除')
  assert(result.args.entities.length === 1, '短消息: known-others 原样保留')
}

// —— 总开关 enabled=false → 直接透传 ——
{
  const args = { entities: [{ id: '王五', label: '客户' }] }
  const result = selectContextSections(args, { referenceFrame: '写一段排序代码', enabled: false })
  assert(result.meta.gated === false, 'enabled=false: 不门控')
  assert(result.args.entities.length === 1, 'enabled=false: 原样透传')
}

// —— 埋点完整性：每个有内容的可门控段都进 audit ——
{
  const args = {
    entities: [{ id: '赵六', label: '' }],
    extraContext: '一些上下文',
    taskKnowledge: '已构建的产物',
    memories: '一些记忆',
  }
  const result = selectContextSections(args, { referenceFrame: '聊聊产品方向和记忆机制' })
  const sections = result.audit.map(a => a.section).sort()
  assert(sections.includes('known-others') && sections.includes('extra')
    && sections.includes('task-knowledge') && sections.includes('memories'),
    '埋点: 所有有内容的可门控段都进 audit')
  for (const a of result.audit) {
    assert(typeof a.bytes === 'number' && 'score' in a && 'enforce' in a && 'dropped' in a,
      `埋点字段完整: ${a.section}`)
  }
}

if (failed === 0) {
  console.log('\nAll section-gate tests passed.')
} else {
  console.error(`\n${failed} test(s) failed.`)
}
