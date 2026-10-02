// Renders scripts/site-banner-en.html to site/img/banner-en.jpg (twice the
// size for sharp screens). Run: node_modules/.bin/electron scripts/site-banner
const { app, BrowserWindow } = require('electron');
const path = require('path');
const root = path.join(__dirname, '..', '..');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 900, webPreferences: { zoomFactor: 1 } });
  await win.loadFile(path.join(root, 'scripts', 'site-banner-en.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
  const r = await win.webContents.executeJavaScript(
    '(() => { const b = document.getElementById("banner").getBoundingClientRect(); return { x: 0, y: 0, width: Math.round(b.width), height: Math.round(b.height) }; })()');
  win.webContents.setZoomFactor(2);
  win.setContentSize(1200, r.height * 2);
  await new Promise(res => setTimeout(res, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: r.height * 2 });
  const out = img.resize({ width: 1200 });
  require('fs').writeFileSync(path.join(root, 'site', 'img', 'banner-en.jpg'), out.toJPEG(88));
  console.log('banner-en.jpg', out.getSize());
  app.quit();
});
