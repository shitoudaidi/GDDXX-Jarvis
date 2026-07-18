import { insertActionLog } from '../db.js'
import { emitEvent } from '../events.js'
import { classifyTool } from './tool-policy.js'
import { previewValue, safeJsonStringify } from './tool-utils.js'

function getExecutionSource(context = {}) {
  return context.source || context.trigger || (context.autonomous ? 'autonomous' : 'llm')
}
function summarizeToolExecution(name, args = {}) {
  switch (name) {
    case 'read_file':
      return `read_file(${args.path || args.filename || args.file_path || '?'})`
    case 'list_dir':
      return `list_dir(${args.path || args.dir || args.directory || '.'})`
    case 'write_file':
      return `write_file(${args.path || args.filename || args.file_path || '?'})`
    case 'delete_file':
      return `delete_file(${args.path || args.filename || args.file_path || '?'})`
    case 'make_dir':
      return `make_dir(${args.path || args.dir || args.directory || '?'})`
    case 'exec_command':
      return `exec_command(${String(args.command || args.cmd || '?').slice(0, 100)})`
    case 'fetch_url':
    case 'browser_read':
      return `${name}(${String(args.url || args.link || args.href || '?').slice(0, 120)})`
    case 'web_search':
      return `web_search(${String(args.query || args.q || args.keyword || '?').slice(0, 120)})`
    case 'send_message':
    case 'express':
      return `${name} -> ${args.target_id || '(unknown)'}`
    case 'upsert_memory': {
      const count = Array.isArray(args.memories) ? args.memories.length : 0
      return `upsert_memory(${count})`
    }
    default:
      return name
  }
}

export function inferToolStatus(result) {
  const text = String(result ?? '').trim()
  if (!text) return 'ok'
  try {
    const parsed = JSON.parse(text)
    return parsed?.ok === false ? 'error' : 'ok'
  } catch {}
  return /^(错误|请求失败|执行失败|命令超时|命令执行失败|閿欒|璇锋眰澶辫触|鎵ц澶辫触|鍛戒护瓒呮椂|鍛戒护鎵ц澶辫触)/.test(text) ? 'error' : 'ok'
}

export function writeToolAuditLog({ name, args, context, policy, status, result = '', error = '', startedAt, eventId = '' }) {
  const durationMs = Date.now() - startedAt
  const detailParts = []
  if (policy?.reason) detailParts.push(`policy=${policy.reason}`)
  const argPreview = previewValue(args, 160)
  if (argPreview && argPreview !== '{}') detailParts.push(`args=${argPreview}`)
  const resultPreview = previewValue(result || error, 220)
  if (resultPreview) detailParts.push(`result=${resultPreview}`)
  const summary = summarizeToolExecution(name, args)
  const detail = detailParts.join(' | ')

  try {
    insertActionLog({
      timestamp: new Date(startedAt).toISOString(),
      tool: name,
      summary,
      detail,
      status,
      risk: policy?.risk || classifyTool(name),
      argsJson: safeJsonStringify(args),
      resultPreview,
      error,
      durationMs,
      source: getExecutionSource(context),
    })
  } catch (err) {
    console.warn(`[audit] failed to persist tool audit log: ${err.message}`)
  }

  emitEvent('tool_audit', {
    id: eventId || '',
    tool: name,
    status,
    ok: status === 'ok',
    risk: policy?.risk || classifyTool(name),
    summary,
    detail,
    result_preview: resultPreview,
    error,
    duration_ms: durationMs,
    source: getExecutionSource(context),
  })
}
