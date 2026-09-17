/* Makes every picture in the manual (public/help/): annotated screenshots and
 * the frames of its short animations, once with the app in English and once
 * in Russian mode — taken from the real app, so they can be made again
 * whenever the app changes:
 *
 *   npm run manual-images
 *
 * Nothing here talks to QRZ, the weather service or anyone's logbook. The app
 * runs unchanged (server.js on its own port, a throwaway profile), but the
 * page's calls for lookups, weather and the QRZ login status are answered
 * from DEMO below: made-up stations, the same answers every time.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const PROJ = path.join(__dirname, '..');
const HELP = path.join(PROJ, 'public', 'help');
const PORT = '4192';
const PROFILE = path.join(os.tmpdir(), 'r2fel-manual-profile');

// One language per run (npm run manual-images does both). The browser's own
// date and time fields follow the app's locale, so the English pictures are
// taken in an English one — otherwise they'd show whatever this Mac is set to.
const LANG = process.argv.includes('ru') ? 'ru' : 'en';
app.commandLine.appendSwitch('lang', LANG === 'ru' ? 'ru' : 'en-US');

// Output pixels per CSS pixel. Screenshots are read closely, so they get more;
// animation frames are many and are watched, not studied.
const SHOT_SCALE = 1.5;
const ANIM_SCALE = 1.25;
const WEBP_QUALITY = 0.86;

// The installed app's window: 900 wide, and on a typical laptop screen about
// this tall (see electron-main.js). Used where an animation shows the window.
const WINDOW_HEIGHT = 860;

process.env.PORT = PORT;
// Its own data folder, thrown away with the profile: the run logs a few demo
// contacts, and the app's automatic backup would otherwise drop *TEST files
// into the project's real data folder, next to the logins and the card.
process.env.QSO_DATA_DIR = path.join(PROFILE, 'data');
fs.rmSync(PROFILE, { recursive: true, force: true });
app.setPath('userData', PROFILE);
require(path.join(PROJ, 'server.js'));

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const MY = { callsign: 'R2FEL', rda: 'KA-05', qth: 'KO04fr' };

// As server.js would answer a lookup. Callsigns end in TEST so nobody real
// is shown with a made-up name.
const STATIONS = {
  R3TEST: { source: 'qrz.ru', callsign: 'R3TEST', name: 'Ivan Petrov', nameLocal: 'Иван Петров',
    country: 'Россия', city: 'Тула', grid: 'KO84te', rda: 'TL-01', gridApprox: false },
  UA9TEST: { source: 'qrz.ru', callsign: 'UA9TEST', name: 'Sergei Smirnov', nameLocal: 'Сергей Смирнов',
    country: 'Россия', city: 'Новосибирск', grid: 'NO14kx', rda: 'NS-01', gridApprox: false },
  EW1TEST: { source: 'qrz.ru', callsign: 'EW1TEST', name: 'Andrei Kovalchuk', nameLocal: 'Андрей Ковальчук',
    country: 'Беларусь', city: 'Минск', grid: 'KO33sv', gridApprox: false },
  DL1TEST: { source: 'qrz.com', callsign: 'DL1TEST', name: 'Hans Becker',
    country: 'Germany', city: 'Berlin', grid: 'JO62qm', gridApprox: false },
  K1TEST: { source: 'qrz.com', callsign: 'K1TEST', name: 'John Carter',
    country: 'United States', city: 'Boston, MA', grid: 'FN42li', gridApprox: false }
};

/** The logbook the pictures show — names as each language's app would have logged them. */
function demoLog(lang) {
  const ru = lang === 'ru';
  const rows = [
    ['2026-09-12', '18:05', 'R3TEST', ru ? 'Иван Петров' : 'Ivan Petrov', ru ? 'Тула' : 'Tula', '40m', '7.085.0', 'SSB', '59', '57'],
    ['2026-09-11', '09:41', 'DL1TEST', 'Hans Becker', 'Berlin', '20m', '14.195.0', 'SSB', '59', '59'],
    ['2026-09-10', '21:17', 'EW1TEST', ru ? 'Андрей Ковальчук' : 'Andrei Kovalchuk', ru ? 'Минск' : 'Minsk', '80m', '3.650.0', 'SSB', '59', '58'],
    ['2026-09-09', '14:22', 'K1TEST', 'John Carter', 'Boston, MA', '20m', '14.025.0', 'CW', '599', '579'],
    ['2026-09-07', '17:50', 'R3TEST', ru ? 'Иван Петров' : 'Ivan Petrov', ru ? 'Тула' : 'Tula', '40m', '7.030.0', 'CW', '599', '599'],
    ['2026-09-06', '11:03', 'DL1TEST', 'Hans Becker', 'Berlin', '17m', '18.130.0', 'SSB', '57', '59'],
    ['2026-09-05', '19:36', 'EW1TEST', ru ? 'Андрей Ковальчук' : 'Andrei Kovalchuk', ru ? 'Минск' : 'Minsk', '40m', '7.140.0', 'SSB', '59', '59'],
    ['2026-09-03', '08:12', 'K1TEST', 'John Carter', 'Boston, MA', '15m', '21.250.0', 'SSB', '55', '57']
  ];
  // QSL marks, and whose callsign each was: one from the field (/P), the
  // oldest under an earlier callsign of the demo operator.
  const marks = [
    { lotwSent: 'Y', lotwSentDate: '2026-09-12' },
    { lotwSent: 'Y', lotwRcvd: 'Y', lotwRcvdDate: '2026-09-13', eqslSent: 'Y', eqslRcvd: 'Y', eqslRcvdDate: '2026-09-12', hamlogSent: 'Y' },
    { lotwSent: 'Y', hamlogSent: 'Y', hamlogRcvd: 'Y' },
    { eqslSent: 'Y', eqslSentDate: '2026-09-10' },
    { lotwSent: 'Y', eqslSent: 'Y', hamlogSent: 'Y' },
    { lotwSent: 'Y', lotwRcvd: 'Y', lotwRcvdDate: '2026-09-09' },
    { hamlogSent: 'Y', hamlogRcvd: 'Y' },
    {}
  ];
  const myCall = i => (i === 3 ? `${MY.callsign}/P` : i === 7 ? 'RA2TEST' : MY.callsign);
  return rows.map(([date, time, callsign, name, qth, band, freq, mode, rstSent, rstRcvd], i) => {
    const s = STATIONS[callsign];
    return {
      ...marks[i],
      id: String(1757000000000 + i), myCallsign: myCall(i), myRda: MY.rda, myQth: MY.qth,
      callsign, name, country: ru || s.source !== 'qrz.ru' ? s.country : 'Rossiya',
      grid: s.grid, rda: s.rda || '', qth, band, freq,
      freqHz: Math.round(Number(freq.replace(/\.(\d)$/, '$1').replace(/\./g, '')) * 100),
      mode, date, time, rstSent, rstRcvd, nrSent: '', nrRcvd: '', notes: '', source: s.source,
      createdAt: `${date}T${time}:00.000Z`, updatedAt: `${date}T${time}:00.000Z`
    };
  });
}

