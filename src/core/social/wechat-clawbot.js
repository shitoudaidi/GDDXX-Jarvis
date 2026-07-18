import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
import {
  WeChatClient,
  UploadMediaType,
  aesEcbPaddedSize,
  encryptAesEcb,
  getMimeFromFilename,
} from 'wechat-ilink-client'
import { getClawbotCredentials, setClawbotCredentials, clearClawbotCredentials } from '../config.js'
import { upsertClawbotToken, getAllClawbotTokens } from '../db.js'

const require = createRequire(import.meta.url)

let client = null
let currentQrUrl = null   // set during login, cleared after scan
let clawbotStatus = 'idle' // idle | qr_pending | connected | error
let qrCodeLib = null

function getQRCodeLib() {
  if (qrCodeLib) return qrCodeLib
  try {
    qrCodeLib = {
      QRCode: require('qrcode-terminal/vendor/QRCode/index.js'),
      QRErrorCorrectLevel: require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js'),
    }
    return qrCodeLib
  } catch {
    return null
  }
}

function svgEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function qrSvgDataUrl(value) {
  if (!value) return ''
  const libs = getQRCodeLib()
  if (!libs) return ''
  const qrcode = new libs.QRCode(-1, libs.QRErrorCorrectLevel.M)
  qrcode.addData(String(value))
  qrcode.make()
  const moduleCount = qrcode.getModuleCount()
  const quietZone = 4
  const size = moduleCount + quietZone * 2
  const cells = []
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qrcode.isDark(row, col)) {
        cells.push(`<rect x="${col + quietZone}" y="${row + quietZone}" width="1" height="1"/>`)
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${svgEscape('WeChat login QR code')}"><rect width="${size}" height="${size}" fill="#f4fffb"/><g fill="#061111">${cells.join('')}</g></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function normalizeClawbotPayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      text: String(payload.text ?? payload.content ?? '').trim(),
      mediaPath: String(payload.mediaPath ?? payload.media_path ?? '').trim(),
      mediaKind: String(payload.mediaKind ?? payload.media_kind ?? '').trim(),
      fileName: String(payload.fileName ?? payload.file_name ?? '').trim(),
    }
  }
  return { text: String(payload ?? '').trim(), mediaPath: '', mediaKind: '', fileName: '' }
}

function inferUploadMediaType(filePath) {
  const mime = getMimeFromFilename(filePath)
  if (mime.startsWith('image/')) return { mediaType: UploadMediaType.IMAGE, kind: 'image' }
  if (mime.startsWith('video/')) return { mediaType: UploadMediaType.VIDEO, kind: 'video' }
  return { mediaType: UploadMediaType.FILE, kind: 'file' }
}

function pickUploadUrl(uploadUrlResp, filekey, cdnBaseUrl) {
  const directUrl = uploadUrlResp?.upload_full_url
    || uploadUrlResp?.full_upload_url
    || uploadUrlResp?.upload_url
  if (directUrl) return String(directUrl)

  const uploadParam = uploadUrlResp?.upload_param
    || uploadUrlResp?.uploadParam
    || uploadUrlResp?.encrypted_query_param
  if (!uploadParam) return ''

  const url = new URL('/c2c/upload', cdnBaseUrl || 'https://novac2c.cdn.weixin.qq.com')
  url.searchParams.set('encrypted_query_param', String(uploadParam))
  url.searchParams.set('filekey', filekey)
  const taskId = uploadUrlResp?.taskid || uploadUrlResp?.task_id
  if (taskId) url.searchParams.set('taskid', String(taskId))
  return url.toString()
}

