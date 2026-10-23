const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const UD = path.join(os.tmpdir(), 'r2fel-e22b-user');
app.setPath('userData', UD);
process.env.PORT = '4192';
process.env.QSO_DATA_DIR = path.join(os.tmpdir(), 'r2fel-e22b-data');
require(process.env.PROJECT + '/server.js');
app.on('window-all-closed', () => {});
const PHASE = process.env.PHASE;
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) errors.push(msg + ' @' + line); });
  await wait(800);
  await win.loadURL('http://127.0.0.1:4192/');
  await wait(2500);
  const js = s => win.webContents.executeJavaScript(s);
  const lib = `
    window.__db = () => new Promise((res, rej) => { const r = indexedDB.open('qso-log'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    window.__all = async () => { const db = await __db(); return new Promise(res => { const q = db.transaction('qsos').objectStore('qsos').getAll(); q.onsuccess = () => { db.close(); res(q.result); }; }); };
    window.__put = async (list) => { const db = await __db(); return new Promise(res => { const t = db.transaction('qsos','readwrite'); const s = t.objectStore('qsos'); list.forEach(x => s.put(x)); t.oncomplete = () => { db.close(); res(list.length); }; }); };
    window.__sum = async () => { const a = await __all(); const c = {}; a.forEach(e => { const k = e.band || '(none)'; c[k] = (c[k]||0)+1; }); return c; }; 0;`;
  await js(lib);
  const out = { phase: PHASE, chrome: process.versions.chrome };
  const base = (id, call, band, freq, freqHz, time) => ({ id, myCallsign: 'R2ST', callsign: call, name: '', country: '', grid: '', rda: '', pota: '', myPota: '', qth: '', band, freq, freqHz, mode: 'FT8', date: '2021-12-14', time, rstSent: '', rstRcvd: '', nrSent: '', nrRcvd: '', notes: '', email: '', source: 'adif', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z' });
  if (PHASE === 'seed') {
    // 1.0.50 state: band empty, whole MHz as frequency; 1.0.51 state: band wiped; a healthy 17m entry with no frequency; two band-less in one minute
    await js(`__put(${JSON.stringify([
      base('a1', 'DL1AAA', '', '18 000.0', 18000000, '12:00'),
      base('a2', 'DL1BBB', '', '10 000.0', 10000000, '12:01'),
      base('a3', 'DL1CCC', '', '24 000.0', 24000000, '12:02'),
      base('b1', 'DL1DDD', '', '', null, '12:03'),
      base('c1', 'DL1EEE', '17m', '', null, '12:04'),
      base('d1', 'DL1FFF', '', '', null, '12:05'),
      base('d2', 'DL1FFF', '', '', null, '12:05')
    ])})`);
    out.seeded = await js('__sum()');
  } else {
    out.sum = await js('__sum()');
    out.freq = await js('__all().then(a => a.map(e => e.callsign + ":" + e.band + ":" + e.freqHz))');
    if (PHASE === 'import') {
      const adif = [
        '<ADIF_VER:5>3.1.0 <EOH>',
        '<CALL:6>DL1DDD <QSO_DATE:8>20211214 <TIME_ON:4>1203 <BAND:3>17M <FREQ:2>18 <MODE:3>FT8 <STATION_CALLSIGN:4>R2ST <EOR>',
        '<CALL:6>DL1FFF <QSO_DATE:8>20211214 <TIME_ON:4>1205 <BAND:3>17M <FREQ:2>18 <MODE:3>FT8 <STATION_CALLSIGN:4>R2ST <EOR>',
        '<CALL:6>DL1FFF <QSO_DATE:8>20211214 <TIME_ON:4>1205 <BAND:3>30M <FREQ:2>10 <MODE:3>FT8 <STATION_CALLSIGN:4>R2ST <EOR>',
        '<CALL:6>DL1EEE <QSO_DATE:8>20211214 <TIME_ON:4>1204 <BAND:3>17M <FREQ:2>18 <MODE:3>FT8 <STATION_CALLSIGN:4>R2ST <EOR>'
      ].join('\n').replace(/<CALL:6>/g, m => m); // lengths below are fixed by builder
      out.imp = await js(`(async () => {
        const rec = (call, time, band, mhz) => '<CALL:' + call.length + '>' + call + ' <QSO_DATE:8>20211214 <TIME_ON:4>' + time + ' <BAND:' + band.length + '>' + band + ' <FREQ:' + mhz.length + '>' + mhz + ' <MODE:3>FT8 <STATION_CALLSIGN:4>R2ST <EOR>';
        const txt = '<ADIF_VER:5>3.1.0 <EOH>\\n' + [rec('DL1DDD','1203','17M','18'), rec('DL1FFF','1205','17M','18'), rec('DL1FFF','1205','30M','10'), rec('DL1EEE','1204','17M','18'), rec('DL1AAA','1200','17M','18')].join('\\n');
        const f = new File([txt], 'u.adi', { type: 'text/plain' });
        const dt = new DataTransfer(); dt.items.add(f);
        const inp = document.getElementById('imp-file'); inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 2500));
        const info = document.getElementById('imp-file-sub').textContent + ' | ' + document.getElementById('imp-new').textContent + ' | ' + document.getElementById('imp-old').textContent;
        document.getElementById('imp-go').click();
        await new Promise(r => setTimeout(r, 3000));
        return info;
      })()`);
      out.after = await js('__sum()');
      out.freqAfter = await js('__all().then(a => a.map(e => e.callsign + ":" + e.band + ":" + e.freqHz))');
    }
  }
  out.errors = errors;
  console.log('RESULT ' + JSON.stringify(out));
  setTimeout(() => app.exit(0), 600);
});
