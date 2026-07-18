const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

ipcMain.handle("jarvis:getBackendPort", () => 3721);
ipcMain.handle("jarvis:get-backend-port", () => 3721);

const root = path.resolve(__dirname, "..");
const state = process.argv[2] || "idle";
const out = process.argv[3] || path.join(root, `jarvis-${state}-preview.png`);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "screenshot-preload.cjs"),
    },
  });

  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadFile(path.join(root, "src", "ui", "jarvis", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await win.webContents.executeJavaScript(`window.__jarvisVisualProbe?.setState?.(${JSON.stringify(state)})`, true);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  const info = await win.webContents.executeJavaScript(`(() => {
    const video = document.querySelector(".entity-video");
    return {
      out: ${JSON.stringify(out)},
      state: ${JSON.stringify(state)},
      activeVideo: video?.getAttribute("src") || "",
      readyState: video?.readyState || 0,
      currentTime: video ? Number(video.currentTime.toFixed(2)) : 0,
      videoWidth: video?.videoWidth || 0,
      videoHeight: video?.videoHeight || 0,
      fallback: false
    };
  })()`, true);
  console.log(JSON.stringify({ ...info, errors }, null, 2));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exit(1);
});
