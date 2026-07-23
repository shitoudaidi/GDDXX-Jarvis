const fs = require('node:fs')
const path = require('node:path')

const file = path.join(__dirname, '..', 'src', 'ui', 'jarvis-react', 'src', 'main.jsx')
const ui = fs.readFileSync(file, 'utf8')
const checks = {
  localMessagesHaveFactory: /function localSystemMessage\(/.test(ui),
  localMessagesHaveTimestamp: /timestamp: new Date\(\)\.toISOString\(\)/.test(ui),
  localMessageIdsHaveEntropy: /Math\.random\(\)\.toString\(16\)/.test(ui),
  cancelErrorsAreBounded: /setLastError\(boundedFeedback\(`界面已停止/.test(ui),
  pollFailuresAreAnnounced: /pollFailureRef\.current >= 3/.test(ui),
  pollFailureCounterResets: /pollFailureRef\.current = 0/.test(ui),
  engineeringErrorsAreBounded: /setLastError\(boundedFeedback\(error\.message, "工程任务提交失败"\)\)/.test(ui),
  sendErrorsUseFactory: /localSystemMessage\(boundedFeedback\(error\.message, "发送失败"\), "SYSTEM"\)/.test(ui),
  ttsErrorsAreBounded: /setLastError\(boundedFeedback\(error\?\.message, "贾维斯语音播放失败/.test(ui),
  connectionErrorsAreBounded: /const feedback = boundedFeedback\(error\.message, "核心服务未响应"\)/.test(ui)
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
console.log(JSON.stringify({ ok: failed.length === 0, count: Object.keys(checks).length, checks, failed }, null, 2))
if (failed.length) process.exit(1)
