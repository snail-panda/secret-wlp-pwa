/* WLP Stage 7 — shared Bottom Nav behavior. */
(() => {
  function initStage7BottomNav(){
    // Keep fixed navigation anchored to the actual viewport on iOS Safari.
    // This mirrors the approved Study Card / Choose a Deck implementation.
    document.querySelectorAll('.stage7-page-bottom-nav').forEach((nav) => {
      if (nav.parentElement !== document.body) document.body.appendChild(nav);
    });

    document.querySelectorAll('[data-stage7-history-back]').forEach((button) => {
      button.addEventListener('click', () => {
        const fallback = button.getAttribute('data-stage7-back-fallback') || './index.html';
        let sameOriginReferrer = false;
        try {
          sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === location.origin;
        } catch (_) {}
        if (sameOriginReferrer) history.back();
        else location.href = fallback;
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
})();
