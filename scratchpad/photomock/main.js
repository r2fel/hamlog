// Макет «фото корреспондента»: настоящая программа, ответы справочника
// подставные (станции *TEST), фото — рисованные портреты (чужих лиц не берём).
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fel-photo-'));
app.setPath('userData', path.join(ROOT, 'user')); app.setPath('logs', path.join(ROOT, 'logs'));
process.env.PORT = '4197'; process.env.QSO_DATA_DIR = path.join(ROOT, 'data');
app.on('browser-window-created', (e, w) => { w.show = () => {}; w.showInactive = () => {}; w.focus = () => {}; w.setFullScreen = () => {}; w.maximize = () => {}; });
if (app.dock) app.dock.hide();
require(path.join(process.env.PROJECT, 'electron-main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.env.OUT;
setTimeout(() => app.exit(1), 150000);

// Рисованный портрет: фон, плечи, голова, волосы, наушники с микрофоном.
function portrait({ bg1, bg2, shirt, skin, hair, beard, glasses, cap }) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <rect x="120" y="22" width="64" height="40" rx="4" fill="#00000030"/><circle cx="140" cy="42" r="9" fill="#ffffff26"/><rect x="155" y="34" width="22" height="4" fill="#ffffff30"/><rect x="155" y="44" width="16" height="4" fill="#ffffff24"/>
  <path d="M28 200 C34 150 62 136 100 136 C138 136 166 150 172 200 Z" fill="${shirt}"/>
  <rect x="88" y="112" width="24" height="30" rx="8" fill="${skin}"/>
  <ellipse cx="100" cy="88" rx="33" ry="39" fill="${skin}"/>
  ${beard ? `<path d="M68 92 C70 125 86 132 100 132 C114 132 130 125 132 92 C126 108 114 112 100 112 C86 112 74 108 68 92 Z" fill="${hair}"/>` : ''}
  ${cap ? `<path d="M64 76 C64 50 80 40 100 40 C120 40 136 50 136 76 Z" fill="${cap}"/><rect x="60" y="70" width="80" height="8" rx="4" fill="${cap}"/>`
        : `<path d="M66 82 C62 52 82 42 100 42 C120 42 140 52 134 82 C128 66 116 60 100 60 C84 60 72 66 66 82 Z" fill="${hair}"/>`}
  ${glasses ? `<circle cx="87" cy="88" r="9" fill="none" stroke="#222" stroke-width="2.5"/><circle cx="113" cy="88" r="9" fill="none" stroke="#222" stroke-width="2.5"/><line x1="96" y1="88" x2="104" y2="88" stroke="#222" stroke-width="2.5"/>`
            : `<circle cx="87" cy="88" r="2.6" fill="#2a2420"/><circle cx="113" cy="88" r="2.6" fill="#2a2420"/>`}
  <path d="M90 108 Q100 114 110 108" fill="none" stroke="#6b3b2c" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M62 86 C62 40 138 40 138 86" fill="none" stroke="#2b2b2b" stroke-width="7"/>
  <rect x="54" y="78" width="16" height="26" rx="6" fill="#333"/><rect x="130" y="78" width="16" height="26" rx="6" fill="#333"/>
  <path d="M62 100 C66 118 78 122 92 120" fill="none" stroke="#333" stroke-width="3.5"/><circle cx="93" cy="120" r="4.5" fill="#222"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
}
function qsl(call, { bg1, bg2, sky }, face) {
  const inner = Buffer.from(face.split(',')[1], 'base64').toString().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <defs><linearGradient id="q" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="300" height="200" fill="url(#q)"/>
  <path d="M0 150 L30 120 L50 135 L80 100 L110 130 L140 110 L170 140 L300 125 L300 200 L0 200 Z" fill="${bg1}" opacity=".8"/>
  <text x="18" y="70" font-family="Arial Black,Arial" font-weight="900" font-size="44" fill="#fff" stroke="#00000055" stroke-width="2">${call}</text>
  <text x="20" y="92" font-family="Arial" font-size="12" fill="#ffffffcc">73 &amp; GOOD DX</text>
  <rect x="18" y="160" width="150" height="26" rx="3" fill="#ffffffd9"/><text x="24" y="177" font-family="Arial" font-size="9" fill="#333">TO RADIO   UTC   BAND   MODE   RST</text>
  <svg x="180" y="60" width="140" height="140" viewBox="0 0 200 200">${inner}</svg></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
}
const PHOTOS = {
  R3TEST: portrait({ bg1: '#5b6b7a', bg2: '#2e3a46', shirt: '#3f5a73', skin: '#e2b896', hair: '#6e5a48', beard: false, glasses: false }),
  DL1TEST: portrait({ bg1: '#7a6a52', bg2: '#3a3026', shirt: '#6b7d4f', skin: '#efc6a8', hair: '#c9b48a', beard: true, glasses: true }),
  EW1TEST: portrait({ bg1: '#4f6d5e', bg2: '#25352e', shirt: '#8a4f3f', skin: '#d9a885', hair: '#2f2a26', beard: false, glasses: false, cap: '#2f4a6b' })
};
PHOTOS.R3TEST_QSL = qsl('R3TEST', { bg1: '#2f4a3a', bg2: '#1e2c38', sky: '#d98a4a' }, PHOTOS.R3TEST);
PHOTOS.DL1TEST_QSL = qsl('DL1TEST', { bg1: '#4a3a2a', bg2: '#202833', sky: '#5d86b3' }, PHOTOS.DL1TEST);
PHOTOS.EW1TEST_QSL = qsl('EW1TEST', { bg1: '#3a4a2a', bg2: '#22301f', sky: '#9fb46a' }, PHOTOS.EW1TEST);
const STATIONS = {
  R3TEST: { source: 'qrz.ru', callsign: 'R3TEST', name: 'Ivan Petrov', nameLocal: 'Иван Петров', country: 'Россия', city: 'Тула', grid: 'KO84te', rda: 'TL-01' },
  DL1TEST: { source: 'qrz.com', callsign: 'DL1TEST', name: 'Hans Becker', country: 'Germany', city: 'Berlin', grid: 'JO62qm' },
  EW1TEST: { source: 'qrz.ru', callsign: 'EW1TEST', name: 'Andrei Kovalchuk', nameLocal: 'Андрей Ковальчук', country: 'Беларусь', city: 'Минск', grid: 'KO33sv' },
  K1TEST: { source: 'qrz.com', callsign: 'K1TEST', name: 'John Carter', country: 'United States', city: 'Boston, MA', grid: 'FN42li' }
};
const LOG = [
  ['2026-10-18', '18:05', 'DL1TEST', 'Hans Becker', 'Berlin', '20m'],
  ['2026-10-16', '09:41', 'EW1TEST', 'Андрей Ковальчук', 'Минск', '40m'],
  ['2026-10-12', '21:17', 'K1TEST', 'John Carter', 'Boston, MA', '20m'],
  ['2026-10-09', '14:22', 'R3TEST', 'Иван Петров', 'Тула', '40m']
].map(([date, time, callsign, name, qth, band], i) => ({ id: 'p' + i, callsign, myCallsign: 'R2FEL', date, time, band, mode: 'SSB', name, qth,
  country: '', rstSent: '59', rstRcvd: '59', freq: '', freqHz: null, createdAt: date + 'T' + time + ':00Z', updatedAt: date + 'T' + time + ':00Z', lotwSent: 'Y' }));

const CSS = `
#qso-root .mk-thumb { position:absolute; left:0; top:2px; width:132px; height:88px; cursor:zoom-in; }
#qso-root .mk-thumb img { width:132px; height:88px; object-fit:cover; border-radius:var(--radius-m); border:1px solid var(--line); display:block; }
#qso-root .mk-count { position:absolute; right:5px; bottom:5px; background:rgba(20,19,15,.82); color:#ece7d8; font:600 12px 'IBM Plex Mono',monospace; padding:2px 6px; border-radius:999px; }
#qso-root .mk-arr { position:absolute; top:50%; transform:translateY(-50%); width:22px; height:22px; border-radius:50%; background:rgba(20,19,15,.75); color:#ece7d8; font:700 15px/22px sans-serif; text-align:center; }
#qso-root #f-corr .qso-corr-body.mk-has2 { position:relative; padding-left:150px; min-height:92px; }
#qso-root .mk-mini { width:45px; height:30px; border-radius:4px; object-fit:cover; border:1px solid var(--line); flex:none; margin-right:8px; cursor:zoom-in; }
.mk-view { position:fixed; inset:0; z-index:9999; background:rgba(14,13,11,.86); display:flex; align-items:center; justify-content:center; }
.mk-view-card { position:relative; background:#26241f; border:1px solid #443f37; border-radius:14px; padding:16px 16px 14px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.mk-view-card > img.big { display:block; width:600px; height:400px; border-radius:8px; }
.mk-view-nav { position:absolute; top:216px; width:44px; height:44px; border-radius:50%; background:rgba(20,19,15,.8); border:1px solid #443f37; color:#ece7d8; font:700 26px/42px sans-serif; text-align:center; }
.mk-strip { display:flex; gap:8px; margin-top:12px; }
.mk-strip img { width:66px; height:44px; object-fit:cover; border-radius:4px; border:2px solid transparent; opacity:.6; }
.mk-strip img.on { border-color:#e8a23d; opacity:1; }
.mk-strip .main { position:relative; }
.mk-view-cap { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-top:12px; color:#ece7d8; }
.mk-view-cap b { font:700 22px 'IBM Plex Mono',monospace; letter-spacing:.06em; }
.mk-view-cap .who { font:18px 'Roboto Condensed',sans-serif; }
.mk-view-cap .btn { font:600 14px 'Barlow Condensed',sans-serif; letter-spacing:.08em; color:#e8a23d; border:1px solid #a97a3a; border-radius:4px; padding:6px 12px; }
.mk-view-foot { display:flex; justify-content:space-between; margin-top:8px; font:13px -apple-system,system-ui,sans-serif; color:#9c9587; }

#qso-root .mk-photo { position:absolute; left:0; top:2px; width:88px; height:88px; border-radius:var(--radius-m);
  border:1px solid var(--line); object-fit:cover; cursor:zoom-in; box-shadow:0 1px 0 rgba(0,0,0,.3); }
#qso-root #f-corr .qso-corr-body.mk-has { position:relative; padding-left:104px; min-height:92px; }
#qso-root .mk-dot { width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid var(--line);
  flex:none; margin-right:8px; vertical-align:middle; cursor:zoom-in; }
#qso-root .qso-group-line1 { display:flex; align-items:center; }
.mk-zoom { position:fixed; inset:0; z-index:9999; background:rgba(14,13,11,.82); display:flex; align-items:center; justify-content:center; }
.mk-zoom-card { background:var(--panel, #26241f); border:1px solid #443f37; border-radius:14px; padding:14px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.mk-zoom-card img { display:block; width:380px; height:380px; border-radius:8px; }
.mk-zoom-cap { display:flex; justify-content:space-between; align-items:baseline; gap:20px; margin-top:12px; font-family:'IBM Plex Mono',monospace; color:#ece7d8; }
.mk-zoom-cap b { font-size:22px; letter-spacing:.06em; }
.mk-zoom-cap span { font-family:'Roboto Condensed',sans-serif; font-size:18px; color:#ece7d8; }
.mk-zoom-foot { margin-top:6px; font:13px -apple-system,system-ui,sans-serif; color:#9c9587; display:flex; justify-content:space-between; }
.mk-pop { position:fixed; z-index:9999; background:#26241f; border:1px solid #443f37; border-radius:8px; padding:8px; display:flex; gap:10px; align-items:center;
  box-shadow:0 10px 30px rgba(0,0,0,.45); font-family:'Roboto Condensed',sans-serif; color:#ece7d8; }
.mk-pop img { width:72px; height:72px; border-radius:6px; }
.mk-pop b { font-family:'IBM Plex Mono',monospace; letter-spacing:.06em; display:block; }
.mk-pop small { color:#9c9587; font-size:13px; }
`;

app.whenReady().then(async () => {
  let win; for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  await wait(3500);
  const js = s => win.webContents.executeJavaScript(s);
  await js(`(async () => { const st = JSON.parse(localStorage.getItem('qso-station') || '{}');
    Object.assign(st, { callsign: 'R2FEL', qth: 'KO04FR', rda: 'KA-05', ruPhonetics: true, showPhonetics: true, updateCheck: false, mode: 'SSB', band: '40m', spaceShown: false });
    localStorage.setItem('qso-station', JSON.stringify(st));
    const db = await new Promise(r => { const q = indexedDB.open('qso-log'); q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction('qsos','readwrite'); const s = t.objectStore('qsos'); ${JSON.stringify(LOG)}.forEach(x => s.put(x)); t.oncomplete = r; }); 0; })()`);
  win.setContentSize(932, 1700);
  win.webContents.reload(); await wait(5000);
  // подставной справочник и погода
  await js(`(() => { const ST = ${JSON.stringify(STATIONS)}; const real = window.fetch.bind(window);
    const reply = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (url, opts) => { const u = typeof url === 'string' ? url : url.url; const b = opts && opts.body ? JSON.parse(opts.body) : {};
      if (u === '/api/lookup') { await new Promise(r => setTimeout(r, 150)); const rec = ST[String(b.callsign || '').toUpperCase()];
        return reply(rec ? Object.assign({ source: 'qrz.ru + hamqth' }, rec) : { error: 'Callsign not found', errorCode: '404' }); }
      if (u === '/api/qrz-status') return reply({ ruConfigured: true, comConfigured: true, hamConfigured: true, ruUsername: 'my-login', comUsername: 'my-login', hamUsername: 'R2FEL' });
      if (u === '/api/weather') return reply({ tempC: 11, code: 2, wind: 3, isDay: true, utcOffsetSeconds: Math.round(b.lon / 15) * 3600 });
      return real(url, opts); };
    const s = document.createElement('style'); s.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(s);
    window.__P = ${JSON.stringify(PHOTOS)};
    window.__set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    0; })()`);
  const shot = async (name, sels, m = 10) => {
    const r = await js(`(() => { const rs = ${JSON.stringify(sels)}.map(s => document.querySelector(s)).filter(Boolean).map(e => e.getBoundingClientRect());
      const x = Math.min(...rs.map(r => r.left)) - ${m}, y = Math.min(...rs.map(r => r.top)) - ${m};
      return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: Math.round(Math.max(...rs.map(r => r.right)) + ${m} - Math.max(0, x)), height: Math.round(Math.max(...rs.map(r => r.bottom)) + ${m} - Math.max(0, y)) }; })()`);
    fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage(r)).toPNG());
  };
  const full = async name => fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG());


  if (process.env.VARIANT === 'multi') {
    await js(`__set('#f-callsign', 'R3TEST')`); await wait(2500);
    await js(`(() => { const b = document.querySelector('#f-corr .qso-corr-body'); b.classList.add('mk-has2');
      const w = document.createElement('div'); w.className = 'mk-thumb'; w.title = 'Нажмите — крупно; фото 1 из 3';
      w.innerHTML = '<img src="' + __P.R3TEST_QSL + '"><span class="mk-arr" style="left:5px">‹</span><span class="mk-arr" style="right:5px">›</span><span class="mk-count">1/3</span>';
      b.prepend(w); 0; })()`);
    await wait(600);
    await shot('5-card-multi.png', ['.qso-main-head', '#f-corr']);
    await js(`(() => { const z = document.createElement('div'); z.className = 'mk-view'; z.id = 'mk-view';
      z.innerHTML = '<div class="mk-view-card"><img class="big" src="' + __P.R3TEST + '" style="object-fit:contain;background:#1c1b19">'
        + '<span class="mk-view-nav" style="left:-22px">‹</span><span class="mk-view-nav" style="right:-22px">›</span>'
        + '<div class="mk-view-cap"><div><b>R3TEST</b> <span class="who">Иван Петров · Тула</span></div><span class="btn">★ СДЕЛАТЬ ГЛАВНОЙ</span></div>'
        + '<div class="mk-strip"><img src="' + __P.R3TEST_QSL + '"><img class="on" src="' + __P.R3TEST + '"><img src="' + __P.EW1TEST_QSL + '"></div>'
        + '<div class="mk-view-foot"><span>фото 2 из 3 · QRZ.RU</span><span>← → листать · Esc — закрыть</span></div></div>';
      document.body.appendChild(z); 0; })()`);
    await wait(600); await full('6-viewer.png');
    await js(`document.getElementById('mk-view').remove(); 0`);
    await js(`document.getElementById('f-callsign').focus(); document.getElementById('f-callsign').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 0`);
    await wait(800);
    for (const cs of ['DL1TEST', 'EW1TEST', 'K1TEST']) {
      await js(`(() => { const rows = document.querySelectorAll('#f-group-rows .qso-group-row'); const c = rows[rows.length - 1].querySelector('.qso-group-call'); c.value = '${cs}'; c.dispatchEvent(new Event('input', { bubbles: true })); c.focus(); ${cs !== 'K1TEST' ? "c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));" : ''} 0; })()`);
      await wait(2500);
    }
    await js(`(() => { document.querySelectorAll('#f-group-rows .qso-group-row').forEach(r => { const call = r.querySelector('.qso-group-call').value; const p = __P[call + '_QSL']; if (!p) return;
      const l = r.querySelector('.qso-group-line1'); const i = document.createElement('img'); i.className = 'mk-mini'; i.src = p; l.prepend(i); }); document.activeElement.blur(); 0; })()`);
    await wait(800);
    await shot('7-pileup-multi.png', ['#f-group-rows'], 10);
    fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0); return;
  }
  // 1. карточка с фото
  await js(`__set('#f-callsign', 'R3TEST')`); await wait(2500);
  await js(`(() => { const b = document.querySelector('#f-corr .qso-corr-body'); b.classList.add('mk-has');
    const i = document.createElement('img'); i.className = 'mk-photo'; i.src = __P.R3TEST; i.title = 'Нажмите — крупно'; b.prepend(i); 0; })()`);
  await wait(600);
  await shot('1-card.png', ['.qso-main-head', '#f-corr']);
  // 2. крупно поверх окна
  await js(`(() => { const z = document.createElement('div'); z.className = 'mk-zoom'; z.id = 'mk-zoom';
    z.innerHTML = '<div class="mk-zoom-card"><img src="' + __P.R3TEST + '"><div class="mk-zoom-cap"><b>R3TEST</b><span>Иван Петров · Тула</span></div><div class="mk-zoom-foot"><span>фото: HamQTH</span><span>Esc — закрыть</span></div></div>';
    document.body.appendChild(z); 0; })()`);
  await wait(600); await full('2-zoom.png');
  await js(`document.getElementById('mk-zoom').remove(); 0`);
  // 3. пайлап: кружки в строках группы
  await js(`document.getElementById('f-callsign').focus(); document.getElementById('f-callsign').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 0`);
  await wait(800);
  await js(`(() => { const rows = document.querySelectorAll('#f-group-rows .qso-group-row'); const c = rows[rows.length - 1].querySelector('.qso-group-call'); c.value = 'DL1TEST'; c.dispatchEvent(new Event('input', { bubbles: true })); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 0; })()`);
  await wait(2500);
  await js(`(() => { const rows = document.querySelectorAll('#f-group-rows .qso-group-row'); const c = rows[rows.length - 1].querySelector('.qso-group-call'); c.value = 'EW1TEST'; c.dispatchEvent(new Event('input', { bubbles: true })); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 0; })()`);
  await wait(2500);
  await js(`(() => { const rows = document.querySelectorAll('#f-group-rows .qso-group-row'); const c = rows[rows.length - 1].querySelector('.qso-group-call'); c.value = 'K1TEST'; c.dispatchEvent(new Event('input', { bubbles: true })); 0; })()`);
  await wait(2500);
  await js(`(() => { document.querySelectorAll('#f-group-rows .qso-group-row').forEach(r => { const call = r.querySelector('.qso-group-call').value; const p = __P[call]; if (!p) return;
    const l = r.querySelector('.qso-group-line1'); const i = document.createElement('img'); i.className = 'mk-dot'; i.src = p; l.prepend(i); }); document.activeElement.blur(); 0; })()`);
  await wait(800);
  await shot('3-pileup.png', ['.qso-main-head', '#f-corr', '#f-group-rows'], 10);
  // 4. журнал: фото при наведении на позывной (форма чистая, иначе журнал сужен до повтора)
  await js(`(() => { document.querySelectorAll('#f-group-rows .qso-group-row').forEach(r => { const c = r.querySelector('.qso-group-call'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); }); __set('#f-callsign', ''); 0; })()`);
  await wait(1500);
  await js(`(() => { const b = document.getElementById('qso-log-toggle'); if (b && !document.getElementById('qso-log-panel').offsetHeight) b.click(); 0; })()`);
  await wait(1200);
  const info = await js(`(() => { const cells = [...document.querySelectorAll('#qso-log-panel tbody tr')]; const tr = cells.find(t => t.textContent.includes('DL1TEST')); if (!tr) return null;
    tr.scrollIntoView({ block: 'center' }); const td = [...tr.children].find(c => c.textContent.includes('DL1TEST')); const r = td.getBoundingClientRect();
    tr.style.background = 'rgba(232,162,61,.18)';
    const p = document.createElement('div'); p.className = 'mk-pop'; p.innerHTML = '<img src="' + __P.DL1TEST + '"><div><b>DL1TEST</b>Hans Becker<br><small>Berlin · 18.10.2026</small></div>';
    p.style.left = (r.left + 30) + 'px'; p.style.top = (r.bottom + 4) + 'px'; document.body.appendChild(p); return { top: r.top }; })()`);
  await wait(800);
  if (info) await shot('4-log-hover.png', ['#qso-log-panel', '.mk-pop'], 6);
  fs.rmSync(ROOT, { recursive: true, force: true }); app.exit(0);
});
