const VERSION = 'v3';
const STATIC_CACHE = `bars-static-${VERSION}`;
const RUNTIME_CACHE = `bars-runtime-${VERSION}`;
const TILES_CACHE = 'tiles-v1';
const TILES_MAX_ENTRIES = 400;

// Chemins relatifs au sw.js : fonctionne en local et quel que soit le nom du repo
const STATIC_ASSETS = [
  './',
  './index.html',
  './js/script.js',
  './css/tailwind.css',
  './data/bars.json'
];

self.addEventListener('install', e => {
  // cache: 'reload' = ignore le cache HTTP du navigateur, va chercher au serveur
  e.waitUntil(caches.open(STATIC_CACHE).then(c =>
    c.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

// Purge les caches des anciennes versions quand le nouveau SW s'active
self.addEventListener('activate', e => {
  const keep = [STATIC_CACHE, RUNTIME_CACHE, TILES_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Plafonne le nombre de tuiles en cache pour ne pas saturer le quota de stockage
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

  // Tuiles de carte : cache-first (les tuiles ne changent pas), avec plafond
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

  // Fichiers de l'app (html, js, bars.json) : network-first
  // → les mises à jour (nouveaux bars) arrivent immédiatement,
  //   le cache ne sert que de secours hors-ligne
  const isAppFile = url.origin === self.location.origin
    && !url.pathname.includes('/photos/')
    && !url.pathname.includes('/assets/');
  if (isAppFile) {
    e.respondWith(
      // cache: 'no-cache' = revalide toujours auprès du serveur (304 si inchangé),
      // sinon le cache HTTP du navigateur peut resservir un bars.json périmé
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

  // Reste (CDN Leaflet/Tailwind/Fuse, photos, icônes) : cache-first,
  // mis en cache à la première visite → dispo hors-ligne ensuite
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
