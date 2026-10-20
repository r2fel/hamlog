/* Tidying a log that holds the same contact twice.
 *
 * However it got there — two files imported with the time written two ways (a
 * time zone), a contact logged twice, a file read twice — the same contact can sit
 * in the log more than once. The import's own check compares the time exactly, so
 * a copy that is an hour or two off slips past it (03.10.2026: 102 such pairs in
 * the owner's log of 391, from a file that held local time).
 *
 * Pure logic, no storage and no screen, like sync-merge.js, so it can be tried in
 * Node (scratchpad/sync/test-log-tools.js): which contacts are twins, and what a
 * merged pair keeps. The page decides what to do with it, and asks first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sync-merge.js'));
  else root.R2Log = factory(root.R2Sync);
}(typeof self !== 'undefined' ? self : this, function (Sync) {
  'use strict';

  // The kinds of twins, by how far apart their times are (minutes).
  //   zone  a whole number of hours (an hour to half a day): a time zone
  //   same  the very same minute: logged twice
  //   near  a few minutes: maybe one contact twice, maybe two real ones — the operator looks
  const KINDS = {
    zone: { min: 60, max: 12 * 60, step: 60 },
    same: { min: 0, max: 0, step: 1 },
    near: { min: 1, max: 10, step: 1 }
  };

  const SSB = { USB: 'SSB', LSB: 'SSB' };

  const modeKey = m => {
    const up = String(m || '').toUpperCase();
    return SSB[up] || up;
  };

  /** Minutes since 1970 of a contact's date and time, both as the log writes them; NaN if unreadable. */
  function minutesOf(e) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e && e.date || '');
    const t = /^(\d{1,2}):(\d{2})/.exec(e && e.time || '');
    if (!d || !t) return NaN;
    return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) / 60000;
  }

  /** A date and a time moved by some minutes (the date can change). → { date, time } */
  function shiftStamp(date, time, minutes) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    if (!d || !t) return { date, time };
    const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) + minutes * 60000;
    const x = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return {
      date: `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`,
      time: `${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`
    };
  }

  /**
   * The offset of the computer's own time zone from UTC, in minutes, for a
   * given moment (+120 in Kaliningrad; it moves with summer time elsewhere).
   * The date and time are read as local time on this computer.
   */
  function localOffsetMin(date, time) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    const west = (!d || !t) ? new Date().getTimezoneOffset()
      : new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]).getTimezoneOffset();
    return west === 0 ? 0 : -west;     // (not -0)
  }

  /**
   * Pairs of contacts that are the same one written twice: the same callsign and band, the
   * same kind of emission, and the times apart by what `kind` says (see KINDS). Each contact is
   * in at most one pair; the nearest pairs are made first.
   * → [{ early, late, offsetMin }]
   */
  function findTwins(list, kind) {
    const k = KINDS[kind] || KINDS.zone;
    const buckets = new Map();
    list.forEach(e => {
      if (!e || !e.callsign || !Number.isFinite(minutesOf(e))) return;
      const key = `${String(e.callsign).toUpperCase()}|${String(e.band || '').toLowerCase()}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    });

    const pairs = [];
    buckets.forEach(items => {
      if (items.length < 2) return;
      const cand = [];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.mode && b.mode && modeKey(a.mode) !== modeKey(b.mode)) continue;
          const diff = Math.abs(minutesOf(a) - minutesOf(b));
          if (diff < k.min || diff > k.max || diff % k.step !== 0) continue;
          cand.push({ a, b, diff });
        }
      }
      cand.sort((x, y) => x.diff - y.diff);
      const used = new Set();
      cand.forEach(({ a, b, diff }) => {
        if (used.has(a.id) || used.has(b.id)) return;
        used.add(a.id);
        used.add(b.id);
        let early = a;
        const ta = minutesOf(a);
        const tb = minutesOf(b);
        if (tb < ta || (tb === ta && String(b.createdAt || '') < String(a.createdAt || ''))) early = b;
        pairs.push({ early, late: early === a ? b : a, offsetMin: diff });
      });
    });
    return pairs;
  }

  /** How many pairs for each offset, biggest first: [[120, 102], …]. */
  function offsetCounts(pairs) {
    const m = new Map();
    pairs.forEach(p => m.set(p.offsetMin, (m.get(p.offsetMin) || 0) + 1));
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  }

  /**
   * One contact left of two: `keep`, with whatever `drop` knew and it did not — blank fields
   * filled, QSL marks added (never lost), the earlier "created". A new object; neither argument changes.
   */
  function mergeTwin(keep, drop) {
    const out = JSON.parse(JSON.stringify(keep));
    Sync.unionQsl(out, drop);
    Sync.fillBlanks(out, drop);
    ['name', 'country', 'grid', 'rda', 'qth', 'notes', 'email', 'myRda', 'myQth', 'pota', 'myPota'].forEach(f => {
      if (!out[f] && drop[f]) out[f] = drop[f];
    });
    if (drop.createdAt && (!out.createdAt || drop.createdAt < out.createdAt)) out.createdAt = drop.createdAt;
    return out;
  }

  return { KINDS, minutesOf, shiftStamp, localOffsetMin, findTwins, offsetCounts, mergeTwin };
}));
