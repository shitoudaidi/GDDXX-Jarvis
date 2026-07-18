const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  isElectron: true,
  getBackendPort: () => ipcRenderer.invoke("jarvis:get-backend-port"),
  getVersion: () => ipcRenderer.invoke("jarvis:get-version"),
  getMusicTracks: () => ipcRenderer.invoke("jarvis:get-music-tracks"),
  getProbeMode: () => ipcRenderer.invoke("jarvis:get-probe-mode")
});

contextBridge.exposeInMainWorld("jarvisApp", {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check-for-updates"),
  startDownload: () => ipcRenderer.invoke("updater:start-download"),
  quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  onUpdaterStatus: () => () => {}
});
