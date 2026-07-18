import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { nowTimestamp } from '../../time.js'
import {
  upsertMusicTrack,
  getMusicTrack,
  searchMusicLibrary,
  listMusicLibrary,
  updateMusicLrc,
  deleteMusicTrack as dbDeleteMusicTrack,
} from '../../db.js'
import { emitEvent } from '../../events.js'
import { pushMessage } from '../../queue.js'
import { callCapability } from '../../providers/registry.js'
import { isDailyLimitReached } from '../../quota.js'
import { getTTSCredentials, getSeedanceConfig } from '../../config.js'
import { streamTTS, TTS_VOICES, validateTTSConfig } from '../../voice/tts-providers.js'
import { paths } from '../../paths.js'
import { SANDBOX_ROOT } from '../sandbox.js'
import { getCountryCode } from '../../geo-weather.js'

const IS_WIN = process.platform === 'win32'

// speak：将文字转为语音，保存为音频文件
function resolveProviderVoiceId(provider, requestedVoiceId, configuredVoiceId) {
  const voices = TTS_VOICES[provider] || []
  if (!voices.length) return requestedVoiceId || configuredVoiceId || undefined

  const validIds = new Set(voices.map(v => v.id))
  if (requestedVoiceId && validIds.has(requestedVoiceId)) return requestedVoiceId
  if (requestedVoiceId) {
    console.warn(`[speak] Ignoring voice_id "${requestedVoiceId}" because it is not valid for TTS provider "${provider}"`)
  }

  if (configuredVoiceId && validIds.has(configuredVoiceId)) return configuredVoiceId
  if (configuredVoiceId) {
    console.warn(`[speak] Ignoring configured voice "${configuredVoiceId}" because it is not valid for TTS provider "${provider}"`)
  }

  return voices[0]?.id
}

// 朗读文本长度上限（与 schema 描述对齐为同一常量；剥掉 markdown 后再计）
const SPEAK_MAX_CHARS = 1000

