const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'ui', 'jarvis-react', 'src', 'main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const checks = [
  { name: 'natural file and code tasks infer engineering mode', ok: /function inferredEngineeringPrompt\(/.test(main) && /hasWorkspaceTarget/.test(main) },
  { name: 'inferred tasks call the Grok Build task bridge', ok: /const workPrompt = inferredEngineeringPrompt\(content\)/.test(main) && /await startEngineeringTask\(workPrompt\)/.test(main) },
  { name: 'engineering console has a Codex-like task sidebar', ok: /engineering-sidebar/.test(main) && /engineering-quick-actions/.test(main) },
  { name: 'engineering mode takes over the active workspace', ok: /engineering-open \.hud-terminal/.test(css) && /\.app-shell\.mode-active \.engineering-console/.test(css) },
]
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks }, null, 2))
if (checks.some((item) => !item.ok)) process.exit(1)
