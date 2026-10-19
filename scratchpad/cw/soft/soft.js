// Мягкий декодер: вместо решения "ключ нажат или отпущен" на каждом
// измерении — мера уверенности, и разбор всей передачи целиком.
//
// Устройство:
//   1. огибающая на тоне (Гёрцель, шаг 2,5 мс);
//   2. из неё — счёт на каждое измерение: насколько оно похоже на тон,
//      а насколько на шум (логарифм отношения правдоподобий);
//   3. перебор по всей записи: состояние — место в дереве азбуки Морзе,
//      переход — посылка или пауза той или иной длины. Выигрывает разбор,
//      который лучше всего объясняет весь звук, а не каждое место по
//      отдельности.
//
//   node scratchpad/cw/soft/soft.js файл.wav [тон]
'use strict';

const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
  '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-...-': '=',
  '.-.-.': '+', '-.--.': '(', '.--.-.': '@', '-....-': '-'
};

/** Дерево азбуки: узел — набранный пока код, рёбра — точка и тире. */
function buildTree() {
  const nodes = [{ code: '', ch: '', dot: -1, dash: -1 }];
  const index = new Map([['', 0]]);
  const add = code => {
    if (index.has(code)) return index.get(code);
    const at = nodes.length;
    nodes.push({ code, ch: MORSE[code] || '', dot: -1, dash: -1 });
    index.set(code, at);
    return at;
  };
  // Все коды до шести знаков, но только те, что ведут к настоящей букве.
  const useful = new Set();
  for (const code of Object.keys(MORSE)) {
    for (let i = 1; i <= code.length; i++) useful.add(code.slice(0, i));
  }
  for (const code of [...useful].sort((a, b) => a.length - b.length)) add(code);
  for (const node of nodes) {
    const d = node.code + '.', h = node.code + '-';
    node.dot = index.has(d) ? index.get(d) : -1;
    node.dash = index.has(h) ? index.get(h) : -1;
  }
  return nodes;
}

function readWav(path) {
  const b = require('fs').readFileSync(path);
  let at = 12, dataAt = 0, dataLen = 0, rate = 44100, ch = 1, bits = 16;
  while (at < b.length - 8) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); bits = b.readUInt16LE(at + 22); }
    if (id === 'data') { dataAt = at + 8; dataLen = len; break; }
    at += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / (bits / 8) / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = dataAt + i * (bits / 8) * ch;
    x[i] = bits === 16 ? b.readInt16LE(o) / 32768 : bits === 8 ? (b.readUInt8(o) - 128) / 128 : b.readFloatLE(o);
  }
  return { x, rate };
}

function goertzel(s, from, n, f, rate) {
  const k = 2 * Math.cos(2 * Math.PI * f / rate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const v = s[from + i] + k * s1 - s2; s2 = s1; s1 = v; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
}

/** Тон: ищется по остроте — во сколько раз частота сильнее соседних.
 *  Станция это пик; шум полосы ровный, и по громкости их не различить. */
function findTone(x, rate) {
  // По всей полосе звукового тракта: встал мимо частоты на пару килогерц —
  // тон уходит туда же (у владельца бывали записи на 1270 и 2120 Гц).
  // Сначала грубо, шагом 20 Гц, потом точно вокруг лучшего.
  const n = Math.round(rate * 0.04);
  const steps = Math.min(300, Math.floor(x.length / n));
  const sharpAt = f => {
    const vals = [];
    for (let k = 0; k < steps; k++) {
      const at = Math.floor(k * (x.length - n) / steps);
      const c = goertzel(x, at, n, f, rate);
      const a = (goertzel(x, at, n, f - 90, rate) + goertzel(x, at, n, f + 90, rate)) / 2 + 1e-12;
      vals.push(c / a);
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length * 0.9)];
  };
  let best = 0, bestAt = 700;
  // Снизу — 300 Гц: ниже живут гармоники сети и основной тон голоса, и
  // граница 250 впустила гармонику уличного гула (280 Гц) — шум стал читаться.
  for (let f = 300; f <= 2900; f += 20) {
    const v = sharpAt(f);
    if (v > best) { best = v; bestAt = f; }
  }
  for (let f = bestAt - 16; f <= bestAt + 16; f += 4) {
    const v = sharpAt(f);
    if (v > best) { best = v; bestAt = f; }
  }
  return { tone: bestAt, sharp: best };
}

/** Несколько тонов сразу: на частоте часто двое, и отвечающий звучит чуть
 *  выше или ниже. Берутся пики остроты, разнесённые не меньше чем на
 *  40 Гц и не слабее половины главного. */
