// Знание эфира: чем обычный разговор в телеграфе отличается от набора букв.
// Применяется только как переоценка разборов, которые и так сошлись по
// ритму — выдумывать текст из шума этим нельзя, можно лишь предпочесть
// осмысленное бессмысленному при равном звуке.
'use strict';
const fs = require('fs');

// Обороты эфира берутся из самой программы — та же таблица CW_WORDS, что
// показывает расшифровку под текстом. Один словарь на две работы: подсказка
// оператору и выбор верного разбора.
function fromApp() {
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'app.js'), 'utf8');
  const from = src.indexOf('  const CW_WORDS = {');
  const body = src.slice(from, src.indexOf('\n  };', from) + 5);
  const out = new Set();
  for (const m of body.matchAll(/^\s+'?([A-Z0-9?]+)'?:/gm)) out.add(m[1]);
  return out;
}

// И то, что в таблице не нужно (это не сокращения, а обычные слова), но в
// эфире встречается постоянно.
const PLAIN = `NAME QTH AGE RIG ANT PWR WX TEMP TEST THE AND IS MY UR TO ON IN AT OF ALL NOW NOT
NO YES OK HERE BEST REGARDS GOOD LUCK SEE YOU AGAIN SOON BYE THANKS PLEASE STATION POWER
ANTENNA DIPOLE VERTICAL BEAM YAGI LOOP WIRE WATTS KW SOLID COPY NOISE RAIN SNOW SUN CLOUD
CLEAR WIND FINE NICE HEAVY LITTLE HOT COLD WARM CITY TOWN YEARS OLD`.trim().split(/\s+/);

const WORDS = new Set([...fromApp(), ...PLAIN]);

// Словарь английского. В эфире говорят не только сокращениями, и без него
// отличить настоящее слово от мусора нечем — приходилось не штрафовать
// незнакомое вовсе. Общеупотребительные слова весят больше словарных:
// в словаре Вебстера есть всё на свете, и редкое слово там легко совпадёт
// со случайным набором букв.
const COMMON = `THE BE TO OF AND A IN THAT HAVE I IT FOR NOT ON WITH HE AS YOU DO AT THIS BUT HIS BY
FROM THEY WE SAY HER SHE OR AN WILL MY ONE ALL WOULD THERE THEIR WHAT SO UP OUT IF ABOUT WHO GET
WHICH GO ME WHEN MAKE CAN LIKE TIME NO JUST HIM KNOW TAKE INTO YEAR YOUR GOOD SOME COULD THEM SEE
OTHER THAN THEN NOW LOOK ONLY COME ITS OVER THINK ALSO BACK AFTER USE TWO HOW OUR WORK FIRST WELL
WAY EVEN NEW WANT BECAUSE ANY THESE GIVE DAY MOST US IS ARE WAS WERE BEEN HAS HAD DID DOES MUCH
VERY MANY MORE HERE HEAR SEND SENT RECEIVE RECEIVED STATION SIGNAL REPORT WEATHER TEMPERATURE
RAIN SNOW SUNNY CLOUDY WIND COLD WARM HOT NICE FINE GOOD BAD STRONG WEAK LOUD CLEAR NOISE
ANTENNA DIPOLE VERTICAL BEAM TOWER WIRE WATT WATTS POWER RADIO TRANSCEIVER AMPLIFIER KEY PADDLE
NAME AGE CITY TOWN COUNTRY YEARS OLD HOPE MEET AGAIN SOON LATER TODAY TOMORROW MORNING EVENING
NIGHT THANKS THANK PLEASE SORRY LUCK HEALTH FAMILY FRIEND HAM RADIO AMATEUR CONTEST AWARD`
  .trim().split(/\s+/);
for (const w of COMMON) WORDS.add(w);

/** Большой словарь английского — если он есть на этой машине. В программе
 *  вместо него поедет свой короткий список: словарь Вебстера весит 2,5 МБ,
 *  и половина его — слова, которых в эфире не бывает. */
function bigWords() {
  const out = new Set();
  for (const path of ['/usr/share/dict/words', '/usr/share/dict/propernames']) {
    let text = '';
    try { text = fs.readFileSync(path, 'latin1'); } catch (err) { continue; }
    for (const line of text.split('\n')) {
      const w = line.trim().toUpperCase();
      if (w.length >= 3 && w.length <= 12 && /^[A-Z]+$/.test(w)) out.add(w);
    }
  }
  return out;
}
const BIG = process.env.NO_BIG_DICT ? new Set() : bigWords();

// Позывной: приставка (буква-цифра, две буквы, буква-цифра-буква…), цифра,
// окончание из одной-четырёх букв, иногда дробь и добавка.
const CALL = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(\/[A-Z0-9]{1,3})?$/;
const RST = /^[1-5][1-9][1-9]$|^[1-5]N[1-9]$|^[1-5][1-9]N$|^5NN$/;

/** Позывные и приставки из собственного журнала: самая сильная подсказка,
 *  какая бывает — это те, с кем на этих диапазонах реально работают.
 *  Журнал читается у пользователя на месте и никуда не отправляется. */
