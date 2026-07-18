const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'ui', 'jarvis-react', 'src', 'main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src', 'ui', 'jarvis-react', 'src', 'styles.css'), 'utf8')
const backend = fs.readFileSync(path.join(root, 'src', 'core', 'ai-news.js'), 'utf8')
const checks = [
  { name: 'AI Hot component exists', ok: /function NewsTicker\(/.test(main) },
  { name: 'AI Hot uses its dedicated real news endpoint', ok: /\/ai-news/.test(main) && !/\/hotspots\?viewed=true/.test(main) },
  { name: 'AI Hot reports offline instead of fake data', ok: /资讯源暂无数据|OFFLINE/.test(main) },
  { name: 'AI Hot supports pause and refresh', ok: /暂停滚动资讯/.test(main) && /刷新资讯/.test(main) },
  { name: 'AI Hot items open exact source URLs', ok: /safeExternalUrl\(row\.url\)/.test(main) && /href=\{item\.url/.test(main) },
  { name: 'AI Hot backend rejects records without original URLs', ok: /!title \|\| !isHttpUrl\(url\)/.test(backend) && !/platformSearchUrl/.test(backend) },
  { name: 'AI Hot backend uses the public AI HOT API', ok: /aihot\.virxact\.com\/api\/public\/items/.test(backend) },
  { name: 'AI Hot has a responsive instrument rail', ok: /\.news-ticker\s*\{/.test(css) && /\.news-ticker\s*\{/.test(css.slice(css.indexOf('@media'))) },
]
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks }, null, 2))
if (checks.some((item) => !item.ok)) process.exit(1)