function findTones(x, rate, most) {
  const n = Math.round(rate * 0.04);
  const steps = Math.min(300, Math.floor(x.length / n));
  const sharpAt = f => {
    const vals = [];
    for (let k = 0; k < steps; k++) {
      const at = Math.floor(k * (x.length - n) / steps);
      const c = goertzel(x, at, n, f, rate);
      const a = (goertzel(x, at, n, f - 90, rate) + goertzel(x, at, n, f + 90, rate)) / 2 + 1e-12;
      vals.push(c / a);
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length * 0.9)];
  };
  const curve = [];
  for (let f = 300; f <= 2900; f += 10) curve.push([f, sharpAt(f)]);
  // Местные вершины кривой остроты.
  const peaks = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i][1] >= curve[i - 1][1] && curve[i][1] >= curve[i + 1][1]) peaks.push(curve[i]);
  }
  peaks.sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [f, v] of peaks) {
    if (out.length && v < out[0].sharp * 0.5) break;
    if (out.some(t => Math.abs(t.tone - f) < 40)) continue;
    // Вершину не уточняем, и это проверено: уточнение шагом 2 Гц подгоняется
    // под случайные колебания самой мерки остроты (она шумная), и выходит
    // хуже по всем мерам — живые записи 94,9 → 92,2, стенд 86,3 → 83,3.
    const tone = f, sharp = v;
    out.push({ tone, sharp });
    if (out.length >= (most || 3)) break;
  }
  return out.length ? out : [{ tone: 700, sharp: 0 }];
}

module.exports = { MORSE, buildTree, readWav, goertzel, findTone, findTones };

const HOP_MS = 2.5;

/** ln I₀(z) — модифицированная функция Бесселя нулевого порядка, без
 *  переполнения: при больших z она растёт как e^z, поэтому считается сразу
 *  логарифм. Приближение Абрамовица — Стиган, точность лучше 1e-7. */
function logI0(z) {
  if (z < 3.75) {
    const t = (z / 3.75) * (z / 3.75);
    return Math.log(1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 +
      t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  const t = 3.75 / z;
  const poly = 0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 +
    t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))));
  return z - 0.5 * Math.log(z) + Math.log(poly);
}

/** Огибающая на тоне и мягкая оценка каждого измерения.
 *  Вместо "нажат / отпущен" — число: насколько это похоже на тон (больше
 *  нуля) и насколько на шум (меньше нуля). Ничего не выбрасывается, и
 *  сомнительное место решается потом, вместе со всей фразой. */
