const fs = require('node:fs')
const path = require('node:path')
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'main.jsx'), 'utf8')
const checks = {
  escapeDoesNotInterruptSave: /event\.key === "Escape" && !saving && !aiHotSaving/.test(ui),
  backdropDoesNotInterruptSave: /event\.target === event\.currentTarget && !saving && !aiHotSaving/.test(ui),
  closeButtonLocksDuringSave: /closeButtonRef[^\n]*disabled=\{saving \|\| aiHotSaving\}/.test(ui),
  modelFormIsNamed: /className="drawer-section" onSubmit=\{\(event\) => \{ event\.preventDefault\(\); saveModel\(\); \}\} aria-label="模型配置" aria-busy=\{saving\}/.test(ui),
  providerHasName: /<select name="provider" value=\{provider\}/.test(ui),
  modelHasName: /<select name="model" value=\{model\}/.test(ui),
  baseUrlHasUrlHints: /name="baseURL" type="url" inputMode="url" autoComplete="url"/.test(ui),
  aiHotRegionIsNamed: /className="drawer-section" role="region" aria-label="AI HOT 配置"/.test(ui),
  aiHotEndpointHasName: /name="aiHotEndpoint" type="url" inputMode="url" autoComplete="url"/.test(ui),
  aiHotKeyHasName: /name="aiHotApiKey"/.test(ui)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
