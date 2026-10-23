// Полный проход мягкого декодера по записи.
//   node scratchpad/cw/soft/run.js файл.wav [тон]
'use strict';
const m = require('./soft.js');
const { parsePiece } = require('./parse.js');
const lang = require('./lang.js');
const { parseBest } = require('./nbest.js');
const ngram = require('./ngram.js');
const corpus = require('./corpus.js');

const HOP = m.HOP_MS;
const SPACE_COST = Number(process.env.SPACE_COST || 12);
// Насколько разбор должен быть убедительнее тишины — в расчёте на букву.
// Ниже этого печатать нечего: шум тоже складывается в буквы, если очень
// захотеть, и без этой проверки декодер сочиняет текст из чистого шипения.
const MIN_MARGIN = Number(process.env.MIN_MARGIN || 0);
// И главное: есть ли тут вообще тон. Мягкая оценка нормируется, поэтому в
// чистом шуме самые громкие всплески объявляются посылками и по форме шум
// неотличим от сигнала — перебор послушно читает его как ряд E и T. Эта
// проверка знает абсолют: во сколько раз тон сильнее того, что рядом.
const MIN_SHARP = Number(process.env.MIN_SHARP || 3.5);
// И ещё одно, чего у шума с несущей не отнять: несущая звучит ровно, а
// телеграф — это тон, который включается и выключается. Если огибающая
// почти не качается, перед нами не передача, сколько бы острым ни был тон.
const MIN_SWING = Number(process.env.MIN_SWING || 0.7);
// Сколько весит знание эфира против самого звука. Знание не создаёт текст
// из ничего: оно лишь выбирает между разборами, которые и так сошлись по
// ритму. Поэтому вес ограничен — иначе декодер начнёт слышать то, что
// ожидает услышать, а это худшее, что может делать декодер.
const LANG_WEIGHT = Number(process.env.LANG_WEIGHT || 20);
// Журнал оператора — самая сильная подсказка: это те, с кем на этих
// диапазонах действительно работают. Читается у пользователя на месте;
// в программу ничей журнал не попадает.
const LOG_PATH = process.env.CW_LOG || '';
// Сколько путей брать из решётки. Пока единица: при большем числе счёт
// падает (96,0 → 93,8 → 93,1 при 1 / 2 / 4), и причина не в путях, а в
// счёте — он не нормирован, и разбору выгодно дробиться на много коротких
// знакомых слов вместо одного верного длинного. Станет больше единицы,
// когда появится n-граммная модель.
const NBEST = Number(process.env.NBEST || 1);
// Сколько станций вести на одной частоте: вызывающий и отвечающий, плюс
// запас на третьего, если он вклинится.
const MAX_STATIONS = Number(process.env.MAX_STATIONS || 3);
const MIN_RATIO = Number(process.env.MIN_RATIO || 2.2);
// Какой проверкой решать «есть ли станция»: 'z' — статистическая, с учётом
// длины куска; иначе — прежняя острота по громким местам.
const GATE = process.env.GATE || 'z';
const MIN_Z = Number(process.env.MIN_Z || 8);
const MIN_STATION_LETTERS = Number(process.env.MIN_STATION_LETTERS || 4);
// Правила передачи весят отдельно от словаря: «похоже на настоящую
// передачу» — знание более сильное, чем «встретилось знакомое слово».
// Правила передачи: сейчас на счёт не влияют (выбирать не из чего), но
// проверены отдельно и ранжируют верно. Заработают вместе с n-граммами.
const RULE_WEIGHT = Number(process.env.RULE_WEIGHT || 25);
// Вес посимвольной модели. Ноль — модель выключена и работает прежний счёт
// по словам. Модель обучается один раз на корпусе эфира и помнится.
const NGRAM_WEIGHT = Number(process.env.NGRAM_WEIGHT || 0);
let model = null;
const modelFor = logPath => model || (model = ngram.train(corpus.build(logPath)));
// Окно анализа — это согласованный приём: оно должно быть вдвое короче
// точки, а длина точки заранее не известна. Поэтому огибающая считается
// сразу в нескольких окнах, и нужное выбирается вместе со скоростью: если
// выбрать окно по первой оценке и ошибиться, перебор дальше ищет скорость
// по испорченной огибающей и медленную станцию не находит никогда.
const WINDOWS = [6, 10, 16, 24, 32, 44];

/** Куски между долгими тишинами: внутри куска перебор идёт целиком, а
 *  между передачами перебирать нечего — там никто не передаёт. */
