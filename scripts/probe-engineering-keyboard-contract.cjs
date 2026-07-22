const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8');
const checks = {
  openFocusesPrompt: /if \(!isRunning\) window\.requestAnimationFrame\(\(\) => promptRef\.current\?\.focus\(\)\)/.test(ui),
  escapeClosesWorkbench: /if \(event\.key === "Escape"\) onClose\(\)/.test(ui),
  modifierEnterRunsTask: /event\.key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/.test(ui),
  newTaskReturnsFocus: /setPrompt\(""\); setError\(""\); window\.requestAnimationFrame\(\(\) => promptRef/.test(ui),
  historyReturnsFocus: /setPrompt\(item\.prompt\); setView\("conversation"\); window\.requestAnimationFrame/.test(ui),
  tabsSupportArrowKeys: /\['ArrowLeft', 'ArrowRight'\]\.includes\(event\.key\)/.test(ui),
  tabsUseRovingFocus: /tabIndex=\{view === key \? 0 : -1\}/.test(ui),
  manualReadingIsPreserved: /!followEngineeringOutput\) return/.test(ui) && /setFollowEngineeringOutput\(element\.scrollHeight/.test(ui),
  latestOutputActionExists: /className="engineering-jump-latest"/.test(ui) && /\.engineering-jump-latest/.test(css),
  liveStatesAreSemantic: /aria-busy=\{isRunning\}/.test(ui) && /engineering-form-error" role="alert"/.test(ui),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
if (failed.length) process.exit(1);