function demoStation(lang, extra) {
  return Object.assign({
    callsign: MY.callsign, rda: MY.rda, qth: MY.qth, mode: 'SSB', band: '40m', recent: [],
    exportedCount: 8, contest: false, serial: 1, ruPhonetics: lang === 'ru', showPhonetics: true,
    card: { kind: 'dark', me: { name: 'Aleksei Aleksandrov', qth: 'Kaliningrad', country: 'European Russia', cq: '15', itu: '29' } }
  }, extra || {});
}

// Runs in the page before app.js: answers the calls that would otherwise go
// out to QRZ and the weather service.
const MY_CALL = MY.callsign;
const MOCK_PRELOAD = `
const STATIONS = ${JSON.stringify(STATIONS)};
// The desktop app's side, as much as the pictures need: the settings show
// their DEBUG LOG section only when there's an app around them to keep one.
window.desktopApp = { platform: 'darwin', saveLog: async () => null, showLog: async () => null,
  locationAccess: async () => 'granted', openLocationSettings: async () => {} };
const realFetch = window.fetch.bind(window);
const reply = obj => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
window.__lookupDelay = 250;
window.fetch = async (url, opts) => {
  const u = typeof url === 'string' ? url : url.url;
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (u === '/api/lookup') {
    await new Promise(r => setTimeout(r, window.__lookupDelay));
    const rec = STATIONS[String(body.callsign || '').toUpperCase()];
    // HamQTH often has the station's e-mail: made up here like the rest.
    return reply(rec ? Object.assign({ email: rec.callsign.toLowerCase() + '@example.com', source: 'qrz.ru + hamqth' }, rec)
      : { error: 'Callsign not found', errorCode: '404', source: 'qrz.ru' });
  }
  if (u === '/api/weather') {
    return reply({ tempC: Math.round(6 + (62 - Math.abs(body.lat)) / 2), code: 2, wind: 3, isDay: true,
      utcOffsetSeconds: Math.round(body.lon / 15) * 3600 });
  }
  if (u === '/api/qrz-status') {
    return reply({ ruConfigured: true, comConfigured: true, hamConfigured: true, ruUsername: 'my-login', comUsername: 'my-login', hamUsername: '${MY_CALL}' });
  }
  if (u === '/api/rda-lookup') return reply({ rda: 'KA-05', name: 'demo' });
  if (u === '/api/lotw/status') {
    return reply({ tqsl: { version: '2.8.6' }, locations: [{ name: 'Home', call: '${MY_CALL}', grid: 'KO04FR' }],
      certificates: [{ call: '${MY_CALL}', from: '2020-01-01', to: '2030-12-31' }], login: { username: 'demo', hasPassword: true } });
  }
  if (u === '/api/eqsl/status') return reply({ login: { username: '${MY_CALL}', hasPassword: true, qth: '' } });
  if (u === '/api/card/status') return reply({ image: null });
  if (u === '/api/mail/status') return reply({ mail: { address: 'my-mail@mail.ru', host: 'smtp.mail.ru', port: 465, hasPassword: true, known: true } });
  return realFetch(url, opts);
};
`;

