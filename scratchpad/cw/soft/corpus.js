// Корпус для обучения: как звучит телеграфный эфир. Собирается сам — из
// шаблонов настоящих связей, сокращений, английского и журнала оператора.
// Проверочных записей в нём нет и быть не должно: иначе модель выучит ответы.
'use strict';
const fs = require('fs');
const lang = require('./lang.js');

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];

/** Правдоподобный позывной по приставке: модель должна выучить форму
 *  позывного, а не только позывные из одного журнала. */
function makeCall(prefixes) {
  const p = rnd() < 0.7 && prefixes.length ? pick(prefixes)
    : pick(['R', 'UA', 'RA', 'RV', 'RW', 'RZ', 'UB', 'DL', 'F', 'G', 'I', 'EA', 'OK', 'SP', 'HA', 'YO', 'LZ',
      'K', 'W', 'N', 'VE', 'JA', 'VK', 'ZL', 'PY', 'LU', 'ON', 'PA', 'OH', 'SM', 'LA', 'OZ', 'ES', 'YL', 'LY',
      'EU', 'EW', 'UR', 'UT', 'UX', 'S5', '9A', 'E7', 'YU', 'Z3', 'SV', 'TA', '4X', 'EK', 'UN', 'EX']) +
      String(Math.floor(rnd() * 10));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let suffix = '';
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) suffix += letters[Math.floor(rnd() * 26)];
  return (/[0-9]$/.test(p) ? p : p + String(Math.floor(rnd() * 10))) + suffix;
}