// 把流缓冲成完整音频 buffer；空音频视为失败（很多 provider 在音色无权限/参数错时返回空流）
async function collectAudioStream(nodeStream) {
  const chunks = []
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

// 可重试的瞬时错误：网络抖动 / 限流 / 5xx。凭证错、参数错不在此列（重试无意义）。
function isTransientTTSError(err) {
  const m = String(err?.message || '')
  return /\b(429|500|502|503|504)\b/.test(m)
    || /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|aborted/i.test(m)
}

// 合成：瞬时失败自动重试一次；其余直接抛给上层归一化
async function synthSpeechBuffer({ text, provider, voiceId, creds }) {
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const nodeStream = await streamTTS({ text, provider, voiceId, keys: creds })
      const buffer = await collectAudioStream(nodeStream)
      if (!buffer.length) throw new Error('TTS 返回空音频（音色可能未在账号开通，或参数不被支持）')
      return buffer
    } catch (err) {
      lastErr = err
      if (err.name === 'AbortError') throw err
      if (attempt === 0 && isTransientTTSError(err)) {
        console.warn(`[speak] 合成失败(瞬时，重试一次): ${err.message}`)
        await new Promise(r => setTimeout(r, 600))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

// 把各家 SDK 的裸错误归一成"该去哪改什么"的可执行中文提示，供模型转述给用户
function normalizeTTSError(err, provider) {
  const msg = String(err?.message || '未知错误').slice(0, 200)
  if (/resource ID is mismatched|55000000/i.test(msg)) {
    return `语音合成失败：豆包音色与 Resource ID 不匹配。2.0 音色（*_uranus_bigtts）需用 seed-tts-2.0，旧 moon/BV 音色需 seed-tts-1.0。请去语音设置切换音色，或清空/改正 Resource ID。（${msg}）`
  }
  if (/\b(401|403)\b/.test(msg) || /unauthor|invalid.*(key|token)|api[ _-]?key/i.test(msg)) {
    return `语音合成失败：当前服务商（${provider}）的凭证可能无效或已过期。请去语音设置重新填写后再试。（${msg}）`
  }
  if (/\b429\b|rate.?limit|quota|配额|余额|insufficient/i.test(msg)) {
    return `语音合成失败：服务商（${provider}）触发限流或配额/余额不足。请稍后再试或检查账户。（${msg}）`
  }
  if (isTransientTTSError(err)) {
    return `语音合成失败：网络或服务暂时不可用（已自动重试一次）。请稍后再试。（${msg}）`
  }
  return `语音合成失败：${msg}`
}

export async function execSpeak(args) {
  const rawText = args.text || args.content || args.words || args.speech
  const { filename } = args
  console.log(`[speak] args:`, JSON.stringify(args))
  if (!rawText) return '错误：未提供要朗读的文字'
  if (isDailyLimitReached('tts')) return '错误：今日 TTS 配额已用完'

  // 与流式 /tts/stream 入口对齐：先剥 markdown，避免把 * # ` 等符号念成"星号""井号"
  const text = stripMarkdownForSpeech(rawText)
  if (!text) return '错误：去掉符号后没有可朗读的文字'
  if (text.length > SPEAK_MAX_CHARS) return `错误：文字过长（${text.length} 字），请控制在 ${SPEAK_MAX_CHARS} 字以内`

  let creds = getTTSCredentials()

  // 合成前预检：当前服务商凭证没配齐就直接返回结构化引导，不冲到 API 才裸报错。
  const check = validateTTSConfig(creds)
  if (!check.ok) return `语音合成还不能用：${check.guide}`

  const requestedVoiceId = args.voice_id || args.voice
  const voiceId = resolveProviderVoiceId(creds.provider, requestedVoiceId, creds.voiceId)

  let buffer
  try {
    buffer = await synthSpeechBuffer({ text, provider: creds.provider, voiceId, creds })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    console.warn(`[speak] 合成失败: ${err.message}`)
    return normalizeTTSError(err, creds.provider)
  }

  const ts = nowTimestamp().replace(/[:.+]/g, '-').slice(0, 19)
  const extension = creds.provider === 'system' || creds.provider === 'jarvis' ? 'wav' : 'mp3'
  const fname = filename ? filename.replace(/[^a-zA-Z0-9_一-龥-]/g, '') + `.${extension}` : `speech_${ts}.${extension}`
  const resolved = path.resolve(SANDBOX_ROOT, 'audio', fname)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, buffer)

  const relPath = `audio/${fname}`
  emitEvent('audio_created', { path: relPath, text: text.slice(0, 60), autoPlay: true, provider: creds.provider })
  console.log(`[speak] 已生成: ${relPath}`)
  return `语音已生成：${relPath}`
}

// markdown → 朗读用纯文本：TTS 引擎会把 * # ` 等符号直接念出来（"星星"），
// 所有进入合成的文本都要先过这里——/tts/stream 入口统一调用，是剥离的单一权威
export function stripMarkdownForSpeech(text) {
  const spoken = String(text || '').split('[中文翻译]', 1)[0].trim()
  // The Jarvis Piper model is English-only. Never feed raw CJK text to it.
  if (/[\u3400-\u9fff]/.test(spoken)) return ''
  return spoken
    .replace(/^[ \t]*([-*+]|\d+[.、])\s+/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}(.+?)`{1,3}/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\*\*/g, '') // 加粗记号被流式切句切成两半时残留的半截
    .replace(/\n+/g, ' ')
    .trim()
}

// 语音消息自动回复 TTS：检测到用户用语音输入时，通知前端播放语音
// 由 index.js 调用，前端收到 tts_reply 事件后调用 /tts/stream 完成实际合成
export function autoSpeakForVoiceReply(text) {
  if (!text) return
  const plain = stripMarkdownForSpeech(text)
  if (!plain) return
  // 纯表情 / 标点（没有任何可读文字）不合成语音：播放确认现在用单个 emoji 代替，
  // 语音模式下不该把它念出来（\p{L}=字母含汉字，\p{N}=数字）。
  if (!/[\p{L}\p{N}]/u.test(plain)) return
  emitEvent('tts_reply', { text: plain })
}

// generate_lyrics：生成歌词
export async function execGenerateLyrics({ prompt, mode }) {
  if (!prompt) return '错误：未提供创作方向'
  if (isDailyLimitReached('lyrics')) return '错误：今日歌词生成配额已用完'

  const result = await callCapability('lyrics', { prompt, mode })

  // 自动保存歌词到 sandbox
  const ts = nowTimestamp().replace(/[:.+]/g, '-').slice(0, 19)
  const fname = `lyrics_${ts}.txt`
  const content = `# ${result.title}\n风格：${result.style}\n\n${result.lyrics}`
  const resolved = path.resolve(SANDBOX_ROOT, 'lyrics', fname)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content, 'utf-8')

  emitEvent('lyrics_created', { path: `lyrics/${fname}`, title: result.title })
  return `歌词已生成并保存至 lyrics/${fname}\n\n标题：${result.title}\n风格：${result.style}\n\n${result.lyrics}`
}

// generate_music：生成音乐
export async function execGenerateMusic({ prompt, lyrics, instrumental }) {
  if (!prompt) return '错误：未提供音乐描述'
  if (isDailyLimitReached('music')) return '错误：今日音乐生成配额已用完'

  const result = await callCapability('music', { prompt, lyrics, instrumental })

  const ts = nowTimestamp().replace(/[:.+]/g, '-').slice(0, 19)
  const fname = `music_${ts}.mp3`
  const resolved = path.resolve(SANDBOX_ROOT, 'music', fname)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, result.buffer)

  const relPath = `music/${fname}`
  emitEvent('music_created', { path: relPath, prompt: prompt.slice(0, 60) })
  console.log(`[music] 已生成: ${relPath}`)
  return `音乐已生成：${relPath}（时长约 ${result.duration ?? '?'} 秒）`
}

// generate_image：生成图片
export async function execGenerateImage({ prompt, aspect_ratio = '1:1', n = 1 }) {
  if (!prompt) return '错误：未提供图片描述'
  if (isDailyLimitReached('image')) return '错误：今日图片生成配额已用完（50 次/天）'
  const validRatios = new Set(['1:1', '16:9', '4:3', '3:4', '9:16'])
  const ratio = validRatios.has(aspect_ratio) ? aspect_ratio : '1:1'
  const count = Math.min(Math.max(Math.floor(n) || 1, 1), 4)

  const result = await callCapability('image', { prompt, aspect_ratio: ratio, n: count })

  emitEvent('image_created', { urls: result.urls, prompt: prompt.slice(0, 60) })
  console.log(`[image] 已生成 ${result.urls.length} 张图片`)
  return `图片已生成（${result.urls.length} 张）：\n${result.urls.join('\n')}`
}

