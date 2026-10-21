/* The numbers, worked out from the rows. Both stores hand over the same two
 * lists and get the same answer — so what the page shows on a laptop and
 * what it shows in the cloud can't quietly drift apart.
 */

const DAY = 24 * 60 * 60 * 1000;

export function daysAgo(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
}

function tally(list, field) {
  const map = new Map();
  list.forEach(row => {
    const key = row[field] || '';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Откуда пришёл человек — по адресу страницы, с которой он к нам перешёл.
 *  Поисковики и площадки называются по имени, всё остальное — «другие сайты»;
 *  сам адрес нигде не хранится, только это одно слово. */
export function sourceOf(ref) {
  const host = String(ref || '').toLowerCase().replace(/^www\./, '');
  if (!host) return 'direct';
  const is = (...names) => names.some(n => host === n || host.endsWith('.' + n));
  if (is('google.com', 'google.ru', 'google.de', 'googleusercontent.com') || /(^|\.)google\.[a-z.]+$/.test(host)) return 'google';
  if (is('yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz')) return 'yandex';
  if (is('bing.com', 'duckduckgo.com', 'yahoo.com', 'search.marginalia.nu', 'rambler.ru', 'mail.ru', 'go.mail.ru')) return 'search';
  if (is('youtube.com', 'youtu.be', 'm.youtube.com')) return 'youtube';
  if (is('github.com', 'githubusercontent.com', 'github.io')) return 'github';
  if (is('t.me', 'telegram.org', 'vk.com', 'reddit.com', 'facebook.com', 'twitter.com', 'x.com', 'qrz.com', 'qrz.ru', 'forum.qrz.ru')) return 'social';
  if (is('r2fel.com')) return 'direct';
  return 'other';
}

/** Посещения сайта: те же дни, страны и столбики, что у программы. */
function siteSummary(siteRows, today) {
  const since30 = daysAgo(today, 30);
  const since7 = daysAgo(today, 7);
  const sum = (list) => list.reduce((n, r) => n + (r.hits || 0), 0);

  const pages = siteRows.filter(r => r.kind === 'page');
  const loads = siteRows.filter(r => r.kind !== 'page');
  const last30 = pages.filter(r => r.day >= since30);

  const byDay = new Map();
  pages.forEach(r => byDay.set(r.day, (byDay.get(r.day) || 0) + r.hits));
  const days = [];
  for (let i = 59; i >= 0; i--) {
    const day = daysAgo(today, i);
    days.push({ day, views: byDay.get(day) || 0 });
  }

  const weigh = (list, field) => {
    const map = new Map();
    list.forEach(r => map.set(r[field] || '', (map.get(r[field] || '') || 0) + r.hits));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  return {
    views: sum(pages),
    views30: sum(last30),
    views7: sum(pages.filter(r => r.day >= since7)),
    countries: weigh(last30, 'country'),
    sources: weigh(last30, 'source'),
    langs: weigh(last30, 'lang'),
    downloads: weigh(loads.filter(r => r.day >= since30), 'kind'),
    downloadsAll: sum(loads),
    days
  };
}

export function computeSummary(installs, dayRows, today, siteRows = []) {
  const since30 = daysAgo(today, 30);
  const since7 = daysAgo(today, 7);
  const live = installs.filter(i => i.last_seen >= since30);

  // Sixty days of history, including the quiet ones — a gap in the row of
  // columns says as much as a tall column.
  const byDay = new Map(dayRows.map(d => [d.day, d]));
  const days = [];
  for (let i = 59; i >= 0; i--) {
    const day = daysAgo(today, i);
    const d = byDay.get(day);
    days.push({ day, added: (d && d.added) || 0, seen: (d && d.seen) || 0 });
  }

  return {
    total: installs.length,
    active30: live.length,
    active7: installs.filter(i => i.last_seen >= since7).length,
    new7: installs.filter(i => i.first_seen >= since7).length,
    new30: installs.filter(i => i.first_seen >= since30).length,
    countries: tally(live, 'country'),
    versions: tally(live, 'version'),
    systems: tally(live, 'os'),
    langs: tally(live, 'lang'),
    days,
    site: siteSummary(siteRows, today),
    today
  };
}
