// 文本协议标记的单一真相源（single source of truth）。
//
// 模型输出文本里夹带 4 种运行时协议标记，运行时用正则提取并执行 / 剥离：
//   [RECALL: ...]          → 主动召回请求
//   [SET_TASK: ...]        → 设置当前任务
//   [CLEAR_TASK]           → 清空当前任务
//   [UPDATE_PERSONA: ...]  → 更新人格
//
// 本模块只负责「解析」与「剥离」，不做任何副作用（setConfig / insertMemory /
// emitEvent / state 写入等业务逻辑仍留在调用方原地）。
//
// ⚠ 正则一字不差地从原散落点搬来，保证行为完全等价：
//   - parseMarkers 用的是 index.js / test-runner.js 里「提取捕获值」的正则
//     （非 global、RECALL 用 .+? 单行匹配）。
//   - stripMarkers 用的是 llm.js stripProtocolMarkersForDelivery 里「剥离」的正则
//     （global、RECALL 用 .+? 单行匹配，其余用 [\s\S]+? 跨行匹配）。

// ── 解析用正则（提取捕获值，非 global）──────────────────────────────
// 与原 index.js 1202/1212/1221/1228 及 test-runner.js 57/63 完全一致。
const RECALL_PARSE = /\[RECALL:\s*(.+?)\]/
const SET_TASK_PARSE = /\[SET_TASK:\s*([\s\S]+?)\]/
const CLEAR_TASK_PARSE = /\[CLEAR_TASK\]/
const UPDATE_PERSONA_PARSE = /\[UPDATE_PERSONA:\s*([\s\S]+?)\]/

// ── 剥离用正则（global，用于从正文中删除）────────────────────────────
// 与原 llm.js stripProtocolMarkersForDelivery 378-382 完全一致。
const THINK_STRIP = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi
const RECALL_STRIP = /\[RECALL:\s*.+?\]/g
const SET_TASK_STRIP = /\[SET_TASK:\s*[\s\S]+?\]/g
const CLEAR_TASK_STRIP = /\[CLEAR_TASK\]/g
const UPDATE_PERSONA_STRIP = /\[UPDATE_PERSONA:\s*[\s\S]+?\]/g

/**
 * 只解析、不做副作用。提取 4 种标记的捕获值。
 * @param {string} text 模型原始输出文本
 * @returns {{ recall: string|null, setTask: string|null, clearTask: boolean, updatePersona: string|null }}
 *   recall / setTask / updatePersona：命中则为「未经 trim 的原始捕获子串」（保持与原 match[1] 一致，
 *   trim 由调用方按原逻辑自行决定）；未命中为 null。
 *   clearTask：命中为 true，否则 false。
 */
export function parseMarkers(text) {
  const s = String(text || '')
  const recallMatch = s.match(RECALL_PARSE)
  const setTaskMatch = s.match(SET_TASK_PARSE)
  const personaMatch = s.match(UPDATE_PERSONA_PARSE)
  return {
    recall: recallMatch ? recallMatch[1] : null,
    setTask: setTaskMatch ? setTaskMatch[1] : null,
    clearTask: CLEAR_TASK_PARSE.test(s),
    updatePersona: personaMatch ? personaMatch[1] : null,
  }
}

/**
 * 剥掉 <think>/<thinking> 块（可选）和全部 4 个协议标记后返回正文。
 * 与原 llm.js stripProtocolMarkersForDelivery 行为完全一致（含末尾 .trim()）。
 * @param {string} text
 * @param {{ stripThink?: boolean }} [opts] stripThink 默认 true
 * @returns {string}
 */
export function stripMarkers(text, { stripThink = true } = {}) {
  let s = String(text || '')
  if (stripThink) s = s.replace(THINK_STRIP, '')
  return s
    .replace(RECALL_STRIP, '')
    .replace(SET_TASK_STRIP, '')
    .replace(CLEAR_TASK_STRIP, '')
    .replace(UPDATE_PERSONA_STRIP, '')
    .trim()
}
