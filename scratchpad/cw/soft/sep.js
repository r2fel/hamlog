// Сколько уверенности набирает настоящая точка и настоящая пауза, если
// знать, где они на самом деле. Это и есть то, с чем работает перебор:
// если суммы по точке и по паузе перекрываются, никакой перебор не спасёт.
'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/bench.js', 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.reseed=reseed;')(mod, require);
const m = require('./soft.js');

const snr = Number(process.argv[2] || -2), win = Number(process.argv[3] || 32), shift = Number(process.argv[4] || 0);
const msg = 'CQ CQ CQ DE UA3ABC UA3ABC K FB OM SOLID CPY RIG IC7300 ANT DIPOLE';
mod.reseed('sep' + snr, 0);
const seq = mod.keying(msg, { jitter: 0.1 });
const r = mod.render([{ text: msg, tone: 700, amp: 0.2, seq }], { snr });
const sc = m.softScores(r.x, r.rate, 700, win);

// Где на самом деле посылки и паузы: ключ начинается через 0,2 с.
// Шаг — ровно столько отсчётов, сколько берёт soft.js: на 44,1 кГц это 110,
// то есть 2,4943 мс, а не 2,5. Первая версия считала 2,5, и к 25-й секунде
// разметка уезжала на целую точку — «плохие точки» на чистом сигнале.
const HOP = Math.round(r.rate * 2.5 / 1000) / r.rate;
let t = 0.2;
const groups = { 'точка': [], 'тире': [], 'пауза в букве': [] };
const unit = 1.2 / 20;
for (const [on, dur] of seq) {
  const a = Math.round(t / HOP), b = Math.round((t + dur) / HOP);
  let sum = 0;
  // shift — сдвиг в измерениях: окно, начавшееся в i, описывает звук около i + окно/2.
  for (let i = a - shift; i < b - shift && i < sc.soft.length; i++) if (i >= 0) sum += sc.soft[i];
  if (on) (dur < unit * 2 ? groups['точка'] : groups['тире']).push(sum);
  else if (dur < unit * 1.8) groups['пауза в букве'].push(sum);
  t += dur;
}
const stat = a => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  const wrong = a.filter(v => (mean > 0 ? v < 0 : v > 0)).length;
  return `среднее ${mean.toFixed(1).padStart(6)} · разброс ${sd.toFixed(1).padStart(5)} · не того знака ${wrong} из ${a.length}`;
};
console.log(`снр ${snr} дБ, окно ${win} мс, сдвиг ${shift} · оценки: σ=${sc.noise.toExponential(2)} ν=${sc.amp.toExponential(2)}`);
for (const [k, a] of Object.entries(groups)) console.log(`  ${k.padEnd(14)} ${stat(a)}`);
