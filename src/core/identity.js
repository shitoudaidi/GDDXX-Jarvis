// 身份解析层：把外部渠道的原始 ID（wechat:clawbot:xxx / discord:xxx:xxx 等）映射到 canonical 用户 ID
//
// 设计：
// - 单用户阶段（SINGLE_USER_MODE = true）：所有外部前缀 ID 和外部渠道入站消息一律映射为 PRIMARY_USER_ID
// - 多用户阶段（SINGLE_USER_MODE = false）：查 user_identities 表 (channel, external_id) → canonical_id
// - 渠道标签对 LLM 简化：WECHAT_CLAWBOT/WECHAT_OFFICIAL 都呈现为 WECHAT；本地各种入口都归 TUI

import { getDB, normalizeConversationPartyId } from './db.js'
import { normalizeChannel, PUBLIC_CHANNELS } from './runtime/channel.js'

export const PRIMARY_USER_ID = 'ID:000001'
export const SINGLE_USER_MODE = true

const EXTERNAL_PREFIX_REGEX = /^(wechat|discord|feishu|wecom):/i
export { normalizeChannel, PUBLIC_CHANNELS }

export function isExternalChannel(channel) {
  const norm = normalizeChannel(channel)
  return norm === 'WECHAT' || norm === 'DISCORD' || norm === 'FEISHU' || norm === 'WECOM'
}

// 把简化渠道名展开成数据库里实际存的 channel 值集合（用于 lookupReplyTarget 查询）
function expandChannelToConcrete(channel) {
  const norm = normalizeChannel(channel)
  switch (norm) {
    case 'WECHAT': return ['WECHAT_CLAWBOT', 'WECHAT_OFFICIAL']
    case 'WECOM':  return ['WECOM']
    case 'DISCORD': return ['DISCORD']
    case 'FEISHU': return ['FEISHU']
    case 'TUI':    return ['TUI', 'API', '']
    default:       return [String(channel)]
  }
}

// 单用户阶段：所有外部前缀 ID / 外部渠道入站消息 → PRIMARY_USER_ID
// 多用户阶段：查 user_identities 表
export function resolveCanonicalUserId({ rawFromId, channel } = {}) {
  if (!rawFromId) return rawFromId
  if (rawFromId === 'jarvis' || rawFromId === 'SYSTEM') return rawFromId
  const normalized = normalizeConversationPartyId(rawFromId)
  if (/^ID:\d+$/i.test(normalized)) return normalized

  if (SINGLE_USER_MODE) {
    if (EXTERNAL_PREFIX_REGEX.test(normalized)) return PRIMARY_USER_ID
    if (isExternalChannel(channel)) return PRIMARY_USER_ID
    return normalized
  }

  const row = getDB().prepare(
    `SELECT canonical_id FROM user_identities WHERE channel = ? AND external_id = ?`
  ).get(channel || '', normalized)
  return row?.canonical_id || normalized
}

// 反查：该 canonical 用户在指定渠道（或最近任意外部渠道）的最后一次 external_id
// 用于 send_message 出站时把 target_id="ID:000001" 解析回真实的 wechat:clawbot:xxx
// 返回 { externalId, channel } 或 null
export function lookupReplyTarget({ canonicalId, channel = null } = {}) {
  if (!canonicalId) return null
  const db = getDB()

  if (channel && channel !== 'AUTO') {
    const concrete = expandChannelToConcrete(channel)
    const placeholders = concrete.map(() => '?').join(',')
    const row = db.prepare(`
      SELECT external_party_id, channel FROM conversations
      WHERE (from_id = ? OR to_id = ?)
        AND channel IN (${placeholders})
        AND external_party_id IS NOT NULL AND external_party_id <> ''
      ORDER BY id DESC LIMIT 1
    `).get(canonicalId, canonicalId, ...concrete)
    return row ? { externalId: row.external_party_id, channel: row.channel } : null
  }

  // 任意外部渠道，按时间倒序
  const row = db.prepare(`
    SELECT external_party_id, channel FROM conversations
    WHERE (from_id = ? OR to_id = ?)
      AND external_party_id IS NOT NULL AND external_party_id <> ''
    ORDER BY id DESC LIMIT 1
  `).get(canonicalId, canonicalId)
  return row ? { externalId: row.external_party_id, channel: row.channel } : null
}

