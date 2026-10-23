const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-viewc-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4197'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
app.on('window-all-closed', () => {});
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => app.exit(1), 90000);
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  await wait(3500);
  const js = (w, s) => w.webContents.executeJavaScript(s);
  const info = () => BrowserWindow.getAllWindows().map(w => `${w === win ? 'MAIN' : 'child'}:${w.webContents.getURL().replace(/^.*4197/, '')}`);
  console.log('start', info());
  await js(win, `document.getElementById('qso-dx-btn').click(); 0`); await wait(2500);
  console.log('after DX click', info());
  const dx = BrowserWindow.getAllWindows().find(w => /view=dx/.test(w.webContents.getURL()));
  console.log('dx page', dx && await js(dx, `JSON.stringify({cls: document.documentElement.className.split(' ').filter(c => /view|is-view/.test(c)), blockShown: !document.getElementById('qso-dx-view').hidden, title: document.title})`));
  console.log('dx parent is main', dx && dx.getParentWindow() === win);
  console.log('btn on', await js(win, `document.getElementById('qso-dx-btn').classList.contains('is-on')`));
  await js(win, `document.getElementById('qso-cw-btn').click(); 0`); await wait(2500);
  const cw = BrowserWindow.getAllWindows().find(w => /view=cw/.test(w.webContents.getURL()));
  console.log('cw page', cw && await js(cw, `JSON.stringify({blockShown: !document.getElementById('qso-cw-view').hidden, title: document.title})`));
  // the form's state reaches the window
  await js(win, `(() => { const f = document.getElementById('f-callsign'); f.value = 'K1TEST'; f.dispatchEvent(new Event('input')); 0; })()`); await wait(8000);
  console.log('spot call prefilled', dx && await js(dx, `document.getElementById('dx-spot-call').value`));
  // closing by hand → the button follows
  dx.close(); await wait(1200);
  console.log('after closing dx', info(), 'btn on', await js(win, `document.getElementById('qso-dx-btn').classList.contains('is-on')`));
  console.log('main errors?', await js(win, `document.getElementById('qso-root') ? 'ok' : 'none'`));
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
