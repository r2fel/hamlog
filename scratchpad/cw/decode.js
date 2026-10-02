// Прогнать запись через сам декодер программы:
//   node scratchpad/cw/decode.js файл.wav [путь к app.js]
const fs = require('fs'), path = require('path');
const APP = process.argv[3] || path.join(__dirname, 'classic-app.js');
const src = fs.readFileSync(APP, 'utf8');
const start = src.indexOf('  const MORSE = {');
let code = src.slice(start);
code = code.slice(0, code.search(/\n  let cw(Text|Items) /));
code += '\n; module.exports = { makeCwDecoder, MORSE };';
const mod = { exports: {} };
new Function('module', 'exports', 'station', 'escapeHtml', 'tr', code)(mod, mod.exports, {}, s => s, (a) => a);

function readWav(p) {
  const b = fs.readFileSync(p);
  let at = 12, dataAt = 0, dataLen = 0, rate = 48000, ch = 1;
  while (at < b.length - 8) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); }
    if (id === 'data') { dataAt = at + 8; dataLen = len; break; }
    at += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / 2 / ch), x = new Float32Array(n + rate);  // секунда тишины в конце
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(dataAt + i * 2 * ch) / 32768;
  return { x, rate };
}

const { x, rate } = readWav(process.argv[2]);
const dec = mod.exports.makeCwDecoder();
let out = '';
for (let i = 0; i + 2048 <= x.length; i += 2048) { dec.push(x.subarray(i, i + 2048), rate); out += dec.take(); }
console.log(`тон ${Math.round(dec.state.tone)} Гц · ${dec.state.wpm} зн/мин · точка ${Math.round(dec.state.dot)} мс`);
console.log(JSON.stringify(out.trim()));
