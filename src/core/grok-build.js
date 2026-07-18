import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { config } from './config.js'
import { emitEvent } from './events.js'
import { paths } from './paths.js'

const H_DRIVE_ROOT = path.parse('H:\\').root
const DEFAULT_PROJECT_ROOT = 'H:\\Jarvis'
const DEFAULT_GROK_HOME = path.join(DEFAULT_PROJECT_ROOT, 'runtime', 'grok-home')
const DEFAULT_GROK_BIN = path.join(
  DEFAULT_PROJECT_ROOT,
  'tools',
  'grok-cli',
  'node_modules',
  '@xai-official',
  'grok-win32-x64',
  'bin',
  'grok.exe',
)
const DEFAULT_TEMP_DIR = path.join(DEFAULT_PROJECT_ROOT, 'runtime', 'tmp')
const TASK_LOG_FILE = path.join(paths.dataDir, 'grok-build-tasks.jsonl')
const MAX_OUTPUT_CHARS = 160_000
const MAX_THOUGHT_CHARS = 16_000
const MAX_EVENTS = 120
const RPC_TIMEOUT_MS = 30_000

let activeTask = null

function now() {
  return new Date().toISOString()
}

function grokBin() {
  return path.resolve(process.env.JARVIS_GROK_BIN || DEFAULT_GROK_BIN)
}

function grokHome() {
  return path.resolve(process.env.GROK_HOME || DEFAULT_GROK_HOME)
}

function isOnHDrive(value) {
  const resolved = path.resolve(String(value || ''))
  return path.parse(resolved).root.toLowerCase() === H_DRIVE_ROOT.toLowerCase()
}

function resolveTaskCwd(value) {
  const requested = String(value || '').trim()
  const resolved = path.resolve(requested || paths.sandboxDir)
  if (!isOnHDrive(resolved)) throw new Error('工程任务只能在 H 盘运行')
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`工作目录不存在: ${resolved}`)
  }
  return resolved
}

function trimTail(value, max) {
  const text = String(value || '')
  return text.length > max ? text.slice(text.length - max) : text
}

function addEvent(task, event) {
  task.events.push({ at: now(), ...event })
  if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS)
  publish(task)
}

function publicTask(task = activeTask) {
  if (!task) return null
  return {
    id: task.id,
    status: task.status,
    prompt: task.prompt,
    cwd: task.cwd,
    model: 'DeepSeek V4 Pro',
    output: task.output,
    thought: task.thought,
    events: task.events,
    plan: task.plan,
    permission: task.permission ? {
      toolCallId: task.permission.toolCall?.toolCallId || '',
      title: task.permission.toolCall?.title || '需要授权',
      kind: task.permission.toolCall?.kind || '',
      content: task.permission.toolCall?.content || [],
      locations: task.permission.toolCall?.locations || [],
      options: task.permission.options || [],
    } : null,
    error: task.error || '',
    stopReason: task.stopReason || '',
    startedAt: task.startedAt,
    completedAt: task.completedAt || null,
  }
}

function publish(task) {
  emitEvent('grok_build_task', publicTask(task))
}

function persistTerminalTask(task) {
  const record = publicTask(task)
  try {
    fs.mkdirSync(path.dirname(TASK_LOG_FILE), { recursive: true })
    fs.appendFileSync(TASK_LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8')
  } catch (error) {
    console.warn('[grok-build] failed to persist task:', error.message)
  }
}

function finishTask(task, status, details = {}) {
  if (!task || task.terminal) return
  task.terminal = true
  task.status = status
  task.completedAt = now()
  task.permission = null
  task.error = details.error || task.error || ''
  task.stopReason = details.stopReason || task.stopReason || ''
  for (const pending of task.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error(`Grok Build task ${status}`))
  }
  task.pending.clear()
  addEvent(task, {
    type: status,
    title: status === 'completed' ? '任务完成' : status === 'cancelled' ? '任务已取消' : '任务中止',
    detail: task.error || task.stopReason || '',
  })
  persistTerminalTask(task)
  setTimeout(() => {
    try { task.child?.stdin?.end() } catch {}
    try { if (task.child && !task.child.killed) task.child.kill() } catch {}
  }, 80).unref?.()
}

function writeRpc(task, payload) {
  if (!task.child || task.child.killed || !task.child.stdin.writable) {
    throw new Error('Grok Build 进程不可用')
  }
  task.child.stdin.write(`${JSON.stringify(payload)}\n`)
}

