// Испытательный стенд по требованиям владельца (CLAUDE.md, «Цель»).
// Текст известен точно, условия меняются по одному — так видно, какое
// требование декодер выполняет, а какое нет. Сообщения написаны вручную
// и в корпус для обучения не входят.
//   node scratchpad/cw/soft/bench.js [только-эти-условия-через-запятую]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { decode } = require('./run.js');

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---',
  3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '?': '..--..',
  '/': '-..-.', '=': '-...-'
};

// Как разговаривают в эфире — но не из шаблонов корпуса.
const MESSAGES = [
  'CQ CQ CQ DE UA3ABC UA3ABC K',
  'UA3ABC DE DL2XYZ DL2XYZ K',
  'R TNX FER CALL UR RST 579 579 NAME HANS QTH MUNICH HW',
  'FB OM SOLID CPY RIG IC7300 ANT DIPOLE WX SUNNY 73 SK'
];

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.7;

/** Ключ: последовательность (тон есть/нет, длительность в секундах). */
function keying(text, o) {
  const wpm = o.wpm || 20, dot = 1.2 / wpm;
  const gapDot = o.farnsworth ? 1.2 / o.farnsworth : dot;    // промежутки по своей скорости
  const jit = () => 1 + (o.jitter || 0) * gauss();
  const seq = [];
  for (const ch of text) {
    if (ch === ' ') { seq.push([0, gapDot * 4 * jit()]); continue; }  // +3 после буквы = 7
    const code = MORSE[ch]; if (!code) continue;
    for (let i = 0; i < code.length; i++) {
      seq.push([1, (code[i] === '.' ? dot : dot * (o.dash || 3)) * jit()]);
      seq.push([0, dot * jit()]);
    }
    seq.push([0, gapDot * 2 * jit()]);
  }
  return seq;
}

/** Быстрое преобразование Фурье на месте (основание 2). */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Шум с ровной плотностью от lo до hi Гц и тишиной вне этой полосы. */
function flatNoise(n, rate, lo, hi) {
  let size = 1;
  while (size < n) size <<= 1;
  const re = new Float64Array(size), im = new Float64Array(size);
  const from = Math.max(1, Math.round(lo * size / rate)), to = Math.min(size / 2 - 1, Math.round(hi * size / rate));
  for (let k = from; k <= to; k++) {
    const g1 = gauss(), g2 = gauss();
    re[k] = g1; im[k] = g2; re[size - k] = g1; im[size - k] = -g2;
  }
  fft(re, im, true);
  return Float32Array.from(re.subarray(0, n));
}

/**
 * Звук: одна или две станции по очереди, шум полосы или широкий шум,
 * замирания. Уровень шума задан так, чтобы отношение сигнал/шум было
 * указано в полосе 500 Гц — как его обычно и называют.
 */
function render(parts, o) {
  const rate = 44100;
  let total = 0.4;
  for (const p of parts) for (const [, d] of p.seq) total += d;
  total += 0.3 * parts.length;
  const n = Math.round(total * rate), x = new Float32Array(n);
  let at = Math.round(0.2 * rate);
  for (const p of parts) {
    let phase = 0;
    for (const [on, dur] of p.seq) {
      const len = Math.max(1, Math.round(dur * rate));
      for (let i = 0; i < len && at + i < n; i++) {
        const ramp = Math.min(1, Math.min(i, len - i) / (0.004 * rate));
        const t = (at + i) / rate;
        const fade = o.qsb ? Math.pow(10, -o.qsb / 20 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t))) : 1;
        phase += 2 * Math.PI * p.tone / rate;
        if (on) x[at + i] += p.amp * ramp * fade * Math.sin(phase);
      }
      at += len;
    }
    at += Math.round(0.3 * rate);
  }
  // Шум: белый — это приём без фильтра; через фильтр — узкая полоса вокруг тона.
  const snr = o.snr === undefined ? 20 : o.snr;
  const sigPower = 0.5 * 0.2 * 0.2;                     // мощность синуса с амплитудой 0.2
  const band = o.wide ? 2500 : 500;
  // Мощность шума в 500 Гц должна быть sigPower / 10^(snr/10); белый шум
  // в полосе rate/2 даёт её с плотностью, растянутой на всю полосу.
  const noise500 = sigPower / Math.pow(10, snr / 10);
  const sigma = Math.sqrt(noise500 * (rate / 2) / 500);
  if (o.wide) {
    // Без фильтра: белый шум на всю полосу, той же плотности, что и
    // в 500 Гц, — то есть в двадцать с лишним раз мощнее в целом.
    let power = 0;
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) { w[i] = gauss(); power += w[i] * w[i]; }
    const k = Math.sqrt(noise500 * (rate / 2) / 500 / (power / n));
    for (let i = 0; i < n; i++) x[i] += k * w[i];
  } else {
    // Узкий фильтр — плоский, как у настоящего трансивера: шум задаётся
    // прямо по спектру, ровной плотностью в полосе 500 Гц вокруг тона.
    // Первые две версии фильтровали резонатором — сначала с неверным
    // усилением (шум на 20 дБ громче), потом с верным, но у резонатора горб
    // ровно на частоте тона: шум там был на 6–8 дБ гуще, чем в полосе, и
    // «−2 дБ» стенда на деле значили около −8 дБ.
    const z = flatNoise(n, rate, parts[0].tone - 250, parts[0].tone + 250);
    let power = 0;
    for (let i = 0; i < n; i++) power += z[i] * z[i];
    const k = Math.sqrt(noise500 / (power / n));
    for (let i = 0; i < n; i++) x[i] += k * z[i];
  }
  return { x, rate };
}

