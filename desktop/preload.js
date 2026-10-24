// Klein doorgeefluik voor de site: versie-info, de downloadpagina openen en prompt().
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('r5app', {
  checkUpdate: () => ipcRenderer.invoke('r5:check-update'),
  openDownload: () => ipcRenderer.invoke('r5:open-download'),
  // in-place updates: action = 'state' | 'check' | 'download' | 'install'; onUpdate(fn) krijgt elke wijziging
  update: (action) => ipcRenderer.invoke('r5:update', String(action || 'state')),
  onUpdate: (fn) => ipcRenderer.on('r5:update-state', (_e, u) => fn(u)),
  // beloningswachtrij van Twitch als losse weergave over een blok (zie main.js)
  rewardsShow: (ch, r) => ipcRenderer.send('r5:rq-show', String(ch), { x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 }),
  rewardsClose: (ch) => ipcRenderer.send('r5:rq-close', String(ch)),
  // BETA: echte twitch.tv-speler als losse weergave over het streamblok (zie main.js)
  tvShow: (ch, r) => ipcRenderer.send('r5:tv-show', String(ch), { x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 }),
  tvClose: (ch) => ipcRenderer.send('r5:tv-close', String(ch)),
  // Multi-modus: YouTube-chat, TikTok en Instagram als losse weergave over een blok (zie main.js)
  webShow: (key, url, r, muted) => ipcRenderer.send('r5:web-show', String(key), String(url), { x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 }, !!muted),
  webClose: (key) => ipcRenderer.send('r5:web-close', String(key)),
  webMute: (key, on) => ipcRenderer.send('r5:web-mute', String(key), !!on),
  ytLive: (handle) => ipcRenderer.invoke('r5:yt-live', String(handle)),
  webLogin: (kind) => ipcRenderer.send('r5:web-login', String(kind)),
  webLoginState: () => ipcRenderer.invoke('r5:web-login-state'),
  onWebLogin: (fn) => ipcRenderer.on('r5:web-login-done', (_e, kind) => fn(kind)),
  // poll starten in een kanaal waar je mod bent (venster met de chat van Twitch, zie main.js)
  openPoll: (ch) => ipcRenderer.send('r5:open-poll', String(ch)),
  prompt: (message, value) => ipcRenderer.sendSync('r5:prompt', String(message ?? ''), value == null ? '' : String(value)),
});

// Electron kent window.prompt() niet (geeft een fout); de site gebruikt het o.a. voor
// "+ tabblad" en hernoemen. Vervang het door een eigen invoervenster van de app.
webFrame.executeJavaScript('window.prompt = (m, v) => window.r5app.prompt(m, v);');
