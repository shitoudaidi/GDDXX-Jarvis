const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const api = fs.readFileSync(path.join(root, 'src/core/api.js'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8')
const checks = {
  plaintextKeyNotReturned: !/apiKey:\s*config\.apiKey/.test(api),
  configuredStatusReturned: /apiKeyConfigured:\s*Boolean\(config\.apiKey\)/.test(api),
  revealIsExplicit: /showApiKey \? "text" : "password"/.test(ui),
  revealIsAccessible: /隐藏 API Key/.test(ui) && /显示 API Key/.test(ui),
  passwordManagersAvoided: (ui.match(/autoComplete="new-password"/g) || []).length >= 2,
  spellcheckDisabled: (ui.match(/spellCheck="false"/g) || []).length >= 2,
  secretsClearedOnClose: /setApiKey\(""\);[\s\S]*setAiHotApiKey\(""\);[\s\S]*setShowApiKey\(false\)/.test(ui),
  baseUrlValidated: /Base URL 必须是有效的 HTTP 或 HTTPS 地址/.test(ui),
  saveIsBounded: /signal: AbortSignal\.timeout\(API_TIMEOUT_MS\)/.test(ui),
  stableSecretLayout: /grid-template-columns: minmax\(0, 1fr\) 40px/.test(css),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
