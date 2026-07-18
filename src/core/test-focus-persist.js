// Test: focus_stack 持久化往返 —— 动态上下文记忆池 5c 步
//
// 拉一个临时 sqlite，跑 schema migration，调 saveFocusStack + loadFocusStack
// 验证圆滚（round-trip）：写入 N 帧 → 读出 N 帧，字段全部一致、顺序保持。
//
// 已知运行限制：
//   - better-sqlite3 是 native add-on，ABI 必须匹配 Node 版本。在系统 Node
//     和 Electron 嵌入 Node 之间会出现 NODE_MODULE_VERSION 不一致——这种
//     情况下本测试无法 `node src/test-focus-persist.js` 直接跑。生产构建里
//     由 electron-builder 重编译，运行无碍。
//   - 测试本身只用本模块导出的 saveFocusStack / loadFocusStack（不打开 UI、
//     不连 LLM），所以一旦 better-sqlite3 能 require 成功就能通过。
//
// 跑法：
//   cd D:\claude\Jarvis\.claude\worktrees\step-5c
//   node src/test-focus-persist.js
//
// 如果 ABI 不匹配报错，请：
//   npm rebuild better-sqlite3
// 或者直接走 npm run dev 路径（dev 用系统 Node，rebuild 通常已经做好）。

import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function main() {
  // 用临时目录覆盖 paths.dbFile，避免污染真实库
  const tmpDir = mkdtempSync(join(tmpdir(), 'focus-persist-test-'))
  const tmpDb = join(tmpDir, 'jarvis.db')
  process.env.JARVIS_DB_PATH_OVERRIDE = tmpDb  // 兜底；如 paths.js 未读这个变量则下一行的 monkey-patch 起作用

  // monkey-patch paths.dbFile：在 db.js 被 import 前替换
  const pathsModule = await import('./paths.js')
  pathsModule.paths.dbFile = tmpDb
  console.log(`[test] using temp db: ${tmpDb}`)

  const { saveFocusStack, loadFocusStack, getDB } = await import('./db.js')

  // 触发 schema 初始化
  getDB()

  // 1. 空栈往返
  let loaded = loadFocusStack()
  assert.deepEqual(loaded, [], 'empty db should load to []')
  console.log('[test] empty round-trip OK')

  // 2. 单帧
  const oneFrame = [{
    topic: ['编程', '调试'],
    startedAt: '2026-05-19T10:00:00.000Z',
    startedAtTick: 100,
    lastSeenTick: 110,
    hitCount: 5,
    conclusions: [],
  }]
  saveFocusStack(oneFrame)
  loaded = loadFocusStack()
  assert.equal(loaded.length, 1)
  assert.deepEqual(loaded[0].topic, ['编程', '调试'])
  assert.equal(loaded[0].startedAtTick, 100)
  assert.equal(loaded[0].lastSeenTick, 110)
  assert.equal(loaded[0].hitCount, 5)
  assert.deepEqual(loaded[0].conclusions, [])
  console.log('[test] single-frame round-trip OK')

  // 3. 多帧 + conclusions 非空
  const threeFrames = [
    {
      topic: ['主线A'],
      startedAt: '2026-05-19T09:00:00.000Z',
      startedAtTick: 50,
      lastSeenTick: 200,
      hitCount: 30,
      conclusions: ['我把 A 模块的 bug 修了'],
    },
    {
      topic: ['子主题B', '调研'],
      startedAt: '2026-05-19T09:30:00.000Z',
      startedAtTick: 80,
      lastSeenTick: 150,
      hitCount: 10,
      conclusions: ['查清了 B 的 API 限制', 'B 的速率上限是 100/min'],
    },
    {
      topic: ['当下C'],
      startedAt: '2026-05-19T10:00:00.000Z',
      startedAtTick: 150,
      lastSeenTick: 210,
      hitCount: 8,
      conclusions: [],
    },
  ]
  saveFocusStack(threeFrames)
  loaded = loadFocusStack()
  assert.equal(loaded.length, 3, 'should load 3 frames')
  // 顺序保持（depth ASC = 栈底→栈顶）
  assert.deepEqual(loaded[0].topic, ['主线A'])
  assert.deepEqual(loaded[2].topic, ['当下C'])
  assert.deepEqual(loaded[1].conclusions, ['查清了 B 的 API 限制', 'B 的速率上限是 100/min'])
  console.log('[test] three-frame round-trip with conclusions OK')

  // 4. 原子替换：再写一个不同栈，旧行应该被 DELETE
  saveFocusStack([oneFrame[0]])
  loaded = loadFocusStack()
  assert.equal(loaded.length, 1, 'old stack should be wiped')
  assert.deepEqual(loaded[0].topic, ['编程', '调试'])
  console.log('[test] atomic replace OK')

  // 5. 清空
  saveFocusStack([])
  loaded = loadFocusStack()
  assert.deepEqual(loaded, [])
  console.log('[test] clear-back-to-empty OK')

  // 清理
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  console.log('\n[test] all assertions passed')
}

main().catch(err => {
  console.error('[test] FAILED:', err)
  process.exitCode = 1
})
