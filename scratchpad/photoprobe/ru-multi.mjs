import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync(new URL('../../data/qrz-credentials.json', import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async u => (await fetch(u)).text();
const id = (await get(`https://api.qrz.ru/login?u=${encodeURIComponent(c.ruUsername)}&p=${encodeURIComponent(c.ruPassword)}&agent=qso-log`)).match(/<session_id>(.*?)</)[1];
for (const cs of process.argv.slice(2)) { await sleep(3500);
  const r = await get(`https://api.qrz.ru/callsign?id=${id}&callsign=${cs}`);
  const files = [...r.matchAll(/<file>(.*?)<\/file>/g)].map(m => m[1]);
  const block = (r.match(/<Files>[\s\S]*?<\/Files>/) || [''])[0].replace(/\s+/g, ' ').slice(0, 300);
  console.log(cs, files.length, cs === 'R2FEL' ? block : files.map(f => f.split('/').pop()).join(' ')); }