export function execMediaMode(args = {}) {
  const mode = String(args.mode || args.kind || '').trim()
  const action = String(args.action || 'show').trim()
  if (!['video', 'camera', 'image', 'music'].includes(mode)) {
    return JSON.stringify({ ok: false, tool: 'media_mode', error: 'mode must be video, camera, image, or music' })
  }
  if (!['show', 'hide', 'close', 'play', 'pause', 'seek', 'set_volume', 'update'].includes(action)) {
    return JSON.stringify({ ok: false, tool: 'media_mode', error: 'unsupported action' })
  }

  // 视频平台预检：CN 网络下 YouTube 视频经常无法 iframe 嵌入播放（embeddable=false / 地区限制），
  // 这是"视频无法播放/此视频不能观看"的主因。CN 用户传 YouTube 链接时挡回，引导改用 B 站 BV 重播
  // （B 站稿件几乎都可嵌入、国内也快）。country 未知时按 CN 保守处理。摄像头模式不拦。
  if (mode === 'video' && action === 'show' && args.camera !== true) {
    const u = String(args.url || args.src || '')
    if (/youtube\.com|youtu\.be/i.test(u)) {
      const cc = getCountryCode()
      if (cc === 'CN' || cc === null) {
        emitEvent('action', { tool: 'media_mode', summary: 'YouTube 链接已挡回（CN→改用 B 站）', detail: u.slice(0, 60) })
        return JSON.stringify({
          ok: false, tool: 'media_mode', error: 'youtube_not_embeddable_cn',
          guide: '当前网络在中国大陆，YouTube 视频经常无法嵌入播放（用户会看到"此视频不能观看"）。不要用 YouTube 链接。请改用 web_search 在 Bilibili 上搜同一主题的视频，拿到形如 https://www.bilibili.com/video/BVxxxxxxxxxx 的链接后，再用 media_mode(mode="video") 重新播放。优先选官方/高播放量的稿件，确认是可正常播放的完整视频而不是合集/直播回放。',
        })
      }
    }
  }

  const payload = {
    mode,
    action,
    url: typeof args.url === 'string' ? args.url : undefined,
    src: typeof args.src === 'string' ? args.src : undefined,
    title: typeof args.title === 'string' ? args.title : undefined,
    artist: typeof args.artist === 'string' ? args.artist : undefined,
    lrc: typeof args.lrc === 'string' ? args.lrc : undefined,
    cover: typeof args.cover === 'string' ? args.cover : undefined,
    alt: typeof args.alt === 'string' ? args.alt : undefined,
    autoplay: typeof args.autoplay === 'boolean' ? args.autoplay : (mode === 'music' ? true : undefined),
    muted: typeof args.muted === 'boolean' ? args.muted : undefined,
    camera: mode === 'camera' || args.camera === true,
  }

  if (Number.isFinite(Number(args.volume))) {
    payload.volume = Math.max(0, Math.min(1, Number(args.volume)))
  }
  if (Number.isFinite(Number(args.currentTime ?? args.time ?? args.seek))) {
    payload.currentTime = Math.max(0, Number(args.currentTime ?? args.time ?? args.seek))
  }

  emitEvent('media_mode', payload)
  emitEvent('action', { tool: 'media_mode', summary: `${mode}:${action}`, detail: payload.title || payload.url || '' })
  return JSON.stringify({ ok: true, tool: 'media_mode', ...payload })
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 视频生成（Seedance 2.0 / 火山方舟 Ark）
//
// 异步任务式：创建任务 → 后台轮询 → 下载 mp4 到 sandbox → 推给前端面板自动播放。
// 设计要点：
//   1) 未配置 key → 返回结构化引导文案（不做硬拦截，由模型转述指引用户粘贴 key）。
//   2) 创建任务同步 await，失败立刻回传给模型（典型：model ID 不对 / 余额不足）。
//   3) 轮询在后台进行（不阻塞当前 turn），全程只 emit 面板事件，完成/失败都体现在面板上。
// ─────────────────────────────────────────────────────────────────────────────

const SEEDANCE_POLL_INTERVAL_MS = 5000
const SEEDANCE_MAX_POLL_MS = 8 * 60 * 1000   // 8 分钟兜底超时
const SEEDANCE_VIDEO_DIR = path.resolve(SANDBOX_ROOT, 'videos')

const SEEDANCE_VIDEO_KEEP = 20                          // sandbox/videos 只保留最近 N 条
const SEEDANCE_PENDING_FILE = path.join(paths.userDir, 'aivideo-pending.json')
const SEEDANCE_PENDING_TTL_MS = 48 * 60 * 60 * 1000     // 火山任务约 48h 内可查，过期不再恢复
const SEEDANCE_HISTORY_FILE = path.join(paths.userDir, 'aivideo-history.json')  // 已完成视频历史（面板重开/重启后重建队列）

function newVideoJobId() {
  return `vid_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// 统一向前端面板广播 AI 视频生成状态
function emitAIVideo(action, payload = {}) {
  emitEvent('aivideo_mode', { action, ...payload })
}

// 视频生成进入终态后，给 agent 推一条 SYSTEM 通知，让它"知道"结果（成功/失败）。
// 走后台队列（background 优先级），不打断用户当前对话；agent 空闲时自然处理这条通知。
// 这是 emitAIVideo（只通知前端面板）之外的另一条通道——前者给眼睛，这条给 agent 的认知。
function notifyAgentVideoDone({ prompt = '', mode = 'text', ok = true, reason = '' } = {}) {
  const modeLabel = seedanceModeLabel(mode)
  const p = String(prompt || '').trim()
  const promptPart = p ? `，提示词：「${p}」` : ''
  const content = ok
    ? `[系统通知] 你之前提交的 AI 视频已经生成完成（${modeLabel}${promptPart}）。视频已自动在右侧面板播放。如果用户在等这个视频，简短地告诉他生成好了即可，不必复述提示词或描述画面。`
    : `[系统通知] 你之前提交的 AI 视频生成失败了（${modeLabel}${promptPart}）。原因：${reason || '未知'}。可以简短地把失败情况告诉用户，必要时建议换个提示词或稍后重试。`
  try { pushMessage('SYSTEM', content, 'SYSTEM', { queue: 'background' }) }
  catch (e) { console.warn(`[aivideo] 通知 agent 失败：${e.message}`) }
}

// ── AI 视频面板「感知」状态 ──
// 前端面板实时同步 { open, prompt } 到后端（POST /aivideo/draft）。注入器每轮把它贴进
// agent 上下文，让 agent 直接看到「面板开/关」「用户正在框里编辑的提示词草稿」。
// 这样用户说「帮我优化提示词」时，agent 无需追问内容，直接基于草稿改写。
let aivideoPanelState = { open: false, prompt: '', updatedAt: 0 }
export function setAIVideoPanelState({ open, prompt } = {}) {
  if (typeof open === 'boolean') aivideoPanelState.open = open
  if (typeof prompt === 'string') aivideoPanelState.prompt = prompt
  aivideoPanelState.updatedAt = Date.now()
}
export function getAIVideoPanelState() { return { ...aivideoPanelState } }

// ── 进行中任务持久化（断点续查）：app/后端重启后能恢复轮询，面板不会卡在“生成中” ──
function readPending() {
  try { const v = JSON.parse(fs.readFileSync(SEEDANCE_PENDING_FILE, 'utf-8')); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writePending(list) {
  try {
    const tmp = SEEDANCE_PENDING_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
    fs.renameSync(tmp, SEEDANCE_PENDING_FILE)
  } catch {}
}
function addPending(entry) { writePending([...readPending().filter(e => e.taskId !== entry.taskId), entry]) }
function removePending(taskId) { writePending(readPending().filter(e => e.taskId !== taskId)) }

// ── 已完成视频历史：任务成功落盘后记一条，按 jobId 去重、只留最近 N 条。 ──
// 面板关闭重开 / app 重启后，前端拉 GET /aivideo/history 重建生成栏队列，
// 避免“视频还在磁盘上，队列却空了”——这是历史丢失 bug 的根因（jobs[] 原本纯内存）。
function readHistory() {
  try { const v = JSON.parse(fs.readFileSync(SEEDANCE_HISTORY_FILE, 'utf-8')); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writeHistory(list) {
  try {
    const tmp = SEEDANCE_HISTORY_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
    fs.renameSync(tmp, SEEDANCE_HISTORY_FILE)
  } catch {}
}
function addHistory(entry) {
  // 新的放最前；同 jobId 去重；最多留 SEEDANCE_VIDEO_KEEP 条（与磁盘保留数对齐）
  const next = [entry, ...readHistory().filter(e => e && e.jobId !== entry.jobId)].slice(0, SEEDANCE_VIDEO_KEEP)
  writeHistory(next)
}

// 供前端 /aivideo/history 拉取：过滤掉本地 mp4 已被清理的条目，整形成前端 job 形状（newest-first）。
export function getVideoHistory() {
  return readHistory()
    .filter(e => e && e.jobId && fs.existsSync(path.join(SEEDANCE_VIDEO_DIR, `${e.jobId}.mp4`)))
    .map(e => ({
      id: e.jobId, status: 'done', videoUrl: `/media/video/${encodeURIComponent(e.jobId)}.mp4`,
      mode: e.mode || 'text', prompt: e.prompt || '',
      res: e.resolution || '', ratio: e.ratio || '', dur: e.duration || '',
    }))
}

// 保留最近 N 条生成视频，删更旧的，防止 sandbox/videos 无限膨胀
function pruneVideoDir() {
  try {
    const files = fs.readdirSync(SEEDANCE_VIDEO_DIR)
      .filter(f => f.toLowerCase().endsWith('.mp4'))
      .map(f => ({ f, mt: fs.statSync(path.join(SEEDANCE_VIDEO_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
    for (const { f } of files.slice(SEEDANCE_VIDEO_KEEP)) {
      try { fs.rmSync(path.join(SEEDANCE_VIDEO_DIR, f), { force: true }) } catch {}
    }
  } catch {}
}

// 把 Ark 返回的 video_url 下载到 sandbox/videos，返回可直接播放的本地 HTTP 路径
async function downloadGeneratedVideo(videoUrl, jobId) {
  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`下载生成视频失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(SEEDANCE_VIDEO_DIR, { recursive: true })
  const fname = `${jobId}.mp4`
  fs.writeFileSync(path.join(SEEDANCE_VIDEO_DIR, fname), buf)
  pruneVideoDir()
  return `/media/video/${encodeURIComponent(fname)}`
}

// 后台轮询任务直到终态，全程 emit 面板事件；不返回给模型
async function seedancePollLoop({ taskId, jobId, baseURL, apiKey, prompt = '', mode = 'text', ratio = '', resolution = '', duration = '' }) {
  const deadline = Date.now() + SEEDANCE_MAX_POLL_MS
  const headers = { Authorization: `Bearer ${apiKey}` }
  try {
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, SEEDANCE_POLL_INTERVAL_MS))
      let data
      try {
        const res = await fetch(`${baseURL}/contents/generations/tasks/${taskId}`, {
          headers, signal: AbortSignal.timeout(20000),
        })
        data = await res.json()
        if (!res.ok) {
          const m = data?.error?.message || `HTTP ${res.status}`
          emitAIVideo('error', { jobId, message: `查询任务失败：${m}` })
          return
        }
      } catch (e) {
        // 单次网络抖动不算失败，继续轮询直到超时
        continue
      }

      const status = String(data.status || '').toLowerCase()
      if (status === 'succeeded') {
        const videoUrl = data?.content?.video_url
        if (!videoUrl) {
          emitAIVideo('error', { jobId, message: '生成完成但未返回视频地址' })
          return
        }
        try {
          const localUrl = await downloadGeneratedVideo(videoUrl, jobId)
          emitAIVideo('ready', { jobId, videoUrl: localUrl })
          // 落盘成功后记入已完成历史，面板重开/重启时能重建队列
          addHistory({ jobId, mode, prompt, ratio, resolution, duration, doneAt: Date.now() })
          emitEvent('action', { tool: 'generate_video', summary: 'AI 视频生成完成', detail: jobId })
        } catch (e) {
          // 下载失败时退而求其次：直接播远端 URL（临时链接，可能数小时后过期）
          emitAIVideo('ready', { jobId, videoUrl })
        }
        notifyAgentVideoDone({ prompt, mode, ok: true })
        return
      }
      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        const m = data?.error?.message || status
        emitAIVideo('error', { jobId, message: `生成失败：${m}` })
        notifyAgentVideoDone({ prompt, mode, ok: false, reason: m })
        return
      }
      // queued / running → 推进度
      emitAIVideo('progress', { jobId, status: status || 'running' })
    }
    emitAIVideo('error', { jobId, message: '生成超时（超过 8 分钟未完成）' })
    notifyAgentVideoDone({ prompt, mode, ok: false, reason: '生成超时（超过 8 分钟未完成）' })
  } finally {
    // 无论成功/失败/超时/异常，都从待恢复列表移除该任务
    removePending(taskId)
  }
}

