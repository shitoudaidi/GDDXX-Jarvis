import { getDB, getConfig, setConfig } from '../db.js'
import { detectAgents } from './detector.js'

const CONFIG_KEY_ASKED = 'agent_delegation_asked'
const CONFIG_KEY_ALLOWED = 'agent_delegation_allowed'

// 确保 known_agents 表存在（db.js initSchema 调用前的兜底，也可直接在 db.js 里加）
function ensureTable() {
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_agents (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      available         INTEGER NOT NULL DEFAULT 0,
      version           TEXT,
      invoke_type       TEXT,
      invoke_cmd        TEXT,
      invoke_args       TEXT NOT NULL DEFAULT '[]',
      notes             TEXT NOT NULL DEFAULT '',
      docs_url          TEXT,
      docs_search_query TEXT,
      detected_at       TEXT NOT NULL,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

// 保存一批 Agent 探测结果到数据库
function saveAgents(agents) {
  const db = getDB()
  const stmt = db.prepare(`
    INSERT INTO known_agents (id, name, description, available, version, invoke_type, invoke_cmd, invoke_args, notes, docs_url, docs_search_query, detected_at, updated_at)
    VALUES (@id, @name, @description, @available, @version, @invoke_type, @invoke_cmd, @invoke_args, @notes, @docs_url, @docs_search_query, @detected_at, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name              = excluded.name,
      description       = excluded.description,
      available         = excluded.available,
      version           = excluded.version,
      invoke_type       = excluded.invoke_type,
      invoke_cmd        = excluded.invoke_cmd,
      invoke_args       = excluded.invoke_args,
      notes             = excluded.notes,
      docs_url          = excluded.docs_url,
      docs_search_query = excluded.docs_search_query,
      detected_at       = excluded.detected_at,
      updated_at        = datetime('now')
  `)
  const insertAll = db.transaction((list) => {
    for (const a of list) stmt.run({
      id:                a.id,
      name:              a.name,
      description:       a.description,
      available:         a.available ? 1 : 0,
      version:           a.version || null,
      invoke_type:       a.invokeType || null,
      invoke_cmd:        a.invokeCmd || null,
      invoke_args:       JSON.stringify(a.invokeArgs || []),
      notes:             a.notes || '',
      docs_url:          a.docsUrl || null,
      docs_search_query: a.docsSearchQuery || null,
      detected_at:       a.detectedAt || new Date().toISOString(),
    })
  })
  insertAll(agents)
}

// 读取所有可用 Agent
export function getAvailableAgents() {
  ensureTable()
  const db = getDB()
  return db.prepare(`
    SELECT * FROM known_agents WHERE available = 1 ORDER BY id ASC
  `).all().map(row => ({
    ...row,
    invokeArgs: JSON.parse(row.invoke_args || '[]'),
    available: !!row.available,
  }))
}

// 读取所有 Agent（含不可用）
export function getAllAgents() {
  ensureTable()
  const db = getDB()
  return db.prepare(`SELECT * FROM known_agents ORDER BY available DESC, id ASC`).all().map(row => ({
    ...row,
    invokeArgs: JSON.parse(row.invoke_args || '[]'),
    available: !!row.available,
  }))
}

// 按 id 获取单个 Agent
export function getAgentById(id) {
  ensureTable()
  const db = getDB()
  const row = db.prepare(`SELECT * FROM known_agents WHERE id = ?`).get(id)
  if (!row) return null
  return { ...row, invokeArgs: JSON.parse(row.invoke_args || '[]'), available: !!row.available }
}

// ── 委托权限管理 ─────────────────────────────────────────────────────────────

export function hasDelegationBeenAsked() {
  return getConfig(CONFIG_KEY_ASKED) === 'true'
}

export function isDelegationAllowed() {
  return getConfig(CONFIG_KEY_ALLOWED) === 'true'
}

export function markDelegationAsked() {
  setConfig(CONFIG_KEY_ASKED, 'true')
}

export function grantDelegation() {
  setConfig(CONFIG_KEY_ALLOWED, 'true')
}

export function revokeDelegation() {
  setConfig(CONFIG_KEY_ALLOWED, 'false')
}

// ── 启动入口：探测 + 落盘 ──────────────────────────────────────────────────

export async function collectAgents() {
  ensureTable()
  console.log('[Agents] 开始扫描本地 AI Agent...')
  try {
    const results = await detectAgents()
    saveAgents(results)
    const found = results.filter(a => a.available)
    console.log(`[Agents] 扫描完成：发现 ${found.length}/${results.length} 个可用 Agent`)
    return results
  } catch (err) {
    console.error('[Agents] 扫描失败：', err.message)
    return []
  }
}

// ── 生成用于系统提示词注入的文本块 ────────────────────────────────────────

export function buildAgentContextBlock() {
  if (!isDelegationAllowed()) return ''
  const agents = getAvailableAgents()
  if (!agents.length) return ''

  const lines = agents.map(a => {
    const invoke = a.invoke_type === 'cli'
      ? `exec_command("${a.invoke_cmd} ...")`
      : `fetch_url("${a.invoke_cmd}/...")`
    return `- **${a.name}** (${a.id}): ${a.description}. Invoke: ${invoke}`
  })

  return `## AI Collaborators You Can Work With
You have been granted command authority. For complex tasks, you may invoke the following agents through the delegate_to_agent tool:
${lines.join('\n')}
Before invoking, tell the user what you intend to have whom do, and proceed only after confirmation.`
}

// ── 生成"首次发现 Agent，需要询问用户"的方向指令文本 ─────────────────────

export function buildDelegationAskDirections() {
  if (hasDelegationBeenAsked()) return null
  const available = getAvailableAgents()
  if (!available.length) {
    // 无 agent 时也立即 mark：避免每个 idle tick 都注入这段无目的的扫描结果。
    markDelegationAsked()
    return `[System scan result] On startup the local environment was scanned; no other AI agents were found (none of Claude Code, Codex, Hermes, OpenClaw detected). You do not need to mention this scan to the user.`
  }

  // 关键：注入后立即落盘"已问"——语义是"我们把这条 directions 给过模型了"，
  //   不是"用户已回复"。原来的实现等 grant_agent_delegation 才翻转，导致用户回复前
  //   每个 idle tick 这段都会再注入一遍，模型就反复 send_message 同一句话。
  markDelegationAsked()

  const names = available.map(a => a.name).join('、')
  return `[New discovery · injected only once this startup] On startup the following AI tools were detected on your computer: ${names}.
These tools can act as your collaborators to help with complex tasks (e.g. code development, automation workflows).
Use send_message to ask the user once, naturally: can you direct these collaborators to work for you?
[Hard constraint] Ask only once. After sending this round, regardless of whether the user replies, do not ask again or nag in later ticks; this directions block will not be injected again, and repeating it is harassment.
After the user replies:
- If the user agrees (says "可以" / "好的" / "行", etc.) → call the grant_agent_delegation tool to persist the permission.
- If the user declines → call grant_agent_delegation with allowed=false to persist it.
- If the user does not reply for a long time → stay quiet, do not press; weave it in naturally later when the user brings it up themselves.`
}
