(() => {
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const $ = id => document.getElementById(id);

  function readDraftCount() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && String(v.Word || '').trim()).length : 0;
    } catch { return 0; }
  }
  function readLocalEditCount() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
      return Object.values(value).filter(v => v && typeof v === 'object' && !Array.isArray(v)).length;
    } catch { return 0; }
  }
  function renderCounts() {
    const drafts = readDraftCount();
    const edits = readLocalEditCount();
    if ($('editor-draft-count')) $('editor-draft-count').textContent = String(drafts);
    if ($('editor-local-edit-count')) $('editor-local-edit-count').textContent = String(edits);
    if ($('editor-count-pill')) $('editor-count-pill').textContent = `${drafts} Draft${drafts === 1 ? '' : 's'} · ${edits} Local Edit${edits === 1 ? '' : 's'}`;
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
  const workspace = $('editor-workspace');
  const locked = $('editor-locked');
  const toast = $('editor-toast');

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
    if (workspace) workspace.hidden = !admin;
    if (locked) locked.hidden = admin;
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
  $('editor-login-button')?.addEventListener('click', openAdminGate);
  $('admin-close')?.addEventListener('click', closeAdminGate);
  $('admin-cancel')?.addEventListener('click', closeAdminGate);
  adminGate?.addEventListener('click', event => { if (event.target === adminGate) closeAdminGate(); });

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
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
    renderCounts();
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
    clearTimeout(window.__wlpEditorToastTimer);
    window.__wlpEditorToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };
  $('drawer-settings')?.addEventListener('click', () => { setDrawer(false); showToast('Settings will move here in a later Stage 7 pass.'); });
  document.querySelectorAll('.drawer-placeholder').forEach(button => button.addEventListener('click', () => { setDrawer(false); showToast(button.dataset.placeholder || 'Coming soon.'); }));

  function scrollToHash() {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (!hash || !['create','drafts','local-edits','backup'].includes(hash)) return;
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  window.addEventListener('hashchange', scrollToHash);
  window.addEventListener('storage', event => {
    if ([LOCAL_ADDITIONS_KEY, LOCAL_OVERRIDES_KEY].includes(event.key)) renderCounts();
    if (event.key === WLP_UI_ROLE_KEY) syncRoleUi();
  });
  window.addEventListener('pageshow', () => { renderCounts(); syncRoleUi(); scrollToHash(); });
  window.addEventListener('focus', renderCounts);


  // Stage 7 Editor — standalone New Card form.
  const NEW_CARD_FIELDS = [
    'Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'
  ];
  function makeLocalDraftId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`;
    return `local-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  }
  function readLocalDrafts() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    } catch { return []; }
  }
  function saveNewCardDraft(form) {
    const data = new FormData(form);
    const word = String(data.get('Word') || '').trim();
    if (!word) {
      $('new-card-word')?.focus();
      return false;
    }
    const now = new Date().toISOString();
    const draft = { localId: makeLocalDraftId(), createdAt: now, updatedAt: now };
    NEW_CARD_FIELDS.forEach(field => { draft[field] = String(data.get(field) || '').trim(); });
    const drafts = readLocalDrafts();
    drafts.push(draft);
    localStorage.setItem(LOCAL_ADDITIONS_KEY, JSON.stringify(drafts, null, 2));
    return draft;
  }
  const newCardForm = $('new-card-form');
  newCardForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (getRole() !== 'admin') { openAdminGate(); return; }
    const draft = saveNewCardDraft(newCardForm);
    if (!draft) return;
    newCardForm.reset();
    renderCounts();
    const success = $('new-card-success');
    const title = $('new-card-success-title');
    const copy = $('new-card-success-copy');
    if (title) title.textContent = `Saved “${draft.Word}”`;
    if (copy) copy.textContent = `Draft saved locally · ${readDraftCount()} Draft${readDraftCount() === 1 ? '' : 's'} total.`;
    if (success) success.hidden = false;
    showToast('Draft saved.');
    requestAnimationFrame(() => $('new-card-word')?.focus());
  });
  newCardForm?.addEventListener('reset', () => {
    const success = $('new-card-success');
    if (success) success.hidden = true;
  });

  renderCounts();
  syncRoleUi();
  scrollToHash();
})();
