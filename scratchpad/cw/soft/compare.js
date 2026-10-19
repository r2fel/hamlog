// Одна запись через оба декодера: прежний (app.js), новый целиком и новый на ходу.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const soft = require('../../../public/cw-soft.js');
const m = require('./soft.js');
const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'app.js'), 'utf8');
const from = app.indexOf('  const CW_WORDS = {');
const words = [...app.slice(from, app.indexOf('\n  };', from)).matchAll(/^\s+'?([A-Z0-9?]+)'?:/gm)].map(x => x[1]);
const adif = process.env.CW_LOG ? fs.readFileSync(process.env.CW_LOG, 'latin1') : '';
const grab = f => { const out = []; const re = new RegExp(`<${f}:(\\d+)[^>]*>`, 'gi'); let mm; while ((mm = re.exec(adif))) out.push(adif.substr(mm.index + mm[0].length, Number(mm[1])).trim()); return out; };
const given = { words, calls: grab('CALL'), names: grab('NAME'), places: grab('QTH').concat(grab('COUNTRY')) };

const file = process.argv[2];
const { x, rate } = m.readWav(file);
const old = execFileSync('node', [path.join(__dirname, '..', 'decode.js'), file]).toString().trim().split('\n');
console.log(`ПРЕЖНИЙ (${old[0]}):\n  ${old[1]}`);
const whole = soft.decodeSamples(x, rate, { knowledge: soft.makeKnowledge(given) });
console.log(`НОВЫЙ, целиком (тоны ${whole.tones.join(', ')}; главная ${whole.tone} Гц, ${whole.wpm} зн/мин):`);
for (const sg of whole.segments) console.log(`  [${sg.from.toFixed(1).padStart(5)} с · ${sg.tone} Гц] ${sg.text}`);
const st = soft.makeStream({ knowledge: given });
const live = [];
for (let i = 0; i < x.length; i += 2048) live.push(...st.push(x.subarray(i, Math.min(x.length, i + 2048)), rate));
live.push(...st.flush());
console.log(`НОВЫЙ, на ходу (станции: ${st.stations.map(s => `${s.tone} Гц ${s.wpm} зн/мин`).join(', ')}):`);
for (const sg of live) console.log(`  [${sg.at.toFixed(1).padStart(5)} с · ст.${sg.station + 1}] ${sg.text}`);
