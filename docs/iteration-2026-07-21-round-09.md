# Jarvis Iteration 09 - Windows Deployment

Time: 2026-07-21 19:49-20:00 (Asia/Shanghai)

## Ten problems found and fixed

1. **Performance:** Source launches always forced SwiftShader and disabled GPU acceleration. Hardware acceleration is now the default.
2. **Compatibility:** There was no explicit graphics fallback. `JARVIS_FORCE_SOFTWARE_RENDERING=1` now enables the slower compatibility renderer when a driver fails.
3. **Setup:** Double-click launch failed cryptically when Node.js was absent. `Jarvis.cmd` now diagnoses Node and points to Node 22 LTS.
4. **Setup:** Missing npm or Electron dependencies surfaced as command errors. The launcher now names the missing prerequisite and the exact installer to run.
5. **Setup:** Source deployment required manually following several README commands. `Install-From-Source.cmd` now provides a four-step guided installation.
6. **Reproducibility:** Source setup could use an unlocked install. The guided path uses `npm ci` and then validates Electron/native modules.
7. **Compatibility:** OS, architecture, and Node version were not checked before a long install. The source preflight rejects unsupported environments early.
8. **Compatibility:** Write permission, free space, long path, temporary directory, and PowerShell failures appeared late. They are now checked before dependency installation.
9. **Release integrity:** CI could upload a missing or suspiciously small installer. The release workflow now rejects installers below 1 MB.
10. **Release trust:** Downloads had no checksum. CI now creates, uploads, and publishes an adjacent SHA-256 file.

## Verification

- Current Windows source preflight passed all ten environment checks.
- Added `scripts/probe-windows-deployment.cjs` with ten deployment contract assertions and included it in `npm run check`.
- `npm run check` passed.
- README now documents the guided source installer, hardware default, software fallback, and checksum verification.

