// browser_read：用真实 headless Chromium 渲染页面、滚动、抽正文。
import { throwIfAborted } from '../../abort-utils.js'
import {
  WEB_HEADERS, webJson, normalizeWebUrl, isLowValuePageText,
  saveLongArticle, ARTICLE_LENGTH_THRESHOLD, ARTICLE_SUMMARY_EXCERPT,
} from './util.js'
import { getSharedBrowser, invalidateSharedBrowser, autoScrollPage, BROWSER_VIEWPORT } from './browser.js'

export async function execBrowserRead(args, context = {}) {
  throwIfAborted(context.signal)
  const url = normalizeWebUrl(args.url || args.URL || args.link || args.href || args.uri)
  if (!url) return webJson({ ok: false, tool: 'browser_read', error: 'missing url' })

  const timeoutMs = Math.max(5000, Math.min(Number(args.timeout_ms || args.timeout || 20000), 45000))
  const maxChars = Math.max(1000, Math.min(Number(args.max_chars || args.maxChars || 8000), 12000))
  console.log(`[browser_read] -> ${url}`)

  let browserContext = null
  let page = null
  try {
    // 复用单例浏览器，避免每次冷启动 Chromium（约 3~5 秒）
    const browser = await getSharedBrowser()
    browserContext = await browser.newContext({
      viewport: BROWSER_VIEWPORT,
      locale: 'zh-CN',
      userAgent: WEB_HEADERS['User-Agent'],
    })
    page = await browserContext.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    // networkidle 可能挂死，限制等待时间
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8000) }).catch(() => {})
    await autoScrollPage(page, context.signal)

    const title = (await page.title()).trim()
    const text = await page.evaluate(() => {
      ;['script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'header', 'footer', 'nav'].forEach(
        tag => document.querySelectorAll(tag).forEach(el => el.remove())
      )
      // 优先取语义容器，取文本最长的那个
      const candidates = [
        ...document.querySelectorAll('article, main, [role="main"], .article, .post, .content, .entry-content, #content, #main'),
      ]
      const best = candidates
        .map(el => ({ el, text: (el.innerText || '').trim() }))
        .sort((a, b) => b.text.length - a.text.length)[0]
      return (best?.text && best.text.length > 300 ? best.text : document.body?.innerText || '').trim()
    })
    const finalUrl = page.url()

    if (isLowValuePageText(text)) {
      return webJson({
        ok: false,
        tool: 'browser_read',
        url,
        final_url: finalUrl,
        title,
        error: 'no readable content rendered',
        content_preview: String(text || '').slice(0, 300),
        content_length: String(text || '').length,
        hint: 'The browser opened the page, but did not find readable article text. The page may require login, CAPTCHA, or block automation. Try another source.',
      })
    }

    const isLong = text.length >= ARTICLE_LENGTH_THRESHOLD
    let bodyPath = null
    let bodyBytes = null
    if (isLong) {
      try {
        const saved = saveLongArticle({ url, finalUrl, title, body: text, source: 'browser_read' })
        bodyPath = saved.path
        bodyBytes = saved.bytes
      } catch (err) {
        console.warn(`[browser_read] 长文落盘失败: ${err.message}`)
      }
    }
    const content = isLong
      ? `${text.slice(0, ARTICLE_SUMMARY_EXCERPT)}\n\n...`
      : (text.length > maxChars ? `${text.slice(0, maxChars)}\n\n...` : text)
    return webJson({
      ok: true,
      tool: 'browser_read',
      url,
      final_url: finalUrl,
      title,
      content,
      truncated: isLong || text.length > maxChars,
      content_length: text.length,
      body_path: bodyPath,
      body_bytes: bodyBytes,
      hint: bodyPath
        ? `Long article saved. Full text at sandbox path: ${bodyPath}. Use read_file to open it.`
        : 'Rendered page content extracted by Chromium.',
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    // 浏览器崩溃或断开时，清掉单例让下次重建
    invalidateSharedBrowser()
    return webJson({
      ok: false,
      tool: 'browser_read',
      url,
      error: err.message || String(err),
      hint: 'Browser rendering failed. Try fetch_url or another accessible source.',
    })
  } finally {
    // 关 context（含页面），不关 browser（单例复用）
    try { await page?.close() } catch {}
    try { await browserContext?.close() } catch {}
  }
}
