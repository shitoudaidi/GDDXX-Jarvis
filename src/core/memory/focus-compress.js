// Focus Compress —— 动态上下文记忆池架构第 3c 步：专注帧压缩回填
//
// 当一帧被 pop（用户回到主线、子主题切走、栈深超限、stale 失活），
// 这里把那帧期间的对话片段 + 工具调用日志压成一句话结论：
//   - 挂到当前栈顶帧的 conclusions（让 LLM 在 <focus> 段里看到子主题的沉淀）
//   - 同时沉淀到长期记忆（event_type='focus_conclusion'）
//
// 这是单 Agent 模拟多 Agent 子任务返回的核心机制（DynamicMemoryPool.md 3.4）。
// 整个流程 fire-and-forget，所有错误吞掉，绝对不能阻塞主对话。
//
// 测试策略：拆成 pure data 准备函数（buildCompressionInput） + LLM 调用包装
// （compressPoppedFrame）。pure data 函数零依赖，可在不连 db / llm 的环境下测。

const COMPRESSION_HISTORY_ROUNDS = 30
const MAX_TIMELINE_LIMIT = COMPRESSION_HISTORY_ROUNDS * 2
const MAX_PROMPT_INPUT_CHARS = 20000
const MAX_ACTIONLOG_LIMIT = 50
const MAX_LOOKBACK_HOURS = 24
const COMPRESSION_MAX_TOKENS = 150
const COMPRESSION_TEMPERATURE = 0.2
const MAX_CONVERSATION_LINE_CHARS = 260

const COMPRESSION_PROMPT = `You are the focus-frame compressor. Compress the following conversation excerpt and tool-call log into a 1-2 sentence conclusion.
Requirements:
- Narrate in the first person ("我..."), where "我" is *you, the assistant* — never the user.
- The excerpt lines are labeled "<sender> -> <receiver>". What the user sent are the user's words, proposals and feelings; what you sent are yours. Attribute correctly: never absorb the user's statements, suggestions, or emotions as your own thought or decision. If a choice or proposal came from the user, say so explicitly (e.g. "用户提议…，我…").
- Capture what the user got out of this focus, what decisions were made (and by whom), and what concrete artifacts were left behind.
- Do not restate the original wording, do not list bullet points, do not write a play-by-play of "the user asked X and I answered Y".
- Give the conclusion itself directly, with no prefix or explanation.
- Write in Chinese.`

function formatCompressionParty(id) {
  if (!id) return '?'
  return id === 'jarvis' ? 'You' : id
}

function recentConversationRows(conversations = []) {
  if (!Array.isArray(conversations)) return []
  return conversations.slice(-MAX_TIMELINE_LIMIT)
}

// 估算 lookback 小时数：从帧的 startedAt 到现在，cap 在 MAX_LOOKBACK_HOURS。
function estimateLookbackHours(startedAt) {
  if (!startedAt) return MAX_LOOKBACK_HOURS
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return MAX_LOOKBACK_HOURS
  const deltaMs = Date.now() - startMs
  const hours = deltaMs / 3600000
  if (!Number.isFinite(hours) || hours <= 0) return 1
  return Math.min(MAX_LOOKBACK_HOURS, Math.ceil(hours) + 1)
}

// 过滤出 timestamp >= since 的行。timestamp 缺失或解析失败的行也保留（保守起见）。
function filterSince(rows, since) {
  if (!Array.isArray(rows)) return []
  if (!since) return rows
  const sinceMs = Date.parse(since)
  if (!Number.isFinite(sinceMs)) return rows
  return rows.filter(r => {
    const ts = r?.timestamp
    if (!ts) return true
    const ms = Date.parse(ts)
    if (!Number.isFinite(ms)) return true
    return ms >= sinceMs
  })
}

