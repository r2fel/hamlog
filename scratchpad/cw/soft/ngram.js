// Посимвольная n-граммная модель: вероятность следующего знака по трём
// предыдущим. Это настоящая вероятность текста, а не сумма премий за
// знакомые слова — и её нельзя обмануть дроблением: лишний пробел или
// лишняя буква только понижают вероятность. Так устроена марковская
// модель сообщения в CW Skimmer.
'use strict';

const ORDER = 4;   // знак по трём предыдущим

/** Знаки, которые различает модель: всё прочее сводится к одному. */
const norm = ch => /[A-Z0-9 /?=]/.test(ch) ? ch : '#';

/**
 * Обучение со сглаживанием Виттена — Белла: если такой тройки знаков ещё не
 * видели, вероятность берётся у более короткого прошлого, и ровно настолько,
 * насколько часто за этим прошлым шло что-то новое. Модель не обнуляет
 * незнакомое — позывные и имена бывают любыми, — но и не раздаёт
 * вероятность ему щедро.
 */
function train(text) {
  const counts = [];          // counts[k]: Map(контекст длины k → Map(знак → число))
  for (let k = 0; k < ORDER; k++) counts.push(new Map());
  const s = ('   ' + text.toUpperCase()).split('').map(norm).join('');
  for (let i = ORDER - 1; i < s.length; i++) {
    const ch = s[i];
    for (let k = 0; k < ORDER; k++) {
      const ctx = s.slice(i - k, i);
      let m = counts[k].get(ctx);
      if (!m) { m = new Map(); counts[k].set(ctx, m); }
      m.set(ch, (m.get(ch) || 0) + 1);
    }
  }
  // Для каждого контекста — сколько всего и сколько разных продолжений.
  const totals = counts.map(level => {
    const t = new Map();
    for (const [ctx, m] of level) {
      let n = 0;
      for (const v of m.values()) n += v;
      t.set(ctx, [n, m.size]);
    }
    return t;
  });
  const alphabet = new Set(s.split(''));
  return { counts, totals, V: alphabet.size };
}

/** Вероятность знака после контекста, со сглаживанием. */
function prob(model, ctx, ch) {
  let p = 1 / model.V;                     // ничего не знаем — все знаки равны
  for (let k = 0; k < ORDER; k++) {
    const c = ctx.slice(ctx.length - k);
    const tot = model.totals[k].get(c);
    if (!tot) continue;
    const [n, distinct] = tot;
    const seen = model.counts[k].get(c).get(ch) || 0;
    const lambda = n / (n + distinct);     // насколько верим этому контексту
    p = lambda * (seen / n) + (1 - lambda) * p;
  }
  return p;
}

/** Логарифм вероятности всего текста (по основанию e). */
function logProb(model, text) {
  const s = ('   ' + text.toUpperCase().replace(/\s+/g, ' ').trim() + ' ').split('').map(norm).join('');
  let lp = 0;
  for (let i = ORDER - 1; i < s.length; i++) lp += Math.log(prob(model, s.slice(i - ORDER + 1, i), s[i]));
  return lp;
}

module.exports = { train, logProb, prob, ORDER };
