// =============================================================================
// section-gate.js —— 上下文 section 的「统一相关度门」（排除导向的精细化管理）
//
// 背景（动态上下文记忆池 / 少即是强）：
//   buildContextBlock 渲染 ~18 个 <section>，但绝大多数 section 用的是
//   「有内容就注入」（presence gate）——而它们的 source 几乎总是非空（runtime
//   永远有时间、self-snapshot 常驻、known-others 永远列全部实体……）。结果是
//   context 块单调累积 → 模型上下文焦虑。
//
//   这个模块把「相关才注入」（relevance gate）从记忆池（selectContextMemories）
//   推广到其余 section：在 buildContextBlock 渲染之前，对每个「可门控」section
//   按当前参照系打相关度分，并对足够安全的 section 执行剔除。
//
// 设计红线（与设计文档一致）：
//   - 参照系不足（关键词 < REF_MIN_KEYWORDS，例如极短消息 "现在呢？" / TICK 心跳）
//     时整轮跳过门控 —— 失败时保留全部，守住连续感红线。
//   - 硬底线 section（runtime / constraints / task / boundary-state / directions /
//     focus / awakening）永不进入这里，由调用方直接透传。
//   - 第一刀只对 known-others 执行真剔除（enforce），其余 section measure-only：
//     算分 + 埋点但不丢。攒到真实分布数据后，再逐段把 enforce 翻成 true。
//   - memories 段归 selectContextMemories（上游）管，这里只 measure 不重复门控。
//
// 短期用「算法路径」（关键词字面重叠）打分，长期演化到「同构路径」——见设计文档 4.2。
// 本模块零 DB / 零网络依赖，只依赖纯函数 extractKeywords，可在纯 Node 下单测。
// =============================================================================

import { extractKeywords } from '../memory/keywords.js'

// 参照系关键词下限：少于这个数 → 信号不足以判断相关性 → 整轮跳过门控（保留全部）。
const REF_MIN_KEYWORDS = 2
// 参照系关键词上限：抽多了反而引入边缘 ngram 噪声，拉低门控精度。
const REF_MAX_KEYWORDS = 12

// 可门控 section 规格表。
//   field   —— baseContextArgs 上的字段名
//   section —— 对应 <section> 标签（埋点/日志用）
//   toText  —— 把字段值拍平成可打分的纯文本（空 → 不计分、不剔除）
//   empty   —— 剔除时写回字段的"空值"，让 buildContextBlock 的 presence gate 跳过该段
//   enforce —— true: 低于地板时真剔除；false: measure-only（算分+埋点但永不丢）
//
// 第一刀只 enforce known-others（纯实体清单，当前消息不提任何实体时剔除，零风险）。
// 其余全部 measure-only，先攒数据。
const GATEABLE = [
  {
    field: 'entities',
    section: 'known-others',
    toText: (v) => Array.isArray(v) ? v.map(e => `${e?.id || ''} ${e?.label || ''}`).join(' ').trim() : '',
    empty: [],
    enforce: true,
  },
  {
    field: 'extraContext',
    section: 'extra',
    toText: (v) => (typeof v === 'string' ? v : ''),
    empty: '',
    enforce: false,
  },
  {
    field: 'taskKnowledge',
    section: 'task-knowledge',
    toText: (v) => (typeof v === 'string' ? v : ''),
    empty: '',
    enforce: false,
  },
  {
    field: 'thoughtStack',
    section: 'thought-stack',
    toText: (v) => Array.isArray(v) ? v.map(t => `${t?.concept || ''} ${t?.line || ''}`).join(' ').trim() : '',
    empty: [],
    enforce: false,
  },
  {
    field: 'selfSnapshot',
    section: 'self-snapshot',
    toText: (v) => v?.snapshotText || '',
    empty: null,
    enforce: false,
  },
  {
    field: 'personMemory',
    section: 'person',
    toText: (v) => v ? `${v.content || ''} ${v.detail || ''}`.trim() : '',
    empty: null,
    enforce: false,
  },
  {
    field: 'userProfile',
    section: 'user-profile',
    toText: (v) => v ? `${v.summary || ''} ${(v.roles || []).map(r => `${r.label || ''} ${(r.evidence || []).join(' ')}`).join(' ')}`.trim() : '',
    empty: null,
    enforce: false,
  },
  {
    field: 'memories',
    section: 'memories',
    toText: (v) => (typeof v === 'string' ? v : ''),
    empty: '',
    enforce: false,
  },
]

// 相关度打分：参照系关键词里有多少个字面出现在 section 文本里。
//   hits  —— 命中个数（绝对量）
//   score —— hits / 参照系关键词总数（0..1，"本段覆盖了本轮多少个概念"）
// 返回 null 表示无法打分（文本空 / 无参照系关键词）。
export function scoreSection(text, refKeywords) {
  if (!text || !Array.isArray(refKeywords) || refKeywords.length === 0) return null
  let hits = 0
  for (const kw of refKeywords) {
    if (kw && text.includes(kw)) hits++
  }
  return { hits, score: hits / refKeywords.length }
}

// 统一相关度门：在 buildContextBlock 之前过一遍 baseContextArgs。
//   args            —— 原始 baseContextArgs
//   referenceFrame  —— 本轮参照系文本（建议 = 当前 user 消息正文 + 焦点 topic）
//   enabled         —— 总开关；false 时直接透传（仅用于灰度/排障）
// 返回 { args, audit, meta }：
//   args  —— 过门后的 baseContextArgs（被剔除的字段已置空），可直接喂 buildContextBlock
//   audit —— 每个可门控 section 的 { section, bytes, hits, score, enforce, dropped }
//   meta  —— { referenceFrame(截断), refKeywords, enoughSignal, gated }
export function selectContextSections(args = {}, { referenceFrame = '', enabled = true } = {}) {
  const refKeywords = enabled ? extractKeywords(referenceFrame || '', REF_MAX_KEYWORDS) : []
  const enoughSignal = refKeywords.length >= REF_MIN_KEYWORDS
  const gated = enabled && enoughSignal

  const out = { ...args }
  const audit = []

  for (const spec of GATEABLE) {
    const text = spec.toText(args[spec.field])
    if (!text) continue   // 空内容由 buildContextBlock 的 presence gate 处理，这里不计分

    const scored = gated ? scoreSection(text, refKeywords) : null
    const dropped = !!(gated && spec.enforce && scored && scored.hits === 0)
    if (dropped) out[spec.field] = spec.empty

    audit.push({
      section: spec.section,
      bytes: text.length,
      hits: scored ? scored.hits : null,
      score: scored ? Number(scored.score.toFixed(3)) : null,
      enforce: spec.enforce,
      dropped,
    })
  }

  return {
    args: out,
    audit,
    meta: {
      referenceFrame: String(referenceFrame || '').slice(0, 120),
      refKeywords,
      enoughSignal,
      gated,
    },
  }
}
