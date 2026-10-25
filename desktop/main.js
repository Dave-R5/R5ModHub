// R5 ModHub desktop-app: een venster dat de live site laadt.
// Updates van de site komen dus vanzelf mee; de app zelf werkt zich bij via GitHub-releases.
const { app, BrowserWindow, WebContentsView, shell, Menu, ipcMain, session, dialog, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const START_URL = 'https://modhub.r5mod.nl/';
// Oud adres: stuurt door naar START_URL en geeft daarbij de instellingen mee (zie oud-adres/ in de repo).
const OLD_URL = 'https://r5mod.daver5.nl/';
const inApp = (url) => url.startsWith(START_URL) || url.startsWith(OLD_URL);
// Na de verhuizing eerst het oude adres openen, zodat de instellingen van de app meeverhuizen.
// Pas als het nieuwe adres bereikt is, wordt dat onthouden (zie did-navigate in createWindow).
const movedMark = () => path.join(app.getPath('userData'), 'verhuisd-naar-r5mod.nl');
const firstUrl = () => (fs.existsSync(movedMark()) ? START_URL : OLD_URL);

// Updates: de app werkt zichzelf bij vanaf de openbare GitHub-releases (electron-updater),
// op dezelfde manier als PointPlay: zoeken, downloaden met voortgang en daarna in-place
// installeren. De installer draait dan stil op de plek waar de app al staat en start
// R5 ModHub daarna vanzelf opnieuw (geen installatiewizard).
// Bij het starten (en elke 4 uur) wordt stilletjes gezocht; downloaden doe je in
// Instellingen > Windows-app. Is een update gedownload maar niet geïnstalleerd, dan gebeurt
// dat bij het afsluiten.
const RELEASES_URL = 'https://github.com/Dave-R5/R5ModHub/releases';
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const fromSite = (e) => inApp(e.senderFrame?.url || '');

let upd = app.isPackaged
  ? { status: 'idle', currentVersion: app.getVersion() }
  : { status: 'disabled', currentVersion: app.getVersion(), message: 'Updates werken alleen in de geïnstalleerde versie.' };
const setUpd = (patch) => {
  upd = { ...upd, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('r5:update-state', upd);
};
const friendly = (err) => {
  const msg = String(err?.message || err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNRE|net::/i.test(msg)) return 'Geen verbinding met de updateserver. Controleer je internet.';
  if (/404|Unable to find latest version|No published versions/i.test(msg)) return 'Er zijn nog geen updates gepubliceerd.';
  return 'Update mislukt: ' + msg.split('\n')[0];
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => { if (upd.status !== 'downloading' && upd.status !== 'ready') setUpd({ status: 'checking', message: null }); });
autoUpdater.on('update-available', (i) => {
  if (upd.status === 'downloading' || upd.status === 'ready') return;
  setUpd({ status: 'available', version: i.version });
});
autoUpdater.on('update-not-available', () => setUpd({ status: 'latest', checkedAt: Date.now() }));
autoUpdater.on('download-progress', (p) => setUpd({ status: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (i) => setUpd({ status: 'ready', version: i.version }));
autoUpdater.on('error', (err) => setUpd({ status: 'error', message: friendly(err) }));

async function checkForUpdates() {
  if (upd.status === 'disabled' || upd.status === 'downloading' || upd.status === 'ready') return upd;
  try { await autoUpdater.checkForUpdates(); } catch (err) { setUpd({ status: 'error', message: friendly(err) }); }
  return upd;
}
function downloadUpdate() {
  if (upd.status !== 'available') return upd;
  setUpd({ status: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch((err) => setUpd({ status: 'error', message: friendly(err) }));
  return upd;
}
function installUpdate() {
  if (upd.status !== 'ready') return upd;
  // Sluit de app, installeert de update stil op dezelfde plek en start R5 ModHub opnieuw.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return upd;
}

ipcMain.handle('r5:update', async (e, action) => {
  if (!fromSite(e)) return null;
  if (action === 'check') return checkForUpdates();
  if (action === 'download') return downloadUpdate();
  if (action === 'install') return installUpdate();
  return upd;
});

// Oude aanroepen (site van vóór 1.7.5): blijven werken met dezelfde in-place update.
ipcMain.handle('r5:check-update', async (e) => {
  if (!fromSite(e)) return null;
  const u = await checkForUpdates();
  if (u.status === 'error' || u.status === 'disabled') return { current: u.currentVersion, error: u.message };
  const latest = u.version || u.currentVersion;
  return { current: u.currentVersion, latest, update: newer(latest, u.currentVersion) };
});
ipcMain.handle('r5:open-download', async (e) => {
  if (!fromSite(e)) return;
  if (!app.isPackaged) return shell.openExternal(RELEASES_URL);
  if (upd.status === 'ready') return installUpdate();
  downloadUpdate();
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
    // backgroundThrottling uit: de app telt als zichtbaar als hij achter een ander venster staat of
    // geminimaliseerd is, zodat Twitch de stream niet pauzeert en chat/timers gewoon doorlopen
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
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
       <h2>Kan ${new URL(url || START_URL).host} niet laden</h2><p>${desc}. Controleer je internetverbinding.</p>
       <button onclick="location.href='${START_URL}'">Opnieuw proberen</button></body>`));
  });
  win.webContents.on('did-navigate', (_e, url, code) => {
    if (url.startsWith(START_URL)) { if (!fs.existsSync(movedMark())) try { fs.writeFileSync(movedMark(), new Date().toISOString()); } catch {} }
    else if (url.startsWith(OLD_URL) && code >= 400) win.loadURL(START_URL);
  });
  win.loadURL(firstUrl());
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

// BETA: de echte speler van twitch.tv in het streamblok, in plaats van de ingesloten speler.
// Twitch telt kijken in een ingesloten speler niet mee voor kanaalpunten en kijkreeksen; op de
// eigen kanaalpagina wel. De app laadt twitch.tv/<kanaal> als losse weergave over het blok en
// laat met wat CSS alleen de video zien (de speler over de hele weergave, chat en menu's weg). Uit te zetten in Instellingen (dan weer de oude speler).
const tv = new Map(); // kanaal -> WebContentsView
const TV_CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  nav, .top-nav, [data-a-target="top-nav-container"] { display: none !important; }
  .persistent-player {
    position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    max-width: none !important; max-height: none !important; transform: none !important;
    z-index: 2147483646 !important; background: #000 !important; }
  .persistent-player .video-player, .persistent-player [data-a-target="video-player"] {
    width: 100% !important; height: 100% !important; max-height: none !important; }
  .right-column, .channel-root__right-column, #sideNav, .side-nav { display: none !important; }
  .persistent-player .video-player, .persistent-player .video-player__container, .persistent-player .video-ref {
    height: 100vh !important; max-height: none !important; }`;
const tvPage = (ch) => 'https://www.twitch.tv/' + ch;
ipcMain.on('r5:tv-show', (e, ch, r) => {
  if (!fromSite(e) || !win || !okChan(ch) || !r) return;
  let v = tv.get(ch);
  if (!v) {
    // backgroundThrottling uit: blijft spelen als het blok even niet te zien is (ander tabblad)
    v = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    v.setBackgroundColor('#000000');
    v.webContents.setUserAgent(chromeUA(v));
    v.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    // alleen de kanaalpagina zelf; klikken naar andere pagina's gaan naar de gewone browser
    const own = (url) => url.split(/[?#]/)[0].replace(/\/$/, '').toLowerCase() === tvPage(ch);
    v.webContents.on('will-navigate', (ev, url) => { if (!own(url)) { ev.preventDefault(); shell.openExternal(url); } });
    // twitch.tv wisselt ook van pagina zonder te herladen; dan terug naar het kanaal
    v.webContents.on('did-navigate-in-page', (ev, url, isMain) => {
      if (isMain && !own(url)) { shell.openExternal(url); v.webContents.loadURL(tvPage(ch)); }
    });
    v.webContents.on('dom-ready', () => v.webContents.insertCSS(TV_CSS).catch(() => {}));
    v.webContents.loadURL(tvPage(ch));
    win.contentView.addChildView(v);
    tv.set(ch, v);
    v.size = { width: 640, height: 360 };
  }
  const z = win.webContents.getZoomFactor();
  if (r.w > 0 && r.h > 0) {
    v.size = { width: Math.round(r.w * z), height: Math.round(r.h * z) };
    v.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), ...v.size });
  } else {
    // niet te zien: buiten beeld zetten in plaats van verbergen, zodat de stream doorspeelt
    v.setBounds({ x: -20000, y: 0, ...v.size });
  }
});
ipcMain.on('r5:tv-close', (e, ch) => {
  if (!fromSite(e) || !win) return;
  const v = tv.get(ch);
  if (!v) return;
  win.contentView.removeChildView(v);
  v.webContents.close();
  tv.delete(ch);
});

// Multi-modus: chat van YouTube en de livepagina van TikTok en Instagram als losse weergave over
// een blok. Alleen pagina's van die sites; inloggen gebeurt in de weergave zelf.
const WEB_SITES = ['youtube.com', 'google.com', 'tiktok.com', 'instagram.com'];
const webOk = (url) => {
  try { const u = new URL(url); return u.protocol === 'https:' && WEB_SITES.some((d) => u.hostname === d || u.hostname.endsWith('.' + d)); } catch { return false; }
};
const web = new Map(); // sleutel -> WebContentsView
const okKey = (k) => typeof k === 'string' && /^[a-z]{2}:[A-Za-z0-9_.@-]{1,60}$/.test(k);
ipcMain.on('r5:web-show', (e, key, url, r, muted) => {
  if (!fromSite(e) || !win || !okKey(key) || !r) return;
  let v = web.get(key);
  if (v && v.url !== url) { win.contentView.removeChildView(v); v.webContents.close(); web.delete(key); v = null; }
  if (!v) {
    if (!webOk(url)) return;
    v = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    v.url = url;
    v.setBackgroundColor('#0e0e10');
    v.webContents.setUserAgent(chromeUA(v));
    v.webContents.setAudioMuted(!!muted);
    v.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    v.webContents.on('will-navigate', (ev, u) => { if (!webOk(u)) { ev.preventDefault(); shell.openExternal(u); } });
    v.webContents.loadURL(url);
    win.contentView.addChildView(v);
    web.set(key, v);
  }
  const z = win.webContents.getZoomFactor();
  v.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.max(0, Math.round(r.w * z)), height: Math.max(0, Math.round(r.h * z)) });
  v.setVisible(r.w > 0 && r.h > 0);
});
ipcMain.on('r5:web-close', (e, key) => {
  if (!fromSite(e) || !win) return;
  const v = web.get(key);
  if (!v) return;
  win.contentView.removeChildView(v);
  v.webContents.close();
  web.delete(key);
});
ipcMain.on('r5:web-mute', (e, key, on) => {
  if (!fromSite(e)) return;
  const v = web.get(key);
  if (v) v.webContents.setAudioMuted(!!on);
});
// Inloggen bij YouTube, TikTok of Instagram in een eigen venster. Dat venster en de blokken delen
// dezelfde cookies, dus daarna sta je in de blokken ingelogd. Bij sluiten laden de blokken opnieuw.
const LOGIN = {
  yt: { url: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F', site: 'youtube.com', cookie: ['SAPISID', 'LOGIN_INFO'], done: /^https:\/\/(www\.)?youtube\.com\/?(\?|$)/ },
  tt: { url: 'https://www.tiktok.com/login', site: 'tiktok.com', cookie: ['sessionid'], done: /^https:\/\/(www\.)?tiktok\.com\/(foryou|\?|$)/ },
  ig: { url: 'https://www.instagram.com/accounts/login/', site: 'instagram.com', cookie: ['sessionid'], done: /^https:\/\/(www\.)?instagram\.com\/?(\?|$)/ },
};
const loggedIn = async (k) => (await session.defaultSession.cookies.get({ domain: LOGIN[k].site })).some((c) => LOGIN[k].cookie.includes(c.name));
ipcMain.handle('r5:web-login-state', async (e) => {
  if (!fromSite(e)) return null;
  const out = {};
  for (const k of Object.keys(LOGIN)) out[k] = await loggedIn(k).catch(() => false);
  return out;
});
const loginWins = {};
ipcMain.on('r5:web-login', (e, k) => {
  if (!fromSite(e) || !win || !LOGIN[k]) return;
  if (loginWins[k] && !loginWins[k].isDestroyed()) { loginWins[k].focus(); return; }
  const w = new BrowserWindow({
    width: 520, height: 760, parent: win, title: 'Inloggen', autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  loginWins[k] = w;
  w.webContents.setUserAgent(chromeUA(w));
  w.webContents.setWindowOpenHandler(({ url }) => {
    // inlogpop-ups (bijv. via Google of Facebook) in hetzelfde venster openen
    if (webOk(url) || /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|apple\.com|twitter\.com|x\.com)\//.test(url)) { w.loadURL(url); return { action: 'deny' }; }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // terug op de startpagina van het platform = ingelogd: venster dicht
  const check = (_e, url) => { if (LOGIN[k].done.test(url)) loggedIn(k).then((ok) => { if (ok && !w.isDestroyed()) w.close(); }); };
  w.webContents.on('did-navigate', check);
  w.webContents.on('did-navigate-in-page', check);
  w.on('closed', () => {
    delete loginWins[k];
    web.forEach((v, key) => { if (key.startsWith(k + ':')) v.webContents.loadURL(v.url); });
    if (win && !win.isDestroyed()) win.webContents.send('r5:web-login-done', k);
  });
  w.loadURL(LOGIN[k].url);
});

// YouTube: de video van de livestream die nu loopt op een kanaal (@naam). De site kan dat zelf niet
// opvragen (geen toegang tot youtube.com vanuit de browser), de app wel.
ipcMain.handle('r5:yt-live', async (e, handle) => {
  if (!fromSite(e) || !/^@?[A-Za-z0-9_.-]{1,60}$/.test(String(handle))) return null;
  try {
    const res = await net.fetch('https://www.youtube.com/' + (String(handle).startsWith('@') ? '' : '@') + handle + '/live',
      { headers: { 'User-Agent': chromeUA(win), 'Accept-Language': 'nl-NL,nl;q=0.9', Cookie: 'SOCS=CAI' } });
    const html = await res.text();
    // live: YouTube toont de kijkpagina van de stream; niet live: de kanaalpagina, zonder video
    if (!/"isLive":true/.test(html)) return null;
    const m = html.match(/"currentVideoEndpoint":\{.{0,300}?"videoId":"([\w-]{11})"/) ||
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    return m ? m[1] : null;
  } catch { return null; }
});

const closeAllRq = () => {
  [rq, tv, web].forEach((m) => { m.forEach((v) => { try { win.contentView.removeChildView(v); v.webContents.close(); } catch {} }); m.clear(); });
};

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  createWindow();
  setTimeout(checkForUpdates, 10_000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
