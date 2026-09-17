require('dotenv').config();
const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
// Requests are a few hundred bytes — except a batch of contacts going to
// LoTW, which carries the whole ADIF. That one route gets room for it; the
// general parser below then leaves its already-parsed body alone.
app.use('/api/lotw/upload', express.json({ limit: '8mb' }));
app.use('/api/eqsl/upload', express.json({ limit: '8mb' }));
// A QSL card picture going in, or a finished card going out by e-mail.
app.use('/api/card/image', express.json({ limit: '30mb' }));
app.use('/api/card/send', express.json({ limit: '30mb' }));
// The whole log in one request. A thousand contacts is about a megabyte of
// ADIF, and people have twenty thousand — the 16kb below turned every
// automatic copy of a real log into "request entity too large", silently.
app.use('/api/backup', express.json({ limit: '64mb' }));
app.use(express.json({ limit: '16kb' }));

const PORT = process.env.PORT || 4173;

// ---------------------------------------------------------------------------
// QRZ credentials
//
// These can come from .env (the original way — handy for a headless/hosted
// deployment) or be entered straight into the app on first run, which writes
// them to data/qrz-credentials.json. A stored credential wins over .env for
// that field, so entering one in the app always takes effect immediately.
// ---------------------------------------------------------------------------

// The installed Mac app runs this file from inside its read-only bundle, so
// it points QSO_DATA_DIR at the user's own Application Support folder (see
// electron-main.js). Run any other way, it's the project's data/ as before.
const DATA_DIR = process.env.QSO_DATA_DIR || path.join(__dirname, 'data');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'qrz-credentials.json');

let QRZRU_USERNAME = process.env.QRZRU_USERNAME || '';
let QRZRU_PASSWORD = process.env.QRZRU_PASSWORD || '';
let QRZCOM_USERNAME = process.env.QRZCOM_USERNAME || '';
let QRZCOM_PASSWORD = process.env.QRZCOM_PASSWORD || '';
let HAMQTH_USERNAME = process.env.HAMQTH_USERNAME || '';
let HAMQTH_PASSWORD = process.env.HAMQTH_PASSWORD || '';

function loadStoredCredentials() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const stored = JSON.parse(raw);
    if (stored.ruUsername !== undefined) QRZRU_USERNAME = stored.ruUsername;
    if (stored.ruPassword !== undefined) QRZRU_PASSWORD = stored.ruPassword;
    if (stored.comUsername !== undefined) QRZCOM_USERNAME = stored.comUsername;
    if (stored.comPassword !== undefined) QRZCOM_PASSWORD = stored.comPassword;
    if (stored.hamUsername !== undefined) HAMQTH_USERNAME = stored.hamUsername;
    if (stored.hamPassword !== undefined) HAMQTH_PASSWORD = stored.hamPassword;
  } catch (e) {
    // No stored file yet (or it's unreadable) — .env values stand as they are.
  }
}

function saveStoredCredentials() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({
    ruUsername: QRZRU_USERNAME,
    ruPassword: QRZRU_PASSWORD,
    comUsername: QRZCOM_USERNAME,
    comPassword: QRZCOM_PASSWORD,
    hamUsername: HAMQTH_USERNAME,
    hamPassword: HAMQTH_PASSWORD
  }, null, 2), { mode: 0o600 });
}

loadStoredCredentials();

// Set ACCESS_KEY once the app is reachable from the internet: without it,
// anyone who learns the URL can spend your QRZ lookup quota, and QRZ.RU blocks
// accounts whose API access is used by third parties. Leave blank for
// laptop-only use.
const ACCESS_KEY = process.env.ACCESS_KEY || '';

// Set DEBUG=1 to print raw XML responses. Credentials are never printed.
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

if (!QRZRU_USERNAME && !QRZCOM_USERNAME && !HAMQTH_USERNAME) {
  console.warn('\n[!] No lookup credentials set yet — fill them in from the app on first run (⚙ DATA), or set QRZRU_USERNAME/QRZRU_PASSWORD (and/or QRZCOM_*) in .env.\n');
}

// ---------------------------------------------------------------------------
// TLS note
//
// api.qrz.ru, xmldata.qrz.com and map.r1cf.ru all serve certificates chaining
// to Let's Encrypt's new "Root YR" (issuers YR1/YR2), which current Node
// builds don't yet carry in their bundled CA list — so verification fails even
// though the certificates are perfectly valid (browsers and openssl accept
// them). When that specific error occurs for these hosts, we retry over HTTPS
// with chain verification relaxed. The connection stays encrypted; only the
// chain check is skipped. Once Node ships the new root this path simply stops
// being taken.
// ---------------------------------------------------------------------------

const CHAIN_FALLBACK_HOSTS = new Set([
  'api.qrz.ru', 'xmldata.qrz.com', 'map.r1cf.ru', 'www.hamqth.com',
  'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'lotw.arrl.org', 'www.eqsl.cc'
]);

/**
 * A plain HTTPS GET answering the way fetch() does for what this server asks
 * of it — `status` and `text()` — following redirects. Used with the chain
 * check relaxed (see the TLS note), and in place of fetch() itself where
 * Node doesn't have one: the Windows 7/8 build runs on Electron 22, whose
 * Node 16 predates it. A failure carries the socket error as `cause`, as
 * fetch's does, so safeFetch reads both the same way.
 */
function httpsGet(url, { relaxed = false, redirects = 5, timeout = 15000, bundledCa = false, limit = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = err => {
      const wrapped = new Error('fetch failed');
      wrapped.cause = err;
      reject(wrapped);
    };
    // bundledCa: check the certificate against Node's own list of authorities
    // instead of the computer's. Some machines (this one, for a start) verify
    // against the system keychain by default and can't build a chain for
    // perfectly ordinary certificates — "unable to get local issuer".
    const options = { rejectUnauthorized: !relaxed };
    if (bundledCa) options.ca = require('tls').rootCertificates;
    const req = https.get(url, options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        httpsGet(next, { relaxed, redirects: redirects - 1, timeout, bundledCa, limit }).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        // A well-behaved answer is a few kilobytes. Anything that keeps
        // coming is either broken or hostile, and it isn't going to be
        // swallowed whole into memory.
        if (limit && body.length > limit) {
          req.destroy(new Error(`Answer longer than ${Math.round(limit / 1024)}kB`));
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, text: async () => body }));
    });
    req.on('error', fail);
    req.setTimeout(timeout, () => req.destroy(new Error(`Request timed out after ${Math.round(timeout / 1000)}s`)));
  });
}

function httpsGetRelaxed(url) {
  return httpsGet(url, { relaxed: true });
}

const fetchGet = typeof fetch === 'function' ? fetch : url => httpsGet(url);

function maskUrl(url) {
  return String(url).replace(/([?&](p|password)=)[^&;]*/gi, '$1***');
}

async function safeFetch(url, options) {
  try {
    return await fetchGet(url, options);
  } catch (err) {
    const cause = err && err.cause ? err.cause : null;
    const code = cause && cause.code ? cause.code : '';

    const isChainError =
      code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN';

    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* malformed URL */ }

    if (isChainError && CHAIN_FALLBACK_HOSTS.has(host)) {
      try {
        return await httpsGetRelaxed(url);
      } catch (retryErr) {
        const c = retryErr && retryErr.cause ? retryErr.cause : null;
        const detail = c ? `${c.code || ''} ${c.message || c}`.trim() : retryErr.message;
        console.error(`[fetch error] retry failed for ${host} -> ${detail}`);
        throw new Error(`Network request failed (${detail || 'unknown reason'})`);
      }
    }

    const detail = cause ? `${code} ${cause.message || cause}`.trim() : err.message;
    console.error(`[fetch error] ${maskUrl(url)} -> ${detail}`);
    throw new Error(`Network request failed (${detail || 'unknown reason'})`);
  }
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// ---------------------------------------------------------------------------
// QRZ.RU
//
// Session lasts ~1 hour. QRZ.RU also allows only one connection and one request
// per 3 seconds per IP, so every call goes through a single throttled queue.
// ---------------------------------------------------------------------------

const qrzru = { sessionId: null, expires: 0, chain: Promise.resolve(), lastAt: 0 };

function ruThrottled(fn) {
  qrzru.chain = qrzru.chain.then(async () => {
    const wait = qrzru.lastAt + 3000 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    qrzru.lastAt = Date.now();
    return fn();
  });
  return qrzru.chain;
}

async function ruLogin() {
  const url = `https://api.qrz.ru/login?u=${encodeURIComponent(QRZRU_USERNAME)}&p=${encodeURIComponent(QRZRU_PASSWORD)}&agent=qso-log`;
  const res = await safeFetch(url);
  const xml = await res.text();
  const id = extractTag(xml, 'session_id');

  if (!id) {
    // What QRZ.RU actually said, rather than a guess. A stated <error> is
    // quoted as-is ("Wrong user name or password"); anything else — an HTML
    // page, a rate-limit notice, an empty body — is reported with its status
    // and first line, because "check your password" would be a wrong answer
    // to a problem that has nothing to do with the password. The request
    // carries the credentials, the response does not, so this is safe to log.
    const stated = extractTag(xml, 'error');
    if (stated) throw new Error(stated);

    const body = String(xml || '').replace(/\s+/g, ' ').trim();
    const status = res.status ? `HTTP ${res.status}` : 'no status';
    const snippet = body ? body.slice(0, 160) : 'empty response';
    console.error(`[qrz.ru login] no session in the answer — ${status}: ${snippet}`);
    throw new Error(`QRZ.RU gave no session (${status}: ${snippet})`);
  }
  qrzru.sessionId = id;
  qrzru.expires = Date.now() + 55 * 60 * 1000;
  return id;
}

/**
 * Maidenhead locator from coordinates. QRZ.RU has no locator field of its own,
 * but when it supplies latitude/longitude the grid square follows exactly.
 */
function gridFromCoords(latRaw, lonRaw) {
  const lat = Number(String(latRaw).replace(',', '.'));
  const lon = Number(String(lonRaw).replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return '';
  if (lat === 0 && lon === 0) return '';

  const adjLon = lon + 180;
  const adjLat = lat + 90;

  const A = 'ABCDEFGHIJKLMNOPQR';
  const field = A[Math.floor(adjLon / 20)] + A[Math.floor(adjLat / 10)];
  const square = Math.floor((adjLon % 20) / 2) + '' + Math.floor(adjLat % 10);

  const sub = 'abcdefghijklmnopqrstuvwx';
  const subLon = sub[Math.floor(((adjLon % 2) / 2) * 24)];
  const subLat = sub[Math.floor((adjLat % 1) * 24)];

  return (field + square + subLon + subLat).toUpperCase();
}

/**
 * A locator only counts as one if it has the right shape — four, six or the
 * extended eight characters. The eight-character form is trimmed to the six
 * the app works in, rather than being thrown out as malformed: a record that
 * states one still knows where the station is.
 */
function normalizeLocator(raw) {
  const text = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/.test(text)) return '';
  return text.slice(0, 6);
}

