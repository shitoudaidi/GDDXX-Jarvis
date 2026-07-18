// fetch_url：Jina Reader 优先（JS 页面/防护/正文质量最好），直连兜底，
// 都失败时自动升级到真实浏览器渲染（fetchUrlBrowserFallback）。
import { createMergedAbortSignal, throwIfAborted } from '../../abort-utils.js'
import {
  WEB_HEADERS, webJson, normalizeWebUrl, htmlToText, extractTitle, isLowValuePageText,
  saveLongArticle, ARTICLE_LENGTH_THRESHOLD, ARTICLE_SUMMARY_EXCERPT,
} from './util.js'
import { execBrowserRead } from './browser-read.js'

// URL 访问缓存：url → { payload, fetchedAt (ms timestamp) }
// 避免同一 URL 在短时间内被反复请求（如天气每天只需查一次）
const urlCache = new Map()

const URL_TTL_MS = {
  default: 60 * 60 * 1000,       // 默认：1 小时
  weather: 24 * 60 * 60 * 1000,  // 天气类：24 小时
  news:    30 * 60 * 1000,        // 新闻类：30 分钟
}

function getUrlTtl(url) {
  const u = url.toLowerCase()
  if (u.includes('wttr.in') || u.includes('weather') || u.includes('openweather') || u.includes('tianqi')) {
    return URL_TTL_MS.weather
  }
  if (u.includes('news') || u.includes('rss') || u.includes('feed')) {
    return URL_TTL_MS.news
  }
  return URL_TTL_MS.default
}

// 判断 URL 是否像 JSON/API 端点。这类地址走远程 Jina Reader 既慢又会把 JSON
// 当网页渲染、破坏结构，应该直连优先。判错的代价很低：直连失败仍会退回 Jina。
function isLikelyApiUrl(url) {
  const u = String(url || '').toLowerCase()
  return /\.json(\?|#|$)/.test(u)
    || /[?&](format|output|alt)=json\b/.test(u)
    || /\/api\//.test(u)
    || /\/(rest|graphql)\//.test(u)
}

// fetch_url 策略一：Jina Reader（r.jina.ai）
// 服务端 Chromium 渲染 + Mozilla Readability，免费无需 key，支持 JS 页面
async function fetchViaJina(url, signal) {
  const jinaUrl = `https://r.jina.ai/${url}`
  const merged = createMergedAbortSignal(signal, 20000)
  try {
    const res = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'markdown',
        'X-Timeout': '15',
        'User-Agent': WEB_HEADERS['User-Agent'],
      },
      signal: merged?.signal,
    })
    merged?.cleanup()
    if (!res.ok) return null
    const text = (await res.text()).trim()
    if (isLowValuePageText(text)) return null
    // Jina 返回格式：第一行是 "Title: xxx"，第二行空行，然后是正文 Markdown
    let title = ''
    let body = text
    const titleMatch = text.match(/^Title:\s*(.+)/m)
    if (titleMatch) {
      title = titleMatch[1].trim()
      body = text.replace(/^Title:.*\n?/m, '').replace(/^URL Source:.*\n?/m, '').replace(/^Markdown Content:\n?/m, '').trim()
    }
    return { title, body, source: 'jina' }
  } catch (err) {
    merged?.cleanup()
    if (err.name === 'AbortError') throw err
    return null
  }
}

