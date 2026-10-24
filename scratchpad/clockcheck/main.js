const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-ck-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4199'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
app.on('window-all-closed', () => {});
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => app.exit(1), 90000);
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  await wait(3500);
  for (const theme of ['', 'mono', 'light']) {
    for (const W of [900, 870, 860]) {
      win.setContentSize(W, 700); await wait(900);
      await win.webContents.executeJavaScript(`(function(){document.querySelectorAll('.qso-overlay').forEach(function(o){o.hidden=true});var r=document.getElementById('qso-root');r.classList.remove('is-mono','is-light');${theme?`r.classList.add('is-${theme}')`:''};0})()`);
      await wait(400);
      const info = await win.webContents.executeJavaScript(`(function(){var q=s=>document.querySelector(s).getBoundingClientRect();var u=q('#qso-utc'),m=q('.qso-mark'),a=q('.qso-plate-actions'),sp=q('#qso-space-btn');return JSON.stringify({clock:[u.left|0,u.right|0,u.top|0,u.bottom|0],mark:[m.left|0,m.right|0],actions:[a.left|0,a.right|0,a.top|0,a.bottom|0],space:[sp.left|0,sp.right|0],docW:document.documentElement.scrollWidth})})()`);
      console.log(theme||'amber', W, info);
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: 120 });
      fs.writeFileSync(path.join(process.env.OUT, `h-${theme||'amber'}-${W}.png`), img.toPNG());
    }
  }
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
