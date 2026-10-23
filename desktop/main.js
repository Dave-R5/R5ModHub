// R5 ModHub desktop-app: een venster dat de live site laadt.
// Updates van de site komen dus vanzelf mee; de app zelf werkt zich bij via GitHub-releases.
const { app, BrowserWindow, WebContentsView, shell, Menu, ipcMain, session, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const START_URL = 'https://r5mod.daver5.nl/';
const inApp = (url) => url.startsWith(START_URL);

// Updates: de app werkt zichzelf bij vanaf de openbare GitHub-releases (electron-updater).
// Bij het starten (en elke 4 uur) wordt gezocht; een nieuwe versie wordt op de achtergrond
// gedownload en daarna gevraagd om te herstarten. Anders installeert hij bij afsluiten.
// De site toont dit in Instellingen > Windows-app (checkUpdate / openDownload).
const RELEASES_URL = 'https://github.com/Dave-R5/modweergave/releases';
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const fromSite = (e) => inApp(e.senderFrame?.url || '');

const upd = { latest: null, ready: false, asked: false };
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (i) => { upd.latest = i.version; });
autoUpdater.on('update-not-available', (i) => { upd.latest = i.version; });
autoUpdater.on('update-downloaded', (i) => {
  upd.latest = i.version; upd.ready = true;
  if (!upd.asked) { upd.asked = true; askRestart(); }
});
autoUpdater.on('error', () => {});

