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
  let coverageMode = 'all';
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
    return meta && typeof meta === 'object' ? meta : null;
  }

  function escapeRegex(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function targetVariants(target) {
    const raw = clean(target).replace(/\s+/g, ' ');
    const values = new Set();
    const add = value => {
      const normalized = clean(value).replace(/\s+/g, ' ');
      if (normalized.length >= 2) values.add(normalized);
    };
    add(raw);
    const withoutParens = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    add(withoutParens);
    if (raw.includes('/')) {
      raw.split('/').forEach(part => {
        const normalized = clean(part);
        if (normalized.length >= 4) add(normalized);
      });
    }
    return Array.from(values).sort((a, b) => b.length - a.length);
  }

  function variantPattern(variant) {
    return variant
      .split(/\s+/)
      .filter(Boolean)
      .map(token => escapeRegex(token).replace(/['’]/g, "['’]").replace(/-/g, '[-‐‑‒–—]'))
      .join('\\s+');
  }

  function redactTarget(value, target) {
    let text = clean(value);
    let changed = false;
    if (!text || !clean(target)) return { text, changed };
    targetVariants(target).forEach(variant => {
      const pattern = variantPattern(variant);
      if (!pattern) return;
      const regex = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, 'giu');
      text = text.replace(regex, (match, prefix) => {
        changed = true;
        return `${prefix}_____`;
      });
    });
    return { text: text.replace(/\s{2,}/g, ' ').trim(), changed };
  }

  function meaningfulPrompt(value) {
    const text = clean(value).replace(/_+/g, '').replace(/[\s.,;:!?"'`()\[\]{}<>/\\|~@#$%^&*+=—–-]+/g, '');
    return text.length >= 8;
  }

  function sanitizeSituationPrompt(value, target) {
    let text = clean(value);
    if (!text) return '';

    // If a stored Situation ends with an explicit example that contains the
    // target (e.g. "The ending felt overwrought."), drop that example first.
    // This keeps Situation → Expression an open retrieval prompt instead of
    // turning it into an accidental cloze whenever possible.
    const exampleMarker = /\b(?:e\.?\s*g\.?|for example|for instance|example)\s*[:.,-]?\s*/ig;
    const matches = Array.from(text.matchAll(exampleMarker));
    for (const match of matches) {
      const trailing = text.slice(match.index);
      if (redactTarget(trailing, target).changed) {
        const before = text.slice(0, match.index).replace(/[\s,:;–—-]+$/g, '').trim();
        if (meaningfulPrompt(before)) {
          text = before;
          break;
        }
      }
    }

    return redactTarget(text, target).text;
  }

  function splitExamples(value) {
    return clean(value)
      .split(/\s+\/\s+|<br\s*\/?\s*>|\r?\n+/i)
      .map(clean)
      .filter(Boolean)
      .slice(0, 4);
  }

  function noteExcerpt(value) {
    const text = clean(value).replace(/\s+/g, ' ');
    if (text.length <= 360) return text;
    const slice = text.slice(0, 360);
    const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '));
    return `${slice.slice(0, boundary >= 160 ? boundary + 1 : 357).trim()}…`;
  }

  function baseExperience(row, meta, review) {
    const wordId = clean(row.WordID);
    return {
      wordId,
      row,
      meta: meta || {},
      alternatives: Array.isArray(meta?.alternativeExpressions) ? meta.alternativeExpressions : [],
      review: review || null
    };
  }

  function situationExperiences(row, meta, review) {
    const target = clean(row.Word);
    const base = baseExperience(row, meta, review);
    const situations = Array.isArray(meta?.situations) ? meta.situations.filter(item => clean(item?.anchor)) : [];
    const out = [];
    situations.forEach(situation => {
      const anchor = sanitizeSituationPrompt(situation?.anchor, target);
      if (!meaningfulPrompt(anchor)) return;
      const title = redactTarget(situation?.title, target).text;
      const need = redactTarget(situation?.communicativeNeed, target).text;
      out.push({
        ...base,
        kind: 'situation',
        situation,
        promptLabel: 'Situation',
        promptTitle: meaningfulPrompt(title) ? title : '',
        promptText: anchor,
        question: 'What might you naturally say?',
        responseHelp: 'Multiple answers can be natural. WLP is not treating this as a one-answer quiz.',
        communicativeNeed: meaningfulPrompt(need) ? need : ''
      });
    });
    return out;
  }

  function exampleExperiences(row, meta, review) {
    const target = clean(row.Word);
    const base = baseExperience(row, meta, review);
    return splitExamples(row['Example Sentence']).map(example => {
      const redacted = redactTarget(example, target);
      if (!redacted.changed || !meaningfulPrompt(redacted.text)) return null;
      return {
        ...base,
        kind: 'example',
        situation: null,
        promptLabel: 'Example context',
        promptTitle: '',
        promptText: redacted.text,
        question: 'What expression fits naturally here?',
        responseHelp: 'More than one answer may work. Reveal shows the WLP target for this card.',
        communicativeNeed: ''
      };
    }).filter(Boolean);
  }

  function definitionExperience(row, meta, review) {
    const target = clean(row.Word);
    const prompt = redactTarget(row.Definition, target).text;
    if (!meaningfulPrompt(prompt)) return null;
    return {
      ...baseExperience(row, meta, review),
      kind: 'definition',
      situation: null,
      promptLabel: 'Meaning cue',
      promptTitle: '',
      promptText: prompt,
      question: 'What word or expression matches this meaning?',
      responseHelp: 'Other expressions may fit too. Reveal shows the WLP target for this card.',
      communicativeNeed: ''
    };
  }

  function noteExperience(row, meta, review) {
    const target = clean(row.Word);
    const prompt = redactTarget(noteExcerpt(row['Note(s)']), target).text;
    if (!meaningfulPrompt(prompt)) return null;
    return {
      ...baseExperience(row, meta, review),
      kind: 'note',
      situation: null,
      promptLabel: 'Usage clue',
      promptTitle: '',
      promptText: prompt,
      question: 'What expression is this usage note pointing to?',
      responseHelp: 'Use the clue as a starting point. Reveal shows the WLP target for this card.',
      communicativeNeed: ''
    };
  }

  function experiencesForRow(row) {
    const wordId = clean(row.WordID);
    const meta = metadataFor(wordId) || {};
    const review = reviewByWordId.get(wordId) || null;
    const situations = situationExperiences(row, meta, review);
    if (coverageMode === 'situations') return situations;
    if (situations.length) return situations;
    const examples = exampleExperiences(row, meta, review);
    if (examples.length) return examples;
    const definition = definitionExperience(row, meta, review);
    if (definition) return [definition];
    const note = noteExperience(row, meta, review);
    return note ? [note] : [];
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
    selectedRows.forEach(row => pool.push(...experiencesForRow(row)));
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
      box.innerHTML = coverageMode === 'situations'
        ? '<strong>No safe saved situations here</strong><span>Try All eligible cards, another source, or add Situation metadata.</span>'
        : '<strong>No eligible card material here</strong><span>Try another source or deck.</span>';
      $('study-start').disabled = true;
      return;
    }
    const savedSituations = currentPool.filter(item => item.kind === 'situation').length;
    const cardCues = experiences - savedSituations;
    let detail = '';
    if (coverageMode === 'situations') detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'} · target leakage is masked`;
    else if (savedSituations && cardCues) detail = `${savedSituations} saved situations + ${cardCues} card-based cues`;
    else if (savedSituations) detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'}`;
    else detail = `${cardCues} card-based ${cardCues === 1 ? 'cue' : 'cues'}`;
    box.innerHTML = `<strong>${entries} ${entries === 1 ? 'entry' : 'entries'} · ${experiences} ${experiences === 1 ? 'experience' : 'experiences'}</strong><span>${detail}</span>`;
    $('study-start').disabled = false;
  }

  function setSourceMode(mode) {
    sourceMode = ['review', 'deck', 'range'].includes(mode) ? mode : 'review';
    document.querySelectorAll('[data-source-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.sourceMode === sourceMode));
    document.querySelectorAll('[data-source-config]').forEach(block => { block.hidden = block.dataset.sourceConfig !== sourceMode; });
    updateEligibility();
  }

  function setCoverageMode(mode) {
    coverageMode = mode === 'situations' ? 'situations' : 'all';
    document.querySelectorAll('[data-coverage-mode]').forEach(button => {
      const active = button.dataset.coverageMode === coverageMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
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
    return groupEntries
      .slice(0, Math.max(1, size))
      .map(([, items]) => shuffle(items)[0])
      .filter(Boolean);
  }

  function normalizeAnswer(value) {
    return clean(value).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function normalizedContains(haystack, needle) {
    const text = normalizeAnswer(haystack);
    const target = normalizeAnswer(needle);
    return Boolean(text && target && (` ${text} `).includes(` ${target} `));
  }

  function hintFor(item) {
    const target = clean(item.row?.Word);
    const sense = redactTarget(item.meta?.senseHook, target).text;
    if (meaningfulPrompt(sense)) return sense;
    const synonyms = redactTarget(item.row?.['Synonym(s)'], target).text;
    if (meaningfulPrompt(synonyms)) return `Related expression(s): ${synonyms}`;
    const first = Array.from(target)[0] || '';
    const words = target.split(/\s+/).filter(Boolean).length;
    return first ? `Starts with “${first}”${words > 1 ? ` · ${words} words in the headword` : ''}.` : 'No extra hint is stored for this entry yet.';
  }

  function relevantAlternatives(item) {
    const situationId = clean(item.situation?.situationId);
    return (item.alternatives || []).filter(alt => {
      const ids = Array.isArray(alt?.situationIds) ? alt.situationIds.map(clean).filter(Boolean) : [];
      return clean(alt?.expression) && (!ids.length || (situationId && ids.includes(situationId)));
    });
  }

  function responseNote(item) {
    const answer = clean($('study-response').value);
    if (!answer) return '';
    const target = clean(item.row?.Word);
    if (normalizeAnswer(answer) === normalizeAnswer(target)) return 'You produced the target expression.';
    if (normalizedContains(answer, target)) return 'Your response includes the target expression.';
    const matchedAlternative = relevantAlternatives(item).find(alt => normalizedContains(answer, alt.expression));
    if (matchedAlternative) return 'Your response includes a linked alternative for this experience.';
    return 'Keep your response as a comparison point. This version does not grade open-ended answers.';
  }

  function renderExperience() {
    const item = sessionQueue[sessionIndex];
    if (!item) return finishSession();
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = true;
    $('study-experience').hidden = false;
    $('study-experience-source').textContent = sourceLabel(lastSessionSpec?.mode || sourceMode);
    $('study-experience-progress').textContent = `${sessionIndex + 1} / ${sessionQueue.length}`;

    $('study-prompt-label').textContent = item.promptLabel || 'Situation';
    const title = clean(item.promptTitle);
    $('study-situation-title').hidden = !title;
    $('study-situation-title').textContent = title;
    $('study-situation-anchor').textContent = clean(item.promptText);
    $('study-response-question').textContent = item.question || 'What might you naturally say?';
    $('study-response-help').textContent = item.responseHelp || 'Multiple answers can be natural.';
    $('study-response').value = '';

    const need = clean(item.communicativeNeed);
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
    $('study-finished-copy').textContent = `You worked through ${sessionQueue.length} ${sessionQueue.length === 1 ? 'experience' : 'experiences'} from ${sourceLabel(lastSessionSpec?.mode || sourceMode)}.`;
    $('study-finished').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startSession() {
    updateEligibility();
    if (!currentPool.length) return;
    const size = Number($('study-session-size').value) || 10;
    lastSessionSpec = {
      mode: sourceMode,
      coverage: coverageMode,
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
    coverageMode = lastSessionSpec.coverage || 'all';
    $('study-deck').value = lastSessionSpec.deck;
    $('study-range-start').value = lastSessionSpec.rangeStart;
    $('study-range-end').value = lastSessionSpec.rangeEnd;
    $('study-session-size').value = String(lastSessionSpec.size);
    setCoverageMode(coverageMode);
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
    document.querySelectorAll('[data-coverage-mode]').forEach(button => button.addEventListener('click', () => setCoverageMode(button.dataset.coverageMode)));
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
    const initialDeck = clampDeck(recentDeck || Number(rows[0]?.['Batch #']) || 1);
    $('study-deck').value = String(initialDeck);
    $('study-range-start').value = String(initialDeck);
    $('study-range-end').value = String(Math.min(maxDeck, initialDeck + 4));

    setCoverageMode('all');
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
