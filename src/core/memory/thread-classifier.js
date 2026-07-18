// Thread 归属仲裁器 —— 线索模型（DynamicMemoryPool.md 8.5 规则 4/5 的 LLM 兜底）。
//
// 与前任 focus-classifier 的本质区别：它仲裁的不是"栈结构怎么变"（那是不可逆突变），
// 而是"刚新建的线索是不是其实就是某条既有线索"（merge 是可逆心智模型下的安全修正：
// 线索无栈序不变量，合并永远安全；判错的代价是少合一条/多合一条 topic，不是失忆）。
//
// 同款约束：800ms 硬超时、失败一律返回 null 回退 v0、纯函数可 stub 单测、不动 state。

const CLASSIFIER_TIMEOUT_MS = 800
const CLASSIFIER_MAX_TOKENS = 120
const CLASSIFIER_TEMPERATURE = 0.2

const SYSTEM_PROMPT = `Thread classifier. A new conversation thread was just created for the user's message. Decide whether it is actually the SAME ongoing matter as the candidate existing thread.
same: the message continues/resumes the candidate thread's matter (same task, same object, explicit back-reference).
different: a genuinely new matter, even if it shares a domain word with the candidate.
Be conservative: when unsure, answer "different" (a duplicate thread is cheap; a wrong merge pollutes history).
Also produce a short human-readable label (<=12 chars, Chinese) and 2-3 semantic topic words for the NEW message's matter (not n-grams).
Output JSON only.`

function describeThreadBrief(thread) {
  if (!thread) return '(none)'
  const topic = Array.isArray(thread.topic) ? thread.topic.join(', ') : ''
  const conclusion = Array.isArray(thread.conclusions) && thread.conclusions.length > 0
    ? ` (conclusion: ${thread.conclusions[thread.conclusions.length - 1]})`
    : ''
  const summary = thread.summary ? ` (summary: ${String(thread.summary).slice(0, 120)})` : ''
  return `"${thread.label || topic}"${summary || conclusion}`
}

function buildUserPrompt({ newMessage, candidateThread, createdTopic }) {
  const msg = String(newMessage || '').slice(0, 400)
  return [
    `Candidate existing thread = ${describeThreadBrief(candidateThread)}`,
    `New message = "${msg}"`,
    `v0 topic for new thread = [${(createdTopic || []).join(', ')}]`,
    '',
    'Output JSON: {"verdict": "same|different", "label": "...", "topic": ["w1","w2","w3"]}',
  ].join('\n')
}

function parseJson(text) {
  if (!text || typeof text !== 'string') return null
  let body = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) body = fence[1].trim()
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try { return JSON.parse(body.slice(first, last + 1)) } catch { return null }
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const verdict = String(raw.verdict || '').toLowerCase().trim()
  if (!['same', 'different'].includes(verdict)) return null
  const label = String(raw.label || '').trim().slice(0, 24)
  const topic = Array.isArray(raw.topic)
    ? raw.topic.map(t => String(t || '').trim()).filter(t => t.length > 0 && t.length <= 32).slice(0, 3)
    : []
  return { verdict, label, topic }
}

/**
 * 仲裁"新建线索 vs 弱信号候选线索是否同一事"。fire-and-forget 路径专用。
 * @returns {Promise<{verdict:'same'|'different', label:string, topic:string[]} | null>} null = 失败回退 v0
 */
export async function classifyThreadAttribution({ newMessage, candidateThread, createdTopic, signal } = {}) {
  if (!newMessage || typeof newMessage !== 'string') return null
  if (signal?.aborted) return null

  let callLLM
  try {
    callLLM = (await import('../llm.js')).callLLM
  } catch (e) {
    console.log(`[thread-classifier] llm.js import 失败 (${e?.message || 'unknown'}) → 回退 v0`)
    return null
  }
  if (typeof callLLM !== 'function') return null

  const t0 = Date.now()
  let timeoutHandle = null
  const timeoutPromise = new Promise(resolve => {
    timeoutHandle = setTimeout(() => resolve({ __timeout: true }), CLASSIFIER_TIMEOUT_MS)
  })

  let result
  try {
    result = await Promise.race([
      callLLM({
        systemPrompt: SYSTEM_PROMPT,
        message: buildUserPrompt({ newMessage, candidateThread, createdTopic }),
        temperature: CLASSIFIER_TEMPERATURE,
        thinking: false,
        tools: [],
        maxTokens: CLASSIFIER_MAX_TOKENS,
        mustReply: false,
        signal,
      }),
      timeoutPromise,
    ])
  } catch (e) {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    console.log(`[thread-classifier] LLM 抛错 (${Date.now() - t0}ms, ${e?.message || 'unknown'}) → 回退 v0`)
    return null
  }
  if (timeoutHandle) clearTimeout(timeoutHandle)

  if (!result || result.__timeout || result.aborted) {
    console.log(`[thread-classifier] LLM 超时/中止 (${Date.now() - t0}ms) → 回退 v0`)
    return null
  }
  const content = typeof result === 'string' ? result : (result.content || '')
  const normalized = normalize(parseJson(content))
  if (!normalized) {
    console.log(`[thread-classifier] JSON 解析/规范化失败 raw="${String(content).replace(/\s+/g, ' ').slice(0, 160)}" → 回退 v0`)
    return null
  }
  console.log(`[thread-classifier] verdict=${normalized.verdict} label="${normalized.label}" (${Date.now() - t0}ms)`)
  return normalized
}

export const __internal = { buildUserPrompt, parseJson, normalize, describeThreadBrief, SYSTEM_PROMPT }
