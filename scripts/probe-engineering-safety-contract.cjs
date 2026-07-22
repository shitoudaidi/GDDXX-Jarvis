const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8');
const checks = {
  historyShapeIsValidated: /Array\.isArray\(stored\) \? stored\.slice\(0, 12\)/.test(ui),
  historyPromptsAreBounded: /prompt: String\(item\?\.prompt \|\| ""\)\.slice\(0, 240\)/.test(ui),
  taskPromptHasHardLimit: /maxLength=\{4000\}/.test(ui),
  taskPromptHasCounter: /engineering-prompt-count/.test(ui) && /prompt\.length\}\/4000/.test(ui),
  quickActionsLockSubmission: /if \(isRunning \|\| submitting \|\| !status\?\.available\) return/.test(ui),
  submissionErrorsAreBounded: /setError\(boundedFeedback\(submitError\.message/.test(ui) && /boundedFeedback\(runError\.message/.test(ui),
  cancellationIsSingleFlight: /if \(cancelling\) return/.test(ui) && /disabled=\{cancelling\}/.test(ui),
  permissionIsSingleFlight: /if \(answeringPermission\) return/.test(ui) && /disabled=\{answeringPermission\}/.test(ui),
  viewsUseTabSemantics: /role="tablist"/.test(ui) && /role="tab" aria-selected=/.test(ui),
  hugeOutputIsBounded: /outputText\.length > 50_000/.test(ui) && /仅显示最近 50,000 个字符/.test(ui) && /\.engineering-truncated/.test(css),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
if (failed.length) process.exit(1);
