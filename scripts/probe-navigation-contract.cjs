const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/ui/jarvis-react/src/styles.css'), 'utf8');
const checks = {
  workEntriesUseNavigationLandmark: /<nav className="module-strip" aria-label="工作入口">/.test(ui),
  refreshUsesToolbarLandmark: /className="header-actions" role="toolbar" aria-label="状态工具"/.test(ui),
  modulesHavePointerTitles: /title=\{external \? `\$\{item\.label\}（新窗口）` : item\.label\}/.test(ui),
  iconOnlyModulesRemainNamed: /aria-label=\{external \? `打开\$\{item\.label\}（新窗口）` : item\.label\}/.test(ui),
  externalWindowsAreDisclosed: /const external = Boolean\(item\.path\)/.test(ui) && /className="module-external"/.test(ui),
  settingsDisclosesDialogState: /aria-haspopup=\{item\.action === "settings" \? "dialog"/.test(ui) && /aria-expanded=/.test(ui),
  activeSettingsIsVisible: /item\.action === "settings" \? drawerOpen/.test(ui),
  drawerHasNoDeadEngineeringAction: /LINKS\.filter\(\(item\) => item\.path\)/.test(ui),
  drawerHasNoDuplicateSettingsAction: /<nav className="drawer-section link-grid"[\s\S]{0,150}item\.path/.test(ui),
  refreshResultIsAnnounced: /role="status" aria-live="polite">\{refreshNotice\}/.test(ui) && /状态刷新失败/.test(ui),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
if (failed.length) process.exit(1);
