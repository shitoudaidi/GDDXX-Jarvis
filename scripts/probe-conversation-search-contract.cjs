const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8')
const checks = {
  searchIsOptional: /searchOpen/.test(ui) && /toggleHistorySearch/.test(ui),
  queryIsNormalized: /historyQuery\.trim\(\)\.toLocaleLowerCase\(\)/.test(ui),
  contentIsSearched: /cleanText\(message\.content\)/.test(ui),
  channelIsSearched: /message\.channel \|\|/.test(ui),
  searchCoversAllLoaded: /normalizedQuery \|\| showAll \? matchingMessages/.test(ui),
  resultCountAnnounced: /role="status" aria-live="polite"/.test(ui),
  clearIsAvailable: /清空历史搜索/.test(ui),
  escapeCloses: /event\.key === "Escape"\) toggleHistorySearch/.test(ui),
  emptyResultExplained: /没有匹配的对话/.test(ui),
  layoutIsStable: /\.history-search input[\s\S]*min-width: 0;[\s\S]*flex: 1/.test(css),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
