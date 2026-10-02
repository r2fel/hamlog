/* The same service on a laptop, so all of it can be built and checked
 * before any account is created anywhere:
 *
 *   node stats-server/local.mjs
 *   open http://127.0.0.1:4195/s/test
 *
 * Settings come from the environment, the same names as in the cloud.
 * The country can be faked with ?cc=IT, which is how the page gets tried
 * out with more than one flag on it.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './app.mjs';
import { fileStore } from './store-file.mjs';
import { digestText } from './digest.mjs';

const PORT = Number(process.env.PORT || 4195);
// fileURLToPath, not url.pathname: the project lives in a folder with spaces
// in its name, and a URL's pathname keeps them as %20 — which makes a real
// folder called "Mobile%20Documents" somewhere nobody will ever look.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const store = fileStore(process.env.STATS_FILE || path.join(HERE, '.data', 'stats.json'));

const config = {
  githubRepo: process.env.GITHUB_REPO || '',
  latestVersion: process.env.LATEST_VERSION || '',
  downloadUrl: process.env.DOWNLOAD_URL || '',
  statsSecret: process.env.STATS_SECRET || 'test',
  statsUrl: `http://127.0.0.1:${PORT}/s/${process.env.STATS_SECRET || 'test'}`,
  brevoKey: '',            // никаких настоящих писем с ноутбука
  mailTo: process.env.MAIL_TO || ''
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const query = Object.fromEntries(url.searchParams);
  const ctx = { store, country: query.cc || 'RU', now: Date.now(), config };

  // Handy while testing: /digest prints the Monday letter instead of sending it.
  if (url.pathname === '/digest') {
    const text = digestText(await store.summary(new Date().toISOString().slice(0, 10)), config.statsUrl);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
    return;
  }

  const out = await handle({ method: req.method, path: url.pathname, query }, ctx);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`stats service on http://127.0.0.1:${PORT}`);
  console.log(`summary:  http://127.0.0.1:${PORT}/s/${config.statsSecret}`);
});