function rpcRequest(task, method, params, timeoutMs = RPC_TIMEOUT_MS) {
  const id = ++task.rpcId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      task.pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    task.pending.set(id, { resolve, reject, timer, method })
    writeRpc(task, { jsonrpc: '2.0', id, method, params })
  })
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join('\n')
  if (content && typeof content === 'object') return String(content.text || content.content || '')
  return ''
}

function handleSessionUpdate(task, update = {}) {
  const kind = String(update.sessionUpdate || '')
  if (kind === 'agent_message_chunk') {
    task.output = trimTail(`${task.output}${contentText(update.content)}`, MAX_OUTPUT_CHARS)
    publish(task)
    return
  }
  if (kind === 'agent_thought_chunk') {
    task.thought = trimTail(`${task.thought}${contentText(update.content)}`, MAX_THOUGHT_CHARS)
    publish(task)
    return
  }
  if (kind === 'plan') {
    task.plan = Array.isArray(update.entries) ? update.entries : Array.isArray(update.plan) ? update.plan : []
    addEvent(task, { type: 'plan', title: '执行计划已更新', detail: `${task.plan.length} 个步骤` })
    return
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    addEvent(task, {
      type: kind,
      title: update.title || update.kind || '工具调用',
      detail: update.status || contentText(update.content).slice(0, 240),
      toolCallId: update.toolCallId || '',
    })
    return
  }
  if (kind.startsWith('subagent_')) {
    addEvent(task, {
      type: kind,
      title: update.title || '子任务更新',
      detail: update.status || update.message || '',
    })
  }
}

function handlePermissionRequest(task, message) {
  task.status = 'waiting_permission'
  task.permission = {
    requestId: message.id,
    options: Array.isArray(message.params?.options) ? message.params.options : [],
    toolCall: message.params?.toolCall || {},
  }
  addEvent(task, {
    type: 'permission',
    title: task.permission.toolCall.title || '等待操作授权',
    detail: task.permission.toolCall.kind || '',
  })
}

