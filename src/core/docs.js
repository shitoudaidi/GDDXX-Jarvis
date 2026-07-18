// 文档面板管理模块
// 类似 hotspots.js 的面板状态 + TTL 上下文注入机制
import { DOC_TOPICS as VOICE_TOPICS, detectDocTopic as detectVoiceTopic } from './docs/voice-config-faq.js'
import { CONFIG_TOPICS } from './docs/config-faq.js'
import { SELF_KNOWLEDGE_TOPICS, detectSelfKnowledgeTopic } from './docs/self-knowledge.js'

// 合并所有文档主题
const DOC_TOPICS = { ...VOICE_TOPICS, ...CONFIG_TOPICS, ...SELF_KNOWLEDGE_TOPICS }

function formatDocAsContext(topicId) {
  const doc = DOC_TOPICS[topicId]
  if (!doc) return ''
  const lines = [`## Reference Document: ${doc.title}`, doc.summary, '']
  for (const section of doc.sections) {
    lines.push(`### ${section.title}`)
    lines.push(section.content)
    lines.push('')
  }
  if (doc.providers?.length > 0) {
    lines.push('### Providers')
    for (const p of doc.providers) {
      lines.push(`- **${p.name}**${p.free ? ' (free quota available)' : ''}: ${p.note} - ${p.url}`)
    }
  }
  return lines.join('\n')
}

// 根据用户消息检测应打开的文档主题（意图识别，无需穷举关键词）
function detectDocTopic(text) {
  if (!text) return null
  const selfTopic = detectSelfKnowledgeTopic(text)
  if (selfTopic) return selfTopic

  const voiceTopic = detectVoiceTopic(text)
  if (voiceTopic) return voiceTopic

  const t = text.toLowerCase()

  // 模型 / LLM 配置
  if (/(模型|model|llm|provider|api.?key|密钥|激活|切换模型|配置.*(deepseek|minimax|qwen|openai|moonshot|zhipu|claude|gemini|mimo|小米)|deepseek|minimax.*配置|qwen.*配置|mimo.*配置|小米.*配置|自定义.*端点|base.?url)/.test(t)) {
    return 'model_config'
  }

  // 微信 / 社交平台配置
  if (/(微信|wechat|公众号|企业微信|wecom|clawbot|飞书|feishu|discord|社交|配置.*机器人|机器人.*配置|接入.*平台|平台.*接入)/.test(t)) {
    return 'wechat_config'
  }

  return null
}

const DOC_CONTEXT_TTL_MINUTES = 30

let panelState = {
  active: false,
  topicId: null,    // 当前显示的文档主题 ID
  updatedAtMs: 0,
  source: 'startup',
}
let contextActiveUntilMs = 0

export function noteDocPanelViewed(topicId) {
  contextActiveUntilMs = Date.now() + DOC_CONTEXT_TTL_MINUTES * 60 * 1000
  setDocPanelState({ active: true, topicId, source: 'viewed' })
}

export function setDocPanelState({ active, topicId = null, source = 'unknown' } = {}) {
  if (typeof active !== 'boolean') return getDocPanelState()
  panelState = {
    active,
    topicId: active ? (topicId || panelState.topicId) : panelState.topicId,
    updatedAtMs: Date.now(),
    source,
  }
  if (active) contextActiveUntilMs = Date.now() + DOC_CONTEXT_TTL_MINUTES * 60 * 1000
  return getDocPanelState()
}

export function getDocPanelState() {
  const now = Date.now()
  return {
    ...panelState,
    updatedAt: panelState.updatedAtMs ? new Date(panelState.updatedAtMs).toISOString() : null,
    contextActive: now < contextActiveUntilMs,
    contextTtlSeconds: Math.max(0, Math.round((contextActiveUntilMs - now) / 1000)),
  }
}

// 当前工作台不再打开独立文档面板。命中主题时把本地参考资料直接
// 注入当前回合，让 Agent 在正常对话里回答。
export function buildDocPanelStateContext(detectedTopic = null) {
  if (!detectedTopic) return ''
  const topicName = DOC_TOPICS[detectedTopic]?.title || detectedTopic
  return [
    '## Local Reference Available',
    `The current question matches the local reference "${topicName}".`,
    'Use the injected reference below and answer directly in chat. Do not ask for or attempt to open a separate documentation panel.',
    'Do not proactively ask the user for API keys. If the user provides one, help configure it and explain how to test it.',
  ].join('\n')
}

// 命中主题时直接注入文档；旧状态仅用于兼容已有 API 客户端。
export function buildDocRuntimeContext(userMessage) {
  const detectedTopic = detectDocTopic(userMessage)
  if (detectedTopic) return formatDocAsContext(detectedTopic)

  const state = getDocPanelState()
  const now = Date.now()
  if (now >= contextActiveUntilMs) return ''
  if (!state.topicId) return ''
  return formatDocAsContext(state.topicId)
}

// 根据用户消息自动检测是否应推送文档面板
// 返回 topicId 或 null
export { detectDocTopic }

// 导出文档主题列表（供 API 使用）
export { DOC_TOPICS }

