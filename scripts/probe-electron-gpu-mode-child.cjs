const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const mode = process.env.JARVIS_GPU_MODE || "unknown";
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-gpu-mode-${mode}-`));
const htmlPath = path.join(userDir, "index.html");

app.setPath("userData", path.join(userDir, "user-data"));

fs.writeFileSync(htmlPath, "<!doctype html><meta charset=\"utf-8\"><title>probe</title><div id=\"ok\">ok</div>", "utf8");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 420,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(pathToFileURL(htmlPath).href);
  const text = await win.webContents.executeJavaScript("document.querySelector('#ok')?.textContent || ''");
  const result = { ok: text === "ok", mode, text };
  console.log(`JARVIS_GPU_MODE_RESULT ${JSON.stringify(result)}`);
  await win.close();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  app.exit(result.ok ? 0 : 1);
}).catch((error) => {
  console.log(`JARVIS_GPU_MODE_RESULT ${JSON.stringify({ ok: false, mode, error: error.message || String(error) })}`);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  app.exit(1);
});
