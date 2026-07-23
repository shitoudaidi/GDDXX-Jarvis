const fs = require('node:fs')
const path = require('node:path')
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const checks = {
  drawerUsesNaturalFlow: /\.drawer\s*\{[^}]*display:\s*flex/s.test(css),
  drawerFlowsVertically: /\.drawer\s*\{[^}]*flex-direction:\s*column/s.test(css),
  drawerPreventsHorizontalOverflow: /\.drawer\s*\{[^}]*overflow-x:\s*hidden/s.test(css),
  drawerScrollsVertically: /\.drawer\s*\{[^}]*overflow-y:\s*auto/s.test(css),
  drawerContainsOverscroll: /\.drawer\s*\{[^}]*overscroll-behavior:\s*contain/s.test(css),
  drawerHasScrollPadding: /\.drawer\s*\{[^}]*scroll-padding-block:\s*76px 20px/s.test(css),
  drawerHasCompactRadius: /\.drawer\s*\{[^}]*border-radius:\s*6px/s.test(css),
  drawerHeaderSticks: /\.drawer-head\s*\{[^}]*position:\s*sticky;[^}]*z-index:\s*3/s.test(css),
  sectionsCannotCollapse: /\.drawer-section\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*max-content/s.test(css),
  settingsControlsUseCompactRadius: /\.drawer \.field input,[\s\S]*border-radius:\s*4px/.test(css)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
