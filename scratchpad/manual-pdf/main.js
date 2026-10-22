// The manual as a PDF: the Windows text, a light page for paper. Hidden window.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
if (app.dock) app.dock.hide();
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 1200, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36');
  await win.loadFile(process.env.PAGE);
  await win.webContents.executeJavaScript(`(async () => {
    const st = document.createElement('style');
    st.textContent = ':root{--chassis:#ffffff;--panel:#f5f2eb;--panel-raised:#ece7dc;--line:#d8d1c3;--amber:#9a6417;--green:#4f7a3c;--red:#a8452b;--text:#1f1c17;--text-dim:#5a5447;--mark:#ddd0b0;color-scheme:light}strong{color:var(--text)!important}' +
      'body{font-size:12.5px}.page{max-width:none;padding-block:0}figure,img,pre,table{break-inside:avoid}h2,h3{break-after:avoid}a.lang{display:none}';
    document.head.appendChild(st);
    document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    await document.fonts.ready; 0;
  })()`);
  await wait(1500);
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777">R2FEL HamLog ' + (process.env.VER || '') + ' · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  fs.writeFileSync(process.env.OUT, pdf);
  app.exit(0);
});
