const { app, BrowserWindow } = require('electron');
const path = require('path');
process.env.PORT = '4191';
process.env.QSO_DATA_DIR = path.join(require('os').tmpdir(), 'r2fel-e22-data');
require(process.env.PROJECT + '/server.js');
const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1700, height: 950, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) errors.push(`${msg} @ ${src}:${line}`); });
  await wait(800);
  console.log('STEP load'); await win.loadURL('http://127.0.0.1:4191/?cwtest').catch(e => console.log('LOADERR', e.message)); console.log('STEP loaded');
  await wait(1500);
  const js = s => win.webContents.executeJavaScript(s);
  const out = { chrome: process.versions.chrome };
  out.wide = await js(`(() => { const $ = id => document.getElementById(id);
    $('qso-dx-btn').click();
    return { themeBtn: !!$('qso-theme-btn'), cwParent: $('qso-cw-view').parentElement.id, dxParent: $('qso-dx-view').parentElement.id,
      cwBarLast: $('qso-cw-view').lastElementChild.id, dxOpen: !$('qso-dx-view').hidden }; })()`);
  out.text = await js(`new Promise(done => {
    const M = { C:'-.-.', Q:'--.-', D:'-..', E:'.', R:'.-.', '2':'..---', F:'..-.', L:'.-..', K:'-.-', T:'-', S:'...', N:'-.', A:'.-', M:'--', I:'..', O:'---', P:'.--.', X:'-..-', '5':'.....', '9':'----.', U:'..-', H:'....', W:'.--', B:'-...', Y:'-.--', G:'--.', V:'...-' };
    const rate = 44100, unit = 0.06, tone = 700, msg = 'CQ CQ DE R2FEL R2FEL K   TNX FER CALL UR RST 599 5NN NAME ALEX OP ALEX K';
    const parts = []; let t = 0.8;
    for (const w of msg.split(' ')) { if (!w) { t += 4 * unit; continue; } for (const ch of w) { for (const s of M[ch]) { const d = (s === '.' ? 1 : 3) * unit; parts.push([t, d]); t += d + unit; } t += 2 * unit; } t += 4 * unit; }
    t += 2;
    const n = Math.round(t * rate), x = new Float32Array(n);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) x[i] = (rnd() - 0.5) * 0.05;
    for (const [s, d] of parts) { const a = Math.round(s * rate), b = Math.round((s + d) * rate); for (let i = a; i < b; i++) x[i] += 0.3 * Math.sin(2 * Math.PI * tone * i / rate) * Math.min(1, (i - a) / 200, (b - i) / 200); }
    window.cwTest.softFeed(x, rate);
    let last = '', still = 0;
    const tick = setInterval(() => { const s = document.getElementById('cw-text').innerText.replace(/\\s+/g, ' ').trim(); if (s && s === last) still++; else still = 0; last = s; if (still >= 6) { clearInterval(tick); done(s); } }, 500);
    setTimeout(() => { clearInterval(tick); done(last || '(empty)'); }, 40000);
  })`);
  win.setSize(1200, 950); await wait(800);
  out.narrow = await js(`(() => { const $ = id => document.getElementById(id); return { cwParent: $('qso-cw-view').parentElement.className, cwBarFirst: $('qso-cw-view').firstElementChild.id, dxBarFirst: $('qso-dx-view').firstElementChild.id, top: $('qso-cw-drag').classList.contains('is-top') }; })()`);
  out.errors = errors;
  console.log('RESULT ' + JSON.stringify(out, null, 1));
  app.exit(0);
});
