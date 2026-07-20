import http from 'http'
import fs from 'fs'
import path from 'path'
import net from 'net'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { getQueueSnapshot, pushMessage } from './queue.js'
import { getDB, getConfig, setConfig, insertUISignal, upsertMediaHistory, getMediaHistory, updateLastJarvisConversationContent, getRecentRecallAudits, getRecentExtractAudits, getRecallAuditStats, getExtractAuditStats, listPendingReminders, getTaskKnowledge, listPrefetchTasks, createReminder, getReminderById, cancelReminder } from './db.js'
import { emitEvent, addSSEClient, removeSSEClient, addACUIClient, removeACUIClient, removeActiveUICard, emitUICommand, flushStickyEvents, setStickyEvent } from './events.js'
import { getQuotaStatus } from './quota.js'
import { isRunning, stopLoop, startLoop } from './control.js'
import { buildHeartbeatSystemPromptPreview } from './system-prompt-preview.js'
import { paths } from './paths.js'
import { config, activate as activateLLM, prepareActivation as prepareLLMActivation, commitPreparedActivation, getActivationStatus, switchModel, saveLLMSettings, setTemperature, setThinking, getMinimaxKey, getSocialConfig, setSocialConfig, getVoiceConfig, setVoiceConfig, getTTSConfig, setTTSConfig, getTTSCredentials, getProviderSummaries, getSecurity, setSecurity, getSeedanceConfig, setSeedanceConfig, getEmbeddingConfig, setEmbeddingConfig, EMBEDDING_PROVIDER_PRESETS, getWebSearchConfig, setWebSearchConfig } from './config.js'
import { streamTTS, TTS_PROVIDERS, TTS_VOICES, validateTTSConfig } from './voice/tts-providers.js'
import { restartConnector } from './social/index.js'
// manager.js (Whisper local server) removed
import { persistAppState } from './capabilities/executor.js'
import { TOOL_SCHEMAS } from './capabilities/schemas.js'
import { listInstalledTools } from './capabilities/marketplace/index.js'
import { execGenerateVideo, saveGeneratedVideo, setAIVideoPanelState, getVideoHistory, stripMarkdownForSpeech } from './capabilities/tools/media.js'
import { handleSocialWebhook, isSocialWebhookPath } from './social/webhooks.js'
import { getClawbotQR, logoutClawbot } from './social/wechat-clawbot.js'
import { createCloudASRSession, isCloudASRConfigured } from './voice/cloud-asr.js'
import { createLocalASRSession } from './voice/local-asr.js'
import { getVoiceStatus, startVoiceServer, stopVoiceServer, restartVoiceServer } from './voice/manager.js'
import { getHotspots, setHotspotPanelState, getHotspotPanelState } from './hotspots.js'
import { getAiNews, getAiHotConfig, setAiHotConfig } from './ai-news.js'
import { getWorldcup, setWorldcupPanelState, getWorldcupPanelState } from './worldcup.js'
import { getPersonCard, setPersonCardPanelState, getPersonCardPanelState } from './person-cards.js'
import { setDocPanelState, getDocPanelState, DOC_TOPICS } from './docs.js'
import { getTraces, getTrace, clearTraces, getTraceStatus } from './runtime/turn-trace.js'
import { detectSeedanceConfig, tryAutoConfigureKey } from './key-auto-config.js'
import { PRIMARY_USER_ID } from './identity.js'
import { answerGrokBuildPermission, cancelGrokBuildTask, getGrokBuildStatus, shutdownGrokBuild, startGrokBuildTask } from './grok-build.js'

export { emitEvent }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JARVIS_UI_ROOT     = paths.jarvisUiRoot
const JARVIS_UI_INDEX    = path.join(JARVIS_UI_ROOT, 'index.html')
const SYSTEM_PROMPT_PATH = paths.systemPromptHtml
const TURN_TRACE_PATH    = paths.turnTraceHtml
const SANDBOX_PATH       = paths.sandboxDir
const DEFAULT_AGENT_NAME = '贾维斯'
const DEFAULT_API_HOST = '127.0.0.1'
const VOICE_MESSAGE_REPEAT_GUARD_MS = 8_000
const DEFAULT_JSON_BODY_LIMIT_BYTES = 512 * 1024
const VIDEO_JSON_BODY_LIMIT_BYTES = 30 * 1024 * 1024
const MAX_ASR_WS_PAYLOAD_BYTES = 1024 * 1024
const MAX_ACUI_WS_PAYLOAD_BYTES = 256 * 1024
const MAX_ASR_CONNECTIONS = 4
const MAX_ACUI_CONNECTIONS = 8
const ASR_PREROLL_MAX_CHUNKS = 12
const ASR_WAKE_PREROLL_MAX_CHUNKS = 48
const ASR_SPEECH_RMS_THRESHOLD = 240
const ASR_WAKE_RMS_THRESHOLD = 48
const requestRateWindows = new Map()

function pcmRms(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (bytes.length < 2) return 0
  let sumSquares = 0
  let samples = 0
  for (let offset = 0; offset + 1 < bytes.length; offset += 8) {
    const sample = bytes.readInt16LE(offset)
    sumSquares += sample * sample
    samples += 1
  }
  return samples > 0 ? Math.sqrt(sumSquares / samples) : 0
}

function normalizeVoiceMessageGuardText(value) {
  return String(value || '').toLowerCase().replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、；：“”‘’（）【】《》…—]/g, '')
}

function isVoiceInputChannel(channel) {
  const value = String(channel || '').trim().toLowerCase()
  return value === 'voice' || value === '语音识别' || value.includes('语音')
}

function getVoiceMessageIgnore(content, channel) {
  if (!isVoiceInputChannel(channel)) return null
  const normalized = normalizeVoiceMessageGuardText(content)
  if (!normalized || /chinese(?:light|like|lite|right)/i.test(normalized)) return { reason: 'asr_noise' }
  const rows = getDB().prepare(`
    SELECT id, content, timestamp FROM conversations
    WHERE role = 'user' AND (channel = '语音识别' OR lower(channel) = 'voice' OR channel LIKE '%语音%')
    ORDER BY id DESC
    LIMIT 40
  `).all()
  const now = Date.now()
  for (const row of rows) {
    if (normalizeVoiceMessageGuardText(row.content) !== normalized) continue
    const ageMs = now - Date.parse(row.timestamp)
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < VOICE_MESSAGE_REPEAT_GUARD_MS) return { reason: 'duplicate_voice', matchedId: row.id, ageMs }
  }
  return null
}

// card.action signals that are lifecycle/system-internal — stored in DB for passive injector use only, not pushed to the agent queue
const SILENT_CARD_ACTIONS = new Set([
  'card.dismissed',  // card closed (components should use acui:dismiss; this is a fallback guard)
  'card.mounted',    // mount complete
  'card.dwell',      // dwell heartbeat
  'card.error',      // render error (already handled by the card.error type signal)
])

function getApiHost() {
  return String(globalThis.process?.env?.JARVIS_HOST || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST
}

function isLanAccessEnabled() {
  return /^(1|true|yes|on)$/i.test(String(globalThis.process?.env?.JARVIS_ALLOW_LAN || '').trim())
}

function normalizeRemoteAddress(address = '') {
  const value = String(address || '').trim().toLowerCase()
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length)
  return value
}

function isLoopbackAddress(address = '') {
  const value = normalizeRemoteAddress(address)
  return value === '127.0.0.1'
    || value === '::1'
    || value === 'localhost'
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress)
}

function isPrivateLanAddress(address = '') {
  const value = normalizeRemoteAddress(address)
  if (!value) return false

  if (net.isIP(value) === 4) {
    const [a, b] = value.split('.').map(part => Number(part))
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
  }

  if (net.isIP(value) === 6) {
    return value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')
  }

  return false
}

function isLanRequest(req) {
  return isLanAccessEnabled() && isPrivateLanAddress(req.socket?.remoteAddress)
}

function isLoopbackOrigin(origin = '') {
  if (!origin || origin === 'null') return true
  if (/^file:\/\//i.test(origin)) return true
  try {
    const parsed = new URL(origin)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    return ['127.0.0.1', 'localhost', '::1'].includes(hostname)
  } catch {
    return false
  }
}

function isAllowedOrigin(origin = '') {
  if (isLoopbackOrigin(origin)) return true
  if (!isLanAccessEnabled()) return false
  try {
    const parsed = new URL(origin)
    return isPrivateLanAddress(parsed.hostname)
  } catch {
    return false
  }
}

function getAuthToken() {
  return String(globalThis.process?.env?.JARVIS_API_TOKEN || '').trim()
}

function hasValidAuthToken(req, url) {
  const expected = getAuthToken()
  if (!expected) return false
  const header = req.headers.authorization || ''
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const queryToken = url.searchParams.get('token')
  return bearer === expected || queryToken === expected
}

function requireLocalOrToken(req, res, url) {
  if (isLoopbackRequest(req) || hasValidAuthToken(req, url)) return true
  jsonResponse(res, 403, { ok: false, error: 'forbidden' })
  return false
}

function hasAllowedAccess(req, url) {
  return isLoopbackRequest(req) || hasValidAuthToken(req, url) || isLanRequest(req)
}

function isSensitiveRequest(method, pathname) {
  if (!['POST', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())) return false
  return !isSocialWebhookPath(pathname)
}

function setBaseResponseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
}

function requestBodyLimitFor(pathname) {
  return pathname === '/aivideo/generate' ? VIDEO_JSON_BODY_LIMIT_BYTES : DEFAULT_JSON_BODY_LIMIT_BYTES
}

