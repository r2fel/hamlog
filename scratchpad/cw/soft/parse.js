// Перебор по всей передаче: какая последовательность посылок и пауз лучше
// всего объясняет записанный звук. Решение о каждом месте принимается не
// на месте, а вместе со всей фразой — как это делает человек.
'use strict';
const { buildTree, misfit } = require('./soft.js');

const TREE = buildTree();
const N = TREE.length;
const NEG = -1e18;

const MARK_SPREAD = 0.25;   // насколько посылка может отклониться от своей длины
const GAP_SPREAD = 0.5;     // пауза — вдвое вольнее: там рука гуляет больше
const TIME_COST = 1.2;      // во сколько ценится ритм против самого звука
const LETTER_COST = 1.6;    // плата за каждую новую букву: без неё дешевле
                            // всего читать шум как ряд E и T
const BEAM = 14;            // сколько лучших путей держать на каждом шаге
// Цена каждой посылки. В настоящей вероятностной модели каждый выбор
// «точка или тире» стоит около бита (ln 2). Без неё быстрой скорости
// выгодно объяснять шум: больше посылок в секунду — больше способов
// подогнать разбор, и выбор скорости тянулся к быстрым (на −5 дБ точка
// 10–14 шагов вместо 24).
const ELEMENT_COST = Number(process.env.ELEMENT_COST || 0);

/** Длины-кандидаты для элемента: вокруг ожидаемой, с шагом погрубее для
 *  длинных — доли миллисекунды в трёхсотмиллисекундной паузе не значат
 *  ничего, а времени стоят. */
function spread(nominal, lo, hi) {
  const from = Math.max(1, Math.round(nominal * lo)), to = Math.round(nominal * hi);
  const step = Math.max(1, Math.round(nominal / 12));
  const out = [];
  for (let d = from; d <= to; d += step) out.push(d);
  return out;
}

/**
 * @param soft  мягкая оценка каждого измерения (больше нуля — похоже на тон)
 * @param unit  длина точки в измерениях
 * @returns {{text: string, score: number}}
 */
function parsePiece(soft, unit, space) {
  // Промежутки бывают растянуты отдельно от знаков: так учат на слух
  // (знаки быстрые, паузы широкие) и так же говорят, когда хотят, чтобы
  // их разобрали. Поэтому длина паузы между буквами — своя неизвестная,
  // а не жёсткие три точки.
  space = space || 1;
  const T = soft.length;
  const P = new Float64Array(T + 1);
  for (let i = 0; i < T; i++) P[i + 1] = P[i] + soft[i];

  const dots = spread(unit, 0.45, 1.9), dashes = spread(unit * 3, 0.62, 1.7);
  const inner = spread(unit, 0.4, 2.0);
  const letterGap = unit * 3 * space, wordGap = unit * 7 * space;
  const between = spread(letterGap, 0.6, 1.7), words = spread(wordGap, 0.65, 2.4);

  // A — закончилась пауза (дальше посылка), B — закончилась посылка.
  const A = new Float64Array((T + 1) * N).fill(NEG);
  const B = new Float64Array((T + 1) * N).fill(NEG);
  const Ab = new Int32Array((T + 1) * N).fill(-1);   // откуда пришли
  const Bb = new Int32Array((T + 1) * N).fill(-1);
  const Ae = new Int8Array((T + 1) * N);             // 0 — ничего, 1 — буква, 2 — буква и пробел
  A[0] = 0;

  const live = [];     // какие узлы заняты на этом шаге — чтобы не перебирать все
  for (let t = 0; t <= T; t++) {
    // Отсечка: держим только лучшие пути, иначе перебор растёт без толку.
    live.length = 0;
    for (let k = 0; k < N; k++) {
      if (A[t * N + k] > NEG) live.push([A[t * N + k], k, 0]);
      if (B[t * N + k] > NEG) live.push([B[t * N + k], k, 1]);
    }
    if (!live.length) continue;
    if (live.length > BEAM) {
      live.sort((p, q) => q[0] - p[0]);
      for (let i = BEAM; i < live.length; i++) {
        const [, k, which] = live[i];
        if (which) B[t * N + k] = NEG; else A[t * N + k] = NEG;
      }
      live.length = BEAM;
    }

    for (const [score, node, which] of live) {
      if (!which) {
        // Дальше посылка: точка или тире, если такое продолжение бывает.
        const here = TREE[node];
        for (const [list, child, want] of [[dots, here.dot, unit], [dashes, here.dash, unit * 3]]) {
          if (child < 0) continue;
          for (const d of list) {
            if (t + d > T) break;
            const v = score + (P[t + d] - P[t]) - TIME_COST * misfit(d, want, MARK_SPREAD) - ELEMENT_COST;
            const at = (t + d) * N + child;
            if (v > B[at]) { B[at] = v; Bb[at] = t * N + node; }
          }
        }
      } else {
        const ch = TREE[node].ch;
        // Пауза внутри буквы.
        for (const d of inner) {
          if (t + d > T) break;
          const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, unit, GAP_SPREAD);
          const at = (t + d) * N + node;
          if (v > A[at]) { A[at] = v; Ab[at] = t * N + node + (1 << 24); Ae[at] = 0; }
        }
        if (!ch) continue;
        // Пауза между буквами и между словами — буква при этом выходит.
        for (const [list, want, kind] of [[between, letterGap, 1], [words, wordGap, 2]]) {
          for (const d of list) {
            if (t + d > T) break;
            const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, want, GAP_SPREAD) - LETTER_COST;
            const at = (t + d) * N;
            if (v > A[at]) { A[at] = v; Ab[at] = t * N + node + (1 << 24); Ae[at] = kind; }
          }
        }
      }
    }
  }

  // "Здесь никто не передавал" — тоже объяснение звука, и с ним надо
  // сравнивать. Перебор всегда находит лучший разбор, но у шума тоже есть
  // лучший разбор; вопрос не в том, какой из разборов лучше, а в том,
  // настолько ли он лучше тишины, чтобы в него поверить.
  const silence = -P[T];

  // Конец записи: либо кончилось паузой, либо последней посылкой.
  let best = NEG, from = -1, tail = '';
  if (A[T * N] > best) { best = A[T * N]; from = T * N; }
  for (let k = 1; k < N; k++) {
    const ch = TREE[k].ch;
    if (!ch) continue;
    if (B[T * N + k] - LETTER_COST > best) { best = B[T * N + k] - LETTER_COST; from = -(T * N + k); tail = ch; }
  }
  if (from === -1) return { text: '', score: NEG, silence, letters: 0 };

  // Обратный ход.
  const out = [];
  if (tail) out.push(tail);
  let at = from < 0 ? -from : from, inB = from < 0;
  while (at >= 0) {
    const prev = inB ? Bb[at] : Ab[at];
    if (!inB) {
      const kind = Ae[at];
      if (kind === 2) out.push(' ');
      if (kind >= 1) out.push(TREE[(prev & 0xffffff) % N].ch);
    }
    if (prev < 0) break;
    inB = (prev & (1 << 24)) !== 0;
    at = prev & 0xffffff;
    if (at === 0 && !inB) break;
  }
  const text = out.reverse().join('').trim();
  let letters = 0;
  for (const ch of text) if (ch !== ' ') letters++;
  return { text, score: best, silence, letters };
}

module.exports = { parsePiece, TREE };
