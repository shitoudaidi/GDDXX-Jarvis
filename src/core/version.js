// 应用版本号的唯一真源 —— 从 package.json 读一次并缓存。
//
// 设计目的：让 agent 知道"我是哪个版本"，且每次升级 package.json 后自动跟上，
// 不必在提示词 / 自知识文档里手写版本号（手写必然随版本漂移）。
// 与 Electron 侧的 app.getVersion()（main.cjs）同源（都来自 package.json），
// 但后端进程不一定跑在 Electron 下，所以这里直接读文件，脱离 Electron 也可用。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let cached = null

export function getAppVersion() {
  if (cached) return cached
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'))
    cached = pkg.version || 'unknown'
  } catch {
    cached = 'unknown'
  }
  return cached
}
