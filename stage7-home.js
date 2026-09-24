(() => {
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  // Same UI-level admin gate used by the existing WLP home.
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';

  const menu = document.getElementById('menu-button');
  const drawer = document.getElementById('app-drawer');
  const close = document.getElementById('drawer-close');
  const backdrop = document.getElementById('drawer-backdrop');
  const toast = document.getElementById('home-toast');
  const rolePill = document.getElementById('role-pill');
  const roleLabel = document.getElementById('role-label');
  const roleMenu = document.getElementById('role-menu');
  const roleMenuTitle = document.getElementById('role-menu-title');
  const roleMenuCopy = document.getElementById('role-menu-copy');
  const roleMenuAction = document.getElementById('role-menu-action');
  const drawerRoleAction = document.getElementById('drawer-role-action');
  const drawerSettings = document.getElementById('drawer-settings');
  const drawerAdminOnly = Array.from(document.querySelectorAll('.drawer-admin-only'));
  const homeEditorCard = document.getElementById('home-editor-card');
  const adminGate = document.getElementById('admin-gate');
  const adminForm = document.getElementById('admin-form');
  const adminPassword = document.getElementById('admin-password');
  const adminPasswordToggle = document.getElementById('admin-password-toggle');
  const rememberAdmin = document.getElementById('remember-admin');
  const adminError = document.getElementById('admin-error');

  const setDrawer = open => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menu.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
  };
  menu?.addEventListener('click', () => setDrawer(true));
  close?.addEventListener('click', () => setDrawer(false));
  backdrop?.addEventListener('click', () => setDrawer(false));

  const showToast = text => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(window.__wlpToastTimer);
    window.__wlpToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };

  document.getElementById('search-launch')?.addEventListener('click', () => {
    location.href = './global-search.html';
  });
  if (drawerSettings instanceof HTMLButtonElement) {
    drawerSettings.addEventListener('click', () => {
      setDrawer(false);
      showToast('Settings will move into the Stage 7 app shell.');
    });
  }

  const getRole = () => (
    localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' ||
    sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin'
  ) ? 'admin' : 'guest';

  const clearAdmin = () => {
    localStorage.removeItem(WLP_UI_ROLE_KEY);
    sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
  };

  const setAdmin = remember => {
    if (remember) {
      localStorage.setItem(WLP_UI_ROLE_KEY, 'admin');
      sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
    } else {
      localStorage.removeItem(WLP_UI_ROLE_KEY);
      sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY, 'admin');
    }
  };

  const refreshRoleUI = () => {
    const admin = getRole() === 'admin';
    roleLabel.textContent = admin ? 'Admin' : 'Guest';
    rolePill?.classList.toggle('is-admin', admin);
    roleMenuTitle.textContent = admin ? 'Admin mode' : 'Guest mode';
    roleMenuCopy.textContent = admin
      ? 'Editing and import/export tools are unlocked.'
      : 'Study normally without editing tools.';
    roleMenuAction.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    const drawerLabel = drawerRoleAction?.querySelector('.drawer-role-label');
    if (drawerLabel) drawerLabel.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    drawerAdminOnly.forEach(item => { item.hidden = !admin; });
    if (homeEditorCard) homeEditorCard.hidden = !admin;
  };

  const closeRoleMenu = () => {
    roleMenu.hidden = true;
    rolePill?.setAttribute('aria-expanded', 'false');
  };

  const toggleRoleMenu = () => {
    const open = roleMenu.hidden;
    roleMenu.hidden = !open;
    rolePill?.setAttribute('aria-expanded', String(open));
  };
  rolePill?.addEventListener('click', e => { e.stopPropagation(); toggleRoleMenu(); });
  roleMenu?.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', closeRoleMenu);

  const setPasswordVisible = visible => {
    adminPassword.type = visible ? 'text' : 'password';
    adminPasswordToggle?.setAttribute('aria-pressed', String(visible));
    adminPasswordToggle?.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    adminPasswordToggle?.setAttribute('title', visible ? 'Hide password' : 'Show password');
  };
  adminPasswordToggle?.addEventListener('click', () => {
    const visible = adminPassword.type === 'text';
    setPasswordVisible(!visible);
    adminPassword.focus({ preventScroll: true });
  });

  const openAdminGate = () => {
    closeRoleMenu();
    setDrawer(false);
    adminError.hidden = true;
    adminPassword.value = '';
    setPasswordVisible(false);
    rememberAdmin.checked = false;
    adminGate.hidden = false;
    setTimeout(() => adminPassword.focus(), 0);
  };
  const closeAdminGate = () => {
    adminGate.hidden = true;
    adminError.hidden = true;
    adminPassword.value = '';
    setPasswordVisible(false);
  };

  const roleAction = () => {
    if (getRole() === 'admin') {
      clearAdmin();
      refreshRoleUI();
      closeRoleMenu();
      setDrawer(false);
      showToast('Switched to Guest mode.');
    } else {
      openAdminGate();
    }
  };
  roleMenuAction?.addEventListener('click', roleAction);
  drawerRoleAction?.addEventListener('click', roleAction);
  document.getElementById('admin-close')?.addEventListener('click', closeAdminGate);
  document.getElementById('admin-cancel')?.addEventListener('click', closeAdminGate);
  adminGate?.addEventListener('click', e => { if (e.target === adminGate) closeAdminGate(); });

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  adminForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const hash = await sha256Hex(adminPassword.value);
    if (hash !== WLP_ADMIN_PASSWORD_SHA256) {
      adminError.hidden = false;
      adminPassword.select();
      return;
    }
    setAdmin(rememberAdmin.checked);
    refreshRoleUI();
    closeAdminGate();
    showToast('Admin mode unlocked.');
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    setDrawer(false);
    closeRoleMenu();
    closeAdminGate();
  });

  refreshRoleUI();

  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  recent = Array.isArray(recent) ? recent.filter(Number.isFinite) : [];

  if (recent.length) {
    const latest = recent[0];
    const pad = String(latest).padStart(3, '0');
    const card = document.getElementById('continue-card');
    document.getElementById('continue-title').textContent = `Deck WLP${pad}`;
    document.getElementById('continue-link').href = `./flashcards/wlp/batch.html?batch=${pad}`;
    card.dataset.href = `./flashcards/wlp/batch.html?batch=${pad}`;
    card.hidden = false;

    const openContinue = () => {
      if (card.dataset.href) location.href = card.dataset.href;
    };
    card.addEventListener('click', event => {
      if (event.target.closest('a,button')) return;
      openContinue();
    });
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openContinue();
    });
  }

  const list = document.getElementById('recent-home-list');
  if (list && recent.length) {
    list.innerHTML = '';
    recent.slice(0, 3).forEach((deck, i) => {
      const pad = String(deck).padStart(3, '0');
      const a = document.createElement('a');
      a.className = 'recent-row';
      a.href = `./flashcards/wlp/batch.html?batch=${pad}`;
      a.innerHTML = `<span class="deck-no">#WLP${pad}</span><small>${i === 0 ? 'Most recent' : 'Recent deck'}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;
      list.appendChild(a);
    });
  }
})();
