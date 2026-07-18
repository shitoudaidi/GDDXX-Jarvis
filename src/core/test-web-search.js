// 独立测试 web_search 工具：直接调真实引擎，不 mock
// 用法：cd D:\claude\Jarvis && node src/test-web-search.js

import { executeTool } from './capabilities/executor.js'

function summarize(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return { _raw: String(raw).slice(0, 200) }
  }
}

async function run(label, args) {
  const t0 = Date.now()
  let parsed
  try {
    const raw = await executeTool('web_search', args, {})
    parsed = summarize(raw)
  } catch (err) {
    parsed = { _threw: err.message || String(err) }
  }
  const ms = Date.now() - t0
  console.log(`\n=== ${label}  (${ms}ms) ===`)
  if (parsed.ok) {
    console.log(`ok=true source=${parsed.source} cached=${parsed.cached || false} count=${parsed.results?.length}`)
    for (const r of (parsed.results || []).slice(0, 3)) {
      console.log(`  - [${r.title.slice(0, 60)}] ${r.url}`)
      if (r.snippet) console.log(`    ${r.snippet.slice(0, 100)}...`)
    }
  } else {
    console.log(`ok=false error=${parsed.error || parsed._threw || '?'}`)
    if (parsed.failures) {
      for (const f of parsed.failures) console.log(`    ${f.engine}: ${f.reason}`)
    }
  }
  return parsed
}

async function main() {
  console.log('=== Web Search Tool — Smoke Test ===')
  console.log('Config: SERPER_API_KEY =', process.env.SERPER_API_KEY ? `set (${process.env.SERPER_API_KEY.slice(0, 6)}...)` : 'not set')
  console.log('Config: SEARXNG_URL =', process.env.SEARXNG_URL || 'not set')

  // 1. 中文 query
  await run('中文 query', { query: 'Anthropic Claude 最新模型', limit: 5 })

  // 2. 英文 query（应触发自适应 gl=us/hl=en，但只有 Serper 会用到）
  await run('英文 query', { query: 'OpenAI o3 reasoning benchmark', limit: 5 })

  // 3. 缓存命中（同 query/limit 立即重发）
  await run('cache hit', { query: 'Anthropic Claude 最新模型', limit: 5 })

  // 4. 空 query
  await run('missing query', { query: '' })

  // 5. limit 边界（max 8）
  await run('limit=20 应被夹到 8', { query: 'electron app build error', limit: 20 })

  // 6. 超长 query（测日志截断）
  await run('超长 query 测日志截断', { query: 'test '.repeat(50) + 'long query', limit: 3 })

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
