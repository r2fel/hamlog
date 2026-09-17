/* The same store on Cloudflare's own database (D1, which is SQLite).
 * Tables are in schema.sql.
 *
 * The summary is worked out in JavaScript from all the rows rather than in
 * SQL: at this size (a row per install) it costs nothing, and it keeps the
 * cloud's numbers and the laptop's numbers literally the same code.
 */

import { computeSummary } from './summary.mjs';

export function d1Store(db) {
  return {
    async touch(row) {
      const was = await db.prepare('SELECT first_seen, last_seen FROM installs WHERE id = ?')
        .bind(row.id).first();

      await db.prepare(`
        INSERT INTO installs (id, first_seen, last_seen, version, os, os_name, lang, country)
        VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
          last_seen = ?2, version = ?3, os = ?4, os_name = ?5, lang = ?6, country = ?7
      `).bind(row.id, row.day, row.version, row.os, row.osName, row.lang, row.country).run();

      const added = was ? 0 : 1;
      const seen = (!was || was.last_seen !== row.day) ? 1 : 0;
      if (added || seen) {
        await db.prepare(`
          INSERT INTO days (day, added, seen) VALUES (?1, ?2, ?3)
          ON CONFLICT(day) DO UPDATE SET added = added + ?2, seen = seen + ?3
        `).bind(row.day, added, seen).run();
      }
      return { isNew: !was };
    },

    async summary(today) {
      const installs = await db.prepare(
        'SELECT id, first_seen, last_seen, version, os, os_name, lang, country FROM installs').all();
      const days = await db.prepare('SELECT day, added, seen FROM days').all();
      return computeSummary(installs.results || [], days.results || [], today);
    },

    async getCache(key) {
      const row = await db.prepare('SELECT value, ts FROM cache WHERE key = ?').bind(key).first();
      if (!row) return null;
      try { return { value: JSON.parse(row.value), ts: row.ts }; } catch (e) { return null; }
    },

    async setCache(key, value, ts) {
      await db.prepare(`
        INSERT INTO cache (key, value, ts) VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET value = ?2, ts = ?3
      `).bind(key, JSON.stringify(value), ts).run();
    }
  };
}
