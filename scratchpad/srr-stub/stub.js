// Stand-in for award.srr.ru's API: /me and /qso/uploadADIF, refusing a log
// without resolved_locator the way they do since October 2026. Each upload's
// form fields are appended to fields.log next to this file.
const http = require('http');
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, 'fields.log');
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/me')) return res.end(JSON.stringify({ callsigns: ['R2ST'] }));
    const fields = {};
    body.replace(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g, (m, k, v) => { fields[k] = v; });
    fs.appendFileSync(LOG, JSON.stringify(fields) + '\n');
    const qsos = (body.match(/<eor>/gi) || []).length;
    if (!fields.resolved_locator) return res.end(JSON.stringify({ result: 'ERROR', error: { code: 'LOCATOR_REQUIRED', message: 'resolved_locator is required' } }));
    res.end(JSON.stringify({ result: 'OK', qsoTotal: qsos, fileSaved: 1 }));
  });
}).listen(4196, () => console.log('srr stub on 4196'));
