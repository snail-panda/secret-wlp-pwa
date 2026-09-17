(() => {
  'use strict';

  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const PRACTICE_EVENTS_KEY = 'wlp:stage7:practice-events:v1';
  const PROGRESS_OPTIONS_KEY = 'wlp:stage7:progress-options:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
  const $ = id => document.getElementById(id);

  const VIEW_META = {
    overview: { title: 'Overview', description: 'See where you are, what needs attention, and what to do next.' },
    landscape: { title: 'Landscape', description: 'See the garden as a landscape: where you have traveled, and where you have not.' },
    paths: { title: 'Paths', description: 'See the different learning paths that make words deeper and more connected.' }
  };

  const PANEL_OPTIONS = {
    Overview: [
      ['overview.map', 'Vocabulary Map'],
      ['overview.review', 'Review Attention'],
      ['overview.next', 'Next Move'],
      ['overview.recent', 'Recent Activity']
    ],
    Landscape: [
      ['landscape.coverage', 'Overall Coverage'],
      ['landscape.deckmap', 'Deck Coverage Map'],
      ['landscape.review', 'Review Attention'],
      ['landscape.connections', 'Practice Connections']
    ],
    Paths: [
      ['paths.paths', 'Learning Paths'],
      ['paths.focus', 'Focus for Today'],
      ['paths.recent', 'Recently Practiced'],
      ['paths.motto', 'Paths Motto']
    ]
  };

  let rows = [];
  let progressRecords = [];
  let practiceEvents = [];
  let rowByWordId = new Map();
  let activeView = 'overview';

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

  function field(row, ...names) {
    for (const name of names) if (row && row[name]) return row[name];
    return '';
  }

  function wordIdOf(row) { return String(field(row, 'WordID', 'Word ID') || '').trim(); }
  function deckOf(row) { return Number(field(row, 'Batch #', 'Batch') || 0) || 0; }
  function pad3(value) { return String(Number(value) || 0).padStart(3, '0'); }
  function fmt(value) { return Number(value || 0).toLocaleString(); }

  function readProgressRecords() {
    const records = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const wordId = String(data.wordId || key.slice(PROGRESS_PREFIX.length)).trim();
        if (!wordId) continue;
        records.push({
          ...data,
          wordId,
          studyCount: Number(data.studyCount || 0),
          reviewCount: Number(data.reviewCount || 0),
          attempts: Number(data.attempts || 0),
          firstSeen: Number(data.firstSeen || 0),
          lastSeen: Number(data.lastSeen || 0),
          review: data.review === true || data.lastResult === 'review',
          reviewLevel: ['high', 'medium', 'light'].includes(String(data.reviewLevel || '').toLowerCase()) ? String(data.reviewLevel).toLowerCase() : ''
        });
      } catch (error) {
        console.warn('Could not read progress record:', key, error);
      }
    }
    return records;
  }

  function readPracticeEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(PRACTICE_EVENTS_KEY) || '[]');
      return Array.isArray(data) ? data.filter(event => event && typeof event === 'object') : [];
    } catch (error) {
      console.warn('Could not read practice events:', error);
      return [];
    }
  }

  function recentThreshold() { return Date.now() - RECENT_MS; }
  function stats() {
    const total = rows.length;
    const touched = progressRecords.filter(r => r.attempts > 0 || r.studyCount > 0 || r.reviewCount > 0 || r.lastSeen > 0).length;
    const review = progressRecords.filter(r => r.review).length;
    const recent = progressRecords.filter(r => r.lastSeen >= recentThreshold()).length;
    const unseen = Math.max(0, total - touched);
    const percent = total ? (touched / total) * 100 : 0;
    return { total, touched, review, recent, unseen, percent };
  }

  function formatWhen(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const delta = Math.round((startToday - startThat) / 86400000);
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) return `${delta}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function showToast(text) {
    const toast = $('progress-toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(window.__wlpProgressToastTimer);
    window.__wlpProgressToastTimer = setTimeout(() => { toast.hidden = true; }, 2700);
  }

  function renderOverview() {
    const s = stats();
    $('stat-touched').textContent = fmt(s.touched);
    $('stat-review').textContent = fmt(s.review);
    $('stat-recent').textContent = fmt(s.recent);
    $('stat-unseen').textContent = fmt(s.unseen);
    $('coverage-line-fill').style.width = `${Math.max(0, Math.min(100, s.percent))}%`;
    $('coverage-copy').textContent = `${fmt(s.touched)} of ${fmt(s.total)} cards recorded (${s.percent.toFixed(1)}% coverage)`;

    const reviewing = progressRecords.filter(r => r.review);
    const levels = { high: 0, medium: 0, light: 0, unassigned: 0 };
    reviewing.forEach(r => { if (r.reviewLevel) levels[r.reviewLevel]++; else levels.unassigned++; });
    $('attention-high').textContent = fmt(levels.high);
    $('attention-medium').textContent = fmt(levels.medium);
    $('attention-light').textContent = fmt(levels.light);
    const unassigned = $('attention-unassigned');
    unassigned.hidden = !levels.unassigned;
    unassigned.textContent = levels.unassigned ? `${fmt(levels.unassigned)} existing Review card${levels.unassigned === 1 ? '' : 's'} not yet assigned an attention level.` : '';

    const recentDecks = readNumberList('wlp:stage7:recent-decks:v1');
    $('next-new-copy').textContent = recentDecks.length ? `Continue near Deck WLP${pad3(recentDecks[0])}, or explore somewhere new` : 'Explore an area you have not covered yet';
    $('next-review-copy').textContent = s.review ? `${fmt(s.review)} card${s.review === 1 ? '' : 's'} currently asking for more attention` : 'No cards are currently marked Review';
    renderRecentActivity();
  }

  function renderRecentActivity() {
    const target = $('recent-activity');
    const items = progressRecords.filter(r => r.lastSeen).sort((a,b) => b.lastSeen - a.lastSeen).slice(0, 5);
    if (!items.length) {
      target.innerHTML = '<p class="empty-progress">Your Studied / Review activity will appear here as WLP records it.</p>';
      return;
    }
    target.innerHTML = items.map(record => {
      const row = rowByWordId.get(record.wordId) || {};
      const word = field(row, 'Word') || `WID ${record.wordId}`;
      const deck = deckOf(row);
      const tag = record.review ? 'Review' : 'Card Study';
      return `<div class="activity-row"><span class="activity-time">${escapeHtml(formatWhen(record.lastSeen))}</span><span class="activity-main"><strong>${escapeHtml(word)}</strong><small>${deck ? `Deck WLP${pad3(deck)} · ` : ''}${fmt(record.attempts)} recorded interaction${record.attempts === 1 ? '' : 's'}</small></span><span class="activity-tag">${escapeHtml(tag)}</span></div>`;
    }).join('');
  }

  function readNumberList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
    } catch { return []; }
  }

  function renderLandscape() {
    const s = stats();
    $('coverage-percent').textContent = `${s.percent.toFixed(1)}%`;
    $('coverage-touched').textContent = fmt(s.touched);
    $('coverage-review').textContent = fmt(s.review);
    $('coverage-recent').textContent = fmt(s.recent);
    $('coverage-unseen').textContent = fmt(s.unseen);
    $('coverage-donut').style.background = `conic-gradient(#5f9a79 0deg ${Math.max(0, Math.min(360, s.percent * 3.6))}deg, #e6ece8 ${Math.max(0, Math.min(360, s.percent * 3.6))}deg 360deg)`;

    renderDeckCoverageMap();

    const reviewing = progressRecords.filter(r => r.review);
    $('land-review-total').textContent = fmt(reviewing.length);
    $('land-review-old').textContent = fmt(reviewing.filter(r => !r.lastSeen || r.lastSeen < recentThreshold()).length);
    $('land-review-repeated').textContent = fmt(reviewing.filter(r => r.reviewCount >= 3).length);
    renderConnectionBars();
  }

  function renderDeckCoverageMap() {
    const target = $('deck-coverage-map');
    const maxDeck = rows.reduce((max, row) => Math.max(max, deckOf(row)), 0);
    const touchedByDeck = new Map();
    const reviewByDeck = new Map();
    const totalByDeck = new Map();

    rows.forEach(row => {
      const deck = deckOf(row);
      if (!deck) return;
      totalByDeck.set(deck, (totalByDeck.get(deck) || 0) + 1);
    });
    progressRecords.forEach(record => {
      const row = rowByWordId.get(record.wordId);
      const deck = deckOf(row);
      if (!deck) return;
      if (record.attempts || record.studyCount || record.reviewCount || record.lastSeen) touchedByDeck.set(deck, (touchedByDeck.get(deck) || 0) + 1);
      if (record.review) reviewByDeck.set(deck, (reviewByDeck.get(deck) || 0) + 1);
    });

    const rowsHtml = [];
    for (let rangeStart = 1; rangeStart <= maxDeck; rangeStart += 50) {
      const rangeEnd = Math.min(rangeStart + 49, maxDeck);
      const cells = [];
      for (let groupStart = rangeStart; groupStart <= rangeEnd; groupStart += 5) {
        const groupEnd = Math.min(groupStart + 4, rangeEnd);
        let touched = 0, total = 0, review = 0;
        for (let deck = groupStart; deck <= groupEnd; deck++) {
          touched += touchedByDeck.get(deck) || 0;
          total += totalByDeck.get(deck) || 0;
          review += reviewByDeck.get(deck) || 0;
        }
        const ratio = total ? touched / total : 0;
        const level = ratio === 0 ? 0 : ratio < .2 ? 1 : ratio < .5 ? 2 : ratio < .8 ? 3 : 4;
        const label = `Decks ${pad3(groupStart)}–${pad3(groupEnd)}: ${touched} of ${total} cards recorded${review ? `, ${review} in Review` : ''}`;
        cells.push(`<span class="map-cell" data-level="${level}" data-review="${review > 0}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`);
      }
      rowsHtml.push(`<div class="map-row"><span class="map-range">${pad3(rangeStart)}–${pad3(rangeEnd)}</span><div class="map-cells">${cells.join('')}</div></div>`);
    }
    target.innerHTML = rowsHtml.join('') || '<p class="empty-progress">Deck map unavailable.</p>';
  }

  const connectionDefs = [
    ['Meaning', ['meaning','word-meaning','meaning-word','definition']],
    ['Context / Situation', ['story','dialogue','situation','context']],
    ['Usage / Collocation', ['usage','collocation','natural-usage','own-sentence']],
    ['Sound', ['pronunciation','sound']],
    ['Visual', ['visual','image']],
    ['Culture', ['culture','cultural-context']]
  ];

  function eventType(event) { return String(event.type || event.practiceType || '').trim().toLowerCase(); }
  function connectionCounts() {
    const counts = Object.fromEntries(connectionDefs.map(([label]) => [label, 0]));
    practiceEvents.forEach(event => {
      const type = eventType(event);
      const size = Math.max(1, (Array.isArray(event.targets) ? event.targets.length : 0) + (Array.isArray(event.supports) ? event.supports.length : 0));
      connectionDefs.forEach(([label, aliases]) => { if (aliases.includes(type)) counts[label] += size; });
    });
    return counts;
  }

  function renderConnectionBars() {
    const target = $('connection-bars');
    const counts = connectionCounts();
    const values = Object.values(counts);
    const max = Math.max(1, ...values);
    target.innerHTML = connectionDefs.map(([label]) => {
      const count = counts[label] || 0;
      const width = count ? Math.max(8, (count / max) * 100) : 0;
      return `<div class="connection-row"><span>${escapeHtml(label)}</span><div class="connection-track"><div class="connection-fill" style="width:${width}%"></div></div><b class="connection-count">${fmt(count)}</b></div>`;
    }).join('');
    $('connection-note').hidden = values.some(Boolean);
  }

  function renderPaths() {
    const counts = connectionCounts();
    const s = stats();
    const pathDefs = [
      ['Meaning', 'book', s.touched, 'Card-study signals'],
      ['Context', 'context', counts['Context / Situation'], 'Stories · situations'],
      ['Usage', 'usage', counts['Usage / Collocation'], 'Collocation · natural use'],
      ['Sound', 'sound', counts.Sound, 'Pronunciation'],
      ['Visual', 'visual', counts.Visual, 'Image anchors'],
      ['Culture', 'culture', counts.Culture, 'Cultural context']
    ];
    const max = Math.max(1, ...pathDefs.map(item => item[2]));
    $('learning-path-grid').innerHTML = pathDefs.map(([label, icon, count, copy]) => {
      const width = count ? Math.max(7, (count / max) * 100) : 0;
      return `<div class="learning-path-card">${pathIcon(icon)}<strong>${escapeHtml(label)}</strong><small>${count ? `${fmt(count)} recorded · ${escapeHtml(copy)}` : `Not practiced yet · ${escapeHtml(copy)}`}</small><div class="path-meter"><span style="width:${width}%"></span></div></div>`;
    }).join('');

    const reviewing = progressRecords.filter(r => r.review);
    const old = reviewing.filter(r => !r.lastSeen || r.lastSeen < recentThreshold()).length;
    $('focus-review-copy').textContent = old ? `${fmt(old)} current Review card${old === 1 ? '' : 's'} have not been seen in 14 days` : reviewing.length ? `${fmt(reviewing.length)} current Review card${reviewing.length === 1 ? '' : 's'}` : 'No cards are currently marked Review';

    const territory = findLightlyTouchedTerritory();
    $('focus-territory-copy').textContent = territory ? `Deck ${pad3(territory.start)}–${pad3(territory.end)} has very little recorded coverage` : 'Find a part of the garden you have barely touched';
    renderRecentPractice();
  }

  function pathIcon(name) {
    const icons = {
      book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3-.8 5.8-.2 8 1.7v12c-2.2-1.9-5-2.5-8-1.7v-12ZM20 5.5c-3-.8-5.8-.2-8 1.7v12c2.2-1.9 5-2.5 8-1.7v-12Z"/></svg>',
      context: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 3V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
      usage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M6 12h8M6 17h10"/><path d="m17 14 3 3-3 3"/></svg>',
      sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14h3l4 4V6L8 10H5v4ZM16 9c1.5 1.5 1.5 4.5 0 6M19 6c3 3 3 9 0 12"/></svg>',
      visual: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m6 17 4-4 3 3 2-2 3 3"/></svg>',
      culture: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.2 2.1 3.2 4.8 3.2 8S14.2 17.9 12 20M12 4C9.8 6.1 8.8 8.8 8.8 12S9.8 17.9 12 20"/></svg>'
    };
    return icons[name] || icons.book;
  }

  function findLightlyTouchedTerritory() {
    if (!rows.length) return null;
    const maxDeck = rows.reduce((max, row) => Math.max(max, deckOf(row)), 0);
    const touched = new Set(progressRecords.filter(r => r.attempts || r.lastSeen).map(r => r.wordId));
    let best = null;
    for (let start = 1; start <= maxDeck; start += 50) {
      const end = Math.min(start + 49, maxDeck);
      const area = rows.filter(row => { const d = deckOf(row); return d >= start && d <= end; });
      if (!area.length) continue;
      const count = area.filter(row => touched.has(wordIdOf(row))).length;
      const ratio = count / area.length;
      if (!best || ratio < best.ratio) best = { start, end, ratio };
    }
    return best;
  }

  function renderRecentPractice() {
    const target = $('recent-practice');
    const practice = [...practiceEvents].sort((a,b) => Number(b.timestamp || b.createdAt || 0) - Number(a.timestamp || a.createdAt || 0)).slice(0, 4);
    if (practice.length) {
      target.innerHTML = practice.map(event => {
        const timestamp = Number(event.timestamp || event.createdAt || 0);
        const type = String(event.type || event.practiceType || 'Practice');
        const targets = Array.isArray(event.targets) ? event.targets.length : 0;
        const supports = Array.isArray(event.supports) ? event.supports.length : 0;
        return `<div class="practice-row"><span class="practice-time">${escapeHtml(formatWhen(timestamp))}</span><span class="practice-main"><strong>${escapeHtml(titleCase(type))}</strong><small>${targets ? `${targets} target${targets === 1 ? '' : 's'}` : 'Practice'}${supports ? ` + ${supports} support` : ''}</small></span><span class="practice-tag">Connection</span></div>`;
      }).join('');
      return;
    }

    const recent = progressRecords.filter(r => r.lastSeen).sort((a,b) => b.lastSeen - a.lastSeen).slice(0, 4);
    if (!recent.length) {
      target.innerHTML = '<p class="empty-progress">No practice has been recorded yet. Story, Dialogue, Situation and other connection work will appear here later.</p>';
      return;
    }
    target.innerHTML = `<p class="panel-footnote" style="margin-top:0">No connection-practice events yet. Recent card activity is shown below.</p>` + recent.map(record => {
      const row = rowByWordId.get(record.wordId) || {};
      return `<div class="practice-row"><span class="practice-time">${escapeHtml(formatWhen(record.lastSeen))}</span><span class="practice-main"><strong>${escapeHtml(field(row,'Word') || `WID ${record.wordId}`)}</strong><small>${deckOf(row) ? `Deck WLP${pad3(deckOf(row))}` : 'Card activity'}</small></span><span class="practice-tag">Card</span></div>`;
    }).join('');
  }

  function titleCase(value) { return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

  function renderAll() {
    progressRecords = readProgressRecords();
    practiceEvents = readPracticeEvents();
    const s = stats();
    $('progress-data-note').textContent = `${fmt(s.total)} cards · local progress`;
    renderOverview();
    renderLandscape();
    renderPaths();
    applyPanelOptions();
  }

  function switchView(view, options = {}) {
    if (!VIEW_META[view]) view = 'overview';
    activeView = view;
    document.querySelectorAll('[data-progress-view]').forEach(button => {
      const active = button.dataset.progressView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.progress-view[data-view]').forEach(section => {
      const active = section.dataset.view === view;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    $('progress-view-title').textContent = VIEW_META[view].title;
    $('progress-view-description').textContent = VIEW_META[view].description;
    if (!options.skipUrl) {
      const url = new URL(location.href);
      url.searchParams.set('view', view);
      history.replaceState(null, '', url);
    }
    if (options.scrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function readPanelOptions() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROGRESS_OPTIONS_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }

  function applyPanelOptions() {
    const saved = readPanelOptions();
    document.querySelectorAll('[data-panel]').forEach(panel => {
      const key = panel.dataset.panel;
      panel.hidden = saved[key] === false;
    });
    document.querySelectorAll('[data-progress-option]').forEach(input => {
      input.checked = saved[input.dataset.progressOption] !== false;
    });
  }

  function renderProgressOptions() {
    const saved = readPanelOptions();
    $('progress-options-groups').innerHTML = Object.entries(PANEL_OPTIONS).map(([group, items]) => `<section class="options-group"><h3>${escapeHtml(group)}</h3>${items.map(([key,label]) => `<label class="option-switch"><span>${escapeHtml(label)}</span><input type="checkbox" data-progress-option="${escapeHtml(key)}" ${saved[key] === false ? '' : 'checked'}></label>`).join('')}</section>`).join('');
    $('progress-options-groups').querySelectorAll('[data-progress-option]').forEach(input => {
      input.addEventListener('change', () => {
        const next = readPanelOptions();
        next[input.dataset.progressOption] = input.checked;
        localStorage.setItem(PROGRESS_OPTIONS_KEY, JSON.stringify(next));
        applyPanelOptions();
      });
    });
  }

  function installProgressOptions() {
    const sheet = $('progress-options-sheet');
    const backdrop = $('progress-options-backdrop');
    const open = () => {
      renderProgressOptions();
      backdrop.hidden = false;
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    };
    const close = () => {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      const optionsNav = $('progress-options-nav');
      if (optionsNav) {
        optionsNav.classList.remove('is-active');
        optionsNav.setAttribute('aria-selected', 'false');
      }
      setTimeout(() => { if (!sheet.classList.contains('is-open')) backdrop.hidden = true; }, 220);
    };
    const optionsNav = $('progress-options-nav');
    optionsNav.addEventListener('click', () => {
      optionsNav.classList.add('is-active');
      optionsNav.setAttribute('aria-selected', 'true');
      open();
    });
    $('progress-options-close').addEventListener('click', close);
    backdrop.addEventListener('click', close);
    $('progress-options-reset').addEventListener('click', () => {
      localStorage.removeItem(PROGRESS_OPTIONS_KEY);
      renderProgressOptions();
      applyPanelOptions();
      showToast('Default Progress panels restored.');
    });
    return close;
  }

  function installViewNavigation() {
    document.querySelectorAll('[data-progress-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.progressView, {scrollTop:true})));
    document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.openView, {scrollTop:true})));
    document.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => showToast(button.dataset.toast)));
    document.querySelectorAll('[data-practice-coming]').forEach(button => button.addEventListener('click', () => showToast('Context Practice is the next layer. This Progress foundation is ready to record it when we add it.')));
  }

  function installShell(closeOptions) {
    const menu = $('menu-button');
    const drawer = $('app-drawer');
    const close = $('drawer-close');
    const backdrop = $('drawer-backdrop');
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
    $('drawer-settings').addEventListener('click', () => { setDrawer(false); showToast('Settings will move into the Stage 7 app shell.'); });
    document.querySelectorAll('.drawer-placeholder').forEach(button => button.addEventListener('click', () => { setDrawer(false); showToast(button.dataset.placeholder || 'Coming soon.'); }));

    const getRole = () => (localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin') ? 'admin' : 'guest';
    const clearAdmin = () => { localStorage.removeItem(WLP_UI_ROLE_KEY); sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY); };
    const setAdmin = remember => {
      if (remember) { localStorage.setItem(WLP_UI_ROLE_KEY,'admin'); sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY); }
      else { localStorage.removeItem(WLP_UI_ROLE_KEY); sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY,'admin'); }
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
    const closeRoleMenu = () => { roleMenu.hidden = true; rolePill.setAttribute('aria-expanded','false'); };
    rolePill.addEventListener('click', event => { event.stopPropagation(); const open = roleMenu.hidden; roleMenu.hidden = !open; rolePill.setAttribute('aria-expanded', String(open)); });
    roleMenu.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', closeRoleMenu);

    const setPasswordVisible = visible => {
      adminPassword.type = visible ? 'text' : 'password';
      adminPasswordToggle?.setAttribute('aria-pressed', String(visible));
      adminPasswordToggle?.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      adminPasswordToggle?.setAttribute('title', visible ? 'Hide password' : 'Show password');
    };
    adminPasswordToggle?.addEventListener('click', () => { const visible = adminPassword.type === 'text'; setPasswordVisible(!visible); adminPassword.focus({preventScroll:true}); });
    const openAdminGate = () => { closeRoleMenu(); setDrawer(false); adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); rememberAdmin.checked = false; adminGate.hidden = false; setTimeout(() => adminPassword.focus(),0); };
    const closeAdminGate = () => { adminGate.hidden = true; adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); };
    const roleAction = () => {
      if (getRole() === 'admin') { clearAdmin(); refreshRoleUI(); closeRoleMenu(); setDrawer(false); showToast('Switched to Guest mode.'); }
      else openAdminGate();
    };
    roleMenuAction.addEventListener('click', roleAction);
    drawerRoleAction.addEventListener('click', roleAction);
    $('admin-close').addEventListener('click', closeAdminGate);
    $('admin-cancel').addEventListener('click', closeAdminGate);
    adminGate.addEventListener('click', event => { if (event.target === adminGate) closeAdminGate(); });

    async function sha256Hex(text) {
      const bytes = new TextEncoder().encode(String(text));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
    }
    adminForm.addEventListener('submit', async event => {
      event.preventDefault();
      const hash = await sha256Hex(adminPassword.value);
      if (hash !== WLP_ADMIN_PASSWORD_SHA256) { adminError.hidden = false; adminPassword.select(); return; }
      setAdmin(rememberAdmin.checked); refreshRoleUI(); closeAdminGate(); showToast('Admin mode unlocked.');
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      setDrawer(false); closeRoleMenu(); closeAdminGate(); closeOptions();
    });
    refreshRoleUI();
  }

  const closeOptions = installProgressOptions();
  installViewNavigation();
  installShell(closeOptions);

  const requestedView = new URLSearchParams(location.search).get('view');
  switchView(VIEW_META[requestedView] ? requestedView : 'overview', {skipUrl:true});

  fetch(TSV_URL, {cache:'no-cache'})
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
    .then(text => {
      rows = parseTSV(text);
      rowByWordId = new Map(rows.map(row => [wordIdOf(row), row]).filter(([id]) => id));
      renderAll();
    })
    .catch(error => {
      console.error(error);
      progressRecords = readProgressRecords();
      practiceEvents = readPracticeEvents();
      $('progress-data-note').textContent = 'Deck data unavailable';
      renderOverview();
      renderLandscape();
      renderPaths();
      showToast('Progress opened, but the Master deck data could not be loaded.');
    });
})();