/** Centre of a locator square, for comparing it against coordinates. */
function locatorCentre(locator) {
  const g = normalizeLocator(locator);
  if (!g) return null;

  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);

  if (g.length >= 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + (1 / 24);
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + (1 / 48);
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

// A four-character square is ~70 km across, so its centre can sit a good
// 60 km from the real position quite legitimately. Past this, the locator and
// the coordinates are describing different places, not the same one roughly.
const LOCATOR_MISMATCH_KM = 200;

/**
 * Decides which locator to believe for a record that may carry both a stated
 * one and coordinates.
 *
 * Records do turn up whose locator field contradicts their own address — a
 * stale entry from a previous QTH, or simply a wrong one. Left alone, such a
 * value produces a confidently wrong distance (a station in Severodonetsk
 * shown 4,700 km away in Siberia). The coordinates are what the source itself
 * places the station by, so where the two disagree by more than a couple of
 * hundred kilometres, the coordinates win and the result is marked as
 * derived rather than stated.
 */
function chooseLocator({ stated, lat, lon, callsign, source }) {
  const locator = normalizeLocator(stated);
  const fromCoords = gridFromCoords(lat, lon);

  if (!locator) return { grid: fromCoords, gridApprox: Boolean(fromCoords) };
  if (!fromCoords) return { grid: locator, gridApprox: false };

  const centre = locatorCentre(locator);
  const point = locatorCentre(fromCoords);
  const apart = centre && point ? haversineKm(centre, point) : null;

  if (apart !== null && apart > LOCATOR_MISMATCH_KM) {
    console.warn(`[lookup] ${callsign || '?'} (${source}): locator ${locator} is ` +
      `${apart} km from the record's own coordinates ${lat},${lon} — using ${fromCoords} instead`);
    return { grid: fromCoords, gridApprox: true };
  }

  return { grid: locator, gridApprox: false };
}

function ruParse(xml) {
  const error = extractTag(xml, 'error');
  if (error) return { error, errorCode: extractTag(xml, 'errorcode'), source: 'qrz.ru' };

  const call = extractTag(xml, 'call');
  if (!call) return { error: 'Callsign not found', errorCode: '404', source: 'qrz.ru' };

  const latin = [extractTag(xml, 'ename'), extractTag(xml, 'esurname')].filter(Boolean).join(' ');
  const cyrillic = [extractTag(xml, 'name'), extractTag(xml, 'surname')].filter(Boolean).join(' ');

  // The field name isn't documented, so try the plausible spellings before
  // falling back to coordinates.
  const gridTag = ['locator', 'loc', 'grid', 'gridsquare', 'qthloc', 'qth_loc']
    .map(tag => extractTag(xml, tag))
    .find(Boolean) || '';

  const lat = extractTag(xml, 'lat') || extractTag(xml, 'latitude');
  const lon = extractTag(xml, 'lng') || extractTag(xml, 'lon') || extractTag(xml, 'longitude');

  // A locator supplied by the source is exact — as long as it agrees with the
  // record's own coordinates. One derived from coordinates is only as precise
  // as those coordinates — QRZ.RU gives the town, which leaves the last two
  // letters a subsquare or so off the operator's real QTH. Either way it's
  // marked, so a better one can replace it.
  const located = chooseLocator({ stated: gridTag, lat, lon, callsign: call, source: 'qrz.ru' });

  // Both spellings travel: QRZ.RU holds the operator's name in Russian and in
  // Latin, and which one the app should show depends on a setting it owns, not
  // on this parser. `name` stays the Latin one so nothing that reads this
  // record changes; `nameLocal` is the Russian original alongside it.
  return {
    source: 'qrz.ru',
    callsign: call,
    name: latin || cyrillic,
    nameLocal: cyrillic || '',
    country: extractTag(xml, 'country'),
    city: extractTag(xml, 'city'),
    grid: located.grid,
    gridApprox: located.gridApprox,
    cq: extractTag(xml, 'cq_zone'),
    itu: extractTag(xml, 'itu_zone')
  };
}

async function ruLookupOnce(callsign) {
  if (!qrzru.sessionId || Date.now() > qrzru.expires) await ruLogin();

  let url = `https://api.qrz.ru/callsign?id=${qrzru.sessionId}&callsign=${encodeURIComponent(callsign)}`;
  let xml = await (await safeFetch(url)).text();
  if (DEBUG) console.log(`\n[qrz.ru raw response for ${callsign}]\n${xml}\n`);

  if (extractTag(xml, 'error') && extractTag(xml, 'errorcode') === '403') {
    qrzru.sessionId = null;
    await ruLogin();
    url = `https://api.qrz.ru/callsign?id=${qrzru.sessionId}&callsign=${encodeURIComponent(callsign)}`;
    xml = await (await safeFetch(url)).text();
    if (DEBUG) console.log(`\n[qrz.ru retry for ${callsign}]\n${xml}\n`);
  }

  return ruParse(xml);
}

function ruLookup(callsign) {
  return ruThrottled(() => ruLookupOnce(callsign));
}

// ---------------------------------------------------------------------------
// QRZ.com — fallback. Session lasts ~24 hours. A paid XML subscription unlocks
// more fields, but a plain account still returns name/city/country.
// ---------------------------------------------------------------------------

const qrzcom = { key: null, expires: 0 };

async function comLogin() {
  const url = `https://xmldata.qrz.com/xml/current/?username=${encodeURIComponent(QRZCOM_USERNAME)};password=${encodeURIComponent(QRZCOM_PASSWORD)}`;
  const xml = await (await safeFetch(url)).text();
  const key = extractTag(xml, 'Key');
  if (!key) {
    throw new Error(extractTag(xml, 'Error') || 'QRZ.com login failed — check QRZCOM_USERNAME / QRZCOM_PASSWORD');
  }
  qrzcom.key = key;
  qrzcom.expires = Date.now() + 23 * 60 * 60 * 1000;
  return key;
}

async function comLookup(callsign, allowRetry = true) {
  if (!qrzcom.key || Date.now() > qrzcom.expires) await comLogin();

  const url = `https://xmldata.qrz.com/xml/current/?s=${qrzcom.key};callsign=${encodeURIComponent(callsign)}`;
  const xml = await (await safeFetch(url)).text();
  if (DEBUG) console.log(`\n[qrz.com raw response for ${callsign}]\n${xml}\n`);

  const error = extractTag(xml, 'Error');
  if (error) {
    if (allowRetry && /session/i.test(error)) {
      qrzcom.key = null;
      return comLookup(callsign, false);
    }
    return { error, source: 'qrz.com' };
  }

  // Plenty of qrz.com records carry coordinates but leave <grid> empty — the
  // locator follows from those exactly, and without it there is no distance
  // and no weather for the correspondent. And where a record has both but
  // they disagree, the coordinates are the ones to believe (see
  // chooseLocator).
  const call = extractTag(xml, 'call') || callsign.toUpperCase();
  const gridTag = extractTag(xml, 'grid');
  const lat = extractTag(xml, 'lat') || extractTag(xml, 'latitude');
  const lon = extractTag(xml, 'lon') || extractTag(xml, 'lng') || extractTag(xml, 'longitude');
  const located = chooseLocator({ stated: gridTag, lat, lon, callsign: call, source: 'qrz.com' });

  return {
    source: 'qrz.com',
    callsign: call,
    name: [extractTag(xml, 'fname'), extractTag(xml, 'name')].filter(Boolean).join(' '),
    country: extractTag(xml, 'country'),
    city: extractTag(xml, 'addr2'),
    grid: located.grid,
    gridApprox: located.gridApprox
  };
}

// ---------------------------------------------------------------------------
// HamQTH — a free callbook (a free account is all it takes), asked alongside
// QRZ.RU. It has what QRZ.com without a subscription doesn't: locators,
// coordinates, full names abroad — and the e-mail address, where the station
// gave one, for sending QSL cards. Session lasts an hour.
// ---------------------------------------------------------------------------

const hamqth = { id: null, expires: 0 };
// Only tests point this elsewhere (a stand-in server on this computer).
const HAMQTH_BASE = process.env.HAMQTH_BASE || 'https://www.hamqth.com';

async function hamLogin() {
  const url = `${HAMQTH_BASE}/xml.php?u=${encodeURIComponent(HAMQTH_USERNAME)}&p=${encodeURIComponent(HAMQTH_PASSWORD)}`;
  const xml = await (await safeFetch(url)).text();
  const id = extractTag(xml, 'session_id');
  if (!id) throw new Error(extractTag(xml, 'error') || 'HamQTH login failed — check the HamQTH login');
  hamqth.id = id;
  hamqth.expires = Date.now() + 55 * 60 * 1000;
  return id;
}

async function hamLookup(callsign, allowRetry = true) {
  if (!hamqth.id || Date.now() > hamqth.expires) await hamLogin();

  const url = `${HAMQTH_BASE}/xml.php?id=${encodeURIComponent(hamqth.id)}&callsign=${encodeURIComponent(callsign)}&prg=R2FEL-LOG`;
  const xml = await (await safeFetch(url)).text();
  if (DEBUG) console.log(`\n[hamqth raw response for ${callsign}]\n${xml}\n`);

  const error = extractTag(xml, 'error');
  if (error) {
    if (allowRetry && /session/i.test(error)) {
      hamqth.id = null;
      return hamLookup(callsign, false);
    }
    return { error, errorCode: /not found/i.test(error) ? '404' : '', source: 'hamqth' };
  }

  const call = extractTag(xml, 'callsign') || callsign.toUpperCase();
  const lat = extractTag(xml, 'latitude');
  const lon = extractTag(xml, 'longitude');
  const located = chooseLocator({ stated: extractTag(xml, 'grid'), lat, lon, callsign: call, source: 'hamqth' });
  return {
    source: 'hamqth',
    callsign: call.toUpperCase(),
    name: extractTag(xml, 'adr_name') || extractTag(xml, 'nick'),
    country: extractTag(xml, 'country'),
    city: extractTag(xml, 'qth') || extractTag(xml, 'adr_city'),
    grid: located.grid,
    gridApprox: located.gridApprox,
    email: extractTag(xml, 'email'),
    cq: extractTag(xml, 'cq'),
    itu: extractTag(xml, 'itu')
  };
}

// ---------------------------------------------------------------------------
// Placing a station that has no locator
//
// Plenty of records carry neither a locator nor coordinates — club stations
// especially — but almost all of them say what town the station is in. A town
// is easily precise enough for a distance and a temperature (a locator square
// is ~70 km across anyway), so rather than showing nothing, the town is looked
// up on Open-Meteo's geocoder (free, no key, same service as the weather) and
// the locator worked out from that. The result is marked as derived, so the
// app can show it as approximate and a real locator always wins.
// ---------------------------------------------------------------------------

const GEOCODE_TTL = 7 * 24 * 60 * 60 * 1000;   // towns don't move
const geocodeCache = new Map();

// Two spellings of the same country have to compare equal: the primary source
// answers in Russian, the fallback in English, and the geocoder in whichever
// language it's asked for. Only the countries an operator actually works often
// are listed; anything else falls back to comparing the names themselves.
const COUNTRY_CODES = {
  россия: 'RU', российскаяфедерация: 'RU', russia: 'RU', russianfederation: 'RU',
  // QRZ.com answers with DXCC entities, which are not countries: Kaliningrad,
  // European and Asiatic Russia are all Russia to a geocoder, and a record
  // saying "Kaliningrad" used to lose its distance for that reason alone.
  kaliningrad: 'RU', калининград: 'RU',
  europeanrussia: 'RU', asiaticrussia: 'RU', europeanrussia1: 'RU',
  fedrepofgermany: 'DE', federalrepublicofgermany: 'DE',
  republicofbelarus: 'BY', belarussia: 'BY',
  republicofkazakhstan: 'KZ',
  украина: 'UA', ukraine: 'UA',
  беларусь: 'BY', белоруссия: 'BY', belarus: 'BY',
  казахстан: 'KZ', kazakhstan: 'KZ',
  германия: 'DE', germany: 'DE', deutschland: 'DE',
  польша: 'PL', poland: 'PL',
  италия: 'IT', italy: 'IT',
  франция: 'FR', france: 'FR',
  испания: 'ES', spain: 'ES',
  великобритания: 'GB', england: 'GB', unitedkingdom: 'GB', scotland: 'GB',
  сша: 'US', unitedstates: 'US', unitedstatesofamerica: 'US',
  нидерланды: 'NL', netherlands: 'NL',
  бельгия: 'BE', belgium: 'BE',
  швеция: 'SE', sweden: 'SE',
  финляндия: 'FI', finland: 'FI',
  норвегия: 'NO', norway: 'NO',
  чехия: 'CZ', czechia: 'CZ', czechrepublic: 'CZ',
  австрия: 'AT', austria: 'AT',
  швейцария: 'CH', switzerland: 'CH',
  литва: 'LT', lithuania: 'LT',
  латвия: 'LV', latvia: 'LV',
  эстония: 'EE', estonia: 'EE',
  молдова: 'MD', moldova: 'MD',
  болгария: 'BG', bulgaria: 'BG',
  румыния: 'RO', romania: 'RO',
  сербия: 'RS', serbia: 'RS',
  венгрия: 'HU', hungary: 'HU',
  греция: 'GR', greece: 'GR',
  турция: 'TR', turkey: 'TR', türkiye: 'TR',
  япония: 'JP', japan: 'JP',
  китай: 'CN', china: 'CN',
  канада: 'CA', canada: 'CA',
  бразилия: 'BR', brazil: 'BR',
  австралия: 'AU', australia: 'AU',
  армения: 'AM', armenia: 'AM',
  азербайджан: 'AZ', azerbaijan: 'AZ',
  грузия: 'GE', georgia: 'GE',
  узбекистан: 'UZ', uzbekistan: 'UZ'
};

function foldName(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-zа-яё]/gi, '');
}

