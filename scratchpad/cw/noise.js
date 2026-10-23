// Шум не должен давать букв. Восемь прогонов: белый шум, шипение диапазона,
// сетевой гул, далёкая несущая, атмосферные щелчки, уличный гул, эхо комнаты.
// Один прогон ничего не доказывает: утечка появляется через раз.
//   node scratchpad/cw/noise.js [путь к app.js]
const fs = require('fs'), path = require('path');
const APP = process.env.CWAPP || process.argv[2] || path.join(__dirname, 'classic-app.js');
const src = fs.readFileSync(APP, 'utf8');
const start = src.indexOf('  const MORSE = {');
let code = src.slice(start);
code = code.slice(0, code.search(/\n  let cw(Text|Items) /));
code += '\n; module.exports = { makeCwDecoder, MORSE };';
const mod = { exports: {} };
new Function('module', 'exports', 'station', 'escapeHtml', 'tr', code)(mod, mod.exports, {}, s => s, a => a);

let seed = 1;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 0.7; }

const rate = 44100, SECONDS = 20;
const cases = [
  { name: 'белый шум', make: () => 0.05 * gauss() },
  { name: 'шипение диапазона', make: (i) => 0.05 * gauss() + 0.02 * Math.sin(2 * Math.PI * 700 * i / rate) * gauss() },
  { name: 'сетевой гул 50 Гц', make: (i) => 0.04 * gauss() + 0.05 * Math.sin(2 * Math.PI * 50 * i / rate) + 0.02 * Math.sin(2 * Math.PI * 150 * i / rate) },
  { name: 'далёкая несущая', make: (i) => 0.04 * gauss() + 0.012 * Math.sin(2 * Math.PI * 812 * i / rate) },
  { name: 'атмосферные щелчки', make: (i) => 0.04 * gauss() + (rnd() < 0.0002 ? (rnd() * 2 - 1) * 0.8 : 0) },
  { name: 'уличный гул', make: (i) => 0.05 * gauss() + 0.05 * Math.sin(2 * Math.PI * (90 + 40 * Math.sin(i / rate)) * i / rate) },
  { name: 'эхо комнаты без сигнала', make: (i) => 0.05 * gauss() * (1 + 0.5 * Math.sin(2 * Math.PI * 0.7 * i / rate)) },
  { name: 'два шума и несущая', make: (i) => 0.06 * gauss() + 0.01 * Math.sin(2 * Math.PI * 640 * i / rate) + 0.01 * Math.sin(2 * Math.PI * 1180 * i / rate) },
];

let leaked = 0;
for (const c of cases) {
  seed = 1;
  const n = rate * SECONDS, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = c.make(i);
  const dec = mod.exports.makeCwDecoder();
  let out = '';
  for (let i = 0; i + 2048 <= n; i += 2048) { dec.push(x.subarray(i, i + 2048), rate); out += dec.take(); }
  out = out.trim();
  if (out) leaked++;
  console.log(`  ${out ? '✕' : '·'} ${c.name.padEnd(26)} ${out ? JSON.stringify(out.slice(0, 60)) : 'пусто'}`);
}
console.log(leaked ? `\n  утечка в ${leaked} из ${cases.length}` : `\n  чисто: ${cases.length} из ${cases.length} молчат`);
