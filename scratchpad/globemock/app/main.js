// Hidden window, globe mockup shots. PROJECT=<project root> electron scratchpad/globemock/app
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.PROJECT, OUT = path.join(ROOT, 'scratchpad/globemock/out');
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
if (app.dock) app.dock.hide();
app.on('window-all-closed', () => {});
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(buf); });
}).listen(4211);
const wait = ms => new Promise(r => setTimeout(r, ms));
const shots = [
  ['globe-920-usa', 920, 470, '?call=K1TEST&grid=FN42KH'],
  ['globe-920-vk', 920, 470, '?call=VK3TEST&grid=QF22LE'],
  ['globe-920-zoom', 920, 470, '?call=K1TEST&grid=FN42KH&zoom=1'],
];
setTimeout(() => { fs.writeFileSync(path.join(OUT, 'log.txt'), 'TIMEOUT'); app.exit(1); }, 170000);
app.whenReady().then(async () => {
  const log = [];
  for (const [name, w, h, q] of shots) {
    const win = new BrowserWindow({ show: false, width: w, height: h, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (e, l, m) => log.push(name + ' [console] ' + m.slice(0, 300)));
    await win.loadURL('http://127.0.0.1:4211/scratchpad/globemock/index.html' + q);
    for (let i = 0; i < 30 && !(await win.webContents.executeJavaScript('!!window.__ready')); i++) await wait(500);
    await wait(1500);
    log.push(name + ': ' + await win.webContents.executeJavaScript('window.__err || "ok"'));
    fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
  server.close(); app.exit(0);
});
