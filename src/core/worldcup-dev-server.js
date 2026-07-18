// 世界杯数据 dev 服务器：给独立预览页（worldcup-broadcast-v2.html 等）取真数据用，
// 不依赖主应用——主应用未运行或还没升级到带 /worldcup 的版本时跑这个即可。
//
// 用法：node src/worldcup-dev-server.js   （端口 3722，只读，Ctrl+C 退出）

import http from 'http'
import { getWorldcup } from './worldcup.js'

const PORT = 3722

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!req.url.startsWith('/worldcup')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"ok":false,"error":"not found"}')
    return
  }
  try {
    const force = /[?&]refresh=(1|true)/.test(req.url)
    const data = await getWorldcup({ force })
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: err.message }))
  }
}).listen(PORT, () => {
  console.log(`[worldcup-dev-server] http://localhost:${PORT}/worldcup`)
})
