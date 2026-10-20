// R5 ModHub desktop-app: een venster dat de live site laadt.
// Updates van de site komen dus vanzelf mee; alleen deze schil hoeft zelden opnieuw.
const { app, BrowserWindow, shell, Menu } = require('electron');

const START_URL = 'https://r5mod.daver5.nl/';
// Inloggen bij Twitch gebeurt in het venster zelf; daarna stuurt Twitch terug naar START_URL.
const IN_APP = [/^https:\/\/r5mod\.daver5\.nl\//, /^https:\/\/(id|passport|www|player|clips)\.twitch\.tv\//, /^https:\/\/twitch\.tv\//];
const inApp = (url) => IN_APP.some((re) => re.test(url));

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 400,
    title: 'R5 ModHub', backgroundColor: '#0e0e10', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Chrome-UA zonder "Electron", zodat Twitch het inlogscherm en de speler normaal toont.
  // "ModweergaveApp" laat de site weten dat hij al als app draait (geen installeerknop).
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ (modweergave|Electron)\/\S+/gi, '') + ' ModweergaveApp');

  // Linkjes als Profiel, Modlogs en "open op Twitch" gaan naar de gewone browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!inApp(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#0e0e10;color:#efeff1;font-family:sans-serif;padding:40px">
       <h2>Kan r5mod.daver5.nl niet laden</h2><p>${desc}. Controleer je internetverbinding.</p>
       <button onclick="location.href='${START_URL}'">Opnieuw proberen</button></body>`));
  });
  win.loadURL(START_URL);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Weergave', submenu: [
    { label: 'Herladen', accelerator: 'F5', click: () => win && win.loadURL(START_URL) },
    { role: 'reload', accelerator: 'CmdOrCtrl+R' },
    { role: 'togglefullscreen', accelerator: 'F11' },
    { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
    { role: 'toggleDevTools', accelerator: 'F12' },
  ] },
]));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
