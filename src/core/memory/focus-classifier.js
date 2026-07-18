// Focus event 分类器 —— 动态上下文记忆池架构第 5b 步（v1 LLM 语义判断）
//
// 角色：v0 启发式（ngram + 字面交集）跑在前面，本模块只在「栈结构会变化」时被叫起来
// （pushed / returned），用 LLM 仲裁校验 + 重写 topic 关键词。
//
// 设计要点：
//   - 800ms 硬超时（参考 injector.js embedding 兜底），LLM 慢一拍就回退 v0
//   - 失败必须降级 —— 解析失败、超时、abort、配额限流，都返回 null 让上层用 v0
//   - 不依赖 SQLite / 上游状态 / 当前 process —— 纯函数，可单元测试（callLLM 可 stub）
//   - 不修改 state，不发事件，不写 db；返回值由上层 focus.js 应用
//
// 来自 DynamicMemoryPool.md 7.4「对话动作类型」：
//   kept / pushed / returned / leaf 是对话级动作；本模块按这四类输出 action。
//   leaf = 一次性短问，不动栈；映射到 v0 的 noop（不创建新帧也不深化栈顶）。

const CLASSIFIER_TIMEOUT_MS = 800
const CLASSIFIER_MAX_TOKENS = 120
const CLASSIFIER_TEMPERATURE = 0.2

const SYSTEM_PROMPT = `Focus classifier. Be conservative: prefer "kept", do not push lightly.
Overlap: high = same object → kept; medium = same domain, different subtask → pushed; low = different domain → pushed/leaf.
kept: high overlap with the top frame, plus a refinement / follow-up / commitment / confirmation.
pushed: low overlap with ALL frames, plus a new sustained task.
returned: high overlap with a NON-top older frame and an explicit back-reference (depth = that frame's index; top = length-1).
leaf: no continuation, a one-off short question / small talk (does not move the stack).
Example A [frontend React] + "write a Hook" → kept
Example B [DB query] + "how's the network speed now" → leaf
Example C [config → deploy → monitor] + "let's look back at the original config" → returned d=0
For topic, write 2-3 semantic words, not n-grams. Output JSON only.`

// 把当前栈渲染成简短字符串：[栈底"a, b" → "c, d" → 栈顶"e, f"]
function describeStack(stack) {
  if (!Array.isArray(stack) || stack.length === 0) return '[empty stack]'
  const parts = stack.map((f, i) => {
    const topic = Array.isArray(f?.topic) ? f.topic.join(', ') : String(f?.topic || '')
    const conclusions = Array.isArray(f?.conclusions) && f.conclusions.length > 0
      ? `(conclusion: ${f.conclusions[f.conclusions.length - 1]})`
      : ''
    const tag = i === 0 ? 'bottom' : (i === stack.length - 1 ? 'top' : `level ${i}`)
    return `${tag}"${topic}"${conclusions}`
  })
  return '[' + parts.join(' → ') + ']'
}

// 构造用户输入文本
function buildUserPrompt({ newMessage, v0Event, v0Topic, currentStack }) {
  const v0TopicStr = Array.isArray(v0Topic) ? v0Topic.join(', ') : String(v0Topic || '')
  const stackStr = describeStack(currentStack)
  const lengthHint = currentStack?.length ? `stack depth=${currentStack.length}, top index=${currentStack.length - 1}` : 'stack depth=0'
  // newMessage 截断到 400 字，省 token 也减少打架风险
  const msg = String(newMessage || '').slice(0, 400)
  return [
    `v0 verdict = ${v0Event}, candidate topic = [${v0TopicStr}]`,
    `Current stack (${lengthHint}) = ${stackStr}`,
    `New message = "${msg}"`,
    '',
    'Output JSON: {"action": "kept|pushed|returned|leaf", "topic_refined": ["word1","word2","word3"], "returns_to_depth": 0}',
    '(returns_to_depth only has a value for "returned"; for other actions use -1 or omit it)',
  ].join('\n')
}

// 提取 LLM 文本中的 JSON 对象。容忍 ```json 包裹、前后多余文字。
function parseClassifierJson(text) {
  if (!text || typeof text !== 'string') return null
  // 去掉 <think> 块（如果模型把思考也输出了）
  let body = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // 去掉 ```json ... ``` 围栏
  const fenceMatch = body.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) body = fenceMatch[1].trim()
  // 找第一个 { 到最后一个 }
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  const jsonStr = body.slice(first, last + 1)
  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