const SEEDANCE_RATIOS = new Set(['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'])
const SEEDANCE_RESOLUTIONS = new Set(['480p', '720p', '1080p'])
function seedanceModeLabel(mode) { return mode === 'flf' ? '首尾帧' : mode === 'image' ? '图生视频' : '文生视频' }
const SEEDANCE_NOT_CONFIGURED_GUIDE = 'AI 视频生成需要先配置火山方舟（Volcengine Ark）的 Seedance API Key。请引导用户：①登录火山方舟控制台开通 Seedance 2.0；②把 API Key 直接发给你即可自动配置，例如发送「火山视频 你的APIKey」；③如果账号用的是推理接入点或特定模型版本，可一并发模型ID/ep编号，例如「火山视频 你的APIKey 模型 ep-2024xxxx」。配置成功后再让用户重述生成需求。'

// generate_video：调用 Seedance 生成视频（文生视频 / 图+提示词生视频）
// action=open  → 只打开空白输入面板，用户在面板里自己填提示词/拖图片再点生成
// action=generate（默认）→ 直接提交生成
export async function execGenerateVideo(args = {}) {
  const action = String(args.action || 'generate').trim()
  const { apiKey, model, baseURL, configured } = getSeedanceConfig()

  // 只打开空白面板：无论是否已配置都打开（未配置时面板内会提示去配 key）。
  // 用户在面板里自助填写并点“生成”（前端直连 /aivideo/generate）。
  if (action === 'open') {
    emitAIVideo('open', { configured })
    emitEvent('action', { tool: 'generate_video', summary: '打开 AI 视频生成面板', detail: configured ? '' : '未配置 key' })
    return JSON.stringify({
      ok: true, tool: 'generate_video', action: 'open', configured,
      message: configured
        ? 'AI 视频生成面板已打开（空白输入态）。用户可以在面板里直接填写提示词、可选地拖入一张参考图，然后点“生成”。你不需要替用户编写提示词或自动开始生成，简短确认一句即可。'
        : 'AI 视频生成面板已打开，但尚未配置火山方舟（Seedance）key。请引导用户发送「火山视频 你的APIKey」完成配置；面板里也已经显示了同样的提示。',
    })
  }

  // 写回提示词到面板输入框：只在用户「明确表示采用」优化结果后才调用。
  // 默认（用户刚说"帮我优化"）不要调用它——先在对话里给出改写版让用户确认。
  if (action === 'set_prompt') {
    const p = String(args.prompt || args.text || '').trim()
    if (!p) return JSON.stringify({ ok: false, tool: 'generate_video', error: 'set_prompt 需要 prompt（要写入面板输入框的提示词）' })
    emitAIVideo('set_prompt', { prompt: p })
    setAIVideoPanelState({ prompt: p })
    emitEvent('action', { tool: 'generate_video', summary: '写入优化后的提示词到视频面板', detail: p.slice(0, 40) })
    return JSON.stringify({ ok: true, tool: 'generate_video', action: 'set_prompt', message: '已把这段提示词填入 AI 视频生成面板的输入框（覆盖原草稿）。提醒用户检查后自行点「生成」。' })
  }

  // 生成：未配置则返回引导（不硬拦截，交给模型/面板转述）
  if (!configured) {
    return JSON.stringify({ ok: false, tool: 'generate_video', error: 'not_configured', guide: SEEDANCE_NOT_CONFIGURED_GUIDE })
  }

  const prompt = String(args.prompt || args.text || '').trim()
  // 图片：支持 images:[url1, url2?]（2 张=首尾帧），或兼容单个 image_url
  let images = Array.isArray(args.images) ? args.images.map(s => String(s || '').trim()).filter(Boolean) : []
  if (!images.length) {
    const single = String(args.image_url || args.image || '').trim()
    if (single) images = [single]
  }
  images = images.slice(0, 2)
  if (!prompt && !images.length) {
    return JSON.stringify({ ok: false, tool: 'generate_video', error: '至少提供 prompt（文生视频）或图片（图生/首尾帧）；或用 action="open" 仅打开输入面板。' })
  }

  let ratio = SEEDANCE_RATIOS.has(args.ratio) ? args.ratio : '16:9'
  // adaptive=按参考图比例输出，仅图生/首尾帧有意义；文生视频无图可适配，回退 16:9
  if (ratio === 'adaptive' && !images.length) ratio = '16:9'
  const resolution = SEEDANCE_RESOLUTIONS.has(args.resolution) ? args.resolution : '720p'
  let duration = Number(args.duration)
  if (!Number.isFinite(duration)) duration = 5
  duration = Math.max(1, Math.min(15, Math.round(duration)))

  const content = []
  if (prompt) content.push({ type: 'text', text: prompt })
  if (images.length >= 2) {
    // 首尾帧：第一张=首帧，第二张=尾帧
    content.push({ type: 'image_url', image_url: { url: images[0] }, role: 'first_frame' })
    content.push({ type: 'image_url', image_url: { url: images[1] }, role: 'last_frame' })
  } else if (images.length === 1) {
    content.push({ type: 'image_url', image_url: { url: images[0] } })
  }

  const body = { model, content, ratio, resolution, duration }
  const mode = images.length >= 2 ? 'flf' : images.length === 1 ? 'image' : 'text'

  let createData
  try {
    const res = await fetch(`${baseURL}/contents/generations/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    createData = await res.json().catch(() => ({}))
    if (!res.ok) {
      const m = createData?.error?.message || `HTTP ${res.status}`
      return JSON.stringify({
        ok: false, tool: 'generate_video', error: `创建任务失败：${m}`,
        hint: '若提示模型不存在/无权限，多半是 model ID 不对：请让用户在火山方舟确认 Seedance 模型 ID 或推理接入点（ep-xxx），重新发送「火山视频 你的APIKey 模型 正确的模型ID」即可更新。',
      })
    }
  } catch (e) {
    return JSON.stringify({ ok: false, tool: 'generate_video', error: `创建任务异常：${e.message}` })
  }

  const taskId = createData.id || createData.task_id
  if (!taskId) {
    return JSON.stringify({ ok: false, tool: 'generate_video', error: '创建任务返回缺少任务 ID', raw: createData })
  }

  const jobId = newVideoJobId()
  const modeLabel = seedanceModeLabel(mode)
  // 在生成栏新增一个“生成中”瓦片
  emitAIVideo('show', {
    jobId, mode, prompt: prompt.slice(0, 120),
    ratio, resolution, duration, status: 'queued',
  })
  emitEvent('action', { tool: 'generate_video', summary: `提交 AI 视频生成（${modeLabel}）`, detail: prompt.slice(0, 60) })

  // 记入待恢复列表（不存 apiKey，恢复时用当前配置的 key）
  addPending({ taskId, jobId, mode, prompt: prompt.slice(0, 120), ratio, resolution, duration, baseURL, createdAt: Date.now() })

  // 后台轮询（不阻塞当前 turn）
  seedancePollLoop({ taskId, jobId, baseURL, apiKey, prompt: prompt.slice(0, 120), mode, ratio, resolution, duration }).catch(err => {
    emitAIVideo('error', { jobId, message: `轮询异常：${err.message}` })
    removePending(taskId)
  })

  return JSON.stringify({
    ok: true, tool: 'generate_video', task_id: taskId, jobId, mode,
    message: `视频生成任务已提交（${modeLabel}），正在右侧面板生成中，完成后会自动播放，通常需要 1–5 分钟。无需反复查询，回复用户一句简短确认即可。`,
  })
}

// 用户点“下载”：把生成的视频从 sandbox 缓存复制到「下载\AI视频生成保存的视频\日期\」永久保存。
export function saveGeneratedVideo(jobId) {
  const safe = String(jobId || '').replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!safe) return { ok: false, error: 'invalid jobId' }
  const src = path.join(SEEDANCE_VIDEO_DIR, `${safe}.mp4`)
  if (!fs.existsSync(src)) return { ok: false, error: '视频文件不存在（可能已被清理或尚未生成完成）' }
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dir = path.join(os.homedir(), 'Downloads', 'AI视频生成保存的视频', date)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const dst = path.join(dir, `${safe}.mp4`)
    fs.copyFileSync(src, dst)
    return { ok: true, path: dst }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// 启动时恢复上次未完成的生成任务：重新发 show 事件并继续轮询，
// 让重启前正在生成的视频仍能自动落盘 / 在面板播放（而不是永远卡“生成中”）。
// 由 index.js 在后端启动后调用一次。
export function resumePendingVideoJobs() {
  let list = readPending()
  if (!list.length) return
  // 丢弃过期（>48h，火山已不可查）的条目
  const fresh = list.filter(e => e && e.taskId && (Date.now() - (e.createdAt || 0) < SEEDANCE_PENDING_TTL_MS))
  if (fresh.length !== list.length) writePending(fresh)
  if (!fresh.length) return

  const { apiKey, baseURL, configured } = getSeedanceConfig()
  if (!configured) { writePending([]); return }  // 没 key 无法恢复，清空避免无限残留

  // 延迟几秒，等前端 SSE 连上后再发事件，避免恢复太快前端收不到
  setTimeout(() => {
    for (const e of fresh) {
      emitAIVideo('show', {
        jobId: e.jobId, mode: e.mode, prompt: e.prompt,
        ratio: e.ratio, resolution: e.resolution, duration: e.duration, status: 'running',
      })
      seedancePollLoop({ taskId: e.taskId, jobId: e.jobId, baseURL: e.baseURL || baseURL, apiKey, prompt: e.prompt, mode: e.mode, ratio: e.ratio, resolution: e.resolution, duration: e.duration })
        .catch(() => removePending(e.taskId))
    }
    console.log(`[aivideo] 已恢复 ${fresh.length} 个未完成的视频生成任务`)
  }, 4000)
}

const MUSIC_AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.opus'])

async function fetchLrcFromNet(title, artist) {
  const headers = { 'User-Agent': 'JarvisLocalAgent/1.0' }
  // 策略1：精确匹配（title + artist）
  try {
    const params = new URLSearchParams({ track_name: title })
    if (artist) params.set('artist_name', artist)
    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      signal: AbortSignal.timeout(8000), headers,
    })
    if (res.ok) {
      const data = await res.json()
      const lrc = data.syncedLyrics || data.plainLyrics || null
      if (lrc) return lrc
    }
  } catch {}
  // 策略2：仅 title 关键词搜索，取第一条结果
  try {
    const params = new URLSearchParams({ q: title })
    const res = await fetch(`https://lrclib.net/api/search?${params}`, {
      signal: AbortSignal.timeout(8000), headers,
    })
    if (res.ok) {
      const list = await res.json()
      if (Array.isArray(list) && list.length > 0) {
        const hit = list[0]
        return hit.syncedLyrics || hit.plainLyrics || null
      }
    }
  } catch {}
  return null
}

