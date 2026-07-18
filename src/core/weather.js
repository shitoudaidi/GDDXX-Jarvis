// 天气上下文注入模块
// 触发关键词 → 拉取用户当前城市天气 → 格式化为参考上下文注入提示词
// 不要求模型必须回复天气，天气是上下文信息，模型按需使用

import { getConfig, setConfig } from './db.js'

const CACHE_TTL_MS = 30 * 60 * 1000  // 30 分钟
const FETCH_TIMEOUT_MS = 6000

// 触发天气注入的关键词（中英双语）
const WEATHER_RE = /天气|气温|温度|下雨|下雪|晴天?|阴天?|多云|刮风|风大|雾霾|冷不冷|热不热|穿什么|穿衣|要下[雨雪]|今天冷|今天热|weather|forecast|raining|snowing|temperature|how.*cold|how.*hot/i

let cache = null  // { location, formatted, cardProps, fetchedAt }

const WEATHER_LOCATION_ALIASES = [
  { re: /汕尾.*陆丰|陆丰.*汕尾/i, value: 'Lufeng Shanwei Guangdong' },
  { re: /陆丰/i, value: 'Lufeng Shanwei Guangdong' },
  { re: /汕尾/i, value: 'Shanwei Guangdong' },
  { re: /上海/i, value: 'Shanghai China' },
  { re: /广州/i, value: 'Guangzhou Guangdong China' },
  { re: /北京/i, value: 'Beijing China' },
  { re: /深圳/i, value: 'Shenzhen Guangdong China' },
  { re: /杭州/i, value: 'Hangzhou Zhejiang China' },
]

const LOCATION_PREFIX_RE = /^(?:呃|嗯|啊|那个|帮我|麻烦|请|给我|打开|开一下|查看|看一下|看下|查一下|查下|查询|搜一下|搜下|问一下|问下|告诉我|看看|一下|我)+/u
const LOCATION_NOISE_RE = /^(?:今天|明天|后天|现在|当前|实时|本地|当地|这里|我这边|附近|周边|未来|最近|怎么样|如何|咋样|怎样|好吗|好不好)+$/u

