const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');

const out = process.argv[2] || path.join(app.getPath('temp'), 'jarvis-react-ui-scrolled.png');
const scrollTop = Number(process.argv[3] || 520);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ui-shot-'));
app.setPath('userData', userDataDir);
app.once('will-quit', () => {
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

ipcMain.handle('jarvis:getBackendPort', () => 3721);
ipcMain.handle('jarvis:get-backend-port', () => 3721);

async function waitForJarvisReady(win, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('.dialog-console');
      const dock = document.querySelector('.command-dock textarea');
      const telemetry = document.querySelector('.left-rail');
      const video = document.querySelector('.entity-video');
      const text = document.body.innerText || '';
      return !!(dialog && dock && telemetry && video?.readyState >= 2 && text.includes('一句话，一个动作') && text.includes('核心能力'));
    })()`, true).catch(() => false);
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1365,
    height: 768,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'screenshot-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'ui', 'jarvis', 'index.html'));
  const ready = await waitForJarvisReady(win);
  const scrollInfo = await win.webContents.executeJavaScript(`
    (() => {
      const rail = document.querySelector('.dialog-console .messages');
      if (!rail) return null;
      rail.scrollTop = ${JSON.stringify(scrollTop)};
      rail.scrollTo(0, ${JSON.stringify(scrollTop)});
      return {
        scrollTop: rail.scrollTop,
        scrollHeight: rail.scrollHeight,
        clientHeight: rail.clientHeight,
        childCount: rail.children.length
      };
    })();
  `);
  win.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await win.capturePage();
  await require('node:fs').promises.writeFile(out, image.toPNG());
  console.log(JSON.stringify({ out, ready, scrollInfo }, null, 2));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
});
