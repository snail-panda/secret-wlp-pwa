// Stage 6A.1 — PWA registration only. Existing WLP data/learning behavior is unchanged.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' })
      .catch(error => console.warn('WLP service worker registration failed:', error));
  });
}