function decodeProcessOutput(chunks) {
  const buffer = Buffer.concat(chunks)
  if (buffer.length === 0) return ''

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (!utf8.includes('\uFFFD') || !IS_WIN) return utf8

  try {
    return new TextDecoder('gb18030', { fatal: false }).decode(buffer)
  } catch {
    return utf8
  }
}

function runProcess(file, args = [], cwd) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: cwd || paths.musicDir,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })
    const stdoutChunks = []
    const stderrChunks = []
    child.stdout?.on('data', d => { stdoutChunks.push(Buffer.from(d)) })
    child.stderr?.on('data', d => { stderrChunks.push(Buffer.from(d)) })
    child.on('close', code => resolve({
      code,
      stdout: decodeProcessOutput(stdoutChunks),
      stderr: decodeProcessOutput(stderrChunks),
    }))
    child.on('error', err => resolve({
      code: -1,
      stdout: decodeProcessOutput(stdoutChunks),
      stderr: err.message,
    }))
  })
}

const YTDLP_LOCAL = path.join(paths.musicDir, 'yt-dlp.exe')
const YTDLP_URL   = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
// 国内裸连 GitHub release 经常超时/失败，准备几个镜像兜底（按序尝试）。
const YTDLP_DOWNLOAD_SOURCES = [
  YTDLP_URL,
  `https://gh-proxy.com/${YTDLP_URL}`,
  `https://ghfast.top/${YTDLP_URL}`,
]

