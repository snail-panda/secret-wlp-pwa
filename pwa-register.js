// WLP PWA registration + shared Stage 7 shell loader.
(() => {
  // Resolve from THIS script, not from the current page. This matters on
  // nested pages such as /flashcards/wlp/batch.html.
  const loaderScript = document.currentScript;
  const appRoot = new URL('./', loaderScript?.src || document.baseURI);
  const rootUrl = (path) => new URL(path, appRoot).href;

  const addStyle = () => {
    if (document.querySelector('link[data-stage7-shell]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = rootUrl('stage7-shell.css?v=20260917-s7-shell-v1862');
    link.dataset.stage7Shell = 'true';
    document.head.appendChild(link);
  };

  const addShell = () => {
    if (document.querySelector('script[data-stage7-shell]')) return;
    const script = document.createElement('script');
    script.src = rootUrl('stage7-shell.js?v=20260917-s7-shell-v1862');
    script.dataset.stage7Shell = 'true';
    document.head.appendChild(script);
  };

  addStyle();
  addShell();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(rootUrl('service-worker.js'), {
        scope: appRoot.pathname,
        updateViaCache: 'none'
      }).catch(error => console.warn('WLP service worker registration failed:', error));
    });
  }
})();
