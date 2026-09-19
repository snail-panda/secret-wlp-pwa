// WLP Stage 7 v1.8.6.35 — Bottom Nav visual-viewport anchor.
// Portrait keeps the proven fixed-position path. Once rotation or fixed drift is
// detected, navs switch to a document-positioned visual-viewport tracker so an
// iPhone Chrome/WebKit compositor reset cannot make them scroll with the page.
(() => {
  const NAV_SPECS = [
    { selector: '.stage7-page-bottom-nav', width: 'min(100%, 760px)' },
    { selector: '.deck-browser-bottom-nav', width: 'min(100%, 760px)' },
    { selector: '.progress-bottom-nav', width: 'min(100%, 700px)' }
  ];

  let trackedMode = window.innerWidth > window.innerHeight;
  let raf = 0;
  let recoveryTimers = [];

  const cssName = key => key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const setImportant = (node, key, value) => node.style.setProperty(cssName(key), value, 'important');

  const viewportBox = () => {
    const vv = window.visualViewport;
    const width = Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || 1);
    const height = Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || 1);
    const pageTop = Number.isFinite(vv?.pageTop)
      ? vv.pageTop
      : (window.scrollY || window.pageYOffset || 0) + (vv?.offsetTop || 0);
    const pageLeft = Number.isFinite(vv?.pageLeft)
      ? vv.pageLeft
      : (window.scrollX || window.pageXOffset || 0) + (vv?.offsetLeft || 0);
    const offsetTop = vv?.offsetTop || 0;
    return { width, height, pageTop, pageLeft, offsetTop };
  };

  const ensureBodyParent = nav => {
    if (!nav || !document.body) return false;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);
    return true;
  };

  const applyFixed = (nav, width) => {
    if (!ensureBodyParent(nav)) return;
    const lock = {
      position: 'fixed', zIndex: '85', left: '50%', right: 'auto', top: 'auto', bottom: '0',
      transform: 'translateX(-50%)', width, maxWidth: '100vw', margin: '0', willChange: 'auto'
    };
    Object.entries(lock).forEach(([key, value]) => setImportant(nav, key, value));
    nav.style.removeProperty('backdrop-filter');
    nav.style.removeProperty('-webkit-backdrop-filter');
    nav.dataset.stage7ViewportLocked = 'fixed';
  };

  const applyTracked = (nav, width) => {
    if (!ensureBodyParent(nav)) return;
    const view = viewportBox();

    // Establish width/position first, then measure the real nav height including
    // safe-area padding before anchoring it to the visible viewport bottom.
    setImportant(nav, 'position', 'absolute');
    setImportant(nav, 'zIndex', '85');
    setImportant(nav, 'right', 'auto');
    setImportant(nav, 'bottom', 'auto');
    setImportant(nav, 'width', width);
    setImportant(nav, 'maxWidth', `${Math.round(view.width)}px`);
    setImportant(nav, 'margin', '0');
    setImportant(nav, 'transform', 'translateX(-50%)');
    nav.style.setProperty('-webkit-transform', 'translateX(-50%)', 'important');
    // Avoid keeping the nav in the stale fixed/backdrop compositor layer that
    // can survive an iPhone orientation change.
    nav.style.setProperty('will-change', 'auto', 'important');
    nav.style.setProperty('backdrop-filter', 'none', 'important');
    nav.style.setProperty('-webkit-backdrop-filter', 'none', 'important');

    const navHeight = Math.max(1, nav.getBoundingClientRect().height || nav.offsetHeight || 1);
    const top = Math.max(view.pageTop, view.pageTop + view.height - navHeight);
    const left = view.pageLeft + view.width / 2;
    setImportant(nav, 'top', `${Math.round(top)}px`);
    setImportant(nav, 'left', `${Math.round(left)}px`);
    nav.dataset.stage7ViewportLocked = 'tracked';
  };

  const lockAllBottomNavs = () => {
    NAV_SPECS.forEach(({ selector, width }) => {
      document.querySelectorAll(selector).forEach(nav => {
        if (trackedMode) applyTracked(nav, width);
        else applyFixed(nav, width);
      });
    });
  };

  const scheduleLock = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      lockAllBottomNavs();
    });
  };

  const enterTrackedMode = () => {
    trackedMode = true;
    document.documentElement.dataset.stage7NavAnchor = 'visual-viewport';
    recoveryTimers.forEach(clearTimeout);
    recoveryTimers = [];
    [0, 40, 120, 260, 520, 900, 1500].forEach(delay => {
      recoveryTimers.push(setTimeout(() => {
        lockAllBottomNavs();
        requestAnimationFrame(lockAllBottomNavs);
      }, delay));
    });
  };

  let lastOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  const detectOrientation = () => {
    const next = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
    if (next !== lastOrientation) {
      lastOrientation = next;
      enterTrackedMode();
      return;
    }
    scheduleLock();
  };

  const detectFixedDrift = () => {
    if (trackedMode) { scheduleLock(); return; }
    const vv = window.visualViewport;
    if (!vv) { scheduleLock(); return; }
    const expectedBottom = (vv.offsetTop || 0) + vv.height;
    let drifted = false;
    NAV_SPECS.forEach(({ selector }) => {
      document.querySelectorAll(selector).forEach(nav => {
        const rect = nav.getBoundingClientRect();
        if (Number.isFinite(rect.bottom) && Math.abs(rect.bottom - expectedBottom) > 24) drifted = true;
      });
    });
    if (drifted) enterTrackedMode();
    else scheduleLock();
  };

  window.WLPBottomNavGuard = {
    lockAll: lockAllBottomNavs,
    schedule: scheduleLock,
    recover: enterTrackedMode,
    useVisualViewportAnchor: enterTrackedMode,
    isTracked: () => trackedMode
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (trackedMode) enterTrackedMode(); else lockAllBottomNavs();
    }, { once: true });
  } else if (trackedMode) {
    enterTrackedMode();
  } else {
    lockAllBottomNavs();
  }

  ['load', 'pageshow', 'focus', 'scroll', 'touchmove', 'touchend', 'pointerup']
    .forEach(type => window.addEventListener(type, trackedMode ? scheduleLock : detectFixedDrift, { passive: true }));
  window.addEventListener('resize', detectOrientation, { passive: true });
  window.addEventListener('orientationchange', enterTrackedMode, { passive: true });
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', enterTrackedMode);
  }
  const orientationQuery = matchMedia('(orientation: portrait)');
  if (orientationQuery.addEventListener) orientationQuery.addEventListener('change', enterTrackedMode);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (trackedMode) enterTrackedMode();
      else { detectFixedDrift(); setTimeout(detectFixedDrift, 140); }
    }
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', detectOrientation, { passive: true });
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
    if (trackedMode) lockAllBottomNavs();
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
