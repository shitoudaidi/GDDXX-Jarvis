const fs = require('node:fs')
const path = require('node:path')
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'main.jsx'), 'utf8')
const checks = {
  messageReadsMotionPreference: /function MessageLine[\s\S]*?const reduceMotion = useReducedMotion\(\)/.test(ui),
  messageInitialIsStaticWhenReduced: /initial=\{reduceMotion \? false : \{ opacity: 0, y: 8 \}\}/.test(ui),
  messageTransitionIsZeroWhenReduced: /duration: reduceMotion \? 0 : 0\.18/.test(ui),
  acuiReadsMotionPreference: /function AcuiResultCard[\s\S]*?const reduceMotion = useReducedMotion\(\)/.test(ui),
  acuiLayoutDisablesWhenReduced: /layout=\{!reduceMotion\}/.test(ui),
  acuiInitialIsStaticWhenReduced: /initial=\{reduceMotion \? false : \{ opacity: 0, x: 24, scale: 0\.97 \}\}/.test(ui),
  acuiExitIsRemovedWhenReduced: /exit=\{reduceMotion \? undefined : \{ opacity: 0, x: 24, scale: 0\.97 \}\}/.test(ui),
  acuiTransitionIsZeroWhenReduced: /duration: reduceMotion \? 0 : 0\.24/.test(ui),
  reducedMotionRuleExists: /prefers-reduced-motion/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')),
  visualProbeStillUsesStableInitial: /initial=\{false\}/.test(ui)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
