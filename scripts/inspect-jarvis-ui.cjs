const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { app, BrowserWindow, ipcMain } = require("electron");

ipcMain.handle("jarvis:get-backend-port", () => 3721);
ipcMain.handle("jarvis:get-version", () => "inspect");

const root = path.resolve(__dirname, "..");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ui-inspect-"));
app.setPath("userData", userDataDir);
app.once("will-quit", () => {
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

async function waitForJarvisReady(win, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await win.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector(".monitor-stage");
      const composer = document.querySelector(".command-dock textarea");
      const orbVideo = document.querySelector(".entity-video");
      const workbench = document.querySelector(".jarvis-workbench");
      const status = [...document.querySelectorAll(".status-pill")].map((el) => el.textContent || "");
      const text = document.body.innerText || "";
      return {
        ready: Boolean(stage && composer && orbVideo && workbench && text.includes("JARVIS / LOCAL CONSCIOUSNESS")),
        hasStage: Boolean(stage),
        hasComposer: Boolean(composer),
        hasOrbVideo: Boolean(orbVideo),
        hasWorkbench: Boolean(workbench),
        orbVideoReadyState: orbVideo?.readyState || 0,
        status,
        text: text.slice(0, 500),
      };
    })()`, true).catch((error) => ({ ready: false, error: error.message || String(error) }));
    if (last.ready) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return last || { ready: false };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1365,
    height: 768,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "screenshot-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (/Electron Security Warning/.test(message)) return;
    if (level >= 2) errors.push(message);
  });

  await win.loadFile(path.join(root, "src", "ui", "jarvis", "index.html"));
  const readySnapshot = await waitForJarvisReady(win);
  const info = await win.webContents.executeJavaScript(`
    (() => {
      const orbVideo = document.querySelector(".entity-video");
      const workbench = document.querySelector(".jarvis-workbench");
      const messages = [...document.querySelectorAll(".terminal-line")].map((el) => ({
        role: el.querySelector("span")?.textContent || "",
        text: el.querySelector("p")?.textContent || "",
      }));
      return {
        ready: ${JSON.stringify(!!readySnapshot.ready)},
        readySnapshot: ${JSON.stringify(readySnapshot)},
        title: document.querySelector(".workbench-header strong")?.textContent || "",
        hasVoiceButton: !!document.querySelector("#voice-toggle"),
        hasVoiceCanvas: !!document.querySelector("#voice-canvas"),
        hasSettingsButton: !!document.querySelector(".header-actions .icon-btn"),
        hasComposer: !!document.querySelector(".command-dock textarea"),
        orbVideo: orbVideo ? {
          src: orbVideo.getAttribute("src") || "",
          readyState: orbVideo.readyState,
          videoWidth: orbVideo.videoWidth,
          videoHeight: orbVideo.videoHeight,
          paused: orbVideo.paused,
        } : null,
        workbench: Boolean(workbench),
        statusPills: [...document.querySelectorAll(".status-pill")].map((el) => el.textContent.replace(/\\s+/g, " ").trim()),
        messages,
        bodyText: document.body.innerText.slice(0, 800),
      };
    })();
  `);

  console.log(JSON.stringify({ ...info, errors }, null, 2));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exit(1);
});
