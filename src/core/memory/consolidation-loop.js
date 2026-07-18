import { getCandidateEntitiesForConsolidation, getMemoriesByEntity } from '../db.js'
import { runConsolidator } from './consolidator.js'

const RUN_INTERVAL_MS = 30 * 60 * 1000  // 30 分钟
const BATCH_SIZE = 20                   // 上限让 LLM 一次能看全实体的近期记忆

// 内存里的 round-robin 游标：下次从哪个候选实体开始（v1 不持久化）
let cursor = 0

async function tick() {
  try {
    const candidates = getCandidateEntitiesForConsolidation(10)
    if (candidates.length === 0) {
      console.log('[整合循环] 无候选实体（fact/person 记忆数均 <3）')
      return
    }
    const pick = candidates[cursor % candidates.length]
    cursor = (cursor + 1) % candidates.length
    const memories = getMemoriesByEntity(pick.entity, BATCH_SIZE)
    if (!memories || memories.length === 0) {
      console.log(`[整合循环] entity=${pick.entity} 暂无记忆`)
      return
    }
    console.log(`[整合循环] 开始整合 entity=${pick.entity} (候选总数=${candidates.length})`)
    await runConsolidator({ entity: pick.entity, memories })
  } catch (err) {
    console.error('[整合循环] 失败:', err)
  }
}

let started = false
let timer = null

export function startConsolidationLoop() {
  if (started) return
  started = true
  // 启动后等 5 分钟再跑第一次，避免和启动自检挤
  setTimeout(() => {
    tick()
    timer = setInterval(tick, RUN_INTERVAL_MS)
  }, 5 * 60 * 1000)
  console.log(`[整合循环] 已注册，5 分钟后首次运行，之后每 ${RUN_INTERVAL_MS / 60000} 分钟一次`)
}

export function stopConsolidationLoop() {
  if (timer) { clearInterval(timer); timer = null }
  started = false
}
