const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8');
const checks = {
  entityReadsMotionPreference: /function AgentPortrait[\s\S]{0,300}useReducedMotion\(\)/.test(ui),
  reducedFrameIsStatic: /animate=\{reduceMotion \? \{ y: 0, scale: 1, rotateZ: 0 \}/.test(ui),
  reducedVideoHasNoBlurTransition: /filter: "none"/.test(ui) && /duration: reduceMotion \? 0 : 0\.42/.test(ui),
  reducedVideoIsPaused: /if \(document\.hidden \|\| reduceMotion\) element\.pause\(\)/.test(ui),
  hiddenWindowPausesVideo: /document\.addEventListener\("visibilitychange", syncPlayback\)/.test(ui),
  visibleWindowResumesVideo: /else element\.play\?\.\(\)\.catch/.test(ui),
  videoPreloadIsBounded: /preload="metadata"/.test(ui),
  pictureInPictureIsDisabled: /disablePictureInPicture/.test(ui),
  failedVideoLeavesDom: /!videoFailed \? <motion\.video/.test(ui),
  fallbackStateIsStyled: /videoFailed && "video-fallback"/.test(ui) && /\.entity-frame\.video-fallback/.test(css),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
if (failed.length) process.exit(1);
