// 停用词表与 injector.js 保持一致
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那', '有', '没有',
  '和', '与', '把', '被', '因为', '所以', '如果', '一个', '一些', '什么', '怎么', '为什么',
  '帮我', '请', '好的', '明白', '告诉', '让', '做', '去', '来', '把', '说', '给',
])

// 与 injector.js extractKeywords 相同逻辑，返回词频 Map（供相关性计算使用）
function extractKeywordSet(text, maxKeywords = 20) {
  if (!text) return new Set()

  const cleaned = text
    .replace(/[，。！？、；："""'''【】[\]()（）\d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const freq = new Map()
  const bump = (word) => {
    if (!word || word.length < 2 || STOP_WORDS.has(word)) return
    freq.set(word, (freq.get(word) || 0) + 1)
  }

  const chinese = cleaned.replace(/[a-zA-Z]+/g, ' ')
  for (let i = 0; i < chinese.length - 1; i++) {
    for (let len = 2; len <= 4 && i + len <= chinese.length; len++) {
      bump(chinese.slice(i, i + len).trim())
    }
  }

  const english = text.match(/[a-zA-Z]{3,}/g) || []
  for (const word of english) {
    const normalized = word.toLowerCase()
    if (!STOP_WORDS.has(normalized)) bump(word)
  }

  return new Set(
    [...freq.entries()]
      .sort((a, b) => (b[0].length - a[0].length) || (b[1] - a[1]))
      .slice(0, maxKeywords)
      .map(([word]) => word)
  )
}

// 相关性过滤：候选概念与原始 query 主题词之间必须有字面关联
// 规则：共享连续2个或以上汉字字符，或英文词为 query 词的子串/超串（忽略大小写）
function isRelatedToQuery(concept, queryKeywords) {
  for (const qw of queryKeywords) {
    // 英文：子串包含关系
    if (/^[a-zA-Z]+$/.test(concept) && /^[a-zA-Z]+$/.test(qw)) {
      const c = concept.toLowerCase()
      const q = qw.toLowerCase()
      if (c.includes(q) || q.includes(c)) return true
      continue
    }
    // 中文或混合：共享长度 >= 2 的子串
    const shorter = concept.length <= qw.length ? concept : qw
    const longer  = concept.length <= qw.length ? qw : concept
    for (let i = 0; i <= shorter.length - 2; i++) {
      const slice = shorter.slice(i, i + 2)
      if (longer.includes(slice)) return true
    }
  }
  return false
}

/**
 * 从 LLM 第1轮思考输出中提取涌现的新概念。
 * 只返回与原始 query 有字面关联、且不在原始 query 关键词集合中的词，最多 6 个。
 *
 * @param {string} thinkingText - LLM 第1轮的思考/回复内容（可能含 <think>...</think>）
 * @param {string} originalQuery - 原始用户消息
 * @returns {string[]} 过滤后的新概念列表，最多 6 个
 */
export function extractEmergentConcepts(thinkingText, originalQuery) {
  if (!thinkingText || !originalQuery) return []

  // 优先使用 <think> 块内容；没有则使用全文
  const thinkMatch = thinkingText.match(/<think>([\s\S]*?)<\/think>/i)
  const sourceText = thinkMatch ? thinkMatch[1] : thinkingText

  const thinkingKeywords = extractKeywordSet(sourceText, 40)
  const queryKeywords    = extractKeywordSet(originalQuery, 20)

  // 排除原始 query 已包含的词（避免重复搜索）
  const emergent = [...thinkingKeywords].filter(kw => !queryKeywords.has(kw))

  // 锚定过滤：只保留与原始 query 主题词有字面关联的词，防止联想漂移
  const anchored = emergent.filter(kw => isRelatedToQuery(kw, queryKeywords))

  return anchored.slice(0, 6)
}
