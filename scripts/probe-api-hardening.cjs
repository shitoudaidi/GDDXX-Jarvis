const http = require('node:http')
const WebSocket = require('ws')

const port = Number(process.env.JARVIS_PORT || 3721)
const host = '127.0.0.1'

function request({ method = 'GET', path = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path, headers, timeout: 5000 }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)))
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

function expectRejectedWebSocket(origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/voice/cloud`, { origin })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('forbidden WebSocket origin was not rejected'))
    }, 5000)
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      resolve(res.statusCode)
    })
    ws.on('open', () => {
      clearTimeout(timer)
      ws.terminate()
      reject(new Error('forbidden WebSocket origin opened successfully'))
    })
    ws.on('error', () => {})
  })
}

function expectInvalidConfigClose(origin = 'null') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/voice/cloud`, { origin })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('invalid ASR config frame did not close the socket'))
    }, 5000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'not-config' })))
    ws.on('close', code => {
      clearTimeout(timer)
      resolve(code)
    })
    ws.on('error', reject)
  })
}

function add(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
}

(async () => {
  const checks = []

  const status = await request({ path: '/status' })
  add(checks, 'API remains reachable', status.status === 200, `status=${status.status}`)
  add(checks, 'JSON security headers are present',
    status.headers['x-content-type-options'] === 'nosniff'
      && status.headers['referrer-policy'] === 'no-referrer'
      && status.headers['x-frame-options'] === 'DENY'
      && status.headers['cache-control'] === 'no-store',
    JSON.stringify(status.headers))

  const options = await request({
    method: 'OPTIONS',
    path: '/settings/tts',
    headers: { Origin: 'null' },
  })
  const allowedMethods = String(options.headers['access-control-allow-methods'] || '')
  add(checks, 'CORS advertises every supported mutation method',
    options.status === 204 && allowedMethods.includes('PATCH') && allowedMethods.includes('DELETE'),
    `status=${options.status} methods=${allowedMethods}`)

  const foreignOrigin = await request({
    method: 'POST',
    path: '/settings/thinking',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  })
  add(checks, 'foreign browser origins are denied', foreignOrigin.status === 403, `status=${foreignOrigin.status}`)

  const tooLarge = await request({
    method: 'POST',
    path: '/settings/thinking',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(512 * 1024 + 1) },
  })
  add(checks, 'oversized declared request bodies are rejected', tooLarge.status === 413, `status=${tooLarge.status}`)

  const wrongType = await request({
    method: 'POST',
    path: '/message',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: ['not', 'text'] }),
  })
  add(checks, 'non-string message content is rejected', wrongType.status === 400, `status=${wrongType.status}`)

  const longMessage = await request({
    method: 'POST',
    path: '/message',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x'.repeat(12_001) }),
  })
  add(checks, 'oversized message text is rejected', longMessage.status === 413, `status=${longMessage.status}`)

  const ttsCors = await request({
    method: 'POST',
    path: '/tts/stream',
    headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: '{}',
  })
  add(checks, 'TTS does not widen CORS to a wildcard',
    ttsCors.status === 400 && ttsCors.headers['access-control-allow-origin'] === 'null',
    `status=${ttsCors.status} origin=${ttsCors.headers['access-control-allow-origin'] || ''}`)

  let rateLimited = false
  let rateStatus = 0
  for (let i = 0; i < 35; i += 1) {
    const response = await request({
      method: 'POST',
      path: '/tts/stream',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    rateStatus = response.status
    if (response.status === 429) {
      rateLimited = response.headers['retry-after'] === '60'
      break
    }
  }
  add(checks, 'TTS request storms are rate limited', rateLimited, `lastStatus=${rateStatus}`)

  const rejectedSocketStatus = await expectRejectedWebSocket('https://evil.example')
  add(checks, 'ASR WebSocket rejects foreign origins', rejectedSocketStatus === 403, `status=${rejectedSocketStatus}`)

  const invalidConfigCloseCode = await expectInvalidConfigClose()
  add(checks, 'ASR WebSocket closes invalid first frames', invalidConfigCloseCode === 1008, `code=${invalidConfigCloseCode}`)

  const fileOriginCloseCode = await expectInvalidConfigClose('file://')
  add(checks, 'Electron file origin can reach the ASR WebSocket', fileOriginCloseCode === 1008, `code=${fileOriginCloseCode}`)

  const finalStatus = await request({ path: '/status' })
  add(checks, 'API remains healthy after rejected traffic', finalStatus.status === 200, `status=${finalStatus.status}`)

  const result = { ok: checks.every(check => check.ok), checks }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
})().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
  process.exit(1)
})