async function resolveYtDlp() {
  // 1. 系统 PATH 里有就直接用
  const sys = await runProcess('yt-dlp', ['--version'], paths.musicDir)
  if (sys.code === 0) return 'yt-dlp'

  // 2. music 目录里有本地副本就用它
  if (fs.existsSync(YTDLP_LOCAL)) {
    const local = await runProcess(YTDLP_LOCAL, ['--version'], paths.musicDir)
    if (local.code === 0) return YTDLP_LOCAL
  }

  // 3. 自动下载 yt-dlp.exe 到 music 目录（GitHub 直连 + 国内镜像兜底）
  emitEvent('action', { tool: 'music', summary: 'yt-dlp 未安装，正在自动下载…', detail: YTDLP_URL })
  for (const src of YTDLP_DOWNLOAD_SOURCES) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1_000_000) continue   // 太小八成是错误页/重定向，不是真 exe
      fs.writeFileSync(YTDLP_LOCAL, buf)
      try { fs.chmodSync(YTDLP_LOCAL, 0o755) } catch {}
      return YTDLP_LOCAL
    } catch { /* 换下一个源 */ }
  }
  return null
}

export async function execMusic(args = {}) {
  const action = String(args.action || 'list').trim()
  const musicDir = paths.musicDir

  // ── list ──────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const rows = listMusicLibrary(Number(args.limit) || 50)
    return JSON.stringify({ ok: true, count: rows.length, tracks: rows })
  }

  // ── search ────────────────────────────────────────────────────────────────
  if (action === 'search') {
    const q = String(args.query || '').trim()
    if (!q) return JSON.stringify({ ok: false, error: 'query required' })
    const rows = searchMusicLibrary(q, Number(args.limit) || 20)
    return JSON.stringify({ ok: true, count: rows.length, tracks: rows })
  }

  // ── scan ──────────────────────────────────────────────────────────────────
  if (action === 'scan') {
    const entries = fs.readdirSync(musicDir, { withFileTypes: true })
    const added = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!MUSIC_AUDIO_EXTS.has(ext)) continue
      const filePath = path.join(musicDir, entry.name)
      const baseName = path.basename(entry.name, ext)
      const track = upsertMusicTrack({ title: baseName, filePath })
      added.push({ id: track.id, title: track.title, file_path: track.file_path })
    }
    return JSON.stringify({ ok: true, scanned: added.length, tracks: added })
  }

  // ── add ───────────────────────────────────────────────────────────────────
  if (action === 'add') {
    const filePath = String(args.path || '').trim()
    if (!filePath) return JSON.stringify({ ok: false, error: 'path required' })
    if (!fs.existsSync(filePath)) return JSON.stringify({ ok: false, error: `file not found: ${filePath}` })
    const ext = path.extname(filePath).toLowerCase()
    if (!MUSIC_AUDIO_EXTS.has(ext)) return JSON.stringify({ ok: false, error: `unsupported format: ${ext}` })
    const baseName = path.basename(filePath, ext)
    const track = upsertMusicTrack({
      title: String(args.title || baseName),
      artist: String(args.artist || ''),
      album: String(args.album || ''),
      filePath,
    })
    return JSON.stringify({ ok: true, track })
  }

  // ── download ──────────────────────────────────────────────────────────────
  if (action === 'download') {
    // 自动解析 yt-dlp 路径（没有则自动下载）
    const ytdlp = await resolveYtDlp()
    if (!ytdlp) return JSON.stringify({ ok: false, error: 'yt-dlp 自动下载失败（可能无法连接 GitHub）。请检查网络，或手动把 yt-dlp.exe 放到 music 目录。' })

    const url = String(args.url || '').trim()
    // query 兜底：没有明确 URL 时，用关键词让 yt-dlp 自己搜索并下载第一条，
    // 这样 agent 不必凭空找/猜一个真实视频 URL（这是放歌失败的主因）。
    const query = String(args.query || '').trim()
      || [String(args.title || '').trim(), String(args.artist || '').trim()].filter(Boolean).join(' ')

    // 构造按序尝试的下载目标：
    //  - 有明确 URL → 只用它
    //  - 否则用关键词搜索：按 platform 选搜索源，另一平台自动兜底
    const platform = String(args.platform || '').trim().toLowerCase()
    let targets = []
    if (url) {
      targets = [url]
    } else if (query) {
      const yt = `ytsearch1:${query}`
      const bili = `bilisearch1:${query}`
      // CN/bilibili 优先 B 站，否则优先 YouTube；两者互为兜底。
      targets = platform === 'bilibili' ? [bili, yt] : [yt, bili]
    } else {
      return JSON.stringify({ ok: false, error: 'download 需要 url 或 query（歌名/歌手），至少给一个' })
    }

    // 文件命名：Agent 传了 title 就用干净标题命名。query 直下时 yt-dlp 默认用
    // 视频标题（一长串脏名），用 title/artist 命名既好看，定位文件也更稳。
    const wantArtist = String(args.artist || '').trim()
    const wantTitle = String(args.title || '').trim()
    const niceName = wantTitle
      ? (wantArtist ? `${wantArtist} - ${wantTitle}` : wantTitle)
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 100)
      : ''

    // Download: print final filepath after conversion
    const outTemplate = (niceName
      ? path.join(musicDir, `${niceName}.%(ext)s`)
      : path.join(musicDir, '%(title)s.%(ext)s')
    ).replace(/\\/g, '/')
    const dlArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--no-playlist', '--print', 'after_move:filepath', '-o', outTemplate]

    // 下载同步阻塞 30s–2min，先 emit 一条进度 action，让用户在界面看到“正在下载”，
    // 而不是面对一段静默以为卡死。
    emitEvent('action', { tool: 'music', summary: `正在下载歌曲：${niceName || query || url}`, detail: '' })

    let result = null
    let lastErr = ''
    for (const target of targets) {
      result = await runProcess(ytdlp, [...dlArgs, target])
      // SSL 握手失败时降级：加 --no-check-certificates 重试一次
      if (result.code !== 0 && /ssl|EOF occurred in violation of protocol/i.test(result.stderr)) {
        result = await runProcess(ytdlp, [...dlArgs, '--no-check-certificates', target])
      }
      if (result.code === 0) break
      lastErr = result.stderr
    }

    if (!result || result.code !== 0) {
      return JSON.stringify({ ok: false, error: `yt-dlp failed: ${String(lastErr).slice(0, 400)}` })
    }

    // Parse output filepath (last non-empty line)
    const lines = result.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean)
    let filePath = lines[lines.length - 1] || ''

    // Fallback: scan for newest mp3 in musicDir
    if (!filePath || !fs.existsSync(filePath)) {
      const files = fs.readdirSync(musicDir)
        .filter(f => f.endsWith('.mp3'))
        .map(f => ({ f, mt: fs.statSync(path.join(musicDir, f)).mtimeMs }))
        .sort((a, b) => b.mt - a.mt)
      if (files.length) filePath = path.join(musicDir, files[0].f)
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return JSON.stringify({ ok: false, error: 'Download completed but could not locate output file' })
    }

    const baseName = path.basename(filePath, '.mp3')
    const title  = String(args.title  || baseName)
    const artist = String(args.artist || '')

    // Auto-fetch lyrics
    let lrc = ''
    if (title) {
      lrc = await fetchLrcFromNet(title, artist) || ''
    }

    const track = upsertMusicTrack({ title, artist, album: String(args.album || ''), filePath, lrc, sourceUrl: url || query })
    return JSON.stringify({ ok: true, track, lrc_fetched: Boolean(lrc) })
  }

  // ── get_lyrics ────────────────────────────────────────────────────────────
  if (action === 'get_lyrics') {
    const id = Number(args.id)
    let title  = String(args.title  || '').trim()
    let artist = String(args.artist || '').trim()

    if (id) {
      const track = getMusicTrack(id)
      if (!track) return JSON.stringify({ ok: false, error: `track id=${id} not found` })
      if (!title)  title  = track.title
      if (!artist) artist = track.artist
    }
    if (!title) return JSON.stringify({ ok: false, error: 'title required' })

    const lrc = await fetchLrcFromNet(title, artist)
    if (!lrc) return JSON.stringify({ ok: true, id: id || null, title, artist, lrc: null, hint: 'lyrics not found on lrclib.net' })

    if (id) updateMusicLrc(id, lrc)
    return JSON.stringify({ ok: true, id: id || null, title, artist, lrc_length: lrc.length, lrc })
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const id = Number(args.id)
    if (!id) return JSON.stringify({ ok: false, error: 'id required' })
    const track = getMusicTrack(id)
    if (!track) return JSON.stringify({ ok: false, error: `track id=${id} not found` })
    dbDeleteMusicTrack(id)
    return JSON.stringify({ ok: true, deleted: { id, title: track.title } })
  }

  return JSON.stringify({ ok: false, error: `unknown action: ${action}` })
}
