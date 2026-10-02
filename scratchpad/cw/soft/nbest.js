// Список лучших разборов, а не один. Перебор держит в каждом состоянии не
// лучший путь, а K лучших — тогда знание эфира выбирает по-настоящему, из
// разных прочтений одного и того же звука, а не из вариантов, отличающихся
// только предполагаемой скоростью.
'use strict';
const { buildTree, misfit } = require('./soft.js');

const TREE = buildTree();
const N = TREE.length;
const NEG = -1e18;

const MARK_SPREAD = 0.25;
const GAP_SPREAD = 0.5;
const TIME_COST = 1.2;
const LETTER_COST = 1.6;
const BEAM = 14;            // сколько лучших путей держать на каждом шаге
// Цена каждой посылки. В настоящей вероятностной модели каждый выбор
// «точка или тире» стоит около бита (ln 2). Без неё быстрой скорости
// выгодно объяснять шум: больше посылок в секунду — больше способов
// подогнать разбор, и выбор скорости тянулся к быстрым (на −5 дБ точка
// 10–14 шагов вместо 24).
const ELEMENT_COST = Number(process.env.ELEMENT_COST || 0);

function spread(nominal, lo, hi) {
  const from = Math.max(1, Math.round(nominal * lo)), to = Math.round(nominal * hi);
  const step = Math.max(1, Math.round(nominal / 12));
  const out = [];
  for (let d = from; d <= to; d += step) out.push(d);
  return out;
}

/**
 * @returns {Array<{text, score, letters, silence}>} до K разных прочтений,
 *          от лучшего по звуку к худшему.
 */
function parseBest(soft, unit, space, K) {
  K = K || 6;
  space = space || 1;
  const T = soft.length;
  const P = new Float64Array(T + 1);
  for (let i = 0; i < T; i++) P[i + 1] = P[i] + soft[i];

  const dots = spread(unit, 0.45, 1.9), dashes = spread(unit * 3, 0.62, 1.7);
  const inner = spread(unit, 0.4, 2.0);
  const letterGap = unit * 3 * space, wordGap = unit * 7 * space;
  const between = spread(letterGap, 0.6, 1.7), words = spread(wordGap, 0.65, 2.4);

  const size = (T + 1) * N * K;
  // Для каждого состояния — K лучших путей, по убыванию счёта.
  const As = new Float64Array(size).fill(NEG), Bs = new Float64Array(size).fill(NEG);
  const Ap = new Int32Array(size).fill(-1), Bp = new Int32Array(size).fill(-1);  // откуда: t*N+node
  const Ar = new Int8Array(size), Br = new Int8Array(size);                      // каким из K путей
  const Aw = new Int8Array(size), Bw = new Int8Array(size);                      // из какого набора
  const Ae = new Int8Array(size);                                                // что при этом вышло
  As[0] = 0;

  /** Вставить путь в список K лучших этого состояния. */
  const put = (S, Pp, Rr, Ww, Ee, base, v, from, rank, which, emit) => {
    if (v <= S[base + K - 1]) return;
    let at = K - 1;
    while (at > 0 && S[base + at - 1] < v) {
      S[base + at] = S[base + at - 1]; Pp[base + at] = Pp[base + at - 1];
      Rr[base + at] = Rr[base + at - 1]; Ww[base + at] = Ww[base + at - 1];
      if (Ee) Ee[base + at] = Ee[base + at - 1];
      at--;
    }
    S[base + at] = v; Pp[base + at] = from; Rr[base + at] = rank; Ww[base + at] = which;
    if (Ee) Ee[base + at] = emit;
  };

  const live = [];
  for (let t = 0; t <= T; t++) {
    live.length = 0;
    for (let k = 0; k < N; k++) {
      const base = (t * N + k) * K;
      if (As[base] > NEG) live.push([As[base], k, 0]);
      if (Bs[base] > NEG) live.push([Bs[base], k, 1]);
    }
    if (!live.length) continue;
    if (live.length > BEAM) {
      live.sort((p, q) => q[0] - p[0]);
      for (let i = BEAM; i < live.length; i++) {
        const base = (t * N + live[i][1]) * K;
        const S = live[i][2] ? Bs : As;
        for (let r = 0; r < K; r++) S[base + r] = NEG;
      }
      live.length = BEAM;
    }

    for (const [, node, which] of live) {
      const base = (t * N + node) * K;
      for (let rank = 0; rank < K; rank++) {
        const score = (which ? Bs : As)[base + rank];
        if (score <= NEG) break;
        if (!which) {
          const here = TREE[node];
          for (const [list, child, want] of [[dots, here.dot, unit], [dashes, here.dash, unit * 3]]) {
            if (child < 0) continue;
            for (const d of list) {
              if (t + d > T) break;
              const v = score + (P[t + d] - P[t]) - TIME_COST * misfit(d, want, MARK_SPREAD) - ELEMENT_COST;
              put(Bs, Bp, Br, Bw, null, ((t + d) * N + child) * K, v, t * N + node, rank, 0, 0);
            }
          }
        } else {
          const ch = TREE[node].ch;
          for (const d of inner) {
            if (t + d > T) break;
            const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, unit, GAP_SPREAD);
            put(As, Ap, Ar, Aw, Ae, ((t + d) * N + node) * K, v, t * N + node, rank, 1, 0);
          }
          if (!ch) continue;
          for (const [list, want, kind] of [[between, letterGap, 1], [words, wordGap, 2]]) {
            for (const d of list) {
              if (t + d > T) break;
              const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, want, GAP_SPREAD) - LETTER_COST;
              put(As, Ap, Ar, Aw, Ae, ((t + d) * N) * K, v, t * N + node, rank, 1, kind);
            }
          }
        }
      }
    }
  }

  const silence = -P[T];
  // Все концовки: кусок кончился паузой или последней посылкой.
  const ends = [];
  for (let r = 0; r < K; r++) {
    const v = As[(T * N) * K + r];
    if (v > NEG) ends.push([v, T * N, r, 0, '']);
  }
  for (let k = 1; k < N; k++) {
    const ch = TREE[k].ch;
    if (!ch) continue;
    for (let r = 0; r < K; r++) {
      const v = Bs[(T * N + k) * K + r];
      if (v > NEG) ends.push([v - LETTER_COST, T * N + k, r, 1, ch]);
    }
  }
  ends.sort((a, b) => b[0] - a[0]);

  const seen = new Set(), out = [];
  for (const [score, idx0, rank0, which0, tail] of ends) {
    let idx = idx0, rank = rank0, which = which0;
    const parts = tail ? [tail] : [];
    let guard = 0;
    while (guard++ < 100000) {
      const base = idx * K + rank;
      const from = which ? Bp[base] : Ap[base];
      if (!which) {
        const kind = Ae[base];
        if (kind === 2) parts.push(' ');
        if (kind >= 1 && from >= 0) parts.push(TREE[from % N].ch);
      }
      if (from < 0) break;
      const nextWhich = which ? Bw[base] : Aw[base];
      const nextRank = which ? Br[base] : Ar[base];
      idx = from; rank = nextRank; which = nextWhich;
      if (idx === 0 && !which) break;
    }
    const text = parts.reverse().join('').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    let letters = 0;
    for (const ch of text) if (ch !== ' ') letters++;
    out.push({ text, score, letters, silence });
    if (out.length >= K) break;
  }
  return out;
}

module.exports = { parseBest };
