// Tries public/log-tools.js: twins, merging, shifted times — and the owner's real log.
// Run: node scratchpad/sync/test-log-tools.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../../public/log-tools.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok   ' + name); };
const mk = (id, call, date, time, band, extra) => Object.assign({ id, callsign: call, date, time, band, mode: 'SSB' }, extra || {});

test('a time moves across midnight, month and year', () => {
  assert.deepStrictEqual(T.shiftStamp('2026-10-03', '01:30', -120), { date: '2026-10-02', time: '23:30' });
  assert.deepStrictEqual(T.shiftStamp('2026-03-01', '00:10', -120), { date: '2026-02-28', time: '22:10' });
  assert.deepStrictEqual(T.shiftStamp('2026-01-01', '00:00', -60), { date: '2025-12-31', time: '23:00' });
  assert.deepStrictEqual(T.shiftStamp('2026-12-31', '23:30', 120), { date: '2027-01-01', time: '01:30' });
  assert.deepStrictEqual(T.shiftStamp('2024-02-29', '23:00', 120), { date: '2024-03-01', time: '01:00' });
  assert.deepStrictEqual(T.shiftStamp('garbage', '', 60), { date: 'garbage', time: '' });
});

test('the computer\'s own offset follows summer time', () => {
  process.env.TZ = 'Europe/Kaliningrad';
  assert.strictEqual(T.localOffsetMin('2026-07-07', '18:00'), 120);
  assert.strictEqual(T.localOffsetMin('2026-12-22', '16:00'), 120);
  process.env.TZ = 'Europe/Berlin';
  assert.strictEqual(T.localOffsetMin('2026-07-07', '18:00'), 120);
  assert.strictEqual(T.localOffsetMin('2026-12-22', '16:00'), 60);
  process.env.TZ = 'UTC';
  assert.strictEqual(T.localOffsetMin('2026-07-07', '18:00'), 0);
});

test('twins: the same station, band and minute, two hours apart', () => {
  const list = [mk('a', 'R6DDJ', '2026-09-03', '18:17', '40m'), mk('b', 'R6DDJ', '2026-09-03', '20:17', '40m'), mk('c', 'RA3XYZ', '2026-09-03', '18:17', '40m')];
  const pairs = T.findTwins(list);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].early.id, 'a');
  assert.strictEqual(pairs[0].late.id, 'b');
  assert.strictEqual(pairs[0].offsetMin, 120);
});

test('twins across midnight', () => {
  const pairs = T.findTwins([mk('a', 'DL1ABC', '2026-10-02', '23:30', '20m'), mk('b', 'DL1ABC', '2026-10-03', '01:30', '20m')]);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].early.id, 'a');
});

test('not twins: another band, another kind of emission, an odd minute, a few minutes apart', () => {
  const base = mk('a', 'K1TEST', '2026-10-03', '10:00', '20m');
  assert.strictEqual(T.findTwins([base, mk('b', 'K1TEST', '2026-10-03', '12:00', '40m')]).length, 0);
  assert.strictEqual(T.findTwins([base, mk('b', 'K1TEST', '2026-10-03', '12:00', '20m', { mode: 'CW' })]).length, 0);
  assert.strictEqual(T.findTwins([base, mk('b', 'K1TEST', '2026-10-03', '12:05', '20m')]).length, 0);
  assert.strictEqual(T.findTwins([base, mk('b', 'K1TEST', '2026-10-03', '10:02', '20m')]).length, 0);
  assert.strictEqual(T.findTwins([base, mk('b', 'K1TEST', '2026-10-04', '10:00', '20m')]).length, 0);   // a day apart: a second contact
});

test('USB and SSB are one kind of emission', () => {
  assert.strictEqual(T.findTwins([mk('a', 'K1TEST', '2026-10-03', '10:00', '20m', { mode: 'USB' }), mk('b', 'K1TEST', '2026-10-03', '12:00', '20m', { mode: 'SSB' })]).length, 1);
});

test('each contact is in one pair at most; the nearest pair is made first', () => {
  const list = [mk('a', 'K1TEST', '2026-10-03', '10:00', '20m'), mk('b', 'K1TEST', '2026-10-03', '12:00', '20m'), mk('c', 'K1TEST', '2026-10-03', '14:00', '20m')];
  const pairs = T.findTwins(list);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].offsetMin, 120);
});

test('offsets are counted, the commonest first', () => {
  const list = [];
  for (let i = 0; i < 5; i++) list.push(mk('a' + i, 'C' + i, '2026-10-03', '10:00', '20m'), mk('b' + i, 'C' + i, '2026-10-03', '12:00', '20m'));
  list.push(mk('x', 'Z1', '2026-10-03', '10:00', '20m'), mk('y', 'Z1', '2026-10-03', '13:00', '20m'));
  assert.deepStrictEqual(T.offsetCounts(T.findTwins(list)), [[120, 5], [180, 1]]);
});

