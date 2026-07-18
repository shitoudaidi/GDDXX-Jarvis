import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const IS_WIN   = process.platform === 'win32'
const IS_MAC   = process.platform === 'darwin'

// ── WSL 工具（仅 Windows）──────────────────────────────────────────────────

// 列出可用 WSL 发行版，返回名称数组（如 ['Ubuntu', 'Debian']）
function getWSLDistros() {
  if (!IS_WIN) return []
  try {
    // --list --quiet 返回纯发行版名，但可能有 BOM 和乱码字符，需要清理
    const raw = execSync('wsl --list --quiet', {
      timeout: 4000, encoding: 'utf-16le', stdio: ['pipe', 'pipe', 'pipe']
    })
    return raw
      .split(/\r?\n/)
      .map(s => s.replace(/\0/g, '').trim())
      .filter(s => s && !/^\s*$/.test(s) && s !== '(Default)')
  } catch {
    return []
  }
}

// 在 WSL 发行版里执行命令，返回 stdout 字符串（失败返回 null）
// 注意：WSL2 NAT 模式会在 stderr 输出 localhost 警告，使用 2>/dev/null 过滤
function wslExec(distro, shellCmd) {
  try {
    const out = execSync(
      `wsl -d "${distro}" bash -c "${shellCmd.replace(/"/g, '\\"')} 2>/dev/null"`,
      { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return out.trim() || null
  } catch {
    return null
  }
}

// 在 WSL 里查找二进制，返回路径或 null
function findInWSL(distro, name) {
  const result = wslExec(distro, `which ${name} 2>/dev/null`)
  return result && !result.startsWith('wsl:') ? result : null
}

// 检测 WSL 内某端口是否在监听
function isPortListeningInWSL(distro, port) {
  const result = wslExec(distro,
    `{ ss -lnt 2>/dev/null | grep -q ':${port}' || netstat -lnt 2>/dev/null | grep -q ':${port}'; } && echo yes`
  )
  return result === 'yes'
}

// 获取 WSL 发行版的内网 IP（NAT 模式下 localhost 不通，需要用这个 IP）
function getWSLIP(distro) {
  const ip = wslExec(distro,
    "ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}'"
  ) || wslExec(distro, "hostname -I 2>/dev/null | awk '{print $1}'")
  return ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null
}

// 每个 Agent 的探针定义
// probe() 返回 { available, version, invokeType, invokeCmd, invokeArgs, notes }
const AGENT_PROBES = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: '擅长代码编写、重构、调试，支持多文件上下文',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/cli-usage',
    docsSearchQuery: 'Claude Code CLI usage documentation site:docs.anthropic.com',
    probe: probeClaudeCode,
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    description: '代码生成与终端自动化，OpenAI 官方 CLI',
    docsUrl: 'https://github.com/openai/codex',
    docsSearchQuery: 'OpenAI Codex CLI usage documentation github',
    probe: probeCodex,
  },
  {
    id: 'hermes',
    name: 'Hermes',
    description: '本地 AI 助手，支持多模型对话与本地知识库',
    docsUrl: 'https://ollama.com/library/hermes3',
    docsSearchQuery: 'Hermes LLM ollama CLI usage how to run',
    probe: probeHermes,
  },
  {
    id: 'openclaw',
    name: '小龙虾 OpenClaw',
    description: '自动化 Agent，支持工作流编排与多步任务',
    docsUrl: null,
    docsSearchQuery: 'OpenClaw AI agent CLI usage documentation',
    probe: probeOpenClaw,
  },
]

// ── 各 Agent 探针实现 ──────────────────────────────────────────────────────

function probeClaudeCode() {
  // 检测 claude CLI
  const cliPath = findInPath('claude')
  if (cliPath) {
    const version = tryExec('claude --version') || ''
    return {
      available: true,
      version: parseVersion(version) || 'unknown',
      invokeType: 'cli',
      invokeCmd: 'claude',
      invokeArgs: ['-p', '{prompt}'],
      notes: `CLI: ${cliPath}`,
    }
  }

  // 检测 Electron 桌面应用安装目录（各平台路径不同）
  const installDirs = IS_WIN
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Claude'),
      ]
    : IS_MAC
    ? [
        '/Applications/Claude.app',
        path.join(os.homedir(), 'Applications', 'Claude.app'),
      ]
    : [
        path.join(os.homedir(), '.local', 'share', 'claude'),
        '/opt/claude',
      ]
  for (const dir of installDirs) {
    if (fs.existsSync(dir)) {
      return {
        available: true,
        version: 'desktop',
        invokeType: 'cli',
        invokeCmd: 'claude',
        invokeArgs: ['-p', '{prompt}'],
        notes: `Desktop app: ${dir}`,
      }
    }
  }

  // 检测 ~/.claude 配置目录（说明安装过）
  const claudeConfig = path.join(os.homedir(), '.claude')
  if (fs.existsSync(claudeConfig)) {
    return {
      available: true,
      version: 'config-only',
      invokeType: 'cli',
      invokeCmd: 'claude',
      invokeArgs: ['-p', '{prompt}'],
      notes: `Config dir: ${claudeConfig}`,
    }
  }

  return { available: false }
}

