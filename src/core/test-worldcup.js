// 世界杯模块纯算法测试：直播吧 HTML 解析 + 小组积分榜计算。
// fixture 抓取于 2026-06-11 直播吧首页（含世界杯/NBA/电竞等混合条目，测过滤）。
//
// Run: node src/test-worldcup.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseWorldcupMatches, computeStandings, parseWorldcupNews, applyScoreRows, parseMatchEvents } from './worldcup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'zhibo8-home-sample.html'), 'utf-8')

// fixture 抓取当天（开幕日，所有场次未开赛）的视角时间
const FIXTURE_NOW = new Date(2026, 5, 11, 20, 0).getTime()

// ====== 1) 解析与过滤 ======
{
  const matches = parseWorldcupMatches(html, FIXTURE_NOW)
  assert(matches.length === 4, `1) fixture 解析出 4 场世界杯（实际 ${matches.length}）`)
  assert(matches.every(m => m.matchId && m.home && m.away && m.time), '1) 每场都有 matchId/双方/时间')
  assert(matches.every(m => !/男篮|电竞/.test(m.league)), '1) 过滤掉男篮世界杯/电竞条目')

  const opener = matches[0]
  assert(opener.home === '墨西哥' && opener.away === '南非', `1) 揭幕战 墨西哥 vs 南非（实际 ${opener.home} vs ${opener.away}）`)
  assert(opener.time === '2026-06-12 03:00', `1) 揭幕战时间 2026-06-12 03:00（实际 ${opener.time}）`)
  assert(opener.stage.group === 'A' && opener.stage.round === 1, `1) 揭幕战 A组第1轮（实际 ${JSON.stringify(opener.stage)}）`)
  assert(opener.status === 'scheduled' && opener.score === null, '1) 未开赛：status=scheduled，score=null')
  assert(opener.homeLogo.includes('duoduocdn'), '1) 解析出队徽地址')
  assert(opener.detailUrl.includes('zhibo8.com/zhibo/zuqiu'), `1) 详情页链接（实际 ${opener.detailUrl}）`)
}

// ====== 2) 状态判定：进行中 / 已结束 ======
{
  // 视角拨到揭幕战开球后 30 分钟：无比分也应判 live
  const during = parseWorldcupMatches(html, new Date(2026, 5, 12, 3, 30).getTime())
  assert(during[0].status === 'live', `2) 开球后30分钟 → live（实际 ${during[0].status}）`)

  // 带比分的条目（拼一个赛后形态的 li，模拟 NBA 式 _score 结构）
  const finishedLi = `<ul><li label="世界杯,墨西哥,足球,南非,世界杯小组赛A组第1轮" id="saishi1867414" data-time="2026-06-12 03:00" data-rightishome="0" data-type="football"><time>03:00</time><b><span class="_league">世界杯小组赛A组第1轮</span><span class="_teams"> 墨西哥 <img src="https://duihui.duoduocdn.com/zuqiu/zq_moxige_313403.png"/><span class="_score"><span class="c-s">2 - 1</span></span><img src="https://duihui.duoduocdn.com/zuqiu/zq_nanfei_851083.png"/> 南非</span></b><a href="/zhibo/zuqiu/2026/match1867414v.htm" target="_blank">咪咕 CCTV5</a></li></ul>`
  const after = parseWorldcupMatches(finishedLi, new Date(2026, 5, 12, 8, 0).getTime())
  assert(after.length === 1 && after[0].score?.home === 2 && after[0].score?.away === 1, `2) 赛后比分 2-1（实际 ${JSON.stringify(after[0]?.score)}）`)
  assert(after[0].status === 'finished', `2) 开球5小时后有比分 → finished（实际 ${after[0].status}）`)

  // NBA 式"大比分1-2"不能被误读成足球比分
  const seriesLi = `<li label="世界杯,甲,足球,乙,世界杯小组赛B组第1轮" id="saishi9" data-time="2026-06-12 03:00" data-type="football"><b><span class="_league">世界杯小组赛B组第1轮</span><span class="_teams"> 甲 <img src="a.png"/><span class="_score"><span class="c-s"> - </span><span class="s-m-l">大比分1-2</span></span><img src="b.png"/> 乙</span></b></li>`
  const series = parseWorldcupMatches(seriesLi, FIXTURE_NOW)
  assert(series.length === 1 && series[0].score === null, `2) "大比分1-2"不被误读为比分（实际 ${JSON.stringify(series[0]?.score)}）`)
}

