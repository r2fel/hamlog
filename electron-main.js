/* Electron shell around the existing local server — the app itself (server.js
 * + public/) is unchanged; this just gives it a native window instead of a
 * browser tab, so the logbook opens like any other app — on a Mac, and on
 * Windows (see the IS_WINDOWS parts: a normal frame there, and no menu bar).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, crashReporter, dialog, ipcMain, screen, shell, session } = require('electron');
const debugLog = require('./debug-log');

// Asks macOS for Location Services permission, which Electron never does by
// itself (see native/location.m). Optional: without it — not built, or not
// a Mac — the 📍 button still works once the switch is on in System Settings.
let locationAccess = null;
try {
  locationAccess = require('./native/location.node');
} catch (e) {
  console.warn(`[location] native helper not loaded: ${e.message}`);
}

// The installed app's bundle id (package.json "build.appId") — its caches,
// saved window state and preferences are all filed under it.
const APP_ID = 'com.r2fel.qsolog';

const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// Windows opens a second copy on every double-click of the shortcut, and a
// second copy can't have the port — it would fail on startup. The first
// one's window comes forward instead (see 'second-instance' below). Checked
// before the server starts, so a second copy never even tries.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// The debug log (see debug-log.js) starts before anything else can go
// wrong, and a crash of the app's own processes leaves a dump beside it —
// kept on this computer, never sent anywhere.
debugLog.start();
crashReporter.start({ uploadToServer: false });
console.log(`[app] crash dumps, if any: ${app.getPath('crashDumps')}`);

// The window opens 900px wide — the width the form is laid out for — and
// can then be stretched, maximised or made full screen (see RESIZABLE).
const WINDOW_WIDTH = 900;

// Height is the one thing that can't be pinned to the content: the form
// grows with every group station and the log opens underneath it. Take as
// much as the screen comfortably gives and let the rest scroll.
const PREFERRED_HEIGHT = 940;

// The server picks PORT from the environment (see server.js) — fixed here so
// the window always knows where to point. The installed app keeps 4173, the
// same default as `npm start`; the development copy (`npm run electron`)
// takes 4174, so it can be opened for checking a change while the installed
// app is still running, instead of one having to be quit for the other.
process.env.PORT = process.env.PORT || (app.isPackaged ? '4173' : '4174');
// The development copy checks for updates like any other, but is left out of
// the head count — see /api/update in server.js.
if (!app.isPackaged) process.env.QSO_DEV = '1';
const PORT = process.env.PORT;

// On Windows the server answers this computer only. Listening on the network
// (for a phone on the same Wi-Fi, which is what `npm start` is for) makes
// Windows Firewall stop the first launch with a warning about R2FEL-LOG
// wanting network access — which it doesn't need. 127.0.0.1 rather than
// "localhost", which Windows may resolve to the IPv6 address first.
if (IS_WINDOWS) process.env.HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = `http://${process.env.HOST === '127.0.0.1' ? '127.0.0.1' : 'localhost'}:${PORT}`;

// Windows: Chromium's own location provider needs a Google key the app
// doesn't have; the Windows one (the system's Location setting) doesn't.
if (IS_WINDOWS) app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation');
if (IS_WINDOWS) app.setAppUserModelId(APP_ID);   // taskbar grouping and pinning

// Installed from the DMG, server.js lives inside the read-only app bundle
// and can't keep its data/ folder (the saved QRZ login) next to itself —
// that goes to the user's Application Support folder instead. Run from the
// project with `npm run electron`, it keeps using the project's data/.
if (app.isPackaged) {
  process.env.QSO_DATA_DIR = path.join(app.getPath('userData'), 'data');
}

// Starts listening as a side effect of being required — see server.js.
require('./server.js');

// The window can be stretched, maximised and made full screen (F11, or the
// green button on a Mac) — screens come in every size and scaling, and on
// some a fixed window didn't fit. The page follows the window (see
// .is-desktop-app in index.html) and the size is remembered. Mac and
// Windows alike: the two are meant to look and work the same.
const RESIZABLE = true;
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

/** Where and how big the window was last time — if that's still on a screen. */
function savedWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE(), 'utf8'));
    const b = state.bounds;
    const onScreen = screen.getAllDisplays().some(({ workArea: w }) =>
      b.x < w.x + w.width - 50 && b.x + b.width > w.x + 50 &&
      b.y >= w.y - 10 && b.y < w.y + w.height - 50);
    return onScreen && b.width >= 400 && b.height >= 300 ? state : null;
  } catch (e) {
    return null;   // first launch, or the file is unreadable — start fresh
  }
}

