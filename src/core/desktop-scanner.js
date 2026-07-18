/**
 * desktop-scanner.js
 *
 * 扫描用户真实桌面目录，采集快捷方式列表和普通文件列表，注入 system prompt。
 *
 * 注意：直接用 fs 读取真实桌面路径，不经过 exec_command，不受沙箱限制。
 *
 * 快捷方式（Windows: .lnk / macOS: .app / Linux: .desktop）：
 *   以桌面目录 mtime 为 key 缓存到磁盘，目录内容未变则直接复用。
 *
 * 普通文件：
 *   每次启动扫描，不落盘，全量展示（按扩展名分组压缩）。
 *
 * 对外接口：
 *   collectDesktopInfo(desktopPath)  → 同步，启动时调用一次
 *   getDesktopBlock()                → 返回注入 prompt 的纯文本块，同步
 */

import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'

const SHORTCUTS_CACHE_FILE    = path.join(paths.dataDir, 'desktop-shortcuts.json')
const SHORTCUTS_CACHE_VERSION = 1

const IS_WIN  = process.platform === 'win32'
const IS_MAC  = process.platform === 'darwin'

let _cached = null

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

// ─── 快捷方式扫描（跨平台） ───────────────────────────────────────────────────

function scanShortcutsWin(desktopPath) {
  const entries = safe(() => fs.readdirSync(desktopPath, { withFileTypes: true }), [])
  return entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.lnk'))
    .map(e => path.basename(e.name, path.extname(e.name)))
    .filter(Boolean)
    .sort()
}

function scanShortcutsMac(desktopPath) {
  const entries = safe(() => fs.readdirSync(desktopPath, { withFileTypes: true }), [])
  return entries
    .filter(e =>
      (e.isDirectory() && e.name.endsWith('.app')) ||
      (e.isFile()      && e.name.endsWith('.webloc'))
    )
    .map(e => path.basename(e.name, path.extname(e.name)))
    .filter(Boolean)
    .sort()
}

function scanShortcutsLinux(desktopPath) {
  const entries = safe(() => fs.readdirSync(desktopPath, { withFileTypes: true }), [])
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.desktop'))
    .map(e => {
      // 优先读 .desktop 文件里的 Name= 字段
      const content = safe(() => fs.readFileSync(path.join(desktopPath, e.name), 'utf8'), '')
      const match   = content.match(/^Name=(.+)$/m)
      return match ? match[1].trim() : path.basename(e.name, '.desktop')
    })
    .filter(Boolean)
    .sort()
}

function scanShortcuts(desktopPath) {
  if (IS_WIN) return scanShortcutsWin(desktopPath)
  if (IS_MAC) return scanShortcutsMac(desktopPath)
  return scanShortcutsLinux(desktopPath)
}

// ─── 普通文件扫描 ─────────────────────────────────────────────────────────────

const SHORTCUT_EXTS  = new Set(['.lnk', '.app', '.desktop', '.webloc'])
const SKIP_FILENAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store'])

function scanFiles(desktopPath) {
  const entries = safe(() => fs.readdirSync(desktopPath, { withFileTypes: true }), [])
  return entries
    .filter(e => {
      if (!e.isFile()) return false
      const lower = e.name.toLowerCase()
      if (SKIP_FILENAMES.has(lower)) return false
      if (lower.startsWith('.')) return false
      if (SHORTCUT_EXTS.has(path.extname(lower))) return false
      return true
    })
    .map(e => e.name)
    .sort()
}

// ─── 核心：采集 + 落盘（快捷方式）+ 临时扫描（文件） ─────────────────────────

export function collectDesktopInfo(desktopPath) {
  if (!desktopPath || !fs.existsSync(desktopPath)) {
    console.warn('[desktop] 桌面路径无效:', desktopPath)
    _cached = { shortcuts: [], files: [], desktopPath: null }
    return _cached
  }

  // 以桌面目录的 mtime 作为缓存 key：只要目录内容未变，直接复用快捷方式列表
  const desktopMtime = safe(() => fs.statSync(desktopPath).mtimeMs, 0)
  const stored = safe(() => JSON.parse(fs.readFileSync(SHORTCUTS_CACHE_FILE, 'utf8')))

  let shortcuts
  if (
    stored?.version === SHORTCUTS_CACHE_VERSION &&
    stored?.desktop_path === desktopPath &&
    stored?.desktop_mtime === desktopMtime
  ) {
    console.log('[desktop] 快捷方式缓存命中，跳过重新扫描')
    shortcuts = Array.isArray(stored.shortcuts) ? stored.shortcuts : []
  } else {
    console.log('[desktop] 扫描快捷方式...')
    shortcuts = scanShortcuts(desktopPath)
    safe(() => fs.writeFileSync(
      SHORTCUTS_CACHE_FILE,
      JSON.stringify({
        version:       SHORTCUTS_CACHE_VERSION,
        desktop_path:  desktopPath,
        desktop_mtime: desktopMtime,
        shortcuts,
        scanned_at:    new Date().toISOString(),
      }, null, 2),
      'utf8'
    ))
  }

  // 普通文件：每次启动扫，不落盘
  const files = scanFiles(desktopPath)

  console.log('[desktop] 完成 — 快捷方式:', shortcuts.length, '个 | 文件:', files.length, '个')
  _cached = { shortcuts, files, desktopPath }
  return _cached
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 返回注入 system prompt 的纯文本块。
 * 必须在 collectDesktopInfo() 完成后调用。
 */
export function getDesktopBlock() {
  if (!_cached) return ''
  const { shortcuts, files } = _cached
  if (shortcuts.length === 0 && files.length === 0) return ''

  const lines = ['## User Desktop']

  if (shortcuts.length > 0) {
    const list = shortcuts.length <= 30
      ? shortcuts.join(', ')
      : shortcuts.slice(0, 30).join(', ') + ' ... (' + shortcuts.length + ' total)'
    lines.push('Apps & Shortcuts (' + shortcuts.length + '): ' + list)
  }

  if (files.length > 0) {
    // 按扩展名分组：小组（≤3）列出全部文件名，大组只列前2个作为样本
    const groups = {}
    for (const name of files) {
      const ext = path.extname(name).toLowerCase() || '(no ext)'
      if (!groups[ext]) groups[ext] = []
      groups[ext].push(name)
    }
    const parts = Object.entries(groups).map(([ext, names]) => {
      if (names.length <= 3) return names.join(', ')
      return ext + ' \xd7 ' + names.length + ' (' + names.slice(0, 2).join(', ') + ' ...)'
    })
    lines.push('Files (' + files.length + '): ' + parts.join(' | '))
  }

  return lines.join('\n')
}