function probeCodex() {
  const cliPath = findInPath('codex')
  if (cliPath) {
    const version = tryExec('codex --version') || ''
    return {
      available: true,
      version: parseVersion(version) || 'unknown',
      invokeType: 'cli',
      invokeCmd: 'codex',
      invokeArgs: ['{prompt}'],
      notes: `CLI: ${cliPath}`,
    }
  }

  // 检测 npm 全局安装
  const npmGlobal = tryExec('npm root -g')
  if (npmGlobal) {
    const codexPkg = path.join(npmGlobal.trim(), '@openai', 'codex')
    if (fs.existsSync(codexPkg)) {
      return {
        available: true,
        version: 'npm-global',
        invokeType: 'cli',
        invokeCmd: 'codex',
        invokeArgs: ['{prompt}'],
        notes: `npm global: ${codexPkg}`,
      }
    }
  }

  return { available: false }
}

function probeHermes() {
  // 只检测 Hermes / Ollama 专属端口，不用 8080/8081（太泛，会误报）
  const ports = [1337, 11434]
  for (const port of ports) {
    if (isPortListening(port)) {
      return {
        available: true,
        version: `port:${port}`,
        invokeType: 'http',
        invokeCmd: `http://localhost:${port}`,
        invokeArgs: [],
        notes: `HTTP on port ${port}`,
      }
    }
  }

  // 检测 CLI
  const cliPath = findInPath('hermes')
  if (cliPath) {
    return {
      available: true,
      version: tryExec('hermes --version') || 'unknown',
      invokeType: 'cli',
      invokeCmd: 'hermes',
      invokeArgs: ['chat', '--message', '{prompt}'],
      notes: `CLI: ${cliPath}`,
    }
  }

  // 检测 Ollama（Hermes 常跑在 Ollama 上，Windows 原生）
  const ollamaPath = findInPath('ollama')
  if (ollamaPath) {
    const models = tryExec('ollama list') || ''
    const hermesMatch = models.match(/(hermes[\w.:/-]*)/i)
    if (hermesMatch) {
      const modelName = hermesMatch[1].split(/\s/)[0]
      return {
        available: true,
        version: `ollama:${modelName}`,
        invokeType: 'cli',
        invokeCmd: 'ollama',
        invokeArgs: ['run', modelName, '{prompt}'],
        notes: `Ollama (Windows native) model=${modelName}`,
      }
    }
  }

  // ── WSL 检测（仅 Windows）──────────────────────────────────────────────
  if (IS_WIN) {
    for (const distro of getWSLDistros()) {
      // 1. WSL 内直接安装了 hermes CLI
      const hermesPath = findInWSL(distro, 'hermes')
      if (hermesPath) {
        const version = wslExec(distro, 'hermes --version 2>/dev/null') || 'unknown'
        return {
          available: true,
          version: parseVersion(version) || 'unknown',
          invokeType: 'cli',
          invokeCmd: 'wsl',
          invokeArgs: ['-d', distro, 'hermes', 'chat', '--message', '{prompt}'],
          notes: `WSL:${distro} ${hermesPath}`,
        }
      }

      // 2. WSL 内跑了 Ollama + Hermes 模型
      const ollamaInWSL = findInWSL(distro, 'ollama')
      if (ollamaInWSL) {
        const models = wslExec(distro, 'ollama list 2>/dev/null') || ''
        const hermesMatch = models.match(/(hermes[\w.:/-]*)/i)
        if (hermesMatch) {
          const modelName = hermesMatch[1].split(/\s/)[0]  // 去掉版本后面的空格内容
          return {
            available: true,
            version: `ollama-wsl:${modelName}`,
            invokeType: 'cli',
            invokeCmd: 'wsl',
            invokeArgs: ['-d', distro, 'ollama', 'run', modelName, '{prompt}'],
            notes: `WSL:${distro} Ollama model=${modelName}`,
          }
        }
      }

      // 3. WSL 内跑了 HTTP 服务（Hermes server / Ollama API）
      for (const port of [11434, 1337]) {
        if (isPortListeningInWSL(distro, port)) {
          const wslIP = getWSLIP(distro)
          const baseUrl = wslIP ? `http://${wslIP}:${port}` : `http://localhost:${port}`
          return {
            available: true,
            version: `wsl-http:${port}`,
            invokeType: 'http',
            invokeCmd: baseUrl,
            invokeArgs: [],
            notes: `WSL:${distro} HTTP port ${port}${wslIP ? ` (${wslIP})` : ''}`,
          }
        }
      }
    }
  }

  return { available: false }
}