function rememberWindowState(win) {
  try {
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify({
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized()
    }));
  } catch (e) { /* not worth failing a quit over */ }
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const saved = RESIZABLE ? savedWindowState() : null;

  const win = new BrowserWindow({
    // useContentSize so these are the page's own dimensions — the card is
    // measured in CSS pixels, and so should the window be. A remembered
    // size is the whole window's, as it was saved.
    ...(saved
      ? { ...saved.bounds, useContentSize: false }
      : { useContentSize: true, width: WINDOW_WIDTH, height: Math.min(PREFERRED_HEIGHT, workArea.height - 40) }),
    resizable: RESIZABLE,
    maximizable: RESIZABLE,
    fullscreenable: RESIZABLE,
    ...(RESIZABLE ? { minWidth: 420, minHeight: 420 } : {}),
    // Mac: no title bar, just the traffic lights over the page — index.html
    // leaves a strip clear for them and makes it draggable. Windows keeps
    // its ordinary frame: that's where people look for close and minimise.
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : {}),
    title: 'R2FEL HamLog',   // what the page's own <title> says too — see index.html
    backgroundColor: '#0f0e0c',   // matches the PWA's own background color
    show: false,   // until the page has drawn itself — see 'ready-to-show' below
    icon: IS_MAC
      ? path.join(__dirname, 'build', 'icon.icns')
      : path.join(__dirname, 'public', 'icons', 'app-icon-win.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'electron-preload.js')
    }
  });

  if (RESIZABLE) {
    if (saved && saved.maximized) win.maximize();
    win.on('close', () => rememberWindowState(win));
    // F11: full screen and back, as in any Windows browser. There's no
    // menu bar on Windows to hang the key on, so it's caught here (on a Mac
    // it's also Window → Enter Full Screen, ⌃⌘F).
    win.webContents.on('before-input-event', (ev, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        ev.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      }
    });
  }

  // Right-click in a field: cut / copy / paste, as in any other program.
  // A browser puts this menu up by itself; an Electron window has no menu
  // at all unless one is built here, so the ordinary way of pasting a
  // callsign, an address or an app password was simply missing (⌘V still
  // worked, but nobody could see that). The labels come from the system —
  // roles are translated by the OS.
  //
  // A password field gets Paste and Select All only: that is how browsers
  // treat them, and a password nobody can read on screen shouldn't be
  // copyable out of the window either.
  win.webContents.on('context-menu', (ev, params) => {
    // The words follow the program, not the computer: with Russian mode on,
    // the menu is Russian even on an English Mac. The roles still do the
    // work and bring their own ⌘C / ⌘V — only the label is ours.
    const L = (en, ru) => (ruMode ? ru : en);
    const password = params.inputFieldType === 'password';
    const items = [];
    if (params.isEditable) {
      if (!password) items.push(
        { role: 'undo', label: L('Undo', 'Отменить') },
        { role: 'redo', label: L('Redo', 'Повторить') },
        { type: 'separator' },
        { role: 'cut', label: L('Cut', 'Вырезать') },
        { role: 'copy', label: L('Copy', 'Копировать') });
      items.push(
        { role: 'paste', label: L('Paste', 'Вставить') },
        { type: 'separator' },
        { role: 'selectAll', label: L('Select All', 'Выбрать всё') });
    } else if (params.selectionText && params.selectionText.trim()) {
      items.push({ role: 'copy', label: L('Copy', 'Копировать') });
    }
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Nothing rescales the app's drawing: not a pinch or a ⌘+ — the layout is
  // drawn at one size on purpose. The window can change size; the page then
  // reflows, it isn't magnified.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
    win.webContents.setZoomFactor(1);
  });

  debugLog.watchWindow(win);
  // Shown once the page has drawn itself, fonts and all — not as an empty
  // black frame that then fills in. Should that signal never come, the
  // window shows anyway after a few seconds.
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);
  win.loadURL(ORIGIN);

  // A link the app opens should go to the real browser (or, for the mailto:
  // at the foot of settings, the mail app), never turn this window into one.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith(ORIGIN)) return;
    ev.preventDefault();
    shell.openExternal(url);
  });

  return win;
}

/**
 * Removes the app and everything it keeps, as far as a Mac app can do that
 * for itself. macOS gives an app no say when it's dragged to the Trash, so
 * this is offered from the app's own menu instead.
 *
 * The app and its data go to the Trash, not away for good — the logbook can
 * still be dragged back out. It happens after the app has quit, from a small detached
 * shell: while it's running, the app holds its own profile open, and would
 * write parts of it back on the way out.
 */
