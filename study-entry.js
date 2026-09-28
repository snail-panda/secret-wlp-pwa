/* WLP v1.8.6.158 — Study entrance: New / Continue / Review. */
(() => {
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260914-stage7-7';
  const TEMP_STUDY_SET_KEY = 'wlp:temporary-study-set:v1';
  const BUILDER_STATE_KEY = 'wlp:study-set-builder-state:v1';
  const ACTIVE_CARD_CONTEXT_KEY = 'wlp:active-card-study-context:v1';
  const PRACTICE_MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const api = window.WLPStudyContext || null;
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();
  const pad = value => String(value ?? '').padStart(3, '0');
  const params = new URLSearchParams(location.search);
  let mode = ['continue', 'review'].includes(params.get('mode')) ? params.get('mode') : 'new';
  let rows = [];
  let rowsPromise = null;

  function parseTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i], next = source[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i++; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(field);
        if (row.some(value => String(value).trim())) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(value => String(value).trim())) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(value => clean(value));
    return table.slice(1).map(cols => Object.fromEntries(headers.map((header, index) => [header, clean(cols[index])])))
      .filter(rowValue => clean(rowValue.WordID));
  }

  function ensureRows() {
    if (rows.length) return Promise.resolve(rows);
    if (rowsPromise) return rowsPromise;
    rowsPromise = fetch(TSV_URL, { cache: 'no-cache' })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
      .then(text => { rows = parseTSV(text); return rows; })
      .catch(error => { console.warn('Continue could not load the Effective Deck:', error); return []; });
    return rowsPromise;
  }

  function rowByWordId(wordId) {
    const id = clean(wordId);
    return rows.find(row => clean(row.WordID) === id) || null;
  }

  function showToast(message) {
    const toast = $('deck-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(window.__wlpStudyEntryToastTimer);
    window.__wlpStudyEntryToastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function sourceWordIds(context) {
    if (!api || !context) return [];
    const direct = api.uniqueWordIds(context.source?.wordIds || []);
    if (direct.length) return direct;
    if (context.sourceType === 'built-set' && context.source?.buildId) {
      return api.uniqueWordIds(api.getBuild(context.source.buildId)?.wordIds || []);
    }
    return [];
  }

  function buildTitle(build) {
    const recipe = build?.recipe && typeof build.recipe === 'object' ? build.recipe : {};
    const parts = [];
    const queries = (Array.isArray(recipe.searchStages) ? recipe.searchStages : [])
      .map(stage => clean(stage?.query)).filter(Boolean);
    if (queries.length) parts.push(queries.slice(0, 2).join(' + '));
    const axes = recipe.axes && typeof recipe.axes === 'object' ? recipe.axes : {};
    for (const key of ['entryTypes', 'usageTags', 'topicTags', 'discoveryTags']) {
      const included = Array.isArray(axes[key]?.include) ? axes[key].include.map(clean).filter(Boolean) : [];
      if (included.length) parts.push(included.slice(0, 2).join(' + '));
      if (parts.length >= 2) break;
    }
    return parts.length ? parts.join(' · ') : 'Built Study Set';
  }

  function contextTitle(context) {
    if (context?.sourceType === 'built-set') return buildTitle(api?.getBuild(context.source?.buildId));
    return clean(context?.source?.label) || ({
      deck: 'Deck', range: 'Deck Range', 'review-set': 'Review Set'
    }[context?.sourceType] || 'Study');
  }

  function contextKind(context) {
    const source = ({
      deck: 'Deck', range: 'Deck Range', 'built-set': 'Built Set', 'review-set': 'Review Set'
    })[context?.sourceType] || 'Study';
    const practice = ({ cards: 'Cards', standard: 'Standard Practice', ai: 'AI Practice' })[context?.practiceMode] || clean(context?.practiceMode);
    return practice === 'Cards' ? `${source} · Cards` : `${source} · ${practice}`;
  }

  function relativeWhen(value) {
    const then = new Date(value || 0).getTime();
    if (!Number.isFinite(then) || then <= 0) return '';
    const minutes = Math.floor(Math.max(0, Date.now() - then) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function progressFor(context) {
    const completed = Math.max(0, Number(context?.progress?.completedCount) || 0);
    const total = Math.max(completed, Number(context?.progress?.totalCount) || sourceWordIds(context).length || 0);
    const unit = context?.practiceMode === 'standard' || context?.practiceMode === 'ai' ? 'experiences' : 'cards';
    return { completed, total, unit, percent: total ? Math.min(100, Math.round(completed / total * 100)) : 0 };
  }

  function nextWordId(context, restart = false) {
    const ids = sourceWordIds(context);
    if (!ids.length) return '';
    if (restart) return ids[0];
    const completed = new Set(api?.uniqueWordIds(context?.progress?.completedWordIds || []) || []);
    return ids.find(wordId => !completed.has(wordId)) || clean(context?.progress?.currentWordId) || ids[Math.min(ids.length - 1, Math.max(0, Number(context?.progress?.currentIndex) || 0))];
  }

  async function prepareBuild(buildId) {
    await ensureRows();
    const build = api?.getBuild(buildId);
    if (!build) return null;
    const items = (build.wordIds || []).map(wordId => {
      const row = rowByWordId(wordId);
      if (!row) return null;
      return { wordId: clean(row.WordID), batch: clean(row['Batch #']), word: clean(row.Word) };
    }).filter(Boolean);
    if (!items.length) return null;
    const snapshot = {
      version: 1,
      createdAt: clean(build.createdAt) || new Date().toISOString(),
      criteria: build.recipe || {},
      buildId: build.buildId,
      items
    };
    try { sessionStorage.setItem(TEMP_STUDY_SET_KEY, JSON.stringify(snapshot)); }
    catch { return null; }
    return snapshot;
  }

  async function cardHref(context, restart) {
    const source = context?.source || {};
    if (context?.sourceType === 'built-set') {
      const snapshot = await prepareBuild(source.buildId);
      if (!snapshot) return '';
      const wordId = nextWordId(context, restart);
      const item = snapshot.items.find(entry => entry.wordId === wordId) || snapshot.items[0];
      if (!item) return '';
      if (restart) {
        try { sessionStorage.removeItem(ACTIVE_CARD_CONTEXT_KEY); } catch (_) {}
      }
      const query = new URLSearchParams();
      query.set('batch', pad(Number(item.batch) || item.batch));
      query.set('wordid', item.wordId);
      query.set('solo', '1');
      query.set('studyset', '1');
      query.set('from', 'study-set');
      query.set('return', '../../deck-browser.html?mode=continue');
      if (!restart) query.set('context', context.contextId);
      return `./flashcards/wlp/batch.html?${query.toString()}`;
    }

    if (context?.sourceType === 'review-set') {
      const query = new URLSearchParams();
      query.set('review', '1');
      query.set('from', 'review');
      query.set('return', '../../deck-browser.html?mode=continue');
      if (source.reviewLevel) query.set('reviewlevel', source.reviewLevel);
      if (source.reviewReason) query.set('reviewreason', source.reviewReason);
      if (!restart) {
        query.set('context', context.contextId);
        const ids = sourceWordIds(context);
        const index = ids.indexOf(nextWordId(context, false));
        if (index >= 0) query.set('s7card', String(index + 1));
      }
      return `./flashcards/wlp/batch.html?${query.toString()}`;
    }

    if (context?.sourceType === 'deck' && Number(source.deck)) {
      if (restart) {
        try { sessionStorage.removeItem(ACTIVE_CARD_CONTEXT_KEY); } catch (_) {}
      }
      const query = new URLSearchParams();
      query.set('batch', pad(Number(source.deck)));
      const wordId = nextWordId(context, restart);
      if (wordId && !restart) query.set('wordid', wordId);
      if (!restart) query.set('context', context.contextId);
      return `./flashcards/wlp/batch.html?${query.toString()}`;
    }
    return '';
  }

  async function openContext(context, action) {
    if (!context) return;
    if (action === 'rebuild') {
      const build = api?.getBuild(context.source?.buildId);
      if (!build?.recipe) { showToast('This Build recipe is no longer available.'); return; }
      try { sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(build.recipe)); }
      catch { showToast('This browser could not restore the Build recipe.'); return; }
      location.href = './study-set-builder.html';
      return;
    }

    const restart = action === 'restart';
    if (context.practiceMode === 'standard') {
      try { localStorage.setItem(PRACTICE_MODE_KEY, 'standard'); } catch (_) {}
      const query = new URLSearchParams();
      query.set(restart ? 'restartcontext' : 'resumecontext', context.contextId);
      location.href = `./study-hub.html?${query.toString()}`;
      return;
    }
    if (context.practiceMode === 'cards') {
      const href = await cardHref(context, restart);
      if (href) location.href = href;
      else showToast('This study set can no longer be opened from its saved context.');
      return;
    }
    showToast('This study mode is not connected to Continue yet.');
  }

  function contextCard(context, featured = false) {
    const progress = progressFor(context);
    const card = document.createElement('article');
    card.className = `study-context-card${featured ? ' is-featured' : ''}`;

    const kicker = document.createElement('div');
    kicker.className = 'study-context-kicker';
    const state = document.createElement('span');
    state.textContent = context.status === 'completed' ? 'Completed' : featured ? 'Continue' : 'Recent study';
    const when = document.createElement('time');
    when.textContent = relativeWhen(context.lastMeaningfulAt || context.createdAt);
    kicker.append(state, when);

    const title = document.createElement('h3');
    title.textContent = contextTitle(context);
    const kind = document.createElement('p');
    kind.className = 'study-context-kind';
    kind.textContent = contextKind(context);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'study-context-progress';
    const progressLine = document.createElement('div');
    progressLine.className = 'study-context-progress-line';
    const count = document.createElement('strong');
    count.textContent = progress.total ? `${progress.completed} / ${progress.total} ${progress.unit}` : `${progress.completed} ${progress.unit}`;
    const status = document.createElement('span');
    status.textContent = context.status === 'completed'
      ? 'Completed'
      : progress.total && progress.completed < progress.total
        ? `${progress.total - progress.completed} left`
        : 'In progress';
    progressLine.append(count, status);
    const track = document.createElement('div');
    track.className = 'study-context-progress-track';
    const fill = document.createElement('span');
    fill.style.width = `${progress.percent}%`;
    track.append(fill);
    progressWrap.append(progressLine, track);

    const actions = document.createElement('div');
    actions.className = 'study-context-actions';
    const resumable = context.status !== 'completed' && (!progress.total || progress.completed < progress.total);
    if (resumable) {
      const resume = document.createElement('button');
      resume.type = 'button';
      resume.className = 'study-context-action is-primary';
      resume.textContent = 'Resume';
      resume.addEventListener('click', () => { void openContext(context, 'resume'); });
      actions.append(resume);
    }
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = `study-context-action${resumable ? '' : ' is-primary'}`;
    restart.textContent = 'Start Again';
    restart.addEventListener('click', () => { void openContext(context, 'restart'); });
    actions.append(restart);

    if (context.sourceType === 'built-set' && context.source?.buildId) {
      const rebuild = document.createElement('button');
      rebuild.type = 'button';
      rebuild.className = 'study-context-action is-quiet';
      rebuild.textContent = 'Rebuild';
      rebuild.addEventListener('click', () => { void openContext(context, 'rebuild'); });
      actions.append(rebuild);
    }

    card.append(kicker, title, kind, progressWrap, actions);
    return card;
  }

  function renderContinue() {
    const featured = $('study-continue-featured');
    const recentList = $('study-continue-recent-list');
    const empty = $('study-continue-empty');
    const recentSection = $('study-continue-recent-section');
    if (!featured || !recentList || !empty || !recentSection) return;
    featured.replaceChildren();
    recentList.replaceChildren();

    const contexts = api ? api.readContexts().filter(context => ['cards', 'standard'].includes(context.practiceMode)) : [];
    const useful = contexts.filter(context => context.status === 'completed' || progressFor(context).completed > 0);
    const unfinished = useful.filter(context => context.status !== 'completed')
      .sort((a, b) => Date.parse(b.lastMeaningfulAt || 0) - Date.parse(a.lastMeaningfulAt || 0));
    const completed = useful.filter(context => context.status === 'completed')
      .sort((a, b) => Date.parse(b.lastMeaningfulAt || 0) - Date.parse(a.lastMeaningfulAt || 0));
    const ordered = [...unfinished, ...completed];
    const lead = ordered[0] || null;
    empty.hidden = Boolean(lead);
    if (lead) featured.append(contextCard(lead, true));
    const rest = ordered.slice(1, 5);
    recentSection.hidden = !rest.length;
    rest.forEach(context => recentList.append(contextCard(context)));
  }

  function renderReviewSummary() {
    const counts = { total: 0, high: 0, medium: 0, light: 0, unassigned: 0 };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('fc:wordid:')) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key) || '{}');
        if (!(record?.review === true || record?.lastResult === 'review')) continue;
        counts.total++;
        const level = clean(record.reviewLevel).toLowerCase();
        if (['high', 'medium', 'light'].includes(level)) counts[level]++;
        else counts.unassigned++;
      } catch (_) {}
    }
    $('study-review-total').textContent = counts.total.toLocaleString();
    $('study-review-high').textContent = counts.high.toLocaleString();
    $('study-review-medium').textContent = counts.medium.toLocaleString();
    $('study-review-light').textContent = counts.light.toLocaleString();
    $('study-review-unassigned').textContent = counts.unassigned.toLocaleString();
  }

  function bindRangeJump() {
    const link = document.querySelector('.range-jump-link');
    if (!link || link.dataset.studyEntryBound === '1') return;
    link.dataset.studyEntryBound = '1';
    link.addEventListener('click', event => {
      event.preventDefault();
      $('browse-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function setMode(nextMode) {
    mode = ['continue', 'review'].includes(nextMode) ? nextMode : 'new';
    document.querySelectorAll('[data-study-mode]').forEach(button => {
      const active = button.dataset.studyMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-study-panel]').forEach(panel => { panel.hidden = panel.dataset.studyPanel !== mode; });

    const title = $('study-page-title');
    const copy = $('study-page-copy');
    const deckCount = $('deck-count');
    if (mode === 'continue') {
      title.textContent = 'Continue Studying';
      copy.textContent = 'Resume a meaningful recent study, or start the same set again.';
      deckCount.hidden = true;
      renderContinue();
      void ensureRows();
    } else if (mode === 'review') {
      title.textContent = 'Review';
      copy.textContent = 'Return to cards that still need attention.';
      deckCount.hidden = true;
      renderReviewSummary();
    } else {
      title.textContent = 'Choose a Deck';
      copy.innerHTML = 'Jump straight in, return to a recent deck, or <a class="range-jump-link" href="#browse-section">browse the garden by range<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg></a>.';
      deckCount.hidden = false;
      bindRangeJump();
    }
  }

  document.querySelectorAll('[data-study-mode]').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.studyMode));
  });
  bindRangeJump();
  setMode(mode);
})();
