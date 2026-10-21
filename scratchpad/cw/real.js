// Разбор живых записей. У двух известен текст — считается совпадение;
// остальные печатаются как есть (эталона нет).
//   node scratchpad/cw/real.js [путь к app.js]
const { execFileSync } = require('child_process'), path = require('path'), fs = require('fs');
const APP = process.argv[2] || path.join(__dirname, 'classic-app.js');
const KNOWN = [
  [path.join(__dirname, 'records', 'morse-code.wav'), 'ND ROSCOSMOS COSMONAUT SERGEY TETERYATNIKOV TO THE INTERNATIONAL SPACE STATION'],
  [path.join(__dirname, 'records', 'cw-heard-2026-09-30.wav'), 'NASA TO HOST A PRELAUNCH NEWS CONFERENCE ON THE AGEN'],
  // Настоящий эфир, кабелем с трансивера: шведская станция даёт общий вызов.
  // Текст установлен разбором 01.10.2026 и проверен по длительностям вручную.
  [path.join(__dirname, 'records', 'air-cable-sm0aom.wav'), 'CQ CQ CQ DE SM0AOM SM0AOM'],
  // Настоящий эфир, микрофоном, станция +20 дБ: ровно то, чего не умели.
  // До правки отпускания ключа (01.10.2026) читалось как "TGOOMCAQQOM".
  [path.join(__dirname, 'records', 'air-mic-eu1.wav'), 'ZDR UR RST 599 5NN MY NAME IS ALEX ALEX OK? BK'],
  // Микрофоном, медленная станция (12 зн/мин). В эталоне только бесспорное:
  // позывной, сказанный дважды подряд. Счёт считается от длины эталона,
  // поэтому лишние буквы в разборе его не портят.
  [path.join(__dirname, 'records', 'air-mic-oct01-1.wav'), 'SP9XKX SP9XKX'],
  // Громче втрое (01.10.2026) — на провал паузы это не повлияло, но слова
  // проходят. В эталоне только бесспорное: финская станция назвала имя и
  // город, вторая дала сводку погоды.
  [path.join(__dirname, 'records', 'air-mic-loud-1.wav'), 'NAME KARI KARI LOHJA'],
  [path.join(__dirname, 'records', 'air-mic-loud-2.wav'), 'WX CLEAR TEMP']
];
const AIR = [
  path.join(__dirname, 'records', 'air-mic-filter250.wav'),
  path.join(__dirname, 'records', 'air-mic-wide.wav'),
  // Та же станция кабелем, но другая минута разговора: текст целиком не
  // установлен, читаемое ядро — "FB DR IVAN = … QSO … 73".
  path.join(__dirname, 'records', 'air-cable-eu1.wav'),
  // Четыре записи с эфира микрофоном, 01.10.2026. Пятая — слабая и мутная:
  // на 700 и 740 Гц огибающая почти одна и та же, станции не разделяются.
  path.join(__dirname, 'records', 'air-mic-oct01-2.wav'),
  path.join(__dirname, 'records', 'air-mic-oct01-3.wav'),
  path.join(__dirname, 'records', 'air-mic-oct01-4.wav'),
  path.join(__dirname, 'records', 'air-mic-oct01-5.wav'),
  path.join(__dirname, 'records', 'air-mic-loud-3.wav'),
  // Те же передачи микрофоном айфона: картина та же, а громкость в 20 раз
  // меньше — встроенный микрофон Мака оказался лучше.
  path.join(__dirname, 'records', 'air-iphone-1.wav'),
  path.join(__dirname, 'records', 'air-iphone-2.wav'),
  // Четыре длинные записи (100–146 с): сигнал 5–8 дБ над шумом полосы,
  // телеграфной структуры в огибающей нет. Лежат как предел проходимости:
  // если когда-нибудь начнут разбираться — это будет настоящий шаг вперёд.
  path.join(__dirname, 'records', 'air-long-1.wav'),
  path.join(__dirname, 'records', 'air-long-2.wav'),
  path.join(__dirname, 'records', 'air-long-3.wav'),
  path.join(__dirname, 'records', 'air-long-4.wav'),
  // Веб-SDR, записано прямо из браузера (02.10.2026, переведено из .webm
  // силами Chromium — ffmpeg тут нет). Первая — без фильтра: общий вызов
  // TM47CDXC и вторая станция на 830 Гц. Вторая — посередине включён узкий
  // фильтр: до него связь DL5FCZ (GM, UR RST, MY NAME … FRANK, DE DL5FCZ K),
  // после — тон 640 вместо 740 и станция на 7 дБ тише.
  path.join(__dirname, 'records', 'air-websdr-nofilter.wav'),
  path.join(__dirname, 'records', 'air-websdr-filter-mid.wav')
];
function lcs(a, b) {
  let p = new Array(b.length + 1).fill(0), c = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) c[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], c[j - 1]);
    [p, c] = [c, p]; c.fill(0);
  }
  return p[b.length];
}
function decode(f) {
  const out = execFileSync('node', [path.join(__dirname, 'decode.js'), f, APP]).toString();
  return { head: out.split('\n')[0], text: (out.match(/"(.*)"/) || [, ''])[1] };
}
let total = 0, n = 0;
for (const [f, want] of KNOWN) {
  if (!fs.existsSync(f)) { console.log(`  нет файла: ${f}`); continue; }
  const { text } = decode(f);
  const sc = lcs(text.toUpperCase(), want) / want.length;
  total += sc; n++;
  console.log(`  ${(sc * 100).toFixed(0).padStart(3)}%  ${path.basename(f)}  ${JSON.stringify(text.slice(0, 56))}`);
}
console.log(`  известный текст, в среднем: ${n ? (total / n * 100).toFixed(1) : '?'}%`);
console.log('  --- живой эфир (эталона нет) ---');
for (const f of AIR) {
  if (!fs.existsSync(f)) continue;
  const { head, text } = decode(f);
  console.log(`  ${path.basename(f)}: ${head}\n      ${JSON.stringify(text.slice(0, 64))}`);
}