// ====== 3) 小组积分榜 ======
{
  const make = (id, group, home, away, hs, as) => ({
    matchId: id,
    stage: { group, round: 1, knockout: null },
    home, away,
    homeLogo: '', awayLogo: '',
    score: { home: hs, away: as },
    status: 'finished',
    startMs: FIXTURE_NOW,
  })
  const standings = computeStandings([
    make('1', 'A', '墨西哥', '南非', 2, 0),
    make('2', 'A', '韩国', '捷克', 1, 1),
    make('3', 'A', '墨西哥', '韩国', 0, 3),
    make('4', 'B', '加拿大', '波黑', 1, 0),
    { ...make('5', 'B', '甲', '乙', 9, 9), status: 'live' },        // 进行中不计入
    { ...make('6', null, '丙', '丁', 1, 0), stage: { group: null } }, // 淘汰赛不计入
  ])

  assert(Object.keys(standings).join(',') === 'A,B', `3) 只有 A、B 两组（实际 ${Object.keys(standings).join(',')}）`)
  const groupA = standings.A
  assert(groupA[0].team === '韩国' && groupA[0].pts === 4, `3) A组第一 韩国 4分（实际 ${groupA[0]?.team} ${groupA[0]?.pts}分）`)
  assert(groupA[1].team === '墨西哥' && groupA[1].pts === 3, `3) A组第二 墨西哥 3分 — 同分时净胜球优先（实际 ${groupA[1]?.team} ${groupA[1]?.pts}分 gd=${groupA[1]?.gd}）`)
  assert(groupA[1].gd === -1 && groupA[2].team === '捷克', `3) 墨西哥净胜球-1 高于捷克的平局1分`)
  assert(standings.B.length === 2 && standings.B[0].team === '加拿大', '3) B组只计入已结束场次')
}

// ====== 4) 空输入与改版容错 ======
{
  assert(parseWorldcupMatches('').length === 0, '4) 空 HTML → 空数组不抛错')
  assert(parseWorldcupMatches('<html><body>改版了</body></html>').length === 0, '4) 无条目页面 → 空数组')
  const noTeams = `<li label="足球,世界杯" id="saishi7" data-time="2026-06-12 03:00" data-type="football"><b><span class="_league">世界杯</span><span class="_teams"><img src="x.png"></span></b></li>`
  assert(parseWorldcupMatches(noTeams).length === 0, '4) 无队名条目（如赛事合集）被跳过')

  // 开幕式条目带 data-type=football 和两个"队名"形态，曾被误解析成比赛（2026-06-11 真实数据）
  const ceremony = `<li label="足球,世界杯" id="saishi2059824" data-time="2026-06-12 01:30" data-type="football"><b><span class="_league">2026美加墨世界杯开幕式</span><span class="_teams"> 美加墨世界杯 <img src="a.png"/><span> - </span><img src="b.png"/> 开幕式</span></b></li>`
  assert(parseWorldcupMatches(ceremony).length === 0, '4) 开幕式等非比赛节目条目被排除')
}

// ====== 5) 新闻解析 ======
{
  const newsHtml = `
    <a href="/6a2a0cd07d0c1native.htm" class="list-item" target="_blank">世界杯开幕式看点：美加墨三国各办一场！夏奇拉明日空降墨西哥</a>
    <a href="//news.zhibo8.com/zuqiu/abc.htm" target="_blank">泪目！C罗：美加墨世界杯将是我最后一届，可能两年后退役</a>
    <a href="/other.htm">和足球无关的新闻标题不该被收录哦</a>
    <a href="/lanqiu.htm">男篮世界杯预选赛中国队大胜</a>
    <a href="/6a2a0cd07d0c1native.htm">世界杯开幕式看点：美加墨三国各办一场！夏奇拉明日空降墨西哥</a>`
  const news = parseWorldcupNews(newsHtml)
  assert(news.length === 2, `5) 收录 2 条世界杯新闻（实际 ${news.length}：过滤无关/男篮/重复）`)
  assert(news[0].url === 'https://www.zhibo8.cc/6a2a0cd07d0c1native.htm', `5) 相对链接补全域名（实际 ${news[0]?.url}）`)
  assert(news[1].url.startsWith('https://news.zhibo8.com'), `5) 协议相对链接补 https（实际 ${news[1]?.url}）`)
  assert(parseWorldcupNews('').length === 0, '5) 空输入不抛错')
}