// Page-side helpers for pointing at things and pressing keys, put in after
// every load.
const PAGE_HELPERS = `
(() => {
  const $ = s => typeof s === 'string' ? document.querySelector(s) : s;
  // The marks are the app's own cream (its text colour) with dark numbers —
  // they used to be a bright pink that shouted over the picture.
  const MARK = '#ece7d8', MARK_INK = '#1c1b19';

  // 'text:#id' measures just the text inside an element, not its whole box —
  // a status line is as wide as the form, the words in it are not.
  const box = s => {
    if (typeof s === 'string' && s.startsWith('text:')) {
      const el = $(s.slice(5));
      if (!el) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    }
    const el = $(s);
    return el ? el.getBoundingClientRect() : null;
  };

  window.__rect = (sels, m = 0) => {
    const rs = (Array.isArray(sels) ? sels : [sels]).map(box).filter(Boolean);
    if (!rs.length) throw new Error('nothing matches ' + sels);
    const x = Math.min(...rs.map(r => r.left)) - m, y = Math.min(...rs.map(r => r.top)) - m;
    const r = Math.max(...rs.map(r => r.right)) + m, b = Math.max(...rs.map(r => r.bottom)) + m;
    return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
      width: Math.round(Math.min(innerWidth, r) - Math.max(0, x)), height: Math.round(b - Math.max(0, y)) };
  };

  window.__clear = () => document.querySelectorAll('.__ann').forEach(n => n.remove());

  // marks: [{ n, sel, dir: 'l'|'r'|'u'|'d', dist, dx, dy, pad, box, arrow }]
  window.__annotate = marks => {
    __clear();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', '__ann');
    svg.setAttribute('width', innerWidth);
    svg.setAttribute('height', innerHeight);
    svg.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;overflow:visible';
    let html = '<defs><marker id="__arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + MARK + '"/></marker></defs>';
    const badges = [];
    marks.forEach(m => {
      const pad = m.pad === undefined ? 4 : m.pad;
      const R = __rect(m.sel, pad);
      const x = R.x, y = R.y, w = R.width, h = R.height;
      if (m.box !== false) {
        html += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="rgba(236,231,216,0.06)" stroke="' + MARK + '" stroke-width="2.5"/>';
      }
      const dist = m.dist || 34, cx = x + w / 2, cy = y + h / 2;
      let bx, by, tx, ty;
      switch (m.dir || 'l') {
        case 'r': bx = x + w + dist; by = cy; tx = x + w; ty = cy; break;
        case 'u': bx = cx; by = y - dist; tx = cx; ty = y; break;
        case 'd': bx = cx; by = y + h + dist; tx = cx; ty = y + h; break;
        default:  bx = x - dist; by = cy; tx = x; ty = cy;
      }
      bx += m.dx || 0; by += m.dy || 0;
      const len = Math.hypot(tx - bx, ty - by) || 1;
      const sx = bx + (tx - bx) / len * 15, sy = by + (ty - by) / len * 15;
      const ex = tx - (tx - bx) / len * 3, ey = ty - (ty - by) / len * 3;
      if (len > 22 && m.arrow !== false) html += '<line x1="' + sx + '" y1="' + sy + '" x2="' + ex + '" y2="' + ey + '" stroke="' + MARK + '" stroke-width="2.5" marker-end="url(#__arrow)"/>';
      badges.push('<circle cx="' + bx + '" cy="' + by + '" r="13" fill="' + MARK + '" stroke="' + MARK_INK + '" stroke-width="2"/>' +
        '<text x="' + bx + '" y="' + (by + 5.5) + '" text-anchor="middle" font-family="Barlow Condensed, Roboto Condensed, sans-serif" font-weight="700" font-size="16" fill="' + MARK_INK + '">' + m.n + '</text>');
    });
    svg.innerHTML = html + badges.join('');
    document.body.appendChild(svg);
  };

  // A keycap beside an element — which key was just pressed, in animations.
  window.__key = (label, sel, dx = 0, dy = 0) => {
    document.querySelectorAll('.__key').forEach(n => n.remove());
    if (!label) return;
    const r = __rect(sel || document.activeElement || document.body);
    const k = document.createElement('div');
    k.className = '__key __ann';
    k.textContent = label;
    k.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;padding:7px 14px 8px;border-radius:7px;' +
      'background:linear-gradient(#fbf8ef,#e4dfcf);color:#1c1b19;border:1px solid #b8b09a;box-shadow:0 3px 0 #8c8472,0 8px 20px rgba(0,0,0,.45);' +
      'font:700 17px "Barlow Condensed","Roboto Condensed",sans-serif;letter-spacing:.04em;white-space:nowrap';
    k.style.left = (r.x + r.width + 12 + dx) + 'px';
    k.style.top = (r.y + r.height / 2 - 18 + dy) + 'px';
    document.body.appendChild(k);
  };

  // Typing, as the keyboard would: one character, one input event.
  window.__type = (sel, ch) => {
    const el = sel ? $(sel) : document.activeElement;
    el.focus();
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + ch + el.value.slice(end);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  };

  window.__set = (sel, value) => {
    const el = $(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  window.__press = (key, sel) => {
    const el = sel ? $(sel) : (document.activeElement || document.body);
    if (sel) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
})();
`;

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, conv, lang;
const js = code => win.webContents.executeJavaScript(code).catch(err => {
  console.error('[js failed] ' + String(code).slice(0, 160).replace(/\s+/g, ' '));
  throw err;
});

async function toWebp(image) {
  const b64 = image.toPNG().toString('base64');
  const url = await conv.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', ${WEBP_QUALITY});
  })()`);
  return Buffer.from(url.split(',')[1], 'base64');
}

async function capture(rect, file, scale) {
  await sleep(250);
  let image = await win.webContents.capturePage(rect);
  image = image.resize({ width: Math.round(rect.width * scale), quality: 'best' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await toWebp(image));
}

/** A fresh page: storage seeded, app loaded, helpers in. */
async function load(stationExtra) {
  await win.loadURL(`http://localhost:${PORT}/index.html`);
  await sleep(400);
  const log = demoLog(lang);
  await js(`(async () => {
    localStorage.setItem('qso-station', ${JSON.stringify(JSON.stringify(demoStation(lang, stationExtra)))});
    localStorage.setItem('qso-qrz-setup-seen', '1');   // left from the old first-run window; harmless
    const db = await new Promise((res, rej) => { const r = indexedDB.open('qso-log', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('qsos', { keyPath: 'id' });
        s.createIndex('callsign', 'callsign'); s.createIndex('date', 'date'); };
      r.onsuccess = () => res(r.result); r.onerror = rej; });
    await new Promise(res => { const tx = db.transaction('qsos', 'readwrite'); const st = tx.objectStore('qsos');
      st.clear(); ${JSON.stringify(log)}.forEach(q => st.put(q)); tx.oncomplete = res; });
    db.close();
  })()`);
  await win.loadURL(`http://localhost:${PORT}/index.html`);
  await sleep(900);
  await js(PAGE_HELPERS);
}

