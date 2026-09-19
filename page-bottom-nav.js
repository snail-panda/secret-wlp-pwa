/* WLP Stage 7 v1.8.6.35 — semantic Back + shared Bottom Nav anchor handoff. */
(() => {
  function handoffNav(nav){
    if (!nav) return;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);
    // pwa-register owns viewport anchoring. Calling it here is important because
    // several Editor pages still contain an older one-shot fixed-position fail-safe.
    window.WLPBottomNavGuard?.lockAll?.();
  }

  function initStage7BottomNav(){
    document.querySelectorAll('.stage7-page-bottom-nav').forEach(handoffNav);

    // Bottom Nav Back is app-level parent navigation, not browser history.
    document.querySelectorAll('[data-stage7-parent-back], [data-stage7-history-back]').forEach((button) => {
      if (button.dataset.stage7SemanticBackBound === 'true') return;
      button.dataset.stage7SemanticBackBound = 'true';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const fallback = button.getAttribute('data-stage7-back-fallback') || './index.html';
        location.href = fallback;
      });
    });

    document.querySelectorAll('[data-stage7-back-source]').forEach((link) => {
      const selector = link.getAttribute('data-stage7-back-source');
      if (!selector) return;
      const source = document.querySelector(selector);
      if (!source) return;
      const href = source.getAttribute('href');
      if (href) link.setAttribute('href', href);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStage7BottomNav, { once:true });
  } else {
    initStage7BottomNav();
  }
  addEventListener('pageshow', initStage7BottomNav);
  addEventListener('resize', () => window.WLPBottomNavGuard?.schedule?.(), { passive:true });
  addEventListener('orientationchange', () => window.WLPBottomNavGuard?.recover?.(), { passive:true });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => window.WLPBottomNavGuard?.schedule?.(), { passive:true });
})();
