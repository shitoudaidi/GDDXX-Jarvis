// 关键词抽取：纯函数，零外部依赖（不碰 DB、不碰网络）。
// 同时被 memory/injector.js（用于召回检索）和 memory/focus.js（用于焦点判断）使用。
//
// 第 3a 步从 injector.js 抽出来，让 focus.js 不必拉起 SQLite 原生绑定即可被
// 在纯 Node 环境下单元测试。

// 停用词：高频但无信息量的词。
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那', '有', '没有',
  '和', '与', '把', '被', '因为', '所以', '如果', '一个', '一些', '什么', '怎么', '为什么',
  '帮我', '请', '好的', '明白', '告诉', '让', '做', '去', '来', '把', '说', '给',
  // 相对时间词：由 memory/temporal-parser.js 解析成日期窗口并独立注入 <temporal-recall>。
  // 这里加 STOP_WORDS 是为了让"昨天"不再作为字面搜索词污染 FTS5 召回——
  // 历史上搜"昨天"召回的是 content 里含"昨天"二字的旧记忆，跟用户真正的"昨天"无关。
  '今天', '昨天', '前天', '大前天', '今早', '今晨', '今夜', '今晚', '昨晚', '昨夜', '昨日', '今日',
])

// n-gram 内含这些字符时跨越了词边界，不是完整词，过滤掉。
// 选字标准：单字成词时几乎不携带主题信息，且常出现在词与词的接合处。
const STOP_CHARS = new Set([
  '的', '了',
  '着', '过', '起', '来', '去',
  '吗', '呢', '吧', '啊', '呀', '嘛', '哦',
  '和', '与', '跟', '或', '及', '并',
  '很', '太', '再', '又', '也', '都', '还', '只', '就', '才',
])

// 首字禁止：量词单字不应作为 n-gram 的起点（否则切出"个项目"之类的伪词）
const STOP_HEAD_CHARS = new Set(['们', '个', '些', '点', '次', '件', '种', '样'])

// 末字禁止：指代词/时间前缀字不应作为 n-gram 的结尾（否则切出"成今/项目这"之类的伪词）
const STOP_TAIL_CHARS = new Set(['一', '几', '某', '每', '这', '那', '今'])

// n-gram 内重复字：除"天天/常常"这类合法叠词（整段就是两字叠词）外都丢弃。
function hasInvalidDuplicate(word) {
  if (word.length === 2) return false
  const seen = new Set()
  for (const ch of word) {
    if (seen.has(ch)) return true
    seen.add(ch)
  }
  return false
}

function isValidNgram(word) {
  if (!word || word.length < 2 || STOP_WORDS.has(word)) return false
  for (const ch of word) {
    if (STOP_CHARS.has(ch)) return false
  }
  if (STOP_HEAD_CHARS.has(word[0])) return false
  if (STOP_TAIL_CHARS.has(word[word.length - 1])) return false
  if (hasInvalidDuplicate(word)) return false
  return true
}

// 长度权重：短词在召回里命中率更高，给点排序加成；长 ngram 容易是跨词伪词，打折。
function lengthWeight(len) {
  if (len === 2) return 1.5
  if (len === 4) return 0.8
  return 1
}

function extractCore(text) {
  if (!text) return { freq: new Map(), rawNgrams: [] }
  const cleaned = text
    .replace(/[，。！？、；：”””’’’【】[\]()（）\d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const freq = new Map()
  const rawNgrams = []
  const bumpChinese = (word) => {
    if (!word) return
    rawNgrams.push(word)
    if (!isValidNgram(word)) return
    freq.set(word, (freq.get(word) || 0) + 1)
  }
  const bumpEnglish = (word) => {
    if (!word || word.length < 2 || STOP_WORDS.has(word)) return
    freq.set(word, (freq.get(word) || 0) + 1)
  }

  const chinese = cleaned.replace(/[a-zA-Z]+/g, ' ')
  for (let i = 0; i < chinese.length - 1; i++) {
    for (let len = 2; len <= 4 && i + len <= chinese.length; len++) {
      bumpChinese(chinese.slice(i, i + len).trim())
    }
  }

  const english = text.match(/[a-zA-Z]{3,}/g) || []
  for (const word of english) {
    const normalized = word.toLowerCase()
    if (!STOP_WORDS.has(normalized)) bumpEnglish(word)
  }

  return { freq, rawNgrams }
}

export function extractKeywords(text, maxKeywords = 8) {
  const { freq } = extractCore(text)
  // 按 (freq × lengthWeight, length) desc 排序；不做子串去重。
  //
  // 历史上这里曾用 "较短词若被更长词覆盖则跳过" 的子串去重逻辑，
  // 但这反了：在 FTS5/LIKE 字面召回里，较短词（"业余"）比较长 ngram（"业余写什"）
  // 更可能命中真实记忆内容。子串去重把最有用的短关键词砍掉了。
  return [...freq.entries()]
    .map(([word, f]) => [word, f * lengthWeight(word.length), f])
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .slice(0, maxKeywords)
    .map(([word]) => word)
}

// 调试辅助：返回每个阶段的 ngram 集合，便于单测断言"伪词被丢掉了"。
export function __extractKeywordsDebug(text, maxKeywords = 8) {
  const { freq, rawNgrams } = extractCore(text)
  const filtered = [...freq.keys()]
  const final = extractKeywords(text, maxKeywords)
  return { raw: rawNgrams, filtered, final }
}