// The same view without the numbered marks, for the project's front page on
// GitHub: README.md shows what the program looks like, and nobody wants
// callout numbers there. Taken in both languages — the English half of the
// page needs the English window (names in Latin, "Uniform Alfa Nine…"), the
// Russian half its own.
const README_SHOTS = { contact: 'screenshot' };

async function shot(name, crop, marks, margin = 10) {
  if (README_SHOTS[name]) {
    const clean = await js(`__rect(${JSON.stringify(crop)}, ${margin})`);
    const dir = path.join(PROJ, 'docs');
    const file = `${README_SHOTS[name]}-${lang}.webp`;
    fs.mkdirSync(dir, { recursive: true });
    await capture(clean, path.join(dir, file), SHOT_SCALE);
    console.log(`  docs/${file}`);
  }
  if (marks && marks.length) await js(`__annotate(${JSON.stringify(marks)})`);
  const rect = await js(`__rect(${JSON.stringify(crop)}, ${margin})`);
  await capture(rect, path.join(HELP, 'img', lang, `${name}.webp`), SHOT_SCALE);
  await js('__clear()');
  console.log(`  ${lang}/${name}`);
}

/**
 * Records an animation: every frame() call is one picture, shown for `ms`.
 * `crop` is the part of the page to show — or 'window', for the app's own
 * window as it would be on screen, scrolling along with what's happening
 * (a pileup grows longer than any fixed crop could hold).
 */
function animation(name, crop) {
  const dir = path.join(HELP, 'anim', lang, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const frames = [];
  let rect = crop === 'window' ? { x: 0, y: 0, width: 900, height: WINDOW_HEIGHT } : null;
  return {
    async frame(ms, step) {
      if (!rect) rect = await js(`__rect(${JSON.stringify(crop)}, 0)`);
      const file = `${String(frames.length + 1).padStart(2, '0')}.webp`;
      await capture(rect, path.join(dir, file), ANIM_SCALE);
      frames.push({ src: file, ms, step });
    },
    finish() {
      fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ frames }, null, 1) + '\n');
      console.log(`  ${lang}/anim/${name} (${frames.length} frames)`);
    }
  };
}

async function typeSlowly(sel, text, anim, step, ms = 190) {
  for (const ch of text) {
    await js(`__type(${JSON.stringify(sel)}, ${JSON.stringify(ch)})`);
    await sleep(60);
    if (anim) await anim.frame(ms, step);
  }
}

/** Waits out the typing delay and the (mock) lookup behind it. */
const lookedUp = () => sleep(1300);

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

const MAIN_TO_LOG = ['.qso-station-block', '.qso-submit-row'];

