const fs = require('node:fs')
const path = require('node:path')
const electron = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const checks = {
  forcesLayoutBeforeCapture: /document\.body\.offsetHeight/.test(electron),
  invalidatesRenderSurface: /mainWindow\.webContents\.invalidate\(\)/.test(electron),
  waitsTwoFramesBeforeCapture: /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/.test(electron),
  waitsPostInvalidation: /invalidate\(\);[\s\S]*setTimeout\(resolve, 120\)/.test(electron),
  confirmsDialogStillMounted: /drawer\[role="dialog"\]/.test(electron),
  capturesAfterConfirmation: /return Boolean\(document\.querySelector\('\.drawer\[role="dialog"\]'\)\)[\s\S]*const settingsImage/.test(electron),
  capturesExpectedWidth: /settingsImage\.getSize\(\)\.width === settingsExpectedWidth/.test(electron),
  capturesExpectedHeight: /settingsImage\.getSize\(\)\.height === settingsExpectedHeight/.test(electron),
  ExposesPixelValidity: /settingsPixelsValid/.test(electron),
  gatesSettingsSuccessOnPixels: /settingsCloseResult\.focusRestored && settingsPixelsValid/.test(electron)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
