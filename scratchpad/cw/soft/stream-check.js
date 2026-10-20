// Чтение на ходу против чтения целиком: те же записи подаются кусками по
// 2048 отсчётов, как их подаёт микрофон.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const soft = require('../../../public/cw-soft.js');
const m = require('./soft.js');

const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'app.js'), 'utf8');
const from = app.indexOf('  const CW_WORDS = {');
const words = [...app.slice(from, app.indexOf('\n  };', from)).matchAll(/^\s+'?([A-Z0-9?]+)'?:/gm)].map(x => x[1]);
const adif = process.env.CW_LOG ? fs.readFileSync(process.env.CW_LOG, 'latin1') : '';
const grab = f => { const out = []; const re = new RegExp(`<${f}:(\\d+)[^>]*>`, 'gi'); let mm; while ((mm = re.exec(adif))) out.push(adif.substr(mm.index + mm[0].length, Number(mm[1])).trim()); return out; };
const given = { words, calls: grab('CALL'), names: grab('NAME'), places: grab('QTH').concat(grab('COUNTRY')) };
const knowledge = soft.makeKnowledge(given);

function lcs(a, b) {
  let p = new Array(b.length + 1).fill(0), c = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) c[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], c[j - 1]);
    [p, c] = [c, p]; c.fill(0);
  }
  return p[b.length];
}

const R = p => path.join(__dirname, '..', 'records', p);
const KNOWN = [
  [R('morse-code.wav'), 'ND ROSCOSMOS COSMONAUT SERGEY TETERYATNIKOV TO THE INTERNATIONAL SPACE STATION'],
  [R('cw-heard-2026-09-30.wav'), 'NASA TO HOST A PRELAUNCH NEWS CONFERENCE ON THE AGEN'],
  [R('air-cable-sm0aom.wav'), 'CQ CQ CQ DE SM0AOM SM0AOM'],
  [R('air-mic-eu1.wav'), 'ZDR UR RST 599 5NN MY NAME IS ALEX ALEX OK? BK'],
  [R('air-mic-oct01-1.wav'), 'SP9XKX SP9XKX'],
  [R('air-mic-loud-1.wav'), 'NAME KARI KARI LOHJA'],
  [R('air-mic-loud-2.wav'), 'WX CLEAR TEMP']
];

// И двое по очереди со стенда — это главное, что даёт новый декодер.
const src = fs.readFileSync(path.join(__dirname, 'bench.js'), 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.wav=wav; mod.reseed=reseed;')(mod, require);
{
  const a = 'CQ CQ CQ DE UA3ABC UA3ABC K', b = 'UA3ABC DE DL2XYZ DL2XYZ K';
  mod.reseed('stream-two', 0);
  const f = path.join(os.tmpdir(), 'stream-two.wav');
  fs.writeFileSync(f, mod.wav(mod.render([
    { text: a, tone: 700, amp: 0.2, seq: mod.keying(a, { wpm: 20, jitter: 0.1 }) },
    { text: b, tone: 780, amp: 0.15, seq: mod.keying(b, { wpm: 24, jitter: 0.1 }) }], { snr: 14 })));
  KNOWN.push([f, a + ' ' + b]);
}

let sumWhole = 0, sumLive = 0;
for (const [file, want] of KNOWN) {
  const { x, rate } = m.readWav(file);
  const whole = soft.decodeSamples(x, rate, { knowledge }).text;
  const stream = soft.makeStream({ knowledge: given });
  const segs = [];
  let slowest = 0;
  for (let i = 0; i < x.length; i += 2048) {
    const t0 = Date.now();
    segs.push(...stream.push(x.subarray(i, Math.min(x.length, i + 2048)), rate));
    slowest = Math.max(slowest, Date.now() - t0);
  }
  segs.push(...stream.flush());
  let live = '', prev = -1;
  for (const sg of segs) { if (prev !== -1 && sg.station !== prev) live += ' |'; live += ' ' + sg.text; prev = sg.station; }
  live = live.trim();
  const a = lcs(whole.toUpperCase(), want) / want.length, b = lcs(live.toUpperCase(), want) / want.length;
  sumWhole += a; sumLive += b;
  console.log(`  целиком ${(a * 100).toFixed(0).padStart(3)}% · на ходу ${(b * 100).toFixed(0).padStart(3)}% · самый долгий разбор ${(slowest / 1000).toFixed(1)} с  ${path.basename(file)}`);
  if (Math.abs(a - b) > 0.02) console.log(`      целиком: ${JSON.stringify(whole)}\n      на ходу: ${JSON.stringify(live)}`);
}
console.log(`\n  целиком ${(100 * sumWhole / KNOWN.length).toFixed(1)}% · на ходу ${(100 * sumLive / KNOWN.length).toFixed(1)}%`);