function handleRpcMessage(task, message) {
  if (!message || typeof message !== 'object') return
  if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
    const pending = task.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    task.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)))
    else pending.resolve(message.result)
    return
  }
  if (message.method === 'session/update') {
    handleSessionUpdate(task, message.params?.update || {})
    return
  }
  if (message.method === '_x.ai/session/update') {
    const update = message.params?.update || {}
    if (update.sessionUpdate === 'turn_completed') {
      finishTask(task, 'completed', { stopReason: update.stop_reason || 'end_turn' })
    } else if (update.sessionUpdate === 'turn_cancelled') {
      finishTask(task, 'cancelled', { stopReason: update.stop_reason || 'cancelled' })
    } else if (update.sessionUpdate === 'turn_failed') {
      finishTask(task, 'error', { error: update.error?.message || update.message || 'Grok Build task failed' })
    }
    return
  }
  if (message.method === 'session/request_permission' && Object.prototype.hasOwnProperty.call(message, 'id')) {
    handlePermissionRequest(task, message)
    return
  }
  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    writeRpc(task, {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported client method: ${message.method || 'unknown'}` },
    })
  }
}

function attachProcessReaders(task) {
  const stdout = readline.createInterface({ input: task.child.stdout })
  stdout.on('line', (line) => {
    const text = String(line || '').trim()
    if (!text) return
    try { handleRpcMessage(task, JSON.parse(text)) } catch {
      addEvent(task, { type: 'protocol', title: '代理输出', detail: text.slice(0, 400) })
    }
  })
  const stderr = readline.createInterface({ input: task.child.stderr })
  stderr.on('line', (line) => {
    const text = String(line || '').trim()
    if (!text || /session title generation|model catalog|xai.*auth/i.test(text)) return
    task.stderr = trimTail(`${task.stderr}${text}\n`, 12_000)
    console.warn('[grok-build]', text)
  })
  task.child.once('error', (error) => {
    finishTask(task, 'error', { error: error.message || String(error) })
  })
  task.child.once('close', (code, signal) => {
    if (task.terminal) return
    finishTask(task, task.cancelRequested ? 'cancelled' : 'error', {
      error: task.cancelRequested ? '' : `Grok Build exited (${code ?? signal ?? 'unknown'})`,
    })
  })
}

async function bootTask(task) {
  const binary = grokBin()
  if (!fs.existsSync(binary)) throw new Error(`Grok Build 未安装: ${binary}`)
  if (!config.apiKey || config.provider !== 'deepseek') throw new Error('DeepSeek 尚未接入，工程代理无法启动')
  const tempDir = path.resolve(process.env.JARVIS_GROK_TEMP || DEFAULT_TEMP_DIR)
  fs.mkdirSync(tempDir, { recursive: true })
  fs.mkdirSync(grokHome(), { recursive: true })
  task.child = spawn(binary, ['agent', 'stdio'], {
    cwd: task.cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GROK_HOME: grokHome(),
      DEEPSEEK_API_KEY: config.apiKey,
      TEMP: tempDir,
      TMP: tempDir,
    },
  })
  attachProcessReaders(task)
  addEvent(task, { type: 'starting', title: 'Grok Build 正在启动', detail: task.cwd })
  await rpcRequest(task, 'initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'jarvis-workbench', version: '0.1.0' },
    clientCapabilities: {},
  })
  const session = await rpcRequest(task, 'session/new', { cwd: task.cwd, mcpServers: [] })
  task.sessionId = session?.sessionId || session?.session_id
  if (!task.sessionId) throw new Error('Grok Build did not create an ACP session')
  task.status = 'running'
  addEvent(task, { type: 'running', title: '工程代理已接管任务', detail: 'DeepSeek V4 Pro' })
  const result = await rpcRequest(task, 'session/prompt', {
    sessionId: task.sessionId,
    prompt: [{ type: 'text', text: task.prompt }],
  }, 30 * 60 * 1000)
  finishTask(task, 'completed', { stopReason: result?.stopReason || result?.stop_reason || 'end_turn' })
}

export function getGrokBuildStatus() {
  const binary = grokBin()
  return {
    ok: true,
    available: fs.existsSync(binary),
    binary,
    home: grokHome(),
    defaultCwd: paths.sandboxDir,
    storagePolicy: 'H_DRIVE_ONLY',
    task: publicTask(),
  }
}

export function startGrokBuildTask({ prompt, cwd } = {}) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('请填写工程任务')
  if (text.length > 20_000) throw new Error('工程任务不能超过 20000 个字符')
  if (activeTask && !activeTask.terminal) throw new Error('已有工程任务正在运行')
  const task = {
    id: crypto.randomUUID(),
    status: 'starting',
    prompt: text,
    cwd: resolveTaskCwd(cwd),
    output: '',
    thought: '',
    stderr: '',
    events: [],
    plan: [],
    permission: null,
    pending: new Map(),
    rpcId: 0,
    terminal: false,
    cancelRequested: false,
    error: '',
    stopReason: '',
    startedAt: now(),
    completedAt: null,
    child: null,
    sessionId: '',
  }
  activeTask = task
  publish(task)
  bootTask(task).catch((error) => finishTask(task, task.cancelRequested ? 'cancelled' : 'error', {
    error: error.message || String(error),
  }))
  return publicTask(task)
}

export function answerGrokBuildPermission({ taskId, decision } = {}) {
  const task = activeTask
  if (!task || task.id !== taskId) throw new Error('工程任务不存在')
  if (!task.permission) throw new Error('当前没有等待确认的操作')
  const approve = decision === 'approve'
  const preferredKinds = approve ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always']
  const option = preferredKinds
    .map((kind) => task.permission.options.find((item) => item.kind === kind))
    .find(Boolean)
  if (!option) throw new Error(approve ? '代理没有提供可批准选项' : '代理没有提供可拒绝选项')
  const requestId = task.permission.requestId
  writeRpc(task, {
    jsonrpc: '2.0',
    id: requestId,
    result: { outcome: { outcome: 'selected', optionId: option.optionId } },
  })
  task.permission = null
  task.status = 'running'
  addEvent(task, {
    type: approve ? 'approved' : 'rejected',
    title: approve ? '已允许本次操作' : '已拒绝本次操作',
    detail: option.name || option.kind,
  })
  return publicTask(task)
}

export function cancelGrokBuildTask(taskId) {
  const task = activeTask
  if (!task || task.id !== taskId) throw new Error('工程任务不存在')
  if (task.terminal) return publicTask(task)
  task.cancelRequested = true
  if (task.permission) {
    try {
      writeRpc(task, {
        jsonrpc: '2.0',
        id: task.permission.requestId,
        result: { outcome: { outcome: 'cancelled' } },
      })
    } catch {}
    task.permission = null
  }
  if (task.sessionId) {
    try { writeRpc(task, { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: task.sessionId } }) } catch {}
  }
  setTimeout(() => {
    if (!task.terminal && task.child && !task.child.killed) task.child.kill()
    finishTask(task, 'cancelled')
  }, 1200).unref?.()
  publish(task)
  return publicTask(task)
}

export function shutdownGrokBuild() {
  if (!activeTask || activeTask.terminal) return
  activeTask.cancelRequested = true
  try { activeTask.child?.kill() } catch {}
  finishTask(activeTask, 'cancelled', { stopReason: 'Jarvis shutdown' })
}
