/* WLP Stage 7 v1.8.6.29 — shared Bottom Nav viewport lock + semantic Back policy. */
(() => {
  function lockNavToViewport(nav){
    if (!nav) return;
    if (nav.parentElement !== document.body) document.body.appendChild(nav);

    // Critical geometry is duplicated as inline !important styles on purpose.
    // The full visual design still lives in page-bottom-nav.css; this only makes
    // viewport anchoring resilient to stale cached CSS on installed PWAs.
    const lock = {
      position:'fixed', zIndex:'85', left:'50%', right:'auto', top:'auto', bottom:'0',
      transform:'translateX(-50%)', width:'min(100%, 760px)', maxWidth:'100vw', margin:'0'
    };
    Object.entries(lock).forEach(([key, value]) => nav.style.setProperty(
      key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), value, 'important'
    ));
    nav.dataset.stage7ViewportLocked = 'true';
  }

  function initStage7BottomNav(){
    document.querySelectorAll('.stage7-page-bottom-nav').forEach(lockNavToViewport);

    // Bottom Nav Back is app-level parent navigation, not browser history.
    // Keep the legacy data-stage7-history-back hook as a compatibility alias so
    // older cached HTML cannot reintroduce Back/parent ping-pong loops.
    document.querySelectorAll('[data-stage7-parent-back], [data-stage7-history-back]').forEach((button) => {
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
  addEventListener('resize', initStage7BottomNav, { passive:true });
  addEventListener('orientationchange', initStage7BottomNav, { passive:true });
  if (window.visualViewport) visualViewport.addEventListener('resize', initStage7BottomNav, { passive:true });
})();
