// WLP Stage 6A.1 — minimal offline shell.
const CACHE_NAME = 'wlp-stage6-deck-chevron-vertical-v3-2-v6245';
const CORE = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './pwa-register.js',
  './pwa-icons/icon-192.png',
  './pwa-icons/icon-512.png',
  './pwa-icons/apple-touch-icon.png',
  './assets/skull-crossbones.png',
  './assets/skull.png',
  './flashcards/wlp/batch.html',
  './flashcards/wlp/flashcards.css',
  './flashcards/wlp/app.js',
  './flashcards/wlp/index-autogen.js',
  './flashcards/wlp/wlp-flashcard-master.tsv'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('wlp-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: prefer current network version, fall back to cached app pages offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          return caches.match('./index.html');
        })
    );
    return;
  }

  // Local assets/data: cached immediately for offline use; refresh cache in background.
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request).then(response => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
