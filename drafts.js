(() => {
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const $ = id => document.getElementById(id);

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));
  const pad3 = n => String(n).padStart(3, '0');

  function readDrafts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(draft => draft && typeof draft === 'object' && String(draft.Word || '').trim());
    } catch (error) {
      console.warn('Could not read WLP local drafts:', error);
      return [];
    }
  }

  function countLocalOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
      return Object.values(parsed).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length;
    } catch (error) {
      console.warn('Could not read WLP local overrides:', error);
      return 0;
    }
  }

  function renderDrafts() {
    const drafts = readDrafts();
    const deckCount = Math.ceil(drafts.length / 10);
    const count = $('drafts-count');
    const meta = $('drafts-meta');
    const list = $('draft-deck-list');
    const empty = $('drafts-empty');
    const localEdits = countLocalOverrides();
    const localEditsRow = $('drafts-local-edits');
    const localEditsCount = $('drafts-local-edits-count');

    if (localEditsRow) localEditsRow.hidden = localEdits < 1;
    if (localEditsCount) localEditsCount.textContent = `${localEdits} Local Edit${localEdits === 1 ? '' : 's'}`;

    if (count) count.textContent = `${drafts.length} draft${drafts.length === 1 ? '' : 's'}`;
    if (meta) {
      meta.textContent = drafts.length
        ? `${drafts.length} local draft${drafts.length === 1 ? '' : 's'} · ${deckCount} Draft Deck${deckCount === 1 ? '' : 's'}`
        : 'Your saved draft cards will appear here';
    }
    if (!list || !empty) return;

    if (!drafts.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    const cards = [];
    for (let i = 0; i < drafts.length; i += 10) {
      const deckNo = Math.floor(i / 10) + 1;
      const slice = drafts.slice(i, i + 10);
      const words = slice.map(draft => String(draft.Word || '').trim()).filter(Boolean);
      cards.push(`
        <a class="draft-deck-card" href="./flashcards/wlp/batch.html?draft=${deckNo}&from=drafts" aria-label="Open Draft Deck ${pad3(deckNo)}">
          <span class="draft-deck-title">Draft Deck ${pad3(deckNo)}</span>
          <span class="draft-deck-meta">${slice.length} card${slice.length === 1 ? '' : 's'}</span>
          <span class="draft-deck-words">${escapeHtml(words.join(' · '))}</span>
          <svg class="draft-deck-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
        </a>
      `);
    }
    list.innerHTML = cards.join('');
  }

  const getRole = () => (
    localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' ||
    sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin'
  ) ? 'admin' : 'guest';

  const rolePill = $('role-pill');
  const roleLabel = $('role-label');
  const roleMenu = $('role-menu');
  const roleMenuTitle = $('role-menu-title');
  const roleMenuCopy = $('role-menu-copy');
  const roleMenuAction = $('role-menu-action');
  const drawerRoleAction = $('drawer-role-action');
  const drawerAdminOnly = Array.from(document.querySelectorAll('.drawer-admin-only'));
  const adminGate = $('admin-gate');
  const adminForm = $('admin-form');
  const adminPassword = $('admin-password');
  const adminPasswordToggle = $('admin-password-toggle');
  const rememberAdmin = $('remember-admin');
  const adminError = $('admin-error');
  const toast = $('drafts-toast');

  const setAdmin = remember => {
    if (remember) {
      localStorage.setItem(WLP_UI_ROLE_KEY, 'admin');
      sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
    } else {
      sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY, 'admin');
      localStorage.removeItem(WLP_UI_ROLE_KEY);
    }
  };

  function syncRoleUi() {
    const admin = getRole() === 'admin';
    if (roleLabel) roleLabel.textContent = admin ? 'Admin' : 'Guest';
    rolePill?.classList.toggle('is-admin', admin);
    if (roleMenuTitle) roleMenuTitle.textContent = admin ? 'Admin mode' : 'Guest mode';
    if (roleMenuCopy) roleMenuCopy.textContent = admin
      ? 'Editing and import/export tools are unlocked.'
      : 'Study normally without editing tools.';
    if (roleMenuAction) roleMenuAction.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    const drawerLabel = drawerRoleAction?.querySelector('.drawer-role-label');
    if (drawerLabel) drawerLabel.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    drawerAdminOnly.forEach(item => { item.hidden = !admin; });
  }

  function closeRoleMenu() {
    if (!roleMenu || !rolePill) return;
    roleMenu.hidden = true;
    rolePill.setAttribute('aria-expanded', 'false');
  }

  function toggleRoleMenu() {
    if (!roleMenu || !rolePill) return;
    const open = roleMenu.hidden;
    roleMenu.hidden = !open;
    rolePill.setAttribute('aria-expanded', String(open));
  }

  rolePill?.addEventListener('click', event => { event.stopPropagation(); toggleRoleMenu(); });
  roleMenu?.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', closeRoleMenu);

  const updatePasswordToggle = () => {
    if (!adminPassword || !adminPasswordToggle) return;
    const visible = adminPassword.type === 'text';
    adminPasswordToggle.setAttribute('aria-pressed', String(visible));
    adminPasswordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    adminPasswordToggle.setAttribute('title', visible ? 'Hide password' : 'Show password');
  };
  adminPasswordToggle?.addEventListener('click', () => {
    if (!adminPassword) return;
    adminPassword.type = adminPassword.type === 'text' ? 'password' : 'text';
    updatePasswordToggle();
    adminPassword.focus({preventScroll:true});
  });

  function openAdminGate() {
    closeRoleMenu();
    if (!adminGate) return;
    if (adminError) adminError.hidden = true;
    if (adminPassword) { adminPassword.value = ''; adminPassword.type = 'password'; }
    updatePasswordToggle();
    adminGate.hidden = false;
    setTimeout(() => adminPassword?.focus(), 0);
  }

  function closeAdminGate() {
    if (!adminGate) return;
    adminGate.hidden = true;
    if (adminError) adminError.hidden = true;
    if (adminPassword) adminPassword.value = '';
  }

  const roleAction = () => {
    if (getRole() === 'admin') {
      localStorage.removeItem(WLP_UI_ROLE_KEY);
      sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
      syncRoleUi();
      closeRoleMenu();
      return;
    }
    openAdminGate();
  };

  roleMenuAction?.addEventListener('click', roleAction);
  drawerRoleAction?.addEventListener('click', roleAction);
  $('admin-close')?.addEventListener('click', closeAdminGate);
  $('admin-cancel')?.addEventListener('click', closeAdminGate);
  adminGate?.addEventListener('click', event => { if (event.target === adminGate) closeAdminGate(); });

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  adminForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminPassword) return;
    const hash = await sha256Hex(adminPassword.value);
    if (hash !== WLP_ADMIN_PASSWORD_SHA256) {
      if (adminError) adminError.hidden = false;
      adminPassword.select();
      return;
    }
    setAdmin(Boolean(rememberAdmin?.checked));
    closeAdminGate();
    syncRoleUi();
  });

  const menu = $('menu-button');
  const drawer = $('app-drawer');
  const close = $('drawer-close');
  const backdrop = $('drawer-backdrop');
  const setDrawer = open => {
    if (!drawer || !menu || !backdrop) return;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menu.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
  };
  menu?.addEventListener('click', () => setDrawer(true));
  close?.addEventListener('click', () => setDrawer(false));
  backdrop?.addEventListener('click', () => setDrawer(false));

  const showToast = text => {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(window.__wlpDraftsToastTimer);
    window.__wlpDraftsToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };
  $('drawer-settings')?.addEventListener('click', () => {
    setDrawer(false);
    showToast('Settings will move here in a later Stage 7 pass.');
  });
  document.querySelectorAll('.drawer-placeholder').forEach(button => {
    button.addEventListener('click', () => {
      setDrawer(false);
      showToast(button.dataset.placeholder || 'Coming soon.');
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === LOCAL_ADDITIONS_KEY || event.key === LOCAL_OVERRIDES_KEY) renderDrafts();
    if (event.key === WLP_UI_ROLE_KEY) syncRoleUi();
  });
  window.addEventListener('pageshow', () => { renderDrafts(); syncRoleUi(); });
  window.addEventListener('focus', renderDrafts);

  renderDrafts();
  syncRoleUi();
})();
