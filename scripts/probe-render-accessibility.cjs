const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const vortex = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/visuals/JarvisParticleVortex.jsx'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8')

const checks = [
  ['particle count adapts to CPU and memory', /hardwareConcurrency[\s\S]{0,250}deviceMemory[\s\S]{0,300}42000/],
  ['low-power devices use a lower pixel ratio', /lowPower[\s\S]{0,180}1\.15/],
  ['reduced motion lowers the particle budget', /reducedMotion \? 32000/],
  ['reduced motion renders a static frame', /if \(!reducedMotion\) frameRef\.current/],
  ['hidden documents pause WebGL', /document\.hidden \|\| !visible/],
  ['offscreen canvas pauses through IntersectionObserver', /new IntersectionObserver/],
  ['WebGL context loss has a visual fallback', /webglcontextlost/.test(vortex) && /webgl-unavailable/.test(vortex)],
  ['conversation history exposes busy state', /aria-busy=\{sending\}/],
  ['text input references the live turn status', /aria-describedby="[^"]*\bturn-status\b[^"]*"/],
  ['command dock has a landmark label', /aria-label="Jarvis 指令输入"/],
  ['coarse pointers receive 40px targets', /@media \(pointer: coarse\)[\s\S]{0,220}min-height: 40px/],
  ['forced-colors focus remains visible', /@media \(forced-colors: active\)[\s\S]{0,240}outline: 3px solid Highlight/],
]

const sources = `${vortex}\n${ui}\n${css}`
const results = checks.map(([name, pattern]) => ({ name, ok: typeof pattern === 'boolean' ? pattern : pattern.test(sources) }))
console.log(JSON.stringify({ ok: results.every(item => item.ok), checks: results }, null, 2))
if (results.some(item => !item.ok)) process.exit(1)
