// Что декодер намерил: длительности посылок и пауз подряд.
//   node scratchpad/cw/trace.js файл.wav [сколько строк]
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..','..','public','app.js');
let src=fs.readFileSync(APP,'utf8');
const start=src.indexOf('  const MORSE = {');
let code=src.slice(start); code=code.slice(0, code.search(/\n  let cw(Text|Items) /));
code=code.replace('    function mark(ms, snr) {','    function mark(ms, snr) {\n      if(global.LOG&&global.LOG.length<global.MAX) global.LOG.push(`посылка ${Math.round(ms)}  тон ${Math.round(d.tone)}  точка ${Math.round(d.dot)}`);');
code=code.replace('    function gap(ms) {','    function gap(ms) {\n      if(global.LOG&&global.LOG.length<global.MAX) global.LOG.push(`  пауза ${Math.round(ms)}`);');
code+='\n; module.exports={makeCwDecoder};';
const mod={exports:{}};
new Function('module','exports','station','escapeHtml','tr',code)(mod,mod.exports,{},s=>s,a=>a);
function readWav(p){ const b=fs.readFileSync(p); let at=12,dataAt=0,dataLen=0,rate=48000,ch=1;
  while(at<b.length-8){ const id=b.toString('ascii',at,at+4), len=b.readUInt32LE(at+4);
    if(id==='fmt '){ ch=b.readUInt16LE(at+10); rate=b.readUInt32LE(at+12); }
    if(id==='data'){ dataAt=at+8; dataLen=len; break; } at+=8+len+(len%2); }
  const n=Math.floor(dataLen/2/ch), x=new Float32Array(n);
  for(let i=0;i<n;i++) x[i]=b.readInt16LE(dataAt+i*2*ch)/32768; return {x,rate}; }
global.LOG=[]; global.MAX=Number(process.argv[3])||40;
const {x,rate}=readWav(process.argv[2]);
const dec=mod.exports.makeCwDecoder();
for(let i=0;i+2048<=x.length;i+=2048) dec.push(x.subarray(i,i+2048),rate);
console.log(global.LOG.join('\n'));