function installRequestBodyGuard(req, res, pathname) {
  if (!['POST', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return true
  const limit = requestBodyLimitFor(pathname)
  const declared = Number(req.headers['content-length'] || 0)
  if (Number.isFinite(declared) && declared > limit) {
    res.setHeader('Connection', 'close')
    jsonResponse(res, 413, { ok: false, error: `request body exceeds ${limit} bytes` })
    req.resume()
    return false
  }

  let received = 0
  let exceeded = false
  req.prependListener('data', chunk => {
    if (exceeded) return
    received += chunk.length
    if (received <= limit) return
    exceeded = true
    req.removeAllListeners('data')
    req.removeAllListeners('end')
    req.on('error', () => {})
    req.resume()
    if (!res.headersSent) {
      res.setHeader('Connection', 'close')
      jsonResponse(res, 413, { ok: false, error: `request body exceeds ${limit} bytes` })
    }
  })
  return true
}

function consumeRateLimit(req, key, limit, windowMs) {
  const address = normalizeRemoteAddress(req.socket?.remoteAddress) || 'unknown'
  const bucketKey = `${key}:${address}`
  const now = Date.now()
  const recent = (requestRateWindows.get(bucketKey) || []).filter(timestamp => now - timestamp < windowMs)
  if (recent.length >= limit) {
    requestRateWindows.set(bucketKey, recent)
    return false
  }
  recent.push(now)
  requestRateWindows.set(bucketKey, recent)
  if (requestRateWindows.size > 200) {
    for (const [storedKey, timestamps] of requestRateWindows) {
      if (!timestamps.some(timestamp => now - timestamp < windowMs)) requestRateWindows.delete(storedKey)
    }
  }
  return true
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function jsonResponse(res, status, body) {
  setBaseResponseHeaders(res)
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const TOOL_CATALOG_GROUPS = [
  {
    id: 'conversation',
    label: 'Conversation',
    description: 'Queue messages, speak replies, and keep the live dialogue loop moving.',
    tools: ['send_message', 'speak'],
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Recall, inspect, write, merge, downgrade, and suppress personal memories.',
    tools: ['recall_memory', 'search_memory', 'probe_memory', 'upsert_memory', 'merge_memories', 'downgrade_memory', 'skip_recognition', 'skip_consolidation'],
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Search the web, fetch pages, and read browser-visible content.',
    tools: ['web_search', 'fetch_url', 'browser_read'],
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Read, list, create, update, and delete local workspace files.',
    tools: ['read_file', 'list_dir', 'write_file', 'delete_file', 'make_dir'],
  },
  {
    id: 'shell',
    label: 'Shell',
    description: 'Run commands and inspect or stop processes under the local security policy.',
    tools: ['exec_command', 'list_processes', 'kill_process'],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Track tasks, update steps, review work, run reminders, and schedule prefetch jobs.',
    tools: ['set_task', 'update_task_step', 'complete_task', 'review_work', 'review_verdict', 'complete_startup_self_check', 'set_tick_interval', 'manage_reminder', 'manage_prefetch_task'],
  },
  {
    id: 'ui',
    label: 'UI Cards',
    description: 'Open, update, hide, register, and patch Jarvis UI panels and mode surfaces.',
    tools: ['ui_show', 'ui_update', 'ui_hide', 'ui_patch'],
  },
  {
    id: 'media',
    label: 'Media Lab',
    description: 'Generate lyrics, music, images, videos, and control the local media workbench.',
    tools: ['generate_lyrics', 'generate_music', 'generate_image', 'generate_video', 'music'],
  },
  {
    id: 'system',
    label: 'System',
    description: 'Change identity, location, rules, security posture, and account connectors.',
    tools: ['set_location', 'set_agent_name', 'set_security', 'manage_rule', 'connect_wechat'],
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Delegate work to approved sub-agents and manage delegation grants.',
    tools: ['delegate_to_agent', 'grant_agent_delegation'],
  },
  {
    id: 'tool_factory',
    label: 'Tool Factory',
    description: 'Find, install, uninstall, list, and manage local extension tools.',
    tools: ['find_tool', 'install_tool', 'uninstall_tool', 'list_tools', 'manage_tool_factory'],
  },
]

function isConfiguredFlag(value) {
  if (value && typeof value === 'object') return !!value.configured
  return !!value
}

function hasTTSConfigValue(tts, key) {
  return isConfiguredFlag(tts?.[key])
}

function compactDescription(value = '', maxLength = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

function schemaDescription(name) {
  const schema = TOOL_SCHEMAS?.[name]?.function
  return compactDescription(schema?.description || '')
}

function compactTool(name, source = 'builtin', extra = {}) {
  return {
    name,
    source,
    description: compactDescription(extra.description || schemaDescription(name) || ''),
  }
}

function groupReadiness(id, context) {
  const memoryCount = Number(context.memoryCount || 0)
  const webReady = !!(
    context.webSearch.serperConfigured
    || context.webSearch.jinaConfigured
    || context.webSearch.braveConfigured
    || context.webSearch.tavilyConfigured
    || context.webSearch.effectiveSearxngUrl
    || context.webSearch.fallbackAvailable
  )
  const ttsReady = context.tts.ttsProvider === 'jarvis'
    ? true
    : context.tts.ttsProvider === 'system'
    ? hasTTSConfigValue(context.tts, 'systemKey')
    : context.tts.ttsProvider === 'doubao'
      ? hasTTSConfigValue(context.tts, 'doubaoKey') || hasTTSConfigValue(context.tts, 'doubaoAccessKey')
      : !!(
        hasTTSConfigValue(context.tts, 'minimaxKey')
        || hasTTSConfigValue(context.tts, 'openaiTtsKey')
        || hasTTSConfigValue(context.tts, 'elevenLabsKey')
        || (hasTTSConfigValue(context.tts, 'volcanoAppId') && hasTTSConfigValue(context.tts, 'volcanoToken'))
      )
  const socialReady = Object.values(context.social || {}).some(isConfiguredFlag)

  switch (id) {
    case 'conversation':
      return {
        status: ttsReady ? 'ready' : 'degraded',
        note: ttsReady
          ? (context.tts.ttsProvider === 'jarvis' ? 'Jarvis local voice ready' : context.tts.ttsProvider === 'system' ? 'Local system speech ready' : 'Cloud TTS ready')
          : 'TTS provider not configured',
      }
    case 'memory':
      return {
        status: context.embedding.configured ? 'ready' : 'degraded',
        note: `${memoryCount} memories / ${context.embedding.provider || 'unknown'} vectors`,
      }
    case 'web':
      return {
        status: webReady ? 'ready' : 'blocked',
        note: webReady
          ? `Search via ${(context.webSearch.fallbackEngines || []).join('/') || 'configured provider'}`
          : 'No search provider available',
      }
    case 'files':
      return {
        status: context.security.fileSandbox ? 'ready' : 'degraded',
        note: context.security.fileSandbox ? 'File sandbox on' : 'File sandbox disabled',
      }
    case 'shell':
      return {
        status: context.security.execSandbox ? 'ready' : 'degraded',
        note: context.security.execSandbox ? 'Exec sandbox on' : 'Exec sandbox disabled',
      }
    case 'media':
      return {
        status: context.seedance.configured ? 'ready' : 'degraded',
        note: context.seedance.configured ? `Video model ${context.seedance.model}` : 'Video generation key missing',
      }
    case 'system':
      return {
        status: socialReady ? 'ready' : 'degraded',
        note: socialReady ? 'Connector credentials present' : 'Social connectors not configured',
      }
    default:
      return { status: 'ready', note: 'Local core tool' }
  }
}

function configuredFlag(value) {
  if (value && typeof value === 'object') return !!value.configured
  return !!value
}

function missingVoiceFields(provider, voice) {
  if (provider === 'local' || provider === 'whisper') return []
  const map = {
    aliyun: [['aliyunApiKey', 'API Key']],
    tencent: [['tencentSecretId', 'SecretId'], ['tencentSecretKey', 'SecretKey']],
    xunfei: [['xunfeiAppId', 'AppID'], ['xunfeiApiKey', 'APIKey'], ['xunfeiApiSecret', 'APISecret']],
    volcengine: [['volcAsrApiKey', 'API Key'], ['volcAsrResourceId', 'Resource ID']],
  }
  return (map[provider] || map.aliyun)
    .filter(([key]) => !configuredFlag(voice?.[key]))
    .map(([, label]) => label)
}

function missingTTSFields(provider, tts) {
  if (provider === 'jarvis') return []
  if (provider === 'system') return []
  if (provider === 'doubao') {
    return configuredFlag(tts?.doubaoKey) || configuredFlag(tts?.doubaoAccessKey) ? [] : ['API Key or Access Key']
  }
  const map = {
    minimax: [['minimaxKey', 'API Key']],
    openai: [['openaiTtsKey', 'API Key']],
    elevenlabs: [['elevenLabsKey', 'API Key']],
    volcano: [['volcanoAppId', 'AppId'], ['volcanoToken', 'Token']],
  }
  return (map[provider] || [])
    .filter(([key]) => !configuredFlag(tts?.[key]))
    .map(([, label]) => label)
}

const SOCIAL_CONFIG_KEYS = [
  'DISCORD_BOT_TOKEN',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFICATION_TOKEN',
  'WECHAT_OFFICIAL_APP_ID',
  'WECHAT_OFFICIAL_APP_SECRET',
  'WECHAT_OFFICIAL_TOKEN',
  'WECOM_BOT_KEY',
  'WECOM_INCOMING_TOKEN',
]

function parseStructuredSecrets(text = '') {
  const raw = String(text || '')
  const found = {}
  const assignRe = /([A-Z][A-Z0-9_]{2,})\s*[:=]\s*["']?([^"'\r\n,;]+)/g
  let match
  while ((match = assignRe.exec(raw)) !== null) {
    found[match[1]] = match[2].trim()
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' || typeof value === 'number') found[key] = String(value).trim()
      }
    }
  } catch {}
  return found
}

function detectDeepSeekIntake(text = '', explicitKey = '') {
  const raw = String(text || '')
  const key = String(explicitKey || '').trim()
    || raw.match(/(?:deepseek|deep\s*seek|DeepSeek)[\s\S]{0,120}?(sk-[A-Za-z0-9_\-.]{20,})/i)?.[1]
    || (/^\s*sk-[A-Za-z0-9_\-.]{20,}\s*$/.test(raw) ? raw.trim() : '')
  if (!key) return null
  const model = raw.match(/\bdeepseek-[A-Za-z0-9_.-]+\b/i)?.[0] || 'deepseek-v4-pro'
  return { apiKey: key, model }
}

function extractSocialUpdates(text = '') {
  const parsed = parseStructuredSecrets(text)
  const updates = {}
  for (const key of SOCIAL_CONFIG_KEYS) {
    const value = String(parsed[key] || '').trim()
    if (value) updates[key] = value
  }
  return updates
}

async function applyKeyIntake({ text = '', mode = 'auto', apiKey = '', model = '', baseURL = '' } = {}, onActivatedCallback = null) {
  const rawText = String(text || '')
  const normalizedMode = String(mode || 'auto').toLowerCase()
  const applied = []
  const errors = []

  if (normalizedMode === 'auto' || normalizedMode === 'deepseek') {
    const deepseek = detectDeepSeekIntake(rawText, apiKey)
    if (deepseek) {
      try {
        const info = await activateLLM({
          provider: 'deepseek',
          apiKey: deepseek.apiKey,
          model: model || deepseek.model || 'deepseek-v4-pro',
          baseURL,
        })
        emitEvent('activated', info)
        if (typeof onActivatedCallback === 'function') {
          try { onActivatedCallback() } catch (err) { console.error('[API] key intake onActivated callback error:', err) }
        }
        applied.push({ service: 'deepseek', label: 'DeepSeek', model: info.model || model || deepseek.model || 'deepseek-v4-pro' })
      } catch (err) {
        errors.push({ service: 'deepseek', error: err.message || String(err) })
      }
    }
  }

  if (normalizedMode === 'auto' || normalizedMode === 'seedance') {
    const detectedSeedance = detectSeedanceConfig(rawText)
    const seedanceKey = String(apiKey || '').trim()
    if (detectedSeedance || (normalizedMode === 'seedance' && seedanceKey)) {
      try {
        const cfg = setSeedanceConfig({
          apiKey: detectedSeedance?.apiKey || seedanceKey,
          model: model || detectedSeedance?.model,
          baseURL,
        })
        applied.push({ service: 'seedance', label: 'Seedance', model: cfg.model, configured: !!cfg.configured })
      } catch (err) {
        errors.push({ service: 'seedance', error: err.message || String(err) })
      }
    }
  }

  if (normalizedMode === 'auto' || normalizedMode === 'social') {
    const socialUpdates = extractSocialUpdates(rawText)
    if (Object.keys(socialUpdates).length > 0) {
      try {
        setSocialConfig(socialUpdates)
        await Promise.allSettled(Object.keys(socialUpdates).map((key) => restartConnector(key)))
        applied.push({ service: 'social', label: '社交接入', fields: Object.keys(socialUpdates) })
      } catch (err) {
        errors.push({ service: 'social', error: err.message || String(err) })
      }
    }
  }

  if (normalizedMode === 'auto') {
    try {
      const result = await tryAutoConfigureKey(rawText)
      if (result?.ok) applied.push({ service: result.service || 'auto', label: result.provider || '自动识别', hasTTS: !!result.hasTTS })
      else if (result && result.ok === false) errors.push({ service: 'auto', error: result.error || '自动识别失败' })
    } catch (err) {
      errors.push({ service: 'auto', error: err.message || String(err) })
    }
  }

  return {
    ok: applied.length > 0 && errors.length === 0,
    partial: applied.length > 0 && errors.length > 0,
    applied,
    errors,
    readiness: buildReadinessReport(),
  }
}

function buildReadinessReport() {
  const db = getDB()
  const { n: memoryCount = 0 } = db.prepare('SELECT COUNT(*) as n FROM memories').get() || {}
  const activation = getActivationStatus()
  const settings = config.toJSON?.() || {}
  const voice = getVoiceConfig()
  const voiceCfg = voice || {}
  const voiceProvider = voiceCfg.voiceProvider || 'local'
  const localVoiceStatus = getVoiceStatus()
  const voiceMissing = missingVoiceFields(voiceProvider, voiceCfg)
  if (voiceProvider === 'local' || voiceProvider === 'whisper') {
    if (!localVoiceStatus.available || !localVoiceStatus.runtimeAvailable) voiceMissing.push('local runtime')
    if (!localVoiceStatus.modelAvailable) voiceMissing.push('Whisper model')
  }
  const tts = getTTSConfig()
  const ttsProvider = tts.ttsProvider || tts.provider || 'jarvis'
  const ttsMissing = missingTTSFields(ttsProvider, tts)
  const webSearch = getWebSearchConfig()
  const embedding = getEmbeddingConfig()
  const seedance = getSeedanceConfig()
  const social = getSocialConfig()
  const security = getSecurity()
  const traces = getTraceStatus()
  const grokBuild = getGrokBuildStatus()
  const toolCatalog = buildCapabilityCatalog()
  const searchReady = !!(
    webSearch.serperConfigured
    || webSearch.jinaConfigured
    || webSearch.braveConfigured
    || webSearch.tavilyConfigured
    || webSearch.effectiveSearxngUrl
    || webSearch.fallbackAvailable
  )
  const ttsLocalReady = ttsProvider === 'jarvis' && ttsMissing.length === 0
  const ttsCloudReady = ttsProvider !== 'jarvis' && ttsProvider !== 'system' && ttsMissing.length === 0
  const ttsNativeReady = ttsProvider === 'system' && ttsMissing.length === 0 && configuredFlag(tts.systemKey)
  const socialReady = Object.values(social || {}).some(configuredFlag)
  const toolsReady = Number(toolCatalog.summary?.totalTools || 0) > 0
  const capabilities = {
    core: { ready: isRunning(), memoryCount },
    deepseek: {
      ready: !!activation.activated,
      provider: activation.provider || settings?.llm?.provider || null,
      model: activation.model || settings?.llm?.model || settings?.providers?.deepseek?.model || null,
    },
    asr: {
      ready: voiceMissing.length === 0,
      provider: voiceProvider,
      missing: voiceMissing,
      localRuntimeAvailable: !!localVoiceStatus.runtimeAvailable,
      localModelAvailable: !!localVoiceStatus.modelAvailable,
      localModel: localVoiceStatus.model || '',
    },
    tts: {
      ready: ttsLocalReady || ttsCloudReady || ttsNativeReady,
      localReady: ttsLocalReady,
      cloudReady: ttsCloudReady,
      nativeReady: ttsNativeReady,
      provider: ttsProvider,
      voiceId: tts.ttsVoiceId || '',
      missing: ttsMissing,
      systemFallbackAvailable: false,
    },
    memory: { ready: memoryCount > 0, count: memoryCount },
    search: { ready: searchReady, fallbackAvailable: !!webSearch.fallbackAvailable, fallbackEngines: webSearch.fallbackEngines || [] },
    vector: { ready: !!embedding.configured, provider: embedding.provider || '', model: embedding.model || '' },
    seedance: { ready: !!seedance.configured, model: seedance.model || '' },
    tools: {
      ready: toolsReady,
      groups: toolCatalog.summary?.totalGroups || 0,
      total: toolCatalog.summary?.totalTools || 0,
      degradedGroups: toolCatalog.summary?.degradedGroups || 0,
      blockedGroups: toolCatalog.summary?.blockedGroups || 0,
    },
    social: { ready: socialReady },
    security: { fileSandbox: !!security.fileSandbox, execSandbox: !!security.execSandbox },
    traces: { ready: !!traces?.enabled, status: traces },
    grokBuild: {
      ready: !!grokBuild.available && !!activation.activated,
      installed: !!grokBuild.available,
      model: 'DeepSeek V4 Pro',
      storagePolicy: grokBuild.storagePolicy,
    },
  }
  const blockers = []
  const optionalMissing = []
  if (!capabilities.deepseek.ready) blockers.push('DeepSeek is not activated')
  if (!capabilities.asr.ready) blockers.push(`ASR(${voiceProvider}) missing ${voiceMissing.join(' / ')}`)
  if (!capabilities.tts.ready) blockers.push(`TTS(${ttsProvider}) missing ${ttsMissing.join(' / ')}`)
  if (!capabilities.search.ready) blockers.push('Web search is not configured')
  if (!capabilities.vector.ready) blockers.push('Vector memory is not configured')
  if (!capabilities.tools.ready) blockers.push('Local tool catalog is empty or unavailable')
  if (!(capabilities.security.fileSandbox && capabilities.security.execSandbox)) blockers.push('Security sandbox is not fully enabled')
  if (!capabilities.seedance.ready) optionalMissing.push('Seedance video generation is not configured')
  if (!capabilities.social.ready) optionalMissing.push('Social connectors are not configured')

  const requiredReady = capabilities.core.ready
    && capabilities.deepseek.ready
    && capabilities.asr.ready
    && capabilities.tts.ready
    && capabilities.memory.ready
    && capabilities.search.ready
    && capabilities.vector.ready
    && capabilities.tools.ready
    && capabilities.security.fileSandbox
    && capabilities.security.execSandbox
    && capabilities.traces.ready
  const fullReady = requiredReady && blockers.length === 0

  return {
    ok: capabilities.core.ready && capabilities.memory.ready,
    coreOk: capabilities.core.ready && capabilities.memory.ready,
    fullReady,
    generatedAt: new Date().toISOString(),
    capabilities,
    blockers,
    optionalMissing,
  }
}

function buildCapabilityCatalog() {
  const db = getDB()
  const { n: memoryCount = 0 } = db.prepare('SELECT COUNT(*) as n FROM memories').get() || {}
  const context = {
    memoryCount,
    webSearch: getWebSearchConfig(),
    embedding: getEmbeddingConfig(),
    seedance: getSeedanceConfig(),
    security: getSecurity(),
    social: getSocialConfig(),
    tts: getTTSConfig(),
  }
  const builtinNames = new Set(Object.keys(TOOL_SCHEMAS || {}))
  const groups = TOOL_CATALOG_GROUPS.map((group) => {
    const readiness = groupReadiness(group.id, context)
    const tools = group.tools.map((name) => compactTool(name)).filter((tool) => builtinNames.has(tool.name))
    return {
      ...group,
      ...readiness,
      tools,
      toolCount: tools.length,
    }
  })

  const groupedNames = new Set(groups.flatMap(group => group.tools.map(tool => tool.name)))
  const ungroupedTools = [...builtinNames]
    .filter(name => !groupedNames.has(name))
    .sort()
    .map(name => compactTool(name))
  if (ungroupedTools.length) {
    groups.push({
      id: 'other',
      label: 'Other Core Tools',
      description: 'Additional callable tools registered in the local Jarvis core.',
      status: 'ready',
      note: 'Registered in local schemas',
      tools: ungroupedTools,
      toolCount: ungroupedTools.length,
    })
  }

  const installedTools = listInstalledTools()
    .map(tool => compactTool(tool.name, tool.source || 'installed', { description: tool.description }))
  if (installedTools.length) {
    groups.push({
      id: 'installed',
      label: 'Installed Extensions',
      description: 'User-installed local tools loaded through Jarvis tool factory.',
      status: 'ready',
      note: `${installedTools.length} installed`,
      tools: installedTools,
      toolCount: installedTools.length,
    })
  }

  const counts = groups.reduce((acc, group) => {
    acc[group.status] = (acc[group.status] || 0) + 1
    acc.totalTools += group.toolCount
    return acc
  }, { ready: 0, degraded: 0, blocked: 0, totalTools: 0 })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalGroups: groups.length,
      totalTools: counts.totalTools,
      readyGroups: counts.ready || 0,
      degradedGroups: counts.degraded || 0,
      blockedGroups: counts.blocked || 0,
      builtinTools: builtinNames.size,
      installedTools: installedTools.length,
    },
    context: {
      memoryCount,
      webSearchReady: groupReadiness('web', context).status !== 'blocked',
      vectorReady: !!context.embedding.configured,
      seedanceReady: !!context.seedance.configured,
      security: {
        fileSandbox: !!context.security.fileSandbox,
        execSandbox: !!context.security.execSandbox,
      },
    },
    groups,
  }
}

function getRequestCharset(contentType = '') {
  const match = String(contentType || '').match(/(?:^|;)\s*charset\s*=\s*"?([^";\s]+)"?/i)
  return match?.[1]?.trim().toLowerCase() || ''
}

function decodeRequestBody(buffer, contentType = '') {
  if (!buffer || buffer.length === 0) return ''

  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.slice(3).toString('utf8')
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.slice(2).toString('utf16le')
  }
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    try { return new TextDecoder('utf-16be').decode(buffer.slice(2)) } catch {}
  }

  const charset = getRequestCharset(contentType)
  if (charset === 'utf8' || charset === 'utf-8' || charset === '') {
    const decoded = buffer.toString('utf8')
    if (!charset && decoded.includes('\uFFFD')) {
      try {
        const fallback = new TextDecoder('gbk', { fatal: true }).decode(buffer)
        if (fallback && !fallback.includes('\uFFFD')) return fallback
      } catch {}
    }
    return decoded
  }
  if (charset === 'utf16le' || charset === 'utf-16le' || charset === 'ucs-2' || charset === 'utf16') {
    return buffer.toString('utf16le')
  }

  try {
    return new TextDecoder(charset, { fatal: true }).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = decodeRequestBody(Buffer.concat(chunks), req.headers['content-type'])
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.webm':
      return 'video/webm'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'text/plain; charset=utf-8'
  }
}

