(() => {
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';

  const params = new URLSearchParams(location.search);
  const batchRaw = params.get('batch');
  const batchNum = Number(batchRaw);
  const isNormalDeck = Number.isFinite(batchNum) && batchNum > 0 && !params.get('review') && !params.get('draft');
  const isFromSearch = params.get('from') === 'search';
  const isFromConnected = params.get('from') === 'connected';
  const isSearchSolo = isFromSearch && params.get('solo') === '1';
  const isConnectedSolo = isFromConnected && params.get('solo') === '1';
  const connectedReturnRaw = String(params.get('return') || '').replace(/^\/+/, '');
  const safeConnectedReturn = connectedReturnRaw && !connectedReturnRaw.includes('..') && /^[A-Za-z0-9_./?&=%#-]+$/.test(connectedReturnRaw)
    ? connectedReturnRaw
    : '';
  const searchReturnRaw = String(params.get('searchreturn') || '').replace(/^\/+/, '');
  const safeSearchReturn = searchReturnRaw && !searchReturnRaw.includes('..') && /^[A-Za-z0-9_./?&=%#-]+$/.test(searchReturnRaw)
    ? searchReturnRaw
    : '';

  if (isFromSearch) {
    document.body.classList.add('s7-from-search');
    if (isSearchSolo) document.body.classList.add('s7-search-solo');

    const backToSearch = document.querySelector('.study-back-decks');
    if (backToSearch) {
      backToSearch.href = `../../${safeSearchReturn || 'global-search.html'}`;
      backToSearch.setAttribute('aria-label', 'Back to Search');
      const label = backToSearch.querySelector('span');
      if (label) label.textContent = 'Back to Search';
    }

    if (isSearchSolo && isNormalDeck && params.get('wordid')) {
      const context = document.querySelector('.study-context');
      const deckTitle = context?.querySelector('.study-deck-title');
      if (context && deckTitle) {
        const view = document.createElement('a');
        view.className = 'search-solo-view-deck';
        const next = new URLSearchParams();
        next.set('batch', String(batchRaw));
        next.set('wordid', String(params.get('wordid')));
        next.set('from', 'search');
        if (safeSearchReturn) next.set('searchreturn', safeSearchReturn);
        view.href = `./batch.html?${next.toString()}`;
        view.innerHTML = '<span>View in Deck</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
        context.append(view);
      }
    }
  }

  if (isFromConnected) {
    document.body.classList.add('s7-from-connected');
    if (isConnectedSolo) document.body.classList.add('s7-search-solo');

    const backToCard = document.querySelector('.study-back-decks');
    if (backToCard && safeConnectedReturn) {
      backToCard.href = `../../${safeConnectedReturn}`;
      backToCard.setAttribute('aria-label', 'Back to Card');
      const label = backToCard.querySelector('span');
      if (label) label.textContent = 'Back to Card';
    }
  }

  /* Stage 7 v3.0 — Global Search always knows how to return to the exact
     Study URL that launched it. Both the header icon and drawer entry use
     the same destination. */
  const searchLinks = Array.from(document.querySelectorAll('.global-search-link'));
  const buildSearchHref = () => {
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('s7card');
    const cards = Array.from(document.querySelectorAll('#cards .flashcard'));
    const activeIndex = cards.findIndex(card => card.classList.contains('active'));
    if (activeIndex >= 0) returnUrl.searchParams.set('s7card', String(activeIndex + 1));
    const relativeReturn = `${returnUrl.pathname.replace(/^\/+/, '')}${returnUrl.search}${returnUrl.hash}`;
    return `../../global-search.html?return=${encodeURIComponent(relativeReturn)}`;
  };
  const syncSearchLinks = () => searchLinks.forEach(link => { link.href = buildSearchHref(); });
  searchLinks.forEach(link => {
    link.addEventListener('pointerdown', syncSearchLinks);
    link.addEventListener('focus', syncSearchLinks);
    link.addEventListener('click', syncSearchLinks);
  });
  syncSearchLinks();

  /* Global Search can also open an exact browser-local Draft card. app.js
     intentionally owns Draft rendering; this only selects the requested
     rendered card after that proven rendering finishes. */
  const draftTargetLocalId = String(params.get('localid') || '').trim();
  let draftTargetPending = Boolean(params.get('draft') && draftTargetLocalId);
  const requestedStage7Card = Number(params.get('s7card'));
  const requestedStage7Side = params.get('s7side') === 'back' ? 'back' : 'front';
  let returnCardPending = Number.isInteger(requestedStage7Card) && requestedStage7Card >= 1;
  const draftTargetIndex = () => {
    if (!draftTargetPending) return -1;
    try {
      const parsed = JSON.parse(localStorage.getItem('wlp:local-additions:v1') || '[]');
      if (!Array.isArray(parsed)) return -1;
      const rows = parsed.filter(draft => draft && typeof draft === 'object' && String(draft.Word || '').trim());
      const deckNo = Math.max(1, Number(params.get('draft')) || 1);
      const deckRows = rows.slice((deckNo - 1) * 10, (deckNo - 1) * 10 + 10);
      return deckRows.findIndex(draft => String(draft.localId || '').trim() === draftTargetLocalId);
    } catch {
      return -1;
    }
  };
  const activateRenderedCard = (cards, index, side = 'front') => {
    if (index < 0 || !cards[index]) return false;
    cards.forEach(card => card.classList.remove('active'));
    const target = cards[index];
    target.classList.add('active');
    const front = target.querySelector('.front');
    const back = target.querySelector('.back');
    if (front) front.style.display = side === 'back' ? 'none' : 'block';
    if (back) back.style.display = side === 'back' ? 'block' : 'none';
    return true;
  };
  const focusRequestedCard = () => {
    if (!draftTargetPending && !returnCardPending) return;
    const cards = Array.from(document.querySelectorAll('#cards .flashcard'));
    if (!cards.length) return;
    if (draftTargetPending) {
      const index = (isSearchSolo || isConnectedSolo) ? 0 : draftTargetIndex();
      draftTargetPending = false;
      if (activateRenderedCard(cards, index)) { returnCardPending = false; return; }
    }
    if (returnCardPending) {
      activateRenderedCard(cards, requestedStage7Card - 1, requestedStage7Side);
      returnCardPending = false;
    }
  };

  const title = document.getElementById('study-deck-title');
  if (title) {
    if (isNormalDeck) title.textContent = `Deck WLP${String(batchNum).padStart(3, '0')}`;
    else if (params.get('review')) title.textContent = 'Review Deck';
    else if (params.get('draft')) title.textContent = `Draft Deck ${String(Math.max(1, Number(params.get('draft')) || 1)).padStart(3, '0')}`;
    else title.textContent = 'Study';
  }

  if (params.get('draft') && !isFromSearch) {
    const backToDrafts = document.querySelector('.study-back-decks');
    if (backToDrafts) {
      backToDrafts.href = '../../drafts.html';
      backToDrafts.setAttribute('aria-label', 'Back to Drafts');
      const label = backToDrafts.querySelector('span');
      if (label) label.textContent = 'Back to Drafts';
    }
    const footerHome = document.querySelector('.deck-home-link.deck-home-duplicate');
    if (footerHome) {
      footerHome.href = '../../drafts.html';
      footerHome.textContent = 'Back to Drafts';
    }
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
      const realAttention = root.querySelector('.back .btn-review-attention');
      const frontAttention = root.querySelector('.btn-review-attention-front');
      if (frontStudied && realStudied) {
        frontStudied.disabled = Boolean(realStudied.disabled);
        frontStudied.title = realStudied.title || 'Mark as studied';
        frontStudied.textContent = realStudied.textContent;
        frontStudied.classList.toggle('is-active', realStudied.classList.contains('is-active'));
        frontStudied.setAttribute('aria-pressed', realStudied.getAttribute('aria-pressed') || 'false');
      }
      if (frontReview && realReview) {
        frontReview.disabled = Boolean(realReview.disabled);
        frontReview.title = realReview.title || 'Mark for review';
        frontReview.textContent = realReview.textContent;
        frontReview.classList.toggle('is-active', realReview.classList.contains('is-active'));
        frontReview.setAttribute('aria-pressed', realReview.getAttribute('aria-pressed') || 'false');
      }
      if (frontAttention && realAttention) {
        frontAttention.hidden = realAttention.hidden;
        frontAttention.textContent = realAttention.textContent;
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

      const caption = row.querySelector('.study-record-caption');
      const recordBtn = practice.querySelector('.btn-record');
      const takeStateSelectors = [
        '.btn-record-stop',
        '.btn-record-mine',
        '.btn-record-save',
        '.btn-record-retake',
        '.btn-record-clear'
      ];
      const takeStateActive = takeStateSelectors.some(selector => {
        const el = practice.querySelector(selector);
        return el && !el.hidden;
      });
      const shouldHideCaption = !recordBtn || recordBtn.hidden || takeStateActive;
      if (caption && caption.hidden !== shouldHideCaption) {
        caption.hidden = shouldHideCaption;
      }
    });
  };

  const frontControl = document.getElementById('study-front-control');
  const shuffleControl = document.getElementById('study-shuffle-control');

  const activeStudyCard = () =>
    document.querySelector('.flashcard.active') || document.querySelector('.flashcard');

  const syncStudyModeToolbar = () => {
    const root = activeStudyCard();
    const back = root?.querySelector('.back');
    const backVisible = Boolean(back && getComputedStyle(back).display !== 'none');
    if (frontControl) {
      frontControl.classList.toggle('is-visible', backVisible);
      frontControl.disabled = !backVisible;
      frontControl.setAttribute('aria-hidden', backVisible ? 'false' : 'true');
    }
    if (shuffleControl) {
      shuffleControl.disabled = !root;
    }
  };

  frontControl?.addEventListener('click', () => {
    const source = activeStudyCard()?.querySelector('.study-front-source, .btn-flip-back');
    source?.click();
    queueMicrotask(queueStage7UiSync);
  });

  shuffleControl?.addEventListener('click', () => {
    const source = activeStudyCard()?.querySelector('.study-shuffle-source, .btn-shuffle');
    source?.click();
    queueMicrotask(queueStage7UiSync);
  });

  let uiSyncQueued = false;
  const queueStage7UiSync = () => {
    if (uiSyncQueued) return;
    uiSyncQueued = true;
    requestAnimationFrame(() => {
      uiSyncQueued = false;
      focusRequestedCard();
      syncStage7VoiceControls();
      syncFrontProgressProxies();
      syncRecordingLayout();
      syncStudyModeToolbar();
      syncSearchLinks();
    });
  };

  const cardsMount = document.getElementById('cards') || document.body;

  // Connected Headwords — keep this as a reversible side trip. The target
  // opens as a solo WLP card; Back returns to the exact originating card/back.
  cardsMount.addEventListener('click', event => {
    const link = event.target.closest('.syn-headword-link');
    if (!link) return;
    event.preventDefault();

    const cards = Array.from(document.querySelectorAll('#cards .flashcard'));
    const activeIndex = cards.findIndex(card => card.classList.contains('active'));
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('solo');
    returnUrl.searchParams.delete('from');
    returnUrl.searchParams.delete('return');
    returnUrl.searchParams.delete('searchreturn');
    if (activeIndex >= 0) returnUrl.searchParams.set('s7card', String(activeIndex + 1));
    returnUrl.searchParams.set('s7side', 'back');
    const relativeReturn = `${returnUrl.pathname.replace(/^\/+/, '')}${returnUrl.search}${returnUrl.hash}`;

    const next = new URLSearchParams();
    if (link.dataset.connectedKind === 'draft') {
      next.set('draft', link.dataset.connectedDraft || '1');
      next.set('localid', link.dataset.connectedLocalid || '');
    } else {
      next.set('batch', link.dataset.connectedBatch || '');
      next.set('wordid', link.dataset.connectedWordid || '');
    }
    next.set('solo', '1');
    next.set('from', 'connected');
    next.set('return', relativeReturn);
    location.href = `./batch.html?${next.toString()}`;
  });

  // Stage 7 v1.5.4 — Selection → Search WLP.
  // Selecting readable answer text offers a small contextual search action.
  // It deliberately reuses Global Search, so an absent exact headword can
  // continue into the existing Admin “Add as Draft” path.
  const selectionSearch = document.getElementById('selection-wlp-search');
  let selectionSearchText = '';
  const cleanSelectionText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const hideSelectionSearch = () => {
    if (!selectionSearch) return;
    selectionSearch.hidden = true;
    selectionSearchText = '';
  };
  const selectionIsOnReadableBack = range => {
    const node = range?.commonAncestorContainer;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const back = element?.closest?.('.flashcard.active .back .study-back-card');
    if (!back) return false;
    // Native/control selections should keep their normal behavior.
    if (element.closest('button,a,input,textarea,select,[contenteditable="true"]')) return false;
    return Boolean(element.closest('.def,.ex,.syn,.note,.back-answer'));
  };
  const syncSelectionSearch = () => {
    if (!selectionSearch) return;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return hideSelectionSearch();
    const text = cleanSelectionText(selection.toString());
    if (!text || text.length > 160) return hideSelectionSearch();
    const range = selection.getRangeAt(0);
    if (!selectionIsOnReadableBack(range)) return hideSelectionSearch();
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hideSelectionSearch();

    selectionSearchText = text;
    selectionSearch.hidden = false;
    const width = selectionSearch.offsetWidth || 104;
    const height = selectionSearch.offsetHeight || 34;
    const margin = 8;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.left + rect.width / 2 - width / 2));
    let top = rect.bottom + 10;
    if (top + height + margin > window.innerHeight) top = Math.max(margin, rect.top - height - 10);
    selectionSearch.style.left = `${Math.round(left)}px`;
    selectionSearch.style.top = `${Math.round(top)}px`;
  };
  document.addEventListener('selectionchange', () => {
    clearTimeout(window.__wlpSelectionSearchTimer);
    window.__wlpSelectionSearchTimer = setTimeout(syncSelectionSearch, 90);
  });
  document.addEventListener('touchend', () => setTimeout(syncSelectionSearch, 120), {passive:true});
  document.addEventListener('mouseup', () => setTimeout(syncSelectionSearch, 0));
  window.addEventListener('scroll', hideSelectionSearch, {passive:true});
  window.addEventListener('resize', hideSelectionSearch);
  selectionSearch?.addEventListener('pointerdown', event => event.preventDefault());
  selectionSearch?.addEventListener('click', event => {
    event.preventDefault();
    const query = selectionSearchText;
    if (!query) return;
    const cards = Array.from(document.querySelectorAll('#cards .flashcard'));
    const activeIndex = cards.findIndex(card => card.classList.contains('active'));
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('return');
    returnUrl.searchParams.delete('searchreturn');
    if (activeIndex >= 0) returnUrl.searchParams.set('s7card', String(activeIndex + 1));
    returnUrl.searchParams.set('s7side', 'back');
    const relativeReturn = `${returnUrl.pathname.replace(/^\/+/, '')}${returnUrl.search}${returnUrl.hash}`;
    const next = new URLSearchParams();
    next.set('q', query);
    next.set('return', relativeReturn);
    location.href = `../../global-search.html?${next.toString()}`;
  });

  cardsMount.addEventListener('click', event => {
    const backVoice = event.target.closest('.back .btn-voice');
    if (backVoice) {
      const card = backVoice.closest('.flashcard');
      const frontVoice = card?.querySelector('.front .btn-voice');
      if (frontVoice && frontVoice !== backVoice) {
        event.preventDefault();
        event.stopPropagation();
        frontVoice.click();
        queueMicrotask(queueStage7UiSync);
      }
      return;
    }

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
      return;
    }

    const attentionProxy = event.target.closest('.btn-review-attention-front');
    if (attentionProxy) {
      const real = attentionProxy.closest('.flashcard')?.querySelector('.back .btn-review-attention');
      if (real && !real.hidden) real.click();
    }
  });

  const uiObserver = new MutationObserver(queueStage7UiSync);
  uiObserver.observe(cardsMount, {
    childList:true,
    subtree:true,
    characterData:true,
    attributes:true,
    attributeFilter:['hidden','disabled','style','class']
  });
  queueStage7UiSync();

})();