async function uninstall() {
  const win = BrowserWindow.getAllWindows()[0];
  let count = '';
  if (win) {
    try {
      count = await win.webContents.executeJavaScript(
        "(document.getElementById('qso-total') || {}).textContent || ''");
    } catch (e) { /* page not ready — the dialog just won't give a number */ }
  }
  const logLine = count && count !== '0'
    ? `your logbook (${count} contacts)`
    : 'your logbook';

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: 'Uninstall LOG?',
    detail:
      `This moves the app (R2FEL-LOG in Applications) and everything it keeps to the Trash: ${logLine}, ` +
      'the saved QRZ login and all settings. The app then quits.\n\n' +
      'To keep your contacts, export them to ADIF first.',
    buttons: ['Export ADIF First…', 'Uninstall', 'Cancel'],
    defaultId: 2,
    cancelId: 2
  });

  if (response === 0) {
    if (win) win.webContents.executeJavaScript("document.getElementById('qso-data-btn').click()");
    return;
  }
  if (response !== 1) return;

  const home = app.getPath('home');
  const bundle = path.resolve(process.execPath, '..', '..', '..');   // …/R2FEL-LOG.app
  const targets = [
    app.getPath('userData'),                              // logbook, settings, data/ (QRZ login)
    path.join(home, 'Library', 'Caches', APP_ID),
    path.join(home, 'Library', 'Saved Application State', `${APP_ID}.savedState`),
    path.join(home, 'Library', 'Logs', app.getName()),
    bundle.endsWith('.app') ? bundle : null
  ].filter(Boolean);

  spawn('/bin/sh', ['-c', uninstallScript(process.pid, targets)], {
    detached: true,
    stdio: 'ignore'
  }).unref();
  app.quit();
}

/**
 * The shell that does the moving, once `pid` has exited. Each target keeps
 * its own name in the Trash unless that name is taken, in which case a
 * timestamp goes in front — never after, so R2FEL-LOG.app stays an .app and
 * can simply be dragged back. Preferences are removed through `defaults`:
 * cfprefsd caches them and would write the file straight back otherwise.
 */
function uninstallScript(pid, targets) {
  const q = s => `'${String(s).replace(/'/g, "'\\''")}'`;
  return [
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
    'stamp=$(date +%Y-%m-%d\\ %H.%M.%S)',
    ...targets.map(t => [
      `if [ -e ${q(t)} ]; then`,
      `  name=$(basename ${q(t)}); dest="$HOME/.Trash/$name"`,
      '  [ -e "$dest" ] && dest="$HOME/.Trash/$stamp $name"',
      `  mv ${q(t)} "$dest"`,
      'fi'
    ].join('\n')),
    `defaults delete ${APP_ID} 2>/dev/null`,
    `rm -f "$HOME/Library/Preferences/${APP_ID}.plist"`
  ].join('\n');
}

// Trimmed down from Electron's default menu: this app has no File/Edit/View
// commands of its own yet, and the boilerplate items (About, Services,
// Hide/Quit) are the only ones worth keeping under the app's own name.
// Russian mode, as the page last reported it (electron-preload.js → here).
// Only the right-click menu uses this; the Mac menu bar is built once at
// startup and stays in the language macOS shows the app under.
let ruMode = false;
ipcMain.on('app-language', (ev, ru) => { ruMode = Boolean(ru); });

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = isMac ? [{
    label: app.name,
    submenu: [
      // The menu itself is titled by macOS after the app's file, R2FEL-LOG;
      // what's in it speaks of the program by the name it shows, R2FEL HamLog.
      { role: 'about', label: 'About R2FEL HamLog' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: 'Hide R2FEL HamLog' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      // Only in the installed app: run from the project, "the app" is the
      // shared Electron binary in node_modules, which must not be trashed.
      ...(app.isPackaged ? [
        { label: 'Uninstall R2FEL HamLog…', click: () => uninstall() },
        { type: 'separator' }
      ] : []),
      { role: 'quit', label: 'Quit R2FEL HamLog' }
    ]
  }, {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]
  },
  // Development copy only: after a change to the page, ⌘R shows it without
  // quitting and reopening the app.
  ...(app.isPackaged ? [] : [{
    label: 'View',
    submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }]
  }]), {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'close' }]
  }, {
    // Where a Mac user looks for the manual first. It's the same one as
    // 📖 in settings, in whichever language the app is in.
    role: 'help',
    submenu: [{
      label: 'R2FEL HamLog Help',
      accelerator: 'F1',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.executeJavaScript("document.getElementById('help-open').click()");
      }
    }]
  }] : [];
  // Windows: no menu bar at all. Everything is on the page itself (⚙, 📖,
  // F1), copy and paste work in the fields without one, and removing the
  // app is Windows' own job (Settings → Apps). No menu also means no
  // Ctrl+R / Ctrl+plus to reload or rescale the page by accident.
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate(template) : null);
  // About R2FEL HamLog: the name the program shows, not its file's.
  if (isMac) {
    app.setAboutPanelOptions({
      applicationName: 'R2FEL HamLog',
      applicationVersion: app.getVersion(),
      copyright: 'Aleksei Aleksandrov · R2FEL'
    });
  }
}

