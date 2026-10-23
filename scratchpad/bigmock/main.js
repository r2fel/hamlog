const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-big-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4198'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const css = fs.readFileSync(path.join(__dirname, 'big.css'), 'utf8');
setTimeout(() => app.exit(1), 120000);
const rows = [
  ['7P8GE','2026-10-21','14:27','15m','Kindom of Lesotho DX','Nazareth, Maseru',{}],
  ['W1MLT','2026-10-21','14:13','15m','Manuel L Troncoso','Lawrence',{lotwRcvd:'Y'}],
  ['GI3PXT','2026-10-21','14:04','15m','gordon higgins','artigarvan CO tyrone',{eqslRcvd:'Y'}],
  ['DS2MGT','2026-10-21','13:42','30m','TAE HAK Jang','Goyang-si; Gyunggi-do',{lotwRcvd:'Y'}],
  ['RC9WC','2026-10-21','13:41','30m','Evgeniy Konstantinov','с. Павловка, Нуримановский р-н',{eqslRcvd:'Y'}],
  ['OZ9FF','2026-10-21','13:40','30m','','',{lotwRcvd:'Y',eqslRcvd:'Y'}],
  ['OE8PPL','2026-10-21','08:17','17m','','',{}],
  ['AL7MJ','2026-10-21','06:19','20m','DANIEL L BUCHHOLZ','Fairbanks',{lotwRcvd:'Y'}],
  ['C5R','2026-10-21','04:50','20m','Ljubisa Petrovic','Kololi - Banjul',{}],
  ['AK4KZ','2026-10-20','12:54','15m','Christopher','Ladson',{lotwRcvd:'Y'}],
  ['DA6WM','2026-10-20','12:46','15m','Matthias','Leipzig',{eqslRcvd:'Y'}],
  ['KR4MGG','2026-10-20','12:46','15m','Ernest','Knoxville',{}],
  ['EA7Z','2026-10-20','11:58','20m','Jose Antonio','Malaga',{lotwRcvd:'Y'}],
  ['UA9SY','2026-10-20','11:30','20m','Владимир','Оренбург',{}]
].map((r, i) => Object.assign({ id: 'm' + i, callsign: r[0], myCallsign: 'R2ST', date: r[1], time: r[2], band: r[3], mode: 'FT8', name: r[4], qth: r[5], country: '', rstSent: '-10', rstRcvd: '-12', freq: '', freqHz: null,
  lotwSent: 'Y', eqslSent: 'Y', hamlogSent: 'Y', srrSent: 'Y', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }, r[6]));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  await wait(3500);
  const js = s => win.webContents.executeJavaScript(s);
  await js(`(async () => { const st = JSON.parse(localStorage.getItem('qso-station') || '{}');
    Object.assign(st, { callsign: 'R2ST', qth: 'KO94AA', rda: 'MO-07', ruPhonetics: true, updateCheck: false, theme: 'light', spaceShown: true, mode: 'FT8', band: '15m', logColumns: ['pick','date','time','call','name','qth','band','qsl','del'] }); localStorage.setItem('qso-log-row', String(Number(${process.env.LOGROW || 0}))); localStorage.setItem('qso-station', JSON.stringify(st));
    const db = await new Promise(r => { const q = indexedDB.open('qso-log'); q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction('qsos','readwrite'); const s = t.objectStore('qsos'); ${JSON.stringify(rows)}.forEach(x => s.put(x)); t.oncomplete = r; }); 0; })()`);
  const W = Number(process.env.W), H = Number(process.env.H);
  win.setContentSize(W, H);
  win.webContents.reload(); await wait(5000); if (process.env.OPENLOG) { await js(`(() => { const b = document.getElementById('qso-log-toggle'); if (b && !document.getElementById('qso-log-panel').offsetHeight) b.click(); 0; })()`); await wait(800); }
  const shoot = async (name, big, zoom) => {
    win.webContents.setZoomFactor(zoom);
    await js(`(() => { let s = document.getElementById('big-mock'); if (!s) { s = document.createElement('style'); s.id = 'big-mock'; document.head.appendChild(s); }
      s.textContent = ${JSON.stringify(css)}; document.getElementById('qso-root').classList.toggle('is-big', ${big}); window.dispatchEvent(new Event('resize')); 0; })()`);
    await wait(1500);
    fs.writeFileSync(path.join(process.env.OUT, name), (await win.webContents.capturePage()).toPNG());
  };
  await shoot(process.env.TAG + '-1-now.png', false, 1);
  await shoot(process.env.TAG + '-2-big.png', true, Number(process.env.Z));
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
