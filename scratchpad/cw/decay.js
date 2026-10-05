// Глубина провала в зависимости от длины паузы. Комната гасит звук
// по экспоненте, то есть каждые N мс отнимают одинаковое число децибел;
// обработка звука (автогромкость) так себя не ведёт.
//   node scratchpad/cw/decay.js файл.wav [тон]
const fs=require('fs');
function readWav(p){const b=fs.readFileSync(p);let at=12,dataAt=0,dataLen=0,rate=48000,ch=1;
 while(at<b.length-8){const id=b.toString('ascii',at,at+4),len=b.readUInt32LE(at+4);
  if(id==='fmt '){ch=b.readUInt16LE(at+10);rate=b.readUInt32LE(at+12);}
  if(id==='data'){dataAt=at+8;dataLen=len;break;} at+=8+len+(len%2);}
 const n=Math.floor(dataLen/2/ch),x=new Float32Array(n);
 for(let i=0;i<n;i++)x[i]=b.readInt16LE(dataAt+i*2*ch)/32768;return{x,rate};}
function g(s,from,n,f,rate){const k=2*Math.cos(2*Math.PI*f/rate);let s1=0,s2=0;
 for(let i=0;i<n;i++){const v=s[from+i]+k*s1-s2;s2=s1;s1=v;}
 return Math.sqrt(Math.max(0,s1*s1+s2*s2-k*s1*s2))/n;}
const {x,rate}=readWav(process.argv[2]);
const tone=Number(process.argv[3])||700;
const w=Math.round(rate*0.01),hop=Math.round(rate*0.0025);
const env=[];for(let i=0;i+w<x.length;i+=hop)env.push(g(x,i,w,tone,rate));
// Посылки: громче половины местного пика. Паузы между ними — их длина и дно.
const span=200;
const on=env.map((v,i)=>{let pk=0;for(let k=Math.max(0,i-span);k<Math.min(env.length,i+span);k++)pk=Math.max(pk,env[k]);
 return v>pk*0.5;});
const buckets={};
let i=0;
while(i<env.length){
  if(on[i]){i++;continue;}
  let j=i;while(j<env.length&&!on[j])j++;
  const len=(j-i)*2.5;
  if(i>0&&j<env.length&&len>=10&&len<=700){
    let low=Infinity;for(let k=i;k<j;k++)low=Math.min(low,env[k]);
    const pk=Math.max(env[i-1],env[j]);
    if(pk>1e-7){
      const db=20*Math.log10(low/pk);
      const b=Math.round(len/50)*50;
      (buckets[b]=buckets[b]||[]).push(db);
    }
  }
  i=j;
}
const out=Object.keys(buckets).map(Number).sort((a,b)=>a-b)
  .filter(b=>buckets[b].length>=3)
  .map(b=>{const a=buckets[b].slice().sort((p,q)=>p-q);return `${b} мс: ${a[Math.floor(a.length/2)].toFixed(0)} дБ (${a.length})`;});
console.log('  ' + (out.join('  ') || 'мало данных'));
