const CACHE_NAME = 'ledpoi-pwa-v17';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Never intercept local ESP32 API calls
  if (e.request.url.includes('192.168.') || e.request.url.includes('led.local')) {
    return;
  }

  // Stale-While-Revalidate: serve cached UI instantly, update cache in background if online
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const networkFetch = fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          return res;
        })
        .catch(() => null);

      return cached || networkFetch;
    })
  );
});
