const childProcess = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const target = process.argv[2]
if (!target) throw new Error('probe target script is required')

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function ready(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/status', timeout: 800 }, res => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

;(async () => {
  const port = await reservePort()
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-probe-server-'))
  const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const server = childProcess.spawn(electronPath, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_PORT: String(port),
      JARVIS_SERVER_PROBE: '1',
      JARVIS_DISABLE_SOCIAL: '1',
      JARVIS_SKIP_STARTUP_SELF_CHECK: '1',
      JARVIS_USER_DIR: userDir,
      JARVIS_RESOURCES_DIR: root,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  })
  try {
    const started = Date.now()
    while (Date.now() - started < 30_000 && !await ready(port)) {
      if (server.exitCode !== null) throw new Error(`temporary probe server exited with ${server.exitCode}`)
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (!await ready(port)) throw new Error('temporary probe server did not become ready')
    const result = childProcess.spawnSync(process.execPath, [path.resolve(root, target)], {
      cwd: root,
      env: { ...process.env, JARVIS_PORT: String(port) },
      stdio: 'inherit',
      windowsHide: true,
    })
    process.exitCode = result.status ?? 1
  } finally {
    try { server.kill() } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
  }
})().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
  process.exitCode = 1
})
