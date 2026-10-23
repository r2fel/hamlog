// Как выглядит сигнал глазами декодера: отношение тона к соседним частотам.
//   node scratchpad/cw/snr.js файл.wav тон [с какой секунды]
const fs=require('fs');
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
const tone=Number(process.argv[3]), from=Math.round((Number(process.argv[4])||1)*rate);
const w=Math.round(rate*0.012), hop=Math.round(rate*0.0025);
const snr=[];
for(let i=from;i+w<Math.min(x.length, from+rate*4);i+=hop){
  const here=g(x,i,w,tone,rate);
  const beside=(g(x,i,w,tone-260,rate)+g(x,i,w,tone+260,rate))/2+1e-9;
  snr.push(here/beside);
}
const sorted=snr.slice().sort((a,b)=>a-b);
const q=p=>sorted[Math.floor(sorted.length*p)].toFixed(1);
console.log(`отношение тон/соседи: 10% ${q(0.1)}  половина ${q(0.5)}  90% ${q(0.9)}  максимум ${sorted[sorted.length-1].toFixed(1)}`);
let line='';
snr.forEach((v,i)=>{ line += v>8?'9':v>5?'7':v>3.5?'5':v>2.5?'4':v>1.8?'3':v>1.3?'2':v>1?'1':'.';
  if((i+1)%100===0){ console.log('  '+line); line=''; } });
if(line) console.log('  '+line);
