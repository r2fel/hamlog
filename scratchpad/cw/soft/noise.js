// Шум не должен давать букв — та же проверка, что у нынешнего декодера.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { decode } = require('./run.js');

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.7;

const rate = 44100, SECONDS = 20;
const cases = [
  ['белый шум', i => 0.05 * gauss()],
  ['шипение диапазона', i => 0.05 * gauss() + 0.02 * Math.sin(2 * Math.PI * 700 * i / rate) * gauss()],
  ['сетевой гул 50 Гц', i => 0.04 * gauss() + 0.05 * Math.sin(2 * Math.PI * 50 * i / rate) + 0.02 * Math.sin(2 * Math.PI * 150 * i / rate)],
  ['далёкая несущая', i => 0.04 * gauss() + 0.012 * Math.sin(2 * Math.PI * 812 * i / rate)],
  ['атмосферные щелчки', i => 0.04 * gauss() + (rnd() < 0.0002 ? (rnd() * 2 - 1) * 0.8 : 0)],
  ['уличный гул', i => 0.05 * gauss() + 0.05 * Math.sin(2 * Math.PI * (90 + 40 * Math.sin(i / rate)) * i / rate)],
  ['эхо комнаты без сигнала', i => 0.05 * gauss() * (1 + 0.5 * Math.sin(2 * Math.PI * 0.7 * i / rate))],
  ['два шума и несущая', i => 0.06 * gauss() + 0.01 * Math.sin(2 * Math.PI * 640 * i / rate) + 0.01 * Math.sin(2 * Math.PI * 1180 * i / rate)]
];

const wav = (x, rate) => {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, x[i] * 32767)), 44 + i * 2);
  return b;
};

let leaked = 0;
for (const [name, make] of cases) {
  seed = 1;
  const n = rate * SECONDS, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = make(i);
  const file = path.join(os.tmpdir(), 'cwnoise.wav');
  fs.writeFileSync(file, wav(x, rate));
  const text = decode(file).text.trim();
  if (text) leaked++;
  console.log(`  ${text ? '✕' : '·'} ${name.padEnd(26)} ${text ? JSON.stringify(text.slice(0, 60)) : 'пусто'}`);
}
console.log(leaked ? `\n  утечка в ${leaked} из ${cases.length}` : `\n  чисто: ${cases.length} из ${cases.length} молчат`);
