/**
 * trending.js
 *
 * 启动时采集网络热点信息，注入 system prompt。
 *
 * 中国（country_code === 'CN'）→ 微博热搜 + 知乎热榜（vvhan 聚合，无需 Key）
 * 其他地区               → HackerNews Top 10 + Reddit worldnews Top 8
 *
 * 缓存策略：1 小时内复用；country_code 变化时强制重新采集。
 *
 * 对外接口：
 *   collectTrending(countryCode)  → 启动时调用一次，async
 *   getTrendingBlock()            → 返回注入 prompt 的纯文本块，同步
 */

import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'

const TRENDING_FILE    = path.join(paths.dataDir, 'trending.json')
const TRENDING_VERSION = 1
const TRENDING_CACHE_MS = 60 * 60 * 1000  // 1 小时

let _cached = null

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

async function fetchJSON(url, options = {}, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─── 中国热点 ─────────────────────────────────────────────────────────────────

async function fetchVvhan(type) {
  const data = await fetchJSON('https://api.vvhan.com/api/hotlist?type=' + type, {}, 8000)
  if (!data?.success || !Array.isArray(data.data)) return null
  return data.data
    .slice(0, 10)
    .map(item => ({ title: item.title || '', hot: item.hot || item.heat || '' }))
    .filter(item => item.title)
}

// ─── 全球热点 ─────────────────────────────────────────────────────────────────

async function fetchHackerNews() {
  const ids = await fetchJSON('https://hacker-news.firebaseio.com/api/v0/topstories.json', {}, 6000)
  if (!Array.isArray(ids) || ids.length === 0) return null

  const results = await Promise.allSettled(
    ids.slice(0, 10).map(id =>
      fetchJSON('https://hacker-news.firebaseio.com/api/v0/item/' + id + '.json', {}, 4000)
    )
  )

  return results
    .filter(r => r.status === 'fulfilled' && r.value?.title)
    .map(r => ({ title: r.value.title, score: r.value.score || 0 }))
}

async function fetchReddit() {
  const data = await fetchJSON(
    'https://www.reddit.com/r/worldnews/hot.json?limit=12',
    { headers: { 'User-Agent': 'JarvisLocalAgent/1.0 (personal-assistant)' } },
    8000
  )
  if (!Array.isArray(data?.data?.children)) return null
  return data.data.children
    .map(c => c.data)
    .filter(d => d?.title && !d.stickied)
    .slice(0, 8)
    .map(d => ({ title: d.title, score: d.score || 0 }))
}

// ─── 核心：采集 + 落盘 ────────────────────────────────────────────────────────

export async function collectTrending(countryCode = null) {
  // 读取缓存
  let stored = null
  if (fs.existsSync(TRENDING_FILE)) {
    stored = safe(() => JSON.parse(fs.readFileSync(TRENDING_FILE, 'utf8')))
  }

  const cacheAge = stored?.fetched_at
    ? Date.now() - new Date(stored.fetched_at).getTime()
    : Infinity
  const countryUnchanged = stored?.country_code === countryCode

  if (stored?.version === TRENDING_VERSION && cacheAge < TRENDING_CACHE_MS && countryUnchanged) {
    console.log('[trending] 热点缓存有效，跳过重新采集')
    _cached = stored
    return stored
  }

  const isCN = countryCode === 'CN'
  console.log('[trending] 采集热点（' + (isCN ? '中国' : '全球') + '模式)...')

  const sources = []

  if (isCN) {
    const [weibo, zhihu] = await Promise.allSettled([
      fetchVvhan('weibo'),
      fetchVvhan('zhihu'),
    ])
    if (weibo.status === 'fulfilled' && weibo.value?.length) {
      sources.push({ name: '微博热搜', items: weibo.value })
    }
    if (zhihu.status === 'fulfilled' && zhihu.value?.length) {
      sources.push({ name: '知乎热榜', items: zhihu.value })
    }
  } else {
    const [hn, reddit] = await Promise.allSettled([
      fetchHackerNews(),
      fetchReddit(),
    ])
    if (hn.status === 'fulfilled' && hn.value?.length) {
      sources.push({ name: 'HackerNews', items: hn.value })
    }
    if (reddit.status === 'fulfilled' && reddit.value?.length) {
      sources.push({ name: 'Reddit (worldnews)', items: reddit.value })
    }
  }

  const result = {
    version:      TRENDING_VERSION,
    country_code: countryCode,
    mode:         isCN ? 'cn' : 'global',
    sources,
    fetched_at:   new Date().toISOString(),
  }

  safe(() => fs.writeFileSync(TRENDING_FILE, JSON.stringify(result, null, 2), 'utf8'))
  _cached = result

  const total = sources.reduce((sum, s) => sum + s.items.length, 0)
  console.log('[trending] 完成 — ' + sources.length + ' 个来源，共 ' + total + ' 条热点')
  return result
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 返回注入 system prompt 的纯文本块。
 * 必须在 collectTrending() 完成后调用。
 */
export function getTrendingBlock() {
  if (!_cached?.sources?.length) return ''

  const modeLabel = _cached.mode === 'cn' ? 'China' : 'Global'
  const lines = ['## Trending Now (' + modeLabel + ')']

  for (const source of _cached.sources) {
    lines.push('')
    lines.push('### ' + source.name)
    source.items.forEach((item, i) => {
      let line = (i + 1) + '. ' + item.title
      if (item.hot)   line += ' (' + item.hot + ')'
      if (item.score) line += ' (' + item.score + ' pts)'
      lines.push(line)
    })
  }

  return lines.join('\n')
}