function pieces(soft, quietHops) {
  const found = [];
  let i = 0;
  while (i < soft.length) {
    while (i < soft.length && soft[i] <= 0) i++;
    if (i >= soft.length) break;
    let j = i, lastOn = i;
    while (j < soft.length) {
      if (soft[j] > 0) lastOn = j;
      else if (j - lastOn > quietHops) break;
      j++;
    }
    const from = Math.max(0, i - 4), to = Math.min(soft.length, lastOn + 4);
    if (to - from > 8) found.push([from, to]);
    i = j;
  }
  return found;
}

/** Длина точки на глаз: середина коротких длительностей. Отправная точка. */
function guessUnit(soft) {
  const runs = [];
  let at = 0;
  while (at < soft.length) {
    const sign = soft[at] > 0;
    let n = 0;
    while (at < soft.length && (soft[at] > 0) === sign) { n++; at++; }
    if (n >= 2 && n < 200) runs.push(n);
  }
  if (runs.length < 6) return 20;
  runs.sort((a, b) => a - b);
  const low = runs.slice(0, Math.max(3, Math.round(runs.length * 0.45)));
  return Math.max(10, Math.min(100, low[Math.floor(low.length / 2)]));
}

/** Всё, что нужно для разбора на одном тоне: огибающие во всех окнах. */
function layersFor(x, rate, tone) {
  const scored = WINDOWS.map(win => m.softScores(x, rate, tone, win));
  return { tone, scored, layers: scored.map(s => s.soft) };
}

function layerFor(u) {
  const want = u * HOP / 2;
  let at = 0;
  for (let i = 1; i < WINDOWS.length; i++) {
    if (Math.abs(WINDOWS[i] - want) < Math.abs(WINDOWS[at] - want)) at = i;
  }
  return at;
}

/** Скорость и растяжка промежутков — свойства руки, поэтому выбираются по
 *  кускам одной станции. Ищутся по всей шкале, а не вокруг первой оценки:
 *  на слабом сигнале оценка собирается из обрывков и почти всегда занижена. */
function chooseUnit(L, spans, unit0) {
  // Скорость выбирается по самым убедительным кускам, а не по самым
  // длинным: на слабом сигнале самый длинный кусок легко оказывается
  // шумом, и скорость подгоняется под него (на −5 дБ упорно выходила 10 —
  // нижний край поиска). Убедительность — та же мера, что решает «есть ли
  // станция».
  const byEvidence = process.env.PROBE_BY !== 'length';
  const ranked = spans.slice().map(([from, to]) => [from, to, byEvidence ? evidenceOf(L, 3, from, to) : to - from])
    .filter(sp => !byEvidence || sp[2] >= MIN_Z)
    .sort((p, q) => q[2] - p[2]);
  const probe = (ranked.length ? ranked : spans.map(([a, b]) => [a, b, 0])).slice(0, 5)
    .map(([from, to]) => [from, Math.min(to, from + 1500)]);
  if (!probe.length) return { unit: unit0, space: 1 };
  // Скорость — вопрос ритма, а не окна анализа, поэтому все скорости
  // сравниваются на одном и том же окне. С настоящей вероятностью иначе
  // нельзя: короткое окно перекрывается меньше и даёт больше «свидетельств»
  // на шаг, и перебор тянулся к быстрым скоростям — точка 23 мс вместо 60.
  const fixed = (process.env.SOFT || 'llr') === 'llr' ? Number(process.env.UNIT_LAYER || 3) : -1;
  const weigh = (u, sp) => {
    const soft = L.layers[fixed >= 0 ? fixed : layerFor(u)];
    let total = 0;
    for (const [from, to] of probe) total += parsePiece(soft.subarray(from, to), u, sp).score;
    // Растянутые промежутки — исключение: без этой поправки перебор охотно
    // берёт растяжку побольше, и паузы между словами перестают отличаться
    // от пауз между буквами — текст слипается.
    return total - SPACE_COST * (sp - 1) * probe.length;
  };
  let unit = unit0, space = 1, best = -Infinity;
  if (process.env.SHOW_UNITS) {
    const row = [];
    for (let u = 10; u <= 40; u += 2) row.push(`${u}:${weigh(u, 1).toFixed(0)}`);
    console.error(`      кусков ${probe.length} · счёт по скорости: ${row.join(' ')}`);
  }
  for (let u = 10; u <= 100; u = Math.max(u + 1, Math.round(u * 1.25))) {
    for (const sp of [1, 1.5, 2]) {
      const v = weigh(u, sp);
      if (v > best) { best = v; unit = u; space = sp; }
    }
  }
  for (const u of [unit - 2, unit - 1, unit, unit + 1, unit + 2]) {
    if (u < 8 || u > 110) continue;
    for (const sp of [1, 1.2, 1.45, 1.7, 2]) {
      const v = weigh(u, sp);
      if (v > best) { best = v; unit = u; space = sp; }
    }
  }
  return { unit, space };
}