function normalizeWeatherLocation(location = '') {
  let loc = String(location || '')
    .replace(/[，。？！；、,.!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LOCATION_PREFIX_RE, '')
    .replace(/(?:今天|明天|后天|现在|当前|实时|未来(?:三天|两天|几天)?|最近|这几天|一下|打开|查看|我|的|怎么样|如何|咋样|怎样|好吗|好不好)/gu, '')
    .trim()

  if (!loc || LOCATION_NOISE_RE.test(loc)) return ''
  for (const item of WEATHER_LOCATION_ALIASES) {
    if (item.re.test(loc)) return item.value
  }
  return loc
}

export function extractWeatherLocation(message = '') {
  const text = String(message || '').trim()
  if (!text) return ''

  const chineseBefore = text.match(/([\u4e00-\u9fa5A-Za-z\s,，.-]{1,50}?)(?:的)?(?:天气|气温|温度|预报)/u)
  const beforeLoc = normalizeWeatherLocation(chineseBefore?.[1] || '')
  if (beforeLoc) return beforeLoc

  const chineseAfter = text.match(/(?:天气|气温|温度|预报)(?:在|查|看|:|：)?\s*([\u4e00-\u9fa5A-Za-z\s,，.-]{1,50})/u)
  const afterLoc = normalizeWeatherLocation(chineseAfter?.[1] || '')
  if (afterLoc) return afterLoc

  const english = text.match(/(?:weather|forecast|temperature)\s+(?:in|for|of)?\s*([A-Za-z][A-Za-z\s,.-]{1,50})/i)
  return normalizeWeatherLocation(english?.[1] || '')
}

function resolveWeatherLocation(message = '') {
  return extractWeatherLocation(message) || getUserLocation()
}

/* ── 位置存取 ── */

export function getUserLocation() {
  return (getConfig('user_location') || '').trim()
}

export function setUserLocation(city) {
  const loc = String(city || '').trim()
  if (!loc) return
  setConfig('user_location', loc)
  cache = null  // 位置变了，让缓存失效
  console.log(`[天气] 用户位置已更新：${loc}`)
}

/* ── 缓存检查 ── */

function isCacheFresh(location) {
  if (!cache || cache.location !== location) return false
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS
}

/* ── 拉取 & 解析 wttr.in ── */

async function fetchWeatherData(location) {
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh`
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': 'JarvisLocalAgent/1.0 (+https://localhost)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const WEATHER_DESC_ZH = {
  'Sunny': '晴',
  'Clear': '晴',
  'Partly cloudy': '多云',
  'Cloudy': '阴天',
  'Overcast': '阴云密布',
  'Mist': '薄雾',
  'Fog': '雾',
  'Freezing fog': '冻雾',
  'Light rain': '小雨',
  'Light rain shower': '小阵雨',
  'Moderate rain': '中雨',
  'Heavy rain': '大雨',
  'Light snow': '小雪',
  'Moderate snow': '中雪',
  'Heavy snow': '大雪',
  'Blizzard': '暴风雪',
  'Thundery outbreaks possible': '可能有雷暴',
  'Patchy rain possible': '局部有雨',
  'Patchy rain nearby': '局部有雨',
  'Patchy snow possible': '局部有雪',
  'Blowing snow': '吹雪',
  'Light drizzle': '细雨',
  'Freezing drizzle': '冻雨',
  'Heavy freezing drizzle': '强冻雨',
  'Light sleet': '小冻雨',
  'Moderate or heavy sleet': '中到大冻雨',
  'Thundery outbreaks in nearby': '附近有雷暴',
  'Patchy light rain with thunder': '局部雷阵雨',
  'Moderate or heavy rain with thunder': '雷雨',
}

function localizeDesc(desc = '') {
  return WEATHER_DESC_ZH[desc] || desc
}

function parseWeatherData(data, location) {
  const cur = data?.current_condition?.[0]
  if (!cur) return null

  const areaName = data?.nearest_area?.[0]?.areaName?.[0]?.value
  const desc = localizeDesc(cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || '')
  const tempC = Number(cur.temp_C)
  const feelsC = Number(cur.FeelsLikeC)
  const humidity = cur.humidity
  const windKmph = cur.windspeedKmph
  const windDir = cur.winddir16Point || ''
  const visKm = cur.visibility

  const today = data?.weather?.[0]
  const maxC = today?.maxtempC
  const minC = today?.mintempC

  const forecastDays = (data?.weather || []).slice(1, 3).map(d => ({
    day: d.date || '',
    condition: localizeDesc(d.hourly?.[4]?.lang_zh?.[0]?.value || d.hourly?.[4]?.weatherDesc?.[0]?.value || ''),
    high: Number(d.maxtempC),
    low: Number(d.mintempC),
  }))

  const formatted = [
    `📍 ${location} 实时天气`,
    `天气：${desc}  气温：${tempC}°C（体感 ${feelsC}°C）`,
    `今日：${minC}～${maxC}°C  湿度：${humidity}%  风：${windDir} ${windKmph} km/h`,
    ...(visKm && Number(visKm) < 10 ? [`能见度：${visKm} km`] : []),
    ...(forecastDays.length ? [`未来预报：\n${forecastDays.map(d => `  ${d.day}  ${d.low}～${d.high}°C  ${d.condition}`).join('\n')}`] : []),
  ].join('\n')

  const cardProps = {
    city: areaName || location,
    temp: tempC,
    condition: desc,
    feel: feelsC,
    high: Number(maxC),
    low: Number(minC),
    wind: windDir ? `${windDir} ${windKmph} km/h` : `${windKmph} km/h`,
    forecast: forecastDays,
  }

  return { formatted, cardProps }
}

/* ── 公开 API ── */

// Wave 1：in-flight promise dedup —— runRuntimeInjector 并发后 buildWeatherRuntimeContext
//   和 getWeatherCardProps 会同时调本函数，cache 未 fresh 时两个都会发 HTTP。
//   用 inflight map 让同 location 的并发请求共享一个 promise。
const inflight = new Map()

export async function fetchAndCacheWeather(location) {
  if (!location) return null
  if (isCacheFresh(location)) return cache

  // 同 location 的请求已经在跑 → 直接复用
  if (inflight.has(location)) return inflight.get(location)

  const promise = (async () => {
    try {
      console.log(`[天气] 拉取 ${location} 天气...`)
      const data = await fetchWeatherData(location)
      const parsed = parseWeatherData(data, location)
      if (!parsed) return null
      cache = { location, ...parsed, fetchedAt: Date.now() }
      return cache
    } catch (err) {
      console.warn(`[天气] 拉取失败：${err.message}`)
      return (cache?.location === location) ? cache : null
    } finally {
      inflight.delete(location)
    }
  })()
  inflight.set(location, promise)
  return promise
}

export function isWeatherQuery(message = '') {
  return WEATHER_RE.test(String(message))
}

// 关键词触发 → 注入天气上下文（异步）
// 返回空字符串表示不注入；同时在 cache.cardProps 里存放卡片数据
export async function buildWeatherRuntimeContext(message = '') {
  if (!isWeatherQuery(message)) return ''

  const location = resolveWeatherLocation(message)
  if (!location) return ''

  const result = await fetchAndCacheWeather(location)
  if (!result?.formatted) return ''

  const age = result.fetchedAt
    ? Math.round((Date.now() - result.fetchedAt) / 60000)
    : 0

  return `## Weather Reference
The following live weather was automatically fetched by the system. Treat it only as background context; do not proactively read or summarize it. Cite it only when useful.
Data age: about ${age} minutes (refreshed every 30 minutes)

${result.formatted}`
}

// 关键词触发时返回 WeatherCard 所需 props；无数据返回 null
export async function getWeatherCardProps(message = '') {
  if (!isWeatherQuery(message)) return null

  const location = resolveWeatherLocation(message)
  if (!location) return null

  const result = await fetchAndCacheWeather(location)
  return result?.cardProps ?? null
}
