// Перебрать значения постоянных и померить всё разом.
//   node scratchpad/cw/sweep.js ИМЯ=a,b,c [ИМЯ2=...]
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const APP = path.join(__dirname, 'classic-app.js');
const set = (n, v) => {
  let s = fs.readFileSync(APP, 'utf8');
  s = s.replace(new RegExp(`const ${n} = [0-9.]+;`), `const ${n} = ${v};`);
  fs.writeFileSync(APP, s);
};
const suite = () => (execFileSync('node', [path.join(__dirname, 'suite.js')]).toString().match(/разбор: ([0-9.]+)%/) || [, '?'])[1];
const real = () => {
  const out = execFileSync('node', [path.join(__dirname, 'real.js')]).toString();
  const known = (out.match(/в среднем: ([0-9.?]+)%/) || [, '?'])[1];
  const air = [...out.matchAll(/(\d+)\.wav: тон (\d+) Гц · (\d+) зн/g)].map(m => `${m[1]}:${m[3]}зн`).join(' ');
  return { known, air };
};
const names = process.argv.slice(2).map(a => a.split('='));
const combos = names.reduce((acc, [n, vals]) =>
  acc.flatMap(c => vals.split(',').map(v => [...c, [n, v]])), [[]]);
for (const combo of combos) {
  for (const [n, v] of combo) set(n, v);
  const r = real();
  console.log(`${combo.map(([n, v]) => `${n}=${v}`).join(' ')} → набор ${suite()}%  живые ${r.known}%  эфир ${r.air}`);
}
