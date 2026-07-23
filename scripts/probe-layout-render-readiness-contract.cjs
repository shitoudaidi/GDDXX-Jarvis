const fs = require('node:fs')
const path = require('node:path')
const electron = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const checks = {
  waitsForActiveStage: /stageActive: Boolean\(stage\?\.classList\.contains\("mode-active"\)\)/.test(electron),
  requiresNewsNode: /newsPresent: Boolean\(news\)/.test(electron),
  requiresNewsDisplay: /newsDisplayed: Boolean\(style && style\.display !== "none"\)/.test(electron),
  requiresNewsVisibility: /newsVisible: Boolean\(style && style\.visibility !== "hidden"\)/.test(electron),
  requiresNewsOpacity: /Number\(style\.opacity\) >= 0\.95/.test(electron),
  requiresSharpNews: /newsSharp: Boolean\(style/.test(electron),
  requiresSettledTransform: /newsSettled: Boolean\(style/.test(electron),
  requiresFinishedLoad: /newsLoaded: news\?\.getAttribute\("aria-busy"\) !== "true"/.test(electron),
  requiresVisibleContent: /newsHasContent: Boolean\(news\?\.querySelector/.test(electron),
  gatesViewportResult: /ok: Boolean\(snapshot\.ok && renderReady\.ok\)/.test(electron)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
