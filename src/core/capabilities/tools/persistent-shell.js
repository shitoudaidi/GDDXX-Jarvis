import { spawn, spawnSync } from 'child_process'

// ─────────────────────────────────────────────────────────────────────────────
// 快路径：长驻 PowerShell 复用进程
//
// 每条 exec_command 都冷启动一个 powershell.exe 约 550ms（PS 5.1 加载 .NET runtime）。
// 对 agent 高频执行的"看一眼"类只读命令（ls / cat / findstr ...），这 550ms 是纯浪费。
// 本模块维护一个长驻 powershell 进程，命令经 stdin 喂入、用唯一哨兵标记判断结束并取
// 退出码，稳态每条仅约 100ms。
//
// 关键设计——这是"尽力加速层"，不是新的执行主路径：
//   • 只接安全、快速、无交互、无 pager、无长跑的命令（由调用方 isFastLaneEligible 把关）。
//   • 一次只跑一条（共享 stdin/stdout）；忙时直接返回 null → 调用方降级到独立进程慢路径。
//   • 软超时兜底：命令若迟迟不结束（误判走了快路径），杀掉持久 shell 重建并返回 null，
//     调用方用慢路径（带完整超时 / promote / abort）重新执行。
//   • 任何异常都返回 null。慢路径永远是可靠兜底，快路径坏了不影响正确性，只损失加速。
//
// Windows PowerShell 5.1 stdin 默认按 GBK 解码，命令里的中文会乱码，因此整条命令 + cwd
// 都用 UTF8→base64 经 stdin 传（纯 ASCII），shell 内解码回 UTF8 再 Invoke-Expression。
// ─────────────────────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32'
const SOFT_TIMEOUT_MS = 15000

const PRELUDE = [
  'chcp 65001 > $null',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  '[Console]::InputEncoding=[Text.Encoding]::UTF8',
  '$OutputEncoding=[Text.Encoding]::UTF8',
  "$ProgressPreference='SilentlyContinue'",
].join('\n') + '\n'

let child = null         // 当前持久进程或 null
let ready = null         // 启动+prelude 完成的 Promise，或 null
let busy = false         // 是否正在执行一条命令（互斥）
let stdoutBuf = ''
let stderrBuf = ''
let current = null       // 当前命令的 { outRe, errMark, resolve, timer }

const rand = () => Math.random().toString(36).slice(2, 12)

function tryComplete() {
  if (!current) return
  const m = stdoutBuf.match(current.outRe)
  if (!m) return
  const errIdx = stderrBuf.indexOf(current.errMark)
  if (errIdx === -1) return
  const exit = Number(m[1])
  const stdout = stdoutBuf.slice(0, m.index)
  const stderr = stderrBuf.slice(0, errIdx)
  // 消费掉本命令的输出（含哨兵），余量留给下一条
  stdoutBuf = stdoutBuf.slice(m.index + m[0].length)
  stderrBuf = stderrBuf.slice(errIdx + current.errMark.length)
  const cur = current
  current = null
  busy = false
  clearTimeout(cur.timer)
  cur.resolve({ exit, stdout, stderr })
}

function startShell() {
  const c = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child = c
  stdoutBuf = ''
  stderrBuf = ''
  current = null
  busy = false
  c.stdout.setEncoding('utf8')
  c.stderr.setEncoding('utf8')
  c.stdout.on('data', (d) => { stdoutBuf += d; tryComplete() })
  c.stderr.on('data', (d) => { stderrBuf += d; tryComplete() })
  c.on('exit', () => {
    if (child !== c) return // 已被替换的陈旧进程，忽略
    child = null
    ready = null
    const cur = current
    current = null
    busy = false
    if (cur) { clearTimeout(cur.timer); cur.resolve(null) }
  })
  c.on('error', () => {
    if (child === c) { child = null; ready = null }
  })

  ready = new Promise((resolve, reject) => {
    const id = 'READY_' + rand()
    const mark = id + '\r\n'
    const onData = () => {
      const idx = stdoutBuf.indexOf(mark)
      if (idx === -1) return
      stdoutBuf = stdoutBuf.slice(idx + mark.length)
      c.stdout.off('data', onData)
      resolve()
    }
    c.stdout.on('data', onData)
    c.on('exit', () => reject(new Error('shell exited during startup')))
    try {
      c.stdin.write(PRELUDE + `Write-Output "${id}"\n`)
    } catch (err) {
      reject(err)
    }
  })
  return ready
}

function killShell() {
  const c = child
  if (!c) return
  child = null
  ready = null
  stdoutBuf = ''
  stderrBuf = ''
  const cur = current
  current = null
  busy = false
  if (cur) { clearTimeout(cur.timer); cur.resolve(null) }
  try { c.stdin?.end() } catch {}
  try {
    if (c.pid) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true })
    else c.kill()
  } catch {}
}

/**
 * 在持久 shell 上执行一条命令。
 * @returns {Promise<{exit:number, stdout:string, stderr:string}|null>}
 *   返回 null 表示"未执行/请降级到慢路径"（忙、不可用、启动失败、软超时卡住等）。
 */
export async function runOnPersistentShell(command, execCwd, timeoutMs) {
  if (!IS_WIN) return null
  if (busy) return null // 上一条还没完，直接让调用方走独立进程，不排队

  try {
    if (!child) startShell()
    await ready
  } catch {
    killShell()
    return null
  }
  if (busy || !child) return null
  busy = true

  return new Promise((resolve) => {
    const id = 'SENT_' + rand()
    const outRe = new RegExp(`${id}:(-?\\d+)\\r?\\n`)
    const errMark = `${id}ERR\r\n`
    const softTimeout = Math.min(timeoutMs || SOFT_TIMEOUT_MS, SOFT_TIMEOUT_MS)

    const timer = setTimeout(() => {
      // 命令迟迟不结束：八成误判走了快路径或真卡住了。杀 shell 重建，降级。
      killShell()
      resolve(null)
    }, softTimeout)

    current = { outRe, errMark, resolve, timer }

    const cmdB64 = Buffer.from(command, 'utf8').toString('base64')
    const cwdB64 = Buffer.from(execCwd, 'utf8').toString('base64')
    try {
      child.stdin.write(
        '$global:LASTEXITCODE=0\n' +
        `Set-Location -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${cwdB64}')))\n` +
        `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${cmdB64}')))\n` +
        `Write-Output "${id}:$LASTEXITCODE"\n` +
        `[Console]::Error.WriteLine("${id}ERR")\n`
      )
    } catch {
      clearTimeout(timer)
      killShell()
      resolve(null)
    }
  })
}

// 进程退出时清理长驻 shell，避免遗留 powershell 进程
export function shutdownPersistentShell() {
  killShell()
}

// 兜底：主进程退出时同步杀掉子 powershell（exit handler 内只能用同步调用，故用 kill 而非 taskkill）
process.once('exit', () => { try { child?.kill() } catch {} })
