// Опыт с подсказками: где декодер теряет больше всего.
// Декодеру по очереди дают верный ответ на одну из неизвестных — тон,
// скорость, уровни, — и смотрят, сколько он прочтёт. Где подсказка даёт
// больше всего, там и главная потеря. Так ищут, а не гадают.
//   node scratchpad/cw/soft/oracle.js [снр] [широко=0/1]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const src = fs.readFileSync(__dirname + '/bench.js', 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.wav=wav; mod.reseed=reseed; mod.lcs=lcs; mod.MESSAGES=MESSAGES;')(mod, require);

const snr = Number(process.argv[2] || -2), wide = process.argv[3] === '1';
const file = path.join(os.tmpdir(), 'oracle.wav');

// Подсказки передаются в разбор через переменные окружения — их читает run.js.
const STAGES = [
  ['без подсказок', {}],
  ['+ верный тон', { ORACLE_TONE: '700' }],
  ['+ тон и скорость', { ORACLE_TONE: '700', ORACLE_UNIT: '24', ORACLE_SPACE: '1' }],
  ['+ тон, скорость, без ворот', { ORACLE_TONE: '700', ORACLE_UNIT: '24', ORACLE_SPACE: '1', MIN_SHARP: '0', MIN_SWING: '0', MIN_RATIO: '0' }],
];

for (const [name, envs] of STAGES) {
  for (const k of ['ORACLE_TONE', 'ORACLE_UNIT', 'ORACLE_SPACE', 'MIN_SHARP', 'MIN_SWING', 'MIN_RATIO']) delete process.env[k];
  Object.assign(process.env, envs);
  for (const k of Object.keys(require.cache)) if (k.includes('/soft/')) delete require.cache[k];
  const { decode } = require('./run.js');
  let sum = 0;
  for (const [i, m] of mod.MESSAGES.entries()) {
    mod.reseed('oracle' + snr, i);
    const r = mod.render([{ text: m, tone: 700, amp: 0.2, seq: mod.keying(m, { jitter: 0.1 }) }], { snr, wide });
    fs.writeFileSync(file, mod.wav(r));
    sum += mod.lcs(decode(file).text.toUpperCase(), m) / m.length;
  }
  console.log(`  ${(100 * sum / mod.MESSAGES.length).toFixed(0).padStart(3)}%  ${name}`);
}
