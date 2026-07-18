// temporal-parser 单元测试
// 运行：node src/test-temporal-parser.js
//
// 纯函数路径：不连 db，不连 llm，不需要 --env-file。
// 用注入式 now 喂固定时钟，避免测试随时间漂移。

import { parseTemporalHints, stripTemporalWords, __test__ } from './memory/temporal-parser.js'

const { isoLocal, startOfDay } = __test__

let passed = 0
let failed = 0
const fail = (label, expected, actual) => {
  failed++
  console.log(`✗ ${label}`)
  console.log(`  expected: ${JSON.stringify(expected)}`)
  console.log(`  actual:   ${JSON.stringify(actual)}`)
}
const pass = (label) => {
  passed++
  console.log(`✓ ${label}`)
}
const assertEq = (label, expected, actual) => {
  if (JSON.stringify(expected) === JSON.stringify(actual)) pass(label)
  else fail(label, expected, actual)
}

// 用 2026-05-20 12:34:56 作为固定参考时钟
const fixedNow = new Date(2026, 4, 20, 12, 34, 56) // 月份 0-indexed: 4 = May
const FROM_TODAY    = isoLocal(startOfDay(fixedNow))
const FROM_YESTERDAY = (() => { const d = startOfDay(fixedNow); d.setDate(d.getDate() - 1); return isoLocal(d) })()
const TO_TODAY      = (() => { const d = startOfDay(fixedNow); d.setDate(d.getDate() + 1); return isoLocal(d) })()
const TO_YESTERDAY  = FROM_TODAY
const FROM_BEFORE_YESTERDAY = (() => { const d = startOfDay(fixedNow); d.setDate(d.getDate() - 2); return isoLocal(d) })()
const TO_BEFORE_YESTERDAY   = FROM_YESTERDAY
const FROM_3DAYS_AGO        = (() => { const d = startOfDay(fixedNow); d.setDate(d.getDate() - 3); return isoLocal(d) })()
const TO_3DAYS_AGO          = FROM_BEFORE_YESTERDAY

// ── case 1: 空输入返回空数组 ─────────────────────────────
assertEq('empty input', [], parseTemporalHints('', fixedNow))
assertEq('null input', [], parseTemporalHints(null, fixedNow))
assertEq('undefined input', [], parseTemporalHints(undefined, fixedNow))

// ── case 2: 不含时间词，返回空 ─────────────────────────────
assertEq('no temporal word', [], parseTemporalHints('帮我查个天气', fixedNow))
assertEq('only future word (not supported)', [], parseTemporalHints('明天再说吧', fixedNow))
assertEq('vague word not supported', [], parseTemporalHints('最近怎么样', fixedNow))

// ── case 3: 单个时间词 ─────────────────────────────────
{
  const r = parseTemporalHints('昨天我们聊了什么', fixedNow)
  assertEq('昨天 命中数', 1, r.length)
  assertEq('昨天 label', '昨天', r[0].label)
  assertEq('昨天 from', FROM_YESTERDAY, r[0].from)
  assertEq('昨天 to', TO_YESTERDAY, r[0].to)
  assertEq('昨天 offsetDays', -1, r[0].offsetDays)
}

{
  const r = parseTemporalHints('今天那个 bug 修完了吗', fixedNow)
  assertEq('今天 命中数', 1, r.length)
  assertEq('今天 label', '今天', r[0].label)
  assertEq('今天 from', FROM_TODAY, r[0].from)
  assertEq('今天 to', TO_TODAY, r[0].to)
}

{
  const r = parseTemporalHints('前天的会议讲了啥', fixedNow)
  assertEq('前天 命中数', 1, r.length)
  assertEq('前天 from', FROM_BEFORE_YESTERDAY, r[0].from)
  assertEq('前天 to', TO_BEFORE_YESTERDAY, r[0].to)
}

// ── case 4: 大前天 vs 前天 不打架 ──────────────────────────
{
  const r = parseTemporalHints('大前天的事', fixedNow)
  assertEq('大前天 命中数（不该把"前天"也算上）', 1, r.length)
  assertEq('大前天 label', '大前天', r[0].label)
  assertEq('大前天 from', FROM_3DAYS_AGO, r[0].from)
  assertEq('大前天 to', TO_3DAYS_AGO, r[0].to)
}

// ── case 4b: 前天 + 大前天 同时出现，应识别为两个命中 ─────────
{
  const r = parseTemporalHints('前天和大前天的事一起说说', fixedNow)
  assertEq('前天+大前天 命中数', 2, r.length)
  // offsetDays desc 排：前天 (-2) 在前，大前天 (-3) 在后
  assertEq('前天+大前天 第1个 label', '前天', r[0]?.label)
  assertEq('前天+大前天 第2个 label', '大前天', r[1]?.label)
}

