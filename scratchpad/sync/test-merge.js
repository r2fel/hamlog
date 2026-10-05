// Tries public/sync-merge.js to destruction. Run: node scratchpad/sync/test-merge.js
const assert = require('assert');
const S = require('../../public/sync-merge.js');

let clock = Date.parse('2026-10-01T10:00:00Z');
const tick = () => { clock += 60000; return new Date(clock).toISOString(); };

let seq = 0;
const mkEntry = (over = {}) => {
  seq += 1;
  const e = { id: `id${String(seq).padStart(4, '0')}`, callsign: `R${seq}TEST`, date: '2026-10-01', time: `${String(10 + (seq % 10)).padStart(2, '0')}:00`, band: '20m', mode: 'SSB', name: '', createdAt: tick(), updatedAt: tick() };
  return Object.assign(e, over);
};

class Machine {
  constructor(name) { this.name = name; this.entries = []; this.tombs = []; }
  add(over) { const e = mkEntry(over); this.entries.push(e); return e; }
  edit(id, patch) { const e = this.entries.find(x => x.id === id); Object.assign(e, patch, { updatedAt: tick() }); }
  del(id) {
    const i = this.entries.findIndex(x => x.id === id);
    if (i === -1) return;
    const [e] = this.entries.splice(i, 1);
    this.tombs.push({ id: e.id, key: S.defaultKey(e), at: tick() });
  }
  file() { return S.buildFile({ id: this.name, name: this.name, entries: JSON.parse(JSON.stringify(this.entries)), deleted: JSON.parse(JSON.stringify(this.tombs)), now: new Date(clock).toISOString() }); }
  // answer: 'yes' (delete asked ones), 'no' (keep them), or a function(entry) -> bool
  pull(other, answer = 'yes') {
    const remote = JSON.parse(JSON.stringify(other.file()));
    const plan = S.planMerge({ local: this.entries, remote, localDeleted: this.tombs });
    const drop = plan.ask.filter(a => (typeof answer === 'function' ? answer(a.entry) : answer === 'yes')).map(a => a.entry.id);
    const res = S.applyPlan(this.entries, plan, { drop, now: tick() });
    this.entries = res.list;
    this.tombs = this.tombs.concat(res.tombs);
    return { plan, res };
  }
}

const canon = o => (Array.isArray(o) ? o.map(canon) : o && typeof o === 'object'
  ? Object.keys(o).sort().reduce((acc, k) => { acc[k] = canon(o[k]); return acc; }, {}) : o);
const norm = m => JSON.stringify(canon(m.entries.slice().sort((a, b) => a.id.localeCompare(b.id))));
const keys = m => m.entries.map(S.defaultKey).sort();

function sync(a, b, answer) {
  for (let i = 0; i < 6; i++) {
    const before = norm(a) + norm(b);
    a.pull(b, answer); b.pull(a, answer);
    if (norm(a) + norm(b) === before) return i;
  }
  return -1;
}

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok   ' + name); };

test('new contacts arrive, nothing doubles', () => {
  const a = new Machine('A'), b = new Machine('B');
  a.add(); a.add(); b.add();
  assert.ok(sync(a, b) >= 0);
  assert.strictEqual(a.entries.length, 3);
  assert.strictEqual(norm(a), norm(b));
});

test('merging twice changes nothing', () => {
  const a = new Machine('A'), b = new Machine('B');
  a.add(); b.add();
  sync(a, b);
  const r = a.pull(b);
  assert.strictEqual(r.plan.add.length + r.plan.update.length + r.plan.ask.length, 0);
});

test('the later edit wins, whichever way round', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ name: 'Ivan' });
  sync(a, b);
  b.edit(e.id, { name: 'Ivan Petrov' });
  sync(a, b);
  assert.strictEqual(a.entries[0].name, 'Ivan Petrov');
  a.edit(e.id, { name: 'Ivan P.' });
  sync(a, b);
  assert.strictEqual(b.entries[0].name, 'Ivan P.');
});

