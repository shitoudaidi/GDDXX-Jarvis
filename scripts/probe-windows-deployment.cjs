const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const start = read('scripts/start-electron.cjs')
const launcher = read('Jarvis.cmd')
const installer = read('Install-From-Source.cmd')
const preflight = read('scripts/check-windows-source.cjs')
const workflow = read('.github/workflows/windows-release.yml')

const checks = [
  ['desktop start defaults to hardware acceleration', /forceSoftware[\s\S]{0,250}\? \["--disable-gpu"[\s\S]{0,150}: \["\."\]/.test(start)],
  ['software rendering remains an explicit fallback', /JARVIS_FORCE_SOFTWARE_RENDERING/.test(start)],
  ['launcher diagnoses missing Node.js', /where node\.exe[\s\S]{0,180}Node\.js was not found/.test(launcher)],
  ['launcher diagnoses missing dependencies', /node_modules\\electron\\dist\\electron\.exe[\s\S]{0,200}Install-From-Source\.cmd/.test(launcher)],
  ['source installer uses reproducible npm ci', /npm\.cmd ci/.test(installer)],
  ['source installer verifies native Electron modules', /doctor:install/.test(installer)],
  ['preflight checks OS architecture and Node version', /Windows host[\s\S]{0,250}64-bit process[\s\S]{0,250}supported Node\.js/.test(preflight)],
  ['preflight checks write access disk path temp and PowerShell', ['project directory writable', 'at least 5 GB free', 'path length is installation-safe', 'temporary directory available', 'PowerShell available'].every(value => preflight.includes(value))],
  ['release rejects missing or tiny installers', /Installer is missing or unexpectedly small/.test(workflow)],
  ['release publishes a SHA-256 checksum', /Get-FileHash[\s\S]{0,120}SHA256[\s\S]{0,800}\.exe\.sha256/.test(workflow)],
]

const results = checks.map(([name, ok]) => ({ name, ok }))
console.log(JSON.stringify({ ok: results.every(item => item.ok), checks: results }, null, 2))
if (results.some(item => !item.ok)) process.exit(1)
