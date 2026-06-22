const VERSION = 'v4';
const STATIC_CACHE = `bars-static-${VERSION}`;
const RUNTIME_CACHE = `bars-runtime-${VERSION}`;
const TILES_CACHE = 'tiles-v1';
const TILES_MAX_ENTRIES = 400;

const STATIC_ASSETS = [
  './',
  './index.html',
  './js/script.js',
  './css/tailwind.css',
  './data/bars.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC_CACHE).then(c =>
    c.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  const keep = [STATIC_CACHE, RUNTIME_CACHE, TILES_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await Promise.all(keys.slice(0, keys.length - maxEntries).map(k => cache.delete(k)));
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // ✅ AJOUT — Laisse passer Google Analytics sans interception
  if (url.hostname.includes('google-analytics.com') ||
      url.hostname.includes('googletagmanager.com') ||
      url.hostname.includes('analytics.google.com')) {
    return;
  }

  // Tuiles de carte
  if (url.hostname.includes('thunderforest.com') || url.hostname.includes('tile.openstreetmap')) {
    e.respondWith(
      caches.open(TILES_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(response => {
            if (response.ok || response.type === 'opaque') {
              cache.put(e.request, response.clone());
              trimCache(TILES_CACHE, TILES_MAX_ENTRIES);
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Fichiers de l'app : network-first
  const isAppFile = url.origin === self.location.origin
    && !url.pathname.includes('/photos/')
    && !url.pathname.includes('/assets/');

  if (isAppFile) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Reste : cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      });
    })
  );
});
