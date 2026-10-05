// Makes the Russian twin of the site: site/index.html (English, the main page)
// -> site/ru/index.html at https://r2fel.com/ru/. Search engines want one language
// per address, so the Russian text must not sit hidden inside the English page.
// Run: node scripts/build-site.js   (publish-site.sh runs it before copying.)
const fs = require('fs');
const path = require('path');
const site = path.join(__dirname, '..', 'site');
let s = fs.readFileSync(path.join(site, 'index.html'), 'utf8');

function swap(from, to) {
  if (!s.includes(from)) throw new Error('build-site: not found: ' + from.slice(0, 60));
  s = s.replace(from, to);
}

// The language is fixed by the address, not guessed from the browser.
const detect = s.slice(s.indexOf('<script>\n  // Russian for anyone'), s.indexOf('</script>', s.indexOf('<script>\n  // Russian for anyone')) + 9);
swap(detect, `<script>document.documentElement.setAttribute('data-lang', 'ru'); document.documentElement.lang = 'ru';</script>`);
swap('<html lang="en" data-lang="en">', '<html lang="ru" data-lang="ru">');

swap(/<title>[^<]*<\/title>/.exec(s)[0], '<title>R2FEL HamLog — бесплатный журнал радиосвязей для Mac и Windows</title>');
swap('<link rel="canonical" href="https://r2fel.com/">', '<link rel="canonical" href="https://r2fel.com/ru/">');
swap(/<meta name="description" content="[^"]*">/.exec(s)[0],
  '<meta name="description" content="R2FEL HamLog — бесплатный журнал радиосвязей для Mac и Windows: поиск позывных (QRZ.RU, HamQTH, QRZ.com), погода, местное время и азимут, DX-кластер, декодер телеграфа CW, пайлапы, контесты, LoTW, eQSL, award.srr.ru, ADIF, Cabrillo.">');
swap('<meta property="og:title" content="R2FEL HamLog">', '<meta property="og:title" content="R2FEL HamLog — журнал радиосвязей">');
swap(/<meta property="og:description" content="[^"]*">/.exec(s)[0],
  '<meta property="og:description" content="Бесплатный журнал радиосвязей, который сам находит, с кем вы работаете. Mac и Windows.">');
swap('<meta property="og:url" content="https://r2fel.com/">', '<meta property="og:url" content="https://r2fel.com/ru/">');
swap('"url": "https://r2fel.com/",', '"url": "https://r2fel.com/ru/",\n  "inLanguage": "ru",');

swap('<a class="mark" href="/">', '<a class="mark" href="/ru/">');

// Everything the page loads sits one level up.
s = s.replace(/(href|src)="(fonts|img)\//g, '$1="../$2/');

// Language buttons go to the other address (the choice is remembered for the root page).
const buttons = s.slice(s.indexOf("    document.querySelector('.langs').addEventListener"), s.indexOf('    markLang();\n\n    // The video'));
swap(buttons, `    document.querySelector('.langs').addEventListener('click', function (e) {
      var l = e.target.getAttribute('data-set-lang');
      if (!l) return;
      try { localStorage.setItem('lang', l); } catch (err) {}
      if (l === 'en') location.href = '/';
    });
`);
fs.mkdirSync(path.join(site, 'ru'), { recursive: true });
fs.writeFileSync(path.join(site, 'ru', 'index.html'), s);
console.log('site/ru/index.html', s.length, 'bytes');

// The English page: say where the Russian twin is, and send the RU button there.
let en = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
if (!en.includes('hreflang="ru"')) {
  en = en.replace('<link rel="canonical" href="https://r2fel.com/">',
    '<link rel="canonical" href="https://r2fel.com/">\n<link rel="alternate" hreflang="en" href="https://r2fel.com/">\n<link rel="alternate" hreflang="ru" href="https://r2fel.com/ru/">\n<link rel="alternate" hreflang="x-default" href="https://r2fel.com/">');
}
// Same alternates on the Russian page.
let ru = fs.readFileSync(path.join(site, 'ru', 'index.html'), 'utf8');
if (!ru.includes('hreflang="en"')) {
  ru = ru.replace('<link rel="canonical" href="https://r2fel.com/ru/">',
    '<link rel="canonical" href="https://r2fel.com/ru/">\n<link rel="alternate" hreflang="en" href="https://r2fel.com/">\n<link rel="alternate" hreflang="ru" href="https://r2fel.com/ru/">\n<link rel="alternate" hreflang="x-default" href="https://r2fel.com/">');
  fs.writeFileSync(path.join(site, 'ru', 'index.html'), ru);
}
if (!en.includes("if (l === 'ru') location.href = '/ru/'")) {
  en = en.replace("      try { localStorage.setItem('lang', l); } catch (err) {}\n      markLang();",
    "      try { localStorage.setItem('lang', l); } catch (err) {}\n      if (l === 'ru') { location.href = '/ru/'; return; }\n      markLang();");
}
fs.writeFileSync(path.join(site, 'index.html'), en);
