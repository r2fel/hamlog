// Renders scripts/thanks-banner.html: the testers' thank-you banner, in both languages.
// Run: node_modules/.bin/electron scripts/thanks-banner   (output: site/img/thanks-en.jpg, thanks-ru.jpg;
// or into the folder given as the first argument, to look at a draft first)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const outDir = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && a !== __dirname) || path.join(root, 'site', 'img'));

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1100, height: 400, webPreferences: { zoomFactor: 1 } });
  await win.loadFile(path.join(root, 'scripts', 'thanks-banner.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
  for (const lang of ['en', 'ru']) {
    await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-lang', '${lang}'); 1`);
    const r = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById('thanks').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    const scale = 2;
    win.webContents.setZoomFactor(scale);
    win.setContentSize(r.w * scale, r.h * scale);
    await new Promise(res => setTimeout(res, 600));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: r.w * scale, height: r.h * scale });
    fs.writeFileSync(path.join(outDir, `thanks-${lang}.jpg`), img.resize({ width: 1600 }).toJPEG(90));
    console.log(`thanks-${lang}.jpg`, img.resize({ width: 1600 }).getSize());
  }
  app.quit();
});