// fetch_url 策略二：直接 HTTP + 正则 HTML 转文本（兜底，适合简单静态页）
async function fetchViaDirect(url, signal, { expectJson = false } = {}) {
  const merged = createMergedAbortSignal(signal, 12000)
  try {
    const res = await fetch(url, { headers: WEB_HEADERS, signal: merged?.signal })
    merged?.cleanup()
    if (!res.ok) return { ok: false, status: res.status }
    const contentType = res.headers.get('content-type') || ''
    if (contentType && !/text|html|xml|json/i.test(contentType)) {
      return { ok: false, status: res.status, content_type: contentType }
    }
    const raw = await res.text()
    // JSON/API 响应：原样返回（能 parse 就顺手美化），不走 htmlToText 以免破坏结构
    const looksJson = (expectJson || /json/i.test(contentType)) && /^\s*[\[{]/.test(raw)
    if (looksJson) {
      let body = raw.trim()
      try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch {}
      return { ok: true, status: res.status, title: '', body, is_json: true }
    }
    const text = htmlToText(raw)
    const title = extractTitle(raw)
    if (isLowValuePageText(text)) return { ok: false, status: res.status, title, low_value: true }
    return { ok: true, status: res.status, title, body: text }
  } catch (err) {
    merged?.cleanup()
    if (err.name === 'AbortError') throw err
    return { ok: false, error: err.message }
  }
}

// fetch_url 兜底：Jina 和直连都失败时，自动用真实浏览器渲染（处理 JS / 反爬），
// 不再依赖模型手动想起来调 browser_read。纯 404 / DNS / 网络层错误浏览器也救不了，短路返回。
async function fetchUrlBrowserFallback(url, args, context, directResult = {}) {
  const status = directResult.status
  // 只有像「被反爬 / JS 渲染 / 未知失败」时才值得花时间起浏览器
  const worthBrowser =
    directResult.low_value === true ||
    status === 403 || status === 429 || status === 503 ||
    (status == null && !directResult.error)

  if (args.no_browser_fallback || !worthBrowser) {
    const hint = directResult.low_value
      ? 'The page requires JavaScript or blocks crawlers. Use browser_read instead.'
      : 'This page could not be read. Use web_search to find another accessible source.'
    return webJson({
      ok: false, tool: 'fetch_url', url,
      status: directResult.status,
      content_type: directResult.content_type,
      error: directResult.error || (directResult.low_value ? 'no readable content' : `HTTP ${directResult.status}`),
      hint,
    })
  }

  console.log(`[fetch_url] auto-upgrading to browser_read: ${url}`)
  const browserRaw = await execBrowserRead(
    { url, max_chars: args.max_chars || args.maxChars, timeout_ms: args.timeout_ms || args.timeout },
    context,
  )
  let parsed
  try { parsed = JSON.parse(browserRaw) } catch { return browserRaw }
  // 标注为 fetch_url 自动升级的结果；成功则缓存，避免重复渲染
  parsed.tool = 'fetch_url'
  parsed.fetch_source = 'browser_read'
  parsed.auto_upgraded = true
  if (parsed.ok) {
    urlCache.set(url, { payload: parsed, fetchedAt: Date.now() })
  } else if (!parsed.hint) {
    parsed.hint = 'Both lightweight fetch and full browser rendering failed. Use web_search to find another source.'
  }
  return webJson(parsed)
}

// fetch_url: open a known URL, extract readable text, and return structured JSON.
export async function execFetchUrl(args, context = {}) {
  throwIfAborted(context.signal)
  const url = normalizeWebUrl(args.url || args.URL || args.link || args.href || args.uri)
  if (!url) return webJson({ ok: false, tool: 'fetch_url', error: 'missing url' })

  const cached = urlCache.get(url)
  const ttl = getUrlTtl(url)
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60000)
    return webJson({ ...cached.payload, cached: true, cache_age_minutes: ageMin })
  }

  console.log(`[fetch_url] -> ${url}`)

  throwIfAborted(context.signal)
  let title = ''
  let text = ''
  let fetchSource = ''
  let httpStatus = null
  let isJson = false

  if (isLikelyApiUrl(url)) {
    // JSON/API 端点：直连优先（Jina 会把 JSON 当网页渲染，慢且破坏结构）
    const directResult = await fetchViaDirect(url, context.signal, { expectJson: true })
    if (directResult.ok) {
      fetchSource = 'direct'
      httpStatus = directResult.status
      title = directResult.title || ''
      text = directResult.body || ''
      isJson = !!directResult.is_json
    } else {
      // 直连失败 → 退回 Jina；Jina 也不行 → 浏览器兜底
      console.log(`[fetch_url] api direct failed (${directResult.status || directResult.error || '?'}), trying jina: ${url}`)
      const jinaResult = await fetchViaJina(url, context.signal)
      if (jinaResult) {
        fetchSource = 'jina'
        title = jinaResult.title
        text = jinaResult.body
      } else {
        return await fetchUrlBrowserFallback(url, args, context, directResult)
      }
    }
  } else {
    // 普通网页：Jina Reader 优先（JS 页面、Cloudflare 防护、正文提取质量最好）
    const jinaResult = await fetchViaJina(url, context.signal)
    if (jinaResult) {
      fetchSource = 'jina'
      title = jinaResult.title
      text = jinaResult.body
    } else {
      // 直连兜底（静态页）；再失败 → 自动升级到真实浏览器渲染
      console.log(`[fetch_url] jina failed, trying direct: ${url}`)
      const directResult = await fetchViaDirect(url, context.signal)
      if (directResult.ok) {
        fetchSource = 'direct'
        httpStatus = directResult.status
        title = directResult.title || ''
        text = directResult.body || ''
      } else {
        return await fetchUrlBrowserFallback(url, args, context, directResult)
      }
    }
  }

  const MAX = 5000
  const isLong = !isJson && text.length >= ARTICLE_LENGTH_THRESHOLD
  let bodyPath = null
  let bodyBytes = null
  if (isLong) {
    try {
      const saved = saveLongArticle({ url, finalUrl: url, title, body: text, source: fetchSource })
      bodyPath = saved.path
      bodyBytes = saved.bytes
    } catch (err) {
      console.warn(`[fetch_url] 长文落盘失败: ${err.message}`)
    }
  }
  const content = isLong
    ? `${text.slice(0, ARTICLE_SUMMARY_EXCERPT)}\n\n...`
    : (text.length > MAX ? `${text.slice(0, MAX)}\n\n...` : text)
  const payload = {
    ok: true,
    tool: 'fetch_url',
    url,
    status: httpStatus,
    fetch_source: fetchSource,
    is_json: isJson || undefined,
    title,
    content,
    truncated: isLong || text.length > MAX,
    content_length: text.length,
    body_path: bodyPath,
    body_bytes: bodyBytes,
    hint: bodyPath
      ? `Long article saved. Full text at sandbox path: ${bodyPath}. Use read_file to open it.`
      : 'Use this page content with other sources if needed, then answer the user.',
  }

  urlCache.set(url, { payload, fetchedAt: Date.now() })
  return webJson(payload)
}
