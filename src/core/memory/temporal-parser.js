// Temporal hint parser —— 把"今天/昨天/前天/大前天"等相对时间词解析成日期区间。
//
// 设计原则：
// - 纯函数、零外部依赖，可在不连 db / llm 的环境下单测
// - 只识别确定能算出区间的相对词，不命中比误命中好
// - 输出 ISO 字符串带本地时区偏移，与 nowTimestamp() / conversations.timestamp 一致

// 把 Date 格式化成本地时区 ISO 字符串（带 +08:00 这样的偏移），格式同 time.js:nowTimestamp。
function isoLocal(d) {
  const pad = n => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  const offsetStr = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetStr}`
}

// 取某天的 00:00:00（本地时区）
function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

// v1 词表：只收"确定能算出日期"的高频词。
// 模糊词（最近 / 这阵子 / 之前）不收。
// "明天/后天/将来"也不收 —— 我们只回忆过去，未来没有记忆可注入。
const PATTERNS = [
  { match: ['今天', '今早', '今晨', '今夜', '今晚', '今儿', '今日'], label: '今天',   offsetDays: 0 },
  { match: ['昨天', '昨晚', '昨夜', '昨儿', '昨日'],                  label: '昨天',   offsetDays: -1 },
  { match: ['前天'],                                                  label: '前天',   offsetDays: -2 },
  { match: ['大前天'],                                                label: '大前天', offsetDays: -3 },
]

/**
 * 解析消息中的相对时间词，返回区间数组。
 *
 * @param {string} text  - 消息正文
 * @param {Date}   [now] - 参考"现在"，默认 new Date()，方便单测注入固定时钟
 * @returns {Array<{label: string, from: string, to: string, offsetDays: number}>}
 *   - label 是命中的标签词（如 '昨天'）
 *   - from / to 是 ISO 本地时区字符串：[from, to) 半开区间
 *   - offsetDays 相对今天的天数（0=今天，-1=昨天）
 *   - 多个命中按 offsetDays 从大到小排（最近的先）
 *   - 同一个标签词只命中一次（多次出现合并）
 *   - "大前天"优先匹配，避免被"前天"截断
 */
export function parseTemporalHints(text, now = new Date()) {
  if (!text || typeof text !== 'string') return []
  const today = startOfDay(now)
  const hits = []

  // 最长匹配 + 消耗扫描：长词（大前天）先扫；命中后把该模式所有同义词
  // 都从 scratch 里清掉，避免短词（前天）从长词残骸里再误匹配。
  // 这样"前天和大前天的事"会被正确识别为两个独立命中。
  const sortedPatterns = [...PATTERNS].sort((a, b) => {
    const maxA = Math.max(...a.match.map(w => w.length))
    const maxB = Math.max(...b.match.map(w => w.length))
    return maxB - maxA
  })

  let scratch = text
  for (const p of sortedPatterns) {
    if (!p.match.some(w => scratch.includes(w))) continue
    for (const w of p.match) scratch = scratch.split(w).join(' ')
    const from = new Date(today)
    from.setDate(from.getDate() + p.offsetDays)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    hits.push({
      label: p.label,
      from: isoLocal(from),
      to: isoLocal(to),
      offsetDays: p.offsetDays,
    })
  }

  // 输出按 offsetDays desc 排（今天 0 > 昨天 -1 > 前天 -2 > 大前天 -3）
  hits.sort((a, b) => b.offsetDays - a.offsetDays)
  return hits
}

// 收集所有需要从原文里剥离的"时间标签词"
// （包括同义词，因为 parseTemporalHints 已经把它们都归一为同一个 label）
const ALL_TEMPORAL_WORDS = PATTERNS.flatMap(p => p.match)
  // 长词在前，避免短词把长词截断（如先剥"前天"会留下"大"，再剥"大前天"就失败了）
  .sort((a, b) => b.length - a.length)

/**
 * 从原文里剥离已被 parseTemporalHints 解析的时间词，让后续 extractKeywords
 * 不会切出含"昨天"的 ngram（如"昨天我"），从而污染 FTS5 召回。
 *
 * 例：stripTemporalWords('昨天我们聊了什么') → ' 我们聊了什么'
 */
export function stripTemporalWords(text) {
  if (!text || typeof text !== 'string') return text || ''
  let out = text
  for (const w of ALL_TEMPORAL_WORDS) {
    out = out.split(w).join(' ')
  }
  return out
}

// 暴露给测试使用
export const __test__ = { isoLocal, startOfDay, PATTERNS, ALL_TEMPORAL_WORDS }