// ====== 6) qiumibao 比分合并 ======
// 行样例取自 2026-06-12 揭幕战实测（bifen4pc.qiumibao.com/json/v2/list.htm 同构）
{
  const makeMatch = (id, status = 'scheduled') => ({
    matchId: id, home: '墨西哥', away: '南非', score: null, status,
    startMs: FIXTURE_NOW, time: '2026-06-12 03:00',
  })

  // 进行中：state=2，比分+进球人都合并，left/right 对应 home/away
  const live = makeMatch('1867414', 'live')
  const liveChanged = applyScoreRows([live], [{
    id: '1867414', state: '2',
    left: { score: '1', player_data: [{ value: "9'", player_name: '基尼奥内斯', code: '1', type: 1 }] },
    right: { score: '0', player_data: [] },
  }])
  assert(liveChanged === true, '6) live 行合并返回 changed=true')
  assert(live.score?.home === 1 && live.score?.away === 0, `6) live 比分 1-0（实际 ${JSON.stringify(live.score)}）`)
  assert(live.scorersHome?.[0]?.min === 9 && live.scorersHome[0].name === '基尼奥内斯', `6) 进球人 9' 基尼奥内斯（实际 ${JSON.stringify(live.scorersHome)}）`)
  assert(live.scorersAway === undefined, '6) 无进球一侧不写 scorersAway')

  // 未赛：state=1 的 "0"/"0" 是占位，不能当真实 0-0
  const sched = makeMatch('1869142')
  applyScoreRows([sched], [{ id: '1869142', state: '1', left: { score: '0' }, right: { score: '0' } }])
  assert(sched.score === null && sched.status === 'scheduled', `6) 未赛占位 0-0 不采纳（实际 ${JSON.stringify(sched.score)} ${sched.status}）`)

  // 完赛：state=3 定 finished（替代 150 分钟启发式）
  const done = makeMatch('1867414', 'live')
  applyScoreRows([done], [{ id: '1867414', state: '3', left: { score: '2' }, right: { score: '1' } }])
  assert(done.status === 'finished' && done.score?.home === 2 && done.score?.away === 1, `6) 完赛 2-1 finished（实际 ${done.status} ${JSON.stringify(done.score)}）`)

  // 延期/待定（state=4/7）不动现有状态；比分为空串不覆盖
  const post = makeMatch('1867415', 'scheduled')
  const postChanged = applyScoreRows([post], [{ id: '1867415', state: '4', left: { score: '' }, right: { score: '' } }])
  assert(postChanged === false && post.status === 'scheduled' && post.score === null, '6) 延期行不改状态不写比分')

  // id 对不上不动；空输入不抛错
  const stray = makeMatch('999')
  assert(applyScoreRows([stray], [{ id: '888', state: '3', left: { score: '5' }, right: { score: '5' } }]) === false, '6) id 不匹配无变化')
  assert(applyScoreRows([], []) === false && applyScoreRows([stray], []) === false, '6) 空输入安全')

  // 进行中但比分为空串（个别项目接口不给分）：状态更新、比分不写
  const noScore = makeMatch('777', 'scheduled')
  applyScoreRows([noScore], [{ id: '777', state: '2', left: { score: '' }, right: { score: '' } }])
  assert(noScore.status === 'live' && noScore.score === null, `6) 空比分只更状态（实际 ${noScore.status} ${JSON.stringify(noScore.score)}）`)
}

// ====== 7) 事件流解析（行结构取自 2026-06-12 揭幕战 match_event 实测） ======
{
  const rows = [
    { time: '9', sl_team_id: '253', player_name_cn: '里拉', event_code_cn: '助攻', Info: '里拉助攻', is_hide: 1 },
    { time: '9', sl_team_id: '253', player_name_cn: '基尼奥内斯', event_code_cn: '进球', Info: '基尼奥内斯进球',
      sub: { player_name_cn: '里拉', event_code_cn: '助攻' } },
    { time: '23', sl_team_id: '3361', player_name_cn: '古铁雷斯', event_code_cn: '黄牌', Info: '古铁雷斯黄牌' },
    { time: '45', sl_team_id: '', player_name_cn: '', event_code_cn: '伤停补时 4分钟', Info: '伤停补时 4分钟' },
  ]
  const events = parseMatchEvents(rows, { homeTeamId: '253', awayTeamId: '3361' })
  assert(events.length === 3, `7) is_hide 的从属行被过滤（实际 ${events.length} 条）`)
  const goal = events.find(e => e.type === '进球')
  assert(goal?.min === 9 && goal.name === '基尼奥内斯' && goal.side === 'home', `7) 进球：9' 基尼奥内斯 home（实际 ${JSON.stringify(goal)}）`)
  assert(goal?.assist === '里拉', `7) 进球带助攻 里拉（实际 ${goal?.assist}）`)
  const card = events.find(e => e.type === '黄牌')
  assert(card?.side === 'away', `7) 黄牌按 sl_team_id 归到客队（实际 ${card?.side}）`)
  const stoppage = events.find(e => /伤停补时/.test(e.type))
  assert(stoppage?.min === 45 && stoppage.side === null, '7) 伤停补时无队属，min=45')
  assert(events[0].min <= events[1].min && events[1].min <= events[2].min, '7) 按分钟升序')
  assert(parseMatchEvents(null).length === 0 && parseMatchEvents([], {}).length === 0, '7) 空输入安全')
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