/** Острота тона на куске — во сколько раз он сильнее того, что рядом. */
function sharpOf(L, layer, from, to) {
  const soft = L.layers[layer], { env, near } = L.scored[layer];
  const r = [];
  for (let i = from; i < to; i++) if (soft[i] > 0) r.push(env[i] / near[i]);
  if (r.length < 8) return 0;
  r.sort((a, b) => a - b);
  return r[Math.floor(r.length / 2)];
}

/** Отношение тона к соседям по всему куску сразу — и в посылках, и в
 *  паузах. Острота по самым громким местам предвзята: в шуме самые громкие
 *  места острые случайно, а тон ищется на трёх частотах — у шума три
 *  попытки. Это отношение предвзятости не имеет: в шуме оно около единицы,
 *  у станции — во столько раз больше, сколько она громче полосы. */
function powerRatio(L, layer, from, to) {
  const { env, near } = L.scored[layer];
  let a = 0, b = 0;
  for (let i = from; i < to; i++) { a += env[i]; b += near[i]; }
  return b > 0 ? a / b : 0;
}

/**
 * Есть ли тут станция — статистически, с учётом длины куска. Энергия куска
 * сравнивается с уровнем шума на той же частоте (σ из пауз), а не на
 * соседних: у фильтра 250 Гц соседние частоты на скате, и сравнение с ними
 * обманчиво. В чистом шуме отношение около единицы, и чем длиннее кусок,
 * тем точнее; поэтому мера — превышение, умноженное на корень из числа
 * независимых окон. Десять секунд слабой станции — огромное накопленное
 * доказательство, короткий всплеск шума — нет. Прежняя проверка остроты
 * длины не учитывала и на −5 дБ выбрасывала сигнал, который читается на 53 %.
 */
function evidenceOf(L, layer, from, to) {
  const sc = L.scored[layer], env = sc.env, sigma = sc.noise;
  let e2 = 0;
  for (let i = from; i < to; i++) e2 += env[i] * env[i];
  const ratio = (e2 / Math.max(1, to - from)) / (2 * sigma * sigma);
  const win = WINDOWS[layer], independent = (to - from) * HOP / win;
  return (ratio - 1) * Math.sqrt(Math.max(1, independent));
}

/** Размах огибающей: у манипуляции он велик, у ровной несущей его нет. */
function swingOf(L, layer, from, to) {
  const { env } = L.scored[layer];
  const r = [];
  for (let i = from; i < to; i++) r.push(env[i]);
  if (r.length < 20) return 0;
  r.sort((a, b) => a - b);
  const low = r[Math.floor(r.length * 0.15)], high = r[Math.floor(r.length * 0.9)];
  return high > 0 ? (high - low) / high : 0;
}

/** Разобрать один кусок; пустая строка — если тут нечего разбирать. */
function decodeSpan(L, from, to, unit, space, known, extra) {
  const layer = layerFor(unit);
  if (GATE === 'z') {
    if (evidenceOf(L, layer, from, to) < MIN_Z) return '';
  } else if (MIN_SHARP && sharpOf(L, layer, from, to) < MIN_SHARP) return '';
  if (MIN_SWING && swingOf(L, layer, from, to) < MIN_SWING) return '';
  if (process.env.SHOW_GATES) console.error(`      ворота ${L.tone} Гц: острота ${sharpOf(L, layer, from, to).toFixed(2)} · по куску ${powerRatio(L, layer, from, to).toFixed(2)} · размах ${swingOf(L, layer, from, to).toFixed(2)}`);
  // Строгая планка — только для дополнительных тонов. Поиск ведёт до трёх
  // станций сразу, то есть у шума три попытки, и два лишних тона должны
  // доказать больше, чем главный: так проскакивал шум на третьем тоне
  // («уличный гул» → ET E). Для главного тона эта планка губительна:
  // у слабой станции её мощность размазана по паузам, и приём без фильтра
  // при +2 дБ падал с 68 до 0 %.
  if (extra && MIN_RATIO && powerRatio(L, layer, from, to) < MIN_RATIO) return '';
  const piece = L.layers[layer].subarray(from, to);
  let got;
  if (LANG_WEIGHT) {
    // Варианты из трёх источников: пути в решётке, скорость, растяжка
    // промежутков. Выбирает знание эфира — только среди тех, что уже
    // сошлись по ритму; звук входит в сравнение как есть.
    let bestTotal = -Infinity;
    const units = [unit - 1, unit, unit + 1].filter(u => u >= 8 && u <= 110);
    for (const u of units) for (const sp of [0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1]) {
      const soft = L.layers[layerFor(u)].subarray(from, to);
      for (const cand of parseBest(soft, u, sp, NBEST)) {
        const total = cand.score
          + (NGRAM_WEIGHT ? NGRAM_WEIGHT * ngram.logProb(modelFor(LOG_PATH), cand.text)
                          : LANG_WEIGHT * lang.score(cand.text, known))
          + RULE_WEIGHT * lang.structure(cand.text);
        if (total > bestTotal) { bestTotal = total; got = cand; }
      }
    }
  } else {
    got = parsePiece(piece, unit, space);
  }
  if (!got || !got.text || !got.letters) return '';
  if ((got.score - got.silence) / got.letters < MIN_MARGIN) return '';
  return got.text;
}

