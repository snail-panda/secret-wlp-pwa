(() => {
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const $ = id => document.getElementById(id);

  let rows = [];
  let rowByWordId = new Map();
  let maxDeck = 1;
  let sourceMode = 'review';
  let reviewByWordId = new Map();
  let currentPool = [];
  let sessionQueue = [];
  let sessionIndex = 0;
  let lastSessionSpec = null;

  const clean = value => String(value ?? '').trim();
  const clampDeck = value => Math.max(1, Math.min(maxDeck, Math.round(Number(value) || 1)));

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
        if (row.some(value => clean(value))) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(value => clean(value))) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(clean);
    return table.slice(1).map(cols => Object.fromEntries(headers.map((header, index) => [header, clean(cols[index])] )));
  }

  function readOverrides() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }

  function applyOverrides(masterRows) {
    const overrides = readOverrides();
    return masterRows.map(row => {
      const wordId = clean(row.WordID);
      const edit = overrides[wordId];
      return edit && typeof edit === 'object'
        ? { ...row, ...edit, WordID: row.WordID, 'Batch #': row['Batch #'] }
        : { ...row };
    });
  }

  function readReviewMap() {
    const out = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const wordId = clean(data.wordId || key.slice(PROGRESS_PREFIX.length));
        const isReview = data.review === true || data.lastResult === 'review';
        if (!wordId || !isReview) continue;
        const level = ['high', 'medium', 'light'].includes(clean(data.reviewLevel).toLowerCase())
          ? clean(data.reviewLevel).toLowerCase() : '';
        out.set(wordId, { ...data, wordId, reviewLevel: level });
      } catch (error) {
        console.warn('Could not read Study Q review record', key, error);
      }
    }
    return out;
  }

  function metadataFor(wordId) {
    const api = window.WLPLearningHooks;
    if (!api || typeof api.getForMaster !== 'function') return null;
    const meta = api.getForMaster(wordId);
    return meta && Array.isArray(meta.situations) ? meta : null;
  }

  function experiencePoolFor(mode = sourceMode) {
    let selectedRows = rows;
    if (mode === 'review') selectedRows = rows.filter(row => reviewByWordId.has(clean(row.WordID)));
    if (mode === 'deck') {
      const deck = clampDeck($('study-deck').value);
      selectedRows = rows.filter(row => Number(row['Batch #']) === deck);
    }
    if (mode === 'range') {
      let start = clampDeck($('study-range-start').value);
      let end = clampDeck($('study-range-end').value);
      if (start > end) [start, end] = [end, start];
      selectedRows = rows.filter(row => {
        const deck = Number(row['Batch #']);
        return deck >= start && deck <= end;
      });
    }

    const pool = [];
    selectedRows.forEach(row => {
      const wordId = clean(row.WordID);
      const meta = metadataFor(wordId);
      if (!meta) return;
      const situations = Array.isArray(meta.situations) ? meta.situations.filter(item => clean(item?.anchor)) : [];
      if (!situations.length) return;
      const alternatives = Array.isArray(meta.alternativeExpressions) ? meta.alternativeExpressions : [];
      situations.forEach(situation => {
        pool.push({
          wordId,
          row,
          meta,
          situation,
          alternatives,
          review: reviewByWordId.get(wordId) || null
        });
      });
    });
    return pool;
  }

  function sourceLabel(mode = sourceMode) {
    if (mode === 'review') return 'Review';
    if (mode === 'deck') return `WLP${String(clampDeck($('study-deck').value)).padStart(3, '0')}`;
    let start = clampDeck($('study-range-start').value), end = clampDeck($('study-range-end').value);
    if (start > end) [start, end] = [end, start];
    return `WLP${String(start).padStart(3, '0')}–${String(end).padStart(3, '0')}`;
  }

  function updateEligibility() {
    currentPool = experiencePoolFor();
    const entries = new Set(currentPool.map(item => item.wordId)).size;
    const experiences = currentPool.length;
    const box = $('study-eligibility');
    if (!experiences) {
      box.innerHTML = '<strong>No eligible situations yet</strong><span>Try another source, or add Situation metadata in the Editor.</span>';
      $('study-start').disabled = true;
      return;
    }
    box.innerHTML = `<strong>${entries} ${entries === 1 ? 'entry' : 'entries'} · ${experiences} ${experiences === 1 ? 'situation' : 'situations'}</strong><span>Available for Situation → Expression.</span>`;
    $('study-start').disabled = false;
  }

  function setSourceMode(mode) {
    sourceMode = ['review', 'deck', 'range'].includes(mode) ? mode : 'review';
    document.querySelectorAll('[data-source-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.sourceMode === sourceMode));
    document.querySelectorAll('[data-source-config]').forEach(block => { block.hidden = block.dataset.sourceConfig !== sourceMode; });
    updateEligibility();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function reviewRank(item) {
    return ({ high: 0, medium: 1, light: 2, '': 3 })[clean(item?.review?.reviewLevel).toLowerCase()] ?? 3;
  }

  function buildQueue(pool, size, mode) {
    const groups = new Map();
    pool.forEach(item => {
      if (!groups.has(item.wordId)) groups.set(item.wordId, []);
      groups.get(item.wordId).push(item);
    });
    let groupEntries = shuffle(Array.from(groups.entries()));
    if (mode === 'review') groupEntries.sort((a, b) => reviewRank(a[1][0]) - reviewRank(b[1][0]));

    const firstPass = [];
    const extras = [];
    groupEntries.forEach(([, items]) => {
      const mixed = shuffle(items);
      if (mixed[0]) firstPass.push(mixed[0]);
      if (mixed.length > 1) extras.push(...mixed.slice(1));
    });
    const orderedExtras = mode === 'review'
      ? shuffle(extras).sort((a, b) => reviewRank(a) - reviewRank(b))
      : shuffle(extras);
    return [...firstPass, ...orderedExtras].slice(0, Math.max(1, size));
  }

  function normalizeAnswer(value) {
    return clean(value).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function hintFor(item) {
    const sense = clean(item.meta?.senseHook);
    if (sense) return sense;
    const target = clean(item.row?.Word);
    const first = Array.from(target)[0] || '';
    const words = target.split(/\s+/).filter(Boolean).length;
    return first ? `Starts with “${first}”${words > 1 ? ` · ${words} words in the headword` : ''}.` : 'No extra hint is stored for this entry yet.';
  }

  function relevantAlternatives(item) {
    const situationId = clean(item.situation?.situationId);
    return (item.alternatives || []).filter(alt => {
      const ids = Array.isArray(alt?.situationIds) ? alt.situationIds.map(clean).filter(Boolean) : [];
      return clean(alt?.expression) && (!ids.length || ids.includes(situationId));
    });
  }

  function responseNote(item) {
    const answer = normalizeAnswer($('study-response').value);
    if (!answer) return '';
    const target = normalizeAnswer(item.row?.Word);
    if (answer === target) return 'You produced the target expression.';
    const matchedAlternative = relevantAlternatives(item).find(alt => normalizeAnswer(alt.expression) === answer);
    if (matchedAlternative) return 'Your response matches a linked alternative for this situation.';
    return 'Keep your response as a comparison point. This first version does not grade open-ended answers.';
  }

  function renderExperience() {
    const item = sessionQueue[sessionIndex];
    if (!item) return finishSession();
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = true;
    $('study-experience').hidden = false;
    $('study-experience-source').textContent = sourceLabel(lastSessionSpec?.mode || sourceMode);
    $('study-experience-progress').textContent = `${sessionIndex + 1} / ${sessionQueue.length}`;

    const title = clean(item.situation?.title);
    $('study-situation-title').hidden = !title;
    $('study-situation-title').textContent = title;
    $('study-situation-anchor').textContent = clean(item.situation?.anchor);
    $('study-response').value = '';

    const need = clean(item.situation?.communicativeNeed);
    $('study-show-need').hidden = !need;
    $('study-need-block').hidden = true;
    $('study-need').textContent = need;
    $('study-hint-block').hidden = true;
    $('study-hint').textContent = hintFor(item);
    $('study-target-reveal').hidden = true;
    $('study-target').textContent = clean(item.row?.Word) || `WID ${item.wordId}`;
    const entryType = clean(item.meta?.entryType);
    $('study-target-type').hidden = !entryType;
    $('study-target-type').textContent = entryType ? `type: ${entryType === 'conversational frame' ? 'conv. frame' : entryType}` : '';
    $('study-response-note').hidden = true;
    $('study-response-note').textContent = '';

    const deck = Number(item.row?.['Batch #']) || 0;
    const batch = deck ? String(deck).padStart(3, '0') : '';
    $('study-open-card').href = batch
      ? `./flashcards/wlp/batch.html?batch=${encodeURIComponent(batch)}&wordid=${encodeURIComponent(item.wordId)}&solo=1&from=studyq`
      : './deck-browser.html';
    $('study-next').textContent = sessionIndex === sessionQueue.length - 1 ? 'Finish Session' : 'Next Experience';

    const alternatives = relevantAlternatives(item);
    $('study-alternatives').hidden = !alternatives.length;
    $('study-alternative-list').innerHTML = alternatives.map(alt => {
      const note = clean(alt.note);
      return `<div class="study-alternative-item"><strong>${escapeHtml(alt.expression)}</strong>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div>`;
    }).join('');

    $('study-experience').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function showTarget() {
    const item = sessionQueue[sessionIndex];
    if (!item) return;
    const note = responseNote(item);
    $('study-response-note').hidden = !note;
    $('study-response-note').textContent = note;
    $('study-target-reveal').hidden = false;
    $('study-target-reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function nextExperience() {
    if (sessionIndex >= sessionQueue.length - 1) return finishSession();
    sessionIndex++;
    renderExperience();
  }

  function finishSession() {
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = false;
    $('study-finished-copy').textContent = `You worked through ${sessionQueue.length} ${sessionQueue.length === 1 ? 'situation' : 'situations'} from ${sourceLabel(lastSessionSpec?.mode || sourceMode)}.`;
    $('study-finished').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startSession() {
    updateEligibility();
    if (!currentPool.length) return;
    const size = Number($('study-session-size').value) || 10;
    lastSessionSpec = {
      mode: sourceMode,
      deck: clampDeck($('study-deck').value),
      rangeStart: clampDeck($('study-range-start').value),
      rangeEnd: clampDeck($('study-range-end').value),
      size
    };
    sessionQueue = buildQueue(currentPool, size, sourceMode);
    sessionIndex = 0;
    renderExperience();
  }

  function restoreSessionSpecAndRestart() {
    if (!lastSessionSpec) return startSession();
    sourceMode = lastSessionSpec.mode;
    $('study-deck').value = lastSessionSpec.deck;
    $('study-range-start').value = lastSessionSpec.rangeStart;
    $('study-range-end').value = lastSessionSpec.rangeEnd;
    $('study-session-size').value = String(lastSessionSpec.size);
    setSourceMode(sourceMode);
    startSession();
  }

  function changeSet() {
    $('study-finished').hidden = true;
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = false;
    document.querySelector('.study-hub-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function installEvents() {
    document.querySelectorAll('[data-source-mode]').forEach(button => button.addEventListener('click', () => setSourceMode(button.dataset.sourceMode)));
    ['study-deck', 'study-range-start', 'study-range-end', 'study-session-size'].forEach(id => $(id).addEventListener('change', updateEligibility));
    ['study-deck', 'study-range-start', 'study-range-end'].forEach(id => $(id).addEventListener('input', updateEligibility));
    $('study-start').addEventListener('click', startSession);
    $('study-show-need').addEventListener('click', () => { $('study-need-block').hidden = false; });
    $('study-show-hint').addEventListener('click', () => { $('study-hint-block').hidden = false; });
    $('study-show-target').addEventListener('click', showTarget);
    $('study-next').addEventListener('click', nextExperience);
    $('study-again').addEventListener('click', restoreSessionSpecAndRestart);
    $('study-change-set').addEventListener('click', changeSet);
  }

  function setDefaults() {
    maxDeck = Math.max(1, ...rows.map(row => Number(row['Batch #']) || 0));
    ['study-deck', 'study-range-start', 'study-range-end'].forEach(id => { $(id).max = String(maxDeck); });

    let recentDeck = 0;
    try {
      const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(recent) && Number.isFinite(recent[0])) recentDeck = Number(recent[0]);
    } catch {}
    const rowsWithSituations = rows.filter(row => {
      const meta = metadataFor(clean(row.WordID));
      return meta && Array.isArray(meta.situations) && meta.situations.some(item => clean(item?.anchor));
    });
    const metadataDeck = rowsWithSituations[0];
    const recentHasSituations = recentDeck && rowsWithSituations.some(row => Number(row['Batch #']) === recentDeck);
    const initialDeck = clampDeck((recentHasSituations ? recentDeck : 0) || Number(metadataDeck?.['Batch #']) || recentDeck || 1);
    $('study-deck').value = String(initialDeck);
    $('study-range-start').value = String(initialDeck);
    $('study-range-end').value = String(Math.min(maxDeck, initialDeck + 4));

    const reviewExperiences = experiencePoolFor('review');
    setSourceMode(reviewExperiences.length ? 'review' : 'deck');
  }

  installEvents();
  (async () => {
    try {
      const response = await fetch(MASTER_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Master TSV ${response.status}`);
      rows = applyOverrides(parseTSV(await response.text()));
      rowByWordId = new Map(rows.map(row => [clean(row.WordID), row]).filter(([wordId]) => wordId));
      reviewByWordId = readReviewMap();
      setDefaults();
    } catch (error) {
      console.error('Study Q could not load', error);
      $('study-eligibility').innerHTML = '<strong>Study data could not be loaded</strong><span>Reload when the Master TSV is available.</span>';
      $('study-start').disabled = true;
    }
  })();
})();
