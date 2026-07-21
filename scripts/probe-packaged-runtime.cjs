const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const app = path.join(root, 'dist', 'win-unpacked')
const resources = path.join(app, 'resources')
const unpacked = path.join(resources, 'app.asar.unpacked')
const exists = (...parts) => fs.existsSync(path.join(...parts))
const size = (...parts) => { try { return fs.statSync(path.join(...parts)).size } catch { return 0 } }
const checks = {
  brandedExecutable: size(app, 'GDDXX-Jarvis.exe') > 50 * 1024 * 1024,
  applicationArchive: size(resources, 'app.asar') > 10 * 1024 * 1024,
  embeddedPython: exists(unpacked, '.python', 'python.exe'),
  whisperModel: size(unpacked, 'models', 'whisper', 'tiny.pt') > 70 * 1024 * 1024,
  jarvisVoiceModel: size(unpacked, 'models', 'jarvis', 'en', 'en_GB', 'jarvis', 'high', 'jarvis-high.onnx') > 100 * 1024 * 1024,
  jarvisVoiceMetadata: exists(unpacked, 'models', 'jarvis', 'en', 'en_GB', 'jarvis', 'high', 'jarvis-high.onnx.json'),
  localAsrServer: exists(unpacked, 'src', 'core', 'voice', 'whisper_server.py'),
  localTtsServer: exists(unpacked, 'src', 'core', 'voice', 'jarvis_tts.py'),
  electronNativeSqlite: size(unpacked, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node') > 1024 * 1024,
  privateConfigExcluded: !exists(unpacked, 'config.json') && !exists(resources, 'config.json') && !exists(app, 'config.json'),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, packagedRoot: app, checks, failed }, null, 2))
if (failed.length) process.exit(1)