function getAgentName() {
  return (getConfig('agent_name') || '').trim() || DEFAULT_AGENT_NAME
}

function validateAgentName(agentName) {
  const trimmedName = String(agentName || '').trim()
  if (!trimmedName) return ''
  if (trimmedName.length > 32) {
    throw new Error('AI 名字不能超过 32 个字符')
  }
  if (!/^[一-龥A-Za-z0-9 _-]+$/.test(trimmedName)) {
    throw new Error('AI 名字只允许中文、英文字母、数字、空格、下划线、短横线')
  }
  return trimmedName
}

function publicActivationInfo(info) {
  return {
    provider: info.provider,
    model: info.model,
    models: info.models,
  }
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function publicReminder(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    dueAt: row.due_at,
    task: row.task,
    status: row.status,
    source: row.source || '',
    recurrenceType: row.recurrence_type || null,
    recurrenceConfig: safeJsonParse(row.recurrence_config, null),
    createdAt: row.created_at || null,
  }
}

function buildReminderSystemMessage(targetId, taskText) {
  return `I am the system. Based on the reminder you set, you now need to perform this task for user ${targetId}: ${taskText}. Handle it immediately, and when needed use send_message to send the result to ${targetId}.`
}

function parseReminderDueAt(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('dueAt is required')
  }
  const dueAt = new Date(value.trim())
  if (Number.isNaN(dueAt.getTime())) {
    throw new Error('dueAt must be a valid absolute time')
  }
  if (dueAt.getTime() <= Date.now()) {
    throw new Error('提醒时间必须晚于当前时间')
  }
  return dueAt.toISOString()
}

