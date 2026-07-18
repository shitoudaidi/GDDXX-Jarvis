/**
 * system-info.js
 *
 * 启动时自动收集宿主机系统环境信息，直接落盘，不经过记忆识别器。
 * 支持 Windows / macOS / Linux，每个平台有专属实现，互不干扰。
 *
 * 两种模式：
 *   首次启动（无 system-info.json）：完整扫描所有字段并写盘
 *   后续启动（有 system-info.json）：读静态字段，重查动态字段，验证关键路径
 *
 * 对外接口：
 *   collectSystemInfo()     → 启动时调用一次，async
 *   getSystemInfoBlock()    → 返回注入 prompt 的纯文本块，同步
 *   isFirstRunSystemInfo()  → 是否是首次启动（无落盘文件）
 */

import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { paths } from './paths.js'

const SYSTEM_INFO_FILE = path.join(paths.dataDir, 'system-info.json')
const SYSTEM_INFO_VERSION = 1

const IS_WIN   = process.platform === 'win32'
const IS_MAC   = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

let _cached = null

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

/** 执行 shell 命令，失败返回 null，windowsHide 防止 Windows 弹出黑窗口 */
function safeExec(cmd, timeoutMs = 8000, label = '') {
  try {
    return execSync(cmd, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }).trim()
  } catch (err) {
    if (label) {
      console.warn(`[system-info] ${label} exec failed:`, err.message || err)
    }
    return null
  }
}

// ─── OS 版本 ───────────────────────────────────────────────────────────────────

function getWindowsOSVersion() {
  const cmd = `powershell -NoProfile -NonInteractive -Command `
    + `"$r=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';`
    + `$b=[System.Environment]::OSVersion.Version.Build;`
    + `[PSCustomObject]@{Build=$b;Ed=$r.EditionID;Dv=$r.DisplayVersion}|ConvertTo-Json"`
  const raw = safeExec(cmd)
  const v = safe(() => JSON.parse(raw))
  if (!v) return os.version() || `Windows ${os.release()}`
  const major = Number(v.Build) >= 22000 ? '11' : '10'
  return `Windows ${major} ${v.Ed || ''} ${v.Dv || ''} (Build ${v.Build})`
    .replace(/\s+/g, ' ').trim()
}

function getMacOSVersion() {
  // sw_vers 输出示例：macOS 14.5 (23F79)
  const name    = safeExec('sw_vers -productName')    ?? 'macOS'
  const version = safeExec('sw_vers -productVersion') ?? ''
  const build   = safeExec('sw_vers -buildVersion')   ?? ''
  return `${name} ${version}${build ? ` (${build})` : ''}`.trim()
}

function getLinuxOSVersion() {
  // 优先读 PRETTY_NAME（如 "Ubuntu 22.04.3 LTS"），否则拼内核版本
  const raw = safe(() => fs.readFileSync('/etc/os-release', 'utf8'))
  if (raw) {
    const pretty = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1]
    if (pretty) return pretty
    const name    = raw.match(/^NAME="?([^"\n]+)"?/m)?.[1] ?? ''
    const version = raw.match(/^VERSION="?([^"\n]+)"?/m)?.[1] ?? ''
    if (name) return `${name} ${version}`.trim()
  }
  return `${os.type()} ${os.release()}`
}

function getOSVersion() {
  if (IS_WIN)   return getWindowsOSVersion()
  if (IS_MAC)   return getMacOSVersion()
  if (IS_LINUX) return getLinuxOSVersion()
  return `${os.type()} ${os.release()}`
}

// ─── 特殊文件夹路径 ────────────────────────────────────────────────────────────

/**
 * Windows：通过 Shell COM 对象查真实路径。
 * 用户可能把桌面/文档迁移到其他盘，os.homedir() 拼接不可靠。
 */
function getWindowsShellPaths() {
  const cmd = `powershell -NoProfile -NonInteractive -Command `
    + `"$uf=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';`
    + `function X($v){if([string]::IsNullOrWhiteSpace($v)){return $null};[Environment]::ExpandEnvironmentVariables($v)};`
    + `function F($v,$fb){$x=X $v;if([string]::IsNullOrWhiteSpace($x)){$fb}else{$x}};`
    + `$downloads=X $uf.'{374DE290-123F-4565-9164-39C4925E467B}';`
    + `if([string]::IsNullOrWhiteSpace($downloads)){$downloads=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path};`
    + `[PSCustomObject]@{`
    + `Desktop=F $uf.Desktop ([Environment]::GetFolderPath('DesktopDirectory'));`
    + `Documents=F $uf.Personal ([Environment]::GetFolderPath('MyDocuments'));`
    + `Downloads=$downloads;`
    + `Pictures=F $uf.'My Pictures' ([Environment]::GetFolderPath('MyPictures'));`
    + `Music=F $uf.'My Music' ([Environment]::GetFolderPath('MyMusic'));`
    + `Videos=F $uf.'My Video' ([Environment]::GetFolderPath('MyVideos'))`
    + `}|ConvertTo-Json"`
  const raw = safeExec(cmd, 8000, 'shell-paths')
  if (!raw) {
    console.warn('[system-info] PowerShell shell paths query returned nothing, falling back to home-relative paths')
    return {}
  }
  // 注意：JSON.parse(null) 不抛错而是返回 JS null，必须显式判 null 后再 fallback
  const parsed = safe(() => JSON.parse(raw), null)
  if (!parsed || typeof parsed !== 'object') {
    console.warn('[system-info] PowerShell shell paths returned invalid JSON, falling back. raw:', raw?.slice(0, 200))
    return {}
  }
  return parsed
}