function probeOpenClaw() {
  // 只检测服务是否在线（端口监听），安装了但没跑服务不算可用
  const ports = [3210, 3211, 8765]
  for (const port of ports) {
    if (isPortListening(port)) {
      return {
        available: true,
        version: `port:${port}`,
        invokeType: 'http',
        invokeCmd: `http://localhost:${port}`,
        invokeArgs: [],
        notes: `HTTP on port ${port}`,
      }
    }
  }

  return { available: false }
}

// ── 工具函数 ────────────────────────────────────────────────────────────────

// macOS/Linux 下 Electron 的 PATH 可能缺少 /usr/local/bin 等用户路径，手动补全
const EXTRA_PATH_DIRS = IS_WIN ? [] : [
  '/usr/local/bin',
  '/opt/homebrew/bin',   // Apple Silicon homebrew
  '/usr/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
  '/opt/local/bin',      // MacPorts
]

function findInPath(name) {
  try {
    const cmd = IS_WIN ? `where ${name}` : `which ${name}`
    const result = execSync(cmd, { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = result.trim().split('\n').filter(Boolean)
    return lines[0]?.trim() || null
  } catch {
    // Electron 在 macOS/Linux 下 PATH 可能被裁剪，逐目录检查兜底
    if (!IS_WIN) {
      for (const dir of EXTRA_PATH_DIRS) {
        const full = path.join(dir, name)
        if (fs.existsSync(full)) return full
      }
    }
    return null
  }
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function parseVersion(str) {
  if (!str) return null
  const m = str.match(/(\d+\.\d+[\.\d]*)/)
  return m ? m[1] : str.split('\n')[0].trim().slice(0, 40)
}

function isPortListening(port) {
  try {
    if (IS_WIN) {
      const out = execSync(
        `netstat -ano | findstr ":${port} "`,
        { timeout: 2000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      return out.includes(`0.0.0.0:${port}`) || out.includes(`127.0.0.1:${port}`) || out.includes(`[::]:${port}`)
    }
    // macOS / Linux: lsof（无需 root，只检测 LISTEN 状态）
    const out = execSync(
      `lsof -iTCP:${port} -sTCP:LISTEN -n -P 2>/dev/null`,
      { timeout: 2000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return out.trim().length > 0
  } catch {
    return false
  }
}

// ── 主函数：扫描所有 Agent ──────────────────────────────────────────────────

export async function detectAgents() {
  const results = []
  for (const def of AGENT_PROBES) {
    try {
      const probe = def.probe()
      results.push({
        id: def.id,
        name: def.name,
        description: def.description,
        available: probe.available || false,
        version: probe.version || null,
        invokeType: probe.invokeType || null,
        invokeCmd: probe.invokeCmd || null,
        invokeArgs: probe.invokeArgs || [],
        notes: probe.notes || '',
        docsUrl: def.docsUrl || null,
        docsSearchQuery: def.docsSearchQuery || null,
        detectedAt: new Date().toISOString(),
      })
      if (probe.available) {
        console.log(`[Agents] 发现 ${def.name} (${probe.notes || probe.version})`)
      }
    } catch (err) {
      console.warn(`[Agents] 探针 ${def.id} 出错：${err.message}`)
      results.push({
        id: def.id,
        name: def.name,
        description: def.description,
        available: false,
        version: null,
        invokeType: null,
        invokeCmd: null,
        invokeArgs: [],
        notes: `probe error: ${err.message}`,
        docsUrl: def.docsUrl || null,
        docsSearchQuery: def.docsSearchQuery || null,
        detectedAt: new Date().toISOString(),
      })
    }
  }
  return results
}
