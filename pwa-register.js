// WLP Stage 7 v1.8.6.27 — PWA registration with cache-bypass for SW updates.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    }).then(registration => {
      // Harmless when already current; prevents a long-lived installed PWA from
      // waiting on the browser's normal service-worker update interval.
      registration.update().catch(() => {});
    }).catch(error => console.warn('WLP service worker registration failed:', error));
  });
}
