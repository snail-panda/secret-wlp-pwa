(() => {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const isAdmin = () => (
    localStorage.getItem('wlp:ui-role:v2') === 'admin' ||
    sessionStorage.getItem('wlp:session-admin:v1') === 'admin'
  );

  const injectBackupRestore = () => {
    const drawer = document.querySelector('.app-drawer .drawer-nav');
    if (!drawer || drawer.querySelector('.stage7-backup-restore-item')) return;

    const editorLink = Array.from(drawer.querySelectorAll(':scope > a.drawer-item'))
      .find(link => /(?:^|\/)editor\.html(?:[?#].*)?$/.test(link.getAttribute('href') || ''));
    if (!editorLink) return;

    const item = document.createElement('a');
    item.className = 'drawer-item drawer-admin-only stage7-backup-restore-item';
    item.href = './editor-backup.html';
    item.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v9M8.5 8.5 12 12l3.5-3.5"></path>
        <path d="M5 13.5V20h14v-6.5"></path>
        <path d="M7 16.5h10"></path>
      </svg>
      <span class="drawer-item-copy">
        <span class="drawer-item-title">Backup &amp; Restore</span>
        <small><span>Back up local WLP data</span><span>Restore from a saved backup</span></small>
      </span>`;

    item.hidden = editorLink.hidden || !isAdmin();
    editorLink.insertAdjacentElement('afterend', item);

    // Existing page scripts cache their admin-only node list before this item is
    // injected. Mirror the existing Editor item's visibility so role changes stay in sync.
    const observer = new MutationObserver(() => {
      item.hidden = editorLink.hidden || !isAdmin();
    });
    observer.observe(editorLink, { attributes: true, attributeFilter: ['hidden'] });
  };

  const bottomNavPages = new Set([
    'deck-browser.html',
    'global-search.html',
    'drafts.html',
    'editor.html',
    'editor-new-card.html',
    'editor-drafts.html',
    'editor-draft-edit.html',
    'editor-local-edits.html',
    'editor-local-edit.html',
    'editor-backup.html'
  ]);

  const fallbackBackTarget = () => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('return');
    if (requested) {
      try {
        const target = new URL(requested, location.href);
        if (target.origin === location.origin) return target.href;
      } catch (_) {}
    }

    const fallback = {
      'deck-browser.html': './index.html',
      'global-search.html': './index.html',
      'drafts.html': './index.html',
      'editor.html': './index.html',
      'editor-new-card.html': './editor.html',
      'editor-drafts.html': './editor.html',
      'editor-draft-edit.html': './editor-drafts.html',
      'editor-local-edits.html': './editor.html',
      'editor-local-edit.html': './editor-local-edits.html',
      'editor-backup.html': './editor.html'
    }[page] || './index.html';
    return new URL(fallback, location.href).href;
  };

  const goBackSafely = () => {
    let sameOriginReferrer = false;
    if (document.referrer) {
      try { sameOriginReferrer = new URL(document.referrer).origin === location.origin; }
      catch (_) {}
    }
    if (sameOriginReferrer && history.length > 1) {
      history.back();
      return;
    }
    location.href = fallbackBackTarget();
  };

  const injectBottomNav = () => {
    if (!bottomNavPages.has(page) || document.querySelector('.stage7-global-bottom-nav')) return;

    const nav = document.createElement('nav');
    nav.className = 'stage7-global-bottom-nav';
    nav.setAttribute('aria-label', 'Page navigation');
    nav.innerHTML = `
      <button type="button" class="stage7-shell-nav-item stage7-shell-back" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"></path></svg>
        <span>Back</span>
      </button>
      <a class="stage7-shell-nav-item stage7-shell-home" href="./index.html" aria-label="Home">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7v9H5v-9"></path><path d="M9 20v-6h6v6"></path></svg>
        <span>Home</span>
      </a>`;
    document.body.appendChild(nav);
    document.body.classList.add('stage7-shell-bottom-nav-active');
    nav.querySelector('.stage7-shell-back')?.addEventListener('click', goBackSafely);
  };

  const init = () => {
    injectBackupRestore();
    injectBottomNav();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