function build(logPath) {
  const known = logPath ? lang.fromLog(logPath) : { calls: new Set(), prefixes: new Set(), names: new Set(), places: new Set() };
  const logCalls = [...known.calls].filter(c => lang.CALL.test(c));
  const prefixes = [...known.prefixes];
  const names = [...known.names, 'ALEX', 'JOHN', 'MIKE', 'BOB', 'PETER', 'IVAN', 'SERGEY', 'VLAD', 'OLEG', 'IGOR',
    'TOM', 'JIM', 'HANS', 'KARL', 'JAN', 'PAUL', 'MARK', 'DAVE', 'STEVE', 'TONY', 'KARI', 'JUHA', 'LARS',
    'PIOTR', 'MAREK', 'TOMAS', 'JOSE', 'LUIS', 'MARIO', 'ANDRE', 'YURI', 'DIMA', 'SASHA', 'NICK', 'GEORGE']
    .filter(n => /^[A-Z]{2,10}$/.test(n));
  const places = [...known.places, 'MOSCOW', 'LONDON', 'PARIS', 'BERLIN', 'ROME', 'MADRID', 'PRAGUE', 'WARSAW',
    'VIENNA', 'MINSK', 'KIEV', 'RIGA', 'TALLINN', 'HELSINKI', 'STOCKHOLM', 'OSLO', 'TOKYO', 'BOSTON', 'TEXAS',
    'OHIO', 'SYDNEY', 'RUSSIA', 'GERMANY', 'FRANCE', 'ITALY', 'SPAIN', 'POLAND', 'FINLAND', 'SWEDEN', 'JAPAN',
    'USA', 'CANADA', 'BRAZIL', 'UKRAINE', 'BELARUS', 'LATVIA', 'ESTONIA', 'NEAR']
    .filter(p => /^[A-Z]{2,14}$/.test(p));
  const call = () => rnd() < 0.5 && logCalls.length ? pick(logCalls) : makeCall(prefixes);
  const rst = () => pick(['599', '599', '5NN', '5NN', '579', '589', '559', '569', '579', '449', '339', '57N', '58N']);
  const name = () => pick(names), qth = () => pick(places);
  const rig = () => pick(['IC7300', 'FT991', 'TS590', 'K3', 'FT857', 'IC718', 'TS2000', 'HOMEMADE', 'FT450']);
  const ant = () => pick(['DIPOLE', 'VERTICAL', 'YAGI', 'LOOP', 'WIRE', 'GP', 'INV V', 'DELTA LOOP', 'BEAM']);
  const wx = () => pick(['SUNNY', 'CLOUDY', 'RAIN', 'SNOW', 'FINE', 'COLD', 'WARM', 'HOT', 'WINDY', 'CLEAR']);
  const pwr = () => pick(['100', '5', '10', '50', '200', '400', '1KW', 'QRP 5']);

  // Шаблоны настоящих связей — от общего вызова до прощания.
  const T = [
    () => `CQ CQ CQ DE ${(c => `${c} ${c}`)(call())} K`,
    () => `CQ CQ DE ${(c => `${c} ${c} ${c}`)(call())} K`,
    () => `CQ CQ CQ DE ${(c => `${c} ${c}`)(call())} PSE K`,
    () => `CQ DX CQ DX DE ${(c => `${c} ${c}`)(call())} K`,
    () => `TEST ${(c => `${c} ${c}`)(call())}`,
    () => `${call()} DE ${(c => `${c} ${c}`)(call())} K`,
    () => `${call()} DE ${call()} GM ES TNX FER CALL UR RST ${(r => `${r} ${r}`)(rst())} = NAME ${(n => `${n} ${n}`)(name())} = QTH ${(q => `${q} ${q}`)(qth())} = HW? ${call()} DE ${call()} K`,
    () => `R R TNX ${name()} FB UR RST ${rst()} ${rst()} = MY NAME IS ${name()} ${name()} = QTH ${qth()} = HW CPY? BK`,
    () => `RIG HR IS ${rig()} PWR ${pwr()} W ANT ${ant()} = WX ${wx()} TEMP ${Math.floor(rnd() * 30)} C = BK`,
    () => `TNX FER NICE QSO ${name()} = HPE CUAGN = 73 ES GL ${call()} DE ${call()} SK`,
    () => `TU ${name()} 73 ES GUD DX = ${call()} DE ${call()} SK E E`,
    () => `QSL VIA BURO = TNX QSO 73 SK`,
    () => `${call()} 5NN ${String(Math.floor(rnd() * 900) + 1).padStart(3, '0')} TU`,
    () => `TU ${call()} TEST`,
    () => `UR SIGS VY FB HR = SOLID CPY = OP HR ${name()} = QTH NR ${qth()} = BK`,
    () => `GE OM TNX FER CALL = UR RST ${rst()} IN ${qth()} = NAME ${name()} = HW? AR ${call()} DE ${call()} KN`,
    () => `SRI QRM = PSE AGN = UR NAME? = BK`,
    () => `QRS PSE = QRS = TNX`,
    () => `QRZ? DE ${call()} K`,
    () => `OK ${name()} DR OM = ALL OK = TNX FER RPT = 73 = SK`
  ];

  // Английский — для букв и слов вне сокращений: эфир говорит и обычными
  // словами. Общеупотребительные слова чаще словарных, как и в жизни.
  const common = [...lang.WORDS].filter(w => /^[A-Z]{2,}$/.test(w));
  let dict = [];
  try {
    dict = fs.readFileSync('/usr/share/dict/words', 'latin1').split('\n')
      .map(w => w.trim().toUpperCase()).filter(w => w.length >= 3 && w.length <= 10 && /^[A-Z]+$/.test(w));
  } catch (err) { /* нет словаря — обойдёмся без него */ }

  const lines = [];
  for (let i = 0; i < 6000; i++) lines.push(pick(T)());
  for (let i = 0; i < 4000; i++) {
    const n = 3 + Math.floor(rnd() * 8), words = [];
    for (let j = 0; j < n; j++) words.push(rnd() < 0.75 || !dict.length ? pick(common) : pick(dict));
    lines.push(words.join(' '));
  }
  return lines.join(' ');
}

module.exports = { build };

if (require.main === module) {
  const text = build(process.env.CW_LOG);
  console.log(`корпус: ${text.length} знаков`);
  console.log(text.slice(0, 600));
}