// ── case 5: 同义词归一 ───────────────────────────────
{
  const r = parseTemporalHints('昨晚我有点累', fixedNow)
  assertEq('昨晚 → 昨天 label', '昨天', r[0]?.label)
  assertEq('昨晚 → 昨天 from', FROM_YESTERDAY, r[0]?.from)
}
{
  const r = parseTemporalHints('今早跑步去了', fixedNow)
  assertEq('今早 → 今天 label', '今天', r[0]?.label)
}

// ── case 6: 多个时间词，按 offsetDays desc 排（近的在前）─────
{
  const r = parseTemporalHints('昨天和前天的事一起说说', fixedNow)
  assertEq('多词 命中数', 2, r.length)
  assertEq('多词 第1个是昨天', '昨天', r[0].label)
  assertEq('多词 第2个是前天', '前天', r[1].label)
}

// ── case 7: 同一标签出现多次，只算一次 ───────────────────
{
  const r = parseTemporalHints('昨天的事，昨天还说', fixedNow)
  assertEq('重复词去重', 1, r.length)
  assertEq('重复词去重 label', '昨天', r[0].label)
}

// ── case 8: 边界 —— 当下是凌晨 00:01 ──────────────────
{
  const earlyMorning = new Date(2026, 4, 20, 0, 1, 0)
  const r = parseTemporalHints('昨天那件事', earlyMorning)
  // 凌晨 00:01 时"昨天"应该是 5/19 整天
  assertEq('凌晨 昨天 from 是 5/19 00:00',
    isoLocal(new Date(2026, 4, 19, 0, 0, 0)),
    r[0].from)
}

// ── case 9: isoLocal 格式校验 ────────────────────────
{
  const probe = new Date(2026, 4, 20, 0, 0, 0)
  const s = isoLocal(probe)
  if (/^2026-05-20T00:00:00[+-]\d{2}:\d{2}$/.test(s)) pass('isoLocal 格式')
  else fail('isoLocal 格式', '形如 2026-05-20T00:00:00+08:00', s)
}

// ── formatTemporalRecall 渲染层（同文件测试，避免再开一个测试文件）─────
// formatTemporalRecall 来自 injector.js，不动 db / llm，可以直接 import 测。
{
  const { formatTemporalRecall } = await import('./memory/injector.js')

  assertEq('format null → 空', '', formatTemporalRecall(null))
  assertEq('format []→ 空', '', formatTemporalRecall([]))

  const sample = [
    {
      label: '昨天',
      date: '2026-05-19',
      memories: [
        {
          id: 1,
          timestamp: '2026-05-19T22:10:00+08:00',
          title: '专注结论：DynamicMemoryPool 设计',
          content: '定下"一切皆记忆"的方向，写入设计文档',
          salience: 5,
        },
        {
          id: 2,
          timestamp: '2026-05-19T09:30:00+08:00',
          title: '专注结论：focus-compress 调试',
          content: '发现 timestamp 用了 frame.startedAt 是对的',
          salience: 3,
        },
      ],
    },
  ]
  const rendered = formatTemporalRecall(sample)
  const checks = [
    ['含 date 属性', /date="2026-05-19"/],
    ['含 label 属性', /label="昨天"/],
    ['含开头时间戳 22:10', /22:10/],
    ['含开头时间戳 09:30', /09:30/],
    ['高 salience 带 ★', /★/],
    ['标题去掉"专注结论："前缀', /\[DynamicMemoryPool 设计\]/],
    ['含具体 content', /一切皆记忆/],
    ['有 <temporal-recall> 开头', /^<temporal-recall/],
    ['有 </temporal-recall> 结尾', /<\/temporal-recall>$/],
  ]
  for (const [name, re] of checks) {
    if (re.test(rendered)) pass(`render '${name}'`)
    else fail(`render '${name}'`, re.toString(), rendered)
  }
}

// ── case 10: stripTemporalWords ──────────────────────
{
  const containsAny = (s, words) => words.some(w => s.includes(w))
  const TIME_WORDS = ['昨天', '今天', '前天', '大前天', '昨晚', '今早']

  const cases = [
    '昨天我们聊了什么',
    '前天那个 bug 后来修好了吗',
    '今天的天气',
    '昨晚我有点累',
    '大前天的事',
    '昨天和前天的事一起说说',
  ]
  for (const text of cases) {
    const stripped = stripTemporalWords(text)
    if (containsAny(stripped, TIME_WORDS)) {
      fail(`strip '${text}'`, '不含时间词', stripped)
    } else {
      pass(`strip '${text}'`)
    }
  }

  // 不含时间词的句子不改动
  assertEq('strip 非时间词原样', '帮我查一下天气', stripTemporalWords('帮我查一下天气'))
  // 边界：空 / null
  assertEq('strip 空', '', stripTemporalWords(''))
  assertEq('strip null', '', stripTemporalWords(null))
}

console.log()
console.log(`通过: ${passed} / 失败: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
