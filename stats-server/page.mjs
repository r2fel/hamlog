/* The page the owner opens to see how the program is doing. Same dark panel
 * and amber as the program itself, readable on a phone, no libraries — the
 * whole thing is one file the worker prints out.
 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 1 234 — thin spaces, so four figures don't read as one long number. */
const num = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** RU → 🇷🇺 : the two letters of a country code are two flag letters. */
function flag(code) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🏳';
  return String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const OS_NAME = { mac: 'Mac', win: 'Windows', web: 'Браузер' };

function rows(list, label) {
  if (!list || !list.length) return `<p class="empty">Пока пусто</p>`;
  const top = list[0][1] || 1;
  return `<table>${list.map(([name, n]) => `
    <tr>
      <td class="name">${label(name)}</td>
      <td class="bar"><span style="width:${Math.max(2, Math.round((n / top) * 100))}%"></span></td>
      <td class="n">${num(n)}</td>
    </tr>`).join('')}</table>`;
}

/** Sixty days of "new" and "opened it" as two rows of little columns. */
function chart(days) {
  if (!days.length) return '<p class="empty">Пока пусто</p>';
  const topSeen = Math.max(1, ...days.map(d => d.seen));
  const topNew = Math.max(1, ...days.map(d => d.added));
  const col = (d, value, top, cls) => `<span class="${cls}" style="height:${Math.round((value / top) * 100)}%"
    title="${d.day}: ${value}"></span>`;
  return `
    <div class="chart">
      <div class="chart-label">Открывали программу</div>
      <div class="bars">${days.map(d => col(d, d.seen, topSeen, 'seen')).join('')}</div>
      <div class="chart-label">Новые установки</div>
      <div class="bars">${days.map(d => col(d, d.added, topNew, 'added')).join('')}</div>
      <div class="chart-foot"><span>${esc(days[0].day)}</span><span>${esc(days[days.length - 1].day)}</span></div>
    </div>`;
}

export function statsPage(s, ctx) {
  const when = new Date(ctx.now).toISOString().replace('T', ' ').slice(0, 16);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R2FEL HamLog — статистика</title>
<style>
  :root {
    --chassis: #1c1b19; --panel: #26241f; --panel-raised: #2f2c26; --line: #443f37;
    --amber: #e8a23d; --amber-dim: #a97a3a; --green: #7ea36b;
    --paper: #ece7d8; --text-dim: #9c9587; --ink: #14130f;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 22px 16px 60px; background: var(--chassis); color: var(--paper);
    font: 15px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 780px; margin: 0 auto; }
  .mark { display: flex; align-items: center; gap: 9px; }
  .mark .call {
    font: 700 14px/1 'IBM Plex Mono', Menlo, monospace; letter-spacing: .16em;
    color: var(--ink); background: var(--amber); border-radius: 4px;
    padding: 5px 8px 4px; padding-left: calc(8px + .16em);
  }
  .mark .name { font: 700 27px/1 'Helvetica Neue', Arial, sans-serif; letter-spacing: .02em; }
  h1 { margin: 14px 0 2px; font-size: 19px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-dim); }
  .when { color: var(--text-dim); font-size: 13px; margin-bottom: 22px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  @media (max-width: 560px) { .tiles { grid-template-columns: 1fr; } }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
  .tile .big { font: 700 34px/1.1 'Helvetica Neue', Arial, sans-serif; color: var(--amber); }
  .tile.quiet .big { color: var(--paper); }
  .tile .cap { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
  h2 { margin: 30px 0 10px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; color: var(--amber-dim); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; vertical-align: middle; }
  td.name { white-space: nowrap; padding-right: 12px; }
  td.n { text-align: right; font: 600 15px 'IBM Plex Mono', Menlo, monospace; padding-left: 12px; width: 1%; }
  td.bar { width: 100%; }
  td.bar span { display: block; height: 8px; border-radius: 4px; background: var(--amber-dim); }
  .empty { color: var(--text-dim); margin: 4px 0; }
  .chart-label { color: var(--text-dim); font-size: 12px; margin: 6px 0 4px; }
  .bars { display: flex; align-items: flex-end; gap: 1px; height: 66px; }
  .bars span { flex: 1 1 0; min-height: 1px; border-radius: 2px 2px 0 0; background: var(--amber-dim); }
  .bars span.added { background: var(--green); }
  .chart-foot { display: flex; justify-content: space-between; color: var(--text-dim); font-size: 12px; margin-top: 6px; }
  footer { margin-top: 30px; color: var(--text-dim); font-size: 13px; line-height: 1.7; }
</style>
</head>
<body>
<div class="page">
  <div class="mark"><span class="call">R2FEL</span><span class="name">HamLog</span></div>
  <h1>Статистика</h1>
  <div class="when">Обновлено ${esc(when)} UTC</div>

  <div class="tiles">
    <div class="tile"><div class="big">${num(s.active30)}</div><div class="cap">пользуются — открывали за 30 дней</div></div>
    <div class="tile quiet"><div class="big">${num(s.total)}</div><div class="cap">установок всего</div></div>
    <div class="tile quiet"><div class="big">${num(s.new7)}</div><div class="cap">новых за неделю</div></div>
  </div>

  <h2>По дням</h2>
  <div class="card">${chart(s.days)}</div>

  <h2>Страны — за последние 30 дней</h2>
  <div class="card">${rows(s.countries, (c) => `${flag(c)} ${esc(c)}`)}</div>

  <h2>Версии</h2>
  <div class="card">${rows(s.versions, (v) => esc(v || '—'))}</div>

  <h2>Системы</h2>
  <div class="card">${rows(s.systems, (o) => esc(OS_NAME[o] || o || '—'))}</div>

  <h2>Язык программы</h2>
  <div class="card">${rows(s.langs, (l) => (l === 'ru' ? 'Русский режим' : l === 'en' ? 'Английский' : esc(l || '—')))}</div>

  <footer>
    Считаются копии программы, а не люди: один человек с двумя компьютерами — две установки,
    переустановил систему — ещё одна. Кто выключил проверку обновлений, сюда не попадает.<br>
    Ничего, кроме случайного номера установки, версии, системы, языка и страны, не сохраняется —
    ни позывного, ни журнала, ни сетевого адреса.
  </footer>
</div>
</body>
</html>`;
}