/**
 * The country a callsign's prefix belongs to, for the handful of prefixes
 * that are unambiguous. Used only when the record's country field can't be
 * recognised — a wrong guess here would throw away a good match, so this
 * list stays short and certain rather than trying to be a DXCC table.
 */
const CALLSIGN_COUNTRIES = [
  [/^(R|U[A-I])/, 'RU'],       // Russia, Kaliningrad included
  [/^E[UVW]/, 'BY'],
  [/^U[N-Q]/, 'KZ'],
  [/^(U[R-Z]|E[MNO])/, 'UA']
];

function countryFromCallsign(callsign) {
  const call = String(callsign || '').trim().toUpperCase();
  if (!call) return '';
  const hit = CALLSIGN_COUNTRIES.find(([pattern]) => pattern.test(call));
  return hit ? hit[1] : '';
}

function countryKey(raw) {
  const folded = foldName(raw);
  if (!folded) return '';
  return COUNTRY_CODES[folded] || folded;
}

/**
 * The town out of an address field. These arrive in every shape going —
 * "D-23858 Reinfeld", "г. Грозный", "Ростов-на-Дону, Ростовская обл." — so the
 * postal code, the settlement abbreviation and any trailing region are taken
 * off, leaving something a geocoder can actually match.
 */
function townFromAddress(raw, countryRaw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  // Region, oblast and similar trailing parts: the first part is the town in
  // practically every format these fields come in. Abroad the separator is as
  // often a semicolon or a slash as a comma ("COONGULLA; VIC 3860").
  text = text.split(/[,;/]/)[0];

  text = text
    .replace(/\b[A-Z]{1,3}\s?-\s?\d{4,6}\b/gi, ' ')   // D-23858, UA-01001
    .replace(/\b\d{4,6}\b/g, ' ')                     // bare postal codes
    .replace(/(^|\s)(г|гор|пос|пгт|п|с|ст|ст-ца|д|х|аул|мкр|обл|р-н)\.\s*/gi, ' ')
    .replace(/[«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // The country written out at the end of the address ("Mohka Japan"): the
  // geocoder is told the country separately and only stumbles over it here.
  // Matched through countryKey, because the record's own country field is
  // often in the other language ("Япония" beside "Japan").
  const wanted = countryKey(countryRaw);
  if (wanted) {
    const words = text.split(' ');
    if (words.length > 1 && countryKey(words[words.length - 1]) === wanted) {
      text = words.slice(0, -1).join(' ').trim();
    }
  }

  // A province or state code stuck on the end — "Caltanissetta CL",
  // "COONGULLA VIC", "Rio de Janeiro RJ". Only dropped when a name of its own
  // is left standing in front of it.
  const parts = text.split(' ');
  if (parts.length > 1 && /^[A-Z]{2,3}$/.test(parts[parts.length - 1])) {
    const without = parts.slice(0, -1).join(' ');
    if (/[A-Za-zА-Яа-яЁё]{3}/.test(without)) text = without;
  }

  // A town name is letters, spaces and hyphens; anything left that is mostly
  // digits or punctuation isn't one.
  if (!/[A-Za-zА-Яа-яЁё]{3}/.test(text)) return '';
  return text;
}

/**
 * Coordinates for a town, preferring a result in the country the record names.
 * Where the country can't be matched (an unlisted name, or the geocoder
 * answering in a third language) the most populous match wins, which is nearly
 * always the town meant.
 */
async function geocodeTown(cityRaw, countryRaw, callsign) {
  const town = townFromAddress(cityRaw, countryRaw);
  if (!town) return null;

  // What country to expect: the record's own field when it names a country we
  // recognise, otherwise what the callsign's prefix says. When neither is
  // certain the match is taken on the town alone — an unrecognisable country
  // field is no reason to leave the operator with no distance at all.
  const stated = countryKey(countryRaw);
  const known = Object.values(COUNTRY_CODES).includes(stated);
  const wanted = known ? stated : (countryFromCallsign(callsign) || stated);
  const certain = known || Boolean(countryFromCallsign(callsign));

  const key = `${town.toLowerCase()}|${wanted}|${certain ? 'c' : 'u'}`;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.at < GEOCODE_TTL) return cached.place;

  const url = 'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(town)}&count=10&language=ru&format=json`;

  const res = await safeFetch(url);
  if (res.status !== 200) throw new Error(`Geocoder returned HTTP ${res.status}`);

  const data = JSON.parse(await res.text());
  const results = Array.isArray(data && data.results) ? data.results : [];

  let best = null;
  let bestScore = -Infinity;

  for (const r of results) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const here = countryKey(r.country) || String(r.country_code || '').toUpperCase();
    const sameCountry = Boolean(wanted) && Boolean(here) &&
      (here === wanted || here.includes(wanted) || wanted.includes(here));

    const population = Number(r.population);
    const score = (sameCountry ? 1000 : 0) +
      (Number.isFinite(population) ? Math.log10(population + 10) : 0);

    if (score > bestScore) {
      bestScore = score;
      best = { lat, lon, label: `${r.name}${r.country ? ', ' + r.country : ''}`, sameCountry };
    }
  }

  // A match in the wrong country is worse than no match: it would show a
  // confident distance to somewhere the station has never been. But that only
  // holds when the country is actually known — vetoing on an unrecognised
  // field ("Kaliningrad") threw away perfectly good matches.
  if (best && certain && wanted && !best.sameCountry) {
    console.warn(`[geocode] "${town}" found only outside ${countryRaw} (${best.label}) — ignoring`);
    best = null;
  } else if (best && !certain && !best.sameCountry) {
    console.log(`[geocode] "${town}": country "${countryRaw}" not recognised — ` +
      `taking the best match on the town alone (${best.label})`);
  }

  geocodeCache.set(key, { place: best, at: Date.now() });
  if (geocodeCache.size > 500) {
    for (const [k, entry] of geocodeCache) {
      if (Date.now() - entry.at > GEOCODE_TTL) geocodeCache.delete(k);
    }
  }
  return best;
}

