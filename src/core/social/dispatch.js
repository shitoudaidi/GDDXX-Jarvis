import { requestJson } from './http.js'
import { parseSocialTarget } from './targets.js'
import { env } from './utils.js'
import { sendClawbotMessage } from './wechat-clawbot.js'

let feishuTenantToken = null
let feishuTokenExpiresAt = 0
let feishuTokenRefreshing = null
let wechatAccessToken = null
let wechatAccessTokenExpiresAt = 0
let wechatTokenRefreshing = null

function normalizeSocialPayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      text: String(payload.text ?? payload.content ?? '').trim(),
      mediaPath: String(payload.mediaPath ?? payload.media_path ?? '').trim(),
      mediaKind: String(payload.mediaKind ?? payload.media_kind ?? '').trim(),
      fileName: String(payload.fileName ?? payload.file_name ?? '').trim(),
      size: Number(payload.size || 0) || 0,
    }
  }
  return { text: String(payload ?? '').trim(), mediaPath: '', mediaKind: '', fileName: '', size: 0 }
}

function rejectUnsupportedMedia(platform, message) {
  if (!message.mediaPath) return null
  return { ok: false, error: `${platform} media send is not supported by this connector yet` }
}

async function sendDiscord({ channelId }, content) {
  const token = env('DISCORD_BOT_TOKEN')
  if (!token) return { ok: false, skipped: true, reason: 'DISCORD_BOT_TOKEN not configured' }
  const res = await requestJson(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}` },
    body: { content },
  })
  if (!res.ok) throw new Error(`Discord send failed HTTP ${res.status}: ${res.text}`)
  return { ok: true, platform: 'discord', id: res.data?.id || null }
}

async function getFeishuTenantToken() {
  const appId = env('FEISHU_APP_ID')
  const appSecret = env('FEISHU_APP_SECRET')
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID/FEISHU_APP_SECRET not configured')
  if (feishuTenantToken && Date.now() < feishuTokenExpiresAt) return feishuTenantToken
  if (feishuTokenRefreshing) return feishuTokenRefreshing
  feishuTokenRefreshing = (async () => {
    try {
      const res = await requestJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        body: { app_id: appId, app_secret: appSecret },
      })
      if (!res.ok || res.data?.code !== 0) throw new Error(`Feishu token failed: ${res.text}`)
      feishuTenantToken = res.data.tenant_access_token
      feishuTokenExpiresAt = Date.now() + Math.max(60, Number(res.data.expire || 7200) - 120) * 1000
      return feishuTenantToken
    } finally {
      feishuTokenRefreshing = null
    }
  })()
  return feishuTokenRefreshing
}

async function sendFeishu({ receiveIdType, receiveId }, content) {
  const token = await getFeishuTenantToken()
  const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`
  const res = await requestJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    },
  })
  if (!res.ok || res.data?.code !== 0) throw new Error(`Feishu send failed: ${res.text}`)
  return { ok: true, platform: 'feishu', messageId: res.data?.data?.message_id || null }
}

async function getWechatAccessToken() {
  const appId = env('WECHAT_OFFICIAL_APP_ID')
  const secret = env('WECHAT_OFFICIAL_APP_SECRET')
  if (!appId || !secret) throw new Error('WECHAT_OFFICIAL_APP_ID/WECHAT_OFFICIAL_APP_SECRET not configured')
  if (wechatAccessToken && Date.now() < wechatAccessTokenExpiresAt) return wechatAccessToken
  if (wechatTokenRefreshing) return wechatTokenRefreshing
  wechatTokenRefreshing = (async () => {
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`
      const res = await requestJson(url)
      if (!res.ok || !res.data?.access_token) throw new Error(`WeChat token failed: ${res.text}`)
      wechatAccessToken = res.data.access_token
      wechatAccessTokenExpiresAt = Date.now() + Math.max(60, Number(res.data.expires_in || 7200) - 120) * 1000
      return wechatAccessToken
    } finally {
      wechatTokenRefreshing = null
    }
  })()
  return wechatTokenRefreshing
}

async function sendWechatOfficial({ openId }, content) {
  const token = await getWechatAccessToken()
  const res = await requestJson(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      touser: openId,
      msgtype: 'text',
      text: { content },
    },
  })
  if (!res.ok || (res.data?.errcode && res.data.errcode !== 0)) throw new Error(`WeChat send failed: ${res.text}`)
  return { ok: true, platform: 'wechat-official' }
}

async function sendWeComWebhook(target, content) {
  const key = target.key || env('WECOM_BOT_KEY')
  if (!key) return { ok: false, skipped: true, reason: 'WECOM_BOT_KEY not configured' }
  const res = await requestJson(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: { msgtype: 'text', text: { content } },
  })
  if (!res.ok || (res.data?.errcode && res.data.errcode !== 0)) throw new Error(`WeCom webhook send failed: ${res.text}`)
  return { ok: true, platform: 'wecom-webhook' }
}

async function sendClawbot({ userId }, message) {
  return sendClawbotMessage(userId, message)
}

export async function dispatchSocialMessage(targetId, payload) {
  const target = parseSocialTarget(targetId)
  if (!target) return null
  const message = normalizeSocialPayload(payload)
  switch (target.platform) {
    case 'discord':
      return rejectUnsupportedMedia('discord', message) || await sendDiscord(target, message.text)
    case 'feishu':
      return rejectUnsupportedMedia('feishu', message) || await sendFeishu(target, message.text)
    case 'wechat-official':
      return rejectUnsupportedMedia('wechat-official', message) || await sendWechatOfficial(target, message.text)
    case 'wecom-webhook':
      return rejectUnsupportedMedia('wecom-webhook', message) || await sendWeComWebhook(target, message.text)
    case 'wechat-clawbot':
      return sendClawbot(target, message)
    default:
      return null
  }
}