/**
 * macOS：各目录在 ~/Desktop 等标准位置，不会被用户迁移，直接拼接即可。
 * Mac 的视频目录叫 Movies 不叫 Videos。
 */
function getMacShellPaths() {
  const home = os.homedir()
  return {
    Desktop:   path.join(home, 'Desktop'),
    Documents: path.join(home, 'Documents'),
    Downloads: path.join(home, 'Downloads'),
    Pictures:  path.join(home, 'Pictures'),
    Music:     path.join(home, 'Music'),
    Videos:    path.join(home, 'Movies'),  // macOS 习惯叫 Movies
  }
}

/**
 * Linux：优先用 xdg-user-dir 查 XDG 规范路径（支持用户自定义）。
 * xdg-utils 未安装时降级到 ~/Desktop 等。
 */
function getLinuxShellPaths() {
  function xdg(dir) {
    const result = safeExec(`xdg-user-dir ${dir}`, 3000)
    // xdg-user-dir 未安装时返回 home 目录本身，需要过滤掉
    if (!result || result === os.homedir()) return null
    return result
  }
  const home = os.homedir()
  return {
    Desktop:   xdg('DESKTOP')   ?? path.join(home, 'Desktop'),
    Documents: xdg('DOCUMENTS') ?? path.join(home, 'Documents'),
    Downloads: xdg('DOWNLOAD')  ?? path.join(home, 'Downloads'),
    Pictures:  xdg('PICTURES')  ?? path.join(home, 'Pictures'),
    Music:     xdg('MUSIC')     ?? path.join(home, 'Music'),
    Videos:    xdg('VIDEOS')    ?? path.join(home, 'Videos'),
  }
}

function getShellPaths() {
  let result
  try {
    if (IS_WIN)        result = getWindowsShellPaths()
    else if (IS_MAC)   result = getMacShellPaths()
    else if (IS_LINUX) result = getLinuxShellPaths()
  } catch (err) {
    console.warn('[system-info] getShellPaths threw:', err?.message || err)
  }
  // 终极保险：无论子函数返回什么，这里都保证是合法对象
  if (!result || typeof result !== 'object') result = {}
  return result
}

function mergeFreshShellPaths(staticData) {
  const oldPaths = staticData?.paths
  if (!oldPaths) return staticData

  const fresh = getShellPaths()
  const nextPaths = { ...oldPaths }
  let changed = false

  for (const [freshKey, storedKey] of [
    ['Desktop', 'desktop'],
    ['Documents', 'documents'],
    ['Downloads', 'downloads'],
    ['Pictures', 'pictures'],
    ['Music', 'music'],
    ['Videos', 'videos'],
  ]) {
    const value = fresh[freshKey]
    if (value && value !== oldPaths[storedKey]) {
      nextPaths[storedKey] = value
      changed = true
    }
  }

  return changed
    ? { ...staticData, paths: nextPaths }
    : staticData
}

// ─── 电量 ──────────────────────────────────────────────────────────────────────

/**
 * Windows：WMI Win32_Battery
 * BatteryStatus: 1=放电, 2=AC满电, 3=满充, 4=低电, 6=充电中, 7=充电高, 8=充电低, 9=充电危险
 */
function getWindowsBattery() {
  const cmd = `powershell -NoProfile -NonInteractive -Command `
    + `"$b=Get-WmiObject Win32_Battery;`
    + `if($b){[PSCustomObject]@{pct=$b.EstimatedChargeRemaining;st=$b.BatteryStatus}|ConvertTo-Json}else{'null'}"`
  const raw = safeExec(cmd)
  if (!raw || raw === 'null') return null
  const b = safe(() => JSON.parse(raw))
  if (!b) return null
  const charging = [2, 3, 6, 7, 8, 9].includes(Number(b.st))
  return { pct: Number(b.pct), charging }
}

