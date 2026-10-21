// R5 ModHub desktop-app: een venster dat de live site laadt.
// Updates van de site komen dus vanzelf mee; alleen deze schil hoeft zelden opnieuw.
const { app, BrowserWindow, shell, Menu, ipcMain, net, session } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const START_URL = 'https://r5mod.daver5.nl/';
const inApp = (url) => url.startsWith(START_URL);

// Zoeken naar updates: de site toont dit in Instellingen (alleen in de .exe).
// Het nieuwste versienummer staat in desktop/package.json op de site; de .exe zelf
// staat als privé concept onder Releases, dus downloaden gaat via je browser.
const VERSION_URL = START_URL + 'desktop/package.json';
const DOWNLOAD_URL = 'https://github.com/daveroosjen5-maker/modweergave/releases';
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const fromSite = (e) => inApp(e.senderFrame?.url || '');
ipcMain.handle('r5:check-update', async (e) => {
  if (!fromSite(e)) return null;
  const current = app.getVersion();
  try {
    const r = await net.fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const latest = String((await r.json()).version || '');
    return { current, latest, update: !!latest && newer(latest, current) };
  } catch (err) {
    return { current, error: 'Kon niet zoeken naar updates (' + err.message + ').' };
  }
});
ipcMain.handle('r5:open-download', (e) => { if (fromSite(e)) shell.openExternal(DOWNLOAD_URL); });

// Eén login voor alles, in een klein venster van de app zelf:
// 1. eerst inloggen bij twitch.tv (alleen de eerste keer); daarmee herkent de Twitch-speler
//    je Turbo en abonnementen (geen reclame);
// 2. daarna autoriseren voor chat en modacties. Twitch stuurt terug naar een tijdelijk
//    adres op deze pc, en de app geeft de token door aan de site (via #access_token=).
// Eigen Twitch-app "R5 ModHub Desktop", met omleidings-URL http://localhost:17563/
const DESKTOP_CLIENT_ID = 'wujrrxa41txxiatvqedrg32zgl1kh5';
const LOGIN_PORT = 17563;
const LOGIN_REDIRECT = `http://localhost:${LOGIN_PORT}/`;
let login = null; // { state, servers, timer, win, onCookie }

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>R5 ModHub</title>
<body style="background:#0e0e10;color:#efeff1;font-family:sans-serif;padding:40px;text-align:center">
<h2 id="t">${title}</h2><p id="m">${text}</p>`;

const CALLBACK_PAGE = page('Bezig met inloggen…', '') + `<script>
  const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  history.replaceState(null, '', '/');
  fetch('/token', { method: 'POST', body: p.toString() }).then((r) => r.text()).then((msg) => {
    const ok = p.has('access_token') && msg === 'ok';
    document.getElementById('t').textContent = ok ? 'Ingelogd bij R5 ModHub' : 'Inloggen mislukt';
    document.getElementById('m').textContent = ok ? 'Dit venster sluit vanzelf.' : msg;
  }).catch(() => { document.getElementById('t').textContent = 'De app reageert niet meer. Probeer opnieuw in te loggen.'; });