function softScores(x, rate, tone, winMs) {
  const w = Math.round(rate * (winMs || 10) / 1000), hop = Math.round(rate * HOP_MS / 1000);
  const n = Math.max(1, Math.floor((x.length - w) / hop));
  const env = new Float64Array(n), near = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    env[i] = goertzel(x, i * hop, w, tone, rate);
    // То же самое чуть в стороне — достаточно близко, чтобы остаться внутри
    // узкого фильтра приёмника, и достаточно далеко от боковых полос
    // манипуляции. Станция здесь — пик, шум полосы — ровное место.
    near[i] = (goertzel(x, i * hop, w, tone - 90, rate) +
      goertzel(x, i * hop, w, tone + 90, rate)) / 2 + 1e-12;
  }

  // Уровни шума и сигнала — по частям распределения, а не по среднему:
  // среднее уводят и провалы, и редкие всплески.
  const sorted = Float64Array.from(env).sort();
  const noise = sorted[Math.floor(n * 0.25)] + 1e-12;
  const peakAll = sorted[Math.floor(n * 0.97)];

  // Настоящая вероятность «тон или шум». Громкость одного окна в паузе
  // распределена по Рэлею, в посылке — по Райсу, и отношение их
  // правдоподобий: ln I₀(ν·r/σ²) − ν²/(2σ²). На сильном сигнале оно почти
  // линейно по громкости — поэтому линейная оценка и работала, — а на
  // слабом становится квадратичным, приёмом по энергии. Линейная оценка
  // была грубой ровно там, где декодер и проваливался.
  if ((process.env.SOFT || 'llr') === 'llr') {
    // σ — по паузам: четверть самых тихих окон почти всегда пауза, а у
    // Рэлея четвертьквантиль равен 0,7585σ.
    const sigma = Math.max(sorted[Math.floor(n * 0.25)] / 0.7585, 1e-12);
    // Шум следит за собой по соседним частотам: там нет станции, и мерка
    // не путается с посылками, а помеха, налетевшая на всю полосу, видна
    // на них сразу. Привязка к уровню на самом тоне — через медиану.
    const useNear = Number(process.env.NOISE_NEAR || 0);
    let localSigma = null;
    if (useNear) {
      const smooth = new Float64Array(n), R = Math.round(400 / HOP_MS);
      let acc = 0;
      for (let i = 0; i < n + R; i++) {
        if (i < n) acc += near[i];
        if (i - 2 * R - 1 >= 0) acc -= near[i - 2 * R - 1];
        const c = i - R;
        if (c >= 0 && c < n) smooth[c] = acc / Math.min(2 * R + 1, i + 1, n - c + R);
      }
      const med = Float64Array.from(smooth).sort()[Math.floor(n / 2)] || 1e-12;
      localSigma = smooth.map(v => sigma * v / med);
    }
    // ν — громкость посылки над шумом: у Райса E[r²] = ν² + 2σ².
    const p90 = sorted[Math.floor(n * 0.90)];
    const nu = Math.sqrt(Math.max(p90 * p90 - 2 * sigma * sigma, 0.25 * sigma * sigma));
    // Соседние измерения перекрываются: окно в win мс при шаге 2,5 мс —
    // одно и то же звучание учтено win/2,5 раз. Без этой поправки звук
    // пересчитан, и ритм со знанием эфира против него ничего не весят.
    const overlap = HOP_MS / Math.max(winMs || 10, HOP_MS);
    const mult = Number(process.env.LLR_SCALE || 1), cap = Number(process.env.LLR_CAP || 6);
    const soft = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sg = localSigma ? Math.max(localSigma[i], sigma * 0.3) : sigma;
      const llr = logI0(nu * env[i] / (sg * sg)) - nu * nu / (2 * sg * sg);
      soft[i] = Math.max(-cap, Math.min(cap, llr * overlap * mult));
    }
    return { soft, env, near, noise: sigma, amp: nu };
  }

  // Громкость станции меряется по месту, а не одна на всю запись. При
  // замираниях станция то громче, то тише на 20 дБ, и общая мерка либо
  // топит слабые места, либо принимает шум за посылки в громких. Шум
  // полосы почти не меняется — его меряем по всей записи, где данных
  // больше; громкость станции — в окне трёх секунд вокруг каждого места.
  const LOCAL = Number(process.env.LOCAL_LEVEL || 0);   // выключено: см. CLAUDE.md, «громкость по месту»
  // Окно растёт вместе с длиной точки: у медленной станции (12 зн/мин) тире
  // длится 300 мс, и короткое окно то целиком в тире, то целиком в паузе —
  // мерка громкости скачет. Окно анализа здесь вдвое короче точки, поэтому
  // двадцать окон — это около десяти точек: несколько знаков целиком.
  const reachMs = Math.max(Number(process.env.LEVEL_REACH || 450), (winMs || 10) * 20);
  const block = Math.round(250 / HOP_MS), reach = Math.round(reachMs / HOP_MS);
  const blocks = Math.ceil(n / block);
  const peakOf = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    if (!LOCAL) { peakOf[b] = peakAll; continue; }
    const from = Math.max(0, b * block - reach), to = Math.min(n, b * block + block + reach);
    const part = Float64Array.from(env.subarray(from, to)).sort();
    // Но не тише общей громкости в разы: иначе в долгой паузе между
    // передачами «громкостью станции» становится шум, и он сам себя читает.
    peakOf[b] = Math.max(part[Math.floor(part.length * 0.97)], peakAll * 0.08);
  }
  const amp = Math.max(peakAll - noise, noise * 0.2);
  const soft = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Плавно между соседними блоками, чтобы на стыке не было ступеньки.
    const f = i / block - 0.5, b0 = Math.max(0, Math.min(blocks - 1, Math.floor(f)));
    const b1 = Math.min(blocks - 1, b0 + 1), w = Math.max(0, Math.min(1, f - b0));
    const peak = peakOf[b0] * (1 - w) + peakOf[b1] * w;
    const a = Math.max(peak - noise, noise * 0.2);
    // Согласованный приём: чем дальше измерение от середины между шумом и
    // посылкой, тем увереннее счёт. Обрезка не даёт одному щелчку
    // перевесить целую букву.
    soft[i] = Math.max(-3, Math.min(3, (env[i] - (noise + a * 0.5)) / a * 2));
  }
  return { soft, env, near, noise, amp };
}

/** Логнормальная плата за длину, не совпадающую с ожидаемой. */
function misfit(got, want, spread) {
  const d = Math.log(Math.max(got, 1e-6) / want) / spread;
  return d * d;
}

module.exports.HOP_MS = HOP_MS;
module.exports.softScores = softScores;
module.exports.misfit = misfit;