/**
 * macOS：pmset -g batt
 * 输出示例：InternalBattery-0 (id=...) \t78%; discharging; 3:45 remaining
 */
function getMacBattery() {
  const raw = safeExec('pmset -g batt')
  if (!raw) return null
  // 匹配百分比和充电状态
  const match = raw.match(/(\d+)%;\s*(charging|discharging|finishing charge|charged|not charging|AC attached)/i)
  if (!match) return null
  const pct = parseInt(match[1], 10)
  const charging = !/^(discharging|not charging)$/i.test(match[2])
  return { pct, charging }
}

/**
 * Linux：读 /sys/class/power_supply/BATx/
 * capacity 文件：电量百分比；status 文件：Charging / Discharging / Full
 */
function getLinuxBattery() {
  const psDir = '/sys/class/power_supply'
  const entries = safe(() => fs.readdirSync(psDir)) ?? []
  const batName = entries.find(e => /^BAT/i.test(e))
  if (!batName) return null
  const batPath = path.join(psDir, batName)
  const pct    = safe(() => parseInt(fs.readFileSync(path.join(batPath, 'capacity'), 'utf8').trim(), 10))
  const status = safe(() => fs.readFileSync(path.join(batPath, 'status'), 'utf8').trim())
  if (pct == null || isNaN(pct)) return null
  const charging = !/^Discharging$/i.test(status ?? '')
  return { pct, charging }
}

function getBattery() {
  if (IS_WIN)   return getWindowsBattery()
  if (IS_MAC)   return getMacBattery()
  if (IS_LINUX) return getLinuxBattery()
  return null
}

// ─── 网络 ──────────────────────────────────────────────────────────────────────