/** Слить пересекающиеся куски разных тонов: один и тот же кусок передачи
 *  слышен на соседнем тоне тоже, просёлком через полосу. */
function mergeSpans(lists) {
  const all = [].concat(...lists).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const sp of all) {
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else out.push([sp[0], sp[1]]);
  }
  return out;
}

/**
 * Разрезать кусок там, где сменился голос. Отвечают обычно сразу после K,
 * через полсекунды, и два куска сливаются в один; если отдать его целиком
 * одному хозяину, ответ второго читается на чужом тоне и выходит рядом E.
 * Поэтому хозяин определяется по ходу куска, блоками по 200 мс, и смена
 * засчитывается, только если новый голос держится не меньше 600 мс —
 * иначе одиночный всплеск соседа резал бы передачу пополам.
 */
function splitByOwner(Ls, from, to) {
  const BLOCK = 80, HOLD = 3;
  const blocks = [];
  for (let b = from; b < to; b += BLOCK) {
    const e = Math.min(to, b + BLOCK);
    let best = -1, at = -1;
    Ls.forEach((L, i) => {
      const soft = L.layers[1], { env, near } = L.scored[1];
      let sum = 0, cnt = 0;
      for (let k = b; k < e; k++) if (soft[k] > 0) { sum += env[k] / near[k]; cnt++; }
      const v = cnt >= 4 ? sum / cnt : 0;
      if (v > best) { best = v; at = i; }
    });
    blocks.push(best > 0 ? at : -1);   // -1 — тишина, голоса нет
  }
  // Сгладить: короткие вкрапления чужого голоса — к окружающему.
  const owner = blocks.slice();
  let cur = owner.find(o => o >= 0);
  if (cur === undefined) return [];
  for (let k = 0; k < owner.length; k++) {
    if (owner[k] < 0 || owner[k] === cur) { owner[k] = cur; continue; }
    let run = 0;
    while (k + run < owner.length && (blocks[k + run] === blocks[k] || blocks[k + run] < 0)) run++;
    if (run >= HOLD) cur = blocks[k];
    owner[k] = cur;
  }
  // Нарезать по сменам, а сам разрез сдвинуть в самое тихое место рядом:
  // смена голоса всегда приходится на паузу между передачами.
  const out = [];
  let start = from, who = owner[0];
  for (let k = 1; k < owner.length; k++) {
    if (owner[k] === who) continue;
    const guess = from + k * BLOCK;
    const soft = Ls[who].layers[1];
    let cut = guess, low = Infinity;
    for (let t = Math.max(start + 1, guess - BLOCK); t < Math.min(to - 1, guess + BLOCK); t++) {
      const v = Math.max(...Ls.map(L => L.layers[1][t]));
      if (v < low) { low = v; cut = t; }
    }
    out.push([start, cut, who]);
    start = cut; who = owner[k];
  }
  out.push([start, to, who]);
  return out.filter(([a, b]) => b - a > 8);
}

