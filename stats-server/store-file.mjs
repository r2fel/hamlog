/* The store used when the service runs on a laptop: one JSON file. Good
 * enough to build and check everything before any of it goes online —
 * the cloud version (store-d1.mjs) answers exactly the same questions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { computeSummary } from './summary.mjs';

export function fileStore(file) {
  const load = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
  };
  const save = (data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
  };

  const read = () => {
    const data = load();
    data.installs = data.installs || {};
    data.days = data.days || {};
    data.cache = data.cache || {};
    return data;
  };

  return {
    async touch(row) {
      const data = read();
      const was = data.installs[row.id];
      const day = data.days[row.day] || { day: row.day, added: 0, seen: 0 };

      if (!was) day.added += 1;
      if (!was || was.last_seen !== row.day) day.seen += 1;

      data.installs[row.id] = {
        id: row.id,
        first_seen: was ? was.first_seen : row.day,
        last_seen: row.day,
        version: row.version,
        os: row.os,
        os_name: row.osName,
        lang: row.lang,
        country: row.country
      };
      data.days[row.day] = day;
      save(data);
      return { isNew: !was };
    },

    async summary(today) {
      const data = read();
      return computeSummary(Object.values(data.installs), Object.values(data.days), today);
    },

    async getCache(key) {
      return read().cache[key] || null;
    },

    async setCache(key, value, ts) {
      const data = read();
      data.cache[key] = { value, ts };
      save(data);
    }
  };
}