// Electron denies every permission request by default — unlike a browser,
// there's no built-in prompt. The 📍 button's whole feature (MY GRID / MY
// RDA from the OS's own location) is silently broken without this: geolocation
// is the one permission the app actually uses, and only when that button is
// clicked, so it's safe to allow outright rather than build a prompt of our own.
function allowGeolocation() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation');
  });
}

// That covers the page; the app itself still needs macOS's own permission.
// The 📍 button asks for it here first (through electron-preload.js), so a
// fresh install gets the usual "Allow R2FEL-LOG to use your location?"
// prompt instead of an error.
function handleLocationAccess() {
  ipcMain.handle('location-access', async () => {
    if (!locationAccess) return 'unknown';
    let status = locationAccess.status();
    if (status !== 'not-determined') return status;

    // The prompt is up now. Wait for the click — or, left unanswered for
    // two minutes, report that, and the page asks to try again.
    locationAccess.request();
    const giveUpAt = Date.now() + 2 * 60 * 1000;
    while (status === 'not-determined' && Date.now() < giveUpAt) {
      await new Promise(resolve => setTimeout(resolve, 300));
      status = locationAccess.status();
    }
    return status;
  });

  // ⚙ → DEBUG LOG: a copy of the log to send, or the file itself.
  ipcMain.handle('log-save', async ev => {
    const file = debugLog.logFile();
    if (!file) return null;
    const day = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(ev.sender), {
      defaultPath: path.join(app.getPath('desktop'), `R2FEL-HamLog-debug-log-${day}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }]
    });
    if (canceled || !filePath) return null;
    fs.copyFileSync(file, filePath);
    console.log(`[app] debug log saved to ${filePath}`);
    return filePath;
  });
  const savedFiles = new Set();
  // A file the page made (export, the one for HAMLOG): saved where the user says,
  // and the page told whether it was — only a saved file marks contacts sent.
  ipcMain.handle('file-save', async (ev, name, bytes) => {
    const base = path.basename(String(name || 'file.adi')).replace(/[^\w.@+-]/g, '_') || 'file.adi';
    if (!(bytes instanceof Uint8Array) || bytes.length > 64 * 1024 * 1024) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(ev.sender), {
      defaultPath: path.join(app.getPath('desktop'), base),
      filters: [{ name: 'ADIF', extensions: ['adi'] }]
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, Buffer.from(bytes));
    savedFiles.add(filePath);
    console.log(`[app] file saved: ${filePath}`);
    return filePath;
  });
  // SHOW THE FILE on the result page: Finder / Explorer at it — only a file
  // saved above, never any path the page might name.
  ipcMain.handle('file-show', (ev, filePath) => {
    if (savedFiles.has(filePath)) shell.showItemInFolder(filePath);
  });
  ipcMain.handle('log-show', () => {
    const file = debugLog.logFile();
    if (file) shell.showItemInFolder(file);
    return file;
  });

  // Once refused, the system never prompts again: the only way back is the
  // switch in its settings, so the page opens it right there.
  ipcMain.handle('open-location-settings', () => shell.openExternal(IS_WINDOWS
    ? 'ms-settings:privacy-location'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices'));
}

app.whenReady().then(() => {
  // The installed app's Dock icon is its own (build/icon.icns); only the dev
  // copy, which would otherwise show Electron's, is given ours — the same
  // tile with see-through corners, never the square web icon.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, 'public', 'icons', 'app-icon.png'));
  }
  allowGeolocation();
  handleLocationAccess();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The shortcut double-clicked again while the app is open: bring its
// window forward (see requestSingleInstanceLock at the top).
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
