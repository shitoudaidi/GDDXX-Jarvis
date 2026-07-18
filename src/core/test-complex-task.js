// 复杂任务机制（ReAct 第一刀）的工具返回值测试。
//
// 测的是 executor.js 里 execSetTask / execUpdateTaskStep 的「引导串」逻辑——
// 即 set_task / update_task_step 的返回文本是否按状态正确地把模型推向
// 下一个 执行→观察→判断 微循环（推下一步 / 失败换法 / 收尾验证）。
//
// 通过真实 executeTool 调用，配一个 mock context：
//   - onSetTask：记录被调用的参数
//   - onUpdateTaskStep：按每个用例返回受控的 {progress, allTerminal, nextIndex, nextStep, anyFailed}
//     （这正是 index.js 那个回调的契约形状），从而隔离出 executor 的字符串构造逻辑。
//
// ⚠ executor.js 顶层 import 了 db.js（better-sqlite3），所以本测试必须用 electron 跑：
//     electron ./src/test-complex-task.js
//   纯 node 会报 NODE_MODULE_VERSION 不匹配。

import { executeTool } from './capabilities/executor.js'
import { buildToolLoopStopNudge, buildUncertaintyCheckpointNudge } from './llm.js'

const checks = []
function assert(cond, label, detail = '') {
  checks.push({ ok: !!cond, label })
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : (detail ? `\n  ${detail}` : '')}`)
}
function has(text, sub) { return String(text || '').includes(sub) }

// ── set_task ────────────────────────────────────────────────────────────────
{
  let captured = null
  const ctx = { source: 'test', onSetTask: (desc, steps) => { captured = { desc, steps } } }

  const r = await executeTool('set_task', {
    description: '整理 sandbox',
    steps: ['列出目录', '按类型分类', '写清单'],
  }, ctx)
  assert(has(r, '任务已开启'), 'set_task: 含「任务已开启」', r)
  assert(has(r, '计划已记录'), 'set_task: 含「计划已记录」引导', r)
  assert(has(r, '第 1 步「列出目录」'), 'set_task: 引导进入第 1 步（首步文案）', r)
  assert(captured && captured.steps.length === 3, 'set_task: onSetTask 收到 3 个清洗后步骤', JSON.stringify(captured))
}

{
  const ctx = { source: 'test', onSetTask: () => {} }
  const r = await executeTool('set_task', { description: '空步骤', steps: [] }, ctx)
  assert(has(r, '错误') && has(r, 'steps'), 'set_task: 空数组步骤 → 报错', r)
}

{
  // 全空白步骤：steps.length>0 但 filter(Boolean) 后为空 —— 测我新加的守卫，避免「第 1 步「undefined」」
  let called = false
  const ctx = { source: 'test', onSetTask: () => { called = true } }
  const r = await executeTool('set_task', { description: '全空白', steps: ['', '   '] }, ctx)
  assert(has(r, '不能全为空'), 'set_task: 全空白步骤 → 守卫报错（不渲染 undefined）', r)
  assert(!has(r, 'undefined'), 'set_task: 报错串不含 "undefined"', r)
  assert(called === false, 'set_task: 守卫拦截后未调用 onSetTask', String(called))
}

// ── update_task_step ──────────────────────────────────────────────────────────
// mock：每个用例直接返回该场景的受控形状，隔离 executor 的分支逻辑。
function ctxReturning(shape) {
  return { source: 'test', onUpdateTaskStep: () => shape }
}

{
  const r = await executeTool('update_task_step', { step_index: 0, status: 'done', note: '共 12 个文件' },
    ctxReturning({ progress: '1/3', allTerminal: false, nextIndex: 1, nextStep: '按类型分类', anyFailed: false }))
  assert(has(r, '完成 ✓'), 'update(done): 状态标签', r)
  assert(has(r, '共 12 个文件'), 'update(done): note 透传', r)
  assert(has(r, '进度：1/3'), 'update(done): 含进度', r)
  assert(has(r, '继续下一步') && has(r, '按类型分类'), 'update(done): 引导进入下一步', r)
}

{
  const r = await executeTool('update_task_step', { step_index: 1, status: 'failed', note: '' },
    ctxReturning({ progress: '1/3', allTerminal: false, nextIndex: 2, nextStep: '写清单', anyFailed: true }))
  assert(has(r, '失败 ✗'), 'update(failed): 状态标签', r)
  assert(has(r, '不要重试同样的做法'), 'update(failed): 引导换法', r)
  assert(has(r, '下一步是「写清单」'), 'update(failed): 同时给出下一步', r)
}

{
  const r = await executeTool('update_task_step', { step_index: 2, status: 'failed', note: '缺 API key' },
    ctxReturning({ progress: '2/3', allTerminal: false, nextIndex: null, nextStep: null, anyFailed: true }))
  assert(has(r, '不要重试同样的做法'), 'update(failed,无下一步): 引导换法', r)
  assert(!has(r, '下一步是'), 'update(failed,无下一步): 不硬塞下一步', r)
}

{
  const r = await executeTool('update_task_step', { step_index: 2, status: 'done', note: '' },
    ctxReturning({ progress: '3/3', allTerminal: true, nextIndex: null, nextStep: null, anyFailed: false }))
  assert(has(r, '所有步骤完成'), 'update(全完成): 收尾文案', r)
  assert(has(r, '确认每步证据'), 'update(全完成): 收尾前验证引导', r)
}

{
  const r = await executeTool('update_task_step', { step_index: 2, status: 'done', note: '' },
    ctxReturning({ progress: '2/3', allTerminal: true, nextIndex: null, nextStep: null, anyFailed: true }))
  assert(has(r, '失败/跳过'), 'update(全终态但有失败): 提示缺口', r)
  assert(has(r, '不要谎称全部完成'), 'update(全终态但有失败): 禁止谎报', r)
}

{
  const r = await executeTool('update_task_step', { step_index: 9, status: 'done', note: '' },
    { source: 'test', onUpdateTaskStep: () => ({ error: 'Step 10 does not exist (3 total)' }) })
  assert(has(r, '错误') && has(r, 'does not exist'), 'update(越界): 透传错误', r)
}

// ── 层 3：不确定回退 nudge ────────────────────────────────────────────────────
{
  const n = buildToolLoopStopNudge('stuck in a loop', { name: 'fetch_url', args: { url: 'x' }, result: 'timeout' })
  assert(has(n, 'step back'), 'stopNudge: 升级为"退一步"语义（非单纯停手）', n)
  assert(has(n, 'materially different approach'), 'stopNudge: 引导换实质不同的路径', n)
  assert(has(n, 'read-only tool'), 'stopNudge: 引导只读工具验证假设', n)
  assert(has(n, 'current_task'), 'stopNudge: 引导重审 current_task 计划', n)
  assert(has(n, 'stuck in a loop'), 'stopNudge: 带上具体 reason', n)
}
{
  const n = buildUncertaintyCheckpointNudge(18)
  assert(has(n, '18 tool calls'), 'checkpoint: 报出已执行步数', n)
  assert(has(n, 'converging'), 'checkpoint: 引导自问是否在收敛', n)
  assert(has(n, 're-plan') || has(n, 're-read'), 'checkpoint: 引导重审/重规划', n)
  assert(has(n, 'one-time'), 'checkpoint: 声明一次性、不向用户复述', n)
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.ok)
console.log(`\nComplex-task tests: ${checks.length - failed.length}/${checks.length} passed`)
if (!failed.length) console.log('All complex-task tests passed.')
// 显式退出：用 `electron ./src/test-complex-task.js`（app 模式）跑时，仅设 process.exitCode
// 不会让 electron 主进程自动 quit（事件循环不空），会挂住。显式 exit 让 app 模式也干净收尾。
process.exit(failed.length ? 1 : 0)