async function uploadEncryptedBuffer(uploadUrl, plaintext, aeskey) {
  const ciphertext = encryptAesEcb(plaintext, aeskey)
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      })
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get('x-error-message') || await res.text()
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`)
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get('x-error-message') || `status ${res.status}`
        throw new Error(`CDN upload server error: ${errMsg}`)
      }
      const downloadParam = res.headers.get('x-encrypted-param') || ''
      if (!downloadParam) throw new Error('CDN upload response missing x-encrypted-param header')
      return downloadParam
    } catch (err) {
      lastError = err
      if (err?.message?.includes('client error')) throw err
      if (attempt >= 3) break
    }
  }
  throw lastError || new Error('CDN upload failed after 3 attempts')
}

async function uploadMediaViaClawbotApi(userId, filePath) {
  const plaintext = await fs.readFile(filePath)
  const rawsize = plaintext.length
  const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex')
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = crypto.randomBytes(16).toString('hex')
  const aeskey = crypto.randomBytes(16)
  const { mediaType, kind } = inferUploadMediaType(filePath)

  const uploadUrlResp = await client.api.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: userId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
  })
  const ret = uploadUrlResp?.ret ?? uploadUrlResp?.code ?? uploadUrlResp?.errcode
  if (ret != null && ret !== 0) {
    const errMsg = uploadUrlResp?.err_msg || uploadUrlResp?.errmsg || uploadUrlResp?.message || uploadUrlResp?.msg || ''
    throw new Error(`getUploadUrl rejected: ret=${ret} ${errMsg}`.trim())
  }

  const uploadUrl = pickUploadUrl(uploadUrlResp, filekey, client.api?.cdnBaseUrl)
  if (!uploadUrl) throw new Error(`getUploadUrl returned no upload URL: ${JSON.stringify(uploadUrlResp)}`)

  const downloadParam = await uploadEncryptedBuffer(uploadUrl, plaintext, aeskey)
  return {
    kind,
    uploaded: {
      filekey,
      downloadEncryptedQueryParam: downloadParam,
      aeskey: aeskey.toString('hex'),
      fileSize: rawsize,
      fileSizeCiphertext: filesize,
    },
  }
}

async function sendClawbotMedia(userId, message) {
  const contextToken = client.contextTokens instanceof Map ? client.contextTokens.get(userId) : ''
  if (!contextToken) throw new Error(`No context_token for user ${userId}. Receive a message from them first.`)
  const { kind, uploaded } = await uploadMediaViaClawbotApi(userId, message.mediaPath)
  const caption = message.text || undefined
  if (kind === 'image') {
    await client.sendUploadedImage(userId, uploaded, caption, contextToken)
  } else if (kind === 'video') {
    await client.sendUploadedVideo(userId, uploaded, caption, contextToken)
  } else {
    await client.sendUploadedFile(userId, message.fileName || path.basename(message.mediaPath), uploaded, caption, contextToken)
  }
  return kind
}

// Called by dispatch.js to send replies back to WeChat
export async function sendClawbotMessage(userId, payload) {
  const message = normalizeClawbotPayload(payload)
  if (!message.text && !message.mediaPath) {
    return { ok: false, reason: 'empty wechat-clawbot message' }
  }
  if (!client || clawbotStatus !== 'connected') {
    return { ok: false, reason: 'wechat-clawbot not connected' }
  }
  try {
    if (message.mediaPath) {
      const kind = await sendClawbotMedia(userId, message)
      return { ok: true, platform: 'wechat-clawbot', kind }
    }
    await client.sendText(userId, message.text)
    return { ok: true, platform: 'wechat-clawbot', kind: 'text' }
  } catch (err) {
    const action = message.mediaPath ? 'sendMedia' : 'sendText'
    console.error(`[ClawBot] ${action} failed: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

// Called by api.js for GET /social/wechat-clawbot/qr
export function getClawbotQR() {
  const saved = getClawbotCredentials()
  return {
    status: clawbotStatus,
    connected: clawbotStatus === 'connected',
    configured: !!saved,
    accountId: clawbotStatus === 'connected' ? saved?.accountId || null : null,
    qr_url: currentQrUrl,
    qr_svg: currentQrUrl ? qrSvgDataUrl(currentQrUrl) : '',
  }
}

// Called by api.js for POST /social/wechat-clawbot/logout
export function logoutClawbot() {
  clearClawbotCredentials()
  clawbotStatus = 'idle'
  currentQrUrl = null
  try { client?.stop?.() } catch {}
  client = null
}

