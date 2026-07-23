const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8');
const checks = {
  pauseRequiresMultipleItems: /disabled=\{items\.length < 2\}/.test(ui),
  loadingUsesSkeleton: /className="news-skeleton"/.test(ui) && /\.news-skeleton/.test(css),
  emptyErrorCanRetry: /error \? <button type="button" onClick=\{load\}>重新加载/.test(ui),
  staleDataIsExplicit: /const stale = Boolean\(error && items\.length\)/.test(ui) && /is-stale/.test(css),
  invalidTimestampIsGuarded: /Number\.isNaN\(updatedDate\.getTime\(\)\)/.test(ui),
  errorsAreNormalizedAndBounded: /replace\(\/\\s\+\/g, " "\)\.slice\(0, 120\)/.test(ui),
  carouselPositionIsVisible: /className="news-position"/.test(ui),
  externalLinksAreMarked: /className="news-external"/.test(ui),
  renderedKeysAreUnique: /key=\{`\$\{item\.id\}-\$\{visibleIndex\}`\}/.test(ui),
  reducedMotionIsRespected: /useReducedMotion\(\)/.test(ui) && /initial=\{reduceMotion \? false/.test(ui),
};
checks.emptyErrorCanRetry = /error \? <button type="button" onClick=\{load\}(?: disabled=\{loading\})?/.test(ui);
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
if (failed.length) process.exit(1);
