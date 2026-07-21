const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8')
const checks = {
  compositionTracked: /onCompositionStart/.test(ui) && /onCompositionEnd/.test(ui),
  nativeCompositionGuarded: /nativeEvent\.isComposing/.test(ui),
  enterRespectsShift: /!event\.shiftKey/.test(ui),
  inputHasHardLimit: /maxLength=\{MAX_DRAFT_CHARS\}/.test(ui),
  limitIsBounded: /MAX_DRAFT_CHARS = 4_000/.test(ui),
  warningBeforeLimit: /DRAFT_WARNING_CHARS = 3_600/.test(ui),
  countIsAnnounced: /id="composer-count"[\s\S]*aria-live="polite"/.test(ui),
  keyboardHintLinked: /composer-hint composer-count/.test(ui),
  restoredDraftExpands: /if \(!textInputOpen\) setTextInputOpen\(true\)/.test(ui) && /field\.scrollHeight/.test(ui),
  limitHasVisualState: /textarea\[aria-invalid="true"\]/.test(css) && /composer-count\.visible/.test(css),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
