import { normalizeChannel, isSystemSignalRow } from './channel.js'

// P0-1：把 row.focus_topic 渲染成短标签贴在 marker 上，让 LLM 在做代词消解时看到话题边界。
// 空 topic / SYSTEM 行不渲染。
function topicTag(row) {
  const t = (row?.focus_topic || '').trim()
  return t ? ` · topic=${t}` : ''
}

export function formatConversationMessage(row, currentMsg = null, prevChannel = '', currentTopic = '', expiredQuestion = false, prevTopic = '') {
  if (row.role === 'jarvis') {
    // Jarvis 出站的渠道也标出来，让模型能"看到"自己上次回到了哪里
    const rawChannel = row.channel || ''
    const normalized = normalizeChannel(rawChannel)
    const channelTag = (normalized && normalized !== 'TUI' && normalized !== 'SYSTEM') ? `[via ${normalized}] ` : ''
    // P0-2：若该条 jarvis 消息留了 open_question，且本轮已被判断为过期
    //   （N 轮未接茬 / 话题已切换），追加一行明确告诉 LLM "这个悬念已废，别再回应它"。
    //   未过期则保留原本的 question——它仍然是当前对话的一部分。
    let expiredTag = ''
    if (row.open_question && expiredQuestion) {
      expiredTag = `\n[expired follow-up — the user did not engage with this question and the topic has moved on; do not retro-answer it]`
    }
    // P0-1：在 jarvis 内容前注一个 topic 标签，纯文本前缀。
    //   不像 user 那种 [user message · ...] 包裹，因为我们要保留 assistant role 的常规结构。
    const tt = (row?.focus_topic || '').trim()
    const topicPrefix = tt ? `[topic=${tt}] ` : ''
    // 归属对称：用户每条消息都带响亮的 [user message · from_id · ts] 带内头，自报说话人；
    //   而 jarvis 历史消息原本只靠 role:'assistant' 这个结构字段标身份，正文里没有可见锚点。
    //   当窗口里同时存在"用户说的"和"我说的"同类内容（典型：双方都在猜世界杯比分），
    //   含糊的归属会被用户那侧响亮的标签拉过去——我自己几轮前押的 2-0 被错记成"你猜的 2-0"。
    //   2026-06-07 的 [↑ your last reply] 只覆盖紧邻的上一条；这里给"每一条"我的历史消息
    //   补一个对称的 [you · ts] 带内头，让跨整个窗口的归属都有可见锚，不只最后一条。
    const jts = row.timestamp ? row.timestamp.slice(0, 16).replace('T', ' ') : ''
    const youTag = jts ? `[you · ${jts}]\n` : `[you]\n`
    return {
      role: 'assistant',
      content: `${youTag}${channelTag}${topicPrefix}${row.content || ''}${expiredTag}`,
    }
  }

  // Truncate timestamp to minute precision (drop seconds and timezone)
  const ts = row.timestamp ? row.timestamp.slice(0, 16).replace('T', ' ') : ''
  const rawChannel = row.channel || currentMsg?.channel || ''
  const normalizedChannel = normalizeChannel(rawChannel)

  // 保留 currentMsg 回退语义：row.channel 为空时回退到 currentMsg?.channel（同 rawChannel）。
  const isSystemSignal = isSystemSignalRow(row, currentMsg?.channel)

  if (isSystemSignal) {
    const channelLabel = rawChannel ? ` · ${rawChannel}` : ''
    return {
      role: 'user',
      content: `[system signal · ${ts}${channelLabel}]\n${row.content || ''}\n(Respond with tools only. Do NOT call send_message.)`.trim(),
    }
  }

  const isCurrent = currentMsg
    && row.role === 'user'
    && row.from_id === currentMsg.fromId
    && row.timestamp === currentMsg.timestamp
    && row.content === currentMsg.content
  const marker = isCurrent ? 'current user message' : 'user message'
  // 简化后的渠道：TUI 视为默认不显示；其他（WECHAT/DISCORD/FEISHU/WECOM）显示
  let channelLabel = (normalizedChannel && normalizedChannel !== 'TUI') ? ` · ${normalizedChannel}` : ''

  // channel 切换提示：本条消息相对上一条的入口换了，给模型一个显眼的指代锚点。
  // 主要场景：用户在 TUI 聊到一半切到微信继续问"那现在呢？"——必须让 LLM 知道
  // 入口变了、感知能力也跟着变了，否则代词会被 runtime 块（电池/系统块）抢走。
  if (prevChannel && normalizedChannel && prevChannel !== normalizedChannel) {
    channelLabel += ` (channel switch: ${prevChannel} → ${normalizedChannel})`
  }

  // P0-1：当前轮 topic 跟上一条非当前消息的 topic 不同 → marker 上显式标注话题切换。
  //   注意必须跟 prevTopic 比，不是跟 row.focus_topic 自己比——
  //   本轮 user 消息的 focus_topic 已经被 updateUserMessageFocusTopic 回填成 currentTopic，
  //   它自己跟 currentTopic 永远相等。要看话题边界必须看上一条历史消息的 topic。
  let topicLabel = topicTag(row)
  if (isCurrent && currentTopic && prevTopic && currentTopic !== prevTopic) {
    topicLabel += ` (topic switch from ${prevTopic} → ${currentTopic})`
  }

  return {
    role: 'user',
    content: `[${marker} · ${row.from_id || 'unknown'} · ${ts}${channelLabel}${topicLabel}]\n${row.content || ''}`.trim(),
  }
}

