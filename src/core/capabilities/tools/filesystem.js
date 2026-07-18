import fs from 'fs'
import path from 'path'
import { throwIfAborted } from '../abort-utils.js'
import { SANDBOX_ROOT, assertInSandbox, normalizeSandboxPath } from '../sandbox.js'

const PROTECTED_FILES = new Set(['readme.txt', 'world.txt', 'package.json'])

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}
export async function execReadFile(args, context = {}) {
  throwIfAborted(context.signal)
  const rawPath = args.path || args.filename || args.file_path
  if (!rawPath) return '错误：未提供文件路径'
  const filePath = normalizeSandboxPath(rawPath)
  const resolved = path.resolve(SANDBOX_ROOT, filePath)
  assertInSandbox(resolved)
  const content = fs.readFileSync(resolved, 'utf-8')
  const hasRange = args.start_line !== undefined || args.end_line !== undefined || args.max_lines !== undefined
  if (!hasRange) return content

  const lines = content.split(/\r?\n/)
  const start = Math.max(1, parseInt(args.start_line ?? 1, 10) || 1)
  const maxLines = args.max_lines !== undefined
    ? Math.max(0, parseInt(args.max_lines, 10) || 0)
    : null
  const requestedEnd = args.end_line !== undefined
    ? Math.max(start, parseInt(args.end_line, 10) || start)
    : null
  const end = maxLines !== null
    ? Math.min(lines.length, start + maxLines - 1)
    : Math.min(lines.length, requestedEnd ?? lines.length)
  const selected = maxLines === 0 ? [] : lines.slice(start - 1, end)
  return toolJson({
    ok: true,
    tool: 'read_file',
    path: filePath,
    absolute_path: resolved,
    start_line: start,
    end_line: end,
    total_lines: lines.length,
    truncated: end < lines.length || start > 1,
    content: selected.join('\n'),
  })
}

export async function execListDir(args, context = {}) {
  throwIfAborted(context.signal)
  const rawPath = args.path || args.dir || args.directory || '.'
  const dirPath = normalizeSandboxPath(rawPath)
  const resolved = path.resolve(SANDBOX_ROOT, dirPath)
  assertInSandbox(resolved)
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  const result = entries.map(e => {
    const type = e.isDirectory() ? '[目录]' : '[文件]'
    return `${type} ${e.name}`
  }).join('\n')
  const relDisplay = dirPath === '.' ? '.' : dirPath.replace(/\\/g, '/')
  return `目录（相对路径）：${relDisplay}\n\n${result || '（空目录）'}`
}

export async function execWriteFile(args, context = {}) {
  throwIfAborted(context.signal)
  const rawPath = args.path || args.filename || args.file_path
  const content = args.content ?? args.text ?? args.data
  if (!rawPath) return '错误：未提供文件路径'
  if (content === undefined) return '错误：未提供写入内容'
  const filePath = normalizeSandboxPath(rawPath)
  if (PROTECTED_FILES.has(path.basename(filePath).toLowerCase())) {
    return `错误：${path.basename(filePath)} 是系统文件，不可修改`
  }
  const resolved = path.resolve(SANDBOX_ROOT, filePath)
  assertInSandbox(resolved)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content, 'utf-8')
  const verifiedContent = fs.readFileSync(resolved, 'utf-8')
  const verified = verifiedContent === String(content)
  const bytes = Buffer.byteLength(verifiedContent, 'utf-8')
  if (!verified) {
    return toolJson({
      ok: false,
      tool: 'write_file',
      path: filePath,
      absolute_path: resolved,
      bytes,
      verified: false,
      error: 'read-back verification did not match written content',
    })
  }
  return toolJson({
    ok: true,
    tool: 'write_file',
    path: filePath,
    absolute_path: resolved,
    bytes,
    verified: true,
    content_preview: verifiedContent.slice(0, 120),
  })
}

export async function execDeleteFile(args, context = {}) {
  throwIfAborted(context.signal)
  const rawPath = args.path || args.filename || args.file_path
  if (!rawPath) return '错误：未提供路径'
  const filePath = normalizeSandboxPath(rawPath)
  if (PROTECTED_FILES.has(path.basename(filePath).toLowerCase())) {
    return `错误：${path.basename(filePath)} 是系统文件，不可删除`
  }
  const resolved = path.resolve(SANDBOX_ROOT, filePath)
  assertInSandbox(resolved)
  if (!fs.existsSync(resolved)) return `错误：路径不存在：${filePath}`
  const stat = fs.statSync(resolved)
  if (stat.isDirectory()) {
    fs.rmSync(resolved, { recursive: true, force: true })
    const verifiedAbsent = !fs.existsSync(resolved)
    return toolJson({
      ok: verifiedAbsent,
      tool: 'delete_file',
      path: filePath,
      kind: 'directory',
      verified_absent: verifiedAbsent,
    })
  } else {
    fs.unlinkSync(resolved)
    const verifiedAbsent = !fs.existsSync(resolved)
    return toolJson({
      ok: verifiedAbsent,
      tool: 'delete_file',
      path: filePath,
      kind: 'file',
      verified_absent: verifiedAbsent,
    })
  }
}

export async function execMakeDir(args, context = {}) {
  throwIfAborted(context.signal)
  const rawPath = args.path || args.dir || args.directory
  if (!rawPath) return '错误：未提供目录路径'
  const dirPath = normalizeSandboxPath(rawPath)
  const resolved = path.resolve(SANDBOX_ROOT, dirPath)
  assertInSandbox(resolved)
  fs.mkdirSync(resolved, { recursive: true })
  const verified = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
  return toolJson({
    ok: verified,
    tool: 'make_dir',
    path: dirPath,
    absolute_path: resolved,
    verified,
  })
}
