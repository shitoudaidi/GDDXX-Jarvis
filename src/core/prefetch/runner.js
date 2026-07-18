import { savePrefetchCache, clearExpiredPrefetchCache, getEnabledPrefetchTasks } from '../db.js'

// 解析 wttr.in JSON，提取完整天气信息
function parseWttrJson(data, cityName) {
  const cur = data.current_condition?.[0]
  if (!cur) return '天气数据解析失败'

  const desc = cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || ''
  const tempC = cur.temp_C
  const feelsC = cur.FeelsLikeC
  const humidity = cur.humidity
  const windKmph = cur.windspeedKmph
  const windDir = cur.winddir16Point
  const cloudcover = cur.cloudcover
  const visibility = cur.visibility
  const uvIndex = cur.uvIndex
  const precip = cur.precipMM

  const lines = [
    `【当前】${desc}，${tempC}°C（体感 ${feelsC}°C）`,
    `湿度 ${humidity}%  | 云量 ${cloudcover}%  | 能见度 ${visibility}km  | UV ${uvIndex}`,
    `风 ${windDir} ${windKmph}km/h  | 降水 ${precip}mm`,
  ]

  const forecast = data.weather?.slice(0, 3) || []
  if (forecast.length) {
    lines.push('')
    lines.push('【预报】')
    forecast.forEach(day => {
      const dayDesc = day.hourly?.[4]?.lang_zh?.[0]?.value || day.hourly?.[4]?.weatherDesc?.[0]?.value || ''
      const rainChance = Math.max(...(day.hourly?.map(h => Number(h.chanceofrain) || 0) || [0]))
      const snowChance = Math.max(...(day.hourly?.map(h => Number(h.chanceofsnow) || 0) || [0]))
      const maxWind = Math.max(...(day.hourly?.map(h => Number(h.windspeedKmph) || 0) || [0]))
      const totalPrecip = (day.hourly?.reduce((s, h) => s + Number(h.precipMM || 0), 0) || 0).toFixed(1)
      let extra = `雨概率${rainChance}%`
      if (snowChance > 0) extra += `  雪概率${snowChance}%`
      extra += `  最大风速${maxWind}km/h  降水${totalPrecip}mm`
      lines.push(`${day.date}  ${dayDesc}  最高${day.maxtempC}°C / 最低${day.mintempC}°C  ${extra}`)
    })
  }

  return lines.join('\n')
}

async function fetchWeather(city) {
  const res = await globalThis.fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return parseWttrJson(data, city)
}

// 预热任务定义
// fetch 函数只做数据获取，不写 DB——runner 统一写
const TASKS = [
  {
    source: 'weather:Beijing',
    ttlMinutes: 60,
    tags: ['weather', 'Beijing', '北京', '天气'],
    label: '北京天气',
    async fetch() { return fetchWeather('Beijing') },
  },
  {
    source: 'weather:Lufeng',
    ttlMinutes: 60,
    tags: ['weather', 'Lufeng', '陆丰', '天气'],
    label: '陆丰天气',
    async fetch() { return fetchWeather('Lufeng') },
  },
  {
    source: 'news:hackernews',
    ttlMinutes: 30,
    tags: ['news', '新闻', 'tech', 'hackernews'],
    label: 'HackerNews 热榜',
    async fetch() {
      const res = await globalThis.fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(8000) })
      const ids = (await res.json()).slice(0, 5)
      const items = await Promise.all(
        ids.map(id =>
          globalThis.fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(5000) })
            .then(r => r.json())
        )
      )
      return items.map((item, i) => `${i + 1}. ${item.title}`).join('\n')
    },
  },
]

// 外部可注册自定义任务（代码级，用于内置扩展）
const customTasks = []
export function registerPrefetchTask(task) {
  customTasks.push(task)
}

// 把 DB 里的动态任务转成统一格式
function buildDbTasks() {
  return getEnabledPrefetchTasks().map(row => ({
    source: row.source,
    label: row.label,
    ttlMinutes: row.ttl_minutes,
    tags: JSON.parse(row.tags || '[]'),
    async fetch() {
      const res = await globalThis.fetch(row.url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      return text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{3,}/g, '\n')
        .trim()
        .slice(0, 2000)
    },
  }))
}

// 执行预热
// taskSources: string[] 指定只跑哪些 source，不传则全跑
export async function runPrefetch(taskSources = null) {
  clearExpiredPrefetchCache()

  const allTasks = [...TASKS, ...customTasks, ...buildDbTasks()]
  const targets = taskSources
    ? allTasks.filter(t => taskSources.includes(t.source))
    : allTasks

  if (targets.length === 0) {
    console.log('[预热] 没有匹配的任务')
    return []
  }

  const results = await Promise.allSettled(
    targets.map(async task => {
      const content = await task.fetch()
      savePrefetchCache(task.source, content, task.ttlMinutes, task.tags)
      console.log(`[预热] ✓ ${task.label || task.source}`)
      return { source: task.source, ok: true }
    })
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[预热] ✗ ${targets[i].label || targets[i].source}：${r.reason?.message || r.reason}`)
    }
  })

  return results
}