function wav({ x, rate }) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0.95 ? 0.95 / peak : 1;
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * k)) * 32767), 44 + i * 2);
  return b;
}

function lcs(a, b) {
  let p = new Array(b.length + 1).fill(0), c = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) c[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], c[j - 1]);
    [p, c] = [c, p]; c.fill(0);
  }
  return p[b.length];
}

// Условия — ровно пять требований владельца, каждое отдельно, плюс опора.
const CONDITIONS = [
  ['опора: чисто, 20 зн/мин',        m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, {}) }], {}]],
  ['1. почерк: дрожь ±25 %',         m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.25 }) }], {}]],
  ['1. почерк: тире 1:4,5',           m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { dash: 4.5, jitter: 0.1 }) }], {}]],
  ['1. паузы: Фарнсворт 25/12',      m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { wpm: 25, farnsworth: 12 }) }], {}]],
  ['1. быстро: 32 зн/мин',           m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { wpm: 32, jitter: 0.08 }) }], {}]],
  ['2. слабо: +3 дБ в 500 Гц',       m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 3 }]],
  ['2. очень слабо: −2 дБ',          m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: -2 }]],
  ['2. на пределе: −5 дБ',           m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: -5 }]],
  ['2. замирания 20 дБ',             m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 12, qsb: 20 }]],
  ['3. без фильтра: +8 дБ',          m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 8, wide: true }]],
  ['3. без фильтра: +2 дБ',          m => [[{ text: m, tone: 700, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 2, wide: true }]],
  ['4. расстройка: тон 1800 Гц',     m => [[{ text: m, tone: 1800, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 12 }]],
  ['4. расстройка: тон 2400 Гц',     m => [[{ text: m, tone: 2400, amp: 0.2, seq: keying(m, { jitter: 0.1 }) }], { snr: 12 }]],
  ['5. двое по очереди, ±80 Гц',     null]
];

/** Свой постоянный шум каждому случаю: иначе случай в полном и в
 *  частичном прогоне получал бы разный шум, и прогоны нельзя было бы
 *  сравнивать между собой. */
function reseed(name, i) {
  seed = 7;
  for (const ch of name + '#' + i) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
}

function runCase(name, make, wanted) {
  const file = path.join(os.tmpdir(), 'cwbench.wav');
  let sum = 0, shown = '';
  const runs = [];
  if (make) {
    for (const [mi, m] of MESSAGES.entries()) {
      reseed(name, mi);
      const [parts, o] = make(m);
      fs.writeFileSync(file, wav(render(parts, o)));
      const got = decode(file).text.toUpperCase();
      const sc = lcs(got, m) / m.length;
      sum += sc; runs.push(sc);
      if (!shown) shown = got;
    }
    return { score: sum / MESSAGES.length, shown };
  }
  // Двое по очереди: вызов одного на 700 Гц, ответ другого на 780 Гц и
  // своей скорости. Оба текста должны оказаться в разборе.
  for (let i = 0; i + 1 < MESSAGES.length; i += 2) {
    reseed(name, i);
    const a = MESSAGES[i], b = MESSAGES[i + 1];
    const parts = [
      { text: a, tone: 700, amp: 0.2, seq: keying(a, { wpm: 20, jitter: 0.1 }) },
      { text: b, tone: 780, amp: 0.15, seq: keying(b, { wpm: 24, jitter: 0.1 }) }
    ];
    fs.writeFileSync(file, wav(render(parts, { snr: 14 })));
    const d = decode(file);
    const got = d.text.toUpperCase();
    const want = a + ' ' + b;
    if (process.env.SHOW) for (const sg of d.segments) console.log(`      станция ${sg.station + 1} (${sg.tone} Гц) с ${sg.from.toFixed(1)} с: ${JSON.stringify(sg.text)}`);
    const sc = lcs(got, want) / want.length;
    sum += sc; runs.push(sc);
    if (!shown) shown = got;
  }
  return { score: sum / runs.length, shown };
}

const only = (process.argv[2] || '').split(',').filter(Boolean);
let total = 0, count = 0;
for (const [name, make] of CONDITIONS) {
  if (only.length && !only.some(k => name.includes(k))) continue;
  const r = runCase(name, make);
  total += r.score; count++;
  console.log(`  ${(r.score * 100).toFixed(0).padStart(3)}%  ${name.padEnd(30)} ${JSON.stringify(r.shown.slice(0, 50))}`);
}
console.log(`\n  в среднем ${(100 * total / count).toFixed(1)}% по ${count} условиям`);
