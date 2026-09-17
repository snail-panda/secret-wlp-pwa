// WLP PWA registration + shared Stage 7 shell loader.
(() => {
  const addStyle = () => {
    if (document.querySelector('link[data-stage7-shell]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './stage7-shell.css?v=20260917-s7-shell-v186';
    link.dataset.stage7Shell = 'true';
    document.head.appendChild(link);
  };

  const addShell = () => {
    if (document.querySelector('script[data-stage7-shell]')) return;
    const script = document.createElement('script');
    script.src = './stage7-shell.js?v=20260917-s7-shell-v186';
    script.dataset.stage7Shell = 'true';
    document.head.appendChild(script);
  };

  addStyle();
  addShell();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch(error => console.warn('WLP service worker registration failed:', error));
    });
  }
})();
