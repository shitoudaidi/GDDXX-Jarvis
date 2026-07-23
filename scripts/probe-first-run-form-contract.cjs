const fs = require('node:fs')
const path = require('node:path')
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'main.jsx'), 'utf8')
const checks = {
  formDescriptionIsLinked: /className="first-run-form" onSubmit=\{submit\} aria-busy=\{saving\} aria-describedby="first-run-description"/.test(ui),
  providerHasName: /<select name="provider"/.test(ui),
  modelHasName: /<input ref=\{modelRef\} name="model"/.test(ui),
  modelAvoidsAutofill: /name="model" autoComplete="off"/.test(ui),
  modelRequiredIsExplicit: /name="model"[\s\S]{0,260}aria-required="true"/.test(ui),
  apiKeyHasName: /<input ref=\{apiKeyRef\} name="apiKey"/.test(ui),
  apiKeyRequiredIsExplicit: /name="apiKey"[\s\S]{0,260}aria-required="true"/.test(ui),
  baseUrlHasUrlHints: /name="baseURL" type="url" inputMode="url" autoComplete="url"/.test(ui),
  voiceLegendIsNamed: /<legend id="voice-provider-legend">/.test(ui),
  voiceOptionsReferenceLegend: (ui.match(/aria-describedby="voice-provider-legend"/g) || []).length === 2
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