function decode(path, toneArg) {
  const { x, rate } = m.readWav(path);
  // Подсказки для опыта (oracle.js): верный тон и скорость задаются снаружи,
  // чтобы увидеть, сколько декодер теряет на их поиске.
  if (!toneArg && process.env.ORACLE_TONE) toneArg = Number(process.env.ORACLE_TONE);
  const known = LOG_PATH ? lang.fromLog(LOG_PATH) : null;
  const tones = toneArg ? [{ tone: toneArg, sharp: 0 }] : m.findTones(x, rate, MAX_STATIONS);
  const Ls = tones.map(t => layersFor(x, rate, t.tone));

  const unit0 = guessUnit(Ls[0].layers[1]);
  const quiet = Math.max(160, Math.round(unit0 * 12));

  // Кому принадлежит каждый кусок. Двое на частоте передают по очереди,
  // и отвечающий звучит чуть выше или ниже — поэтому не нужно разделять
  // два сигнала, звучащих одновременно: нужно понять, чей это кусок, и
  // разбирать его со скоростью именно этой станции. Хозяин куска — тот
  // тон, который в нём острее всего: на чужом тоне сосед слышен тоже, но
  // для него соседний тон и есть «то, что рядом», и острота выходит малой.
  const merged = mergeSpans(Ls.map(L => pieces(L.layers[1], quiet)));
  const parts = [];
  for (const [from, to] of merged) {
    if (Ls.length === 1) parts.push([from, to, 0]);
    else parts.push(...splitByOwner(Ls, from, to));
  }
  const spans = parts.map(([a, b]) => [a, b]);
  const owner = parts.map(p => p[2]);

  // Своя скорость каждой станции — по её собственным кускам.
  const style = Ls.map((L, i) => {
    const own = spans.filter((sp, k) => owner[k] === i);
    return own.length ? chooseUnit(L, own, unit0) : null;
  });

  // Главная станция — та, у которой больше всего накопленного
  // доказательства по её кускам, а не та, чей тон нашёлся первым. Поиск
  // тона упорядочивает по остроте, а она на слабом сигнале скачет: на
  // −2 дБ случайный пик шума выходил «главным», настоящая станция
  // становилась «дополнительной», попадала под строгую проверку для лишних
  // тонов — и выбрасывалась целиком. Ответ декодера был пустой строкой.
  const weight = Ls.map(() => 0);
  spans.forEach(([from, to], k) => { weight[owner[k]] += Math.max(0, evidenceOf(Ls[owner[k]], 3, from, to)); });
  let mainStation = 0;
  for (let i = 1; i < Ls.length; i++) if (weight[i] > weight[mainStation]) mainStation = i;

  if (process.env.ORACLE_UNIT) {
    for (let i = 0; i < style.length; i++) {
      style[i] = { unit: Number(process.env.ORACLE_UNIT), space: Number(process.env.ORACLE_SPACE || 1) };
    }
  }

  const out = [], segments = [];
  let last = -1;
  spans.forEach(([from, to], k) => {
    const i = owner[k], st = style[i];
    if (!st) return;
    const text = decodeSpan(Ls[i], from, to, st.unit, st.space, known, i !== mainStation);
    if (!text) return;
    // Смена станции видна в тексте: читать разговор двоих одной строкой
    // невозможно — не понять, кто что сказал.
    if (last !== -1 && i !== last) out.push('|');
    out.push(text);
    segments.push({ station: i, tone: Ls[i].tone, from: from * HOP / 1000, text });
    last = i;
  });

  // Станция, от которой за всю запись набралось меньше нескольких букв, не
  // показывается. Все утечки шума, какие встречались, крошечные — EM, ET E,
  // M R, по две-три буквы, — а настоящая станция, если её слышно, передаёт
  // больше. Цена: одинокое «TU» без всего остального пропадёт; это дешевле,
  // чем печатать буквы из гула.
  const letters = Ls.map(() => 0);
  for (const sg of segments) letters[sg.station] += sg.text.replace(/[^A-Z0-9?\/=]/g, '').length;
  const kept = segments.filter(sg => letters[sg.station] >= MIN_STATION_LETTERS);
  if (kept.length !== segments.length) {
    out.length = 0;
    let prev = -1;
    for (const sg of kept) {
      if (prev !== -1 && sg.station !== prev) out.push('|');
      out.push(sg.text);
      prev = sg.station;
    }
    segments.length = 0;
    segments.push(...kept);
  }

  const main = style[mainStation] || { unit: unit0, space: 1 };
  return {
    tone: Ls[mainStation].tone, tones: Ls.map(L => L.tone), main: mainStation, unit: main.unit, space: main.space,
    wpm: Math.round(1200 / (main.unit * HOP)), text: out.join(' '), segments
  };
}

module.exports = { decode, pieces, guessUnit };

if (require.main === module) {
  const r = decode(process.argv[2], Number(process.argv[3]) || 0);
  console.log(`тон ${r.tone} Гц · ${r.wpm} зн/мин · точка ${Math.round(r.unit * HOP)} мс · промежутки ×${r.space}`);
  console.log(JSON.stringify(r.text));
}
