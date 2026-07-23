const fs = require('node:fs')
const path = require('node:path')
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const checks = {
  genericPressFeedback: /button:not\(:disabled\):active/.test(css),
  disabledCursor: /button:disabled\s*\{\s*cursor: not-allowed;/.test(css),
  primaryPressState: /\.primary:not\(:disabled\):active/.test(css),
  secondaryPressState: /\.secondary:not\(:disabled\):active/.test(css),
  newsPressState: /\.news-icon:not\(:disabled\):active/.test(css),
  voiceFocusState: /\.voice-option:focus-within/.test(css),
  standbyFocusState: /\.standby-entry:focus-visible/.test(css),
  messageActionPressState: /\.message-actions button:not\(:disabled\):active/.test(css),
  dockPressState: /\.command-dock button:not\(:disabled\):active/.test(css),
  invalidFieldsState: /input:invalid:not\(:placeholder-shown\), select:invalid/.test(css)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
