(() => {
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260914-stage7-7';
  const PINNED_KEY = 'wlp:stage7:pinned-decks:v1';
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const $ = id => document.getElementById(id);

  let rows = [];
  let maxBatch = 0;
  let pinned = readList(PINNED_KEY);
  let recent = readList(RECENT_KEY);
  let majorRange = null;
  let minorRange = null;
  let searchQuery = '';
  const initialView = new URLSearchParams(location.search).get('view');
  let recentExpanded = initialView === 'recent';
  let pinnedExpanded = false;

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  }
  const saveList = (key, list) => localStorage.setItem(key, JSON.stringify(list));
  const pad = n => String(n).padStart(3, '0');
  const clampDeck = n => Number.isInteger(n) && n >= 1 && n <= maxBatch;

  function parseTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i++; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(field);
        if (row.some(v => String(v).trim())) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(v => String(v).trim())) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(v => String(v || '').trim());
    return table.slice(1).map(cols => Object.fromEntries(headers.map((h, i) => [h, String(cols[i] ?? '').trim()])));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function rowDeck(row) {
    return Number(row['Batch #'] ?? row.Batch ?? 0) || 0;
  }

  function field(row, ...names) {
    for (const name of names) if (row[name]) return row[name];
    return '';
  }

  function wordsForDeck(deck) {
    return rows.filter(r => rowDeck(r) === deck).map(r => field(r, 'Word')).filter(Boolean);
  }

  function openDeck(deck) {
    if (!clampDeck(deck)) return;
    recent = [deck, ...recent.filter(n => n !== deck)].slice(0, 16);
    saveList(RECENT_KEY, recent);
    location.href = `./flashcards/wlp/batch.html?batch=${pad(deck)}`;
  }

  function deckRow(deck, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'deck-row' + (opts.searchHit ? ' search-hit' : '');

    const words = wordsForDeck(deck);
    const a = document.createElement('a');
    a.href = `./flashcards/wlp/batch.html?batch=${pad(deck)}`;
    a.className = 'deck-main';
    a.addEventListener('click', e => { e.preventDefault(); openDeck(deck); });

    const subtitle = opts.match
      ? `<strong>${escapeHtml(opts.match)}</strong>${opts.matchField ? `: Matched in ${escapeHtml(opts.matchField)}` : ''}`
      : (words.length ? words.slice(0, 3).map(escapeHtml).join(' · ') : 'Open this deck');
    a.innerHTML = `<span class="deck-title">Deck WLP${pad(deck)}</span><span class="deck-sub">${subtitle}</span>`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pin' + (pinned.includes(deck) ? ' active' : '');
    button.setAttribute('aria-label', pinned.includes(deck) ? 'Unpin deck' : 'Pin deck');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9-5.3-3-5.3 3 1.3-5.9-4.5-4L9.5 9 12 3.5Z"/></svg>';
    button.addEventListener('click', () => {
      pinned = pinned.includes(deck) ? pinned.filter(n => n !== deck) : [deck, ...pinned];
      saveList(PINNED_KEY, pinned);
      renderShortcuts();
      renderBrowse();
      if (searchQuery) renderSearch();
    });

    wrap.append(a, button);
    return wrap;
  }

  function appendRows(target, items, opts = {}) {
    target.innerHTML = '';
    items.forEach(item => {
      const deck = typeof item === 'number' ? item : item.deck;
      target.appendChild(deckRow(deck, {...opts, ...(typeof item === 'object' ? item : {})}));
    });
  }

  function getSearchMatches(query) {
    const s = query.trim().toLowerCase();
    if (!s) return [];

    const directText = s.replace(/^#?wlp\s*/i, '').replace(/^deck\s*/i, '').trim();
    const direct = /^\d+$/.test(directText) ? Number(directText) : NaN;
    const matches = new Map();
    if (clampDeck(direct)) matches.set(direct, {deck: direct, match: `Deck WLP${pad(direct)}`, matchField: 'Deck #'});

    for (const row of rows) {
      const deck = rowDeck(row);
      if (!deck || matches.has(deck) && matches.size >= 80) continue;
      const candidates = [
        {value: field(row, 'Word'), label: 'Headword'},
        {value: field(row, 'Definition'), label: 'Definition'},
        {value: field(row, 'Synonym(s)', 'Synonyms'), label: 'Synonyms'},
        {value: field(row, 'Example Sentence', 'Example'), label: 'Example'},
        {value: field(row, 'Note(s)', 'Note'), label: 'Notes'}
      ].filter(item => item.value);
      const hit = candidates.find(item => String(item.value).toLowerCase().includes(s));
      if (hit && !matches.has(deck)) {
        matches.set(deck, {deck, match: field(row, 'Word') || hit.value, matchField: hit.label});
        if (matches.size >= 80) break;
      }
    }
    return [...matches.values()];
  }

  function renderSearch() {
    const section = $('search-section');
    const list = $('search-list');
    if (!searchQuery.trim()) {
      section.hidden = true;
      list.innerHTML = '';
      return;
    }
    const matches = getSearchMatches(searchQuery);
    section.hidden = false;
    $('search-meta').textContent = `${matches.length} deck${matches.length === 1 ? '' : 's'} found`;
    if (matches.length) appendRows(list, matches, {searchHit: true});
    else list.innerHTML = '<p class="empty">No matching deck found.</p>';
  }

  function renderShortcuts() {
    const p = pinned.filter(clampDeck);
    const r = recent.filter(clampDeck);

    $('continue-section').hidden = !r.length;
    if (r.length) {
      $('continue-deck').innerHTML = '';
      $('continue-deck').appendChild(deckRow(r[0]));
    }

    $('pinned-section').hidden = !p.length;
    if (p.length) {
      appendRows($('pinned-list'), pinnedExpanded ? p : p.slice(0, 3));
      const pinnedToggle = $('pinned-toggle');
      pinnedToggle.hidden = p.length <= 3;
      pinnedToggle.textContent = pinnedExpanded ? 'Show Less' : 'Show More';
      pinnedToggle.setAttribute('aria-expanded', String(pinnedExpanded));
    } else {
      $('pinned-toggle').hidden = true;
    }

    $('recent-section').hidden = !r.length;
    if (r.length) {
      appendRows($('recent-list'), recentExpanded ? r : r.slice(0, 3));
      const recentToggle = $('recent-toggle');
      recentToggle.hidden = r.length <= 3;
      recentToggle.textContent = recentExpanded ? 'Show Less' : 'Show More';
      recentToggle.setAttribute('aria-expanded', String(recentExpanded));
    } else {
      $('recent-toggle').hidden = true;
    }
  }

  function rangeCard(start, end, kind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'range-card' + (kind === 'minor' ? ' is-minor' : '');
    const count = end - start + 1;
    button.innerHTML = `<span class="range-copy"><strong>${pad(start)}–${pad(end)}</strong><small>${count} deck${count === 1 ? '' : 's'}</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;
    button.addEventListener('click', () => {
      if (kind === 'major') {
        majorRange = {start, end};
        minorRange = null;
      } else {
        minorRange = {start, end};
      }
      renderBrowse();
      $('browse-section').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
    return button;
  }

  function renderBreadcrumbs() {
    const nav = $('range-breadcrumbs');
    if (!majorRange) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }
    nav.hidden = false;
    nav.innerHTML = '';

    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'breadcrumb-button';
    all.textContent = 'All ranges';
    all.addEventListener('click', () => { majorRange = null; minorRange = null; renderBrowse(); });
    nav.append(all);

    const sep1 = document.createElement('span'); sep1.className = 'breadcrumb-sep'; sep1.textContent = '›'; nav.append(sep1);
    const major = document.createElement('button');
    major.type = 'button'; major.className = 'breadcrumb-button'; major.textContent = `${pad(majorRange.start)}–${pad(majorRange.end)}`;
    major.addEventListener('click', () => { minorRange = null; renderBrowse(); });
    nav.append(major);

    if (minorRange) {
      const sep2 = document.createElement('span'); sep2.className = 'breadcrumb-sep'; sep2.textContent = '›'; nav.append(sep2);
      const minor = document.createElement('span'); minor.className = 'breadcrumb-button'; minor.textContent = `${pad(minorRange.start)}–${pad(minorRange.end)}`; nav.append(minor);
    }
  }

  function renderBrowse() {
    const grid = $('range-grid');
    const deckList = $('range-decks');
    const back = $('browse-back');
    renderBreadcrumbs();

    if (!majorRange) {
      $('browse-meta').textContent = 'Choose a 50-deck range';
      back.hidden = true;
      deckList.hidden = true;
      deckList.innerHTML = '';
      grid.hidden = false;
      grid.innerHTML = '';
      for (let start = 1; start <= maxBatch; start += 50) {
        grid.appendChild(rangeCard(start, Math.min(start + 49, maxBatch), 'major'));
      }
      return;
    }

    back.hidden = false;
    if (!minorRange) {
      $('browse-meta').textContent = `Choose a 10-deck group inside ${pad(majorRange.start)}–${pad(majorRange.end)}`;
      deckList.hidden = true;
      deckList.innerHTML = '';
      grid.hidden = false;
      grid.innerHTML = '';
      for (let start = majorRange.start; start <= majorRange.end; start += 10) {
        grid.appendChild(rangeCard(start, Math.min(start + 9, majorRange.end), 'minor'));
      }
      return;
    }

    $('browse-meta').textContent = `Decks ${pad(minorRange.start)}–${pad(minorRange.end)}`;
    grid.hidden = true;
    grid.innerHTML = '';
    deckList.hidden = false;
    appendRows(deckList, Array.from({length: minorRange.end - minorRange.start + 1}, (_, i) => minorRange.start + i));
  }

  $('browse-back').addEventListener('click', () => {
    if (minorRange) minorRange = null;
    else majorRange = null;
    renderBrowse();
  });

  const deckSearchInput = $('deck-search');
  const deckSearchClear = $('deck-search-clear');

  function updateDeckSearchClear() {
    deckSearchClear.hidden = !deckSearchInput.value;
  }

  function scrollToSearchResults() {
    const section = $('search-section');
    if (!searchQuery.trim() || section.hidden) return;
    requestAnimationFrame(() => section.scrollIntoView({behavior: 'smooth', block: 'start'}));
  }

  function runDeckSearch({scroll = false} = {}) {
    searchQuery = deckSearchInput.value;
    updateDeckSearchClear();
    renderSearch();
    if (scroll) scrollToSearchResults();
  }

  // Keep the existing live search, but also make the keyboard Search/Enter action
  // an explicit, reliable search trigger on iPhone and desktop.
  deckSearchInput.addEventListener('input', () => runDeckSearch());
  deckSearchInput.addEventListener('search', () => runDeckSearch({scroll: true}));
  deckSearchInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    runDeckSearch({scroll: true});
    deckSearchInput.blur();
  });

  function clearDeckSearch() {
    searchQuery = '';
    deckSearchInput.value = '';
    updateDeckSearchClear();
    renderSearch();
    deckSearchInput.focus();
  }

  deckSearchClear.addEventListener('click', clearDeckSearch);
  $('clear-search').addEventListener('click', clearDeckSearch);

  // Voice search for Choose a Deck.
  const deckVoiceButton = $('deck-search-voice');
  const deckVoiceHelp = $('deck-voice-permission-help');
  const DeckSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let deckVoiceRecognition = null;
  let deckVoiceListening = false;
  let deckVoiceTimeout = 0;

  const setDeckVoiceListening = listening => {
    deckVoiceListening = Boolean(listening);
    if (!deckVoiceListening && deckVoiceTimeout) {
      clearTimeout(deckVoiceTimeout);
      deckVoiceTimeout = 0;
    }
    if (!deckVoiceButton) return;
    deckVoiceButton.classList.toggle('is-listening', deckVoiceListening);
    deckVoiceButton.setAttribute('aria-pressed', String(deckVoiceListening));
    deckVoiceButton.setAttribute('aria-label', deckVoiceListening ? 'Stop voice search' : 'Search by voice');
    deckVoiceButton.setAttribute('title', deckVoiceListening ? 'Stop voice search' : 'Search by voice');
  };

  const hideDeckVoiceHelp = () => {
    if (!deckVoiceHelp) return;
    deckVoiceHelp.hidden = true;
    deckVoiceHelp.innerHTML = '';
  };

  const showDeckVoiceHelp = () => {
    if (!deckVoiceHelp) return;
    deckVoiceHelp.innerHTML = `<strong>Microphone permission is blocked for this site.</strong><br>
      In Chrome on iPhone, tap the microphone/camera icon at the left of the address bar and turn site Permissions on.
      Also check iPhone Settings → Chrome → Microphone and Speech Recognition.
      <br><button type="button">Dismiss</button>`;
    deckVoiceHelp.hidden = false;
    deckVoiceHelp.querySelector('button')?.addEventListener('click', hideDeckVoiceHelp);
  };

  const stopDeckVoice = () => {
    if (!deckVoiceRecognition) return;
    try { deckVoiceRecognition.abort(); } catch (_) {}
    deckVoiceRecognition = null;
    setDeckVoiceListening(false);
  };

  if (deckVoiceButton && DeckSpeechRecognition) {
    deckVoiceButton.hidden = false;
    deckVoiceButton.setAttribute('aria-pressed', 'false');
    deckVoiceButton.addEventListener('click', e => {
      e.preventDefault();
      if (deckVoiceListening && deckVoiceRecognition) {
        try { deckVoiceRecognition.stop(); } catch (_) {}
        return;
      }
      try {
        const recognition = new DeckSpeechRecognition();
        deckVoiceRecognition = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
          hideDeckVoiceHelp();
          setDeckVoiceListening(true);
          deckVoiceTimeout = window.setTimeout(() => {
            try { recognition.stop(); } catch (_) {}
          }, 10000);
        };
        recognition.onend = () => {
          setDeckVoiceListening(false);
          deckVoiceRecognition = null;
        };
        recognition.onerror = event => {
          setDeckVoiceListening(false);
          deckVoiceRecognition = null;
          if (event?.error === 'aborted' || event?.error === 'no-speech') return;
          if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
            showDeckVoiceHelp();
            return;
          }
          showToast('Voice search could not hear that. Try again.');
        };
        recognition.onresult = event => {
          const transcript = String(event?.results?.[0]?.[0]?.transcript || '').trim();
          if (!transcript) return;
          try { recognition.stop(); } catch (_) {}
          deckSearchInput.value = transcript;
          runDeckSearch({scroll: true});
        };
        recognition.start();
      } catch (error) {
        console.error('Deck voice search could not start:', error);
        setDeckVoiceListening(false);
        deckVoiceRecognition = null;
        showToast('Voice search is unavailable right now.');
      }
    });

    window.addEventListener('pagehide', stopDeckVoice);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopDeckVoice();
    });
  }

  $('pinned-toggle').addEventListener('click', () => {
    pinnedExpanded = !pinnedExpanded;
    renderShortcuts();
  });

  document.querySelector('.range-jump-link')?.addEventListener('click', e => {
    e.preventDefault();
    $('browse-section').scrollIntoView({behavior: 'smooth', block: 'start'});
  });

  $('recent-toggle').addEventListener('click', () => {
    recentExpanded = !recentExpanded;
    renderShortcuts();
  });

  $('jump-form').addEventListener('submit', e => {
    e.preventDefault();
    const raw = $('jump-input').value.trim().replace(/\D/g, '');
    const deck = Number(raw);
    if (!clampDeck(deck)) {
      $('jump-message').textContent = maxBatch ? `Enter a deck from 001 to ${pad(maxBatch)}.` : 'Deck data is still loading.';
      return;
    }
    $('jump-message').textContent = '';
    openDeck(deck);
  });

  // Shared Stage 7 app-shell behavior: same header/drawer/role state as Home.
  const menu = $('menu-button');
  const drawer = $('app-drawer');
  const close = $('drawer-close');
  const backdrop = $('drawer-backdrop');
  const toast = $('deck-toast');
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

  const setDrawer = open => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menu.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
  };
  menu.addEventListener('click', () => setDrawer(true));
  close.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));

  const showToast = text => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(window.__wlpDeckToastTimer);
    window.__wlpDeckToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };

  $('drawer-settings').addEventListener('click', () => { setDrawer(false); showToast('Settings will move into the Stage 7 app shell.'); });
  document.querySelectorAll('.drawer-placeholder').forEach(button => button.addEventListener('click', () => {
    setDrawer(false); showToast(button.dataset.placeholder || 'Coming soon.');
  }));

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
    rolePill.classList.toggle('is-admin', admin);
    roleMenuTitle.textContent = admin ? 'Admin mode' : 'Guest mode';
    roleMenuCopy.textContent = admin ? 'Editing and import/export tools are unlocked.' : 'Study normally without editing tools.';
    roleMenuAction.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    const drawerLabel = drawerRoleAction.querySelector('.drawer-role-label');
    if (drawerLabel) drawerLabel.textContent = admin ? 'Switch to Guest' : 'Admin Login';
    drawerAdminOnly.forEach(item => { item.hidden = !admin; });
  };

  const closeRoleMenu = () => { roleMenu.hidden = true; rolePill.setAttribute('aria-expanded', 'false'); };
  rolePill.addEventListener('click', e => {
    e.stopPropagation();
    const open = roleMenu.hidden;
    roleMenu.hidden = !open;
    rolePill.setAttribute('aria-expanded', String(open));
  });
  roleMenu.addEventListener('click', e => e.stopPropagation());
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
    closeRoleMenu(); setDrawer(false); adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); rememberAdmin.checked = false; adminGate.hidden = false;
    setTimeout(() => adminPassword.focus(), 0);
  };
  const closeAdminGate = () => { adminGate.hidden = true; adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); };
  const roleAction = () => {
    if (getRole() === 'admin') {
      clearAdmin(); refreshRoleUI(); closeRoleMenu(); setDrawer(false); showToast('Switched to Guest mode.');
    } else openAdminGate();
  };
  roleMenuAction.addEventListener('click', roleAction);
  drawerRoleAction.addEventListener('click', roleAction);
  $('admin-close').addEventListener('click', closeAdminGate);
  $('admin-cancel').addEventListener('click', closeAdminGate);
  adminGate.addEventListener('click', e => { if (e.target === adminGate) closeAdminGate(); });

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  adminForm.addEventListener('submit', async e => {
    e.preventDefault();
    const hash = await sha256Hex(adminPassword.value);
    if (hash !== WLP_ADMIN_PASSWORD_SHA256) {
      adminError.hidden = false; adminPassword.select(); return;
    }
    setAdmin(rememberAdmin.checked); refreshRoleUI(); closeAdminGate(); showToast('Admin mode unlocked.');
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    setDrawer(false); closeRoleMenu(); closeAdminGate();
  });
  refreshRoleUI();

  fetch(TSV_URL, {cache: 'no-cache'})
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
    .then(text => {
      rows = parseTSV(text);
      maxBatch = rows.reduce((max, row) => Math.max(max, rowDeck(row)), 0);
      $('deck-count').textContent = `${maxBatch} decks`;
      renderShortcuts();
      renderBrowse();

      // A user can begin typing before the TSV finishes loading. Re-run any
      // existing query now that the Effective Deck data is actually available.
      searchQuery = deckSearchInput.value;
      updateDeckSearchClear();
      if (searchQuery.trim()) renderSearch();

      if (initialView === 'recent' && !$('recent-section').hidden) {
        $('recent-section').scrollIntoView({behavior: 'smooth', block: 'start'});
      }
    })
    .catch(error => {
      console.error(error);
      $('deck-count').textContent = 'Unavailable';
      $('browse-meta').textContent = 'Could not load deck data.';
      $('range-grid').innerHTML = '<p class="empty">Please try again.</p>';
    });
})();
