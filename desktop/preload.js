// Klein doorgeefluik voor de site: alleen versie-info en de downloadpagina openen.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r5app', {
  checkUpdate: () => ipcRenderer.invoke('r5:check-update'),
  openDownload: () => ipcRenderer.invoke('r5:open-download'),
});