function publicTaskKnowledge(row = {}) {
  return {
    id: row.id,
    memId: row.mem_id || '',
    title: row.title || '',
    content: row.content || '',
    detail: row.detail || '',
    tags: safeJsonParse(row.tags, []),
    timestamp: row.timestamp || row.created_at || null,
    salience: row.salience ?? null,
  }
}

function publicPrefetchTask(row = {}) {
  return {
    id: row.id,
    source: row.source || '',
    label: row.label || row.source || '',
    url: row.url || '',
    ttlMinutes: row.ttl_minutes,
    tags: safeJsonParse(row.tags, []),
    enabled: row.enabled !== 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

function stripAssistantHistoryLabels(content) {
  return String(content || '')
    .trim()
    .replace(/^(?:\s*\[assistant(?:\s+to\s+[^\]\r\n]+)?(?:\s+\d{4}-\d{2}-\d{2}T[^\]\r\n]+)?\]\s*)+/giu, '')
    .trim()
}

export function startAPI(port = 3721, { getStateSnapshot = null, onActivated = null } = {}) {
  const onActivatedCallback = onActivated
  const host = getApiHost()
  let pendingActivation = null

  function storePreparedActivation({ apiKey, info }) {
    pendingActivation = {
      token: crypto.randomUUID(),
      apiKey: String(apiKey || '').trim(),
      info,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }
    return pendingActivation
  }

  function getPreparedActivation(token, apiKey) {
    if (!pendingActivation) return null
    if (pendingActivation.expiresAt <= Date.now()) {
      pendingActivation = null
      return null
    }
    if (!token || pendingActivation.token !== token) return null
    if (pendingActivation.apiKey !== String(apiKey || '').trim()) return null
    return pendingActivation
  }

  // 启动时把 DB 里的当前 agent_name 写进 sticky，
  // 这样后续每个新连上的 SSE 客户端（含 Jarvis 工作台首次加载）能立即拿到正确名字
  try {
    const storedName = (getConfig('agent_name') || '').trim()
    if (storedName) setStickyEvent('agent_name_updated', { name: storedName })
  } catch {}
  const server = http.createServer(async (req, res) => {
    const base = `http://localhost:${port}`
    setBaseResponseHeaders(res)
    let url
    try {
      url = new URL(req.url, base)
    } catch {
      return jsonResponse(res, 400, { ok: false, error: 'invalid request URL' })
    }
    const origin = req.headers.origin

    // GET /social/wechat-clawbot/qr — get current QR code status and URL
    if (req.method === 'GET' && url.pathname === '/social/wechat-clawbot/qr') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, ...getClawbotQR() })
    }

    // POST /social/wechat-clawbot/logout — clear credentials and disconnect
    if (req.method === 'POST' && url.pathname === '/social/wechat-clawbot/logout') {
      if (!requireLocalOrToken(req, res, url)) return
      logoutClawbot()
      emitEvent('social_status', { platform: 'wechat-clawbot', status: 'idle' })
      return jsonResponse(res, 200, { ok: true })
    }

    if (isSocialWebhookPath(url.pathname)) {
      return handleSocialWebhook(req, res, url)
    }

    if (origin && !isAllowedOrigin(origin)) {
      return jsonResponse(res, 403, { ok: false, error: 'forbidden origin' })
    }

    if (!hasAllowedAccess(req, url)) {
      return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
    }

    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || 'null')
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method !== 'OPTIONS' && isSensitiveRequest(req.method, url.pathname) && !requireLocalOrToken(req, res, url)) return

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (!installRequestBodyGuard(req, res, url.pathname)) return

    // POST /message — send message to agent
    if (req.method === 'POST' && url.pathname === '/message') {
      try {
        if (!consumeRateLimit(req, 'message', 30, 60_000)) {
          res.setHeader('Retry-After', '60')
          return jsonResponse(res, 429, { ok: false, error: 'message rate limit exceeded' })
        }
        const body = await readJsonBody(req)
        const { from_id = 'ID:000001', content, channel = 'API' } = body
        if (typeof content !== 'string' || !content.trim()) return jsonResponse(res, 400, { error: 'content required' })
        const trimmed = content.trim()
        if (trimmed.length > 12_000) return jsonResponse(res, 413, { error: 'content exceeds 12000 characters' })
        const safeFromId = String(from_id || 'ID:000001').slice(0, 128)
        const safeChannel = String(channel || 'API').slice(0, 64)
        const activation = getActivationStatus()
        if (!activation.activated) {
          return jsonResponse(res, 409, {
            ok: false,
            code: 'LLM_NOT_ACTIVATED',
            error: 'DeepSeek 未激活：请先填写 API Key，Jarvis 才能实时对话。',
            activation: publicActivationInfo(activation),
          })
        }
        const voiceIgnore = getVoiceMessageIgnore(trimmed, safeChannel)
        if (voiceIgnore) return jsonResponse(res, 200, { ok: true, ignored: true, ...voiceIgnore })
        const strictEvaluation = body.strict_evaluation ?? body.strictEvaluation
          ?? (String(body.evaluation_mode || body.evaluationMode || '').toLowerCase() === 'strict' ? true : undefined)
        const forbiddenTools = body.forbidden_tools ?? body.forbiddenTools
        const meta = {}
        if (strictEvaluation !== undefined) meta.strictEvaluation = strictEvaluation
        if (Array.isArray(forbiddenTools)) {
          meta.forbiddenTools = forbiddenTools.slice(0, 64).map(tool => String(tool).slice(0, 128))
        }
        pushMessage(safeFromId, trimmed, safeChannel, meta)
        emitEvent('message_in', { from_id: safeFromId, content: trimmed, channel: safeChannel, timestamp: new Date().toISOString() })
        jsonResponse(res, 200, { ok: true, agent_name: getAgentName() })
      } catch (e) {
        jsonResponse(res, 400, { error: e.message })
      }
      return
    }

    // GET /events — SSE real-time event stream (outbound channel for bidirectional communication)
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`)
      flushStickyEvents(res)
      addSSEClient(res)
      const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n') } catch (_) { clearInterval(keepAlive); removeSSEClient(res) }
      }, 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        removeSSEClient(res)
      })
      return
    }

    // GET /memories?limit=20&search=keyword
    if (req.method === 'GET' && url.pathname === '/memories') {
      const db = getDB()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const search = url.searchParams.get('search')
      let rows
      if (search) {
        try {
          rows = db.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.id
            WHERE memories_fts MATCH ? AND m.visibility = 1
            ORDER BY bm25(memories_fts), m.created_at DESC LIMIT ?
          `).all(search, limit)
        } catch {
          rows = db.prepare(`
            SELECT * FROM memories
            WHERE (
              title LIKE ? OR mem_id LIKE ? OR content LIKE ? OR detail LIKE ?
              OR entities LIKE ? OR concepts LIKE ? OR tags LIKE ?
            )
            AND visibility = 1
            ORDER BY created_at DESC LIMIT ?
          `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit)
        }
      } else {
        rows = db.prepare('SELECT * FROM memories WHERE visibility = 1 ORDER BY created_at DESC LIMIT ?').all(limit)
      }
      jsonResponse(res, 200, rows)
      return
    }

    // GET /audit/recall?limit=50 — recent recall_audit rows (Memory-Optimization v0.1 Phase 0)
    if (req.method === 'GET' && url.pathname === '/audit/recall') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500)
      const rows = getRecentRecallAudits(limit).map(r => ({
        ...r,
        matched_mem_ids: safeJsonParse(r.matched_mem_ids, []),
        event_type_dist: safeJsonParse(r.event_type_dist, {}),
      }))
      jsonResponse(res, 200, rows)
      return
    }

    // GET /audit/extract?limit=50 — recent extract_audit rows
    if (req.method === 'GET' && url.pathname === '/audit/extract') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500)
      const rows = getRecentExtractAudits(limit).map(r => ({
        ...r,
        extracted_mem_ids: safeJsonParse(r.extracted_mem_ids, []),
        event_type_dist: safeJsonParse(r.event_type_dist, {}),
        skipped: !!r.skipped,
      }))
      jsonResponse(res, 200, rows)
      return
    }

    // GET /audit/stats?hours=168 — aggregate over last N hours (default 7 days)
    if (req.method === 'GET' && url.pathname === '/audit/stats') {
      const hours = Math.max(1, Math.min(parseInt(url.searchParams.get('hours') || '168'), 24 * 30))
      const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
      jsonResponse(res, 200, {
        windowHours: hours,
        sinceIso,
        recall: getRecallAuditStats({ sinceIso }) || {},
        extract: getExtractAuditStats({ sinceIso }) || {},
      })
      return
    }

    // GET /turn-trace, /turn-trace.html — 回合上下文取证页（逐回合回放每轮 messages[] 与思考）
    if (req.method === 'GET' && (url.pathname === '/turn-trace' || url.pathname === '/turn-trace.html')) {
      try {
        const html = fs.readFileSync(TURN_TRACE_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('turn-trace.html not found')
      }
      return
    }

    // GET /admin/traces?limit=80 — 最近 turn 摘要列表
    if (req.method === 'GET' && url.pathname === '/admin/traces') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '80'), 80)
      jsonResponse(res, 200, { ok: true, status: getTraceStatus(), traces: getTraces(limit) })
      return
    }

    // GET /admin/traces/:id — 单个 turn 完整记录（每轮 offset + 模型输出 + 最终 messages 快照）
    if (req.method === 'GET' && url.pathname.startsWith('/admin/traces/')) {
      const id = decodeURIComponent(url.pathname.slice('/admin/traces/'.length))
      const trace = getTrace(id)
      if (!trace) return jsonResponse(res, 404, { ok: false, error: 'trace not found' })
      jsonResponse(res, 200, { ok: true, trace })
      return
    }

    // POST /admin/traces-clear — 清空所有追踪记录（含落盘文件）
    if (req.method === 'POST' && url.pathname === '/admin/traces-clear') {
      jsonResponse(res, 200, clearTraces())
      return
    }

    // GET /conversations?limit=60 — chat history (ascending by time, most recent last)
    // Internal SYSTEM/APP_SIGNAL rows are hidden by default so UI-only signals
    // do not render as chat bubbles. Use includeSystemSignals=true for debugging.
    // The absorbed flag (dynamic memory pool 3.5) only filters main-line injection
    // in injector.js; here the operator needs to see everything for debugging.
    if (req.method === 'GET' && url.pathname === '/conversations') {
      const db = getDB()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 500)
      const includeSystemSignals = url.searchParams.get('includeSystemSignals') === 'true'
      const rows = db.prepare(`
        SELECT id, role, from_id, to_id, content, timestamp, channel, external_party_id, focus_absorbed, focus_topic, open_question
        FROM conversations
        WHERE (? OR NOT (from_id = 'SYSTEM' AND channel = 'APP_SIGNAL'))
        ORDER BY id DESC
        LIMIT ?
      `).all(includeSystemSignals ? 1 : 0, limit)
      jsonResponse(res, 200, rows.reverse().map(row => (
        row.role === 'jarvis'
          ? { ...row, content: stripAssistantHistoryLabels(row.content) }
          : row
      )))
      return
    }

    // GET /status
    if (req.method === 'GET' && url.pathname === '/status') {
      const db = getDB()
      const { n } = db.prepare('SELECT COUNT(*) as n FROM memories').get()
      jsonResponse(res, 200, { ok: true, memory_count: n, running: isRunning(), queue: getQueueSnapshot() })
      return
    }

    // GET /tasks/overview — Jarvis-native work surface state for reminders, task memory, and prefetch jobs.
    if (req.method === 'GET' && url.pathname === '/tasks/overview') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '12'), 60)
      const reminders = listPendingReminders(limit).map(publicReminder)
      const taskKnowledge = getTaskKnowledge(limit).map(publicTaskKnowledge)
      const prefetchTasks = listPrefetchTasks().slice(0, limit).map(publicPrefetchTask)
      jsonResponse(res, 200, {
        ok: true,
        reminders,
        taskKnowledge,
        prefetchTasks,
        queue: getQueueSnapshot(),
        totals: {
          reminders: reminders.length,
          taskKnowledge: taskKnowledge.length,
          prefetchTasks: prefetchTasks.length,
        },
      })
      return
    }

    // GET/POST /reminders — native reminder management for Jarvis work modules.
    if (url.pathname === '/reminders') {
      if (req.method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
        jsonResponse(res, 200, { ok: true, reminders: listPendingReminders(limit).map(publicReminder) })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const task = String(body.task || '').trim()
            if (!task) throw new Error('task is required')
            const userId = String(body.userId || body.user_id || PRIMARY_USER_ID).trim() || PRIMARY_USER_ID
            const dueAt = parseReminderDueAt(body.dueAt || body.due_at)
            const result = createReminder({
              userId,
              dueAt,
              task,
              systemMessage: buildReminderSystemMessage(userId, task),
              source: `ui:jarvis-work-surface@${new Date().toISOString()}`,
            })
            const id = Number(result.lastInsertRowid)
            emitEvent('reminder_created', { id, user_id: userId, due_at: dueAt, task })
            jsonResponse(res, 200, { ok: true, reminder: publicReminder(getReminderById(id)) })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // DELETE /reminders/:id — cancel a pending reminder.
    if (req.method === 'DELETE' && url.pathname.startsWith('/reminders/')) {
      const id = parseInt(url.pathname.split('/')[2])
      if (!id) return jsonResponse(res, 400, { ok: false, error: 'invalid id' })
      const existing = getReminderById(id)
      if (!existing) return jsonResponse(res, 404, { ok: false, error: `reminder #${id} not found` })
      if (existing.status !== 'pending') return jsonResponse(res, 400, { ok: false, error: `reminder #${id} is ${existing.status}` })
      const result = cancelReminder(id)
      if (!result.changes) return jsonResponse(res, 400, { ok: false, error: `failed to cancel reminder #${id}` })
      emitEvent('reminder_cancelled', { id, user_id: existing.user_id, task: existing.task })
      jsonResponse(res, 200, { ok: true, id })
      return
    }

    // GET /readiness — authoritative end-to-end capability readiness report
    if (req.method === 'GET' && url.pathname === '/readiness') {
      jsonResponse(res, 200, buildReadinessReport())
      return
    }

    // Grok Build ACP bridge: ordinary conversation remains on /message.
    if (req.method === 'GET' && url.pathname === '/grok-build/status') {
      jsonResponse(res, 200, getGrokBuildStatus())
      return
    }

    if (req.method === 'POST' && url.pathname === '/grok-build/tasks') {
      try {
        if (!consumeRateLimit(req, 'grok-build-task', 8, 60_000)) {
          res.setHeader('Retry-After', '60')
          return jsonResponse(res, 429, { ok: false, error: '工程任务提交过于频繁' })
        }
        const body = await readJsonBody(req)
        const task = startGrokBuildTask({ prompt: body.prompt, cwd: body.cwd })
        jsonResponse(res, 202, { ok: true, task })
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message || String(error) })
      }
      return
    }

    const permissionMatch = url.pathname.match(/^\/grok-build\/tasks\/([^/]+)\/permission$/)
    if (req.method === 'POST' && permissionMatch) {
      try {
        const body = await readJsonBody(req)
        const task = answerGrokBuildPermission({
          taskId: decodeURIComponent(permissionMatch[1]),
          decision: body.decision,
        })
        jsonResponse(res, 200, { ok: true, task })
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message || String(error) })
      }
      return
    }

    const cancelMatch = url.pathname.match(/^\/grok-build\/tasks\/([^/]+)\/cancel$/)
    if (req.method === 'POST' && cancelMatch) {
      try {
        const task = cancelGrokBuildTask(decodeURIComponent(cancelMatch[1]))
        jsonResponse(res, 200, { ok: true, task })
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message || String(error) })
      }
      return
    }

    // GET /capabilities — local Jarvis tool catalog + readiness by capability group
    if (req.method === 'GET' && url.pathname === '/capabilities') {
      jsonResponse(res, 200, buildCapabilityCatalog())
      return
    }

    // GET /quota
    if (req.method === 'GET' && url.pathname === '/quota') {
      jsonResponse(res, 200, getQuotaStatus())
      return
    }

    // GET /hotspots — unified trending data, 30-minute cache by default
    if (req.method === 'GET' && url.pathname === '/hotspots') {
      getHotspots({
        force: /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || ''),
        viewed: /^(1|true|yes)$/i.test(url.searchParams.get('viewed') || ''),
      })
        .then((hotspots) => jsonResponse(res, 200, hotspots))
        .catch((err) => jsonResponse(res, 502, {
          ok: false,
          error: err.message,
          refreshMinutes: 30,
          platforms: {},
        }))
      return
    }

    // GET /ai-news - curated AI HOT items with verified original article URLs.
    if (req.method === 'GET' && url.pathname === '/ai-news') {
      getAiNews({ force: /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || '') })
        .then((news) => jsonResponse(res, 200, news))
        .catch((err) => jsonResponse(res, 502, {
          ok: false,
          error: err.message,
          source: 'AI HOT',
          items: [],
        }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/settings/ai-hot') {
      jsonResponse(res, 200, { ok: true, aiHot: getAiHotConfig() })
      return
    }

    if (req.method === 'POST' && url.pathname === '/settings/ai-hot') {
      readJsonBody(req)
        .then((body) => jsonResponse(res, 200, { ok: true, aiHot: setAiHotConfig(body) }))
        .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    if (url.pathname === '/hotspot-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getHotspotPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setHotspotPanelState({ active, source: body.source || 'jarvis-workbench' })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // GET /worldcup — World Cup schedule/scores/standings (zhibo8, live-aware cache)
    if (req.method === 'GET' && url.pathname === '/worldcup') {
      getWorldcup({
        force: /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || ''),
        viewed: /^(1|true|yes)$/i.test(url.searchParams.get('viewed') || ''),
      })
        .then((worldcup) => jsonResponse(res, 200, worldcup))
        .catch((err) => jsonResponse(res, 502, {
          ok: false,
          error: err.message,
          matches: [],
          standings: {},
        }))
      return
    }

    if (url.pathname === '/worldcup-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getWorldcupPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setWorldcupPanelState({ active, source: body.source || 'jarvis-workbench' })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // GET /doc-panel-state — document panel state
    // POST /doc-panel-state — set document panel state { active, topicId, source }
    if (url.pathname === '/doc-panel-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getDocPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setDocPanelState({ active, topicId: body.topicId || null, source: body.source || 'jarvis-workbench' })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // GET /docs/:topicId — get content for a specific document topic
    if (req.method === 'GET' && url.pathname.startsWith('/docs/')) {
      const topicId = url.pathname.slice(6)
      const doc = DOC_TOPICS[topicId]
      if (!doc) {
        jsonResponse(res, 404, { ok: false, error: `unknown topic: ${topicId}` })
        return
      }
      jsonResponse(res, 200, { ok: true, doc })
      return
    }

    // GET /docs — list all document topics
    if (req.method === 'GET' && url.pathname === '/docs') {
      const topics = Object.values(DOC_TOPICS).map(({ id, title, subtitle, icon, summary }) => ({ id, title, subtitle, icon, summary }))
      jsonResponse(res, 200, { ok: true, topics })
      return
    }

    if (req.method === 'GET' && url.pathname === '/person-card') {
      const name = url.searchParams.get('name') || url.searchParams.get('q') || ''
      jsonResponse(res, 200, { ok: true, card: getPersonCard(name) })
      return
    }

    if (url.pathname === '/person-card-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getPersonCardPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setPersonCardPanelState({
              active,
              source: body.source || 'jarvis-workbench',
              card: body.card || null,
              name: body.name || '',
            })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    if (req.method === 'GET' && url.pathname === '/system-prompt-preview') {
      Promise.resolve()
        .then(() => buildHeartbeatSystemPromptPreview({
          stateSnapshot: typeof getStateSnapshot === 'function' ? getStateSnapshot() : {},
        }))
        .then((preview) => jsonResponse(res, 200, preview))
        .catch((err) => jsonResponse(res, 500, { error: err.message }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/agent-profile') {
      jsonResponse(res, 200, { name: getAgentName() })
      return
    }

    // GET /media/history?limit=30
    if (req.method === 'GET' && url.pathname === '/media/history') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
      jsonResponse(res, 200, getMediaHistory(limit))
      return
    }

    // GET /settings/seedance — read AI video generation config status (plaintext key not returned)
    if (req.method === 'GET' && url.pathname === '/settings/seedance') {
      const cfg = getSeedanceConfig()
      jsonResponse(res, 200, {
        ok: true,
        seedance: {
          configured: !!cfg.configured,
          model: cfg.model,
          baseURL: cfg.baseURL,
        },
      })
      return
    }

    // POST /settings/seedance — save Firefly/Seedance video generation config
    if (req.method === 'POST' && url.pathname === '/settings/seedance') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const cfg = setSeedanceConfig({
            apiKey: body.apiKey,
            model: body.model,
            baseURL: body.baseURL,
          })
          jsonResponse(res, 200, {
            ok: true,
            seedance: {
              configured: !!cfg.configured,
              model: cfg.model,
              baseURL: cfg.baseURL,
            },
          })
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      return
    }

    // POST /settings/key-intake — paste API key text and route known services.
    if (req.method === 'POST' && url.pathname === '/settings/key-intake') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = await applyKeyIntake(body, onActivatedCallback)
          jsonResponse(res, result.applied.length ? 200 : 400, result)
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      return
    }

    // POST /media/history — { kind, url, title, videoId, platform }
    if (req.method === 'POST' && url.pathname === '/media/history') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          if (!body.url || !body.kind) return jsonResponse(res, 400, { ok: false, error: 'url and kind required' })
          upsertMediaHistory(body)
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      return
    }

    // POST /aivideo/generate — 面板内“生成”按钮直连后端，绕开 LLM。
    // body: { prompt, images?[url1,url2](data:base64/http；1 张=图生、2 张=首尾帧), image_url?(单图兼容), ratio?, resolution?, duration? }
    // execGenerateVideo 会 emit aivideo_mode 事件并后台轮询，面板自行更新。
    if (req.method === 'POST' && url.pathname === '/aivideo/generate') {
      const chunks = []
      let size = 0
      let responded = false
      const respond = (code, payload) => { if (responded) return; responded = true; jsonResponse(res, code, payload) }
      req.on('data', c => {
        size += c.length
        if (size > 30 * 1024 * 1024) {  // 30MB 上限（含 base64 图片）
          respond(413, { ok: false, error: '请求体过大（图片请控制在约 18MB 以内）' })
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', async () => {
        if (responded) return
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const result = await execGenerateVideo({
            action: 'generate',
            prompt: body.prompt,
            images: Array.isArray(body.images) ? body.images : undefined,
            image_url: body.image_url || body.image,
            ratio: body.ratio,
            resolution: body.resolution,
            duration: body.duration,
          })
          const parsed = typeof result === 'string' ? JSON.parse(result) : result
          respond(parsed.ok ? 200 : 400, parsed)
        } catch (e) {
          respond(400, { ok: false, error: e.message })
        }
      })
      req.on('error', () => respond(400, { ok: false, error: 'request error' }))
      return
    }

    // POST /aivideo/draft — 面板把当前「开关状态 + 提示词草稿」实时同步给后端（感知通道）。
    // 后端只存内存状态，供注入器每轮贴进 agent 上下文。极轻量、不落库。
    if (req.method === 'POST' && url.pathname === '/aivideo/draft') {
      const chunks = []
      let size = 0
      req.on('data', c => {
        size += c.length
        if (size > 256 * 1024) { req.destroy(); return }  // 草稿是纯文本，256KB 足够
        chunks.push(c)
      })
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          setAIVideoPanelState({ open: body.open, prompt: body.prompt })
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      req.on('error', () => { try { jsonResponse(res, 400, { ok: false, error: 'request error' }) } catch {} })
      return
    }

    // POST /aivideo/save — 把生成的视频复制到「下载\AI视频生成保存的视频\日期\」
    if (req.method === 'POST' && url.pathname === '/aivideo/save') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const result = saveGeneratedVideo(body.jobId)
          jsonResponse(res, result.ok ? 200 : 400, result)
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      return
    }

    // GET /aivideo/history — 面板打开时拉取已完成视频历史，重建生成栏队列（修复关闭重开后历史丢失）
    if (req.method === 'GET' && url.pathname === '/aivideo/history') {
      try {
        jsonResponse(res, 200, { ok: true, jobs: getVideoHistory() })
      } catch (e) {
        jsonResponse(res, 200, { ok: false, jobs: [], error: e.message })
      }
      return
    }

    // GET /favicon.ico ? silence the browser's automatic favicon request
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }

    // DELETE /memories/:id — delete a memory
    if (req.method === 'DELETE' && url.pathname.startsWith('/memories/')) {
      const id = parseInt(url.pathname.split('/')[2])
      if (!id) return jsonResponse(res, 400, { error: 'invalid id' })
      const db = getDB()
      db.prepare('DELETE FROM memories WHERE id = ?').run(id)
      jsonResponse(res, 200, { ok: true })
      return
    }

    // PATCH /memories/:id — update memory content/detail
    if (req.method === 'PATCH' && url.pathname.startsWith('/memories/')) {
      const id = parseInt(url.pathname.split('/')[2])
      if (!id) return jsonResponse(res, 400, { error: 'invalid id' })
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { content, detail } = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const db = getDB()
          if (content !== undefined) db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, id)
          if (detail !== undefined) db.prepare('UPDATE memories SET detail = ? WHERE id = ?').run(detail, id)
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { error: e.message })
        }
      })
      return
    }

    // GET /media/music/:filename — serve musicDir audio files (avoids file:// cross-origin restriction)
    if (req.method === 'GET' && url.pathname.startsWith('/media/music/')) {
      const raw = url.pathname.slice('/media/music/'.length)
      const filename = path.basename(decodeURIComponent(raw))
      const filePath = path.join(paths.musicDir, filename)
      const resolvedFile = path.resolve(filePath)
      const resolvedDir  = path.resolve(paths.musicDir)
      if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        res.writeHead(403); res.end('forbidden'); return
      }
      const mimeMap = {
        '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
        '.aac': 'audio/aac',  '.ogg': 'audio/ogg',   '.m4a': 'audio/mp4',
        '.opus': 'audio/ogg; codecs=opus',
      }
      const contentType = mimeMap[path.extname(filename).toLowerCase()] || 'audio/mpeg'
      try {
        const stat = fs.statSync(filePath)
        const total = stat.size
        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
          const start = m[1] ? parseInt(m[1]) : 0
          const end   = m[2] ? parseInt(m[2]) : total - 1
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch {
        res.writeHead(404); res.end('music file not found')
      }
      return
    }

    // GET /media/video/:filename — serve AI-generated video files from sandbox/videos (range-enabled)
    if (req.method === 'GET' && url.pathname.startsWith('/media/video/')) {
      const raw = url.pathname.slice('/media/video/'.length)
      const filename = path.basename(decodeURIComponent(raw))
      const videoDir = path.join(SANDBOX_PATH, 'videos')
      const filePath = path.join(videoDir, filename)
      const resolvedFile = path.resolve(filePath)
      const resolvedDir  = path.resolve(videoDir)
      if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        res.writeHead(403); res.end('forbidden'); return
      }
      const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }
      const contentType = mimeMap[path.extname(filename).toLowerCase()] || 'video/mp4'
      try {
        const stat = fs.statSync(filePath)
        const total = stat.size
        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
          const start = m[1] ? parseInt(m[1]) : 0
          const end   = m[2] ? parseInt(m[2]) : total - 1
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch {
        res.writeHead(404); res.end('video file not found')
      }
      return
    }

    // GET /audio/:filename — serve workbench audio first, then user sandbox audio.
    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
      const filename = path.basename(url.pathname)
      const uiAudioPath = path.join(JARVIS_UI_ROOT, 'audio', filename)
      const sandboxAudioPath = path.join(SANDBOX_PATH, 'audio', filename)
      const filePath = fs.existsSync(uiAudioPath) ? uiAudioPath : sandboxAudioPath
      try {
        const stat = fs.statSync(filePath)
        res.writeHead(200, {
          'Content-Type': contentTypeFor(filePath),
          'Content-Length': stat.size,
          'Cache-Control': filePath === uiAudioPath ? 'public, max-age=3600' : 'no-cache',
        })
        fs.createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('audio not found')
      }
      return
    }

    // GET /activation-status — check whether the system is activated
    if (req.method === 'GET' && url.pathname === '/activation-status') {
      jsonResponse(res, 200, getActivationStatus())
      return
    }

    // POST /activate/prepare — validate and cache activation without entering the app
    if (req.method === 'POST' && url.pathname === '/activate/prepare') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const { apiKey, model, provider, baseURL } = JSON.parse(body || '{}')
          const info = await prepareLLMActivation({ provider, apiKey, model, baseURL })
          const pending = storePreparedActivation({ apiKey, info })
          jsonResponse(res, 200, {
            ok: true,
            token: pending.token,
            ...publicActivationInfo(info),
            agent_name: getAgentName(),
            expiresAt: pending.expiresAt,
          })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /activate — submit API key to complete activation
    if (req.method === 'POST' && url.pathname === '/activate') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const { apiKey, model, provider, baseURL, agentName, preparedToken } = JSON.parse(body || '{}')

          const trimmedName = validateAgentName(agentName)

          const prepared = getPreparedActivation(preparedToken, apiKey)
          const info = prepared
            ? commitPreparedActivation(prepared.info)
            : await activateLLM({ provider, apiKey, model, baseURL })
          if (prepared) pendingActivation = null

          if (trimmedName) {
            try {
              setConfig('agent_name', trimmedName)
              setStickyEvent('agent_name_updated', { name: trimmedName })
              emitEvent('agent_name_updated', { name: trimmedName })
            } catch (err) {
              console.error('[API] save agent_name failed:', err)
            }
          }

          emitEvent('activated', info)
          // Notify index.js to start the main loop
          if (typeof onActivatedCallback === 'function') {
            try { onActivatedCallback() } catch (err) { console.error('[API] onActivated callback error:', err) }
          }
          jsonResponse(res, 200, { ok: true, ...info, agent_name: getAgentName() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings — return current LLM plus optional TTS extension status
    if (req.method === 'GET' && url.pathname === '/settings') {
      const status = getActivationStatus()
      const minimaxKey = getMinimaxKey()
      jsonResponse(res, 200, {
        llm: {
          activated: status.activated,
          provider: status.provider,
          model: status.model,
          baseURL: status.baseURL,
          models: status.models,
          temperature: config.temperature,
          thinking: config.thinking === true,
          apiKey: config.apiKey || '',
        },
        providers: getProviderSummaries(),
        minimax: {
          configured: !!(globalThis.process?.env?.MINIMAX_API_KEY || minimaxKey),
        },
      })
      return
    }

    // POST /settings/model — switch model only (no need to re-enter the key)
    if (req.method === 'POST' && url.pathname === '/settings/model') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const { provider, apiKey, model, baseURL } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = provider || apiKey || baseURL
            ? await saveLLMSettings({ provider, apiKey, model, baseURL })
            : switchModel(model)
          emitEvent('model_switched', result)
          jsonResponse(res, 200, { ok: true, ...result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/temperature — set LLM temperature
    if (req.method === 'POST' && url.pathname === '/settings/temperature') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { temperature } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = setTemperature(temperature)
          jsonResponse(res, 200, { ok: true, ...result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/thinking — toggle the model's thinking (reasoning) mode
    if (req.method === 'POST' && url.pathname === '/settings/thinking') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { thinking } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = setThinking(thinking)
          jsonResponse(res, 200, { ok: true, ...result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/security — read security sandbox configuration
    if (req.method === 'GET' && url.pathname === '/settings/security') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      jsonResponse(res, 200, { ok: true, security: getSecurity() })
      return
    }

    // POST /settings/security — save security sandbox configuration
    if (req.method === 'POST' && url.pathname === '/settings/security') {
      if (!requireLocalOrToken(req, res, url)) return
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const updates = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = setSecurity(updates)
          jsonResponse(res, 200, { ok: true, security: result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/social — read per-platform configuration status (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/social') {
      jsonResponse(res, 200, { ok: true, social: getSocialConfig() })
      return
    }

    // POST /settings/social — save platform credentials and hot-restart affected connectors
    if (req.method === 'POST' && url.pathname === '/settings/social') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const updates = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setSocialConfig(updates)
          // Restart the connector for each platform whose key was updated
          const PLATFORM_KEYS = {
            discord: ['DISCORD_BOT_TOKEN'],
          }
          for (const [platform, keys] of Object.entries(PLATFORM_KEYS)) {
            if (keys.some(k => updates[k])) {
              restartConnector(platform, { pushMessage, emitEvent }).catch(err =>
                console.warn(`[social] restart ${platform} failed:`, err.message)
              )
            }
          }
          // Restart the ClawBot connector when the user clicks "Connect WeChat"
          if (updates._clawbot_connect) {
            restartConnector('wechat-clawbot', { pushMessage, emitEvent }).catch(err =>
              console.warn('[social] restart wechat-clawbot failed:', err.message)
            )
          }
          jsonResponse(res, 200, { ok: true, social: getSocialConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // Legacy entry points now resolve to the single Jarvis workbench.
    if (req.method === 'GET' && (url.pathname === '/activation' || url.pathname === '/activation.html')) {
      res.writeHead(302, { Location: '/' })
      res.end()
      return
    }

    if (req.method === 'GET' && ['/dashboard.html', '/brain.html', '/site', '/site.html', '/brain-ui', '/brain-ui.html'].includes(url.pathname)) {
      res.writeHead(302, { Location: '/' })
      res.end()
      return
    }

    if (req.method === 'GET' && ['/assets/', '/visuals/', '/audio/'].some(prefix => url.pathname.startsWith(prefix))) {
      let relativePath = ''
      try { relativePath = decodeURIComponent(url.pathname.slice(1)) } catch {}
      const assetPath = path.resolve(JARVIS_UI_ROOT, relativePath)
      if (!relativePath || !isPathInside(JARVIS_UI_ROOT, assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      try {
        const stat = fs.statSync(assetPath)
        if (!stat.isFile()) throw new Error('not a file')
        res.writeHead(200, {
          'Content-Type': contentTypeFor(assetPath),
          'Content-Length': stat.size,
          'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        })
        fs.createReadStream(assetPath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('asset not found')
      }
      return
    }

    // GET / — the same Jarvis workbench used by Electron.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      try {
        const html = fs.readFileSync(JARVIS_UI_INDEX, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Jarvis workbench is not built')
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/systemPrompt.html') {
      try {
        const html = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('systemPrompt.html not found')
      }
      return
    }

    // POST /admin/stop — pause the consciousness loop (keep HTTP service running)
    if (req.method === 'POST' && url.pathname === '/admin/stop') {
      stopLoop()
      emitEvent('admin', { action: 'stop', running: false })
      jsonResponse(res, 200, { ok: true, running: false })
      return
    }

    // POST /admin/start — resume the consciousness loop
    if (req.method === 'POST' && url.pathname === '/admin/start') {
      startLoop()
      emitEvent('admin', { action: 'start', running: true })
      jsonResponse(res, 200, { ok: true, running: true })
      return
    }

    // POST /admin/restart — request a normal Electron relaunch when available.
    if (req.method === 'POST' && url.pathname === '/admin/restart') {
      jsonResponse(res, 200, { ok: true, message: 'Restarting…' })
      setTimeout(() => {
        const restart = globalThis.jarvisAppControl?.restart || globalThis.jarvisAppControl?.restart
        if (typeof restart === 'function') {
          restart()
          return
        }
        process.exit(0)
      }, 500)
      return
    }

    // POST /admin/reset-memories — clear all memories and conversations
    if (req.method === 'POST' && url.pathname === '/admin/reset-memories') {
      const db = getDB()
      db.prepare('DELETE FROM memories').run()
      db.prepare('DELETE FROM conversations').run()
      db.prepare("DELETE FROM config WHERE key != 'birth_time'").run()
      db.prepare('DELETE FROM entities').run()
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
      emitEvent('admin', { action: 'reset-memories' })
      jsonResponse(res, 200, { ok: true })
      return
    }

    // POST /admin/reset-files — clear sandbox user files (keeping readme.txt and world.txt)
    if (req.method === 'POST' && url.pathname === '/admin/reset-files') {
      const sandboxPath = SANDBOX_PATH
      const KEEP = new Set(['readme.txt', 'world.txt'])
      function clearDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            clearDir(full)
            try { fs.rmdirSync(full) } catch (_) {}
          } else if (!KEEP.has(entry.name.toLowerCase())) {
            fs.unlinkSync(full)
          }
        }
      }
      try { clearDir(sandboxPath) } catch (_) {}
      emitEvent('admin', { action: 'reset-files' })
      jsonResponse(res, 200, { ok: true })
      return
    }

    // GET /settings/voice — read voice configuration (credentials returned as configured-status only)
    if (req.method === 'GET' && url.pathname === '/settings/voice') {
      jsonResponse(res, 200, { ok: true, voice: getVoiceConfig() })
      return
    }

    // POST /settings/voice — save voice configuration { whisperModel?, aliyunApiKey?, ... }
    if (req.method === 'POST' && url.pathname === '/settings/voice') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setVoiceConfig(body)
          jsonResponse(res, 200, { ok: true, voice: getVoiceConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/voice/status') {
      jsonResponse(res, 200, { ok: true, voice: getVoiceStatus(), config: getVoiceConfig() })
      return
    }

    if (req.method === 'POST' && url.pathname === '/voice/start') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          jsonResponse(res, 200, { ok: true, voice: startVoiceServer({ model: body.model || body.whisperModel }) })
        } catch (err) {
          jsonResponse(res, 500, { ok: false, error: err.message, voice: getVoiceStatus() })
        }
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/voice/restart') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          jsonResponse(res, 200, { ok: true, voice: restartVoiceServer(body.model || body.whisperModel) })
        } catch (err) {
          jsonResponse(res, 500, { ok: false, error: err.message, voice: getVoiceStatus() })
        }
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/voice/stop') {
      jsonResponse(res, 200, { ok: true, voice: stopVoiceServer() })
      return
    }

    // GET /settings/tts — read TTS configuration status (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/tts') {
      jsonResponse(res, 200, { ok: true, tts: getTTSConfig(), providers: TTS_PROVIDERS, voices: TTS_VOICES })
      return
    }

    // POST /settings/tts — save TTS configuration
    if (req.method === 'POST' && url.pathname === '/settings/tts') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setTTSConfig(body)
          jsonResponse(res, 200, { ok: true, tts: getTTSConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/web-search — read web search configuration (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/web-search') {
      jsonResponse(res, 200, { ok: true, webSearch: getWebSearchConfig() })
      return
    }

    // POST /settings/web-search — save web search configuration
    if (req.method === 'POST' && url.pathname === '/settings/web-search') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setWebSearchConfig(body)
          jsonResponse(res, 200, { ok: true, webSearch: getWebSearchConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/embedding — read embedding configuration status (plaintext apiKey not returned)
    if (req.method === 'GET' && url.pathname === '/settings/embedding') {
      jsonResponse(res, 200, {
        ok: true,
        embedding: getEmbeddingConfig(),
        presets: EMBEDDING_PROVIDER_PRESETS,
      })
      return
    }

    // POST /settings/embedding — save embedding configuration
    if (req.method === 'POST' && url.pathname === '/settings/embedding') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
        setEmbeddingConfig(body)
        // 写入配置后清掉 embedding 模块的 LRU 缓存（key 是 sha256(text+model)，model 变了旧缓存无效）
        try {
          const { clearEmbeddingCache } = await import('./embedding.js')
          clearEmbeddingCache()
        } catch {}
        jsonResponse(res, 200, { ok: true, embedding: getEmbeddingConfig() })
      } catch (err) {
        jsonResponse(res, 400, { ok: false, error: err.message })
      }
      return
    }

    // POST /settings/embedding/test — connectivity probe: compute one embedding to verify provider/key
    if (req.method === 'POST' && url.pathname === '/settings/embedding/test') {
      try {
        const { computeEmbedding, isEmbeddingConfigured } = await import('./embedding.js')
        const embedding = getEmbeddingConfig()
        if (!isEmbeddingConfigured()) {
          jsonResponse(res, 200, { ok: false, error: 'embedding not configured — save provider/model/apiKey first' })
          return
        }
        const t0 = Date.now()
        const buf = await computeEmbedding('embedding connectivity test')
        if (!buf) {
          jsonResponse(res, 200, { ok: false, error: 'computeEmbedding returned null — check apiKey / baseURL / model name; see server log if any' })
          return
        }
        const elapsed = Date.now() - t0
        const dims = buf.byteLength / 4 // Float32 = 4 bytes
        jsonResponse(res, 200, { ok: true, dims, elapsedMs: elapsed, embedding })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // GET /memory/embedding-stats — visible memory vector coverage
    if (req.method === 'GET' && url.pathname === '/memory/embedding-stats') {
      try {
        const { getMemoryEmbeddingStats } = await import('./db.js')
        jsonResponse(res, 200, { ok: true, stats: getMemoryEmbeddingStats() })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // GET /memory/embedding-backfill — current backfill status
    if (req.method === 'GET' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { getBackfillStatus } = await import('./memory/embedding-backfill.js')
        jsonResponse(res, 200, { ok: true, status: getBackfillStatus() })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // POST /memory/embedding-backfill — fire-and-forget trigger backfill
    if (req.method === 'POST' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { runBackfill, getBackfillStatus } = await import('./memory/embedding-backfill.js')
        const { isEmbeddingConfigured } = await import('./embedding.js')
        if (!isEmbeddingConfigured()) {
          jsonResponse(res, 200, { ok: false, error: 'embedding not configured' })
          return
        }
        const beforeStatus = getBackfillStatus()
        if (beforeStatus.running) {
          jsonResponse(res, 200, { ok: true, started: false, reason: 'already running', status: beforeStatus })
          return
        }
        // fire-and-forget：不 await，立即响应
        runBackfill({ batchSize: 20, throttleMs: 200 }).catch(() => {})
        jsonResponse(res, 200, { ok: true, started: true, status: getBackfillStatus() })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // DELETE /memory/embedding-backfill — request cancel of running backfill
    if (req.method === 'DELETE' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { cancelBackfill } = await import('./memory/embedding-backfill.js')
        cancelBackfill()
        jsonResponse(res, 200, { ok: true, cancelled: true })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // POST /tts/stream — streaming TTS synthesis, returns an audio stream
    if (req.method === 'POST' && url.pathname === '/tts/stream') {
      if (!consumeRateLimit(req, 'tts', 30, 60_000)) {
        res.setHeader('Retry-After', '60')
        return jsonResponse(res, 429, { ok: false, error: 'TTS rate limit exceeded' })
      }
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          // 统一在合成入口剥 markdown：模型回复带 **加粗** 等记号时，TTS 会把星号念成"星星"
          const text = stripMarkdownForSpeech(body.text)
          if (!text) { jsonResponse(res, 400, { ok: false, error: 'Missing text parameter' }); return }
          let creds = getTTSCredentials()
          // 合成前预检：服务商未选/凭证未配齐时给出可执行引导，而非冲到 streamTTS 才裸抛
          const check = validateTTSConfig(creds)
          if (!check.ok) { jsonResponse(res, 400, { ok: false, error: check.guide, needsConfig: true, provider: check.provider }); return }
          const audioStream = await streamTTS({
            text: text.slice(0, 800),
            provider: creds.provider,
            voiceId:  creds.provider === 'system' ? 'default' : (body.voiceId || creds.voiceId || undefined),
            keys: {
              doubaoKey:     creds.doubaoKey,
              doubaoAppId:   creds.doubaoAppId,
              doubaoAccessKey: creds.doubaoAccessKey,
              doubaoResourceId: creds.doubaoResourceId,
              doubaoStyle:   creds.doubaoStyle,
              doubaoSpeechRate: creds.doubaoSpeechRate,
              minimaxKey:    creds.minimaxKey,
              openaiKey:     creds.openaiKey,
              openaiBaseURL: creds.openaiBaseURL,
              elevenLabsKey: creds.elevenLabsKey,
              volcanoAppId:  creds.volcanoAppId,
              volcanoToken:  creds.volcanoToken,
            },
          })
          let headersWritten = false
          let responseDone = false
          let streamError = null
          const contentType = audioStream.contentType || (creds.provider === 'system' ? 'audio/wav' : 'audio/mpeg')
          const finishRes = () => { if (!responseDone) { responseDone = true; res.end() } }
          const errorRes = (msg) => { if (!responseDone) { responseDone = true; jsonResponse(res, 500, { ok: false, error: msg }) } }
          const stopAudioOnDisconnect = () => {
            if (!responseDone && typeof audioStream.destroy === 'function') audioStream.destroy()
          }
          res.once('close', stopAudioOnDisconnect)
          audioStream.on('data', (chunk) => {
            if (!headersWritten) {
              headersWritten = true
              res.writeHead(200, {
                'Content-Type': contentType,
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
              })
            }
            res.write(chunk)
          })
          audioStream.on('end', () => {
            if (!headersWritten) {
              const errMsg = streamError?.message || 'TTS synthesis failed: API returned no audio — check whether the voice ID is enabled on your account'
              console.warn('[TTS] Empty stream:', errMsg)
              errorRes(errMsg)
            } else {
              res.removeListener('close', stopAudioOnDisconnect)
              finishRes()
            }
          })
          audioStream.on('error', (err) => {
            console.warn('[TTS] Audio stream error:', err.message)
            streamError = err
            if (!headersWritten) {
              res.removeListener('close', stopAudioOnDisconnect)
              errorRes(err.message)
            } else {
              res.removeListener('close', stopAudioOnDisconnect)
              finishRes()
            }
          })
        } catch (err) {
          console.warn('[TTS] Streaming synthesis failed:', err.message)
          if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: err.message })
          else try { res.end() } catch {}
        }
      })
      return
    }

    // POST /tts/interrupted — TTS interrupted by user; trim the last jarvis message to the spoken portion
    if (req.method === 'POST' && url.pathname === '/tts/interrupted') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const { spokenContent } = body
          if (typeof spokenContent !== 'string') { jsonResponse(res, 400, { error: 'spokenContent required' }); return }
          const updated = updateLastJarvisConversationContent(spokenContent)
          emitEvent('tts_interrupted', { spokenContent })
          jsonResponse(res, 200, { ok: true, updated })
        } catch (e) {
          jsonResponse(res, 500, { error: e.message })
        }
      })
      return
    }

    jsonResponse(res, 404, { error: 'not found' })
  })

  // Cloud ASR WebSocket channel: frontend PCM → backend proxy → cloud ASR
  const cloudWss = new WebSocketServer({ noServer: true, maxPayload: MAX_ASR_WS_PAYLOAD_BYTES })
  cloudWss.on('connection', (ws) => {
    let session = null
    let sessionFactory = null
    let sessionConfig = null
    let configured = false
    let lazyCloudSession = false
    let closing = false
    let audioLevelReports = 0
    let lastSessionStartAt = 0
    let activationThreshold = ASR_SPEECH_RMS_THRESHOLD
    let prerollMaxChunks = ASR_PREROLL_MAX_CHUNKS
    const preroll = []

    const send = (payload) => {
      if (ws.readyState !== 1) return
      try { ws.send(JSON.stringify(payload)) } catch {}
    }

    const startConfiguredSession = () => {
      if (closing || session || !sessionFactory || !sessionConfig) return session
      if (Date.now() - lastSessionStartAt < 750) return null
      lastSessionStartAt = Date.now()
      let created = null
      created = sessionFactory(
        sessionConfig,
        (text, isFinal, seg) => send({ type: 'transcript', text, is_final: isFinal, seg }),
        (errMsg) => send({ type: 'error', message: errMsg }),
        () => {
          if (session === created) session = null
          if (!closing) send({ type: 'diag', event: 'asr-session-ended', info: { rearm: lazyCloudSession } })
        },
        (event, info) => send({ type: 'diag', event, info })
      )
      session = created
      if (session) {
        for (const chunk of preroll) session.sendAudio(chunk)
        preroll.length = 0
      }
      return session
    }

    ws.on('message', (raw, isBinary) => {
      // First frame must be a JSON config frame
      if (!configured) {
        if (isBinary) {
          ws.close(1008, 'text config frame required')
          return
        }
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type !== 'config') {
            ws.close(1008, 'config frame required')
            return
          }
          // Read raw credentials from config.json
          let rawCfg = {}
          try { rawCfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.voice || {} } catch {}
          const requestedProvider = rawCfg.voiceProvider || msg.provider || 'local'
          const provider = requestedProvider === 'volc' ? 'volcengine' : requestedProvider
          const recognitionMode = msg.mode === 'wake' ? 'wake' : 'conversation'
          activationThreshold = recognitionMode === 'wake' ? ASR_WAKE_RMS_THRESHOLD : ASR_SPEECH_RMS_THRESHOLD
          prerollMaxChunks = recognitionMode === 'wake' ? ASR_WAKE_PREROLL_MAX_CHUNKS : ASR_PREROLL_MAX_CHUNKS
          const asrConfig = { provider, lang: msg.lang || 'zh', ...rawCfg }
          const useLocalAsr = provider === 'local' || provider === 'whisper' || !isCloudASRConfigured(asrConfig)
          sessionFactory = useLocalAsr ? createLocalASRSession : createCloudASRSession
          sessionConfig = { ...asrConfig, provider: useLocalAsr ? 'local' : provider }
          lazyCloudSession = !useLocalAsr
          if (useLocalAsr) {
            send({ type: 'diag', event: 'local-asr-selected', info: { requestedProvider: provider } })
            startConfiguredSession()
          } else {
            send({ type: 'diag', event: 'cloud-asr-armed', info: { provider, recognitionMode, activationThreshold } })
          }
          configured = true
        } catch (error) {
          if (/^(1|true|yes|on)$/i.test(String(process.env.JARVIS_WAKE_SEQUENCE_PROBE || ''))) {
            console.warn('[ASR probe] invalid config frame:', error?.stack || error?.message || String(error))
          }
          ws.close(1007, 'invalid config frame')
        }
        return
      }
      // Subsequent frames are PCM binary
      if (isBinary) {
        if (lazyCloudSession && !session) {
          preroll.push(Buffer.from(raw))
          while (preroll.length > prerollMaxChunks) preroll.shift()
          const rms = pcmRms(raw)
          if (audioLevelReports < 3 || (rms >= activationThreshold && audioLevelReports < 4)) {
            audioLevelReports += 1
            send({ type: 'diag', event: 'cloud-asr-level', info: { rms: Math.round(rms), threshold: activationThreshold } })
          }
          if (rms >= activationThreshold) startConfiguredSession()
        } else {
          session?.sendAudio(raw)
        }
      } else {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'flush') {
            session?.flush()
            preroll.length = 0
          }
        } catch {}
      }
    })

    const closeSession = (code, reason) => {
      if (closing) return
      closing = true
      if (/^(1|true|yes|on)$/i.test(String(process.env.JARVIS_WAKE_SEQUENCE_PROBE || ''))) {
        console.warn(`[ASR probe] outer socket closed code=${code || 0} reason=${reason?.toString?.() || ''}`)
      }
      preroll.length = 0
      session?.close()
      session = null
    }
    ws.on('close', closeSession)
    ws.on('error', closeSession)
  })

  // ACUI WebSocket channel: bidirectional control + perception
  const acuiWss = new WebSocketServer({ noServer: true, maxPayload: MAX_ACUI_WS_PAYLOAD_BYTES })
  acuiWss.on('connection', (ws) => {
    addACUIClient(ws)
    try { ws.send(JSON.stringify({ v: 1, kind: 'acui:hello' })) } catch {}

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg?.kind === 'ui.signal') {
          const id = insertUISignal({
            type: msg.type,
            target: msg.target || null,
            payload: msg.payload || {},
            ts: msg.ts || Date.now(),
          })
          emitEvent('ui_signal', { id, type: msg.type, target: msg.target, payload: msg.payload })
          // card.dismissed: remove from server-side active card table
          if (msg.type === 'card.dismissed') {
            removeActiveUICard(msg.target)
          }
          // Only push to the agent queue on explicit user interaction (card.action).
          // Lifecycle signals like card.dismissed are already persisted by insertUISignal for passive injector use.
          if (msg.type === 'card.action') {
            const appId = msg.target || 'ui'
            const action = msg.payload?.action || 'unknown'
            const payload = msg.payload?.payload || msg.payload || {}
            if (action === 'app:saveState') {
              // Auto-reported state snapshot from the component: persist directly, do not trigger agent
              persistAppState(appId, payload)
            } else if (action === 'confirm_security_change') {
              // User confirmed a security settings change: apply directly, do not push to agent queue
              const updates = {}
              if (payload.file_sandbox !== undefined) updates.fileSandbox = String(payload.file_sandbox) === 'true'
              if (payload.exec_sandbox !== undefined) updates.execSandbox = String(payload.exec_sandbox) === 'true'
              const result = Object.keys(updates).length > 0 ? setSecurity(updates) : getSecurity()
              emitUICommand({ op: 'unmount', id: appId })
              removeActiveUICard(appId)
              const desc = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')
              pushMessage(
                'SYSTEM',
                `[security settings updated] User confirmed changes: ${desc}. changed_at=${result.updatedAt || 'not recorded'}\n(Internal context refresh only. Do NOT call send_message.)`,
                'APP_SIGNAL',
                { queue: 'background', persist: false, silent: true },
              )
            } else if (action === 'cancel_security_change') {
              // User cancelled — close the card, do not apply changes
              emitUICommand({ op: 'unmount', id: appId })
              removeActiveUICard(appId)
              pushMessage('SYSTEM', '[security settings change] User cancelled — settings unchanged\n(Internal context refresh only. Do NOT call send_message.)', 'APP_SIGNAL', { queue: 'background', persist: false, silent: true })
            } else if (action.startsWith('app:') || SILENT_CARD_ACTIONS.has(action)) {
              // app: prefix = system-internal signal; SILENT_CARD_ACTIONS = lifecycle signals.
              // Both are already written to DB by insertUISignal; injector picks them up passively on the next tick.
            } else {
              const signalContent = `[App signal app=${appId} action=${action}]\n${JSON.stringify(payload, null, 2)}`
              pushMessage(`APP:${appId}`, signalContent, 'APP_SIGNAL')
            }
          }
        } else if (msg?.kind === 'pong') {
          // ignore
        }
      } catch (e) {
        // Reject non-JSON frames
      }
    })

    ws.on('close', () => removeACUIClient(ws))
    ws.on('error', () => removeACUIClient(ws))
  })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, `http://localhost:${port}`)
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    const origin = req.headers.origin
    if ((origin && !isAllowedOrigin(origin)) || !hasAllowedAccess(req, url)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.pathname === '/acui') {
      if (acuiWss.clients.size >= MAX_ACUI_CONNECTIONS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\n\r\n')
        socket.destroy()
        return
      }
      acuiWss.handleUpgrade(req, socket, head, (ws) => acuiWss.emit('connection', ws, req))
    } else if (url.pathname === '/voice/cloud') {
      if (cloudWss.clients.size >= MAX_ASR_CONNECTIONS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\n\r\n')
        socket.destroy()
        return
      }
      cloudWss.handleUpgrade(req, socket, head, (ws) => cloudWss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  // Heartbeat: send ping to all ACUI clients every 30s
  const acuiHeartbeat = setInterval(() => {
    for (const client of acuiWss.clients) {
      try { client.send(JSON.stringify({ v: 1, kind: 'ping' })) } catch {}
    }
  }, 30000)
  acuiHeartbeat.unref?.()

  server.maxHeadersCount = 100
  server.headersTimeout = 15_000
  server.requestTimeout = 5 * 60_000
  server.keepAliveTimeout = 5_000
  server.on('clientError', (error, socket) => {
    if (!socket.writable) return
    const status = error?.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request'
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  })

  server.listen(port, host, () => {
    console.log(`[API] Listening at http://${host}:${port}`)
    console.log(`[API]   POST /message  — send message to agent`)
    console.log(`[API]   GET  /events   — SSE real-time stream (receive agent messages)`)
    console.log(`[API]   GET  /memories — query memories`)
    console.log(`[API]   GET  /audit/recall, /audit/extract, /audit/stats — memory observability (Phase 0)`)
    console.log(`[API]   GET  /status   — status`)
    console.log(`[API]   WS   /acui     — ACUI bidirectional channel (control + perception)`)
  })
  server.on('close', shutdownGrokBuild)

  return server
}