// 把 conversations + action_logs 拼成一段可投喂给 LLM 的纯文本。
// pure function，方便单测。
export function buildCompressionInput(poppedFrame, { conversations = [], actionLogs = [] } = {}) {
  const topic = Array.isArray(poppedFrame?.topic) ? poppedFrame.topic.join(', ') : ''
  const lines = []
  lines.push(`[Topic of popped focus] ${topic}`)
  if (poppedFrame?.startedAt) {
    lines.push(`[Frame started at] ${poppedFrame.startedAt}`)
  }

  const visibleConversations = recentConversationRows(conversations)
  if (visibleConversations.length > 0) {
    lines.push('')
    lines.push(`[Conversation during this focus: last ${COMPRESSION_HISTORY_ROUNDS} rounds]`)
    for (const c of visibleConversations) {
      const from = formatCompressionParty(c.from_id || c.from || c.sender)
      const to = formatCompressionParty(c.to_id || c.to || c.target)
      const ts = c.timestamp || ''
      const content = String(c.content || c.message || '').replace(/\s+/g, ' ').slice(0, MAX_CONVERSATION_LINE_CHARS)
      if (!content) continue
      lines.push(`- [${ts}] ${from} -> ${to}: ${content}`)
    }
  }

  if (actionLogs.length > 0) {
    lines.push('')
    lines.push('[Tool calls during this focus]')
    for (const a of actionLogs) {
      const ts = a.timestamp || ''
      const tool = a.tool || '?'
      const summary = String(a.summary || '').replace(/\s+/g, ' ').slice(0, 200)
      const status = a.status || ''
      lines.push(`- [${ts}] ${tool}${status ? `(${status})` : ''}: ${summary}`)
    }
  }

  let text = lines.join('\n')
  if (text.length > MAX_PROMPT_INPUT_CHARS) {
    text = text.slice(0, MAX_PROMPT_INPUT_CHARS) + '\n... [truncated]'
  }
  return text
}

// 清理 LLM 返回内容：trim、去掉 <think> 块、再 trim
function cleanConclusion(content) {
  if (!content) return ''
  let s = String(content)
  // 移除 <think>...</think> / <thinking>...</thinking> 块
  s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  s = s.trim()
  // 去掉可能残留的引号包裹
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('「') && s.endsWith('」'))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

/**
 * 把一帧 pop 出去的 focus frame 压缩成一句话结论。
 * fire-and-forget：所有错误吞掉。
 *
 * @param {object} poppedFrame      — 刚 pop 出去的帧
 * @param {object|null} currentTopFrame — pop 后的新栈顶（可为 null）。结论挂到这里。
 * @param {object} opts
 * @param {string} opts.sessionRef
 * @param {Function} [opts.emitEvent] — 可选事件回调（用于通知 UI / 日志）
 * @param {Function} [opts.saveStack]  — 可选回调：把 conclusion 挂上栈顶后调用，
 *                                      让调用方把更新后的 state.focusStack 写回 db（5c 步）。
 *                                      不传则只改内存，不持久化。
 * @returns {Promise<{ conclusion: string, attempted: boolean } | null>}
 */
