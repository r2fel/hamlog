// Насколько комната заполняет паузы эхом — главное число для микрофонного пути.
// Берёт огибающую на тоне, находит посылки и паузы и считает, на сколько
// децибел паузы проседают относительно посылок рядом.
//   node scratchpad/cw/room.js файл.wav [тон]
const fs = require('fs');
function readWav(p) {
  const b = fs.readFileSync(p);
  let at = 12, dataAt = 0, dataLen = 0, rate = 48000, ch = 1;
  while (at < b.length - 8) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); }
    if (id === 'data') { dataAt = at + 8; dataLen = len; break; }
    at += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / 2 / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(dataAt + i * 2 * ch) / 32768;
  return { x, rate };
}
function g(s, from, n, f, rate) {
  const k = 2 * Math.cos(2 * Math.PI * f / rate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const v = s[from + i] + k * s1 - s2; s2 = s1; s1 = v; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
}
const { x, rate } = readWav(process.argv[2]);
// Тон: самая заметная частота в полосе телеграфа.
let tone = Number(process.argv[3]) || 0;
if (!tone) {
  const n = Math.round(rate * 0.04);
  let best = 0;
  for (let f = 250; f <= 2700; f += 10) {
    let m = 0;
    for (let k = 0; k < 40; k++) { const at = Math.round(k * x.length / 42); if (at + n < x.length) m = Math.max(m, g(x, at, n, f, rate)); }
    if (m > best) { best = m; tone = f; }
  }
}
const w = Math.round(rate * 0.01), hop = Math.round(rate * 0.0025);
const env = [];
for (let i = 0; i + w < x.length; i += hop) env.push(g(x, i, w, tone, rate));
// Посылкой считается то, что громче половины местного пика; дном паузы —
// самое тихое место между двумя посылками.
const span = Math.round(500 / 2.5);   // полсекунды
const dips = [];
for (let i = span; i < env.length - span; i++) {
  let peak = 0;
  for (let k = i - span; k < i + span; k++) peak = Math.max(peak, env[k]);
  if (env[i] > peak * 0.7) continue;                    // это посылка
  if (env[i] > env[i - 1] || env[i] > env[i + 1]) continue;  // не дно
  if (peak < 1e-7) continue;
  dips.push(20 * Math.log10(env[i] / peak));
}
dips.sort((a, b) => a - b);
const at = p => dips.length ? dips[Math.floor(dips.length * p)].toFixed(1) : 'нет';
console.log(`тон ${tone} Гц · паузы проседают: типично ${at(0.5)} дБ · глубокие ${at(0.1)} дБ · мелкие ${at(0.9)} дБ`);
