/**
 * 上下文采集器 — 执行前充分性检查循环
 *
 * 流程：
 *   检查 → 不够 → 解决 needs → 再检查 → 直到够了或达到 MAX_ROUNDS
 *
 * 每轮 LLM 输出：
 *   { "sufficient": true }
 *   { "sufficient": false, "needs": [{ "type": "read_file"|"search_memory"|"recall", ... }] }
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { callLLM } from '../llm.js'
import { searchMemories } from '../db.js'
import { extractJSON } from '../utils.js'

import { paths } from '../paths.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SANDBOX_ROOT = paths.sandboxDir

const MAX_ROUNDS = 3
const FILE_PREVIEW_CHARS = 2000  // 文件内容截断长度

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error(signal.reason || 'Aborted')
    err.name = 'AbortError'
    throw err
  }
}

const CHECKER_PROMPT = `You are a context sufficiency checker. Decide whether the currently injected knowledge and experience are enough for the next step of the task.

Output rules:
- Output JSON only. Do not output any other text.
- If the context is sufficient, output: {"sufficient":true}
- If the context is insufficient, output: {"sufficient":false,"needs":[...]}

Need types:
- {"type":"read_file","path":"relative path"} means a file must be read.
- {"type":"search_memory","keyword":"keyword"} means relevant memory should be searched.
- {"type":"recall","query":"query"} means a specific concept or experience should be recalled.

Judgment rules:
- If the task modifies or calls a file/function but its structure is unknown, request read_file.
- If the task depends on previously learned knowledge that is not in the current context, request search_memory.
- If the task involves a specific concept or decision and the current context is uncertain, request recall.
- If there is enough information to act, return sufficient: true.
- Output at most 3 needs. Choose the most important ones.
- Prefer sufficient: true with less context over looping forever to fetch files.`

/**
 * 主入口：采集足够上下文后返回 extraContext 数组
 * @param {object} params
 * @param {string} params.task       当前任务描述
 * @param {string} params.taskKnowledge  已有任务知识（格式化文本）
 * @param {string} params.memories   已有记忆摘要
 * @param {string} params.message    当前处理的输入（TICK 或消息）
 * @returns {Array} extraContext — 每项 { type, label, content }
 */
export async function gatherContext({ task, taskKnowledge, memories, message, signal }) {
  if (!task) return []

  const extraContext = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    throwIfAborted(signal)
    const checkResult = await checkSufficiency({ task, taskKnowledge, memories, message, extraContext, signal })
    throwIfAborted(signal)

    if (!checkResult || checkResult.sufficient !== false) break

    const needs = checkResult.needs || []
    if (needs.length === 0) break

    let resolved = 0
    for (const need of needs) {
      throwIfAborted(signal)
      const item = await resolveNeed(need, extraContext)
      if (item) {
        extraContext.push(item)
        resolved++
      }
    }

    // 本轮没有解决任何 need，停止避免死循环
    if (resolved === 0) break
  }

  return extraContext
}

async function checkSufficiency({ task, taskKnowledge, memories, message, extraContext, signal }) {
  const extraSection = extraContext.length > 0
    ? '\n\nAdditional context already gathered:\n' + extraContext.map(c => `[${c.label}]\n${c.content.slice(0, 500)}`).join('\n')
    : ''

  const input = `Current task:
${task}

Current input:
${message.slice(0, 300)}

Task knowledge base:
${taskKnowledge || '(empty)'}

Memory summary:
${memories || '(empty)'}${extraSection}

Question: Is the information above sufficient for the current step of the task?`

  let raw
  try {
    const result = await callLLM({
      systemPrompt: CHECKER_PROMPT,
      message: input,
      temperature: 0,
      signal,
    })
    raw = result.content
  } catch (err) {
    console.error('[采集器] 充分性检查失败:', err.message)
    return { sufficient: true }  // 出错时放行，不阻塞主流程
  }

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const parsed = extractJSON(cleaned, 'object')
  return parsed || { sufficient: true }
}

async function resolveNeed(need, existingContext) {
  const alreadyHave = existingContext.some(c => c.source === needKey(need))
  if (alreadyHave) return null

  if (need.type === 'read_file') {
    return resolveFileRead(need.path)
  }

  if (need.type === 'search_memory') {
    return resolveMemorySearch(need.keyword)
  }

  if (need.type === 'recall') {
    return resolveMemorySearch(need.query)
  }

  return null
}

function needKey(need) {
  return `${need.type}:${need.path || need.keyword || need.query || ''}`
}

function resolveFileRead(filePath) {
  if (!filePath) return null

  // 规范化：去掉 sandbox/ 前缀
  const normalized = filePath.replace(/^sandbox[\\/]/, '')
  const absPath = path.resolve(SANDBOX_ROOT, normalized)

  // 沙盒边界检查
  if (!absPath.startsWith(SANDBOX_ROOT)) {
    console.warn(`[采集器] 拒绝读取沙盒外文件: ${filePath}`)
    return null
  }

  try {
    const raw = fs.readFileSync(absPath, 'utf-8')
    const preview = raw.length > FILE_PREVIEW_CHARS
      ? raw.slice(0, FILE_PREVIEW_CHARS) + `\n…（已截断，共 ${raw.length} 字符）`
      : raw
    console.log(`[采集器] 读取文件: ${normalized} (${raw.length} chars)`)
    return {
      type: 'file',
      label: `文件 ${normalized}`,
      source: `read_file:${filePath}`,
      content: preview,
    }
  } catch (err) {
    console.warn(`[采集器] 读取失败 ${filePath}: ${err.message}`)
    return null
  }
}

function resolveMemorySearch(keyword) {
  if (!keyword) return null
  const results = searchMemories(keyword, 5)
  if (!results.length) return null

  console.log(`[采集器] 搜索记忆 "${keyword}": ${results.length} 条`)
  return {
    type: 'memory',
    label: `Memory search: ${keyword}`,
    source: `search_memory:${keyword}`,
    content: results.map(m => `- ${m.content}\n  ${m.detail}`).join('\n'),
  }
}

/**
 * 将 extraContext 数组格式化为可注入系统提示词的文本
 */
export function formatExtraContext(extraContext = []) {
  if (!extraContext.length) return ''
  return extraContext.map(c => `### ${c.label}\n${c.content}`).join('\n\n')
}
