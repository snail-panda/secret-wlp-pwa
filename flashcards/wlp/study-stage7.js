(() => {
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';

  const params = new URLSearchParams(location.search);
  const batchRaw = params.get('batch');
  const batchNum = Number(batchRaw);
  const isNormalDeck = Number.isFinite(batchNum) && batchNum > 0 && !params.get('review') && !params.get('draft');

  const title = document.getElementById('study-deck-title');
  if (title) {
    if (isNormalDeck) title.textContent = `Deck WLP${String(batchNum).padStart(3, '0')}`;
    else if (params.get('review')) title.textContent = 'Review Deck';
    else if (params.get('draft')) title.textContent = 'Draft Study';
    else title.textContent = 'Study';
  }

  if (isNormalDeck) {
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
    recent = Array.isArray(recent) ? recent.filter(Number.isFinite) : [];
    recent = [batchNum, ...recent.filter(n => n !== batchNum)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  }

  const menu = document.getElementById('menu-button');
  const drawer = document.getElementById('app-drawer');
  const close = document.getElementById('drawer-close');
  const backdrop = document.getElementById('drawer-backdrop');
  const rolePill = document.getElementById('role-pill');
  const roleLabel = document.getElementById('role-label');
  const roleMenu = document.getElementById('role-menu');
  const roleMenuTitle = document.getElementById('role-menu-title');
  const roleMenuCopy = document.getElementById('role-menu-copy');
  const roleMenuAction = document.getElementById('role-menu-action');
  const drawerRoleAction = document.getElementById('drawer-role-action');
  const drawerAdminOnly = Array.from(document.querySelectorAll('.drawer-admin-only'));
  const adminGate = document.getElementById('admin-gate');
  const adminForm = document.getElementById('admin-form');
  const adminPassword = document.getElementById('admin-password');
  const adminPasswordToggle = document.getElementById('admin-password-toggle');
  const rememberAdmin = document.getElementById('remember-admin');
  const adminError = document.getElementById('admin-error');
  const toast = document.getElementById('study-toast');

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
    clearTimeout(window.__wlpStudyToastTimer);
    window.__wlpStudyToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };

  document.getElementById('drawer-settings')?.addEventListener('click', () => {
    setDrawer(false);
    showToast('Study options will move here in a later Stage 7 pass.');
  });
  document.querySelectorAll('.drawer-placeholder').forEach(btn => {
    btn.addEventListener('click', () => {
      setDrawer(false);
      showToast(btn.dataset.placeholder || 'Coming soon.');
    });
  });

  const getRole = () => (
    localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' ||
    sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin'
  ) ? 'admin' : 'guest';

  const setAdmin = remember => {
    if (remember) {
      localStorage.setItem(WLP_UI_ROLE_KEY, 'admin');
      sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
    } else {
      localStorage.removeItem(WLP_UI_ROLE_KEY);
      sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY, 'admin');
    }
  };
  const clearAdmin = () => {
    localStorage.removeItem(WLP_UI_ROLE_KEY);
    sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
  };

  const refreshRoleUI = () => {
    const admin = getRole() === 'admin';
    if (roleLabel) roleLabel.textContent = admin ? 'Admin' : 'Guest';
    rolePill?.classList.toggle('is-admin', admin);
    if (roleMenuTitle) roleMenuTitle.textContent = admin ? 'Admin mode' : 'Guest mode';
    if (roleMenuCopy) roleMenuCopy.textContent = admin
      ? 'Editing tools are unlocked. Switch modes to refresh card editing controls.'
      : 'Study normally without editing tools.';
    if (roleMenuAction) roleMenuAction.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    const drawerLabel = drawerRoleAction?.querySelector('.drawer-role-label');
    if (drawerLabel) drawerLabel.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    drawerAdminOnly.forEach(item => { item.hidden = !admin; });
  };

  const closeRoleMenu = () => {
    if (!roleMenu) return;
    roleMenu.hidden = true;
    rolePill?.setAttribute('aria-expanded', 'false');
  };
  rolePill?.addEventListener('click', e => {
    e.stopPropagation();
    if (!roleMenu) return;
    const open = roleMenu.hidden;
    roleMenu.hidden = !open;
    rolePill.setAttribute('aria-expanded', String(open));
  });
  roleMenu?.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', closeRoleMenu);

  const setPasswordVisible = visible => {
    if (!adminPassword) return;
    adminPassword.type = visible ? 'text' : 'password';
    adminPasswordToggle?.setAttribute('aria-pressed', String(visible));
    adminPasswordToggle?.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    adminPasswordToggle?.setAttribute('title', visible ? 'Hide password' : 'Show password');
  };
  adminPasswordToggle?.addEventListener('click', () => {
    const visible = adminPassword?.type === 'text';
    setPasswordVisible(!visible);
    adminPassword?.focus({ preventScroll: true });
  });

  const openAdminGate = () => {
    closeRoleMenu();
    setDrawer(false);
    if (adminError) adminError.hidden = true;
    if (adminPassword) adminPassword.value = '';
    setPasswordVisible(false);
    if (rememberAdmin) rememberAdmin.checked = false;
    if (adminGate) adminGate.hidden = false;
    setTimeout(() => adminPassword?.focus(), 0);
  };
  const closeAdminGate = () => {
    if (adminGate) adminGate.hidden = true;
    if (adminError) adminError.hidden = true;
    if (adminPassword) adminPassword.value = '';
    setPasswordVisible(false);
  };

  const reloadWithNotice = text => {
    sessionStorage.setItem('wlp:stage7:study-notice:v1', text);
    location.reload();
  };

  const roleAction = () => {
    if (getRole() === 'admin') {
      clearAdmin();
      reloadWithNotice('Switched to Guest mode.');
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
    const hash = await sha256Hex(adminPassword?.value || '');
    if (hash !== WLP_ADMIN_PASSWORD_SHA256) {
      if (adminError) adminError.hidden = false;
      adminPassword?.select();
      return;
    }
    setAdmin(Boolean(rememberAdmin?.checked));
    reloadWithNotice('Admin mode unlocked.');
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    setDrawer(false);
    closeRoleMenu();
    closeAdminGate();
  });

  refreshRoleUI();
  const notice = sessionStorage.getItem('wlp:stage7:study-notice:v1');
  if (notice) {
    sessionStorage.removeItem('wlp:stage7:study-notice:v1');
    setTimeout(() => showToast(notice), 80);
  }


  /* Stage 7 v2.5 — present the actual current voice as the selector label
     without changing app.js voice selection/cycling behavior. */
  const compactVoiceLabel = raw => {
    const value = String(raw || '').trim();
    if (!value || /^default voice$/i.test(value)) return 'Default';
    const match = value.match(/^(.*?)\s*·\s*([A-Za-z]{2})[-_]([A-Za-z]{2})$/);
    if (!match) return value;
    const name = match[1].trim();
    const region = match[3].toUpperCase();
    const regionLabel = ({ GB:'UK', US:'US', AU:'AU', CA:'CA', IE:'IE', NZ:'NZ', IN:'IN', ZA:'ZA' })[region] || region;
    return `${name} · ${regionLabel}`;
  };

  const syncStage7VoiceControls = () => {
    document.querySelectorAll('.voice-control').forEach(control => {
      const btn = control.querySelector('.btn-voice');
      const detail = control.querySelector('.voice-detail');
      if (!btn || !detail) return;
      const compact = compactVoiceLabel(detail.textContent);
      const desired = `‹ ${compact} ›`;
      if (btn.textContent !== desired) btn.textContent = desired;
      btn.setAttribute('aria-label', `Voice: ${compact}. Tap to switch voice.`);
    });
  };

  /* Front-side Studied / Review controls are visual proxies. app.js still
     owns the real progress actions on the answer side, so progress behavior
     and storage remain unchanged. */
  const syncFrontProgressProxies = () => {
    document.querySelectorAll('.flashcard').forEach(root => {
      const realStudied = root.querySelector('.back .btn-studied');
      const realReview = root.querySelector('.back .btn-review');
      const frontStudied = root.querySelector('.btn-studied-front');
      const frontReview = root.querySelector('.btn-review-front');
      if (frontStudied && realStudied) {
        frontStudied.disabled = Boolean(realStudied.disabled);
        frontStudied.title = realStudied.title || 'Mark as studied';
      }
      if (frontReview && realReview) {
        frontReview.disabled = Boolean(realReview.disabled);
        frontReview.title = realReview.title || 'Mark for review';
      }
    });
  };

  const syncRecordingLayout = () => {
    document.querySelectorAll('.study-learning-practice').forEach(row => {
      const practice = row.querySelector('.record-practice');
      if (!practice) return;
      const visibleButtons = Array.from(practice.querySelectorAll('button'))
        .filter(button => !button.hidden);
      row.classList.toggle('is-record-expanded', visibleButtons.length > 1);
    });
  };

  let uiSyncQueued = false;
  const queueStage7UiSync = () => {
    if (uiSyncQueued) return;
    uiSyncQueued = true;
    requestAnimationFrame(() => {
      uiSyncQueued = false;
      syncStage7VoiceControls();
      syncFrontProgressProxies();
      syncRecordingLayout();
    });
  };

  const cardsMount = document.getElementById('cards') || document.body;
  cardsMount.addEventListener('click', event => {
    const studiedProxy = event.target.closest('.btn-studied-front');
    if (studiedProxy) {
      const real = studiedProxy.closest('.flashcard')?.querySelector('.back .btn-studied');
      if (real && !real.disabled) real.click();
      return;
    }
    const reviewProxy = event.target.closest('.btn-review-front');
    if (reviewProxy) {
      const real = reviewProxy.closest('.flashcard')?.querySelector('.back .btn-review');
      if (real && !real.disabled) real.click();
    }
  });

  const uiObserver = new MutationObserver(queueStage7UiSync);
  uiObserver.observe(cardsMount, {
    childList:true,
    subtree:true,
    characterData:true,
    attributes:true,
    attributeFilter:['hidden','disabled']
  });
  queueStage7UiSync();

})();