export async function compressPoppedFrame(poppedFrame, currentTopFrame, { sessionRef, emitEvent, saveStack } = {}) {
  if (!poppedFrame) return null
  try {
    // 动态 import：让该模块在 test/纯算法路径下也能被引入而不强拉 db
    const { getRecentConversationTimeline, getRecentActionLogs, insertMemory } = await import('../db.js')
    const { callLLM } = await import('../llm.js')

    const hoursSince = estimateLookbackHours(poppedFrame.startedAt)
    let conversations = []
    let actionLogs = []
    try {
      // includeAbsorbed: true —— 压缩器自身要看「全量历史」来生成结论；如果之前某个
      // overlapping frame 已经把部分对话标 absorbed，默认过滤会让压缩器丢失上下文。
      conversations = getRecentConversationTimeline(MAX_TIMELINE_LIMIT, hoursSince, { includeAbsorbed: true }) || []
      conversations = filterSince(conversations, poppedFrame.startedAt)
    } catch {}
    try {
      actionLogs = getRecentActionLogs(MAX_ACTIONLOG_LIMIT) || []
      actionLogs = filterSince(actionLogs, poppedFrame.startedAt)
    } catch {}

    if (conversations.length === 0 && actionLogs.length === 0) {
      // 没东西可压
      return { conclusion: '', attempted: false }
    }

    const promptInput = buildCompressionInput(poppedFrame, { conversations, actionLogs })

    let llmResult = null
    try {
      llmResult = await callLLM({
        systemPrompt: COMPRESSION_PROMPT,
        message: promptInput,
        temperature: COMPRESSION_TEMPERATURE,
        thinking: false,
        tools: [],
        maxTokens: COMPRESSION_MAX_TOKENS,
        mustReply: false,
      })
    } catch (err) {
      console.warn('[focus-compress] callLLM failed:', err?.message || err)
      return { conclusion: '', attempted: true }
    }

    const conclusion = cleanConclusion(llmResult?.content || '')
    if (!conclusion) {
      return { conclusion: '', attempted: true }
    }

    // 回填到当前栈顶（如果有）
    if (currentTopFrame && Array.isArray(currentTopFrame.conclusions)) {
      currentTopFrame.conclusions.push(conclusion)
      // cap 长度，滚动丢最旧
      while (currentTopFrame.conclusions.length > 5) {
        currentTopFrame.conclusions.shift()
      }
      // 5c 步：conclusion 挂上后立刻持久化整栈到 db。
      // currentTopFrame 是 state.focusStack 末元素的引用——调用方传进来的
      // saveStack 闭包指向同一份 state.focusStack，所以这里直接调即可。
      // 任何异常吞掉（saveFocusStack 自带 try/catch + console.warn）。
      try { saveStack?.() } catch {}
    }

    // 沉淀到长期记忆。insertMemory 自带去重，可能 reject —— 吞掉。
    try {
      const topicJoined = Array.isArray(poppedFrame.topic) ? poppedFrame.topic.join(', ') : ''
      insertMemory({
        event_type: 'focus_conclusion',
        content: conclusion,
        detail: '',
        title: `专注结论：${topicJoined}`,
        tags: ['focus_conclusion', `topic:${topicJoined}`],
        entities: [],
        timestamp: poppedFrame.startedAt || new Date().toISOString(),
        salience: 3,
      })
    } catch (err) {
      // 去重 / 写库失败都吞掉
    }

    // 动态上下文记忆池 3.5：标记该帧覆盖区间的对话为 focus_absorbed=1。
    // 关键先后：必须在 conclusion 真正成功写入后才标记——前面的 cleanConclusion 已经
    // ensure conclusion 非空，且 insertMemory 走到这里说明压缩流程没崩。否则对话会被
    // 错误地永久从下一轮主线注入中隐藏。
    //
    // 已知 race（v0 接受）：compressPoppedFrame 是 fire-and-forget。如果用户在 frame
    // pop 之后毫秒级立刻发新消息，新消息进 injector 时本函数可能还没执行到这里，
    // 子帧对话还没标记 absorbed → 对话被注入。v0 不保证「绝对不出现噪声」，只是
    // 「绝大多数情况不出现」。
    try {
      const { markConversationsAbsorbed } = await import('../db.js')
      const marked = markConversationsAbsorbed(poppedFrame.startedAt, new Date().toISOString())
      const topicLabel = Array.isArray(poppedFrame.topic) ? poppedFrame.topic.join(',') : ''
      console.log(`[focus-compress] 标记 ${marked} 条对话为 absorbed (frame: ${topicLabel})`)
    } catch {}

    // emit 事件（如果给了回调）
    try {
      if (typeof emitEvent === 'function') {
        emitEvent('focus_compressed', {
          poppedTopic: poppedFrame.topic,
          conclusion,
          sessionRef,
        })
      }
    } catch {}

    return { conclusion, attempted: true }
  } catch (err) {
    console.warn('[focus-compress] unexpected error:', err?.message || err)
    return null
  }
}

// 仅供测试：暴露内部清理函数
export const __internal = {
  cleanConclusion,
  estimateLookbackHours,
  filterSince,
  formatCompressionParty,
  recentConversationRows,
}
