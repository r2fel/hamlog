// Renders scripts/site-banner.html: the tall banner in both languages and the
// wide link preview. Run: node_modules/.bin/electron scripts/site-banner
// Output goes to the folder given as the first argument after the script
// (default: site/img), so a draft can be looked at before it replaces anything.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const outDir = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && a !== __dirname) || path.join(root, 'site', 'img'));

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { zoomFactor: 1 } });
  await win.loadFile(path.join(root, 'scripts', 'site-banner.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');

  async function shot(id, lang, scale, file, quality, outWidth) {
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-lang', '${lang}');
       document.getElementById('banner').style.display = '${id === 'banner' ? 'block' : 'none'}';
       document.getElementById('social').style.display = '${id === 'social' ? 'flex' : 'none'}'; 1`);
    const r = await win.webContents.executeJavaScript(
      `(() => { const b = document.getElementById('${id}').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    win.webContents.setZoomFactor(scale);
    win.setContentSize(r.w * scale, r.h * scale);
    await new Promise(res => setTimeout(res, 600));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: r.w * scale, height: r.h * scale });
    const out = img.resize({ width: outWidth });
    fs.writeFileSync(path.join(outDir, file), out.toJPEG(quality));
    console.log(file, out.getSize());
  }

  await shot('banner', 'en', 2, 'banner-en.jpg', 88, 1200);
  await shot('banner', 'ru', 2, 'banner-ru.jpg', 88, 1200);
  await shot('social', 'en', 1, 'og-en.jpg', 90, 1280);
  app.quit();
});
