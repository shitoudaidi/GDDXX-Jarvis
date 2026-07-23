const fs = require('node:fs')
const path = require('node:path')
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const checks = {
  compactHeaderTracks: /@media \(max-width: 1100px\)[\s\S]*grid-template-columns:\s*205px minmax\(285px, 1fr\) auto/.test(css),
  compactBrandGap: /@media \(max-width: 1100px\)[\s\S]*\.header-brand \{ gap:\s*10px/.test(css),
  compactBrandScale: /@media \(max-width: 1100px\)[\s\S]*\.brand-title h1 \{ font-size:\s*21px/.test(css),
  compactClockInset: /@media \(max-width: 1100px\)[\s\S]*\.header-clock \{ padding-left:\s*10px/.test(css),
  compactDateHidden: /@media \(max-width: 1100px\)[\s\S]*\.header-clock span \{ display:\s*none/.test(css),
  compactStatusesCentered: /@media \(max-width: 1100px\)[\s\S]*\.status-pill \{ justify-content:\s*center/.test(css),
  compactTurnOwnerBounded: /\.turn-owner \{ max-width:\s*76px; overflow:\s*hidden/.test(css),
  capabilityDoesNotCollapse: /\.capability-status \{ flex:\s*0 0 auto/.test(css),
  shallowRailRowsCondense: /@media \(max-width: 1100px\) and \(max-height: 720px\)[\s\S]*\.signal-tile \{ min-height:\s*40px/.test(css),
  shallowPortraitScales: /@media \(max-width: 1100px\) and \(max-height: 720px\)[\s\S]*\.entity-vortex \{ transform:\s*scale\(0\.72\)/.test(css)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