</script>`;

function stopLogin() {
  if (!login) return;
  const l = login;
  login = null;
  clearTimeout(l.timer);
  l.servers.forEach((s) => s.close());
  if (l.onCookie) session.defaultSession.cookies.removeListener('changed', l.onCookie);
  if (l.win && !l.win.isDestroyed()) l.win.close();
}

function handleLogin(req, res) {
  if (req.method === 'GET' && req.url.split('?')[0] === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(CALLBACK_PAGE);
  }
  if (req.method === 'POST' && req.url === '/token') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const reply = (msg) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
      if (!login || p.get('state') !== login.state) return reply('Deze inlogpoging is verlopen. Klik in de app opnieuw op Inloggen met Twitch.');
      if (!p.get('access_token')) { reply(p.get('error_description') || 'Je hebt geen toestemming gegeven.'); return setTimeout(stopLogin, 3000); }
      reply('ok');
      setTimeout(stopLogin, 800);
      session.defaultSession.cookies.flushStore();
      if (win) {
        // Eerst leeg laden: alleen de #-hash wijzigen zou de site niet opnieuw laten starten.
        const token = p.get('access_token');
        win.loadURL('about:blank').finally(() => win.loadURL(START_URL + '#access_token=' + encodeURIComponent(token)));
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    return;
  }
  res.writeHead(404); res.end();
}

const hasTwitchLogin = async () =>
  (await session.defaultSession.cookies.get({ domain: 'twitch.tv', name: 'auth-token' })).length > 0;

async function startLogin(authorizeUrl) {
  stopLogin();
  const state = crypto.randomBytes(16).toString('hex');
  // Zowel IPv4 als IPv6, want "localhost" kan naar allebei wijzen. Nooit op het netwerk.
  const servers = ['127.0.0.1', '::1'].map((host) => {
    const s = http.createServer(handleLogin);
    s.on('error', () => {});
    s.listen(LOGIN_PORT, host);
    return s;
  });
  const u = new URL(authorizeUrl);
  u.searchParams.set('client_id', DESKTOP_CLIENT_ID);
  u.searchParams.set('redirect_uri', LOGIN_REDIRECT);
  u.searchParams.set('state', state);

  const w = new BrowserWindow({
    width: 500, height: 800, parent: win, title: 'Inloggen bij Twitch',
    autoHideMenuBar: true, backgroundColor: '#0e0e10',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.webContents.setUserAgent(chromeUA(w));
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  login = { state, servers, win: w, timer: setTimeout(stopLogin, 15 * 60 * 1000) };
  w.on('closed', () => { if (login && login.win === w) stopLogin(); });

  if (await hasTwitchLogin()) return w.loadURL(u.toString());
  // Eerste keer: inloggen bij twitch.tv, daarna meteen door naar autoriseren.
  login.onCookie = (_e, cookie, _cause, removed) => {
    if (removed || cookie.name !== 'auth-token' || !/twitch\.tv$/.test(cookie.domain)) return;
    session.defaultSession.cookies.removeListener('changed', login.onCookie);
    login.onCookie = null;
    if (!w.isDestroyed()) w.loadURL(u.toString());
  };
  session.defaultSession.cookies.on('changed', login.onCookie);
  w.loadURL('https://www.twitch.tv/login');
}

if (!app.requestSingleInstanceLock()) app.quit();

// Chrome-UA zonder "Electron", zodat Twitch het inlogscherm en de speler normaal toont.
// "ModweergaveApp" (alleen hoofdvenster) laat de site weten dat hij al als app draait.
const chromeUA = (w) => w.webContents.getUserAgent().replace(/ (modweergave|r5-modhub|Electron)\/\S+/gi, '');

// Volledig uitloggen: de token van de site én de twitch.tv-login van de speler wissen.
async function logoutAll() {
  if (win) await win.webContents.executeJavaScript("localStorage.removeItem('modv.token')").catch(() => {});
  const jar = session.defaultSession.cookies;
  const all = await jar.get({ domain: 'twitch.tv' });
  await Promise.all(all.map((c) => jar.remove(`https://${c.domain.replace(/^\./, '')}${c.path}`, c.name)));
  await jar.flushStore();
  if (win) win.webContents.reloadIgnoringCache();
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 400,
    title: 'R5 ModHub', backgroundColor: '#0e0e10', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.webContents.setUserAgent(chromeUA(win) + ' ModweergaveApp');

  // Linkjes als Profiel, Modlogs en "open op Twitch" gaan naar de gewone browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (inApp(url)) return;
    e.preventDefault();
    if (url.startsWith('https://id.twitch.tv/oauth2/authorize')) startLogin(url);
    else shell.openExternal(url);
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
    { label: 'Herladen zonder cache', accelerator: 'CmdOrCtrl+F5', click: () => win && win.webContents.reloadIgnoringCache() },
    { role: 'togglefullscreen', accelerator: 'F11' },
    { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
    { role: 'toggleDevTools', accelerator: 'F12' },
  ] },
  { label: 'Account', submenu: [
    { label: 'Volledig uitloggen bij Twitch (ook de speler)', click: logoutAll },
  ] },
]));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