async function pictures() {
  // 1. The whole window, empty and ready.
  await load();
  await shot('overview', ['.qso-nameplate', '#qso-log-toggle'], [
    { n: 1, sel: '#s-contest-btn', dir: 'l' },
    { n: 2, sel: '#qso-data-btn', dir: 'd', dist: 30 },
    { n: 3, sel: '.qso-station', dir: 'd', dist: -24, dx: -380, pad: 2, arrow: false },
    { n: 4, sel: '#s-geo-btn', dir: 'd', dist: 36 },
    { n: 5, sel: '.qso-freq-bar', dir: 'l' },
    { n: 6, sel: '#f-callsign', dir: 'd', dist: 34 },
    { n: 7, sel: '#f-corr', dir: 'l', dist: 16, pad: 2 },
    { n: 8, sel: ['#f-rst-sent', '#f-rst-rcvd'], dir: 'l', dist: 34 },
    { n: 9, sel: ['#f-date', '#f-now'], dir: 'l', dist: 16 },
    { n: 10, sel: '#f-submit', dir: 'l', dist: 16 },
    { n: 11, sel: ['#qso-log-toggle-label', '#qso-log-toggle-count'], dir: 'r', dist: 34, pad: 3 }
  ], 0);

  // 2. A contact in progress: frequency typed, callsign found.
  await load();
  await js(`__set('#f-freq', '7085'); document.getElementById('f-freq').dispatchEvent(new Event('blur'))`);
  await js(`__set('#f-callsign', 'UA9TEST')`);
  await lookedUp();
  await shot('contact', ['.qso-contact'], [
    { n: 1, sel: '#f-freq', dir: 'l', dist: 34 },
    { n: 2, sel: '#f-band-btn', dir: 'u', dist: 28 },
    { n: 3, sel: '#f-mode-btn', dir: 'u', dist: 28 },
    { n: 4, sel: '#f-clear-call', dir: 'l', dist: 40, pad: 2 },
    { n: 5, sel: '#f-portable', dir: 'u', dist: 26 },
    { n: 6, sel: '#f-group-btn', dir: 'u', dist: 26 },
    { n: 7, sel: 'text:#f-phonetic', dir: 'r', dist: 34 },
    { n: 8, sel: 'text:#f-lookup-status', dir: 'r', dist: 34 },
    // The whole badge row, from the left: NEW CONTACT and the ★ beside it are
    // one item in the key, and an arrow from the right would land on the ★.
    { n: 9, sel: '.qso-badge-row', dir: 'l', dist: 34 },
    { n: 10, sel: 'text:#f-corr-name', dir: 'r', dist: 34 },
    { n: 11, sel: '#f-corr .qso-dist', dir: 'd', dist: 28 },
    { n: 12, sel: '#f-corr .qso-temp', dir: 'd', dist: 28 },
    { n: 13, sel: '#f-corr .qso-time', dir: 'd', dist: 28 }
  ], 40);

  // 3. My station, read out to the one being worked.
  await shot('station', ['.qso-nameplate', '.qso-station-block'], [
    { n: 1, sel: '#s-callsign', dir: 'd', dist: 64, dx: 120 },
    { n: 2, sel: '#s-portable', dir: 'd', dist: 64 },
    { n: 3, sel: '#s-rda', dir: 'd', dist: 64, dx: 60 },
    { n: 4, sel: '#s-qth', dir: 'd', dist: 64, dx: 60 },
    { n: 5, sel: '#s-geo-btn', dir: 'd', dist: 64 },
    { n: 6, sel: '#s-temp', dir: 'u', dist: 26 },
    { n: 7, sel: 'text:#s-phonetic', dir: 'd', dist: 30, dx: -40 },
    { n: 8, sel: '#qso-subtitle', dir: 'l', dist: 30 }
  ], 44);

  // 4. Nobody has the callsign on file.
  await load();
  await js(`__set('#f-callsign', 'R7NEW')`);
  await lookedUp();
  await shot('not-found', ['#f-callsign', '#f-corr'], [
    { n: 1, sel: 'text:#f-lookup-status', dir: 'r', dist: 34 },
    { n: 2, sel: '#f-q-name', dir: 'd', dist: 30 },
    { n: 3, sel: '#f-q-qth', dir: 'd', dist: 30 },
    { n: 4, sel: '#f-q-rda', dir: 'd', dist: 30 }
  ], 44);

  // 5. Worked before: the log opens by itself on the earlier contacts.
  await load();
  await js(`__set('#f-callsign', 'R3TEST')`);
  await lookedUp();
  await shot('worked-before', ['#f-corr', '.qso-table-wrap'], [
    { n: 1, sel: '#f-badge', dir: 'r', dist: 30 },
    { n: 2, sel: 'text:#f-worked', dir: 'r', dist: 30 },
    { n: 3, sel: '#qso-dupe-filter', dir: 'r', dist: 0, dx: -190, pad: 2, arrow: false },
    { n: 4, sel: '#qso-tbody tr.qso-dupe', dir: 'r', dist: 0, dx: -112, pad: 1, arrow: false }
  ], 24);

  // 6. The list of earlier contacts, from "Last: …".
  await js(`document.getElementById('f-worked').click()`);
  await sleep(300);
  await shot('history', ['#qso-history .qso-card'], [], 8);
  await js(`document.getElementById('history-close').click()`);

  // 7. A pileup: the main station and two more — one green group of three.
  await load();
  await js(`__set('#f-callsign', 'UA9TEST')`);
  await lookedUp();
  await js(`__press(' ', '#f-callsign')`);
  await js(`__set(document.activeElement, 'EW1TEST')`);
  await lookedUp();
  await js(`__press(' ')`);
  await js(`__set(document.activeElement, 'DL1TEST')`);
  await lookedUp();
  await shot('group', ['.qso-contact', '.qso-submit-row'], [
    { n: 1, sel: 'text:.qso-main-title .qso-group-only', dir: 'r', dist: 34 },
    { n: 2, sel: 'text:.qso-main-group-label', dir: 'r', dist: 34 },
    { n: 3, sel: '.qso-group-row:nth-of-type(1) .qso-group-info', dir: 'u', dist: 17, dx: 150, pad: 2, arrow: false },
    { n: 4, sel: '.qso-group-row:last-child .qso-group-rsts', dir: 'd', dist: 26 },
    { n: 5, sel: '.qso-group-row:last-child .qso-group-remove', dir: 'd', dist: 26 },
    { n: 6, sel: '#f-group-add', dir: 'r', dist: 34 },
    { n: 7, sel: '#f-submit', dir: 'u', dist: 26 }
  ], 12);

  // 8. Contest mode: serial numbers.
  await load({ contest: true, serial: 7 });
  await js(`__set('#f-callsign', 'K1TEST')`);
  await lookedUp();
  await js(`__set('#f-nr-rcvd', '123')`);
  await shot('contest', ['.qso-nameplate', '#f-corr'], [
    { n: 1, sel: '#s-contest-btn', dir: 'l', dist: 30 },
    // Сверху, а не снизу: у серийников появились свои подписи, и стрелки
    // снизу стали перечёркивать RST SENT / RST RCVD.
    { n: 2, sel: '#f-nr-sent-cell', dir: 'u', dist: 26 },
    { n: 3, sel: '#f-nr-rcvd-cell', dir: 'u', dist: 26 },
    { n: 4, sel: '#f-nr-reset', dir: 'r', dist: 26 }
  ], 12);

  // 9. Date and time: the clock, and what typing into it does.
  await load();
  await js(`__set('#f-callsign', 'DL1TEST')`);
  await lookedUp();
  await js(`document.getElementById('f-time').dispatchEvent(new Event('input', { bubbles: true }))`);
  await shot('datetime', ['#f-date', '#f-time-manual', '#f-now'], [
    { n: 1, sel: '#f-date', dir: 'd', dist: 30 },
    { n: 2, sel: '#f-time', dir: 'd', dist: 30 },
    { n: 3, sel: 'text:#f-time-manual', dir: 'l', dist: 30 },
    { n: 4, sel: '#f-now', dir: 'd', dist: 30 }
  ], 46);

  // 10. The logbook, two contacts ticked.
  await load();
  await js(`document.getElementById('qso-log-toggle').click()`);
  await sleep(200);
  await js(`document.querySelectorAll('#qso-tbody [data-pick]')[1].click(); document.querySelectorAll('#qso-tbody [data-pick]')[2].click();`);
  await shot('log', ['#qso-log-toggle', '.qso-table-wrap'], [
    { n: 1, sel: '#qso-log-toggle-label', dir: 'r', dist: 34 },
    { n: 2, sel: '#qso-search', dir: 'u', dist: 24, dx: -120 },
    { n: 3, sel: '#qso-del-selected', dir: 'u', dist: 24 },
    { n: 4, sel: ['.qso-counts > span:nth-of-type(1)', '.qso-counts > span:nth-of-type(3)'], dir: 'u', dist: 24 },
    { n: 5, sel: '#qso-tbody tr:nth-child(4)', dir: 'r', dist: 0, dx: -112, pad: 1, arrow: false },
    { n: 6, sel: '#qso-tbody tr:nth-child(1) .qso-del', dir: 'u', dist: 22 },
    { n: 7, sel: 'thead th:nth-child(4) .qso-col-resizer', dir: 'l', dist: 24, pad: 3 },
    { n: 8, sel: 'text:#qso-tbody tr:nth-child(1) .qso-mine', dir: 'u', dist: 30, dx: 56 },
    { n: 9, sel: '#qso-tbody tr:nth-child(1) .qso-qsl', dir: 'u', dist: 30, dx: 52 }
  ], 30);

  // 11. Editing a logged contact.
  await js(`document.querySelector('#qso-tbody tr:nth-child(2)').click()`);
  await sleep(600);
  await shot('edit', ['#f-date', '.qso-submit-row'], [
    { n: 1, sel: '#f-edit-note', dir: 'l', dist: 34 },
    { n: 2, sel: '#f-cancel-edit', dir: 'r', dist: 34 },
    { n: 3, sel: '#f-submit', dir: 'r', dist: 0, dx: -140, arrow: false }
  ], 46);

  // 12. Settings: the list, with the numbers out in the margin to the right
  // of each row's switch, button or ›. Then the export page.
  await load();
  await js(`document.getElementById('qso-data-btn').click()`);
  await sleep(500);
  await shot('settings', ['#qso-data .qso-card'], [
    { n: 1, sel: '#help-open', dir: 'u', dist: 30 },
    { n: 2, sel: '#qrz-accounts-edit .qso-set-chev', dir: 'r', dist: 54 },
    { n: 3, sel: '#fill-qrz', dir: 'r', dist: 54 },
    { n: 4, sel: '#phonetics-toggle-btn', dir: 'r', dist: 54 },
    { n: 5, sel: '#ru-phonetics-btn', dir: 'r', dist: 54 },
    { n: 6, sel: '#set-open-export .qso-set-chev', dir: 'r', dist: 54 },
    { n: 7, sel: '#set-open-import .qso-set-chev', dir: 'r', dist: 54 },
    { n: 8, sel: '#set-open-mycall .qso-set-chev', dir: 'r', dist: 54 },
    { n: 9, sel: '#set-open-clear .qso-set-chev', dir: 'r', dist: 54 },
    { n: 10, sel: '#set-open-lotw .qso-set-chev', dir: 'r', dist: 54 },
    { n: 11, sel: '#set-open-eqsl .qso-set-chev', dir: 'r', dist: 54 },
    { n: 12, sel: '#set-open-hamlog .qso-set-chev', dir: 'r', dist: 54 },
    { n: 13, sel: '#set-open-card .qso-set-chev', dir: 'r', dist: 54 },
    { n: 14, sel: '#set-open-debug .qso-set-chev', dir: 'r', dist: 54 },
    { n: 15, sel: 'text:.qso-about-name', dir: 'l', dist: 34 }
  ], 44);

  await js(`document.getElementById('set-open-export').click()`);
  await sleep(400);
  await js(`document.querySelector('input[name="exp-scope"][value="range"]').click();
    __set('#exp-from', ${JSON.stringify(lang === 'ru' ? '05.09.2026' : '2026-09-05')});
    __set('#exp-to', ${JSON.stringify(lang === 'ru' ? '12.09.2026' : '2026-09-12')});`);
  await sleep(300);
  await shot('settings-export', ['#qso-data .qso-card'], [
    { n: 1, sel: '#set-page-export .qso-seg', dir: 'r', dist: 52 },
    { n: 2, sel: '#exp-station', dir: 'r', dist: 54 },
    { n: 3, sel: '#exp-adif', dir: 'r', dist: 40 }
  ], 44);

  // 12b. Import, a file chosen: what's in it, and what of it to take.
  await js(`document.querySelector('#set-page-export .qso-set-back').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-import').click()`);
  await sleep(300);
  await js(`(() => {
    const f = (n, v) => '<' + n + ':' + String(v).length + '>' + v;
    const rec = (my, call, date, time) => (my ? f('STATION_CALLSIGN', my) : '') + f('CALL', call) + f('QSO_DATE', date) + f('TIME_ON', time) + f('BAND', '40M') + f('MODE', 'SSB') + '<EOR>\\n';
    const text = '<EOH>\\n' + rec('${MY_CALL}', 'R3TEST', '20260914', '1805') + rec('${MY_CALL}', 'EW1TEST', '20260913', '1740') +
      rec('${MY_CALL}', 'DL1TEST', '20260912', '0941') + rec('${MY_CALL}', 'K1TEST', '20260911', '1422') +
      rec('RA2TEST', 'UA9TEST', '20260520', '1200') + rec('RA2TEST', 'R3TEST', '20260418', '0915') +
      rec('', 'EW1TEST', '20260302', '1015');
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'mylog.adi'));
    const input = document.getElementById('imp-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(600);
  await shot('settings-import', ['#qso-data .qso-card'], [
    { n: 1, sel: '.qso-imp-chips', dir: 'r', dist: 40 },
    { n: 2, sel: '#imp-mine .qso-switch', dir: 'r', dist: 40 },
    { n: 3, sel: '#imp-as', dir: 'r', dist: 40 },
    { n: 4, sel: '#imp-go', dir: 'r', dist: 40 },
    { n: 5, sel: 'text:#imp-range-open', dir: 'r', dist: 40 }
  ], 44);

  // 12b'. What IMPORT came to: the result page every action ends on.
  await js(`document.getElementById('imp-go').click()`);
  await sleep(700);
  await shot('settings-result', ['#qso-data .qso-card'], [
    { n: 1, sel: '#result-ico', dir: 'r', dist: 54 },
    { n: 2, sel: '#result-primary', dir: 'r', dist: 40 },
    { n: 3, sel: '#result-secondary', dir: 'r', dist: 40 }
  ], 44);

  // 12c. My callsign on contacts: a period put under another callsign.
  await js(`document.getElementById('result-secondary').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-mycall').click()`);
  await sleep(300);
  await js(`__set('#mc-to', ${JSON.stringify(lang === 'ru' ? '06.09.2026' : '2026-09-06')});
    const old = document.getElementById('mc-old'); old.value = '${MY_CALL}'; old.dispatchEvent(new Event('change', { bubbles: true }));
    __set('#mc-new', 'RA2TEST');`);
  await sleep(300);
  await shot('settings-mycall', ['#qso-data .qso-card'], [
    { n: 1, sel: '#mc-to', dir: 'r', dist: 54 },
    { n: 2, sel: '#mc-old', dir: 'r', dist: 54 },
    { n: 3, sel: '#mc-new', dir: 'r', dist: 54 },
    { n: 4, sel: '#mc-apply', dir: 'r', dist: 40 }
  ], 44);

  // 12d. LoTW and eQSL.
  await js(`document.querySelector('#set-page-mycall .qso-set-back').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-lotw').click()`);
  await sleep(400);
  await shot('settings-lotw', ['#qso-data .qso-card'], [
    { n: 1, sel: 'text:#lotw-tqsl-state', dir: 'r', dist: 34 },
    { n: 2, sel: '#lotw-location', dir: 'r', dist: 54 },
    { n: 3, sel: '[data-page="lotw-login"] .qso-set-chev', dir: 'r', dist: 54 },
    { n: 4, sel: '#lotw-send', dir: 'r', dist: 40 },
    { n: 5, sel: '#lotw-check', dir: 'r', dist: 40 }
  ], 44);
  await js(`document.querySelector('#set-page-lotw .qso-set-back').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-eqsl').click()`);
  await sleep(400);
  await shot('settings-eqsl', ['#qso-data .qso-card'], [
    { n: 1, sel: '[data-page="eqsl-login"] .qso-set-chev', dir: 'r', dist: 54 },
    { n: 2, sel: '#eqsl-send', dir: 'r', dist: 40 },
    { n: 3, sel: '#eqsl-check', dir: 'r', dist: 40 }
  ], 44);

  await js(`document.querySelector('#set-page-eqsl .qso-set-back').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-hamlog').click()`);
  await sleep(400);
  await shot('settings-hamlog', ['#qso-data .qso-card'], [
    { n: 1, sel: '#hamlog-site .qso-set-chev', dir: 'r', dist: 54 },
    { n: 2, sel: '#hamlog-save', dir: 'r', dist: 40 },
    { n: 3, sel: '#hamlog-read', dir: 'r', dist: 40 }
  ], 44);

  // 12e. QSL by e-mail: the program's card (dark), the details on it, the mailbox and the letter.
  await js(`document.querySelector('#set-page-hamlog .qso-set-back').click()`);
  await sleep(300);
  await js(`document.getElementById('set-open-card').click()`);
  await sleep(1600);
  await shot('settings-card', ['#qso-data .qso-card'], [
    { n: 1, sel: '#set-page-card .qso-seg', dir: 'r', dist: 40 },
    { n: 2, sel: '#card-preview', dir: 'r', dist: 40 },
    { n: 3, sel: '#card-me-fill', dir: 'r', dist: 40 },
    { n: 4, sel: '[data-page="mail-login"] .qso-set-chev', dir: 'r', dist: 54 },
    { n: 5, sel: '[data-page="letter"] .qso-set-chev', dir: 'r', dist: 54 }
  ], 44);
  await js(`document.querySelector('#set-page-card .qso-set-back').click()`);

  // 13. The logins — a page inside settings now, like everything else.
  await sleep(300);
  await js(`document.getElementById('qrz-accounts-edit').click()`);
  await sleep(600);
  await shot('qrz-login', ['#qso-data .qso-card'], [], 0);
  await js(`document.querySelector('#set-page-qrz .qso-set-back').click()`);

  // 13b. Sending a card: the ✉ of the first contact in the log.
  await load();
  await js(`document.getElementById('qso-log-toggle').click()`);
  await sleep(300);
  await js(`document.querySelector('#qso-tbody [data-card]').click()`);
  await sleep(2200);
  await shot('card-send', ['#qso-card-send .qso-card'], [
    { n: 1, sel: '#cs-preview', dir: 'r', dist: 40 },
    { n: 2, sel: '#cs-form > .qso-cs-seg', dir: 'r', dist: 40 },
    { n: 3, sel: '#cs-qrz', dir: 'r', dist: 40 },
    { n: 4, sel: '.qso-cs-fields .qso-cs-seg', dir: 'r', dist: 40 },
    { n: 5, sel: '#cs-send', dir: 'r', dist: 40 }
  ], 44);
  await js(`document.getElementById('cs-close').click()`);

  // 14. Band menu.
  await load();
  await js(`document.getElementById('f-band-btn').click()`);
  await sleep(200);
  await shot('bands', ['.qso-main-head', '#f-band-menu'], [], 14);
}

// ---------------------------------------------------------------------------
// The animations
// ---------------------------------------------------------------------------

async function animations() {
  // A. One contact, start to finish, from the keyboard.
  await load();
  let a = animation('log-contact', MAIN_TO_LOG);
  await js(`document.getElementById('f-callsign').focus(); window.__lookupDelay = 900`);
  await a.frame(1100, 1);
  await typeSlowly('#f-callsign', 'UA9TEST', a, 1);
  await a.frame(500, 1);
  await sleep(850);                       // past the typing delay: the lookup is out
  await a.frame(700, 2);
  await sleep(1300);
  await a.frame(2400, 2);
  await js(`__press('Tab', '#f-callsign'); __key('Tab', '#f-callsign', 60)`);
  await a.frame(1000, 3);
  await js(`__key(null)`);
  await js(`__type(null, '5')`);
  await a.frame(260, 3);
  await js(`__type(null, '7')`);
  await a.frame(800, 3);
  await js(`__press('Tab'); __key('Tab', '#f-rst-sent', -70, 48)`);
  await a.frame(1000, 3);
  await js(`__key('Enter', '#f-rst-rcvd', -80, 48)`);
  await a.frame(700, 4);
  await js(`__key(null); document.getElementById('f-submit').click()`);
  await sleep(250);
  await a.frame(1500, 4);
  await sleep(1300);
  await a.frame(2200, 5);
  a.finish();

  // B. A pileup: Space for the next one, Esc for one too many, Enter for all.
  // Filmed as the window itself, which scrolls to follow the row being typed.
  win.setContentSize(900, WINDOW_HEIGHT);
  await load();
  a = animation('pileup', 'window');
  const follow = sel => js(`(document.querySelector(${JSON.stringify(sel)}) || document.activeElement)` +
    `.scrollIntoView({ block: 'center' })`);
  await js(`__set('#f-callsign', 'UA9TEST')`);
  await lookedUp();
  await js(`document.getElementById('f-callsign').focus(); window.scrollTo(0, 0)`);
  await a.frame(1700, 1);
  await js(`__key('Space', '#f-callsign', 60)`);
  await a.frame(700, 2);
  await js(`__key(null); __press(' ', '#f-callsign')`);
  await sleep(100);
  await follow('.qso-group-row:nth-of-type(1)');
  await a.frame(900, 2);
  await typeSlowly(null, 'EW1TEST', a, 2, 150);
  await lookedUp();
  await a.frame(1500, 2);
  await js(`__key('Space', '.qso-group-row:nth-of-type(1) .qso-group-call', -100)`);
  await a.frame(700, 2);
  await js(`__key(null); __press(' ')`);
  await sleep(100);
  await follow('.qso-group-row:nth-of-type(2)');
  await a.frame(900, 2);
  await typeSlowly(null, 'DL1TEST', a, 2, 150);
  await lookedUp();
  await a.frame(1500, 2);
  await js(`__key('Space', '.qso-group-row:nth-of-type(2) .qso-group-call', -100)`);
  await a.frame(700, 3);
  await js(`__key(null); __press(' ')`);
  await sleep(100);
  await follow('.qso-group-row:nth-of-type(3)');
  await a.frame(1300, 3);
  await js(`__key('Esc', '.qso-group-row:nth-of-type(3) .qso-group-call', -100)`);
  await a.frame(900, 3);
  await js(`__key(null); __press('Escape')`);
  await sleep(150);
  await follow('.qso-group-row:nth-of-type(2)');
  await a.frame(1300, 3);
  await js(`__key('Enter', '.qso-group-row:nth-of-type(2) .qso-group-call', -100)`);
  await a.frame(800, 4);
  await js(`__key(null); __press('Enter')`);
  await sleep(250);
  await follow('.qso-submit-row');
  await a.frame(2600, 4);
  a.finish();
  win.setContentSize(900, 1900);
}

// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    const preload = path.join(PROFILE, 'mock-preload.js');
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(preload, MOCK_PRELOAD);

    win = new BrowserWindow({
      show: false, useContentSize: true, width: 900, height: 1900, enableLargerThanScreen: true,
      webPreferences: { contextIsolation: false, preload }
    });
    conv = new BrowserWindow({ show: false });
    await conv.loadURL('about:blank');

    lang = LANG;
    console.log(`[${lang}]`);
    fs.rmSync(path.join(HELP, 'img', lang), { recursive: true, force: true });
    await pictures();
    await animations();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
