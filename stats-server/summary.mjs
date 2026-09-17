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

export function computeSummary(installs, dayRows, today) {
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
    today
  };
}