test('an older edit does not overwrite a newer one', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ name: 'x' });
  sync(a, b);
  b.edit(e.id, { name: 'older' });
  a.edit(e.id, { name: 'newer' });
  sync(a, b);
  assert.strictEqual(a.entries[0].name, 'newer');
  assert.strictEqual(b.entries[0].name, 'newer');
});

test('a QSL mark is never lost: union, from both sides, even with equal stamps', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({});
  sync(a, b);
  a.entries[0].lotwSent = 'Y'; a.entries[0].lotwSentDate = '2026-10-02';
  b.entries[0].eqslSent = 'Y'; b.entries[0].eqslSentDate = '2026-10-03';
  sync(a, b);
  for (const m of [a, b]) {
    assert.strictEqual(m.entries[0].lotwSent, 'Y');
    assert.strictEqual(m.entries[0].eqslSent, 'Y');
  }
  assert.strictEqual(norm(a), norm(b));
});

test('a QSL mark survives the other computer editing the contact later', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ name: 'x' });
  sync(a, b);
  a.entries[0].lotwSent = 'Y'; a.entries[0].lotwSentDate = '2026-10-02';
  b.edit(e.id, { name: 'edited on B, later' });
  sync(a, b);
  assert.strictEqual(a.entries[0].lotwSent, 'Y');
  assert.strictEqual(b.entries[0].lotwSent, 'Y');
  assert.strictEqual(a.entries[0].name, 'edited on B, later');
});

test('two computers that imported the same file converge on one id, no duplicates', () => {
  const a = new Machine('A'), b = new Machine('B');
  a.entries.push({ id: 'zzz', callsign: 'UA9TEST', date: '2026-10-01', time: '12:00', band: '40m', mode: 'SSB' });
  b.entries.push({ id: 'aaa', callsign: 'UA9TEST', date: '2026-10-01', time: '12:00', band: '40m', mode: 'SSB' });
  sync(a, b);
  assert.strictEqual(a.entries.length, 1);
  assert.strictEqual(b.entries.length, 1);
  assert.strictEqual(a.entries[0].id, 'aaa');
  assert.strictEqual(b.entries[0].id, 'aaa');
  // and an edit that changes the key afterwards still finds its twin
  b.edit('aaa', { time: '12:05' });
  sync(a, b);
  assert.strictEqual(a.entries.length, 1);
  assert.strictEqual(a.entries[0].time, '12:05');
});

test('editing the callsign (the key) does not duplicate the contact', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ callsign: 'UA9TSET' });
  sync(a, b);
  a.edit(e.id, { callsign: 'UA9TEST' });
  sync(a, b);
  assert.strictEqual(b.entries.length, 1);
  assert.strictEqual(b.entries[0].callsign, 'UA9TEST');
});

test('a deletion is asked about, never done silently', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add();
  a.add();
  sync(a, b);
  a.del(e.id);
  const r = b.pull(a, 'no');
  assert.strictEqual(r.plan.ask.length, 1);
  assert.strictEqual(b.entries.length, 2);          // kept: nobody said yes
});

test('answering yes deletes, and the deletion is remembered so it cannot come back', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add();
  sync(a, b);
  a.del(e.id);
  b.pull(a, 'yes');
  assert.strictEqual(b.entries.length, 0);
  a.pull(b); b.pull(a);
  assert.strictEqual(a.entries.length, 0);
  assert.strictEqual(b.entries.length, 0);
});

test('"keep them" brings the contact back to the computer that deleted it', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ name: 'keep me' });
  sync(a, b);
  a.del(e.id);
  b.pull(a, 'no');          // B keeps it (and it becomes newer than the deletion)
  a.pull(b, 'yes');
  assert.strictEqual(a.entries.length, 1);
  assert.strictEqual(a.entries[0].name, 'keep me');
  sync(a, b);
  assert.strictEqual(norm(a), norm(b));
});

