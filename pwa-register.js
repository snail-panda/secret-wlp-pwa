// WLP Stage 7 v1.8.6.37 — Bottom Nav visual-viewport dock recovery.
// iOS 26/WebKit can paint position:fixed;bottom:0 at the wrong vertical position,
// especially in Chrome on iPhone. After an orientation change, avoid bottom anchoring
// and transform-based vertical positioning entirely. Instead, size a fixed wrapper to
// the live Visual Viewport (explicit top + height) and dock the nav absolutely inside it.
(() => {
  const NAV_SPECS = [
    { selector: '.stage7-page-bottom-nav', maxWidth: 760 },
    { selector: '.deck-browser-bottom-nav', maxWidth: 760 },
    { selector: '.progress-bottom-nav', maxWidth: 700 }
  ];

  let dockMode = matchMedia('(orientation: landscape)').matches;
  let raf = 0;
  let loop = 0;
  let dockSeq = 0;

  const cssName = key => key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const setImportant = (node, key, value) => node.style.setProperty(cssName(key), value, 'important');

  const viewportBox = () => {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || 1),
      offsetTop: Number.isFinite(vv?.offsetTop) ? vv.offsetTop : 0,
      offsetLeft: Number.isFinite(vv?.offsetLeft) ? vv.offsetLeft : 0
    };
  };

  const ensureBodyParent = nav => {
    if (!nav || !document.body) return false;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);
    return true;
  };

  const clearDockInline = nav => {
    if (!nav) return;
    ['top','height','left','right','bottom','width','max-width','margin','position','transform','-webkit-transform','transform-origin','-webkit-transform-origin','will-change','pointer-events','backdrop-filter','-webkit-backdrop-filter']
      .forEach(prop => nav.style.removeProperty(prop));
  };

  const applyNormalFixed = (nav, maxWidth) => {
    if (!ensureBodyParent(nav)) return;
    const oldDock = nav.closest?.('[data-stage7-nav-dock="true"]');
    if (oldDock) {
      document.body.appendChild(nav);
      oldDock.remove();
    }
    clearDockInline(nav);
    const lock = {
      position: 'fixed', zIndex: '85', left: '50%', right: 'auto', top: 'auto', bottom: '0',
      transform: 'translateX(-50%)', width: `min(100%, ${maxWidth}px)`, maxWidth: '100vw',
      margin: '0', willChange: 'auto'
    };
    Object.entries(lock).forEach(([key, value]) => setImportant(nav, key, value));
    nav.dataset.stage7ViewportLocked = 'fixed';
  };

  const ensureDock = nav => {
    if (!nav || !document.body) return null;
    let dock = nav.parentElement?.matches?.('[data-stage7-nav-dock="true"]') ? nav.parentElement : null;
    if (!dock) {
      dock = document.createElement('div');
      dock.dataset.stage7NavDock = 'true';
      dock.dataset.stage7NavDockId = String(++dockSeq);
      dock.setAttribute('aria-hidden', 'true');
      document.body.appendChild(dock);
      dock.appendChild(nav);
    } else if (dock.parentElement !== document.body) {
      document.body.appendChild(dock);
    }
    return dock;
  };

  const applyViewportDock = (nav, maxWidth, view) => {
    const dock = ensureDock(nav);
    if (!dock) return;

    // The fixed element itself is positioned only with explicit top/left/width/height.
    // No bottom anchoring and no transform: both are implicated in current iOS 26 bugs.
    const dockStyles = {
      position: 'fixed', zIndex: '84', top: `${view.offsetTop}px`, left: `${view.offsetLeft}px`,
      right: 'auto', bottom: 'auto', width: `${view.width}px`, height: `${view.height}px`,
      maxWidth: 'none', margin: '0', padding: '0', pointerEvents: 'none', overflow: 'visible',
      transform: 'none', willChange: 'auto'
    };
    Object.entries(dockStyles).forEach(([key, value]) => setImportant(dock, key, value));
    dock.style.setProperty('-webkit-transform', 'none', 'important');
    dock.style.setProperty('backdrop-filter', 'none', 'important');
    dock.style.setProperty('-webkit-backdrop-filter', 'none', 'important');

    clearDockInline(nav);
    const navWidth = Math.max(1, Math.min(maxWidth, view.width));
    const navStyles = {
      position: 'absolute', zIndex: '1', left: '0', right: '0', top: 'auto', bottom: '0',
      width: `${navWidth}px`, maxWidth: '100%', margin: '0 auto', pointerEvents: 'auto',
      transform: 'none', willChange: 'auto'
    };
    Object.entries(navStyles).forEach(([key, value]) => setImportant(nav, key, value));
    nav.style.setProperty('-webkit-transform', 'none', 'important');
    nav.dataset.stage7ViewportLocked = 'viewport-dock';
  };

  const lockAll = () => {
    if (!dockMode) {
      NAV_SPECS.forEach(({ selector, maxWidth }) => {
        document.querySelectorAll(selector).forEach(nav => applyNormalFixed(nav, maxWidth));
      });
      return;
    }
    const view = viewportBox();
    NAV_SPECS.forEach(({ selector, maxWidth }) => {
      document.querySelectorAll(selector).forEach(nav => applyViewportDock(nav, maxWidth, view));
    });
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; lockAll(); });
  };

  const startLoop = () => {
    if (loop || !dockMode || document.hidden) return;
    const tick = () => {
      loop = 0;
      if (!dockMode || document.hidden) return;
      lockAll();
      loop = requestAnimationFrame(tick);
    };
    loop = requestAnimationFrame(tick);
  };

  const enterDockMode = () => {
    dockMode = true;
    document.documentElement.dataset.stage7NavAnchor = 'viewport-dock';
    lockAll();
    startLoop();
  };

  window.WLPBottomNavGuard = {
    lockAll,
    schedule,
    recover: enterDockMode,
    useVisualViewportAnchor: enterDockMode,
    isTracked: () => dockMode,
    isVisualFixed: () => dockMode,
    isViewportDocked: () => dockMode
  };

  const boot = () => dockMode ? enterDockMode() : lockAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  ['load', 'pageshow', 'focus', 'scroll', 'touchmove', 'touchend', 'pointerup']
    .forEach(type => window.addEventListener(type, schedule, { passive: true }));
  window.addEventListener('resize', () => {
    if (matchMedia('(orientation: landscape)').matches || dockMode) enterDockMode();
    else schedule();
  }, { passive: true });
  window.addEventListener('orientationchange', enterDockMode, { passive: true });
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', enterDockMode);
  const orientationQuery = matchMedia('(orientation: portrait)');
  if (orientationQuery.addEventListener) orientationQuery.addEventListener('change', enterDockMode);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (loop) cancelAnimationFrame(loop);
      loop = 0;
      return;
    }
    if (dockMode) enterDockMode();
    else schedule();
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', schedule, { passive: true });
    visualViewport.addEventListener('scroll', schedule, { passive: true });
  }

  const startObserver = () => {
    if (!document.body || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  setInterval(() => { if (!document.hidden) lockAll(); }, 1000);
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    }).then(registration => {
      registration.update().catch(() => {});
    }).catch(error => console.warn('WLP service worker registration failed:', error));
  });
}
