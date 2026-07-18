const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  isElectron: true,
  getBackendPort: async () => 3721,
  getVersion: async () => "screenshot"
});