test('a contact edited after it was deleted elsewhere is not deleted', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add({ name: 'x' });
  sync(a, b);
  a.del(e.id);
  b.edit(e.id, { name: 'still working with them' });
  const r = b.pull(a, 'yes');
  assert.strictEqual(r.plan.ask.length, 0);
  assert.strictEqual(b.entries.length, 1);
  a.pull(b);
  assert.strictEqual(a.entries.length, 1);          // the edit outlived the deletion
});

test('a deletion stays deleted: the other computer\'s old copy is not re-added', () => {
  const a = new Machine('A'), b = new Machine('B');
  const e = a.add();
  sync(a, b);
  a.del(e.id);
  const staleB = b.file();
  const plan = S.planMerge({ local: a.entries, remote: staleB, localDeleted: a.tombs });
  assert.strictEqual(plan.add.length, 0);
  assert.strictEqual(plan.skipped, 1);
});

test('clearing the whole log is a question on the other side, one per contact', () => {
  const a = new Machine('A'), b = new Machine('B');
  for (let i = 0; i < 5; i++) a.add();
  sync(a, b);
  a.entries.slice().forEach(e => a.del(e.id));
  const r = b.pull(a, 'no');
  assert.strictEqual(r.plan.ask.length, 5);
  assert.strictEqual(b.entries.length, 5);
});

test('files that are not ours, or from the future, are refused', () => {
  assert.strictEqual(S.parseFile('nonsense').ok, false);
  assert.strictEqual(S.parseFile('{"format":"other"}').ok, false);
  assert.strictEqual(S.parseFile(JSON.stringify({ format: S.FORMAT, v: 99, id: 'x', entries: [] })).ok, false);
  assert.strictEqual(S.parseFile(JSON.stringify({ format: S.FORMAT, v: 1, id: 'x', entries: [] })).ok, true);
});

test('old deletions are forgotten after a year, and the list is capped', () => {
  const now = Date.parse('2026-10-03T00:00:00Z');
  const tombs = [{ id: 'old', key: 'k', at: '2025-01-01T00:00:00Z' }, { id: 'new', key: 'k2', at: '2026-09-01T00:00:00Z' }];
  assert.deepStrictEqual(S.pruneTombs(tombs, now).map(t => t.id), ['new']);
  const many = Array.from({ length: 6000 }, (_, i) => ({ id: 'i' + i, key: 'k' + i, at: '2026-09-01T00:00:00Z' }));
  assert.strictEqual(S.pruneTombs(many, now).length, 5000);
});