async function askRestart() {
  if (!win) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', buttons: ['Nu herstarten', 'Later'], defaultId: 0, cancelId: 1, title: 'R5 ModHub',
    message: `Versie ${upd.latest} van R5 ModHub is klaar.`,
    detail: 'Herstart nu om bij te werken. Kies je Later, dan wordt de update geïnstalleerd als je de app afsluit.',
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

const checkForUpdates = () => (app.isPackaged ? autoUpdater.checkForUpdates() : Promise.resolve(null));

ipcMain.handle('r5:check-update', async (e) => {
  if (!fromSite(e)) return null;
  const current = app.getVersion();
  try {
    const r = await checkForUpdates();
    const latest = r?.updateInfo?.version || upd.latest || current;
    return { current, latest, update: newer(latest, current) };
  } catch (err) {
    return { current, error: 'Kon niet zoeken naar updates (' + err.message + ').' };
  }
});
// "Downloaden" in Instellingen: is de update al binnen, dan meteen herstarten.
ipcMain.handle('r5:open-download', async (e) => {
  if (!fromSite(e)) return;
  if (upd.ready) return askRestart();
  if (!app.isPackaged) return shell.openExternal(RELEASES_URL);
  await dialog.showMessageBox(win, {
    type: 'info', buttons: ['OK'], title: 'R5 ModHub',
    message: 'De update wordt gedownload.', detail: 'Zodra hij klaar is, vraagt de app of je wilt herstarten.',
  });
});

// Vervanging voor window.prompt(): een klein invoervenster bovenop de app.
// De site wacht (synchroon) tot je op OK of Annuleren klikt, net als bij een gewone prompt.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
ipcMain.on('r5:prompt', (e, message, value) => {
  if (!fromSite(e) || !win) { e.returnValue = null; return; }
  let answered = false;
  const answer = (v) => { if (!answered) { answered = true; e.returnValue = v; } };
  const w = new BrowserWindow({
    width: 420, height: 190, parent: win, modal: true, resizable: false, minimizable: false, maximizable: false,
    title: 'R5 ModHub', autoHideMenuBar: true, backgroundColor: '#18181b', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: true },
  });
  w.setMenu(null);
  // Het venster geeft zijn antwoord door via de titel ("__r5:" + JSON).
  w.on('page-title-updated', (ev, title) => {
    if (!title.startsWith('__r5:')) return;
    ev.preventDefault();
    answer(JSON.parse(title.slice(5)));
    w.close();
  });
  w.on('closed', () => answer(null));
  w.once('ready-to-show', () => w.show());
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
<title>R5 ModHub</title>
<style>
  body { margin: 0; padding: 18px; background: #18181b; color: #efeff1; font: 14px system-ui, sans-serif; }
  label { display: block; margin-bottom: 8px; }
  input { box-sizing: border-box; width: 100%; padding: 7px 9px; font: inherit; color: #efeff1; background: #0e0e10;
    border: 1px solid #2e2e35; border-radius: 6px; outline: none; }
  input:focus { border-color: #9147ff; }
  .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  button { font: inherit; color: #efeff1; background: #1f1f23; border: 1px solid #2e2e35; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  button.ok { background: #9147ff; border-color: #9147ff; }
</style>
<label for="v">${esc(message)}</label>
<input id="v" value="${esc(value)}">
<div class="row"><button id="no">Annuleren</button><button class="ok" id="ok">OK</button></div>
<script>
  const v = document.getElementById('v');
  const done = (x) => { document.title = '__r5:' + JSON.stringify(x); };
  document.getElementById('ok').onclick = () => done(v.value);
  document.getElementById('no').onclick = () => done(null);
  v.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(v.value); if (e.key === 'Escape') done(null); });
  v.focus(); v.select();
</script>`));
});

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
  // Twitch stuurt na het inloggen soms gewoon naar de startpagina; daarom drie signalen:
  // het auth-token-cookie, een pagina buiten het inlogscherm, of een korte controle elke seconde.
  let done = false;
  const goAuthorize = () => {
    if (done || w.isDestroyed()) return;
    done = true;
    if (login && login.onCookie) session.defaultSession.cookies.removeListener('changed', login.onCookie);
    if (login) login.onCookie = null;
    clearInterval(poll);
    w.loadURL(u.toString());
  };
  login.onCookie = (_e, cookie, _cause, removed) => {
    if (!removed && cookie.name === 'auth-token' && /twitch\.tv$/.test(cookie.domain)) goAuthorize();
  };
  session.defaultSession.cookies.on('changed', login.onCookie);
  const poll = setInterval(() => { hasTwitchLogin().then((ok) => ok && goAuthorize()).catch(() => {}); }, 1000);
  w.on('closed', () => clearInterval(poll));
  const onNav = (_e, url) => {
    let h;
    try { h = new URL(url); } catch { return; }
    if (/(^|\.)twitch\.tv$/.test(h.hostname) && h.hostname !== 'id.twitch.tv' && h.hostname !== 'passport.twitch.tv'
        && !/^\/(login|signup|passport|two_factor|verify)/.test(h.pathname)) goAuthorize();
  };
  w.webContents.on('did-navigate', onNav);
  w.webContents.on('did-navigate-in-page', onNav);
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
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) closeAllRq(); });
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

// Beloningswachtrij als blok: Twitch laat de pagina niet inbouwen in een andere site, dus de app legt
// een eigen, losse weergave van twitch.tv over het blok heen. De site geeft door waar het blok staat.
const rq = new Map(); // kanaal -> WebContentsView
const okChan = (c) => typeof c === 'string' && /^[a-z0-9_]{1,25}$/.test(c);
ipcMain.on('r5:rq-show', (e, ch, r) => {
  if (!fromSite(e) || !win || !okChan(ch) || !r) return;
  let v = rq.get(ch);
  if (!v) {
    v = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    v.setBackgroundColor('#0e0e10');
    v.webContents.setUserAgent(chromeUA(v));
    v.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    v.webContents.loadURL('https://www.twitch.tv/popout/' + ch + '/reward-queue');
    win.contentView.addChildView(v);
    rq.set(ch, v);
  }
  const z = win.webContents.getZoomFactor();
  v.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.max(0, Math.round(r.w * z)), height: Math.max(0, Math.round(r.h * z)) });
  v.setVisible(r.w > 0 && r.h > 0);
});
ipcMain.on('r5:rq-close', (e, ch) => {
  if (!fromSite(e) || !win) return;
  const v = rq.get(ch);
  if (!v) return;
  win.contentView.removeChildView(v);
  v.webContents.close();
  rq.delete(ch);
});
// Poll in een kanaal waar je mod bent: Twitch laat apps dat niet via de API doen, wel via de eigen
// chat. Open de popout-chat van dat kanaal in een venster van de app (je bent daar al ingelogd)
// en typ er /poll in, zodat meteen het pollscherm van Twitch verschijnt.
const pollWins = new Map();
ipcMain.on('r5:open-poll', (e, ch) => {
  if (!fromSite(e) || !win || !okChan(ch)) return;
  const old = pollWins.get(ch);
  if (old && !old.isDestroyed()) { old.focus(); return; }
  const w = new BrowserWindow({
    width: 460, height: 760, parent: win, title: 'Poll · ' + ch, autoHideMenuBar: true, backgroundColor: '#0e0e10',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  pollWins.set(ch, w);
  w.on('closed', () => pollWins.delete(ch));
  w.webContents.setUserAgent(chromeUA(w));
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.once('did-finish-load', async () => {
    // wachten tot het chatveld er is, dan /poll typen en op Enter drukken
    for (let i = 0; i < 40 && !w.isDestroyed(); i++) {
      const ok = await w.webContents.executeJavaScript(
        "(() => { const el = document.querySelector('[data-a-target=\"chat-input\"]'); if (!el) return false; el.focus(); return true; })()").catch(() => false);
      if (ok) {
        await w.webContents.insertText('/poll');
        setTimeout(() => {
          if (w.isDestroyed()) return;
          w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          w.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
          w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        }, 400);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  w.loadURL('https://www.twitch.tv/popout/' + ch + '/chat');
});

const closeAllRq = () => { rq.forEach((v) => { try { win.contentView.removeChildView(v); v.webContents.close(); } catch {} }); rq.clear(); };

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  createWindow();
  checkForUpdates().catch(() => {});
  setInterval(() => checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
