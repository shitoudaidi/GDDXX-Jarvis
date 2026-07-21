const fs = require('fs')
const path = require('path')
const source = fs.readFileSync(path.resolve(__dirname, '../src/ui/jarvis-react/src/main.jsx'), 'utf8')
const checks = {
  draftHasStableKey: /DRAFT_STORAGE_KEY = "gddxx-jarvis-draft"/.test(source),
  draftRestores: /localStorage\.getItem\(DRAFT_STORAGE_KEY\)/.test(source),
  draftPersists: /localStorage\.setItem\(DRAFT_STORAGE_KEY, draft\)/.test(source),
  emptyDraftClears: /localStorage\.removeItem\(DRAFT_STORAGE_KEY\)/.test(source),
  safeGetRetries: /retryable[\s\S]*window\.setTimeout\(resolve, 240\)/.test(source),
  apiFailureUpdatesState: /detail: "核心连接中断"/.test(source),
  timeoutIsActionable: /核心服务响应超时，请稍后重试/.test(source),
  browserOnlineResyncs: /addEventListener\("online", handleOnline\)/.test(source) && /connectEvents\(\)/.test(source),
  browserOfflineVisible: /detail: "设备当前离线"/.test(source),
  foregroundResyncs: /visibilitychange/.test(source) && /visibilityState === "visible"/.test(source),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
