// Эталонный разбор записи «в два прохода»: не в реальном времени, а по всей
// записи сразу — так можно выбрать порог и скорость по всему материалу.
// Нужен, чтобы получить верный текст живой записи и мерить по нему живой
// декодер.    node scratchpad/cw/offline.js файл.wav [тон]
const fs = require('fs');
const MORSE = { '.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I',
 '.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S',
 '-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z','-----':'0','.----':'1',
 '..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9',
 '.-.-.-':'.','--..--':',','..--..':'?','-..-.':'/','-...-':'=','.-.-.':'+','-....-':'-','...-.-':'<SK>' };

function readWav(p){ const b=fs.readFileSync(p); let at=12,dataAt=0,dataLen=0,rate=48000,ch=1;
  while(at<b.length-8){ const id=b.toString('ascii',at,at+4), len=b.readUInt32LE(at+4);
    if(id==='fmt '){ ch=b.readUInt16LE(at+10); rate=b.readUInt32LE(at+12); }
    if(id==='data'){ dataAt=at+8; dataLen=len; break; } at+=8+len+(len%2); }
  const n=Math.floor(dataLen/2/ch), x=new Float32Array(n);
  for(let i=0;i<n;i++) x[i]=b.readInt16LE(dataAt+i*2*ch)/32768; return {x,rate}; }
function g(s,from,n,f,rate){ const k=2*Math.cos(2*Math.PI*f/rate); let s1=0,s2=0;
  for(let i=0;i<n;i++){ const v=s[from+i]+k*s1-s2; s2=s1; s1=v; }
  return Math.sqrt(Math.max(0,s1*s1+s2*s2-k*s1*s2))/n; }

const {x,rate}=readWav(process.argv[2]);

// 1. Тон: та частота, что сильнее всего выделяется на фоне соседних.
let tone=Number(process.argv[3])||0;
if(!tone){ const n=Math.round(rate*0.04); let best=0;
  for(let f=250;f<=2700;f+=10){ let sum=0, cnt=0;
    for(let at=0; at+n<x.length; at+=Math.round(rate*0.25)){
      const here=g(x,at,n,f,rate);
      const beside=(g(x,at,n,f-250,rate)+g(x,at,n,f+250,rate))/2+1e-9;
      sum+=here/beside; cnt++; }
    const v=sum/cnt; if(v>best){ best=v; tone=f; } } }

// 2. Огибающая на этом тоне, в отношении к соседним частотам.
const w=Math.round(rate*0.010), hop=Math.round(rate*0.0025), hopMs=hop/rate*1000;
const env=[];
for(let i=0;i+w<x.length;i+=hop){
  const here=g(x,i,w,tone,rate);
  const beside=(g(x,i,w,tone-250,rate)+g(x,i,w,tone+250,rate))/2+1e-9;
  env.push(here/beside); }

// 3. Сгладить огибающую: убрать рябь, оставить форму посылок.
const smooth=[];
for(let i=0;i<env.length;i++){
  let sum=0, n=0;
  for(let k=-2;k<=2;k++){ const j=i+k; if(j>=0&&j<env.length){ sum+=env[j]; n++; } }
  smooth.push(sum/n); }

// 4. Порог — посередине между «тихо» и «громко» по всей записи.
const sorted=smooth.slice().sort((a,b)=>a-b);
const lo=sorted[Math.floor(sorted.length*0.2)], hi=sorted[Math.floor(sorted.length*0.9)];
const bestT=lo+(hi-lo)*0.5;

// 5. Длительности, с гистерезисом; слишком короткие всплески не считаются.
const raw=[]; let on=smooth[0]>bestT, since=0;
for(let i=1;i<smooth.length;i++){
  const v=smooth[i];
  if(!on && v>bestT*1.15){ raw.push(['gap',(i-since)*hopMs]); on=true; since=i; }
  else if(on && v<bestT*0.85){ raw.push(['mark',(i-since)*hopMs]); on=false; since=i; } }
raw.push([on?'mark':'gap',(smooth.length-since)*hopMs]);
// Склеить то, что короче 18 мс: это рябь, а не ключ.
const runs=[];
for(const r of raw){
  if(r[1]<18 && runs.length){ runs[runs.length-1][1]+=r[1]; continue; }
  if(runs.length && runs[runs.length-1][0]===r[0]) runs[runs.length-1][1]+=r[1];
  else runs.push([r[0],r[1]]); }

// Длина точки: короткая и длинная кучи вместе (тире = три точки).
const all=runs.map(r=>r[1]).filter(ms=>ms>=15&&ms<=2000).sort((a,b)=>a-b);
const mid=all[Math.floor(all.length/2)];
const shortOnes=all.filter(v=>v<=mid), longOnes=all.filter(v=>v>mid*1.8);
const fromShort=shortOnes[Math.floor(shortOnes.length/2)];
let dot=fromShort;
if(longOnes.length>=3){
  const dash=longOnes[Math.floor(longOnes.length/2)];
  if(dash/fromShort>=2 && dash/fromShort<=5.5) dot=(fromShort+dash/3)/2; }

// 6. Собственно разбор.
let text='', sym='';
for(const [kind,ms] of runs){
  if(kind==='mark'){ if(ms<dot*0.4) continue; sym += ms>dot*2 ? '-' : '.'; }
  else {
    if(ms>dot*2 && sym){ text += MORSE[sym]||'·'; sym=''; }
    if(ms>dot*5) text += ' '; } }
if(sym) text += MORSE[sym]||'·';

console.log(`тон ${tone} Гц · точка ${Math.round(dot)} мс (${Math.round(1200/dot)} зн/мин) · порог ${bestT.toFixed(2)}`);
console.log(JSON.stringify(text.trim()));
