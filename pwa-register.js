// WLP Stage 7 v1.8.6.34 — PWA registration + Bottom Nav orientation recovery guard.
// The nav guard is intentionally independent of page-specific UI code so a
// lifecycle/compositing hiccup on iPhone Chrome can repair itself in place.
(() => {
  const NAV_SPECS = [
    { selector: '.stage7-page-bottom-nav', width: 'min(100%, 760px)' },
    { selector: '.deck-browser-bottom-nav', width: 'min(100%, 760px)' },
    { selector: '.progress-bottom-nav', width: 'min(100%, 700px)' }
  ];

  const lockNav = (nav, width) => {
    if (!nav || !document.body) return;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);

    const lock = {
      position: 'fixed',
      zIndex: '85',
      left: '50%',
      right: 'auto',
      top: 'auto',
      bottom: '0',
      transform: 'translate3d(-50%, 0, 0)',
      width,
      maxWidth: '100vw',
      margin: '0',
      willChange: 'transform'
    };
    Object.entries(lock).forEach(([key, value]) => nav.style.setProperty(
      key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), value, 'important'
    ));
    nav.style.setProperty('-webkit-transform', 'translate3d(-50%, 0, 0)', 'important');
    nav.dataset.stage7ViewportLocked = 'true';
  };

  const lockAllBottomNavs = () => {
    NAV_SPECS.forEach(({ selector, width }) => {
      document.querySelectorAll(selector).forEach(nav => lockNav(nav, width));
    });
  };

  const hardResetBottomNavs = () => {
    if (!document.body) return;
    NAV_SPECS.forEach(({ selector, width }) => {
      document.querySelectorAll(selector).forEach(nav => {
        const next = nav.parentElement === document.body ? nav.nextSibling : null;
        if (nav.parentElement) nav.parentElement.removeChild(nav);
        // iPhone Chrome can retain a stale compositor layer across rotation.
        // A real detach + layout read + reattach forces a fresh viewport-fixed layer.
        void document.documentElement.offsetHeight;
        if (next && next.parentNode === document.body) document.body.insertBefore(nav, next);
        else document.body.appendChild(nav);
        lockNav(nav, width);
        void nav.getBoundingClientRect();
      });
    });
  };

  let raf = 0;
  const scheduleLock = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      lockAllBottomNavs();
    });
  };

  let orientationTimers = [];
  const recoverAfterOrientation = () => {
    orientationTimers.forEach(clearTimeout);
    orientationTimers = [];
    [0, 70, 170, 330, 650, 1100].forEach((delay, index) => {
      orientationTimers.push(setTimeout(() => {
        if (index === 2 || index === 4) hardResetBottomNavs();
        else lockAllBottomNavs();
        requestAnimationFrame(lockAllBottomNavs);
      }, delay));
    });
  };

  let lastOrientation = innerWidth > innerHeight ? 'landscape' : 'portrait';
  const detectOrientation = () => {
    const next = innerWidth > innerHeight ? 'landscape' : 'portrait';
    if (next !== lastOrientation) {
      lastOrientation = next;
      recoverAfterOrientation();
    } else {
      scheduleLock();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lockAllBottomNavs, { once: true });
  } else {
    lockAllBottomNavs();
  }

  ['load', 'pageshow', 'focus', 'scroll', 'touchend', 'pointerup']
    .forEach(type => window.addEventListener(type, scheduleLock, { passive: true }));
  window.addEventListener('resize', detectOrientation, { passive: true });
  window.addEventListener('orientationchange', recoverAfterOrientation, { passive: true });
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', recoverAfterOrientation);
  }
  const orientationQuery = matchMedia('(orientation: portrait)');
  if (orientationQuery.addEventListener) orientationQuery.addEventListener('change', recoverAfterOrientation);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scheduleLock(); setTimeout(lockAllBottomNavs, 120); }
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', detectOrientation, { passive: true });
    visualViewport.addEventListener('scroll', scheduleLock, { passive: true });
  }

  // Child-list only: detects a framework/page script moving or recreating the nav
  // without creating an attribute-mutation loop when this guard reapplies styles.
  const startObserver = () => {
    if (!document.body || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(scheduleLock);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // Lightweight watchdog. Existing event hooks normally do the work; this catches
  // rare long-lived iPhone Chrome viewport/compositor states without a reload.
  setInterval(() => {
    if (!document.hidden) lockAllBottomNavs();
  }, 1500);
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
