const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-bigc-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4198'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => app.exit(1), 120000);
const rows = [
  ['7P8GE','2026-10-21','14:27','15m','Kindom of Lesotho DX','Nazareth, Maseru',{}],
  ['W1MLT','2026-10-21','14:13','15m','Manuel L Troncoso','Lawrence',{lotwRcvd:'Y'}],
  ['GI3PXT','2026-10-21','14:04','15m','gordon higgins','artigarvan CO tyrone',{eqslRcvd:'Y'}],
  ['DS2MGT','2026-10-21','13:42','30m','TAE HAK Jang','Goyang-si; Gyunggi-do',{lotwRcvd:'Y'}],
  ['RC9WC','2026-10-21','13:41','30m','Evgeniy Konstantinov','с. Павловка, Нуримановский р-н',{eqslRcvd:'Y'}],
  ['OZ9FF','2026-10-21','13:40','30m','','',{lotwRcvd:'Y',eqslRcvd:'Y'}],
  ['OE8PPL','2026-10-21','08:17','17m','','',{myCallsign:'UB2FEJ'}],
  ['UA3XYZ','2026-10-21','08:10','40m','Иван','Москва',{myCallsign:''}],
  ['RA1AA','2026-10-21','08:05','40m','Пётр','Санкт-Петербург',{myCallsign:'R2ST/P'}],
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
  const theme = process.env.THEME || 'light';
  await js(`(async () => { const st = JSON.parse(localStorage.getItem('qso-station') || '{}');
    Object.assign(st, { callsign: 'R2ST', qth: 'KO94AA', rda: 'MO-07', ruPhonetics: true, updateCheck: false, theme: '${theme}', spaceShown: true, mode: 'FT8', band: '15m' }); localStorage.setItem('qso-station', JSON.stringify(st));
    const db = await new Promise(r => { const q = indexedDB.open('qso-log'); q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction('qsos','readwrite'); const s = t.objectStore('qsos'); ${JSON.stringify(rows)}.forEach(x => s.put(x)); t.oncomplete = r; }); 0; })()`);
  const W = Number(process.env.W), H = Number(process.env.H);
  win.setContentSize(W, H);
  win.webContents.reload(); await wait(5000);
  await js(`(() => { const b = document.getElementById('qso-log-toggle'); if (b && !document.getElementById('qso-log-panel').offsetHeight) b.click(); 0; })()`); await wait(800);
  const shoot = async (name) => { await wait(1200); fs.writeFileSync(path.join(process.env.OUT, `${process.env.TAG}-${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const measure = () => js(`JSON.stringify([...document.querySelectorAll('#qso-tbody td.qso-call')].map(td => { const t = td.querySelector('.qso-them'); const r = t.getBoundingClientRect(), d = td.getBoundingClientRect(); return td.innerText + (r.right <= d.right - 2 ? '' : ' CUT'); }))`);
  const qsl = () => js(`JSON.stringify([...document.querySelectorAll('#qso-tbody td.qso-qsl-cell')].slice(0,1).map(td => Math.round(td.getBoundingClientRect().right - td.querySelector('.qso-qsl').getBoundingClientRect().right)))`);
  const head = () => js(`(() => { const a = document.getElementById('qso-space-btn').getBoundingClientRect(), s = document.getElementById('qso-subtitle').getBoundingClientRect(); return 'space.right ' + Math.round(a.right) + ' subtitle.left ' + Math.round(s.left) + ' lines ' + Math.round(s.height); })()`);
  console.log('normal', await measure(), await qsl(), await head()); await shoot('1-normal');
  await js(`document.getElementById('big-switch').click(); 0`);
  console.log('big', await measure(), await qsl(), await head()); await shoot('2-big');
  await js(`(() => { const st = JSON.parse(localStorage.getItem('qso-station')); 0; })()`);
  await js(`(() => { document.getElementById('qso-cols-btn').click(); document.querySelector('#qso-cols-menu [data-col="mycall"]').click(); document.body.click(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); 0; })()`);
  console.log('big+mycall', await measure(), await js(`JSON.stringify([...document.querySelectorAll('#qso-tbody td.qso-mycall')].map(td=>td.innerText))`)); await shoot('3-big-mycall');
  await js(`document.getElementById('big-switch').click(); 0`);
  console.log('normal+mycall', await measure()); await shoot('4-normal-mycall');
  console.log('saved', await js(`JSON.stringify({big: JSON.parse(localStorage.getItem('qso-station')).bigView, cols: JSON.parse(localStorage.getItem('qso-station')).logColumns})`));
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
