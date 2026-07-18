const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const childProcess = require('node:child_process')
const { listPackage } = require('@electron/asar')

const root = path.resolve(__dirname, '..')
let port = Number(process.env.JARVIS_PORT || 0)
let coreProcess = null
let userDir = null

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port
      server.close(error => error ? reject(error) : resolve(selected))
    })
  })
}

async function startTemporaryCore() {
  if (!port) port = await reservePort()
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-single-product-'))
  const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  coreProcess = childProcess.spawn(electronPath, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_PORT: String(port),
      JARVIS_SERVER_PROBE: '1',
      JARVIS_USER_DIR: userDir,
      JARVIS_RESOURCES_DIR: root,
      JARVIS_DISABLE_SOCIAL: '1',
      JARVIS_SKIP_STARTUP_SELF_CHECK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const output = []
  coreProcess.stdout.on('data', chunk => output.push(chunk.toString('utf8')))
  coreProcess.stderr.on('data', chunk => output.push(chunk.toString('utf8')))
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    try {
      const status = await request('/status')
      if (status.status === 200) return
    } catch {}
    if (coreProcess.exitCode !== null) throw new Error(`temporary core exited early: ${output.join('').slice(-2000)}`)
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`temporary core did not start on port ${port}`)
}

async function stopTemporaryCore() {
  try { coreProcess?.kill() } catch {}
  if (coreProcess && coreProcess.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1500)
      coreProcess.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  try { if (userDir) fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
}

function request(route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route, timeout: 5000 }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('timeout', () => req.destroy(new Error(`${route} timed out`)))
    req.on('error', reject)
  })
}

function add(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
}

(async () => {
  await startTemporaryCore()
  const checks = []
  const home = await request('/')
  const html = home.body.toString('utf8')
  add(checks, 'HTTP root serves the current Jarvis workbench',
    home.status === 200 && html.includes('Jarvis Mission Control') && html.includes('id="root"'),
    `status=${home.status}`)
  add(checks, 'HTTP root contains no legacy product name',
    !/白龙马|bailongma|balongma|brain-ui/i.test(html))

  for (const route of ['/activation', '/activation.html', '/brain-ui', '/brain-ui.html', '/site', '/site.html', '/brain.html', '/dashboard.html']) {
    const response = await request(route)
    add(checks, `legacy route ${route} redirects to Jarvis`,
      response.status === 302 && response.headers.location === '/',
      `status=${response.status} location=${response.headers.location || ''}`)
  }

  const wakeAudio = await request('/audio/wake-greeting.wav')
  add(checks, 'current workbench audio assets are served',
    wakeAudio.status === 200
      && wakeAudio.headers['content-type'] === 'audio/wav'
      && wakeAudio.body.length > 4096,
    `status=${wakeAudio.status} type=${wakeAudio.headers['content-type'] || ''} bytes=${wakeAudio.body.length}`)

  const retiredAsset = await request('/src/ui/brain-ui/app.js')
  add(checks, 'legacy brain UI assets are not served', retiredAsset.status === 404, `status=${retiredAsset.status}`)

  const asarPath = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
  if (fs.existsSync(asarPath)) {
    const entries = listPackage(asarPath).map(entry => entry.replace(/\\/g, '/'))
    const forbidden = [
      '/src/core/ui/brain-ui/',
      '/src/ui/jarvis-react/',
      '/src/voice/',
      '/activation.html',
      '/brain-ui.html',
      '/website.html',
      '/server.js',
      '/README.md',
      '/PRODUCT.md',
      '/concepts/',
    ]
    const leaks = forbidden.filter(prefix => entries.some(entry => entry === prefix.slice(0, -1) || entry.startsWith(prefix)))
    add(checks, 'packaged app contains one frontend only', leaks.length === 0, leaks.join(', '))
    add(checks, 'packaged app contains the built Jarvis frontend',
      entries.includes('/src/ui/jarvis/index.html')
        && entries.some(entry => entry.startsWith('/src/ui/jarvis/assets/'))
        && entries.includes('/src/ui/jarvis/audio/wake-greeting.wav'))
  } else {
    add(checks, 'packaged app contains one frontend only', false, 'app.asar missing')
    add(checks, 'packaged app contains the built Jarvis frontend', false, 'app.asar missing')
  }

  const result = { ok: checks.every(check => check.ok), checks }
  await stopTemporaryCore()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
})().catch(error => {
  stopTemporaryCore().finally(() => {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
    process.exit(1)
  })
})