function fromLog(adifPath) {
  const calls = new Set(), prefixes = new Set(), names = new Set(), places = new Set();
  let text = '';
  try { text = fs.readFileSync(adifPath, 'latin1'); } catch (err) { return { calls, prefixes, names, places }; }
  const grab = (field, into) => {
    const re = new RegExp(`<${field}:(\\d+)[^>]*>`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const v = text.substr(m.index + m[0].length, Number(m[1])).trim().toUpperCase();
      if (v) into.add(v);
    }
  };
  grab('CALL', calls);
  grab('NAME', names);
  // Города и страны, где корреспонденты владельца действительно живут:
  // в эфире их называют постоянно, а ни в каком словаре английского их нет.
  grab('QTH', places);
  grab('COUNTRY', places);
  for (const set of [names, places]) {
    for (const v of [...set]) {
      set.delete(v);
      for (const part of v.split(/[^A-Z0-9]+/i)) if (part.length >= 2) set.add(part.toUpperCase());
    }
  }
  for (const c of calls) {
    const base = c.split('/')[0];
    const at = base.search(/[0-9]/);
    if (at > 0) prefixes.add(base.slice(0, at + 1));
  }
  return { calls, prefixes, names, places };
}

/**
 * Насколько текст похож на разговор в эфире. Считается в тех же единицах,
 * что и звук, — очками на знак, чтобы можно было складывать.
 */
function score(text, known) {
  if (!text) return 0;
  let total = 0;
  for (const raw of text.toUpperCase().split(/\s+/)) {
    const token = raw.replace(/[^A-Z0-9/?=+]/g, '');
    if (!token) continue;
    const n = token.length;
    if (WORDS.has(token)) { total += 1.6 * n; continue; }
    if (RST.test(token)) { total += 1.4 * n; continue; }
    if (CALL.test(token)) {
      const base = token.split('/')[0];
      const at = base.search(/[0-9]/);
      const prefix = at > 0 ? base.slice(0, at + 1) : '';
      if (known && known.calls.has(token)) total += 2.2 * n;        // этот уже в журнале
      else if (known && known.prefixes.has(prefix)) total += 1.4 * n; // такие приставки тут слышно
      else total += 0.9 * n;                                         // просто похоже на позывной
      continue;
    }
    if (known && known.names.has(token)) { total += 1.4 * n; continue; }
    if (known && known.places.has(token)) { total += 1.3 * n; continue; }
    if (BIG.has(token)) { total += 0.55 * n; continue; }
    if (/^[0-9]+$/.test(token)) { total += 0.5 * n; continue; }
    // Незнакомое слово — это не беда: в эфире говорят и обычными словами,
    // и названиями городов, и именами, которых ни в каком словаре нет.
    // Беда — рассыпанный текст. Поэтому штрафуется не незнакомое слово, а
    // одиночная буква: настоящая речь из них не состоит. Первый вариант
    // штрафовал незнакомое по длине, и декодеру стало выгодно дробить всё
    // на буквы — "N A S A T O H O S T" вместо "NASA TO HOST".
    if (n === 1) { total -= 1.1; continue; }
    total -= 0.12 * n;
  }
  return total;
}

module.exports = { score, fromLog, WORDS, CALL };

/** Насколько расстояние между словами — одна правка (вставить, убрать,
 *  заменить). Нужно, чтобы заметить два прочтения одного позывного. */
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  let i = 0, j = 0, bad = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++bad > 1) return 99;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return bad + (a.length - i) + (b.length - j);
}

/**
 * Передача в телеграфе устроена по правилам, и это знание сильнее словаря.
 * CQ дают три раза подряд, после DE идёт позывной, позывной повторяют
 * дважды, передачу заканчивают K или 73. Разбор, который этим правилам
 * следует, почти наверняка верен — а разбор, где один и тот же позывной
 * прочитан двумя разными способами, почти наверняка нет.
 */
function structure(text) {
  if (!text) return 0;
  const t = text.toUpperCase().split(/\s+/).filter(Boolean);
  let bonus = 0;

  // CQ подряд: общий вызов дают дважды-трижды, редко один раз.
  let run = 0;
  for (const w of t) {
    if (w === 'CQ') { run++; if (run >= 2) bonus += 3; }
    else run = 0;
  }

  // После DE — позывной, и почти всегда он сказан дважды подряд.
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i] !== 'DE') continue;
    if (CALL.test(t[i + 1])) bonus += 4;
    if (t[i + 2] === t[i + 1]) bonus += 4;
  }

  // Любой позывной, сказанный в передаче дважды, — это он и есть.
  const seen = new Map();
  for (const w of t) if (CALL.test(w)) seen.set(w, (seen.get(w) || 0) + 1);
  for (const [, n] of seen) if (n > 1) bonus += 3 * (n - 1);

  // А два почти одинаковых позывных — это один позывной, прочитанный
  // по-разному, то есть где-то ошибка. Такой разбор хуже того, где они
  // совпали.
  const calls = [...seen.keys()];
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      if (near(calls[i], calls[j]) <= 1) bonus -= 5;
    }
  }

  // Рапорт идёт за словом, которое его объявляет.
  for (let i = 0; i < t.length - 1; i++) {
    if ((t[i] === 'RST' || t[i] === 'UR' || t[i] === 'URS') && RST.test(t[i + 1])) bonus += 3;
  }

  // Чем передачу заканчивают.
  const last = t[t.length - 1];
  if (['K', 'KN', 'AR', 'SK', 'BK', '73', 'TU', 'E'].includes(last)) bonus += 2;

  return bonus;
}

module.exports.structure = structure;
module.exports.near = near;