/** Last resort for a record with no locator and no coordinates: its town. */
async function fillGridFromTown(result) {
  if (!result || result.error || result.grid) return result;

  try {
    const place = await geocodeTown(result.city, result.country, result.callsign);
    if (!place) return result;

    const grid = gridFromCoords(place.lat, place.lon);
    if (!grid) return result;

    console.log(`[geocode] ${result.callsign}: record has no locator — ` +
      `${place.label} → ${grid}`);

    return { ...result, grid, gridApprox: true, gridFrom: 'town' };
  } catch (e) {
    console.warn(`[geocode] ${result.callsign}: ${e.message}`);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Lookup: QRZ.RU and HamQTH together, QRZ.com for whatever they both lack.
// ---------------------------------------------------------------------------

/**
 * QRZ.RU is the primary source, but its records are often partial: no locator
 * field at all (a grid derived from its town coordinates is only accurate to
 * the square), and frequently no city or country either. Another source's
 * answer for the same callsign fills the gaps — the primary always wins where
 * it has a value. `label` names the other source in the merged `source`.
 */
/**
 * The name to keep of two: the first one's, unless the second is the same
 * name written out in full — "Club" and "ARRL HQ Operators Club", "Ivan" and
 * "Ivan Petrov" (HamQTH often has only a first name as the "nick").
 */
function fullerName(first, second) {
  const a = String(first || '').trim();
  const b = String(second || '').trim();
  if (!a) return b;
  if (!b || b.length <= a.length) return a;
  const words = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const inB = new Set(words(b));
  return words(a).every(w => inB.has(w)) ? b : a;
}

function mergeFrom(result, extra, label) {
  if (!extra || extra.error) return result;
  const needsGrid = !result.grid || result.gridApprox;

  const merged = {
    ...result,
    name: fullerName(result.name, extra.name),
    // Neither QRZ.com nor HamQTH has a Russian spelling to offer, so a
    // missing one stays missing rather than being filled with the Latin one.
    nameLocal: result.nameLocal || '',
    country: result.country || extra.country || '',
    city: result.city || extra.city || '',
    email: result.email || extra.email || '',
    cq: result.cq || extra.cq || '',
    itu: result.itu || extra.itu || ''
  };

  // An exact locator beats one worked out from coordinates.
  if (needsGrid && extra.grid) {
    merged.grid = extra.grid;
    merged.gridApprox = extra.gridApprox || false;
  }

  // Second line of defence for a locator the primary source states but has
  // no coordinates to check it against: if the other source worked its own
  // locator out from real coordinates and the two land hundreds of
  // kilometres apart, the coordinates are the better bet. Two *stated*
  // locators disagreeing is left alone — there's nothing to decide it with —
  // but it's worth saying so out loud.
  if (!needsGrid && result.grid && extra.grid && extra.grid !== result.grid) {
    const a = locatorCentre(result.grid);
    const b = locatorCentre(extra.grid);
    const apart = a && b ? haversineKm(a, b) : null;

    if (apart !== null && apart > LOCATOR_MISMATCH_KM) {
      if (extra.gridApprox) {
        console.warn(`[lookup] ${result.callsign}: ${result.source} locator ${result.grid} is ` +
          `${apart} km from ${label}'s coordinates (${extra.grid}) — using the coordinates`);
        merged.grid = extra.grid;
        merged.gridApprox = true;
      } else {
        console.warn(`[lookup] ${result.callsign}: ${result.source} says ${result.grid}, ` +
          `${label} says ${extra.grid} — ${apart} km apart; keeping ${result.grid}`);
      }
    }
  }

  const usedExtra = ['name', 'country', 'city', 'grid', 'email']
    .some(field => merged[field] && merged[field] !== result[field]);

  if (usedExtra) merged.source = `${result.source} + ${label}`;
  return merged;
}

/** QRZ.com, last in line — asked only when something is still missing. */
async function fillGapsFromQrzCom(result, haveCom) {
  if (!haveCom) return result;
  const incomplete = !result.grid || result.gridApprox || !result.name || !result.country || !result.city;
  if (!incomplete) return result;
  try {
    return mergeFrom(result, await comLookup(result.callsign), 'qrz.com');
  } catch (e) {
    // QRZ.com unavailable — keep whatever we have.
    return result;
  }
}

/**
 * Why the primary source didn't answer, in a form the app can put in front of
 * the operator. A silent fall back to QRZ.com looks like everything working
 * until you notice Russian callsigns have stopped resolving (QRZ.com simply
 * doesn't carry most of them) — so whenever QRZ.RU fails, the answer says so
 * alongside whatever the fallback managed to find.
 */
function primaryErrorNote(message) {
  const text = String(message || '').trim();
  if (!text) return 'QRZ.RU unavailable';

  if (/user name|username|password|login failed/i.test(text)) {
    return `QRZ.RU rejected the login (${text}) — check it in ⚙ DATA → EDIT QRZ LOGIN`;
  }
  return `QRZ.RU unavailable: ${text}`;
}

/**
 * Every source that's set up gets its chance, in order of trust: QRZ.RU, then
 * HamQTH, then QRZ.com. QRZ.RU and HamQTH are asked at the same time (so the
 * second costs no waiting) and HamQTH fills what QRZ.RU lacks; whatever is
 * still missing after the two — a name, a town, a country, an exact locator —
 * is asked of QRZ.com. Where neither of the first two knows the callsign at
 * all, QRZ.com's answer is the whole answer.
 */
async function lookupCallsign(callsign) {
  const haveRu = Boolean(QRZRU_USERNAME && QRZRU_PASSWORD);
  const haveHam = Boolean(HAMQTH_USERNAME && HAMQTH_PASSWORD);
  const haveCom = Boolean(QRZCOM_USERNAME && QRZCOM_PASSWORD);

  if (!haveRu && !haveHam && !haveCom) {
    return { error: 'No QRZ.RU, HamQTH or QRZ.com login configured' };
  }

  const settle = promise => promise.then(value => ({ value }), error => ({ error }));
  const [ru, ham] = await Promise.all([
    haveRu ? settle(ruLookup(callsign)) : null,
    haveHam ? settle(hamLookup(callsign)) : null
  ]);

  let primaryError = '';
  if (ru && ru.error) {
    primaryError = primaryErrorNote(ru.error.message);
    console.error(`[lookup] ${callsign}: ${primaryError}`);
  }
  if (ham && ham.error) console.error(`[lookup] ${callsign}: HamQTH unavailable: ${ham.error.message}`);

  const ruFound = ru && ru.value && !ru.value.error ? ru.value : null;
  const hamFound = ham && ham.value && !ham.value.error ? ham.value : null;
  const ruStated = ru && ru.value && ru.value.error &&
    !(ru.value.errorCode === '404' || /not found/i.test(ru.value.error)) ? ru.value : null;
  if (ruStated) {
    // An error QRZ.RU stated itself (not a failure to reach it) is worth
    // repeating verbatim — it's usually about the account.
    console.error(`[lookup] ${callsign}: qrz.ru says "${ruStated.error}"`);
    primaryError = primaryError || primaryErrorNote(ruStated.error);
  }

  let result = null;
  if (ruFound || hamFound) {
    result = ruFound && hamFound ? mergeFrom(ruFound, hamFound, 'hamqth') : (ruFound || hamFound);
    // Still a gap after those two? QRZ.com may have it.
    result = await fillGapsFromQrzCom(result, haveCom);
  } else if (ruStated && !haveCom) {
    return ruStated;
  } else if (haveCom) {
    try {
      result = await comLookup(callsign);
    } catch (e) {
      return { error: `Not found on QRZ.RU or HamQTH; QRZ.com lookup failed (${e.message})`, primaryError: primaryError || undefined };
    }
  } else {
    const where = [haveRu && 'QRZ.RU', haveHam && 'HamQTH'].filter(Boolean).join(' or ');
    return { error: `Not found on ${where}`, source: haveRu ? 'qrz.ru' : 'hamqth', primaryError: primaryError || undefined };
  }

  result = await fillGridFromTown(result);
  return primaryError && result && !result.error ? { ...result, primaryError } : result;
}

// ---------------------------------------------------------------------------
// RDA (Russian District Award) by coordinates
//
// r1cf.ru/rdaloc — the map most operators already use to read off their RDA
// code by hand — gets that answer from a public GeoServer WFS layer, not
// from anything proprietary. Querying it here (server-side, so the browser
// never has to deal with its CORS policy) means MY RDA can be filled in
// automatically alongside MY GRID, instead of only opening the map for the
// operator to read the code off themselves.
//
// The dataset is re-versioned on that server from time to time (rdaloc.js
// calls its own copy of this `rda_version`), so rather than pinning one name
// we try the known ones in order and remember whichever answered. If a future
// version appears under a name not listed here, check rdaloc.js for the
// current value and add it at the front.
// ---------------------------------------------------------------------------

const RDA_WFS_TYPENAMES = ['RDA_2025X', 'RDA_2026X', 'RDA_2024X'];
let rdaTypeNameInUse = '';

function rdaWfsUrl(typeName, lat, lon) {
  // Encoded exactly the way the map itself does it — spaces as %20 rather
  // than '+', parentheses and commas percent-encoded.
  const cql = encodeURIComponent(`INTERSECTS(geom,POINT(${lat} ${lon}))`);
  return 'https://map.r1cf.ru/geoserver/cite/wfs' +
    '?SERVICE=WFS&REQUEST=GetFeature&VERSION=1.1.0' +
    `&TypeName=${encodeURIComponent(typeName)}` +
    '&outputFormat=application/json&PROPERTYNAME=rda,name' +
    `&CQL_FILTER=${cql}`;
}

async function rdaQuery(typeName, lat, lon) {
  const res = await safeFetch(rdaWfsUrl(typeName, lat, lon));
  if (res.status !== 200) throw new Error(`RDA service returned HTTP ${res.status}`);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // A WFS error comes back as an XML report, not JSON — usually an unknown
    // TypeName, which is the caller's cue to try the next one.
    throw new Error(`RDA service did not return JSON for ${typeName}`);
  }

  const feature = data && Array.isArray(data.features) ? data.features[0] : null;
  if (!feature || !feature.properties) return null;

  return {
    rda: String(feature.properties.rda || ''),
    name: String(feature.properties.name || '')
  };
}

/**
 * Resolves a point to its RDA district. Returns { rda, name }, or null when
 * the point simply isn't in any district (outside Russia, mostly). Throws
 * only when the service itself couldn't be reached or understood.
 */
async function lookupRda(lat, lon) {
  const order = rdaTypeNameInUse
    ? [rdaTypeNameInUse, ...RDA_WFS_TYPENAMES.filter(n => n !== rdaTypeNameInUse)]
    : RDA_WFS_TYPENAMES;

  let lastError = null;

  for (const typeName of order) {
    try {
      const result = await rdaQuery(typeName, lat, lon);
      rdaTypeNameInUse = typeName;      // this dataset name works — prefer it next time
      return result;
    } catch (err) {
      lastError = err;
      console.error(`[rda] ${typeName} failed: ${err.message}`);
    }
  }

  throw lastError || new Error('RDA service unavailable');
}

// ---------------------------------------------------------------------------
// Weather
//
// Just the temperature where the other station is, and where you are — read
// off Open-Meteo, which is free and needs no key. Proxied here for the same
// reasons as the RDA lookup, and answers are cached for ten minutes per
// locator-sized patch of the map: the temperature doesn't change faster than
// that, and neither service nor operator gains anything from asking again on
// every keystroke.
// ---------------------------------------------------------------------------

const WEATHER_TTL = 10 * 60 * 1000;
const weatherCache = new Map();

function pruneWeatherCache() {
  if (weatherCache.size <= 400) return;
  const now = Date.now();
  for (const [key, entry] of weatherCache) {
    if (now - entry.at > WEATHER_TTL) weatherCache.delete(key);
  }
}

/**
 * Temperature plus what the sky is doing: the WMO weather code, the wind in
 * m/s (the unit the number is quoted in on air) and whether it's daylight
 * there — enough for the app to put the right icon beside the figure.
 */
async function lookupWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.at < WEATHER_TTL) return cached.wx;

  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&current=temperature_2m,weather_code,wind_speed_10m,is_day' +
    '&wind_speed_unit=ms&timezone=auto';

  const res = await safeFetch(url);
  if (res.status !== 200) throw new Error(`Weather service returned HTTP ${res.status}`);

  const data = JSON.parse(await res.text());
  const current = data && data.current ? data.current : null;
  const tempC = current ? Number(current.temperature_2m) : NaN;
  if (!Number.isFinite(tempC)) throw new Error('Weather service gave no temperature');

  const code = Number(current.weather_code);
  const wind = Number(current.wind_speed_10m);
  const utcOffsetSeconds = Number(data.utc_offset_seconds);

  const wx = {
    tempC,
    code: Number.isFinite(code) ? code : null,
    wind: Number.isFinite(wind) ? wind : null,
    isDay: current.is_day === undefined ? null : Number(current.is_day) !== 0,
    utcOffsetSeconds: Number.isFinite(utcOffsetSeconds) ? utcOffsetSeconds : null
  };

  weatherCache.set(key, { wx, at: Date.now() });
  pruneWeatherCache();
  return wx;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// The page and the service worker must never come from the browser's cache:
