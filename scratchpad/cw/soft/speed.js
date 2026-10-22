// Какую скорость выбирает декодер на стенде при разной силе сигнала.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const src = fs.readFileSync(__dirname + '/bench.js', 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.wav=wav; mod.reseed=reseed; mod.MESSAGES=MESSAGES;')(mod, require);
const { decode } = require('./run.js');
const f = path.join(os.tmpdir(), 'sp.wav');
for (const snr of [10, -2, -5]) {
  const got = [];
  for (const [i, m] of mod.MESSAGES.entries()) {
    mod.reseed('speed' + snr, i);
    const r = mod.render([{ text: m, tone: 700, amp: 0.2, seq: mod.keying(m, { jitter: 0.1 }) }], { snr });
    fs.writeFileSync(f, mod.wav(r));
    got.push(decode(f).unit);
  }
  console.log(`  ${String(snr).padStart(3)} дБ: ${got.join(' ')}`);
}
