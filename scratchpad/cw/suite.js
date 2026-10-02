// Набор испытаний декодера: живая рука, почерк, разгон, замирания, шум, эхо.
// Считает, сколько текста восстановлено (по наибольшей общей подпоследовательности).
//   node scratchpad/cw/suite.js [путь к app.js]
const fs = require('fs'), path = require('path');
const APP = process.env.CWAPP || process.argv[2] || path.join(__dirname, 'classic-app.js');
const src = fs.readFileSync(APP, 'utf8');
const start = src.indexOf('  const MORSE = {');
let code = src.slice(start);
code = code.slice(0, code.search(/\n  let cw(Text|Items) /));
code += '\n; module.exports = { makeCwDecoder, MORSE };';
const mod = { exports: {} };
new Function('module', 'exports', 'station', 'escapeHtml', 'tr', code)(mod, mod.exports, {}, s => s, a => a);
const { makeCwDecoder, MORSE } = mod.exports;
const rev = {}; for (const k in MORSE) if (!rev[MORSE[k]]) rev[MORSE[k]] = k;

let seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 0.7; }

// `floor` — шум эфира в паузах: насколько тише посылки он звучит, в децибелах.
// В настоящем эфире пауза это не тишина, а шипение диапазона.
function gen(text, o = {}) {
  const rate = o.rate || 44100, wpm = o.wpm || 22, jitter = o.jitter || 0, weight = o.weight || 3;
  const drift = o.drift || 0, qsb = o.qsb || 0, qsbHz = o.qsbHz || 0.3, snrDb = o.snr === undefined ? 12 : o.snr;
  const tone = o.tone || 620, babble = o.babble || 0, reverb = o.reverb || 0, floorDb = o.floor || 0;
  const seq = [];
  for (const ch of text.toUpperCase()) {
    const dot = 1.2 / (wpm * (1 + drift * seq.length / (text.length * 6)));
    const j = () => 1 + jitter * gauss();
    if (ch === ' ') { seq.push([0, dot * 7 * j()]); continue; }
    const c = rev[ch]; if (!c) continue;
    for (let i = 0; i < c.length; i++) { seq.push([1, (c[i] === '.' ? dot : dot * weight) * j()]); seq.push([0, dot * j()]); }
    seq.push([0, dot * 2 * j()]);
  }
  const total = seq.reduce((a, b) => a + b[1], 0) + 0.5, n = Math.round(total * rate);
  const buf = new Float32Array(n), amp = Math.pow(10, snrDb / 20) * 0.02;
  const floor = floorDb ? Math.pow(10, -floorDb / 20) : 0;
  let at = Math.round(0.25 * rate);
  for (const [on, dur] of seq) {
    const len = Math.max(1, Math.round(dur * rate));
    for (let i = 0; i < len; i++) {
      const ramp = Math.min(1, Math.min(i, len - i) / (0.004 * rate));
      const fade = qsb ? Math.pow(10, -qsb / 20 * (0.5 + 0.5 * Math.sin(2 * Math.PI * qsbHz * (at + i) / rate))) : 1;
      // Шум диапазона сидит на той же частоте и никуда не девается в паузах.
      const band = floor ? floor * amp * (rnd() * 2 - 1) : 0;
      buf[at + i] += (on ? amp * ramp * fade * Math.sin(2 * Math.PI * tone * (at + i) / rate) : 0) + band;
    }
    at += len;
  }
  if (reverb) {
    const taps = []; for (let k = 0; k < 12; k++) taps.push([Math.round(rate * (0.004 + 0.05 * rnd())), reverb * 0.25 * Math.pow(0.65, k) * (0.5 + rnd())]);
    const dry = Float32Array.from(buf);
    for (const [d, g] of taps) for (let i = d; i < n; i++) buf[i] += g * dry[i - d];
  }
  for (let i = 0; i < n; i++) {
    buf[i] += 0.02 * (rnd() * 2 - 1);
    if (babble) {
      buf[i] += babble * 0.04 * Math.sin(2 * Math.PI * (90 + 40 * Math.sin(i / rate * 2)) * i / rate);
      if (rnd() < 0.00005) for (let k = 0; k < Math.round(rate * 0.05) && i + k < n; k++) buf[i + k] += babble * 0.12 * (rnd() * 2 - 1) * Math.exp(-k / (rate * 0.01));
    }
  }
  return { buf, rate };
}

function run(g) {
  const d = makeCwDecoder(); let out = '';
  for (let i = 0; i + 2048 <= g.buf.length; i += 2048) { d.push(g.buf.subarray(i, i + 2048), g.rate); out += d.take(); }
  const tail = new Float32Array(g.rate);          // секунда тишины: дочитать хвост
  d.push(tail, g.rate); out += d.take();
  return { out: out.trim(), wpm: d.state.wpm };
}
function score(got, want) {
  const a = got.toUpperCase().replace(/\s+/g, ' '), b = want.toUpperCase();
  let p = new Array(b.length + 1).fill(0), c = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) c[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], c[j - 1]);
    [p, c] = [c, p]; c.fill(0);
  }
  return p[b.length] / b.length;
}

const TEXT = process.env.CWTEXT || 'CQ CQ DE R2FEL R2FEL K';
const CASES = [
  ['ровная рука 20', { wpm: 20 }],
  ['ровная рука 30', { wpm: 30 }],
  ['живая рука ±20%', { wpm: 22, jitter: 0.2 }],
  ['живая рука ±35%', { wpm: 22, jitter: 0.35 }],
  ['тире 1:4', { wpm: 22, jitter: 0.15, weight: 4 }],
  ['тире 1:2', { wpm: 20, jitter: 0.15, weight: 2 }],
  ['разгон 20→30', { wpm: 20, drift: 0.5, jitter: 0.15 }],
  ['QSB 15 дБ', { wpm: 22, qsb: 15, jitter: 0.15 }],
  ['QSB 25 дБ', { wpm: 22, qsb: 25, qsbHz: 0.2, jitter: 0.15 }],
  ['слабый сигнал 3 дБ', { wpm: 22, snr: 3, jitter: 0.15 }],
  ['улица: гул и всплески', { wpm: 22, babble: 1, jitter: 0.15 }],
  ['эхо комнаты', { wpm: 22, reverb: 0.8, jitter: 0.15 }],
  // Настоящий эфир: в паузах не тишина, а шум диапазона
  ['эфир: фон −12 дБ', { wpm: 22, jitter: 0.2, floor: 12 }],
  ['эфир: фон −8 дБ', { wpm: 20, jitter: 0.2, floor: 8 }],
  ['эфир: фон −8 дБ + эхо', { wpm: 20, jitter: 0.2, floor: 8, reverb: 0.6 }],
  ['эфир: фон −8 дБ + QSB', { wpm: 22, jitter: 0.2, floor: 8, qsb: 12 }],
  ['всё сразу', { wpm: 24, jitter: 0.25, qsb: 12, babble: 0.7, reverb: 0.5, snr: 8, floor: 10 }]
];
let total = 0;
for (const [name, o] of CASES) {
  seed = 7;
  const r = run(gen(TEXT, o)), sc = score(r.out, TEXT);
  total += sc;
  console.log(`${(sc * 100).toFixed(0).padStart(3)}%  ${name.padEnd(24)} ${String(r.wpm).padStart(3)} зн/мин  ${JSON.stringify(r.out.slice(0, 48))}`);
}
console.log(`\nсредний разбор: ${(total / CASES.length * 100).toFixed(1)}%`);
