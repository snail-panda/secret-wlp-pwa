// WLP Stage 6A.1 — minimal offline shell.
const CACHE_NAME = 'wlp-stage7-bottom-nav-unify-progress-fix-v1-8-6-10';
const CORE = [
  './',
  './index.html',
  './style.css',
  './stage7-home.js',
  './global-search.html',
  './global-search.css',
  './global-search.js',
  './deck-browser.html',
  './deck-browser.css',
  './deck-browser.js',
  './progress.html',
  './progress.css',
  './progress.js',
  './drafts.html',
  './drafts.css',
  './drafts.js',
  './editor.html',
  './editor.css',
  './editor.js',
  './editor-new-card.html',
  './editor-new-card.css',
  './reference-assist.js',
  './editor-drafts.html',
  './editor-draft-edit.html',
  './editor-drafts.css',
  './editor-drafts.js',
  './editor-local-edits.html',
  './editor-local-edit.html',
  './editor-local-edits.css',
  './editor-local-edits.js',
  './editor-backup.html',
  './editor-backup.css',
  './editor-backup.js',
  './local-data-safety.css',
  './local-data-safety.js',
  './study-options.css',
  './study-options.js',
  './legacy-home.html',
  './legacy-style.css',
  './manifest.webmanifest',
  './pwa-register.js',
  './pwa-icons/icon-192.png',
  './pwa-icons/icon-512.png',
  './pwa-icons/apple-touch-icon.png',
  './assets/skull-crossbones.png',
  './assets/skull.png',
  './assets/stage7-secret-garden-hero-v16.webp',
  './flashcards/wlp/batch.html',
  './flashcards/wlp/flashcards.css',
  './flashcards/wlp/study-stage7.css',
  './flashcards/wlp/study-stage7.js',
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

  // API lookups must never be served from the app cache. Each query needs
  // its own live response; ignoreSearch caching would otherwise reuse the
  // previous headword's Merriam-Webster result for a different word.
  if (url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Keep the registration script fresh so service-worker updates are detected
  // promptly. UI shell code is intentionally NOT injected from pwa-register.js.
  if (url.pathname === '/pwa-register.js') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

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
