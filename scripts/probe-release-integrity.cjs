const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release.yml'), 'utf8')
const notes = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8')
const checks = {
  packageVersionIsCurrent: pkg.version === '0.3.0',
  lockRootMatches: lock.version === pkg.version,
  lockPackageMatches: lock.packages?.['']?.version === pkg.version,
  productIdentityStable: pkg.productName === 'GDDXX-Jarvis' && pkg.build?.appId === 'com.gddxx.jarvis',
  installerIncludesVersion: /Setup-\$\{version\}/.test(pkg.build?.artifactName || ''),
  preloadExposesVersion: /getVersion/.test(preload),
  uiDisplaysVersion: /GDDXX-Jarvis\{appVersion \? ` v\$\{appVersion\}`/.test(ui),
  tagMustMatchPackage: /Tag \$tagVersion does not match package version \$packageVersion/.test(workflow),
  releasePublishesChecksum: /\.exe\.sha256/.test(workflow),
  releaseNotesMatch: notes.includes(`GDDXX-Jarvis ${pkg.version}`) && /body_path: RELEASE_NOTES\.md/.test(workflow),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
console.log(JSON.stringify({ ok: failed.length === 0, version: pkg.version, checks, failed }, null, 2))
if (failed.length) process.exit(1)
