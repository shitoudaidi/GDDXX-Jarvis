const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = process.argv[2] || path.join(process.env.TEMP || root, "jarvis-react-ui.png");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ui-shot-"));
app.setPath("userData", userDataDir);
app.once("will-quit", () => {
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

async function waitForJarvisReady(win, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await win.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('.monitor-stage');
      const dock = document.querySelector('.command-dock textarea');
      const terminal = document.querySelector('.hud-terminal');
      const orbVideo = document.querySelector('.entity-video');
      const workbench = document.querySelector('.jarvis-workbench');
      const text = document.body.innerText || '';
      const ready = !!(stage && dock && terminal && orbVideo?.readyState >= 2 && workbench && text.includes('JARVIS / LOCAL CONSCIOUSNESS'));
      return {
        ready,
        hasStage: !!stage,
        hasDock: !!dock,
        hasTerminal: !!terminal,
        mainStatus: document.querySelector('.portrait-copy strong')?.textContent || '',
        activeText: text.slice(0, 500),
        orbVideoReadyState: orbVideo?.readyState || 0,
        workbenchReady: !!workbench
      };
    })()`, true).catch((error) => ({ ready: false, error: error.message || String(error) }));
    lastSnapshot = snapshot;
    if (snapshot.ready) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return lastSnapshot || { ready: false };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "screenshot-preload.cjs")
    }
  });

  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (/Electron Security Warning/.test(message)) return;
    if (level >= 2) errors.push(message);
  });

  await win.loadFile(path.join(root, "src", "ui", "jarvis", "index.html"));
  const snapshot = await waitForJarvisReady(win);
  const initialMode = await win.webContents.executeJavaScript(
    `window.__jarvisUiProbe?.getMode?.() || ""`,
    true
  ).catch(() => "");
  let wakeAccepted = null;
  if (process.env.JARVIS_SCREENSHOT_MODE === "active") {
    if (process.env.JARVIS_TRANSCRIPT_TEXT) {
      const transcriptText = JSON.stringify(process.env.JARVIS_TRANSCRIPT_TEXT);
      wakeAccepted = "transcript-event";
      await win.webContents.executeJavaScript(`
        window.dispatchEvent(new CustomEvent("jarvis:voice-transcript", {
          detail: { text: ${transcriptText}, accumulated: ${transcriptText}, final: false }
        }));
      `, true).catch(() => {});
    } else {
      const wakeText = JSON.stringify(process.env.JARVIS_WAKE_TEXT || "嗨 Jarvis");
      wakeAccepted = await win.webContents.executeJavaScript(`
        window.__jarvisUiProbe?.acceptWakeText?.(${wakeText});
      `, true).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 1600));
  }
  win.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  const finalMode = await win.webContents.executeJavaScript(
    `window.__jarvisUiProbe?.getMode?.() || ""`,
    true
  ).catch(() => "");
  console.log(JSON.stringify({ out, ready: !!snapshot.ready, initialMode, wakeAccepted, finalMode, snapshot, errors }, null, 2));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exit(1);
});
