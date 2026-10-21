// Klein doorgeefluik voor de site: versie-info, de downloadpagina openen en prompt().
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('r5app', {
  checkUpdate: () => ipcRenderer.invoke('r5:check-update'),
  openDownload: () => ipcRenderer.invoke('r5:open-download'),
  prompt: (message, value) => ipcRenderer.sendSync('r5:prompt', String(message ?? ''), value == null ? '' : String(value)),
});

// Electron kent window.prompt() niet (geeft een fout); de site gebruikt het o.a. voor
// "+ tabblad" en hernoemen. Vervang het door een eigen invoervenster van de app.
webFrame.executeJavaScript('window.prompt = (m, v) => window.r5app.prompt(m, v);');
