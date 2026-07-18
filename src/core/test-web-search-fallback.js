// 独立测试：故意搞坏配置，验证 fallback 链 + 失败聚合 + Bing 解包等
// 用法：cd D:\claude\Jarvis && node src/test-web-search-fallback.js

// !! 在 import executor 之前先污染环境，确保 readWebConfig 第一次读到的就是坏值
process.env.SERPER_API_KEY = 'INVALID_KEY_FOR_FALLBACK_TEST'
// SEARXNG_URL 留空，让 SearXNG 引擎返 null（未配置，被跳过）

// 检查 config.json 有没有 stored serper key（stored 优先于 env，会让 INVALID env 失效）
import fs from 'fs'
import { paths } from './paths.js'
try {
  const cfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))
  if (cfg.serper_api_key) {
    console.log('[setup] config.json 里有 serper_api_key，stored 会优先于 env，本测试不会真正失败 Serper。')
    console.log('[setup] 要纯粹测 fallback，请在 UI 里清空 Serper key，或临时改 config.json。')
  }
} catch {}

const { executeTool } = await import('./capabilities/executor.js')

function summarize(raw) {
  try { return JSON.parse(raw) } catch { return { _raw: String(raw).slice(0, 200) } }
}

async function run(label, args) {
  const t0 = Date.now()
  let parsed
  try {
    parsed = summarize(await executeTool('web_search', args, {}))
  } catch (err) {
    parsed = { _threw: err.message || String(err) }
  }
  const ms = Date.now() - t0
  console.log(`\n=== ${label}  (${ms}ms) ===`)
  if (parsed.ok) {
    console.log(`ok=true source=${parsed.source} count=${parsed.results?.length}`)
    for (const r of (parsed.results || []).slice(0, 2)) {
      console.log(`  - [${r.title.slice(0, 60)}] ${r.url}`)
    }
  } else {
    console.log(`ok=false error=${parsed.error || parsed._threw}`)
    if (parsed.failures) {
      console.log('failures:')
      for (const f of parsed.failures) console.log(`  - ${f.engine}: ${f.reason}`)
    }
  }
}

console.log('=== fallback chain test (Serper key forced invalid) ===')

// 1. 真正想测的：Serper 401/403 → fallback 到 SearXNG (跳过) → Bing → ...
await run('Serper 坏 key → 自动 fallback', { query: 'github copilot pricing 2025', limit: 5 })

// 2. SearXNG URL 格式错误（同时把 SearXNG 也填上坏 URL，看 schema 校验）
//    注意：5s TTL 内 readWebConfig 不会重读，需要等过期或换 env 实测较难，
//    这里只是验证 schema 校验路径
process.env.SEARXNG_URL = 'not-a-valid-url'
console.log('\n[setup] sleep 6s to let webConfig cache expire...')
await new Promise(r => setTimeout(r, 6000))
await run('SearXNG URL 没协议头 → SearXNG 应自报失败', { query: 'rust async runtime tokio vs async-std', limit: 3 })
