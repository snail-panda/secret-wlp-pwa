// WLP PWA registration. Shared Stage 7 shell delivery is explicit in each
// participating HTML page (stage7-shell-v2.js), so UI chrome no longer depends
// on this registration script being fresh before the page renders.
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