// 用户可达性快照：给 L2 tick 注入到 system prompt，让模型判断主动消息发到哪
// 返回：
//   { canonicalId, lastActive: { channel, rawChannel, lastTs, minutesAgo }, channels: [...], localMinutesAgo, externalMinutesAgo }
export function getUserPresence(canonicalId = PRIMARY_USER_ID, lookbackHours = 24) {
  const db = getDB()
  const cutoff = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString()

  const rows = db.prepare(`
    SELECT channel, MAX(timestamp) AS last_ts, COUNT(*) AS cnt
    FROM conversations
    WHERE (from_id = ? OR to_id = ?)
      AND timestamp >= ?
      AND role = 'user'
    GROUP BY channel
    ORDER BY last_ts DESC
  `).all(canonicalId, canonicalId, cutoff)

  const now = Date.now()
  const channels = rows.map(r => {
    const ts = r.last_ts
    const minutesAgo = ts ? Math.floor((now - new Date(ts).getTime()) / 60000) : null
    return {
      channel: normalizeChannel(r.channel || 'TUI'),
      rawChannel: r.channel || '',
      lastTs: ts,
      minutesAgo,
      count: r.cnt,
    }
  })

  const lastActive = channels[0] || null
  const local = channels.find(c => c.channel === 'TUI') || null
  const external = channels.find(c => c.channel !== 'TUI' && c.channel !== 'SYSTEM') || null

  return {
    canonicalId,
    lastActive,
    channels,
    localMinutesAgo: local?.minutesAgo ?? null,
    externalMinutesAgo: external?.minutesAgo ?? null,
  }
}

// 给主动消息选默认渠道：跟随用户最近一次主动消息的来源渠道（24h 窗口内的 role='user' 记录）。
// 旧逻辑里"本地 N 分钟内有活动 → 强制 TUI"的偏向已移除：
// 用户用微信问问题时显然不在电脑前，那种启发会让后续 reminder/tick 触发的
// 主动外联错误地落回 TUI，导致连续多条只有第一条真的发到了微信。
export function suggestProactiveChannel(canonicalId = PRIMARY_USER_ID) {
  const presence = getUserPresence(canonicalId, 24)
  const mostRecent = presence.channels.find(c => c.channel !== 'SYSTEM')
  return mostRecent?.channel || 'TUI'
}

// 渲染给 LLM 的可达性提示字符串（注入 system prompt）
export function formatPresenceForPrompt(canonicalId = PRIMARY_USER_ID) {
  const presence = getUserPresence(canonicalId, 24)
  if (!presence.lastActive) return ''

  const fmt = (mins) => {
    if (mins == null) return 'no recent activity'
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const h = Math.floor(mins / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const parts = presence.channels
    .filter(c => c.channel !== 'SYSTEM')
    .slice(0, 4)
    .map(c => `${c.channel} (${fmt(c.minutesAgo)})`)

  const suggestion = suggestProactiveChannel(canonicalId)
  return `User reachability snapshot (last 24h):\n  ${parts.join(', ') || 'no recent activity'}\nSuggested channel for proactive outreach right now: ${suggestion}.\n  - AUTO follows the channel of the user's most recent message — if they last spoke to you on WECHAT, replies and proactive nudges should go to WECHAT, even across multiple turns (reminders, ticks, scheduled follow-ups).\n  - send_message accepts an optional channel parameter; omit it to use the suggestion above, or pass an explicit channel (e.g. TUI for long-form output that belongs on the local UI) to override.`
}