export function formatTaskSteps(taskSteps = []) {
  if (!taskSteps?.length) return ''
  const statusIcon = { done: '✓', failed: '✗', skipped: '—', pending: '○' }
  const lines = taskSteps.map((s, i) => {
    const icon = statusIcon[s.status] || '○'
    const note = s.note ? ` (${s.note})` : ''
    return `  ${i + 1}. [${icon}] ${s.text}${note}`
  })
  const done = taskSteps.filter(s => s.status === 'done').length
  const total = taskSteps.length
  return `Task step progress (${done}/${total}):\n${lines.join('\n')}`
}

export function buildRuntimeContextMessages({ recentActions = [], actionLog = [], lastToolResult = null, taskSteps = [], batteryBlock = '' } = {}) {
  const parts = []

  if (batteryBlock) {
    parts.push(batteryBlock)
  }

  if (taskSteps?.length > 0) {
    parts.push(formatTaskSteps(taskSteps))
  }

  if (recentActions?.length > 0) {
    const lines = recentActions.map(item => `- ${item.ts?.slice(11, 16) || ''} ${item.summary || ''}`).join('\n')
    parts.push(`Recent assistant actions:\n${lines}\nAvoid immediately repeating the same action unless the current user message asks for it.`)
  }

  if (actionLog?.length > 0) {
    const lines = actionLog.slice(-10).map(item => {
      const time = item.timestamp?.slice(11, 16) || ''
      const detail = item.detail ? `\n  ${item.detail}` : ''
      return `- ${time} ${item.tool || ''} · ${item.summary || ''}${detail}`
    }).join('\n')
    parts.push(`Recent tool/action log:\n${lines}\nUse this as runtime context only. Do not repeat completed actions unless the current task requires it.`)
  }

  if (lastToolResult) {
    const argsSummary = Object.entries(lastToolResult.args || {})
      .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
      .join(', ')
    const resultPreview = String(lastToolResult.result || '').slice(0, 500)
    parts.push(`Previous tool result:\n${lastToolResult.name}(${argsSummary}) ->\n${resultPreview}\nAbsorb this result before deciding the next step.`)
  }

  if (parts.length === 0) return []
  return [{
    role: 'user',
    content: `[runtime context]\n${parts.join('\n\n')}`,
  }]
}

// P0-2：判断 conversationWindow 里某条 open_question 是否已"过期"。
//   过期条件（任一满足即视为过期）：
//     1. 距今超过 N 条非 SYSTEM 消息且用户从未直接接茬这条问题
//     2. 本轮 currentTopic 跟该 jarvis 行当时的 focus_topic 不同（话题已切走）
//   "直接接茬"的简化判定：紧跟这条 jarvis 行之后的下一条 user 消息长度 >= 6 字
//   且至少含 1 个中英文实词字符；极短回应（嗯/好/可以）不算接茬。
const EXPIRED_FOLLOWUP_DISTANCE = 4
function computeExpiredFollowupSet(rows, currentTopic) {
  const expired = new Set()
  if (!Array.isArray(rows)) return expired
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.role !== 'jarvis' || !row.open_question) continue
    // 1. 看紧跟的下一条 user 消息
    let nextUser = null
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j]?.role === 'user' && (rows[j].from_id || '') !== 'SYSTEM') {
        nextUser = rows[j]; break
      }
    }
    const engaged = nextUser
      && typeof nextUser.content === 'string'
      && nextUser.content.replace(/\s+/g, '').length >= 6
    if (engaged) continue
    // 2. 距今 >= N 条对话
    const distance = rows.length - 1 - i
    const farEnough = distance >= EXPIRED_FOLLOWUP_DISTANCE
    // 3. 话题已切
    const rowTopic = (row.focus_topic || '').trim()
    const topicSwitched = !!currentTopic && !!rowTopic && currentTopic !== rowTopic
    if (farEnough || topicSwitched) expired.add(row.id ?? i)
  }
  return expired
}

