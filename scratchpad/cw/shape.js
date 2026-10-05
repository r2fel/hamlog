// Форма спада внутри паузы: по шагам 2,5 мс, в децибелах от посылки рядом.
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
const w=Math.round(rate*0.005),hop=Math.round(rate*0.0025);   // окно 5 мс
const env=[];for(let i=0;i+w<x.length;i+=hop)env.push(g(x,i,w,tone,rate));
const span=200;
const on=env.map((v,i)=>{let pk=0;for(let k=Math.max(0,i-span);k<Math.min(env.length,i+span);k++)pk=Math.max(pk,env[k]);return v>pk*0.5;});
const found=[];
let i=1;
while(i<env.length-1){
  if(on[i]){i++;continue;}
  let j=i;while(j<env.length&&!on[j])j++;
  const len=(j-i)*2.5;
  if(len>=250&&len<=600&&i>5) found.push([i,j,len]);
  i=j;
}
console.log(`тон ${tone} Гц · длинных пауз найдено ${found.length}`);
for(const [a,b,len] of found.slice(0,4)){
  const pk=env[a-1];
  let line=[];
  for(let k=a-2;k<Math.min(b+2,a+100);k+=4) line.push(Math.round(20*Math.log10((env[k]+1e-12)/pk)));
  console.log(`  пауза ${len.toFixed(0)} мс, каждые 10 мс: ${line.join(' ')}`);
}
