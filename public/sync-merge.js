/* Merging two logbooks that were kept on different computers.
 *
 * Pure logic, no storage and no screen: the page (app.js) feeds it its own
 * contacts and what another computer left behind, gets back a plan, and does
 * the saving itself. Kept separate so it can be tried to destruction in Node
 * (scratchpad/sync/) — a merge that loses or doubles contacts is the one way
 * this feature can hurt a log.
 *
 * The rules, in the order they matter:
 *   - Nothing is ever deleted without being asked. A contact deleted on
 *     another computer comes back as a question ("ask"), not an action.
 *   - A contact is "the same one" when it has the same id, or — two
 *     computers that each imported the same file — the same callsign, date,
 *     time and band. Same-key contacts with different ids are brought to one
 *     id (the smaller), so later edits keep finding each other.
 *   - The later edit wins (updatedAt). With equal or missing stamps nothing
 *     is overwritten: blanks are filled in and QSL marks are added, never
 *     taken away.
 *   - A QSL mark ("sent to LoTW") is never lost: it is the union of what
 *     either computer knows.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.R2Sync = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'r2fel-hamlog-sync';
  const VERSION = 1;
  const QSL_KEYS = ['lotw', 'eqsl', 'hamlog', 'srr', 'card'];
  const FILL_FIELDS = ['name', 'country', 'grid', 'rda', 'qth', 'notes', 'myRda', 'myQth', 'email'];
  const TOMB_DAYS = 365;
  const TOMB_MAX = 5000;

  const defaultKey = e => [e.callsign, e.date, e.time, e.band].join('|');

  /** updatedAt as milliseconds; anything unreadable counts as "never". */
  function stamp(e) {
    const t = Date.parse(e && e.updatedAt);
    return Number.isFinite(t) ? t : 0;
  }

  function tombMs(t) {
    const ms = Date.parse(t && t.at);
    return Number.isFinite(ms) ? ms : 0;
  }

  /** Adds to `into` every QSL mark `from` has and it lacks. True when it did. */
  function unionQsl(into, from, qslKeys) {
    let changed = false;
    (qslKeys || QSL_KEYS).forEach(key => {
      ['Sent', 'Rcvd'].forEach(part => {
        const field = key + part;
        if (from[field] && !into[field]) {
          into[field] = from[field];
          if (from[`${field}Date`]) into[`${field}Date`] = from[`${field}Date`];
          changed = true;
        } else if (from[field] && into[field] && from[`${field}Date`] &&
                   (!into[`${field}Date`] || from[`${field}Date`] < into[`${field}Date`])) {
          // Both know; the earlier date is the true one. Same answer on both sides.
          into[`${field}Date`] = from[`${field}Date`];
          changed = true;
        }
      });
    });
    return changed;
  }

  /** Fills blanks (and takes the fuller text) from `from`, as an import does. True when it did. */
  function fillBlanks(into, from) {
    let changed = false;
    FILL_FIELDS.forEach(field => {
      const have = into[field] || '';
      const next = from[field] || '';
      if (next && next.length > have.length) { into[field] = next; changed = true; }
    });
    if (!into.freq && from.freq) {
      into.freq = from.freq;
      if (from.freqHz !== undefined) into.freqHz = from.freqHz;
      changed = true;
    }
    return changed;
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /**
   * What merging `remote` (another computer's file) into `local` would do.
   *
   *   local        this computer's contacts
   *   remote       { entries, deleted } from the other computer
   *   localDeleted this computer's own deletions [{ id, key, at }]
   *
   * → { add, update, ask, skipped }
   *   add     contacts that are new here
   *   update  [{ fromId, entry }] — a local contact becomes `entry` (its id
   *           may change: the smaller of the two wins)
   *   ask     [{ entry, tomb }] — deleted over there, still here: to be asked
   *   skipped contacts left out because they were deleted here on purpose
   */
  function planMerge({ local, remote, localDeleted, keyOf, qslKeys }) {
    const key = keyOf || defaultKey;
    const remoteEntries = (remote && remote.entries) || [];
    const remoteDeleted = (remote && remote.deleted) || [];
    const ownDeleted = localDeleted || [];

    const byId = new Map();
    const byKey = new Map();
    local.forEach(e => {
      byId.set(e.id, e);
      const k = key(e);
      if (!byKey.has(k)) byKey.set(k, e);
    });

    const tombById = new Map();
    const tombByKey = new Map();
    ownDeleted.forEach(t => {
      const ms = tombMs(t);
      if (t.id && (tombMs(tombById.get(t.id)) < ms)) tombById.set(t.id, t);
      if (t.key && (tombMs(tombByKey.get(t.key)) < ms)) tombByKey.set(t.key, t);
    });
    const ownTomb = e => {
      const a = tombById.get(e.id);
      const b = tombByKey.get(key(e));
      return tombMs(a) >= tombMs(b) ? a : b;
    };

    const plan = { add: [], update: [], ask: [], skipped: 0 };
    const matched = new Set();     // local ids already taken by a remote contact
    const addedKeys = new Set();   // the same contact twice in one file

    remoteEntries.forEach(r => {
      if (!r || !r.id || !r.callsign || !r.date) return;

      // Deleted here on purpose, and not edited over there since: leave it out.
      const tomb = ownTomb(r);
      if (tomb && tombMs(tomb) >= stamp(r)) { plan.skipped++; return; }

      const rKey = key(r);
      let l = byId.get(r.id);
      if (!l) {
        const byK = byKey.get(rKey);
        if (byK && !matched.has(byK.id)) l = byK;
      }

      if (!l) {
        if (addedKeys.has(rKey)) return;
        addedKeys.add(rKey);
        plan.add.push(clone(r));
        return;
      }
      matched.add(l.id);

      const finalId = l.id <= r.id ? l.id : r.id;
      const lu = stamp(l);
      const ru = stamp(r);
      let next = null;

      if (ru > lu) {
        // Theirs is the later edit. Take it whole — but keep every mark either side has.
        next = clone(r);
        unionQsl(next, l, qslKeys);
        if (l.createdAt && (!next.createdAt || l.createdAt < next.createdAt)) next.createdAt = l.createdAt;
      } else {
        // Ours is later, or neither is dated: ours stays; the marks and the blanks still flow in.
        const copy = clone(l);
        const a = unionQsl(copy, r, qslKeys);
        const b = ru === lu ? fillBlanks(copy, r) : false;
        // The earlier "created" is the true one — and the same on both sides.
        const c = Boolean(r.createdAt && (!copy.createdAt || r.createdAt < copy.createdAt));
        if (c) copy.createdAt = r.createdAt;
        if (a || b || c) next = copy;
      }

      if (next) next.id = finalId;
      if (next || finalId !== l.id) {
        const entry = next || Object.assign(clone(l), { id: finalId });
        plan.update.push({ fromId: l.id, entry });
      }
    });

    // What the other computer deleted. A contact edited after the deletion, or
    // still alive in their file with a later stamp, is not part of it.
    const liveRemote = new Map();
    remoteEntries.forEach(r => { if (r && r.id) liveRemote.set(r.id, r); });
    remoteDeleted.forEach(t => {
      const l = (t.id && byId.get(t.id)) || (t.key && byKey.get(t.key));
      if (!l) return;
      if (stamp(l) > tombMs(t)) return;
      const alive = liveRemote.get(l.id);
      if (alive && stamp(alive) > tombMs(t)) return;
      if (plan.ask.some(a => a.entry.id === l.id)) return;
      plan.ask.push({ entry: l, tomb: t });
    });

    return plan;
  }

  /**
   * The list after the plan is carried out, and exactly what to write to
   * the database: `saved` (put these) and `removed` (delete these ids).
   * `drop` says which of the "ask" contacts the operator agreed to delete.
   */
  function applyPlan(list, plan, { drop, keyOf, now } = {}) {
    const key = keyOf || defaultKey;
    const stampNow = now || new Date().toISOString();
    const out = list.slice();
    const saved = [];
    const removed = [];
    const newTombs = [];

    plan.update.forEach(({ fromId, entry }) => {
      const i = out.findIndex(e => e.id === fromId);
      if (i === -1) return;
      out[i] = entry;
      saved.push(entry);
      if (entry.id !== fromId) removed.push(fromId);
    });
    plan.add.forEach(entry => { out.push(entry); saved.push(entry); });

    const dropIds = new Set(drop || []);
    const keepIds = new Set();
    plan.ask.forEach(({ entry }) => {
      if (dropIds.has(entry.id)) {
        const i = out.findIndex(e => e.id === entry.id);
        if (i !== -1) {
          out.splice(i, 1);
          removed.push(entry.id);
          newTombs.push({ id: entry.id, key: key(entry), at: stampNow });
        }
      } else if (drop) {
        keepIds.add(entry.id);
      }
    });
    // "Keep them": they come back everywhere, because they are newer than the deletion now.
    if (keepIds.size) {
      out.forEach((e, i) => {
        if (keepIds.has(e.id)) {
          out[i] = Object.assign({}, e, { updatedAt: stampNow });
          saved.push(out[i]);
        }
      });
    }

    return { list: out, saved, removed, tombs: newTombs };
  }

  /** The deletion list, trimmed: a year is plenty, and it must not grow for ever. */
  function pruneTombs(list, nowMs) {
    const limit = (nowMs || Date.now()) - TOMB_DAYS * 86400000;
    const fresh = (list || []).filter(t => tombMs(t) >= limit);
    return fresh.length > TOMB_MAX ? fresh.slice(fresh.length - TOMB_MAX) : fresh;
  }

  function buildFile({ id, name, app, entries, deleted, now }) {
    return {
      format: FORMAT,
      v: VERSION,
      id,
      name,
      app: app || '',
      savedAt: now || new Date().toISOString(),
      count: entries.length,
      entries,
      deleted: deleted || []
    };
  }

  /** → { ok: true, data } or { ok: false, error }. Anything that is not one of ours is refused. */
  function parseFile(text) {
    let data;
    try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, error: 'not a readable file' }; }
    if (!data || data.format !== FORMAT) return { ok: false, error: 'not a synchronisation file of this program' };
    if (!Number.isFinite(data.v) || data.v > VERSION) return { ok: false, error: 'made by a newer version of the program' };
    if (!Array.isArray(data.entries)) return { ok: false, error: 'no contacts in it' };
    if (!data.id) return { ok: false, error: 'no computer mark in it' };
    data.deleted = Array.isArray(data.deleted) ? data.deleted : [];
    return { ok: true, data };
  }

  return { FORMAT, VERSION, QSL_KEYS, defaultKey, stamp, planMerge, applyPlan, pruneTombs, buildFile, parseFile, unionQsl, fillBlanks };
}));
