// Keeps the app openable without a connection. Lookups still need the network;
// logging and viewing the logbook do not.
//
// Strategy: network first, cache as fallback.
//
// An earlier version served the cache first, which meant an updated page kept
// showing the old build until the cache happened to refresh. For an app that's
// actively being changed that's the wrong trade: correctness of what you see
// beats saving a few milliseconds on load.

// The placeholder below is filled in with the app's version by server.js as
// this file is served, so the cache is named after the build and nobody has
// to remember to raise a number before a release.
const CACHE = 'qso-log-__APP_VERSION__';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './fonts/fonts.css',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name !== CACHE).map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Callsign lookups and the clock must never be served from cache.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        // A navigation with nothing cached for that exact URL still gets the
        // app shell, so the logbook opens offline.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Promise.reject(new Error('offline and not cached'));
      }))
  );
});
