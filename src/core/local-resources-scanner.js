/**
 * local-resources-scanner.js
 *
 * 启动时扫描用户本机的"自有资源"摘要，注入 system prompt。
 * 目标：让 agent 在收到模糊任务（"上服务器"、"提交一下"）时，无需现场探就
 * 知道用户有哪些 ssh hosts、哪些密钥、git 身份是谁。配合 prompt.js 的
 * "Self-Sufficient Execution" 段，把"先扫环境再问凭据"从软提示变成硬数据。
 *
 * 当前覆盖：
 *   - ~/.ssh/config 里的 Host 别名（HostName / User / Port 摘要）
 *   - ~/.ssh/ 目录下的密钥对名（公私钥成对存在的）
 *   - ~/.ssh/known_hosts 里出现过的 host（去重）
 *   - ~/.gitconfig 的 [user] name / email
 *
 * 不读取（避免敏感泄露）：
 *   - 私钥文件内容
 *   - known_hosts 里的指纹
 *   - shell history（敏感词太难脱敏，等专门方案）
 *
 * 直接用 fs 读，绕过沙箱，跨平台。
 *
 * 对外接口：
 *   collectLocalResources()  → 同步，启动时调用一次
 *   getLocalResourcesBlock() → 返回注入 system prompt 的纯文本块，同步
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

let _cached = null

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

function readFileLines(filePath) {
  const text = safe(() => fs.readFileSync(filePath, 'utf8'), null)
  if (text == null) return null
  return text.split(/\r?\n/)
}

// ─── ~/.ssh/config ───────────────────────────────────────────────────────────

function scanSshConfig(sshDir) {
  const lines = readFileLines(path.join(sshDir, 'config'))
  if (!lines) return []

  const hosts = []
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+)\s+(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()

    if (key === 'host') {
      if (current) hosts.push(current)
      // 跳过通配 Host *、Host *.example —— 那些是默认规则，不是具体目标
      const names = value.split(/\s+/).filter(n => !n.includes('*') && !n.includes('?'))
      current = names.length > 0 ? { aliases: names } : null
    } else if (current) {
      if (key === 'hostname') current.hostname = value
      else if (key === 'user') current.user = value
      else if (key === 'port') current.port = value
    }
  }
  if (current) hosts.push(current)
  return hosts
}

// ─── ~/.ssh/ 私钥扫描（启发式：X 和 X.pub 成对存在的，X 是密钥） ──────────

function scanSshKeys(sshDir) {
  const entries = safe(() => fs.readdirSync(sshDir, { withFileTypes: true }), [])
  const names = entries.filter(e => e.isFile()).map(e => e.name)
  const pubSet = new Set(names.filter(n => n.endsWith('.pub')))
  const keys = []
  for (const n of names) {
    if (n.endsWith('.pub')) continue
    if (pubSet.has(n + '.pub')) keys.push(n)
  }
  return keys.sort()
}

// ─── ~/.ssh/known_hosts ──────────────────────────────────────────────────────

function scanKnownHosts(sshDir) {
  const lines = readFileLines(path.join(sshDir, 'known_hosts'))
  if (!lines) return []
  const hosts = new Set()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // hashed host（开头 |）不可逆，跳过 —— 反正模糊任务里用户多半给 IP 或别名
    if (trimmed.startsWith('|')) continue
    const first = trimmed.split(/\s+/)[0]
    if (!first) continue
    // 一行可能逗号分隔多个 host：foo.com,1.2.3.4
    for (const h of first.split(',')) {
      const cleaned = h.replace(/^\[/, '').replace(/\]:\d+$/, '')
      if (cleaned) hosts.add(cleaned)
    }
  }
  return [...hosts].sort()
}

// ─── ~/.gitconfig [user] ─────────────────────────────────────────────────────

function scanGitGlobal() {
  const cfgPath = path.join(os.homedir(), '.gitconfig')
  const lines = readFileLines(cfgPath)
  if (!lines) return null

  const result = {}
  let section = null
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sec = line.match(/^\[([^\]]+)\]$/)
    if (sec) { section = sec[1].toLowerCase().trim(); continue }
    if (section !== 'user') continue
    const kv = line.match(/^([\w-]+)\s*=\s*(.+)$/)
    if (!kv) continue
    const k = kv[1].toLowerCase()
    if (k === 'name') result.name = kv[2].trim()
    else if (k === 'email') result.email = kv[2].trim()
  }
  return (result.name || result.email) ? result : null
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

export function collectLocalResources() {
  const sshDir = path.join(os.homedir(), '.ssh')
  const sshExists = safe(() => fs.existsSync(sshDir), false)

  const result = {
    sshHosts:   sshExists ? scanSshConfig(sshDir)  : [],
    sshKeys:    sshExists ? scanSshKeys(sshDir)    : [],
    knownHosts: sshExists ? scanKnownHosts(sshDir) : [],
    gitUser:    scanGitGlobal(),
  }

  console.log(
    '[local-resources] 完成 — ssh hosts:', result.sshHosts.length,
    '| keys:', result.sshKeys.length,
    '| known_hosts:', result.knownHosts.length,
    '| git user:', result.gitUser ? 'yes' : 'no'
  )
  _cached = result
  return result
}

// ─── 对外接口 ────────────────────────────────────────────────────────────────

const KNOWN_HOSTS_LIMIT = 30
const SSH_HOSTS_LIMIT = 20

export function getLocalResourcesBlock() {
  if (!_cached) return ''
  const { sshHosts, sshKeys, knownHosts, gitUser } = _cached

  const lines = []

  if (sshKeys.length > 0 || sshHosts.length > 0 || knownHosts.length > 0) {
    const sshSub = []

    if (sshKeys.length > 0) {
      sshSub.push(`- Keys: ${sshKeys.join(', ')} (passwordless login is set up — try ssh directly before ever asking the user for credentials)`)
    }

    if (sshHosts.length > 0) {
      const hostLines = sshHosts.slice(0, SSH_HOSTS_LIMIT).map(h => {
        const aliases = h.aliases.join(' / ')
        const target = h.hostname || '(no HostName)'
        const userPart = h.user ? ` as ${h.user}` : ''
        const portPart = h.port && h.port !== '22' ? `:${h.port}` : ''
        return `  · ${aliases} → ${target}${portPart}${userPart}`
      })
      const more = sshHosts.length > SSH_HOSTS_LIMIT ? `\n  · ... (${sshHosts.length - SSH_HOSTS_LIMIT} more)` : ''
      sshSub.push(`- ~/.ssh/config aliases (${sshHosts.length}):\n${hostLines.join('\n')}${more}`)
    }

    if (knownHosts.length > 0) {
      const shown = knownHosts.slice(0, KNOWN_HOSTS_LIMIT).join(', ')
      const more = knownHosts.length > KNOWN_HOSTS_LIMIT ? ` ... (${knownHosts.length} total)` : ''
      sshSub.push(`- Hosts previously connected (${knownHosts.length}): ${shown}${more}`)
    }

    lines.push('### SSH')
    lines.push(sshSub.join('\n'))
  }

  if (gitUser) {
    const parts = []
    if (gitUser.name)  parts.push(gitUser.name)
    if (gitUser.email) parts.push(`<${gitUser.email}>`)
    lines.push('### Git')
    lines.push(`- Global identity: ${parts.join(' ')}`)
  }

  if (lines.length === 0) return ''

  return `## Local Resources Snapshot
(Scanned once at startup from the user's filesystem. Use these directly — do not ask the user for credentials, host addresses, git identity, or anything else already listed here. When the user gives a host that matches an entry below, you already have what you need to connect.)

${lines.join('\n\n')}`
}