test('merging twins keeps every mark and fills blanks, and changes neither original', () => {
  const keep = mk('a', 'R6DDJ', '2026-09-03', '18:17', '40m', { lotwSent: 'Y', lotwSentDate: '2026-09-04', createdAt: '2026-09-03T18:18:00Z', name: '' });
  const drop = mk('b', 'R6DDJ', '2026-09-03', '20:17', '40m', { hamlogRcvd: 'Y', hamlogSent: 'Y', hamlogSentDate: '2026-09-05', name: 'Dmitry', qth: 'Rostov', createdAt: '2026-09-01T00:00:00Z' });
  const before = JSON.stringify([keep, drop]);
  const out = T.mergeTwin(keep, drop);
  assert.strictEqual(out.id, 'a');
  assert.strictEqual(out.time, '18:17');
  assert.strictEqual(out.lotwSent, 'Y');
  assert.strictEqual(out.hamlogRcvd, 'Y');
  assert.strictEqual(out.hamlogSentDate, '2026-09-05');
  assert.strictEqual(out.name, 'Dmitry');
  assert.strictEqual(out.qth, 'Rostov');
  assert.strictEqual(out.createdAt, '2026-09-01T00:00:00Z');
  assert.strictEqual(JSON.stringify([keep, drop]), before);
});

test('the very same minute is a twin of kind "same", not of the others', () => {
  const list = [mk('a', 'K1TEST', '2026-10-03', '10:00', '20m', { createdAt: '2026-10-03T10:01:00Z' }), mk('b', 'K1TEST', '2026-10-03', '10:00', '20m', { createdAt: '2026-10-03T09:00:00Z' })];
  assert.strictEqual(T.findTwins(list, 'same').length, 1);
  assert.strictEqual(T.findTwins(list, 'same')[0].early.id, 'b');       // made earlier
  assert.strictEqual(T.findTwins(list, 'zone').length, 0);
  assert.strictEqual(T.findTwins(list, 'near').length, 0);
});

test('a few minutes apart is "near"; ten is the edge; eleven is two contacts', () => {
  const a = mk('a', 'GW0KBO', '2026-08-23', '18:36', '20m');
  assert.strictEqual(T.findTwins([a, mk('b', 'GW0KBO', '2026-08-23', '18:38', '20m')], 'near').length, 1);
  assert.strictEqual(T.findTwins([a, mk('b', 'GW0KBO', '2026-08-23', '18:46', '20m')], 'near').length, 1);
  assert.strictEqual(T.findTwins([a, mk('b', 'GW0KBO', '2026-08-23', '18:47', '20m')], 'near').length, 0);
  assert.strictEqual(T.findTwins([a, mk('b', 'GW0KBO', '2026-08-23', '18:38', '20m')], 'zone').length, 0);
});

test('unknown kind falls back to the time-zone kind', () => {
  assert.strictEqual(T.findTwins([mk('a', 'K1TEST', '2026-10-03', '10:00', '20m'), mk('b', 'K1TEST', '2026-10-03', '12:00', '20m')], 'nonsense').length, 1);
});

// ---- The owner's real log: the backup written right after the HAMLOG import on 03.10.2026 ----
const REAL = path.join(process.env.HOME, 'Library/Application Support/R2FEL-LOG/data/backups/log-2026-10-03-2205.adi');
if (fs.existsSync(REAL)) {
  test('the real log: 391 contacts, 102 twin pairs two hours apart', () => {
    const raw = fs.readFileSync(REAL, 'utf8');
    const body = raw.split(/<EOH>/i)[1] || raw;
    const list = [];
    body.split(/<EOR>/i).forEach((chunk, i) => {
      const f = {};
      const re = /<([A-Za-z0-9_]+):(\d+)(?::[A-Za-z])?>/g;
      let m;
      while ((m = re.exec(chunk))) f[m[1].toLowerCase()] = chunk.slice(re.lastIndex, re.lastIndex + Number(m[2]));
      if (!f.call) return;
      const d = f.qso_date;
      list.push({
        id: 'r' + i, callsign: f.call.toUpperCase(), date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        time: `${f.time_on.slice(0, 2)}:${f.time_on.slice(2, 4)}`, band: (f.band || '').toLowerCase(), mode: f.mode || '',
        hamlogSent: f.app_log_hamlog_sent === 'Y' ? 'Y' : '', lotwRcvd: f.lotw_qsl_rcvd === 'Y' ? 'Y' : ''
      });
    });
    assert.strictEqual(list.length, 391);
    const pairs = T.findTwins(list);
    assert.deepStrictEqual(T.offsetCounts(pairs), [[120, 102]]);
    // the other kinds of twin: no exact repeats; one pair two minutes apart (GW0KBO)
    assert.strictEqual(T.findTwins(list, 'same').length, 0);
    const near = T.findTwins(list, 'near');
    assert.strictEqual(near.length, 1);
    assert.strictEqual(near[0].early.callsign, 'GW0KBO');
    // in every pair the later record is the one that carries the HAMLOG mark
    assert.strictEqual(pairs.filter(p => p.late.hamlogSent === 'Y').length, 102);
    // after merging, nothing is left that could pair again
    const left = list.filter(e => !pairs.some(p => p.late.id === e.id));
    assert.strictEqual(left.length, 289);
    assert.strictEqual(T.findTwins(left).length, 0);
    console.log(`     (по настоящему журналу: ${pairs.length} пар, останется ${left.length} связей из ${list.length})`);
  });
} else {
  console.log('skip the real-log check: no backup file on this machine');
}

console.log(`\n${passed} tests passed`);
