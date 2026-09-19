(() => {
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_EVENT_LIMIT = 1200;
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
  let sessionAttempts = [];
  let currentAttempt = null;

  const clean = value => String(value ?? '').trim();
  const stripInvisible = value => String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ');
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
    const raw = stripInvisible(clean(target)).normalize('NFKC').replace(/\s+/g, ' ');
    const values = new Set();
    const add = value => {
      const normalized = stripInvisible(clean(value)).normalize('NFKC').replace(/\s+/g, ' ');
      if (normalized.length >= 2) values.add(normalized);
    };
    add(raw);
    const withoutParens = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    add(withoutParens);
    if (/^(?:to|be)\s+/i.test(withoutParens) && withoutParens.split(/\s+/).length > 1) {
      add(withoutParens.replace(/^(?:to|be)\s+/i, ''));
    }
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
    let text = stripInvisible(clean(value)).normalize('NFKC');
    let changed = false;
    const safeTarget = stripInvisible(clean(target)).normalize('NFKC');
    if (!text || !safeTarget) return { text, changed };
    targetVariants(safeTarget).forEach(variant => {
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

  function hasTargetLeak(value, target) {
    return redactTarget(value, target).changed;
  }

  function safePrompt(value, target) {
    const redacted = redactTarget(value, target);
    if (!meaningfulPrompt(redacted.text)) return { text: '', changed: redacted.changed };
    if (hasTargetLeak(redacted.text, target)) return { text: '', changed: true };
    return redacted;
  }

  function definitionCue(value, target) {
    const redacted = safePrompt(value, target);
    let prompt = redacted.text;
    if (!prompt || !redacted.changed) return prompt;

    let match = prompt.match(/^(Depending on context,\s*)?(?:an?\s+|the\s+)?_+\s+(?:may|can)\s+be\s+(.+)$/i);
    if (match) {
      const lead = match[1] ? 'Depending on context, ' : '';
      prompt = `${lead}possible senses include ${match[2]}`;
      return prompt.charAt(0).toUpperCase() + prompt.slice(1);
    }

    match = prompt.match(/^(?:an?\s+|the\s+)?_+\s+(?:means?|refers? to|is|are)\s+(.+)$/i);
    if (match && meaningfulPrompt(match[1])) {
      const rest = match[1].trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return prompt;
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

    return safePrompt(text, target).text;
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
      const title = safePrompt(situation?.title, target).text;
      const need = safePrompt(situation?.communicativeNeed, target).text;
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
      const redacted = safePrompt(example, target);
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
    const prompt = definitionCue(row.Definition, target);
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
    const prompt = safePrompt(noteExcerpt(row['Note(s)']), target).text;
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
    const requested = Math.max(1, Number($('study-session-size').value) || 10);
    const sessionLength = Math.min(entries, requested);
    let detail = '';
    if (coverageMode === 'situations') detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'} available · one target appears once per session`;
    else if (savedSituations && cardCues) detail = `${savedSituations} saved situations + ${cardCues} card-based cues · one target appears once per session`;
    else if (savedSituations) detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'} · one target appears once per session`;
    else detail = `${cardCues} card-based ${cardCues === 1 ? 'cue' : 'cues'} · one target appears once per session`;
    box.innerHTML = `<strong>${entries} eligible ${entries === 1 ? 'entry' : 'entries'} · ${sessionLength} this session</strong><span>${detail}</span>`;
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
    return stripInvisible(clean(value)).normalize('NFKC').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizedContains(haystack, needle) {
    const text = normalizeAnswer(haystack);
    const target = normalizeAnswer(needle);
    return Boolean(text && target && (` ${text} `).includes(` ${target} `));
  }

  function editDistance(a, b) {
    const left = String(a || ''), right = String(b || '');
    if (!left) return right.length;
    if (!right) return left.length;
    const row = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const old = row[j];
        row[j] = left[i - 1] === right[j - 1]
          ? previous
          : Math.min(previous + 1, row[j] + 1, row[j - 1] + 1);
        previous = old;
      }
    }
    return row[right.length];
  }

  function responseMatch(item, answerValue = $('study-response').value) {
    const answer = clean(answerValue);
    if (!answer) return { kind: 'blank', alternative: '' };
    const target = clean(item.row?.Word);
    if (normalizeAnswer(answer) === normalizeAnswer(target)) return { kind: 'target-exact', alternative: '' };
    if (normalizedContains(answer, target)) return { kind: 'target-contained', alternative: '' };
    const matchedAlternative = relevantAlternatives(item).find(alt => normalizedContains(answer, alt.expression));
    if (matchedAlternative) return { kind: 'alternative', alternative: clean(matchedAlternative.expression) };
    const normalizedTarget = normalizeAnswer(target);
    if (/^[a-z][a-z'-]{3,}$/.test(normalizedTarget)) {
      const closeToken = normalizeAnswer(answer).split(/\s+/).find(token => Math.abs(token.length - normalizedTarget.length) <= 1 && editDistance(token, normalizedTarget) <= 1);
      if (closeToken) return { kind: 'near-target', alternative: '' };
    }
    return { kind: 'other', alternative: '' };
  }

  function makeEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `studyq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readStudyEvents() {
    try {
      const value = JSON.parse(localStorage.getItem(STUDYQ_EVENT_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function persistAttempt(attempt, completed = false) {
    if (!attempt) return;
    try {
      const now = new Date().toISOString();
      attempt.updatedAt = now;
      if (completed && !attempt.completedAt) attempt.completedAt = now;
      const serializable = { ...attempt };
      delete serializable._startedMs;
      const events = readStudyEvents();
      const index = events.findIndex(event => event?.eventId === serializable.eventId);
      if (index >= 0) events[index] = serializable;
      else events.push(serializable);
      localStorage.setItem(STUDYQ_EVENT_KEY, JSON.stringify(events.slice(-STUDYQ_EVENT_LIMIT)));
    } catch (error) {
      console.warn('Could not save Study Q activity', error);
    }
  }

  function beginAttempt(item) {
    const now = new Date().toISOString();
    currentAttempt = {
      schemaVersion: 1,
      eventId: makeEventId(),
      startedAt: now,
      updatedAt: now,
      completedAt: '',
      wordId: item.wordId,
      batch: Number(item.row?.['Batch #']) || 0,
      target: clean(item.row?.Word),
      entryType: clean(item.meta?.entryType),
      sourceMode: lastSessionSpec?.mode || sourceMode,
      sourceLabel: sourceLabel(lastSessionSpec?.mode || sourceMode),
      coverageMode: lastSessionSpec?.coverage || coverageMode,
      promptKind: item.kind,
      situationId: clean(item.situation?.situationId),
      communicativeNeedShown: false,
      hintShown: false,
      targetShown: false,
      responseText: '',
      autoMatch: 'blank',
      matchedAlternative: '',
      selfRating: '',
      elapsedMs: 0,
      _startedMs: Date.now()
    };
    sessionAttempts[sessionIndex] = currentAttempt;
  }

  function snapshotResponse(item) {
    if (!currentAttempt || !item) return;
    const answer = clean($('study-response').value).slice(0, 800);
    const match = responseMatch(item, answer);
    currentAttempt.responseText = answer;
    currentAttempt.autoMatch = match.kind;
    currentAttempt.matchedAlternative = match.alternative || '';
    currentAttempt.elapsedMs = Math.max(0, Date.now() - (currentAttempt._startedMs || Date.now()));
  }

  function setSelfRating(rating) {
    if (!currentAttempt || !['got-it', 'almost', 'not-yet', 'no-idea'].includes(rating)) return;
    const item = sessionQueue[sessionIndex];
    if (item) { snapshotResponse(item); renderCurrentAnswerReview(item); }
    currentAttempt.selfRating = rating;
    currentAttempt.elapsedMs = Math.max(0, Date.now() - (currentAttempt._startedMs || Date.now()));
    document.querySelectorAll('[data-study-rating]').forEach(button => {
      const selected = button.dataset.studyRating === rating;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    const labels = { 'got-it': 'Got it', almost: 'Almost', 'not-yet': 'Not yet', 'no-idea': 'No idea' };
    $('study-self-check-status').textContent = `Saved locally · self-check: ${labels[rating]}.`;
    persistAttempt(currentAttempt, false);
  }

  function finalizeCurrentAttempt() {
    const item = sessionQueue[sessionIndex];
    if (!currentAttempt || !item) return;
    snapshotResponse(item);
    currentAttempt.elapsedMs = Math.max(0, Date.now() - (currentAttempt._startedMs || Date.now()));
    persistAttempt(currentAttempt, true);
  }

  function hintFor(item) {
    const target = clean(item.row?.Word);
    const sense = safePrompt(item.meta?.senseHook, target).text;
    if (meaningfulPrompt(sense)) return sense;
    const synonyms = safePrompt(item.row?.['Synonym(s)'], target).text;
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
    const match = responseMatch(item);
    if (match.kind === 'blank') return 'No typed response to compare. You can still self-check based on what you said or thought.';
    if (match.kind === 'target-exact') return 'Matches the stored WLP target — exact form.';
    if (match.kind === 'target-contained') return 'Your response includes the stored WLP target.';
    if (match.kind === 'alternative') return `Matches a linked natural alternative: ${match.alternative}.`;
    if (match.kind === 'near-target') return 'Very close to the stored WLP target form. You decide whether this counts for you.';
    return 'Different from the stored WLP target. Compare them, then make your own self-check.';
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
    $('study-answer-review').hidden = true;
    $('study-answer-text').textContent = '';
    $('study-answer-review-action').replaceChildren();
    document.querySelectorAll('[data-study-rating]').forEach(button => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
    $('study-self-check-status').textContent = 'Not rated yet · activity is still saved locally.';

    $('study-open-card').dataset.wordId = item.wordId;
    $('study-next').textContent = sessionIndex === sessionQueue.length - 1 ? 'Finish Session' : 'Next Experience';

    const alternatives = relevantAlternatives(item);
    $('study-alternatives').hidden = !alternatives.length;
    $('study-alternative-list').innerHTML = alternatives.map(alt => {
      const note = clean(alt.note);
      return `<div class="study-alternative-item"><strong>${escapeHtml(alt.expression)}</strong>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div>`;
    }).join('');

    beginAttempt(item);
    $('study-experience').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }


  function padDeck(value) {
    return String(Math.max(0, Number(value) || 0)).padStart(3, '0');
  }

  function cardHrefForRow(row) {
    const deck = Number(row?.['Batch #']) || 0;
    const wordId = clean(row?.WordID);
    return deck && wordId
      ? `./flashcards/wlp/batch.html?batch=${encodeURIComponent(padDeck(deck))}&wordid=${encodeURIComponent(wordId)}&solo=1`
      : './deck-browser.html';
  }

  function exactHeadwordRows(answer) {
    const normalized = normalizeAnswer(answer);
    if (!normalized) return [];
    return rows.filter(row => normalizeAnswer(row?.Word) === normalized);
  }

  function searchHrefFor(answer) {
    const query = clean(answer);
    return `./global-search.html?q=${encodeURIComponent(query)}&return=${encodeURIComponent('study-hub.html')}`;
  }

  function ratingLabel(rating) {
    return ({ 'got-it': 'Got it', almost: 'Almost', 'not-yet': 'Not yet', 'no-idea': 'No idea' })[rating] || 'Not rated';
  }

  function matchLabel(attempt) {
    const kind = clean(attempt?.autoMatch);
    if (kind === 'target-exact') return 'Matches target · exact form';
    if (kind === 'target-contained') return 'Includes the WLP target';
    if (kind === 'alternative') return attempt?.matchedAlternative ? `Linked alternative · ${attempt.matchedAlternative}` : 'Linked alternative';
    if (kind === 'near-target') return 'Very close to target form';
    if (kind === 'other') return 'Different from stored target';
    return 'No typed answer';
  }

  function appendAnswerAction(container, answer, compact = false) {
    container.replaceChildren();
    const value = clean(answer);
    if (!value) return;
    const matches = exactHeadwordRows(value);
    if (matches.length === 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.quickCardWordId = clean(matches[0].WordID);
      button.textContent = compact ? 'Open answer card' : 'Check answer card';
      container.append(button);
      return;
    }
    const link = document.createElement('a');
    link.href = searchHrefFor(value);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = matches.length > 1 ? 'Search matching cards ↗' : 'Search WLP ↗';
    container.append(link);
  }

  function renderCurrentAnswerReview(item) {
    const answer = clean($('study-response').value);
    if (!answer) {
      $('study-answer-review').hidden = true;
      $('study-answer-text').textContent = '';
      $('study-answer-review-action').replaceChildren();
      return;
    }
    $('study-answer-review').hidden = false;
    $('study-answer-text').textContent = answer;
    appendAnswerAction($('study-answer-review-action'), answer);
  }

  function quickCardField(label, value) {
    const text = clean(value);
    if (!text) return null;
    const field = document.createElement('div');
    field.className = 'study-quick-card-field';
    const title = document.createElement('span');
    title.textContent = label;
    const copy = document.createElement('p');
    copy.textContent = text;
    field.append(title, copy);
    return field;
  }

  function openQuickCard(wordId) {
    const row = rowByWordId.get(clean(wordId));
    if (!row) return;
    const meta = metadataFor(clean(wordId)) || {};
    $('study-quick-card-title').textContent = clean(row.Word) || `WID ${wordId}`;
    const deck = Number(row['Batch #']) || 0;
    $('study-quick-card-location').textContent = `${deck ? `WLP${padDeck(deck)} · ` : ''}WID${clean(row.WordID)}`;
    const metaBits = [clean(row.IPA), clean(row['Part of Speech']), clean(meta.entryType) ? `type: ${meta.entryType}` : ''].filter(Boolean);
    $('study-quick-card-meta').textContent = metaBits.join(' · ');
    const fields = [
      quickCardField('Definition', row.Definition),
      quickCardField('Synonyms', row['Synonym(s)']),
      quickCardField('Example', row['Example Sentence']),
      quickCardField('Notes', row['Note(s)']),
      quickCardField('Sense Hook', meta.senseHook),
      quickCardField('Memory Hook', meta.memoryHook)
    ].filter(Boolean);
    $('study-quick-card-fields').replaceChildren(...fields);
    $('study-quick-card-full').href = cardHrefForRow(row);
    $('study-quick-card-modal').hidden = false;
    document.body.classList.add('study-quick-card-open');
    setTimeout(() => $('study-quick-card-close').focus({ preventScroll: true }), 0);
  }

  function closeQuickCard() {
    $('study-quick-card-modal').hidden = true;
    document.body.classList.remove('study-quick-card-open');
  }

  function renderSessionReview() {
    const list = $('study-session-review-list');
    list.replaceChildren();
    sessionQueue.forEach((item, index) => {
      const attempt = sessionAttempts[index] || {};
      const article = document.createElement('article');
      article.className = 'study-session-review-item';

      const top = document.createElement('div');
      top.className = 'study-session-review-top';
      const idx = document.createElement('span');
      idx.className = 'study-session-review-index';
      idx.textContent = `${index + 1} · ${item.promptLabel || item.kind || 'Experience'}`;
      const rating = document.createElement('span');
      rating.className = 'study-session-review-rating';
      rating.textContent = ratingLabel(attempt.selfRating);
      top.append(idx, rating);

      const target = document.createElement('div');
      target.className = 'study-session-review-target';
      const targetWord = document.createElement('strong');
      targetWord.textContent = clean(item.row?.Word) || `WID ${item.wordId}`;
      const targetButton = document.createElement('button');
      targetButton.type = 'button';
      targetButton.dataset.quickCardWordId = item.wordId;
      targetButton.textContent = 'Open Card';
      target.append(targetWord, targetButton);

      const answerBox = document.createElement('div');
      answerBox.className = 'study-session-review-answer';
      const answerLabel = document.createElement('span');
      answerLabel.textContent = 'Your answer';
      const answerRow = document.createElement('div');
      answerRow.className = 'study-session-review-answer-row';
      const answerText = document.createElement('p');
      answerText.textContent = clean(attempt.responseText) || '—';
      const answerActions = document.createElement('div');
      answerActions.className = 'study-session-review-answer-actions';
      appendAnswerAction(answerActions, attempt.responseText, true);
      answerRow.append(answerText, answerActions);
      const match = document.createElement('div');
      match.className = 'study-session-review-match';
      match.textContent = matchLabel(attempt);
      answerBox.append(answerLabel, answerRow, match);

      article.append(top, target, answerBox);
      list.append(article);
    });
    $('study-session-review').hidden = !sessionQueue.length;
  }

  function showTarget() {
    const item = sessionQueue[sessionIndex];
    if (!item) return;
    if (currentAttempt?.targetShown) {
      $('study-target-reveal').hidden = false;
      $('study-target-reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    snapshotResponse(item);
    if (currentAttempt) {
      currentAttempt.targetShown = true;
      currentAttempt.targetShownAt = new Date().toISOString();
      persistAttempt(currentAttempt, false);
    }
    const note = responseNote(item);
    $('study-response-note').hidden = !note;
    $('study-response-note').textContent = note;
    renderCurrentAnswerReview(item);
    $('study-target-reveal').hidden = false;
    $('study-target-reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function nextExperience() {
    finalizeCurrentAttempt();
    if (sessionIndex >= sessionQueue.length - 1) return finishSession(false);
    sessionIndex++;
    renderExperience();
  }

  function finishSession(finalize = true) {
    if (finalize) finalizeCurrentAttempt();
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = false;
    $('study-finished-copy').textContent = `You worked through ${sessionQueue.length} ${sessionQueue.length === 1 ? 'experience' : 'experiences'} from ${sourceLabel(lastSessionSpec?.mode || sourceMode)}.`;
    const counts = { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0, unrated: 0 };
    sessionAttempts.forEach(attempt => {
      const rating = attempt?.selfRating;
      if (rating && Object.prototype.hasOwnProperty.call(counts, rating)) counts[rating]++;
      else counts.unrated++;
    });
    const pieces = [];
    if (counts['got-it']) pieces.push(`${counts['got-it']} Got it`);
    if (counts.almost) pieces.push(`${counts.almost} Almost`);
    if (counts['not-yet']) pieces.push(`${counts['not-yet']} Not yet`);
    if (counts['no-idea']) pieces.push(`${counts['no-idea']} No idea`);
    if (counts.unrated) pieces.push(`${counts.unrated} not rated`);
    $('study-finished-summary').hidden = !pieces.length;
    $('study-finished-summary').textContent = pieces.length ? `Your self-check: ${pieces.join(' · ')}. Saved on this device.` : '';
    renderSessionReview();
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
    sessionAttempts = [];
    currentAttempt = null;
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
    $('study-show-need').addEventListener('click', () => {
      $('study-need-block').hidden = false;
      if (currentAttempt) { currentAttempt.communicativeNeedShown = true; currentAttempt.communicativeNeedShownAt = new Date().toISOString(); }
    });
    $('study-show-hint').addEventListener('click', () => {
      $('study-hint-block').hidden = false;
      if (currentAttempt) { currentAttempt.hintShown = true; currentAttempt.hintShownAt = new Date().toISOString(); }
    });
    $('study-show-target').addEventListener('click', showTarget);
    $('study-open-card').addEventListener('click', () => openQuickCard($('study-open-card').dataset.wordId));
    document.querySelectorAll('[data-study-rating]').forEach(button => button.addEventListener('click', () => setSelfRating(button.dataset.studyRating)));
    $('study-next').addEventListener('click', nextExperience);
    $('study-again').addEventListener('click', restoreSessionSpecAndRestart);
    $('study-change-set').addEventListener('click', changeSet);
    $('study-quick-card-close').addEventListener('click', closeQuickCard);
    $('study-quick-card-done').addEventListener('click', closeQuickCard);
    $('study-quick-card-modal').addEventListener('click', event => { if (event.target === $('study-quick-card-modal')) closeQuickCard(); });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-quick-card-word-id]');
      if (button) openQuickCard(button.dataset.quickCardWordId);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('study-quick-card-modal').hidden) closeQuickCard(); });
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