test('a hundred thousand contacts merge in a blink', () => {
  const local = [], remote = [];
  for (let i = 0; i < 100000; i++) {
    const e = { id: 'x' + i, callsign: 'C' + i, date: '2026-10-01', time: '10:00', band: '20m', updatedAt: '2026-10-01T10:00:00Z' };
    local.push(e); if (i % 2) remote.push(Object.assign({}, e));
  }
  remote.push({ id: 'new1', callsign: 'NEW', date: '2026-10-02', time: '10:00', band: '20m' });
  const t0 = Date.now();
  const plan = S.planMerge({ local, remote: { entries: remote, deleted: [] }, localDeleted: [] });
  assert.strictEqual(plan.add.length, 1);
  assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms`);
});

// ---- Fuzz: two computers, random work, then syncing; they must end up identical ----
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

function fuzz(seed, answerMode) {
  const r = rng(seed);
  const a = new Machine('A'), b = new Machine('B');
  const m = [a, b];
  let n = 0;
  const fresh = () => `K${++n}ABC`;                 // every key in the story is new: a duplicate can only be the merge's doing
  for (let step = 0; step < 60; step++) {
    const x = m[Math.floor(r() * 2)];
    const op = r();
    if (op < 0.3 || !x.entries.length) x.add({ callsign: fresh() });
    else if (op < 0.5) x.edit(x.entries[Math.floor(r() * x.entries.length)].id, { name: 'n' + Math.floor(r() * 99) });
    else if (op < 0.6) {
      const e = x.entries[Math.floor(r() * x.entries.length)];
      e.lotwSent = 'Y'; e.lotwSentDate = '2026-10-0' + (1 + Math.floor(r() * 8));
    } else if (op < 0.7) x.del(x.entries[Math.floor(r() * x.entries.length)].id);
    else if (op < 0.78) x.edit(x.entries[Math.floor(r() * x.entries.length)].id, { callsign: fresh() });
    else if (op < 0.84) {
      // the same file imported on both computers: one contact, two ids
      const call = fresh();
      a.add({ callsign: call }); b.add({ callsign: call });
    } else if (op < 0.92) x.pull(x === a ? b : a, answerMode);
    else x.pull(x === a ? b : a, 'yes');
  }
  return { a, b, rounds: sync(a, b, answerMode) };
}

[['yes', 'always yes'], ['no', 'always no']].forEach(([mode, label]) => {
  test(`fuzz, 400 random histories, deletions answered: ${label}`, () => {
    let bad = 0, firstBad = null;
    for (let seed = 1; seed <= 400; seed++) {
      const { a, b, rounds } = fuzz(seed, mode);
      const sameKeysInside = k => new Set(k).size === k.length;
      if (rounds < 0 || norm(a) !== norm(b)) { bad++; firstBad = firstBad || seed; }
      // no two contacts with the same key in either log (the merge must never double)
      if (!sameKeysInside(keys(a)) || !sameKeysInside(keys(b))) { bad++; firstBad = firstBad || seed; }
    }
    assert.strictEqual(bad, 0, `${bad} histories did not converge cleanly (first: seed ${firstBad})`);
  });
});

// Three computers (home, work, an old laptop), everyone pulling from everyone.
function fuzz3(seed, answerMode) {
  const r = rng(seed * 7 + 3);
  const ms = [new Machine('A'), new Machine('B'), new Machine('C')];
  let n = 0;
  const fresh = () => `Q${++n}XYZ`;
  const other = x => { const o = ms.filter(m => m !== x); return o[Math.floor(r() * o.length)]; };
  for (let step = 0; step < 80; step++) {
    const x = ms[Math.floor(r() * 3)];
    const op = r();
    if (op < 0.3 || !x.entries.length) x.add({ callsign: fresh() });
    else if (op < 0.5) x.edit(x.entries[Math.floor(r() * x.entries.length)].id, { name: 'n' + Math.floor(r() * 99) });
    else if (op < 0.6) { const e = x.entries[Math.floor(r() * x.entries.length)]; e.eqslSent = 'Y'; e.eqslSentDate = '2026-10-0' + (1 + Math.floor(r() * 8)); }
    else if (op < 0.68) x.del(x.entries[Math.floor(r() * x.entries.length)].id);
    else if (op < 0.76) x.edit(x.entries[Math.floor(r() * x.entries.length)].id, { callsign: fresh() });
    else if (op < 0.82) { const call = fresh(); ms.forEach(m => m.add({ callsign: call })); }
    else x.pull(other(x), r() < 0.8 ? answerMode : 'yes');
  }
  for (let round = 0; round < 8; round++) {
    const before = ms.map(norm).join('');
    ms.forEach(x => ms.forEach(y => { if (x !== y) x.pull(y, answerMode); }));
    if (ms.map(norm).join('') === before) break;
  }
  return ms;
}
[['yes', 'always yes'], ['no', 'always no']].forEach(([mode, label]) => {
  test(`fuzz, three computers, 200 histories, deletions answered: ${label}`, () => {
    let bad = 0, first = null;
    for (let seed = 1; seed <= 200; seed++) {
      const ms = fuzz3(seed, mode);
      const same = ms.every(m => norm(m) === norm(ms[0]));
      const noDup = ms.every(m => new Set(keys(m)).size === keys(m).length);
      if (!same || !noDup) { bad++; first = first || seed; }
    }
    assert.strictEqual(bad, 0, `${bad} histories did not converge cleanly (first: seed ${first})`);
  });
});

console.log(`\n${passed} tests passed`);
