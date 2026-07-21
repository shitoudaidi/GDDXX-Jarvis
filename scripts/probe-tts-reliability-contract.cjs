const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const providers = fs.readFileSync(path.join(root, 'src/core/voice/tts-providers.js'), 'utf8')
const media = fs.readFileSync(path.join(root, 'src/core/capabilities/tools/media.js'), 'utf8')
const api = fs.readFileSync(path.join(root, 'src/core/api.js'), 'utf8')

const checks = {
  cloudTimeout: /CLOUD_TTS_TIMEOUT_MS = 30_000/.test(providers) && /controller\.abort\(\)/.test(providers),
  emptyBodyGuard: /returned an empty response body/.test(providers),
  emptyAudioGuard: /returned empty audio data/.test(providers),
  systemTimeout: /System TTS timed out/.test(providers),
  systemChildCleanup: /activeJarvisTtsChildren\.add\(child\)/.test(providers),
  textLimit: /MAX_TTS_CHARS = 800/.test(providers) && /exceeds.*characters/.test(providers),
  validBaseUrl: /valid HTTP or HTTPS URL/.test(providers),
  providerMime: (providers.match(/stream\.contentType = 'audio\/mpeg'/g) || []).length >= 2,
  providerAwareChinese: /englishOnly = false/.test(media) && /creds\.provider === 'jarvis'/.test(api) && (media.match(/creds\.provider === 'jarvis'/g) || []).length >= 2,
  allCloudFetchesGuarded: (providers.match(/await fetchTTS\(/g) || []).length === 5,
}

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
