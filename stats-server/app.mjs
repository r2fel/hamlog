/* The little server behind two questions: "is there a newer version?" and
 * "how many people are actually using this?".
 *
 * The program calls /ping once a day. It says who it is only by a random
 * number it made up for itself on first run, plus its version, its system
 * and its language. The country comes from the network, not from the
 * program, and the address it came from is never written down. No callsign,
 * no log, nothing about the contacts.
 *
 * Everything here is plain logic over a `store` — one implementation talks
 * to Cloudflare's database (store-d1.mjs), the other to a file on disk
 * (store-file.mjs), so the whole thing can be run and tested on a laptop
 * before it goes anywhere near the internet.
 */

import { statsPage } from './page.mjs';
import { digestText, sendDigest } from './digest.mjs';

const MAX = { id: 64, version: 16, os: 8, osName: 40, lang: 4 };

/** Anything that arrives from outside is cut to size and stripped of surprises. */
function clean(value, limit) {
  return String(value || '').replace(/[^\w.\- ]/g, '').slice(0, limit);
}

export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function json(body, status = 200) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(body)
  };
}

function html(body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body
  };
}

/**
 * Which version is the newest one. Asked of GitHub — publishing a release
 * there is all it takes for every copy of the program to hear about it —
 * and remembered for an hour so a thousand installs are one question, not a
 * thousand. With no repository set, a version written into the settings is
 * used instead, so this works before anything is published.
 */
export async function latestRelease(ctx) {
  const cached = await ctx.store.getCache('latest');
  if (cached && ctx.now - cached.ts < 60 * 60 * 1000) return cached.value;

  let value = { version: ctx.config.latestVersion || '', url: ctx.config.downloadUrl || '', notes: '' };
  if (ctx.config.githubRepo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${ctx.config.githubRepo}/releases/latest`, {
        headers: { 'user-agent': 'R2FEL-HamLog-updates', accept: 'application/vnd.github+json' }
      });
      if (res.ok) {
        const rel = await res.json();
        value = {
          version: String(rel.tag_name || '').replace(/^v/i, ''),
          url: rel.html_url || ctx.config.downloadUrl || '',
          notes: String(rel.body || '').split('\n').slice(0, 6).join('\n').slice(0, 500)
        };
      }
    } catch (e) { /* GitHub down: yesterday's answer will do */ }
  }
  await ctx.store.setCache('latest', value, ctx.now);
  return value;
}

/**
 * One call a day from one copy of the program. The row for that copy is
 * written afresh (first seen, last seen, version, system, country) and the
 * day's counters tick over. The answer is what the program came for: the
 * newest version and where to get it.
 */
async function ping(query, ctx) {
  const id = clean(query.id, MAX.id);
  if (id.length < 8) return json({ error: 'no id' }, 400);

  await ctx.store.touch({
    id,
    day: today(ctx.now),
    version: clean(query.v, MAX.version),
    os: clean(query.os, MAX.os),
    osName: clean(query.osv, MAX.osName),
    lang: clean(query.lang, MAX.lang),
    country: ctx.country || '??'
  });

  const latest = await latestRelease(ctx);
  return json({ latest: latest.version, url: latest.url, notes: latest.notes });
}

/** The same answer without being counted — for testing, and for anyone who turned the ping off. */
async function latest(ctx) {
  const rel = await latestRelease(ctx);
  return json({ latest: rel.version, url: rel.url, notes: rel.notes });
}

/**
 * The whole thing, routed. `secret` guards the summary: the address is the
 * password, so the numbers stay the owner's business.
 */
export async function handle(request, ctx) {
  const path = request.path.replace(/\/+$/, '') || '/';

  if (path === '/ping') return ping(request.query, ctx);
  if (path === '/latest') return latest(ctx);

  const secret = ctx.config.statsSecret;
  if (secret && path === `/s/${secret}`) {
    return html(statsPage(await ctx.store.summary(today(ctx.now)), ctx));
  }
  if (secret && path === `/s/${secret}/data.json`) {
    return json(await ctx.store.summary(today(ctx.now)));
  }
  // The Monday letter, to read now — and to send now, for checking that the
  // way out works without waiting until Monday.
  if (secret && path === `/s/${secret}/digest`) {
    const text = digestText(await ctx.store.summary(today(ctx.now)), ctx.config.statsUrl);
    return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: text };
  }
  if (secret && path === `/s/${secret}/digest/send`) {
    return json(await sendDigest(await ctx.store.summary(today(ctx.now)), ctx.config));
  }

  // Everything else, including a wrong secret, gets the same blank face.
  return html('<!doctype html><meta charset="utf-8"><title>R2FEL HamLog</title>' +
    '<body style="background:#1c1b19;color:#9c9587;font:15px system-ui;padding:40px">' +
    'R2FEL HamLog — updates service.</body>', 404);
}