export function startClawbotConnector({ pushMessage, emitEvent } = {}) {
  const saved = getClawbotCredentials()

  client = new WeChatClient(saved ? {
    accountId: saved.accountId,
    token: saved.botToken,
    baseUrl: saved.baseUrl,
  } : {})

  // Monkey-patch client.api.apiFetch：库内部 sendMessage 只 await apiFetch、丢掉响应文本，
  // 而 apiFetch 仅在 HTTP !res.ok 时抛错——HTTP 200 + body 里 {"ret": -1} 这种业务失败被完全吞掉，
  // 导致 sendText 报"成功"但消息没投递。这里拦响应：sendmessage 端点解析 JSON，
  // 发现非零 ret/code 时显式抛错，让上层 sendClawbotMessage 的 catch 拿到真实失败原因。
  try {
    const rawApiFetch = client.api?.apiFetch?.bind(client.api)
    if (typeof rawApiFetch === 'function') {
      client.api.apiFetch = async (params) => {
        const rawText = await rawApiFetch(params)
        if (params?.endpoint === 'ilink/bot/sendmessage') {
          let body = null
          try { body = JSON.parse(rawText) } catch {}
          if (body && typeof body === 'object') {
            const ret = body.ret ?? body.code ?? body.errcode
            if (ret != null && ret !== 0) {
              const errMsg = body.err_msg || body.errmsg || body.message || body.msg || ''
              console.error(`[ClawBot] sendMessage 服务端拒绝 ret=${ret} ${errMsg} raw=${rawText.slice(0, 500)}`)
              throw new Error(`iLink sendmessage rejected: ret=${ret} ${errMsg}`)
            }
          }
        }
        return rawText
      }
      console.log('[ClawBot] sendMessage 响应校验已启用')
    } else {
      console.warn('[ClawBot] client.api.apiFetch 不可访问，跳过响应校验（库实现可能已变化）')
    }
  } catch (err) {
    console.warn(`[ClawBot] 安装响应校验失败（不致命，继续启动）: ${err.message}`)
  }

  // 启动时把上次落盘的 context_token 回填到内存 Map：
  // ilink 库 sendText 用的是 this.contextTokens.get(to)，重启后这个 Map 是空的；
  // 不回填则只能等用户先发一条新消息才能回复。token 可能服务端已过期，所以
  // sendText 仍可能失败，executor 已有兜底提示，这里只是尽量恢复。
  // contextTokens 在 .d.ts 里是 private 但运行时是普通 class field —— 加 guard 防作者哪天换成 # 真私有。
  try {
    if (client.contextTokens instanceof Map) {
      const rows = getAllClawbotTokens()
      if (rows.length) {
        for (const row of rows) {
          client.contextTokens.set(row.from_user_id, row.context_token)
        }
        console.log(`[ClawBot] 已从持久化恢复 ${rows.length} 条 context_token`)
      }
    } else {
      console.warn('[ClawBot] client.contextTokens 不可访问（库实现可能已变化），跳过 token 恢复')
    }
  } catch (err) {
    console.warn(`[ClawBot] 恢复 context_token 失败（不致命，继续启动）: ${err.message}`)
  }

  client.on('message', (msg) => {
    // 每条入站消息都带新鲜的 context_token —— 库已经在内部 set 到 Map 了，
    // 这里只是同步落盘一份，让下次重启能继承当前会话。
    if (msg?.context_token && msg?.from_user_id) {
      try { upsertClawbotToken(msg.from_user_id, msg.context_token) } catch {}
    }
    const text = WeChatClient.extractText?.(msg) ?? extractText(msg)
    if (!text) return
    const fromId = `wechat:clawbot:${msg.from_user_id}`
    pushMessage(fromId, text, 'WECHAT_CLAWBOT', {
      social: { platform: 'wechat-clawbot', user_id: msg.from_user_id },
    })
    emitEvent?.('message_in', {
      from_id: fromId,
      content: text,
      channel: 'WECHAT_CLAWBOT',
      timestamp: new Date().toISOString(),
    })
  })

  client.on('error', (err) => {
    console.error(`[ClawBot] 错误: ${err.message}`)
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
  })

  client.on('sessionExpired', () => {
    console.warn('[ClawBot] 会话已过期，请重新扫码登录')
    clearClawbotCredentials()
    clawbotStatus = 'idle'
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'session_expired' })
  })

  if (!saved) {
    // 首次登录：发起扫码流程
    clawbotStatus = 'qr_pending'
    console.log('[ClawBot] 未找到已保存凭证，开始扫码登录...')
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'qr_pending' })

    client.login({
      onQRCode(url) {
        currentQrUrl = url
        clawbotStatus = 'qr_ready'
        console.log(`[ClawBot] 二维码已就绪，请在设置面板扫码`)
        emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'qr_ready', qr_url: url })
      },
    }).then(result => {
      currentQrUrl = null
      // wechat-ilink-client 的 login() 在超时/取消等情况下不会 reject，
      // 而是 resolve 一个 { connected: false, message } —— 必须显式检查 connected 字段，
      // 否则会误把超时当成扫码成功，UI 卡在虚假的"已连接"
      if (!result?.connected || !result?.accountId || !result?.botToken) {
        clawbotStatus = 'idle'
        const reason = result?.message || '未知原因'
        console.warn(`[ClawBot] 扫码登录未完成: ${reason}`)
        emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'idle', reason })
        return
      }
      clawbotStatus = 'connected'
      setClawbotCredentials({
        accountId: result.accountId,
        botToken: result.botToken,
        baseUrl: result.baseUrl,
      })
      console.log(`[ClawBot] 扫码登录成功，已保存凭证`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'connected', accountId: result.accountId })
      client.start().catch(err => console.error(`[ClawBot] start 失败: ${err.message}`))
    }).catch(err => {
      clawbotStatus = 'error'
      console.error(`[ClawBot] 扫码登录失败: ${err.message}`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
    })
  } else {
    // 凭证已存，直接启动
    clawbotStatus = 'connected'
    console.log(`[ClawBot] 使用已保存凭证启动（accountId: ${saved.accountId}）`)
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'connected', accountId: saved.accountId })
    client.start().catch(err => {
      // start 失败说明凭证已失效或后端连不上 —— 必须同步把内存状态打回去，
      // 否则 popup 查询时仍会拿到 'connected'，UI 显示"已连接"但实际啥都不通
      clawbotStatus = 'error'
      console.error(`[ClawBot] start 失败: ${err.message}`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
    })
  }

  return {
    platform: 'wechat-clawbot',
    stop() {
      clawbotStatus = 'idle'
      try { client?.stop?.() } catch {}
    },
  }
}

// 从消息结构中提取文本（兼容 extractText 未导出的情况）
function extractText(msg) {
  if (!msg) return ''
  const items = msg.item_list || msg.itemList || []
  for (const item of items) {
    if (item.type === 1 || item.type === 'text') {
      return item.text_item?.text || item.textItem?.text || ''
    }
  }
  return ''
}
