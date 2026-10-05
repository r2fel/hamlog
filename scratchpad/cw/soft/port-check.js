// Перенос точный? Одни и те же записи — через образец (run.js) и через
// файл программы (public/cw-soft.js). Тексты должны совпасть.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.NO_BIG_DICT = '1';           // в программу большой словарь не едет
const { decode } = require('./run.js');
const soft = require('../../../public/cw-soft.js');
const m = require('./soft.js');

// То, что страница передаст декодеру: сокращения из CW_WORDS и журнал.
const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'app.js'), 'utf8');
const from = app.indexOf('  const CW_WORDS = {');
const words = [...app.slice(from, app.indexOf('\n  };', from)).matchAll(/^\s+'?([A-Z0-9?]+)'?:/gm)].map(x => x[1]);
const adif = process.env.CW_LOG ? fs.readFileSync(process.env.CW_LOG, 'latin1') : '';
const grab = f => { const out = []; const re = new RegExp(`<${f}:(\\d+)[^>]*>`, 'gi'); let mm; while ((mm = re.exec(adif))) out.push(adif.substr(mm.index + mm[0].length, Number(mm[1])).trim()); return out; };
const knowledge = soft.makeKnowledge({ words, calls: grab('CALL'), names: grab('NAME'), places: grab('QTH').concat(grab('COUNTRY')) });

const R = p => path.join(__dirname, '..', 'records', p);
const files = ['morse-code.wav', 'cw-heard-2026-09-30.wav', 'air-cable-sm0aom.wav', 'air-mic-eu1.wav', 'air-mic-oct01-1.wav', 'air-mic-loud-1.wav', 'air-mic-loud-2.wav'].map(R);

// И случаи стенда.
const src = fs.readFileSync(path.join(__dirname, 'bench.js'), 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.wav=wav; mod.reseed=reseed;')(mod, require);
const bench = [
  ['слабо −2', { snr: -2 }, 700, 'R TNX FER CALL UR RST 579 579 NAME HANS QTH MUNICH HW'],
  ['без фильтра +2', { snr: 2, wide: true }, 700, 'CQ CQ CQ DE UA3ABC UA3ABC K'],
  ['тон 2400', { snr: 12 }, 2400, 'FB OM SOLID CPY RIG IC7300 ANT DIPOLE WX SUNNY 73 SK']
];
for (const [name, o, tone, msg] of bench) {
  mod.reseed('port' + name, 0);
  const f = path.join(os.tmpdir(), `port-${tone}-${o.snr}.wav`);
  fs.writeFileSync(f, mod.wav(mod.render([{ text: msg, tone, amp: 0.2, seq: mod.keying(msg, { jitter: 0.1 }) }], o)));
  files.push(f);
}

let same = 0;
for (const f of files) {
  const a = decode(f).text;
  const { x, rate } = m.readWav(f);
  const t0 = Date.now();
  const b = soft.decodeSamples(x, rate, { knowledge }).text;
  const ms = Date.now() - t0;
  const ok = a === b;
  if (ok) same++;
  console.log(`  ${ok ? '=' : '≠'} ${path.basename(f).padEnd(26)} ${(x.length / rate).toFixed(0).padStart(4)} с звука · ${(ms / 1000).toFixed(1).padStart(5)} с разбора`);
  if (!ok) { console.log(`      образец: ${JSON.stringify(a)}`); console.log(`      перенос: ${JSON.stringify(b)}`); }
}
console.log(`\n  совпало ${same} из ${files.length}`);
