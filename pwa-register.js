// WLP PWA registration only.
// UI chrome (hamburger / bottom navigation) must be defined by the page itself.
// Do not inject shared shell CSS/JS from here: doing so can reintroduce stale
// cached UI across otherwise unrelated pages.
(() => {
  const loaderScript = document.currentScript;
  const appRoot = new URL('./', loaderScript?.src || document.baseURI);
  const rootUrl = (path) => new URL(path, appRoot).href;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(rootUrl('service-worker.js'), {
        scope: appRoot.pathname,
        updateViaCache: 'none'
      }).then(registration => registration.update())
        .catch(error => console.warn('WLP service worker registration failed:', error));
    });
  }
})();
