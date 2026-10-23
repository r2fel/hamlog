// Что справочники отдают про фото. Логины — из data/qrz-credentials.json, на экран не выводятся.
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync(new URL('../../data/qrz-credentials.json', import.meta.url)));
const calls = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].trim() : ''; };
const names = x => [...new Set([...x.matchAll(/<([a-z_0-9]+)>/gi)].map(m => m[1]))];
const pics = x => [...x.matchAll(/<([a-z_0-9]*(?:pic|image|photo|img|file|foto|avatar)[a-z_0-9]*)>([\s\S]*?)<\/\1>/gi)].map(m => `${m[1]}=${m[2].trim().slice(0, 160)}`);
const get = async u => (await fetch(u, { headers: { 'user-agent': 'R2FEL-HamLog-probe' } })).text();
const out = {};
// HamQTH
try {
  const x = await get(`https://www.hamqth.com/xml.php?u=${encodeURIComponent(c.hamUsername)}&p=${encodeURIComponent(c.hamPassword)}`);
  const id = tag(x, 'session_id');
  for (const cs of calls) { const r = await get(`https://www.hamqth.com/xml.php?id=${id}&callsign=${cs}&prg=R2FEL-HamLog`);
    (out[cs] ||= {}).hamqth = tag(r, 'error') ? 'ошибка: ' + tag(r, 'error') : pics(r); }
  console.log('HamQTH поля:', names(await get(`https://www.hamqth.com/xml.php?id=${id}&callsign=${calls[0]}&prg=R2FEL-HamLog`)).join(' '));
} catch (e) { console.log('HamQTH:', e.message); }
// QRZ.com
try {
  const x = await get(`https://xmldata.qrz.com/xml/current/?username=${encodeURIComponent(c.comUsername)};password=${encodeURIComponent(c.comPassword)}`);
  const key = tag(x, 'Key'); console.log('QRZ.com подписка:', tag(x, 'SubExp') || '—', tag(x, 'Message') || '');
  for (const cs of calls) { const r = await get(`https://xmldata.qrz.com/xml/current/?s=${key};callsign=${cs}`);
    (out[cs] ||= {}).qrzcom = tag(r, 'Error') ? 'ошибка: ' + tag(r, 'Error') : pics(r);
    if (cs === calls[0]) console.log('QRZ.com поля:', names(r).join(' ')); }
} catch (e) { console.log('QRZ.com:', e.message); }
// QRZ.RU (не чаще раза в 3 с)
try {
  const x = await get(`https://api.qrz.ru/login?u=${encodeURIComponent(c.ruUsername)}&p=${encodeURIComponent(c.ruPassword)}&agent=qso-log`);
  const id = tag(x, 'session_id');
  for (const cs of calls) { await sleep(3500); const r = await get(`https://api.qrz.ru/callsign?id=${id}&callsign=${cs}`);
    (out[cs] ||= {}).qrzru = tag(r, 'error') ? 'ошибка: ' + tag(r, 'error') : pics(r);
    if (cs === calls[0]) console.log('QRZ.RU поля:', names(r).join(' ')); }
} catch (e) { console.log('QRZ.RU:', e.message); }
console.log(JSON.stringify(out, null, 1));
