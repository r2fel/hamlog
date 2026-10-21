// Заглянуть внутрь мягкой оценки на одном случае стенда.
'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/bench.js', 'utf8');
const body = src.slice(src.indexOf('const MORSE = {'), src.indexOf('function runCase('));
const mod = {};
new Function('mod', 'require', body + '; mod.keying=keying; mod.render=render; mod.reseed=reseed;')(mod, require);
const m = require('./soft.js');
module.exports = (msg, opts, keyOpts) => {
  mod.reseed('probe', 0);
  return mod.render([{ text: msg, tone: 700, amp: 0.2, seq: mod.keying(msg, keyOpts || { jitter: 0.1 }) }], opts);
};
if (require.main === module) {
  const msg = 'CQ CQ CQ DE UA3ABC UA3ABC K';
  const r = module.exports(msg, JSON.parse(process.argv[2] || '{"snr":8,"wide":true}'));
  const tone = m.findTones(r.x, r.rate, 1)[0].tone;
  console.log('тон', tone);
  for (const mode of ['', 'llr']) {
    process.env.SOFT = mode;
    const sc = m.softScores(r.x, r.rate, tone, 16);
    const v = Array.from(sc.soft).sort((a, b) => a - b);
    const q = p => v[Math.floor(v.length * p)].toFixed(2);
    const pos = v.filter(x => x > 0).length / v.length;
    console.log(`${(mode || 'линейная').padEnd(9)} шум ${sc.noise.toExponential(2)} сигнал ${sc.amp.toExponential(2)} · доли: 5% ${q(0.05)} 25% ${q(0.25)} 50% ${q(0.5)} 75% ${q(0.75)} 95% ${q(0.95)} · «тон» в ${(pos * 100).toFixed(0)}% измерений`);
  }
}
