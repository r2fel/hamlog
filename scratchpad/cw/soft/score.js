// Счёт мягкого декодера по записям с известным текстом — рядом с нынешним.
//   node scratchpad/cw/soft/score.js
'use strict';
const path = require('path'), { execFileSync } = require('child_process');
const { decode } = require('./run.js');
const R = p => path.join(__dirname, '..', 'records', p);

const KNOWN = [
  [R('morse-code.wav'), 'ND ROSCOSMOS COSMONAUT SERGEY TETERYATNIKOV TO THE INTERNATIONAL SPACE STATION'],
  [R('cw-heard-2026-09-30.wav'), 'NASA TO HOST A PRELAUNCH NEWS CONFERENCE ON THE AGEN'],
  [R('air-cable-sm0aom.wav'), 'CQ CQ CQ DE SM0AOM SM0AOM'],
  [R('air-mic-eu1.wav'), 'ZDR UR RST 599 5NN MY NAME IS ALEX ALEX OK? BK'],
  [R('air-mic-oct01-1.wav'), 'SP9XKX SP9XKX'],
  [R('air-mic-loud-1.wav'), 'NAME KARI KARI LOHJA'],
  [R('air-mic-loud-2.wav'), 'WX CLEAR TEMP']
];

function lcs(a, b) {
  let p = new Array(b.length + 1).fill(0), c = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) c[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], c[j - 1]);
    [p, c] = [c, p]; c.fill(0);
  }
  return p[b.length];
}

const old = f => {
  const out = execFileSync('node', [path.join(__dirname, '..', 'decode.js'), f]).toString();
  return (out.match(/"(.*)"/) || [, ''])[1];
};

let sumNew = 0, sumOld = 0;
for (const [file, want] of KNOWN) {
  const got = decode(file).text.toUpperCase();
  const a = lcs(got, want) / want.length, b = lcs(old(file).toUpperCase(), want) / want.length;
  sumNew += a; sumOld += b;
  console.log(`  ${(a * 100).toFixed(0).padStart(3)}% против ${(b * 100).toFixed(0).padStart(3)}%  ${path.basename(file)}`);
  console.log(`        ${JSON.stringify(got.slice(0, 92))}`);
}
console.log(`\n  мягкий ${(100 * sumNew / KNOWN.length).toFixed(1)}%  ·  нынешний ${(100 * sumOld / KNOWN.length).toFixed(1)}%`);
