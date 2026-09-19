// WLP Stage 7 v1.8.6.36 — Bottom Nav visual-fixed landscape recovery.
// Portrait keeps the proven bottom:0 fixed path. After any orientation change
// (or fixed-position drift), navs enter visual-fixed mode: they remain fixed at
// top:0 and are translated to the *current Visual Viewport* bottom. A continuous
// rAF watcher avoids depending on iPhone Chrome/WebKit scroll event delivery.
(() => {
  const NAV_SPECS = [
    { selector: '.stage7-page-bottom-nav', maxWidth: 760 },
    { selector: '.deck-browser-bottom-nav', maxWidth: 760 },
    { selector: '.progress-bottom-nav', maxWidth: 700 }
  ];

  let visualMode = matchMedia('(orientation: landscape)').matches;
  let raf = 0;
  let visualLoopRaf = 0;
  let lastVisualSignature = '';

  const cssName = key => key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const setImportant = (node, key, value) => node.style.setProperty(cssName(key), value, 'important');

  const viewportBox = () => {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || 1),
      offsetTop: Number.isFinite(vv?.offsetTop) ? vv.offsetTop : 0,
      offsetLeft: Number.isFinite(vv?.offsetLeft) ? vv.offsetLeft : 0,
      scale: Number.isFinite(vv?.scale) ? vv.scale : 1
    };
  };

  const ensureBodyParent = nav => {
    if (!nav || !document.body) return false;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);
    return true;
  };

  const applyFixed = (nav, maxWidth) => {
    if (!ensureBodyParent(nav)) return;
    const lock = {
      position: 'fixed', zIndex: '85', left: '50%', right: 'auto', top: 'auto', bottom: '0',
      transform: 'translateX(-50%)', width: `min(100%, ${maxWidth}px)`, maxWidth: '100vw',
      margin: '0', willChange: 'auto'
    };
    Object.entries(lock).forEach(([key, value]) => setImportant(nav, key, value));
    nav.style.removeProperty('transform-origin');
    nav.style.removeProperty('-webkit-transform-origin');
    nav.style.removeProperty('backdrop-filter');
    nav.style.removeProperty('-webkit-backdrop-filter');
    nav.dataset.stage7ViewportLocked = 'fixed';
  };

  const applyVisualFixed = (nav, maxWidth, view) => {
    if (!ensureBodyParent(nav)) return;

    const navWidth = Math.max(1, Math.min(maxWidth, view.width));
    setImportant(nav, 'position', 'fixed');
    setImportant(nav, 'zIndex', '85');
    setImportant(nav, 'left', '0');
    setImportant(nav, 'right', 'auto');
    setImportant(nav, 'top', '0');
    setImportant(nav, 'bottom', 'auto');
    setImportant(nav, 'width', `${navWidth}px`);
    setImportant(nav, 'maxWidth', `${navWidth}px`);
    setImportant(nav, 'margin', '0');
    setImportant(nav, 'transformOrigin', '0 0');
    nav.style.setProperty('-webkit-transform-origin', '0 0', 'important');
    setImportant(nav, 'willChange', 'transform');
    // Avoid keeping the old blurred bottom:0 compositor layer after rotation.
    nav.style.setProperty('backdrop-filter', 'none', 'important');
    nav.style.setProperty('-webkit-backdrop-filter', 'none', 'important');

    // Measure with the final width before computing the visible-viewport anchor.
    const navHeight = Math.max(1, nav.getBoundingClientRect().height || nav.offsetHeight || 1);
    const x = view.offsetLeft + Math.max(0, (view.width - navWidth) / 2);
    const y = view.offsetTop + Math.max(0, view.height - navHeight);
    const transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    nav.style.setProperty('transform', transform, 'important');
    nav.style.setProperty('-webkit-transform', transform, 'important');
    nav.dataset.stage7ViewportLocked = 'visual-fixed';
  };

  const lockAllBottomNavs = (force = false) => {
    if (!visualMode) {
      NAV_SPECS.forEach(({ selector, maxWidth }) => {
        document.querySelectorAll(selector).forEach(nav => applyFixed(nav, maxWidth));
      });
      return;
    }

    const view = viewportBox();
    const signature = [
      view.width.toFixed(2), view.height.toFixed(2), view.offsetTop.toFixed(2),
      view.offsetLeft.toFixed(2), view.scale.toFixed(3)
    ].join('|');

    // If viewport geometry did not change, still force periodically when requested
    // so an external browser/compositor mutation cannot leave the inline lock stale.
    if (!force && signature === lastVisualSignature) return;
    lastVisualSignature = signature;
    NAV_SPECS.forEach(({ selector, maxWidth }) => {
      document.querySelectorAll(selector).forEach(nav => applyVisualFixed(nav, maxWidth, view));
    });
  };

  const scheduleLock = () => {
    if (visualMode) {
      lockAllBottomNavs(true);
      return;
    }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      lockAllBottomNavs(true);
    });
  };

  const runVisualLoop = () => {
    if (visualLoopRaf || !visualMode || document.hidden) return;
    const tick = () => {
      visualLoopRaf = 0;
      if (!visualMode || document.hidden) return;
      // Read/write every animation frame in recovery mode. iPhone Chrome can
      // visually pan the viewport during landscape scrolling without delivering
      // a reliable sequence of window/VisualViewport scroll events.
      lastVisualSignature = '';
      lockAllBottomNavs(true);
      visualLoopRaf = requestAnimationFrame(tick);
    };
    visualLoopRaf = requestAnimationFrame(tick);
  };

  const enterVisualMode = () => {
    visualMode = true;
    document.documentElement.dataset.stage7NavAnchor = 'visual-fixed';
    lastVisualSignature = '';
    lockAllBottomNavs(true);
    runVisualLoop();
  };

  const detectFixedDrift = () => {
    if (visualMode) { scheduleLock(); return; }
    const vv = window.visualViewport;
    if (!vv) { scheduleLock(); return; }
    // In portrait the expected visible bottom is vv.height + vv.offsetTop.
    // A large mismatch means the browser has stopped treating bottom:0 as the
    // visible viewport bottom, so switch permanently to visual-fixed recovery.
    const expectedBottom = (vv.offsetTop || 0) + vv.height;
    let drifted = false;
    NAV_SPECS.forEach(({ selector }) => {
      document.querySelectorAll(selector).forEach(nav => {
        const rect = nav.getBoundingClientRect();
        if (Number.isFinite(rect.bottom) && Math.abs(rect.bottom - expectedBottom) > 24) drifted = true;
      });
    });
    if (drifted) enterVisualMode();
    else scheduleLock();
  };

  window.WLPBottomNavGuard = {
    lockAll: () => lockAllBottomNavs(true),
    schedule: scheduleLock,
    recover: enterVisualMode,
    useVisualViewportAnchor: enterVisualMode,
    isTracked: () => visualMode,
    isVisualFixed: () => visualMode
  };

  const boot = () => {
    if (visualMode) enterVisualMode();
    else lockAllBottomNavs(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  ['load', 'pageshow', 'focus', 'scroll', 'touchmove', 'touchend', 'pointerup']
    .forEach(type => window.addEventListener(type, visualMode ? scheduleLock : detectFixedDrift, { passive: true }));
  window.addEventListener('resize', () => {
    if (matchMedia('(orientation: landscape)').matches) enterVisualMode();
    else if (visualMode) scheduleLock();
    else detectFixedDrift();
  }, { passive: true });
  window.addEventListener('orientationchange', enterVisualMode, { passive: true });
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', enterVisualMode);
  const orientationQuery = matchMedia('(orientation: portrait)');
  if (orientationQuery.addEventListener) orientationQuery.addEventListener('change', enterVisualMode);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (visualLoopRaf) cancelAnimationFrame(visualLoopRaf);
      visualLoopRaf = 0;
      return;
    }
    if (visualMode) enterVisualMode();
    else detectFixedDrift();
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', visualMode ? scheduleLock : detectFixedDrift, { passive: true });
    visualViewport.addEventListener('scroll', scheduleLock, { passive: true });
  }

  const startObserver = () => {
    if (!document.body || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(scheduleLock);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  setInterval(() => {
    if (document.hidden) return;
    if (visualMode) lockAllBottomNavs(true);
    else detectFixedDrift();
  }, 1000);
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
