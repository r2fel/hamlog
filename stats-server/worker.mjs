/* The Cloudflare side: the same handler as on a laptop, wired to their
 * database and their clock.
 *
 * Settings come from the worker's own environment (wrangler.toml for the
 * plain ones, `wrangler secret` for the mail key and the secret address of
 * the summary page) — nothing sensitive is ever written in this file.
 */

import { handle, today } from './app.mjs';
import { d1Store } from './store-d1.mjs';
import { sendDigest } from './digest.mjs';

function config(env) {
  return {
    githubRepo: env.GITHUB_REPO || '',        // "r2fel/hamlog" — where releases are published
    latestVersion: env.LATEST_VERSION || '',  // used until there are releases
    downloadUrl: env.DOWNLOAD_URL || '',
    statsSecret: env.STATS_SECRET || '',      // the address of the summary page is its password
    statsUrl: env.STATS_URL || '',
    brevoKey: env.BREVO_KEY || '',
    resendKey: env.RESEND_KEY || '',
    telegramToken: env.TELEGRAM_TOKEN || '',
    telegramChat: env.TELEGRAM_CHAT || '',
    mailTo: env.MAIL_TO || '',
    mailFrom: env.MAIL_FROM || ''
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ctx = {
      store: d1Store(env.DB),
      country: (request.cf && request.cf.country) || '',   // the network knows; we never keep the address
      now: Date.now(),
      config: config(env)
    };

    const res = await handle({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams)
    }, ctx);

    return new Response(res.body, { status: res.status, headers: res.headers });
  },

  // Monday morning, by Cloudflare's clock — see [triggers] in wrangler.toml.
  async scheduled(event, env, ctx) {
    const store = d1Store(env.DB);
    const summary = await store.summary(today(Date.now()));
    ctx.waitUntil(sendDigest(summary, config(env)));
  }
};
