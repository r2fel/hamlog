// Слитное «TEST + позывной»: что выдаёт программный декодер (public/cw-soft.js) на записи.
// Запуск: node scratchpad/cw/soft/glue-check.js [файл.wav ...]
'use strict';
const fs = require('fs'), path = require('path');
const m = require('./soft.js');
const soft = require('../../../public/cw-soft.js');
const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'app.js'), 'utf8');
const from = app.indexOf('  const CW_WORDS = {');
const words = [...app.slice(from, app.indexOf('\n  };', from)).matchAll(/^\s+'?([A-Z0-9?]+)'?:/gm)].map(x => x[1]);
const knowledge = soft.makeKnowledge({ words, calls: [], names: [], places: [] });
const R = p => path.join(__dirname, '..', 'records', p);
const files = process.argv.length > 2 ? process.argv.slice(2) : [R('air-test-rd3zo.wav')];
for (const f of files) {
  const { x, rate } = m.readWav(f);
  console.log(path.basename(f) + ': ' + JSON.stringify(soft.decodeSamples(x, rate, { knowledge }).text));
}
