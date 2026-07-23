const fs = require('node:fs')
const path = require('node:path')
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const checks = {
  conversationGutter: /\.app-shell\.mode-active \.terminal-lines\s*\{\s*padding-inline:\s*16px/.test(css),
  readableMessageBody: /\.app-shell\.mode-active \.terminal-line p\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.62/s.test(css),
  readableMessageMeta: /\.app-shell\.mode-active \.terminal-line > \.terminal-line-head > span,[\s\S]*font-size:\s*10px/.test(css),
  strongerSecondaryContrast: /\.app-shell\.mode-active \.message-channel,[\s\S]*color:\s*#82969e/.test(css),
  boundedEmptyState: /\.app-shell\.mode-active \.terminal-empty\s*\{[^}]*width:\s*min\(210px,[^}]*border:/s.test(css),
  composerBoundary: /\.app-shell\.mode-active \.command-dock\.text-open \.dock-input\s*\{[^}]*border:\s*1px solid/s.test(css),
  composerFocus: /\.app-shell\.mode-active \.command-dock\.text-open \.dock-input:focus-within\s*\{[^}]*box-shadow:/s.test(css),
  secondaryControlTone: /\.app-shell\.mode-active \.command-dock \.keyboard-command,[\s\S]*background:\s*rgba\(7, 15, 19, 0\.68\)/.test(css),
  primaryVoiceEmphasis: /\.app-shell\.mode-active \.command-dock \.voice-command\s*\{[^}]*border-width:\s*2px/s.test(css),
  readableNewsRows: /\.app-shell\.mode-active \.news-ticker-item p\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5/s.test(css)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
