// Что в записи: уровень, на какой частоте тон, как выглядит огибающая.
//   node scratchpad/cw/look.js файл.wav [тон]
const fs = require('fs');

function readWav(path) {
  const b = fs.readFileSync(path);
  let at = 12, dataAt = 0, dataLen = 0, rate = 48000, ch = 1, bits = 16;
  while (at < b.length - 8) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); bits = b.readUInt16LE(at + 22); }
    if (id === 'data') { dataAt = at + 8; dataLen = len; break; }
    at += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / (bits / 8) / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = dataAt + i * (bits / 8) * ch;
    x[i] = bits === 16 ? b.readInt16LE(o) / 32768 : bits === 32 ? b.readFloatLE(o) : (b.readUInt8(o) - 128) / 128;
  }
  return { x, rate, ch, bits };
}

function goertzel(s, from, n, f, rate) {
  const k = 2 * Math.cos(2 * Math.PI * f / rate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const v = s[from + i] + k * s1 - s2; s2 = s1; s1 = v; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
}

const { x, rate, ch, bits } = readWav(process.argv[2]);
console.log(`${(x.length / rate).toFixed(1)} с · ${rate} Гц · ${ch} кан · ${bits} бит`);

const win = Math.round(rate * 0.05);
let loud = 0, loudAt = 0, quiet = 1;
for (let i = 0; i + win < x.length; i += win) {
  let p = 0;
  for (let j = 0; j < win; j++) p += x[i + j] * x[i + j];
  const r = Math.sqrt(p / win);
  if (r > loud) { loud = r; loudAt = i; }
  if (r < quiet) quiet = r;
}
console.log(`громкость: самое громкое ${loud.toFixed(4)} (на ${(loudAt / rate).toFixed(1)} с), самое тихое ${quiet.toFixed(5)}`);

// Где тон: по секундам, самые заметные частоты
const n = Math.round(rate * 0.04);
const seen = new Map();
for (let sec = 0; sec + 1 < x.length / rate; sec += 2) {
  const at = Math.round(sec * rate);
  let best = [];
  for (let f = 200; f <= 2800; f += 20) {
    let m = 0;
    for (let k = 0; k < 10 && at + k * n + n < x.length; k++) m = Math.max(m, goertzel(x, at + k * n, n, f, rate));
    best.push([m, f]);
  }
  best.sort((a, b) => b[0] - a[0]);
  console.log(`  ${String(sec).padStart(2)} с: ` + best.slice(0, 3).map(([m, f]) => `${f} Гц ${(m * 1000).toFixed(1)}`).join('  '));
  for (const [m, f] of best.slice(0, 1)) seen.set(f, (seen.get(f) || 0) + m);
}
const tone = Number(process.argv[3]) || [...seen].sort((a, b) => b[1] - a[1])[0][0];
console.log(`тон для разбора: ${tone} Гц`);

// Огибающая на этом тоне, 5 мс на знак, в децибелах от максимума
const w = Math.round(rate * 0.01), hop = Math.round(rate * 0.005);
const from = Math.round((Number(process.argv[4]) || 1) * rate);
const env = [];
for (let i = from; i + w < Math.min(x.length, from + rate * 3); i += hop) env.push(goertzel(x, i, w, tone, rate));
const mx = Math.max(...env);
let line = '';
env.forEach((v, i) => {
  const db = 20 * Math.log10((v + 1e-12) / mx);
  line += db > -3 ? '9' : db > -6 ? '8' : db > -9 ? '7' : db > -12 ? '6' : db > -15 ? '5' : db > -20 ? '4' : db > -25 ? '3' : db > -30 ? '2' : db > -40 ? '1' : '.';
  if ((i + 1) % 100 === 0) { console.log('  ' + line); line = ''; }
});
if (line) console.log('  ' + line);