// 校验 + 规范化 LLM 返回的 JSON
function normalizeClassifierResult(raw, currentStack) {
  if (!raw || typeof raw !== 'object') return null
  const action = String(raw.action || '').toLowerCase().trim()
  if (!['kept', 'pushed', 'returned', 'leaf'].includes(action)) return null

  let topic = []
  if (Array.isArray(raw.topic_refined)) {
    topic = raw.topic_refined
      .map(t => String(t || '').trim())
      .filter(t => t.length > 0 && t.length <= 32)
      .slice(0, 3)
  }

  let returnsToDepth = -1
  if (action === 'returned') {
    const d = Number.isInteger(raw.returns_to_depth) ? raw.returns_to_depth : -1
    const stackLen = Array.isArray(currentStack) ? currentStack.length : 0
    if (d < 0 || d >= stackLen) {
      // returned 但深度非法 → 视为不合理，拒掉
      return null
    }
    returnsToDepth = d
  }

  return { action, topic, returnsToDepth }
}

/**
 * 调 LLM 仲裁 focus 事件。
 *
 * @param {object} args
 * @param {string} args.newMessage   - 当前用户消息正文
 * @param {string} args.v0Event      - v0 启发式判定的 event（pushed / returned）
 * @param {string[]} args.v0Topic    - v0 抽出的候选 topic 关键词
 * @param {object[]} args.currentStack - 当前 focus 栈快照（不会被修改）
 * @param {AbortSignal} [args.signal] - 上层 abort 信号
 * @returns {Promise<{action:'kept'|'pushed'|'returned'|'leaf', topic:string[], returnsToDepth:number} | null>}
 *   返回 null 表示「失败 / 超时 / 解析不出来」，让上层回退到 v0。
 */
export async function classifyFocusEvent({
  newMessage,
  v0Event,
  v0Topic,
  currentStack,
  signal,
} = {}) {
  // 边界保护
  if (!newMessage || typeof newMessage !== 'string') return null
  if (signal?.aborted) return null

  const v0TopicStr = Array.isArray(v0Topic) ? v0Topic.join(',') : String(v0Topic || '')
  const tag = `[focus-classifier] v0=${v0Event} topic=[${v0TopicStr}]`

  // 动态 import callLLM —— 跟 injector.js 同款，避免在测试环境/早期模块加载时拉起一切
  let callLLM
  try {
    const llm = await import('../llm.js')
    callLLM = llm.callLLM
  } catch (e) {
    console.log(`${tag} → llm.js import 失败 (${e?.message || 'unknown'}) → 回退 v0`)
    return null
  }
  if (typeof callLLM !== 'function') {
    console.log(`${tag} → callLLM 不是函数 → 回退 v0`)
    return null
  }

  const userPrompt = buildUserPrompt({ newMessage, v0Event, v0Topic, currentStack })
  const t0 = Date.now()

  // 800ms 硬超时 + LLM 调用赛跑
  let timeoutHandle = null
  const timeoutPromise = new Promise(resolve => {
    timeoutHandle = setTimeout(() => resolve({ __timeout: true }), CLASSIFIER_TIMEOUT_MS)
  })

  let result
  try {
    result = await Promise.race([
      callLLM({
        systemPrompt: SYSTEM_PROMPT,
        message: userPrompt,
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
    const dt = Date.now() - t0
    console.log(`${tag} → LLM 抛错 (${dt}ms, ${e?.message || 'unknown'}) → 回退 v0`)
    return null
  }
  if (timeoutHandle) clearTimeout(timeoutHandle)

  const dt = Date.now() - t0
  if (!result || result.__timeout) {
    console.log(`${tag} → LLM 超时 (${CLASSIFIER_TIMEOUT_MS}ms 硬超时, 实际 ${dt}ms) → 回退 v0`)
    return null
  }
  if (result.aborted) {
    console.log(`${tag} → LLM aborted (${dt}ms) → 回退 v0`)
    return null
  }

  const content = typeof result === 'string' ? result : (result.content || '')
  const preview = String(content).replace(/\s+/g, ' ').slice(0, 200)
  const raw = parseClassifierJson(content)
  if (!raw) {
    console.log(`${tag} → LLM 返回 (${dt}ms) 但 JSON 解析失败 raw="${preview}" → 回退 v0`)
    return null
  }

  const normalized = normalizeClassifierResult(raw, currentStack)
  if (!normalized) {
    console.log(`${tag} → LLM 返回 (${dt}ms) action=${raw.action} 但 normalize 拒掉 (非法 action 或越界 depth) raw="${preview}" → 回退 v0`)
    return null
  }

  const refinedStr = normalized.topic.join(',')
  const depthStr = normalized.action === 'returned' ? ` d=${normalized.returnsToDepth}` : ''
  console.log(`${tag} → llm=${normalized.action}${depthStr} (${dt}ms) refined=[${refinedStr}] ok`)
  return normalized
}

// 暴露内部辅助函数，便于测试
export const __internal = {
  describeStack,
  buildUserPrompt,
  parseClassifierJson,
  normalizeClassifierResult,
  SYSTEM_PROMPT,
  CLASSIFIER_TIMEOUT_MS,
}