/** 从网卡列表中取第一个非 loopback 的 IPv4 地址，跨平台 */
function getLocalIP() {
  const ifaces = os.networkInterfaces()
  for (const addrs of Object.values(ifaces)) {
    for (const addr of (addrs || [])) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

// ─── 核心：收集 + 落盘 ────────────────────────────────────────────────────────

export async function collectSystemInfo() {
  const exists = fs.existsSync(SYSTEM_INFO_FILE)

  if (exists) {
    // ── 非首次启动：读静态数据，只刷新动态字段 ──────────────────────────────
    let stored = null
    try { stored = JSON.parse(fs.readFileSync(SYSTEM_INFO_FILE, 'utf8')) } catch {}

    if (stored?.version === SYSTEM_INFO_VERSION) {
      let staticData = mergeFreshShellPaths(stored.static)

      // 验证桌面路径是否还存在（Windows 用户可能迁盘，Linux XDG 配置可能变化）
      const desktopPath = staticData?.paths?.desktop
      if (desktopPath && !fs.existsSync(desktopPath)) {
        console.log('[system-info] 桌面路径失效，重新查询...')
        const newPaths = getShellPaths()
        staticData = {
          ...staticData,
          paths: {
            ...staticData.paths,
            desktop:   newPaths.Desktop   ?? staticData.paths.desktop,
            documents: newPaths.Documents ?? staticData.paths.documents,
            downloads: newPaths.Downloads ?? staticData.paths.downloads,
            pictures:  newPaths.Pictures  ?? staticData.paths.pictures,
            music:     newPaths.Music     ?? staticData.paths.music,
            videos:    newPaths.Videos    ?? staticData.paths.videos,
          },
        }
      }

      // 重查动态字段
      const battery = getBattery()

      const updated = {
        ...stored,
        static: staticData,
        dynamic: {
          battery_pct:      battery?.pct      ?? null,
          battery_charging: battery?.charging ?? null,
          ram_free_gb: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
          local_ip:  getLocalIP(),
          checked_at: new Date().toISOString(),
        },
      }

      try { fs.writeFileSync(SYSTEM_INFO_FILE, JSON.stringify(updated, null, 2), 'utf8') } catch {}
      _cached = updated
      console.log('[system-info] 动态信息已刷新')
      return updated
    }
  }

  // ── 首次启动：完整扫描 ────────────────────────────────────────────────────
  console.log('[system-info] 首次收集系统环境信息...')

  const shellPaths = getShellPaths()
  const battery = getBattery()
  const homedir = os.homedir()
  const cpus = os.cpus()

  const info = {
    version: SYSTEM_INFO_VERSION,
    platform: process.platform,
    first_collected_at: new Date().toISOString(),

    static: {
      os:       getOSVersion(),
      arch:     os.arch(),
      hostname: os.hostname(),
      username: os.userInfo().username,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale:   Intl.DateTimeFormat().resolvedOptions().locale,
      cpu:      cpus[0]?.model?.trim() ?? 'unknown',
      ram_gb:   Math.round(os.totalmem() / (1024 ** 3)),
      paths: {
        home:      homedir,
        desktop:   shellPaths.Desktop   ?? path.join(homedir, 'Desktop'),
        documents: shellPaths.Documents ?? path.join(homedir, 'Documents'),
        downloads: shellPaths.Downloads ?? path.join(homedir, 'Downloads'),
        pictures:  shellPaths.Pictures  ?? path.join(homedir, 'Pictures'),
        music:     shellPaths.Music     ?? path.join(homedir, 'Music'),
        videos:    shellPaths.Videos    ?? path.join(homedir, 'Videos'),
      },
    },

    dynamic: {
      battery_pct:      battery?.pct      ?? null,
      battery_charging: battery?.charging ?? null,
      ram_free_gb: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
      local_ip:  getLocalIP(),
      checked_at: new Date().toISOString(),
    },
  }

  try {
    fs.writeFileSync(SYSTEM_INFO_FILE, JSON.stringify(info, null, 2), 'utf8')
    console.log('[system-info] 系统信息已落盘:', SYSTEM_INFO_FILE)
  } catch (err) {
    console.warn('[system-info] 落盘失败:', err.message)
  }

  _cached = info
  return info
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 返回注入 system prompt 的纯文本块。
 * 必须在 collectSystemInfo() 完成后调用。
 */
export function getSystemInfoBlock() {
  if (!_cached) return ''
  const s = _cached.static
  const d = _cached.dynamic

  const lines = [
    `## Runtime Environment`,
    `OS: ${s.os} · ${s.arch}`,
    `Host: ${s.hostname} · User: ${s.username}`,
    `Home: ${s.paths.home}`,
    `Desktop: ${s.paths.desktop}`,
    `Documents: ${s.paths.documents}`,
    `Downloads: ${s.paths.downloads}`,
    `CPU: ${s.cpu} · RAM: ${s.ram_gb} GB total · ${d.ram_free_gb ?? '?'} GB free`,
  ]

  if (d.local_ip) lines.push(`Local IP: ${d.local_ip}`)

  lines.push(`Timezone: ${s.timezone} · Locale: ${s.locale}`)

  return lines.join('\n')
}

const BATTERY_CACHE_MS  = 2 * 60 * 1000  // 2 分钟
const BATTERY_EVENT_TTL = 5 * 60 * 1000  // 变更事件最多保留 5 分钟

let _batteryCache = null   // { pct, charging, ts }
let _batteryEvent = null   // { type: 'plugged_in'|'unplugged', pct, ts }

/**
 * 仅返回动态电量信息，每轮注入使用。
 * 结果缓存 2 分钟，避免每轮查询硬件。
 * 检测到充电状态变化时追加事件行，5 分钟后自动过期。
 * 无电池（台式机）时返回空字符串。
 */
export function getBatteryBlock() {
  const now = Date.now()

  if (!_batteryCache || now - _batteryCache.ts >= BATTERY_CACHE_MS) {
    const b = getBattery()
    const newCharging = b?.charging ?? null
    const prevCharging = _batteryCache?.charging ?? null

    // 检测充电状态变化（排除首次采集）
    if (_batteryCache && newCharging !== null && prevCharging !== null && newCharging !== prevCharging) {
      _batteryEvent = {
        type: newCharging ? 'plugged_in' : 'unplugged',
        pct: b.pct,
        ts: now,
      }
    }

    _batteryCache = b
      ? { pct: b.pct, charging: b.charging, ts: now }
      : { pct: null, ts: now }
  }

  if (_batteryCache.pct === null || _batteryCache.pct === undefined) return ''

  const status = _batteryCache.charging ? 'charging' : 'discharging'
  const lines = [`Battery: ${_batteryCache.pct}% (${status})`]

  // 追加变更事件（5 分钟内有效）
  if (_batteryEvent && now - _batteryEvent.ts < BATTERY_EVENT_TTL) {
    const time = new Date(_batteryEvent.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const msg = _batteryEvent.type === 'plugged_in'
      ? `[Event] Charger plugged in at ${_batteryEvent.pct}% (${time})`
      : `[Event] Charger unplugged at ${_batteryEvent.pct}% (${time})`
    lines.push(msg)
  } else {
    _batteryEvent = null
  }

  return lines.join('\n')
}

/** 返回用户桌面路径，必须在 collectSystemInfo() 完成后调用。 */
export function getDesktopPath() {
  return _cached?.static?.paths?.desktop ?? null
}

/**
 * 是否是首次启动（system-info.json 不存在）。
 * 可在 collectSystemInfo() 调用之前查询。
 */
export function isFirstRunSystemInfo() {
  return !fs.existsSync(SYSTEM_INFO_FILE)
}
