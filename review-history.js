/* WLP v1.8.6.179 — Study Review History V1 */
(() => {
  const api = window.WLPStudyContext || null;
  const REVIEW_QUICK_EVENT_KEY = 'wlp:review-quick-events:v1';
  const REVIEW_SETTINGS_KEY = 'wlp:review-settings:v1';
  const QUICK_REVIEW_SESSION_KEY = 'wlp:quick-review-auto-next-session:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260914-stage7-7';
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();
  const params = new URLSearchParams(location.search);
  let wordMap = new Map();


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
      .filter(item => clean(item.WordID));
  }

  function readJsonArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
    } catch (_) { return []; }
  }

  function sourceWordIds(context) {
    return api?.uniqueWordIds(context?.source?.wordIds || []) || [];
  }

  function reviewWhen(context) {
    return clean(context?.completedAt) || clean(context?.lastMeaningfulAt) || clean(context?.createdAt);
  }

  function formatWhen(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const day = sameDay ? 'Today' : date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { month:'short', day:'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
    return `${day} · ${date.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' })}`;
  }

  function reviewStyle(context) {
    return clean(context?.source?.reviewStyle).toLowerCase() === 'quick' ? 'Quick' : 'Deep';
  }

  function quickEventsFor(contextId) {
    const latest = new Map();
    readJsonArray(REVIEW_QUICK_EVENT_KEY)
      .filter(event => clean(event?.contextId) === clean(contextId))
      .forEach(event => {
        const wordId = clean(event?.wordId);
        const rating = clean(event?.rating).toLowerCase();
        if (!wordId || !['again','hard','good','easy'].includes(rating)) return;
        const previous = latest.get(wordId);
        if (!previous || Date.parse(event.occurredAt || 0) >= Date.parse(previous.occurredAt || 0)) latest.set(wordId, event);
      });
    return latest;
  }

  function quickCounts(contextId) {
    const counts = { again:0, hard:0, good:0, easy:0 };
    quickEventsFor(contextId).forEach(event => { if (counts[event.rating] !== undefined) counts[event.rating]++; });
    return counts;
  }

  function reviewContexts() {
    return api ? api.readContexts()
      .filter(context => context?.sourceType === 'review-set')
      .sort((a,b) => Date.parse(reviewWhen(b) || 0) - Date.parse(reviewWhen(a) || 0)) : [];
  }

  function historyHref(contextId) {
    return `./review-history.html?context=${encodeURIComponent(contextId)}`;
  }

  function renderList() {
    const list = $('review-history-list');
    const empty = $('review-history-empty');
    const count = $('review-history-count');
    if (!list || !empty || !count) return;
    list.replaceChildren();
    const contexts = reviewContexts();
    count.textContent = `${contexts.length.toLocaleString()} saved Review Set${contexts.length === 1 ? '' : 's'}`;
    empty.hidden = Boolean(contexts.length);
    for (const context of contexts) {
      const link = document.createElement('a');
      link.className = 'review-history-item';
      link.href = historyHref(context.contextId);
      const main = document.createElement('div');
      main.className = 'review-history-item-main';
      const title = document.createElement('strong');
      title.textContent = formatWhen(reviewWhen(context));
      const meta = document.createElement('span');
      const status = context.status === 'completed' ? 'Completed' : 'Incomplete';
      meta.textContent = `${sourceWordIds(context).length.toLocaleString()} cards · ${reviewStyle(context)} · ${status}`;
      main.append(title, meta);
      const chevron = document.createElement('span');
      chevron.className = 'review-history-item-chevron';
      chevron.textContent = '›';
      link.append(main, chevron);
      list.append(link);
    }
  }

  function summaryCell(value, label) {
    const cell = document.createElement('div');
    cell.className = 'review-history-summary-cell';
    const strong = document.createElement('strong'); strong.textContent = value;
    const span = document.createElement('span'); span.textContent = label;
    cell.append(strong, span);
    return cell;
  }

  function reviewSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(REVIEW_SETTINGS_KEY) || '{}');
      return { style: raw.style === 'quick' ? 'quick' : 'deep', autoAdvance: raw.autoAdvance !== false };
    } catch (_) { return { style:'deep', autoAdvance:true }; }
  }

  function cloneForRestart(context) {
    if (!api || !context) return null;
    const ids = sourceWordIds(context);
    if (!ids.length) return null;
    const settings = reviewSettings();
    return api.createContext({
      sourceType: 'review-set',
      practiceMode: 'cards',
      status: 'active',
      source: { ...context.source, wordIds: ids, reviewStyle: settings.style, quickAutoAdvance: settings.autoAdvance },
      progress: { currentIndex:0, completedCount:0, totalCount:ids.length, completedWordIds:[] }
    });
  }

  function nextIndex(context) {
    const ids = sourceWordIds(context);
    const completed = new Set(api?.uniqueWordIds(context?.progress?.completedWordIds || []) || []);
    const next = ids.findIndex(id => !completed.has(id));
    if (next >= 0) return next;
    return Math.max(0, Math.min(ids.length - 1, Number(context?.progress?.currentIndex) || 0));
  }

  function launchContext(context, restart = false, openFromStart = false) {
    if (!context || !sourceWordIds(context).length) return;
    const settings = reviewSettings();
    const launch = restart
      ? cloneForRestart(context)
      : context.status === 'completed'
        ? context
        : api?.updateContext(context.contextId, { source: { reviewStyle: settings.style, quickAutoAdvance: settings.autoAdvance } });
    if (!launch) return;
    try { sessionStorage.removeItem(QUICK_REVIEW_SESSION_KEY); } catch (_) {}
    const query = new URLSearchParams();
    query.set('review','1');
    query.set('from','review');
    query.set('return','../../review-history.html');
    query.set('context', launch.contextId);
    const style = clean(launch.source?.reviewStyle) === 'quick' ? 'quick' : 'deep';
    query.set('reviewstyle', style);
    if (style === 'quick') query.set('autonext', launch.source?.quickAutoAdvance === false ? '0' : '1');
    const index = openFromStart ? 0 : nextIndex(launch);
    query.set('s7card', String(index + 1));
    location.href = `./flashcards/wlp/batch.html?${query.toString()}`;
  }

  function actionButton(label, primary, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `review-history-action${primary ? ' is-primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function loadWordMap() {
    try {
      const response = await fetch(TSV_URL, { cache:'no-cache' });
      if (!response.ok) return;
      const rows = parseTSV(await response.text());
      wordMap = new Map(rows.map(row => [clean(row.WordID), clean(row.Word)]).filter(([id]) => id));
    } catch (_) {}
  }

  function renderCardList(context) {
    const list = $('review-history-card-list');
    const count = $('review-history-card-count');
    if (!list || !count) return;
    list.replaceChildren();
    const ids = sourceWordIds(context);
    count.textContent = `${ids.length.toLocaleString()} cards`;
    const quick = quickEventsFor(context.contextId);
    ids.forEach((wordId, index) => {
      const row = document.createElement('div');
      row.className = 'review-history-card-row';
      const name = document.createElement('div');
      name.className = 'review-history-card-name';
      const strong = document.createElement('strong');
      strong.textContent = wordMap.get(wordId) || `WID${wordId.replace(/^WID/i,'')}`;
      const small = document.createElement('small');
      small.textContent = `#${index + 1} · ${/^WID/i.test(wordId) ? wordId : `WID${wordId}`}`;
      name.append(strong, small);
      row.append(name);
      const event = quick.get(wordId);
      if (event) {
        const rating = document.createElement('span');
        rating.className = 'review-history-card-rating';
        rating.textContent = event.rating;
        row.append(rating);
      }
      list.append(row);
    });
  }

  async function renderDetail(context) {
    const listView = $('review-history-list-view');
    const detailView = $('review-history-detail-view');
    if (!listView || !detailView || !context) return;
    listView.hidden = true;
    detailView.hidden = false;
    $('review-history-title').textContent = 'Review Set';
    $('review-history-copy').textContent = 'A saved snapshot of one Study Review set.';
    $('review-history-detail-status').textContent = context.status === 'completed' ? 'Completed Review Set' : 'Incomplete Review Set';
    $('review-history-detail-when').textContent = formatWhen(reviewWhen(context));
    $('review-history-detail-title').textContent = context.source?.label || 'Review Set';
    const ids = sourceWordIds(context);
    $('review-history-detail-meta').textContent = `${reviewStyle(context)} · ${ids.length.toLocaleString()} cards`;

    const summary = $('review-history-detail-summary');
    summary.replaceChildren();
    const fresh = api?.uniqueWordIds(context.source?.freshWordIds || []) || [];
    const carry = api?.uniqueWordIds(context.source?.carryOverWordIds || []) || [];
    const mix = context.source?.attentionBreakdown || {};
    summary.append(
      summaryCell(ids.length.toLocaleString(), 'Cards'),
      summaryCell(reviewStyle(context), 'Style'),
      summaryCell(fresh.length.toLocaleString(), 'Fresh'),
      summaryCell(carry.length.toLocaleString(), 'Carry Over'),
      summaryCell(Number(mix.high || 0).toLocaleString(), 'High Attention'),
      summaryCell(Number(mix.medium || 0).toLocaleString(), 'Medium Attention')
    );

    const actions = $('review-history-detail-actions');
    actions.replaceChildren();
    if (context.status !== 'completed') actions.append(actionButton('Resume', true, () => launchContext(context, false, false)));
    else actions.append(actionButton('Open Set', true, () => launchContext(context, false, true)));
    actions.append(actionButton('Start Again', false, () => launchContext(context, true, true)));

    const quickSection = $('review-history-quick-section');
    const quickSummary = $('review-history-quick-summary');
    const isQuick = reviewStyle(context) === 'Quick';
    quickSection.hidden = !isQuick;
    quickSummary.replaceChildren();
    if (isQuick) {
      const counts = quickCounts(context.contextId);
      for (const key of ['again','hard','good','easy']) {
        const span = document.createElement('span');
        const strong = document.createElement('strong'); strong.textContent = counts[key].toLocaleString();
        const small = document.createElement('small'); small.textContent = key[0].toUpperCase() + key.slice(1);
        span.append(strong, small); quickSummary.append(span);
      }
    }
    await loadWordMap();
    renderCardList(context);
  }

  $('review-history-detail-back')?.addEventListener('click', () => { location.href = './review-history.html'; });
  renderList();
  const requested = clean(params.get('context'));
  if (requested) {
    const context = api?.getContext(requested);
    if (context?.sourceType === 'review-set') void renderDetail(context);
    else history.replaceState(null, '', './review-history.html');
  }
})();