export function buildLLMMessages({ systemPrompt, contextBlock = '', conversationWindow = [], input, msg = null, recentActions = [], actionLog = [], lastToolResult = null, taskSteps = [], batteryBlock = '', currentTopic = '', isTick = false }) {
  const messages = [{ role: 'system', content: systemPrompt }]
  messages.push(...buildRuntimeContextMessages({ recentActions, actionLog, lastToolResult, taskSteps, batteryBlock }))

  const rows = Array.isArray(conversationWindow) ? conversationWindow : []

  // P0-2：先扫一遍找出所有"过期未答悬念"
  const expiredSet = computeExpiredFollowupSet(rows, currentTopic)

  // Track which message in the array should receive this round's <context> block:
  // it's the last user-role message representing the "current" turn — either the
  // matched row from conversationWindow (when msg is already persisted to db) or
  // the appended fallback message below (TICK / unmatched cases).
  let currentMessageIndex = -1
  // prevChannel 维护：上一条非 SYSTEM 消息的 normalized channel，用于在 marker
  // 上标注 channel switch（"那现在呢"代词消解所依赖的核心信号之一）。
  let prevChannel = ''
  // P0-1：prevTopic 维护：上一条非当前、非 SYSTEM 消息的 focus_topic。
  //   当前 user 消息渲染时拿它和 currentTopic 比，决定要不要标 "topic switch"。
  let prevTopic = ''

  for (const row of rows) {
    if (!row?.content) continue
    const rowNorm = normalizeChannel(row.channel || '')
    const isSystemRow = isSystemSignalRow(row)
    const isCurrent = !!msg
      && row.role === 'user'
      && row.from_id === msg.fromId
      && row.timestamp === msg.timestamp
      && row.content === msg.content
    const isExpired = expiredSet.has(row.id ?? -999)
    const formatted = formatConversationMessage(row, msg, isSystemRow ? '' : prevChannel, currentTopic, isExpired, prevTopic)
    if (!formatted.content) continue
    messages.push(formatted)
    if (isCurrent) currentMessageIndex = messages.length - 1
    if (!isSystemRow && rowNorm) prevChannel = rowNorm
    // prevTopic 只在非 current、非 system 的行之后推进——current 自身的 topic 不参与
    if (!isCurrent && !isSystemRow && row.focus_topic) prevTopic = String(row.focus_topic).trim()
  }

  const hasCurrentMessage = currentMessageIndex >= 0

  // 显著度锚点：把"紧挨着当前用户消息之前的那条 jarvis 回复"显式标成「你上一句」。
  //   接追问 / 指代消解的核心信号——历史窗口里这条本就在，但和更早的若干条混在一起没有
  //   区分度。用户当前这句（"继续 / 那个 / 再来一个 / 这个呢"）绝大多数是在回应/承接「这一条」，
  //   而不是窗口里更早的某句。给它一个一行 marker，让模型先把指代绑定到这里再往外找。
  //   只在确实存在上一条回复（= 进行中的对话）时才标，首条消息无可锚定。
  let priorReplyIndex = -1
  if (hasCurrentMessage) {
    for (let i = currentMessageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { priorReplyIndex = i; break }
    }
    if (priorReplyIndex >= 0) {
      messages[priorReplyIndex].content =
        `[↑ your last reply — THIS IS YOUR OWN output, not the user's words. The user's current message most likely responds to or follows from THIS. Any ideas, imagery, metaphors, or descriptions here were said by YOU; do not later credit them to the user ("你刚才说的/你描述的那个…") — that was you, not them.]\n${messages[priorReplyIndex].content}`
    }
  }

  if (!hasCurrentMessage) {
    // TICK 心跳路径：fallback 消息会以 role:'user' 注入，结构上跟真用户消息没区别。
    // 不加 marker 时模型会把 "TICK 2026-..." 当成用户在重新发问，于是反复回答自己上一轮
    // 提的 open_question，出现自问自答。这里显式标 [heartbeat tick]、注明非用户消息、
    // 禁止回放历史问题，与下面 system signal 的 marker 待遇对齐。
    const fallbackContent = isTick
      ? `[heartbeat tick · no new user message]\n${input}\n(This is an internal heartbeat, NOT a user message. Do NOT treat it as the user re-asking a prior question or responding to your previous open question. Decide whether to act proactively per the directions above, or stay silent — both are valid.)`
      : input
    messages.push({
      role: 'user',
      content: fallbackContent,
    })
    currentMessageIndex = messages.length - 1
  }

  // 复合意图 + 指代的即时提醒：贴在当前用户消息「原话之后」，靠 recency 把模型的注意力
  //   从前面那一大块 <context> 背景拉回到这一句真正的诉求上。只在进行中的对话里加（有上一条
  //   回复时），首条消息交给系统提示里的常驻规则即可，避免每轮无谓加料。非 TICK。
  if (priorReplyIndex >= 0 && !isTick && currentMessageIndex >= 0) {
    messages[currentMessageIndex].content +=
      `\n[intent check · in <think>: (1) resolve every pronoun/ellipsis here ("继续/那个/这个呢/再来一个/换一个") against your last reply and the exchange just above, before reaching for older context; (2) list EVERY distinct request this one message carries — finish all of them this turn, not just the first; (3) name the WANT under the words — the outcome that ends their need — and answer that, not the literal grammar (a question is usually "do it"; a complaint is "fix it"; terse/urgent typing means lead with the result, no preamble).]`
  }

  // Prepend this round's <context>...</context> to the current user message.
  // The block is NOT persisted to db — conversations are written from the raw
  // user content (see queue.pushMessage) and assistant outputs are stored
  // verbatim, so the next round's conversationWindow stays clean.
  if (contextBlock && currentMessageIndex >= 0) {
    const target = messages[currentMessageIndex]
    target.content = `${contextBlock}\n\n${target.content || ''}`
  }

  return messages
}
