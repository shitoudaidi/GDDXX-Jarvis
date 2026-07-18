import path from 'path'
import { config } from '../config.js'
import { paths } from '../paths.js'

export const SANDBOX_ROOT = path.resolve(paths.sandboxDir)

export function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}
export function assertInSandbox(resolvedPath) {
  if (config.security?.fileSandbox === false) return
  if (resolvedPath !== SANDBOX_ROOT && !isPathInside(SANDBOX_ROOT, resolvedPath)) {
    throw new Error(`访问被拒绝：文件操作只允许在 sandbox 目录内（${SANDBOX_ROOT}）`)
  }
}

export function normalizeSandboxPath(filePath) {
  if (path.isAbsolute(filePath)) {
    const rel = path.relative(SANDBOX_ROOT, filePath)
    if (!rel.startsWith('..')) return rel || '.'
  }
  return filePath
    .replace(/^sandbox[\\/]/i, '')
    .replace(/^\.[\\/]/, '')
}
