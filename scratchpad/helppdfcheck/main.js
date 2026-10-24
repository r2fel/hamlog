const { app, BrowserWindow, dialog } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-hp-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4198'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'manual.pdf');
dialog.showSaveDialog = async (w, o) => { console.log('dialog default:', path.basename(o.defaultPath), JSON.stringify(o.filters)); return { canceled: false, filePath: OUT }; };
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
app.on('window-all-closed', () => {});
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => app.exit(1), 120000);
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  await wait(3500);
  for (const lang of ['ru', 'en']) {
    const r = await win.webContents.executeJavaScript(`window.desktopApp.helpPdf('${lang}')`);
    const st = fs.existsSync(OUT) ? fs.statSync(OUT).size : 0;
    console.log(lang, 'result', r, 'size', st, 'windows left', BrowserWindow.getAllWindows().length);
    if (st) { const head = fs.readFileSync(OUT).slice(0, 5).toString(); console.log('header', head); fs.copyFileSync(OUT, path.join(process.env.KEEP, lang + '.pdf')); fs.unlinkSync(OUT); }
  }
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