// while the app is actively being changed, seeing the previous build is far
// more costly than re-fetching a few kilobytes. Icons and fonts still cache
// normally.
app.use((req, res, next) => {
  if (/\.(html|js|css)$/.test(req.path) || req.path === '/' || req.path === '/sw.js') {
    res.set('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});

const APP_VERSION = require('./package.json').version;

// The offline cache is named after the build, so a new version never serves
// yesterday's files. sw.js carries a placeholder and this fills it in —
// otherwise the name is a number someone has to remember to raise by hand
// before every release, and one forgotten release is a stale app.
app.get('/sw.js', (req, res) => {
  try {
    const text = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8')
      .replace(/__APP_VERSION__/g, APP_VERSION);
    res.type('application/javascript').send(text);
  } catch (e) {
    res.status(404).end();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// The log's own safety net
//
// The logbook lives in one place — IndexedDB inside this app on this
// computer — and the only thing standing between a reinstall and losing it
// was a note asking for an export. So the app quietly writes a full ADIF of
// itself here once a day, keeping the last few. Nobody has to remember
// anything, and if the log ever goes, the newest file is imported back.
//
// The page builds the ADIF (it is the one with the contacts); this only
// writes it down and sweeps up the old ones.
// ---------------------------------------------------------------------------

const BACKUP_DIR = () => path.join(DATA_DIR, 'backups');
const BACKUPS_KEPT = 5;

/** Newest first — by when it was written, not by its name: a second copy on
 *  the same day is log-2026-09-16-2.adi, which sorts *before* the plain one
 *  even though it is newer, and sweeping by name threw away the wrong file. */
function backupFiles() {
  const dir = BACKUP_DIR();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^log-\d{4}-\d{2}-\d{2}-\d{4}\.adi$/.test(f))
    .map(f => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map(x => x.f);
}

app.get('/api/backup', localOnly, (req, res) => {
  const files = backupFiles();
  res.json({ dir: BACKUP_DIR(), files, last: files[0] || '' });
});

app.post('/api/backup', localOnly, (req, res) => {
  const adif = String((req.body || {}).adif || '');
  const count = Number((req.body || {}).count) || 0;
  if (!adif || !count) return res.status(400).json({ error: 'Nothing to write down' });

  try {
    const dir = BACKUP_DIR();
    fs.mkdirSync(dir, { recursive: true });
    // The time is in the name so the folder reads in order at a glance —
    // and so a name freed by the sweep is never handed to a newer file.
    const now = new Date().toISOString();
    const name = `log-${now.slice(0, 10)}-${now.slice(11, 13)}${now.slice(14, 16)}.adi`;
    fs.writeFileSync(path.join(dir, name), adif);

    // Only the last few are kept — this is a safety net, not an archive.
    const stale = backupFiles().slice(BACKUPS_KEPT);
    stale.forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });

    console.log(`[backup] ${name}: ${count} contact(s)` + (stale.length ? `, ${stale.length} older one(s) swept up` : ''));
    res.json({ file: name, dir, count, removed: stale.length });
  } catch (e) {
    console.error(`[backup] could not write: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Lets the page know whether it should ask for an access code at all, and
// which version it is (shown at the foot of settings).
app.get('/api/config', (req, res) => {
  res.json({ accessKeyRequired: Boolean(ACCESS_KEY), version: APP_VERSION });
});

/* ---------------------------------------------------------------------
 * Is there a newer version?
 *
 * Once a day the page asks this, and this asks a small service of the
 * author's, which answers with the newest version there is and where to get
 * it. The same call is the head count: it carries a random number this copy
 * of the program made up for itself on first run, its version, its system
 * and its language — and nothing else. No callsign, no log, not one contact.
 * The country is worked out from the network by the service and kept as two
 * letters; the address it came from is never written down.
 *
 * The page only calls this while the switch in settings is on, and if the
 * service can't be reached the whole thing is dropped in silence — nothing
 * in the program waits for it.
 * --------------------------------------------------------------------- */

const UPDATE_BASE = process.env.UPDATE_BASE || 'https://r2fel-hamlog-updates.r2fel.workers.dev';
const INSTALL_ID_PATH = path.join(DATA_DIR, 'install-id.json');

/** The number this copy calls itself. Made once, kept in the profile, never shown to anyone else. */
function installId() {
  try {
    const saved = JSON.parse(fs.readFileSync(INSTALL_ID_PATH, 'utf8'));
    if (saved && typeof saved.id === 'string' && saved.id.length >= 8) return saved.id;
  } catch (e) { /* first time, or the file was lost — a new number then */ }

  const nodeCrypto = require('crypto');
  const id = nodeCrypto.randomUUID ? nodeCrypto.randomUUID()
    : nodeCrypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INSTALL_ID_PATH, JSON.stringify({ id, made: new Date().toISOString() }, null, 2));
  } catch (e) { /* read-only place: then it is a new number every time, no harm done */ }
  return id;
}

app.get('/api/update', localOnly, async (req, res) => {
  const lang = String(req.query.lang || '').slice(0, 2).toLowerCase() === 'ru' ? 'ru' : 'en';
  const os = require('os');
  // The development copy asks the same question but isn't counted: the
  // author's own testing shouldn't show up as another user out there.
  // (electron-main.js sets QSO_DEV for the copy run from the project.)
  const url = process.env.QSO_DEV === '1'
    ? `${UPDATE_BASE}/latest`
    : `${UPDATE_BASE}/ping?id=${encodeURIComponent(installId())}` +
      `&v=${encodeURIComponent(APP_VERSION)}` +
      `&os=${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'web'}` +
      `&osv=${encodeURIComponent(os.release())}&lang=${lang}`;

  try {
    // Deliberately https.get and not fetch: this way the certificate is
    // checked against Node's own list of authorities, the same on every
    // machine, and the old Node inside the Windows 7/8 build takes the same
    // road as the new one. (http is only ever the test service on this computer.)
    const answer = url.startsWith('https:')
      ? await httpsGet(url, { timeout: 8000, bundledCa: true, limit: 64 * 1024 })
      : await fetchGet(url);
    const data = JSON.parse(await answer.text());   // both kinds of answer have text()

    // The page opens this address in a browser when the line is clicked, so
    // only an ordinary web address is passed on — whatever the answer says.
    const link = String(data.url || '');
    const safeLink = /^https?:\/\//i.test(link) ? link.slice(0, 300) : '';

    console.log(`[update] ${APP_VERSION} → latest ${data.latest || '?'}`);
    res.json({
      ok: true,
      latest: String(data.latest || '').slice(0, 16),
      url: safeLink,
      notes: String(data.notes || '').slice(0, 500)
    });
  } catch (e) {
    // No internet, service asleep, anything at all: say so quietly and move on.
    console.log(`[update] could not ask: ${e.message}`);
    res.json({ ok: false });
  }
});

// Checks an access code without performing a lookup.
app.post('/api/verify-key', (req, res) => {
  if (!ACCESS_KEY) return res.json({ ok: true });
  const key = (req.body && req.body.accessKey) || '';
  if (key !== ACCESS_KEY) return res.status(401).json({ ok: false, error: 'Wrong access code' });
  res.json({ ok: true });
});

// Whether QRZ lookup is already configured, and with which usernames — so the
// app can decide whether to show the first-run setup card, and can prefill it
// when the person reopens it to make a change. Passwords are never sent back.
app.get('/api/qrz-status', (req, res) => {
  res.json({
    ruConfigured: Boolean(QRZRU_USERNAME && QRZRU_PASSWORD),
    comConfigured: Boolean(QRZCOM_USERNAME && QRZCOM_PASSWORD),
    hamConfigured: Boolean(HAMQTH_USERNAME && HAMQTH_PASSWORD),
    ruUsername: QRZRU_USERNAME,
    comUsername: QRZCOM_USERNAME,
    hamUsername: HAMQTH_USERNAME
  });
});

// Saves the QRZ.RU / HamQTH / QRZ.com logins entered in the app itself, so
// nobody has to edit .env by hand. Any of them may be left blank — a blank
// username clears that source.
app.post('/api/qrz-credentials', (req, res) => {
  const body = req.body || {};

  if (ACCESS_KEY && body.accessKey !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Access code required', needsAuth: true });
  }

  // A blank username clears that source. A blank password with the same
  // username keeps the saved one — the card opens with the password fields
  // empty (they're never sent back), and saving it to add one login mustn't
  // wipe the others'.
  const pair = (user, pass, oldUser, oldPass) => {
    const u = String(user || '').trim();
    const p = String(pass || '').trim();
    if (!u) return ['', ''];
    return [u, p || (u === oldUser ? oldPass : '')];
  };
  [QRZRU_USERNAME, QRZRU_PASSWORD] = pair(body.ruUsername, body.ruPassword, QRZRU_USERNAME, QRZRU_PASSWORD);
  [QRZCOM_USERNAME, QRZCOM_PASSWORD] = pair(body.comUsername, body.comPassword, QRZCOM_USERNAME, QRZCOM_PASSWORD);
  // HamQTH arrived later: a page from before it doesn't send its fields, and
  // that mustn't wipe a HamQTH login saved since.
  if (body.hamUsername !== undefined) {
    [HAMQTH_USERNAME, HAMQTH_PASSWORD] = pair(body.hamUsername, body.hamPassword, HAMQTH_USERNAME, HAMQTH_PASSWORD);
  }

  // Credentials changed — any cached session belongs to the old ones.
  qrzru.sessionId = null;
  qrzru.expires = 0;
  qrzcom.key = null;
  qrzcom.expires = 0;
  hamqth.id = null;
  hamqth.expires = 0;

  try {
    saveStoredCredentials();
  } catch (err) {
    return res.status(500).json({ error: `Could not save credentials: ${err.message}` });
  }

  res.json({
    ok: true,
    ruConfigured: Boolean(QRZRU_USERNAME && QRZRU_PASSWORD),
    comConfigured: Boolean(QRZCOM_USERNAME && QRZCOM_PASSWORD),
    hamConfigured: Boolean(HAMQTH_USERNAME && HAMQTH_PASSWORD),
    ruUsername: QRZRU_USERNAME,
    comUsername: QRZCOM_USERNAME,
    hamUsername: HAMQTH_USERNAME
  });
});

// An answer already had is not asked for again for a while. QRZ.RU allows one
// request every three seconds, and the same callsign comes up again and again
// — a station calling twice in a pileup, a dupe being checked, the sending
// window asking for the name a card is going to. Half a day is short enough
// that an operator who corrects their own QRZ record sees it the same
// evening, and long enough to save every one of those waits. Kept in memory
// only: a restart starts afresh rather than carrying yesterday's callbook
// around. Failures are not kept at all, so a lookup that failed because the
// line was down is retried at once.
const lookupCache = new Map();
const LOOKUP_TTL = 12 * 60 * 60 * 1000;
const LOOKUP_CACHE_MAX = 1000;

function cachedLookup(callsign) {
  const key = callsign.toUpperCase();
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LOOKUP_TTL) { lookupCache.delete(key); return null; }
  return hit.data;
}

function keepLookup(callsign, data) {
  if (!data || data.error) return;            // only answers worth repeating
  const key = callsign.toUpperCase();
  lookupCache.set(key, { at: Date.now(), data });
  // Oldest out first — Map keeps insertion order, and a re-cached callsign is
  // deleted and re-added, so the front of the map really is the stalest.
  while (lookupCache.size > LOOKUP_CACHE_MAX) lookupCache.delete(lookupCache.keys().next().value);
}

app.post('/api/lookup', async (req, res) => {
  const body = req.body || {};

  if (ACCESS_KEY && body.accessKey !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Access code required', needsAuth: true });
  }

  const callsign = (body.callsign || '').trim();
  if (!callsign) return res.status(400).json({ error: 'Missing callsign' });

  const known = cachedLookup(callsign);
  if (known) {
    console.info(`[lookup] ${callsign.toUpperCase()}: from memory [${known.source || 'qrz'}]`);
    return res.json(known);
  }

  try {
    const data = await lookupCallsign(callsign);
    keepLookup(callsign, data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Used by the MY GRID auto-detect button to also fill in MY RDA.
app.post('/api/rda-lookup', async (req, res) => {
  const body = req.body || {};

  if (ACCESS_KEY && body.accessKey !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Access code required', needsAuth: true });
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Missing or invalid coordinates' });
  }

  try {
    const result = await lookupRda(lat, lon);
    if (!result) return res.json({ found: false });
    res.json({ found: true, rda: result.rda, name: result.name });
  } catch (err) {
    console.error(`[rda] lookup failed for ${lat},${lon}: ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// Current temperature at a point — for the station bar and, through the
// correspondent's locator, for whoever is on the other end.
app.post('/api/weather', async (req, res) => {
  const body = req.body || {};

  if (ACCESS_KEY && body.accessKey !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Access code required', needsAuth: true });
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Missing or invalid coordinates' });
  }

  try {
    res.json(await lookupWeather(lat, lon));
  } catch (err) {
    console.error(`[weather] lookup failed for ${lat},${lon}: ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// LoTW (ARRL Logbook of The World)
//
// Sending: LoTW only takes contacts signed with the operator's own callsign
// certificate, and signing is the job of ARRL's free TQSL program. So the
// page hands over an ADIF of the contacts not sent yet, and TQSL — found
// where it's installed — signs and uploads them from the command line under
// the Station Location chosen in settings; its exit status says how it went.
// TQSL itself skips contacts it has sent before ("-a compliant").
//
// Confirmations: LoTW's report query, with the login of the LoTW website
// (not the certificate), kept like the QRZ login in data/, never sent back
// to the page.
//
// All of it answers only requests from this computer: on a Mac the app is
// also reachable from a phone on the same Wi-Fi, and nobody there should be
// able to sign with this operator's certificate or use his LoTW login.
// ---------------------------------------------------------------------------

const QSL_CREDENTIALS_PATH = path.join(DATA_DIR, 'qsl-credentials.json');
let qslCredentials = {};

function loadQslCredentials() {
  try {
    const stored = JSON.parse(fs.readFileSync(QSL_CREDENTIALS_PATH, 'utf8'));
    qslCredentials = stored && typeof stored === 'object' ? stored : {};
  } catch (e) {
    qslCredentials = {};
  }
}

function saveQslCredentials() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QSL_CREDENTIALS_PATH, JSON.stringify(qslCredentials, null, 2), { mode: 0o600 });
}

loadQslCredentials();

function isLocalRequest(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function localOnly(req, res, next) {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Only from the computer the app runs on', remote: true });
  }
  next();
}

/** Where TQSL puts itself on each system; TQSL_PATH first, for unusual installs. */
function tqslCandidates() {
  const home = require('os').homedir();
  const list = [];
  if (process.env.TQSL_PATH) list.push(process.env.TQSL_PATH);
  if (process.platform === 'darwin') {
    list.push('/Applications/TrustedQSL/tqsl.app/Contents/MacOS/tqsl',
      '/Applications/tqsl.app/Contents/MacOS/tqsl',
      path.join(home, 'Applications', 'TrustedQSL', 'tqsl.app', 'Contents', 'MacOS', 'tqsl'));
  } else if (process.platform === 'win32') {
    [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.ProgramW6432,
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean)
      .forEach(dir => list.push(path.join(dir, 'TrustedQSL', 'tqsl.exe')));
  } else {
    list.push('/usr/bin/tqsl', '/usr/local/bin/tqsl');
  }
  return list;
}

function findTqsl() {
  return tqslCandidates().find(file => {
    try { return fs.statSync(file).isFile(); } catch (e) { return false; }
  }) || null;
}

/** The version, where the system says it without running TQSL (the Mac app's Info.plist). */
function tqslVersion(exe) {
  try {
    const plist = fs.readFileSync(path.join(path.dirname(exe), '..', 'Info.plist'), 'utf8');
    const m = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : '';
  } catch (e) {
    return '';
  }
}

function tqslDataDir() {
  if (process.env.TQSLDIR) return process.env.TQSLDIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'TrustedQSL');
  return path.join(require('os').homedir(), '.tqsl');
}

const xmlText = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The Station Locations set up in TQSL: name, callsign and locator of each. */
function tqslLocations() {
  let xml = '';
  try {
    xml = fs.readFileSync(path.join(tqslDataDir(), 'station_data'), 'utf8');
  } catch (e) {
    return [];
  }
  const tag = (body, name) => {
    const m = body.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
    return m ? xmlText(m[1]).trim() : '';
  };
  const out = [];
  const re = /<StationData\s+name="([^"]*)"\s*>([\s\S]*?)<\/StationData>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push({ name: xmlText(m[1]), call: tag(m[2], 'CALL').toUpperCase(), grid: tag(m[2], 'GRIDSQUARE').toUpperCase() });
  }
  return out;
}

/**
 * The operator's callsign certificates in TQSL — the public part only
 * (certs/user) — and the span of contact dates each may sign: LoTW takes a
 * contact only within it. ARRL keeps those in its own fields of the
 * certificate (OIDs 1.3.6.1.4.1.12348.1.1 callsign, .1.2 first and .1.3 last
 * contact date); each is found by its OID's bytes and read as the text
 * that follows.
 */
function tqslCertificates() {
  let pem = '';
  try {
    pem = fs.readFileSync(path.join(tqslDataDir(), 'certs', 'user'), 'utf8');
  } catch (e) {
    return [];
  }
  const oid = last => Buffer.from([0x06, 0x09, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xe0, 0x3c, 0x01, last]);
  // The value after the OID: a text string, possibly behind an extension's
  // "critical" flag and inside its OCTET STRING wrapper. Short lengths only
  // (one byte) — these are dates and callsigns.
  const textAfter = (der, marker) => {
    let pos = der.indexOf(marker);
    if (pos < 0) return '';
    pos += marker.length;
    for (let step = 0; step < 4 && pos + 2 <= der.length; step++) {
      const tag = der[pos];
      const len = der[pos + 1];
      if (len > 127) return '';
      if (tag === 0x01) { pos += 2 + len; continue; }       // BOOLEAN: critical
      if (tag === 0x04) {                                   // OCTET STRING: a string inside, or the text itself
        const inner = der[pos + 2];
        if ([0x0c, 0x13, 0x14, 0x16].includes(inner) && der[pos + 3] === len - 2) { pos += 2; continue; }
        return der.slice(pos + 2, pos + 2 + len).toString('latin1').trim();
      }
      if ([0x0c, 0x13, 0x14, 0x16].includes(tag)) return der.slice(pos + 2, pos + 2 + len).toString('latin1').trim();
      return '';
    }
    return '';
  };
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(block => {
    const der = Buffer.from(block.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');
    const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
    return {
      call: textAfter(der, oid(0x01)).toUpperCase(),
      from: date(textAfter(der, oid(0x02))),
      to: date(textAfter(der, oid(0x03)))
    };
  }).filter(c => c.call);
}

app.get('/api/lotw/status', localOnly, (req, res) => {
  const exe = findTqsl();
  const login = qslCredentials.lotw || {};
  res.json({
    tqsl: exe ? { version: tqslVersion(exe) } : null,
    locations: tqslLocations(),
    certificates: tqslCertificates(),
    login: { username: login.username || '', hasPassword: Boolean(login.password) }
  });
});

// The LoTW website login. Both blank clears it.
app.post('/api/lotw/login', localOnly, (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  // Empty with the same login: the saved password stays (the page shows it
  // only as dots, never has it).
  const old = qslCredentials.lotw || {};
  const password = String(body.password || '') || (username && username === old.username ? old.password || '' : '');
  if (username && password) {
    qslCredentials.lotw = { username, password };
  } else if (!username && !password) {
    delete qslCredentials.lotw;
  } else {
    return res.status(400).json({ error: 'Both the login and the password are needed' });
  }
  try {
    saveQslCredentials();
  } catch (err) {
    return res.status(500).json({ error: `Could not save the login: ${err.message}` });
  }
  console.info(`[lotw] website login ${username ? `set for ${username}` : 'cleared'}`);
  res.json({ ok: true, username });
});

// Signs and uploads one batch through TQSL. Answers with TQSL's exit status:
// 0 sent; 8 nothing new (all sent before, or outside the certificate's
// dates); 9 some sent, some skipped; anything else went wrong.
app.post('/api/lotw/upload', localOnly, (req, res) => {
  const body = req.body || {};
  const adif = String(body.adif || '');
  const location = String(body.location || '');

  const exe = findTqsl();
  if (!exe) return res.status(400).json({ error: 'TQSL is not installed on this computer' });
  if (!tqslLocations().some(loc => loc.name === location)) {
    return res.status(400).json({ error: 'No such Station Location in TQSL' });
  }
  if (!/<eor>/i.test(adif)) return res.status(400).json({ error: 'No contacts to send' });

  const file = path.join(require('os').tmpdir(), `r2fel-lotw-${Date.now()}.adi`);
  try {
    fs.writeFileSync(file, adif);
  } catch (err) {
    return res.status(500).json({ error: `Could not write the file for TQSL: ${err.message}` });
  }

  const count = (adif.match(/<eor>/gi) || []).length;
  console.info(`[lotw] TQSL: signing and uploading ${count} QSO under "${location}"`);
  const args = ['-x', '-d', '-u', '-a', 'compliant', '-l', location, file];
  require('child_process').execFile(exe, args, { timeout: 5 * 60 * 1000, windowsHide: true }, (err, stdout, stderr) => {
    fs.unlink(file, () => {});
    const code = !err ? 0 : (typeof err.code === 'number' ? err.code : -1);
    const lines = `${stderr || ''}\n${stdout || ''}`.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const message = lines.slice(-3).join(' · ');
    console.info(`[lotw] TQSL finished with status ${code}${message ? ` — ${message}` : ''}${err && err.killed ? ' (stopped: took too long)' : ''}`);
    res.json({ code, message });
  });
});

// LoTW's own report of this operator's contacts, as ADIF: kind "rx" —
// contacts uploaded since a moment (so the log knows what's in LoTW, however
// it got there); kind "qsl" — confirmations since a moment.
app.post('/api/lotw/report', localOnly, async (req, res) => {
  const body = req.body || {};
  const login = qslCredentials.lotw || {};
  if (!login.username || !login.password) return res.status(400).json({ error: 'No LoTW login', needsLogin: true });

  const kind = body.kind === 'qsl' ? 'qsl' : 'rx';
  const since = String(body.since || '1900-01-01');
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(since)) return res.status(400).json({ error: 'Bad date' });

  const params = new URLSearchParams({
    login: login.username,
    password: login.password,
    qso_query: '1',
    qso_withown: 'yes',
    qso_qsldetail: 'yes',
    qso_qsl: kind === 'qsl' ? 'yes' : 'no'
  });
  params.set(kind === 'qsl' ? 'qso_qslsince' : 'qso_qsorxsince', since);
  const url = `https://lotw.arrl.org/lotwuser/lotwreport.adi?${params}`;

  try {
    const response = typeof fetch === 'function'
      ? await safeFetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? { signal: AbortSignal.timeout(120000) } : undefined)
      : await httpsGet(url, { timeout: 120000 });
    const text = await response.text();
    if (!/<eoh>/i.test(text)) {
      // Not a report: LoTW answers a wrong login with a page saying so.
      const badLogin = /password|incorrect|login/i.test(text);
      console.error(`[lotw] report (${kind}) refused: ${badLogin ? 'login not accepted' : `unexpected answer, status ${response.status}`}`);
      return res.status(badLogin ? 401 : 502).json({ error: badLogin ? 'LoTW did not accept the login' : 'Unexpected answer from LoTW', badLogin });
    }
    const records = (text.match(/<eor>/gi) || []).length;
    console.info(`[lotw] report (${kind}) since ${since}: ${records} record(s)`);
    res.json({ adif: text });
  } catch (err) {
    console.error(`[lotw] report (${kind}) failed: ${err.message}`);
    res.status(502).json({ error: err.message, network: true });
  }
});

// ---------------------------------------------------------------------------
// eQSL
//
// No certificates here: the account's login and password go along with the
// upload, as eQSL's interface for logging programs asks. Sending posts the
// new contacts as an ADIF file to ImportADIF.cfm, which answers "Result: x
// out of y records added" and a warning per contact it didn't take
// (duplicates among them — already there, which is fine). Checking asks
// DownloadInBox.cfm for the cards received since last time: it builds an
// ADIF file and answers with a link to it. Like LoTW, only for requests
// from this computer. EQSL_BASE is for tests against a stand-in.
// ---------------------------------------------------------------------------

const EQSL_BASE = process.env.EQSL_BASE || 'https://www.eqsl.cc/qslcard';

/** A GET for http or https alike, following redirects: { status, text }. */
function plainGet(url, { timeout = 120000, redirects = 5 } = {}) {
  if (url.startsWith('https:')) {
    return typeof fetch === 'function'
      ? safeFetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeout) } : undefined)
        .then(async res => ({ status: res.status, text: await res.text() }))
      : httpsGet(url, { timeout }).then(async res => ({ status: res.status, text: await res.text() }));
  }
  return new Promise((resolve, reject) => {
    const req = require('http').get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        plainGet(new URL(res.headers.location, url).toString(), { timeout, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', err => reject(new Error(`Network request failed (${err.code || ''} ${err.message})`.trim())));
    req.setTimeout(timeout, () => req.destroy(new Error('Request timed out')));
  });
}

/**
 * A form upload (multipart/form-data) with some fields and one file, built
 * by hand: the Windows 7/8 build's Node 16 has neither fetch nor FormData.
 */
function postMultipart(url, fields, file, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'http:' ? require('http') : https;
    const boundary = `----LOGform${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const chunks = Object.entries(fields).map(([name, value]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: text/plain\r\n\r\n`));
    chunks.push(Buffer.from(file.content, 'utf8'));
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const req = lib.request(target, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', err => reject(new Error(`Network request failed (${err.code || ''} ${err.message})`.trim())));
    req.setTimeout(timeout, () => req.destroy(new Error('Request timed out')));
    req.end(body);
  });
}

/** eQSL's answer as lines of plain text. */
const eqslLines = html => String(html)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

app.get('/api/eqsl/status', localOnly, (req, res) => {
  const login = qslCredentials.eqsl || {};
  res.json({ login: { username: login.username || '', hasPassword: Boolean(login.password), qth: login.qth || '' } });
});

// The eQSL login (callsign), password and — for more than one QTH on the
// account — the QTH nickname. Login and password both blank clears it.
app.post('/api/eqsl/login', localOnly, (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim().toUpperCase();
  const old = qslCredentials.eqsl || {};
  const password = String(body.password || '') || (username && username === old.username ? old.password || '' : '');
  const qth = String(body.qth || '').trim();
  if (username && password) {
    qslCredentials.eqsl = { username, password, qth };
  } else if (!username && !password) {
    delete qslCredentials.eqsl;
  } else {
    return res.status(400).json({ error: 'Both the login and the password are needed' });
  }
  try {
    saveQslCredentials();
  } catch (err) {
    return res.status(500).json({ error: `Could not save the login: ${err.message}` });
  }
  console.info(`[eqsl] login ${username ? `set for ${username}${qth ? `, QTH "${qth}"` : ''}` : 'cleared'}`);
  res.json({ ok: true, username });
});

// Sends one batch. Answers { added, total, duplicates, warnings } — or an error.
app.post('/api/eqsl/upload', localOnly, async (req, res) => {
  const body = req.body || {};
  const login = qslCredentials.eqsl || {};
  if (!login.username || !login.password) return res.status(400).json({ error: 'No eQSL login', needsLogin: true });
  let adif = String(body.adif || '');
  if (!/<eor>/i.test(adif)) return res.status(400).json({ error: 'No contacts to send' });
  if (login.qth) {
    const tag = `<APP_EQSL_QTH_NICKNAME:${Buffer.byteLength(login.qth)}>${login.qth} `;
    adif = adif.replace(/<eor>/gi, `${tag}<EOR>`);
  }

  const total = (adif.match(/<eor>/gi) || []).length;
  try {
    const answer = await postMultipart(`${EQSL_BASE}/ImportADIF.cfm`,
      { EQSL_USER: login.username, EQSL_PSWD: login.password },
      { field: 'Filename', name: 'log.adi', content: adif });
    const lines = eqslLines(answer.text);
    const error = lines.find(l => /^Error:/i.test(l));
    if (error) {
      const badLogin = /eQSL_User|eQSL_Pswd|password/i.test(error);
      console.error(`[eqsl] upload refused: ${badLogin ? 'login not accepted' : error}`);
      return res.status(badLogin ? 401 : 502).json({ error: badLogin ? 'eQSL did not accept the login' : error, badLogin });
    }
    const result = lines.join(' ').match(/Result:\s*(\d+)\s+out\s+of\s+(\d+)\s+records?\s+added/i);
    if (!result) {
      console.error(`[eqsl] upload: unexpected answer (status ${answer.status})`);
      return res.status(502).json({ error: 'Unexpected answer from eQSL' });
    }
    const warnings = lines.filter(l => /^Warning:/i.test(l));
    const duplicates = warnings.filter(l => /duplicate/i.test(l)).length;
    console.info(`[eqsl] upload: ${result[1]} of ${result[2]} added${duplicates ? `, ${duplicates} already there` : ''}` +
      `${warnings.length > duplicates ? `, ${warnings.length - duplicates} not taken: ${warnings.filter(l => !/duplicate/i.test(l)).slice(0, 5).join(' | ')}` : ''}`);
    res.json({ added: Number(result[1]), total: Number(result[2]) || total, duplicates, warnings });
  } catch (err) {
    console.error(`[eqsl] upload failed: ${err.message}`);
    res.status(502).json({ error: err.message, network: true });
  }
});

// The cards received since a moment (YYYYMMDDHHMM), as ADIF.
app.post('/api/eqsl/inbox', localOnly, async (req, res) => {
  const body = req.body || {};
  const login = qslCredentials.eqsl || {};
  if (!login.username || !login.password) return res.status(400).json({ error: 'No eQSL login', needsLogin: true });
  const since = String(body.since || '190001010000');
  if (!/^\d{12}$/.test(since)) return res.status(400).json({ error: 'Bad date' });

  const params = new URLSearchParams({ UserName: login.username, Password: login.password, RcvdSince: since });
  if (login.qth) params.set('QTHNickname', login.qth);
  const pageUrl = `${EQSL_BASE}/DownloadInBox.cfm?${params}`;
  try {
    const page = await plainGet(pageUrl);
    if (!/has been built/i.test(page.text)) {
      const lines = eqslLines(page.text);
      const error = lines.find(l => /^Error:/i.test(l));
      if (error && /password|username|no such/i.test(error)) {
        console.error('[eqsl] inbox refused: login not accepted');
        return res.status(401).json({ error: 'eQSL did not accept the login', badLogin: true });
      }
      if (/no\s+(new\s+)?(log\s+entries|records|eqsls?|qsls?|matching)|nothing\s+(new|found)/i.test(lines.join(' '))) {
        console.info(`[eqsl] inbox since ${since}: nothing new`);
        return res.json({ adif: '' });
      }
      console.error(`[eqsl] inbox: unexpected answer (status ${page.status})${error ? ` — ${error}` : ''}`);
      return res.status(502).json({ error: error || 'Unexpected answer from eQSL' });
    }
    const link = page.text.match(/href\s*=\s*["']?([^"'\s>]+\.adi)["'\s>]/i);
    if (!link) return res.status(502).json({ error: 'eQSL built the file but gave no link to it' });
    const file = await plainGet(new URL(link[1], `${EQSL_BASE}/DownloadInBox.cfm`).toString());
    const records = (file.text.match(/<eor>/gi) || []).length;
    console.info(`[eqsl] inbox since ${since}: ${records} card(s)`);
    res.json({ adif: file.text });
  } catch (err) {
    console.error(`[eqsl] inbox failed: ${err.message}`);
    res.status(502).json({ error: err.message, network: true });
  }
});

// A received eQSL card's picture: asked of eQSL (GeteQSL.cfm) the first time
// it's opened, then kept in data/eqsl-cards and never asked for again — eQSL
// asks programs for one card at a time, slower than six a minute, and not the
// same one twice. So the requests queue up here, 11 s apart.

const EQSL_CARD_DIR = () => path.join(DATA_DIR, 'eqsl-cards');
let eqslCardQueue = Promise.resolve();
let eqslCardLast = 0;

function eqslCardThrottled(fn) {
  const run = eqslCardQueue.then(async () => {
    const wait = eqslCardLast + 11000 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    eqslCardLast = Date.now();
    return fn();
  });
  eqslCardQueue = run.catch(() => {});
  return run;
}

/** A GET that keeps the bytes (a picture), http or https, following redirects. */
function binaryGet(url, { redirects = 5, relaxed = false, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'http:' ? require('http') : https;
    const req = lib.get(target, target.protocol === 'https:' ? { rejectUnauthorized: !relaxed } : {}, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        binaryGet(new URL(res.headers.location, url).toString(), { redirects: redirects - 1, relaxed, timeout }).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', buffer: Buffer.concat(chunks) }));
    });
    req.on('error', err => {
      // The same certificate-chain trouble as everywhere else (see the TLS note).
      if (!relaxed && ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(err.code) && CHAIN_FALLBACK_HOSTS.has(target.hostname)) {
        binaryGet(url, { redirects, relaxed: true, timeout }).then(resolve, reject);
        return;
      }
      reject(new Error(`Network request failed (${err.code || ''} ${err.message})`.trim()));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Request timed out')));
  });
}

app.post('/api/eqsl/card', localOnly, async (req, res) => {
  const b = req.body || {};
  const call = String(b.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
  const date = String(b.date || '');
  const time = String(b.time || '');
  const band = String(b.band || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mode = String(b.mode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!call || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !band || !mode) {
    return res.status(400).json({ error: 'The contact is incomplete' });
  }
  const stem = `${call.replace(/\//g, '-')}_${date.replace(/-/g, '')}_${time.replace(':', '')}_${band}.`;
  const dir = EQSL_CARD_DIR();
  const have = fs.existsSync(dir) && fs.readdirSync(dir).find(f => f.startsWith(stem));
  if (have) return res.json({ file: have, cached: true });

  const login = qslCredentials.eqsl || {};
  if (!login.username || !login.password) return res.status(400).json({ error: 'No eQSL login', needsLogin: true });
  try {
    const file = await eqslCardThrottled(async () => {
      const [y, mo, d] = date.split('-');
      const [h, mi] = time.split(':');
      const params = new URLSearchParams({
        Username: login.username, Password: login.password, CallsignFrom: call,
        QSOYear: y, QSOMonth: mo, QSODay: d, QSOHour: h, QSOMinute: mi, QSOBand: band, QSOMode: mode
      });
      const page = await plainGet(`${EQSL_BASE}/GeteQSL.cfm?${params}`);
      // The page explains itself in comments that mention "<IMG SRC=" too —
      // the real tag is the one outside them.
      const img = page.text.replace(/<!--[\s\S]*?-->/g, '').match(/<img\s+src\s*=\s*["']?([^"'\s>]+)/i);
      if (!img) {
        const lines = eqslLines(page.text);
        const said = lines.find(l => /error|warning/i.test(l)) || '';
        throw Object.assign(new Error(said || 'eQSL gave no picture'), {
          badLogin: /eqsl_user|pswd|password/i.test(said),
          notFound: !/eqsl_user|pswd|password/i.test(said) && /find|no match|not found|no such/i.test(said),
          throttled: /overload|throttl/i.test(said)
        });
      }
      const pic = await binaryGet(new URL(img[1], `${EQSL_BASE}/GeteQSL.cfm`).toString());
      if (pic.status !== 200 || !pic.buffer.length) throw new Error(`eQSL picture: HTTP ${pic.status}`);
      const ext = /png/i.test(pic.type) || /\.png$/i.test(img[1]) ? 'png' : 'jpg';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, stem + ext), pic.buffer);
      return stem + ext;
    });
    console.info(`[eqsl] card from ${call} (${date} ${time} ${band}) downloaded and kept`);
    res.json({ file });
  } catch (err) {
    console.warn(`[eqsl] card from ${call} (${date} ${time}): ${err.message}`);
    res.status(err.badLogin ? 401 : err.notFound ? 404 : 502).json({ error: err.message, badLogin: Boolean(err.badLogin), notFound: Boolean(err.notFound), throttled: Boolean(err.throttled) });
  }
});

app.get('/api/eqsl/card-image', localOnly, (req, res) => {
  const f = String(req.query.f || '');
  if (!/^[A-Z0-9-]+_\d{8}_\d{4}_[a-z0-9]+\.(jpg|png)$/i.test(f)) return res.status(400).end();
  const file = path.join(EQSL_CARD_DIR(), f);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ---------------------------------------------------------------------------
// QSL cards by e-mail
//
// The page draws the card (the operator's own picture with the contact's
// details written into it, or the program's own card) and hands it here as
// a JPEG with the address and the letter; this sends it from the operator's
// own mailbox over SMTP, with an app password he made for it. Nothing goes
// from the program's side — no server of ours, no address of ours. The
// operator's card picture is kept in data/ next to the logins, the mailbox
// password in qsl-credentials.json with the others; neither goes back to
// the page. Like LoTW: this computer only.
// ---------------------------------------------------------------------------

// Where the big mail services take letters from programs. Anything else:
// the server and port are typed in by hand.
const MAIL_SERVERS = [
  [['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'internet.ru'], 'smtp.mail.ru', 465, true],
  [['yandex.ru', 'ya.ru', 'yandex.com', 'yandex.by', 'yandex.kz'], 'smtp.yandex.ru', 465, true],
  [['gmail.com', 'googlemail.com'], 'smtp.gmail.com', 465, true],
  [['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], 'smtp-mail.outlook.com', 587, false],
  [['rambler.ru', 'lenta.ru', 'ro.ru'], 'smtp.rambler.ru', 465, true],
  [['icloud.com', 'me.com', 'mac.com'], 'smtp.mail.me.com', 587, false]
];

function knownMailServer(address) {
  const domain = String(address || '').split('@')[1] || '';
  const hit = MAIL_SERVERS.find(([domains]) => domains.includes(domain.toLowerCase()));
  return hit ? { host: hit[1], port: hit[2], secure: hit[3] } : null;
}

function mailStatus() {
  const m = qslCredentials.mail || {};
  return {
    address: m.address || '',
    host: m.host || '',
    port: m.port || 0,
    hasPassword: Boolean(m.password),
    known: Boolean(knownMailServer(m.address))
  };
}

function mailTransport() {
  const m = qslCredentials.mail || {};
  if (!m.address || !m.password || !m.host) throw Object.assign(new Error('The mailbox for sending is not set up'), { notSet: true });
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: m.host,
    port: m.port || 465,
    secure: m.port ? m.port === 465 : true,
    auth: { user: m.address, pass: m.password },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000
  });
}

/** An SMTP failure, as the page can tell it: the password, the connection, or something else. */
function mailError(err) {
  const code = err && (err.code || '');
  const badLogin = code === 'EAUTH' || (err && err.responseCode === 535);
  const network = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(code);
  return { error: String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 300), badLogin, network };
}

app.get('/api/mail/status', localOnly, (req, res) => res.json({ mail: mailStatus() }));

app.post('/api/mail/login', localOnly, (req, res) => {
  const body = req.body || {};
  const address = String(body.address || '').trim();
  const old = qslCredentials.mail || {};
  if (!address) {
    delete qslCredentials.mail;
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return res.status(400).json({ error: 'That is not an e-mail address' });
    // Empty with the same address: the saved password stays (dots on the page).
    const password = String(body.password || '') || (address === old.address ? old.password || '' : '');
    if (!password) return res.status(400).json({ error: 'The app password is needed' });
    const known = knownMailServer(address);
    const host = String(body.host || '').trim() || (known && known.host) || '';
    const port = Number(body.port) || (known && known.port) || 465;
    if (!host) return res.status(400).json({ error: 'The mail server is needed for this address', needsHost: true });
    qslCredentials.mail = { address, password, host, port };
  }
  try {
    saveQslCredentials();
  } catch (err) {
    return res.status(500).json({ error: `Could not save: ${err.message}` });
  }
  console.info(`[mail] mailbox ${address ? `set: ${address} via ${qslCredentials.mail.host}:${qslCredentials.mail.port}` : 'cleared'}`);
  res.json({ ok: true, mail: mailStatus() });
});

// Logs in to the mailbox without sending anything — "is the password right?"
app.post('/api/mail/test', localOnly, async (req, res) => {
  try {
    await mailTransport().verify();
    console.info('[mail] login checked: ok');
    res.json({ ok: true });
  } catch (err) {
    const e = mailError(err);
    console.warn(`[mail] login check failed: ${e.error}`);
    res.status(e.badLogin ? 401 : 502).json(e);
  }
});

const CARD_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function cardImageFile() {
  for (const ext of Object.values(CARD_IMAGE_TYPES)) {
    const file = path.join(DATA_DIR, `qsl-card.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function cardImageInfo() {
  const file = cardImageFile();
  if (!file) return null;
  const bytes = fs.readFileSync(file);
  return { sha256: require('crypto').createHash('sha256').update(bytes).digest('hex'), size: bytes.length, ext: path.extname(file).slice(1) };
}

app.get('/api/card/status', localOnly, (req, res) => res.json({ image: cardImageInfo() }));

app.get('/api/card/image', localOnly, (req, res) => {
  const file = cardImageFile();
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.sendFile(file);
});

// The operator's own card picture: stored (replacing the one before), or removed with no data.
app.post('/api/card/image', localOnly, (req, res) => {
  const body = req.body || {};
  const ext = CARD_IMAGE_TYPES[body.type];
  try {
    Object.values(CARD_IMAGE_TYPES).forEach(e => {
      const f = path.join(DATA_DIR, `qsl-card.${e}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    if (body.data) {
      if (!ext) return res.status(400).json({ error: 'A JPEG, PNG or WebP picture, please' });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, `qsl-card.${ext}`), Buffer.from(String(body.data), 'base64'));
    }
  } catch (err) {
    return res.status(500).json({ error: `Could not save the picture: ${err.message}` });
  }
  const info = cardImageInfo();
  console.info(`[card] picture ${info ? `saved (${Math.round(info.size / 1024)} KB)` : 'removed'}`);
  res.json({ ok: true, image: info });
});

app.post('/api/card/send', localOnly, async (req, res) => {
  const body = req.body || {};
  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'That is not an e-mail address' });
  const subject = String(body.subject || '').slice(0, 200);
  const text = String(body.text || '').slice(0, 5000);
  const filename = String(body.filename || 'QSL.jpg').replace(/[^\w.@+-]/g, '_').slice(0, 80);
  const image = body.image ? Buffer.from(String(body.image), 'base64') : null;
  const m = qslCredentials.mail || {};
  const fromName = String(body.fromName || '').replace(/["<>]/g, '').slice(0, 60);
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = text.split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('') +
    (image ? '<p><img src="cid:qslcard" alt="QSL" style="max-width:100%;border-radius:6px"></p>' : '');
  try {
    const info = await mailTransport().sendMail({
      from: fromName ? `"${fromName}" <${m.address}>` : m.address,
      to,
      subject,
      text,
      html,
      attachments: image ? [{ filename, content: image, cid: 'qslcard' }] : []
    });
    console.info(`[card] sent to ${to}: ${subject}`);
    res.json({ ok: true, id: info.messageId || '' });
  } catch (err) {
    const e = err && err.notSet ? { error: err.message, notSet: true } : mailError(err);
    console.warn(`[card] not sent to ${to}: ${e.error}`);
    res.status(e.badLogin ? 401 : e.notSet ? 400 : 502).json(e);
  }
});

function lanAddresses() {
  const nets = require('os').networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// Everywhere on the network by default, so a phone on the same Wi-Fi can
// open it. The Windows app narrows this to the computer itself (HOST, set in
// electron-main.js) so Windows Firewall has nothing to ask about.
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log('\nQSO log is running.\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  const addrs = HOST === '0.0.0.0' ? lanAddresses() : [];
  if (addrs.length) {
    console.log(`  On your phone:     http://${addrs[0]}:${PORT}`);
    console.log('\n  Phone must be on the same Wi-Fi network as this computer.');
  }
  if (ACCESS_KEY) {
    console.log('\n  Access code is set.');
  } else {
    console.log('\n  No ACCESS_KEY set — fine on your own network, but set one');
    console.log('  before putting this online.');
  }
  console.log('');
});

// Most often: the port is taken — another copy of the app, or some other
// program on 4173. Said plainly (it ends up in the debug log) instead of an
// unexplained crash.
server.on('error', err => {
  console.error(`[server] can't listen on ${HOST}:${PORT} — ${err.code === 'EADDRINUSE'
    ? 'the port is taken by another program (or another copy of R2FEL-LOG)' : err.message}`);
});
