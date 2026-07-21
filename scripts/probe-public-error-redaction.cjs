const fs = require('fs')
const path = require('path')
const source = fs.readFileSync(path.resolve(__dirname, '../src/core/api.js'), 'utf8')
const checks = {
  bearerTokensRedacted: /Bearer\\s\+/.test(source) && /Bearer \[redacted\]/.test(source),
  skKeysRedacted: /sk-\[redacted\]/.test(source),
  queryCredentialsRedacted: /api\[_-\]\?key/.test(source) && /access\[_-\]\?token/.test(source),
  authorizationHeadersRedacted: /Authorization\|X-Api-Key\|X-Api-Access-Key/.test(source),
  jsonApiKeysRedacted: /apiKey\|api_key\|accessKey/.test(source),
  jsonTokensRedacted: /access_token\|token\|secret\|password/.test(source),
  urlCredentialsRedacted: /\[redacted\]@/.test(source),
  controlCharactersRemoved: /\\u0000-\\u0008/.test(source),
  providerErrorsBounded: /slice\(0, 1000\)/.test(source),
  allJsonErrorsSanitized: /JSON\.stringify\(sanitizePublicErrors\(body\)\)/.test(source),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
