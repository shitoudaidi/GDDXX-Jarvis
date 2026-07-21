const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const major = Number(process.versions.node.split('.')[0])
const checks = [
  ['Windows host', process.platform === 'win32', `detected ${process.platform}`],
  ['64-bit process', process.arch === 'x64', `detected ${process.arch}`],
  ['supported Node.js', major === 20 || major === 22 || major === 24, `detected ${process.version}; use 22 LTS when possible`],
  ['package lock present', fs.existsSync(path.join(root, 'package-lock.json')), path.join(root, 'package-lock.json')],
  ['package manifest readable', fs.existsSync(path.join(root, 'package.json')), path.join(root, 'package.json')],
]

try {
  const probe = path.join(root, `.jarvis-write-probe-${process.pid}`)
  fs.writeFileSync(probe, 'ok')
  fs.rmSync(probe, { force: true })
  checks.push(['project directory writable', true, root])
} catch (error) {
  checks.push(['project directory writable', false, error.message])
}

try {
  const freeBytes = fs.statfsSync(root).bavail * fs.statfsSync(root).bsize
  checks.push(['at least 5 GB free', freeBytes >= 5 * 1024 ** 3, `${(freeBytes / 1024 ** 3).toFixed(1)} GB free`])
} catch (error) {
  checks.push(['disk space readable', false, error.message])
}

checks.push(
  ['path length is installation-safe', root.length < 180, `${root.length} characters`],
  ['temporary directory available', fs.existsSync(os.tmpdir()), os.tmpdir()],
  ['PowerShell available', Boolean(process.env.SystemRoot && fs.existsSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))), 'required for voice installers'],
)

for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} - ${detail}`)
if (checks.some(([, ok]) => !ok)) process.exit(1)
