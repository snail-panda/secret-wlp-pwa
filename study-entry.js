/* WLP v1.8.6.169 — Review storage stabilization + compact Classification migration. */
(() => {
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260914-stage7-7';
  const TEMP_STUDY_SET_KEY = 'wlp:temporary-study-set:v1';
  const BUILDER_STATE_KEY = 'wlp:study-set-builder-state:v1';
  const ACTIVE_CARD_CONTEXT_KEY = 'wlp:active-card-study-context:v1';
  const PRACTICE_MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY = 'wlp:ai-study-events:v1';
  const REVIEW_QUICK_EVENT_KEY = 'wlp:review-quick-events:v1';
  const QUICK_REVIEW_SESSION_KEY = 'wlp:quick-review-auto-next-session:v1';
  const REVIEW_SETTINGS_KEY = 'wlp:review-settings:v1';
  const CLASSIFICATION_STORAGE_KEY = 'wlp:classification-meta:v1';
  const CLASSIFICATION_ROLLBACK_KEY = 'wlp:classification-import-rollback:v1';
  const REVIEW_SET_SIZES = [10, 15, 25, 50];
  const REVIEW_CARRYOVER_RATIO = 0.25;
  const REVIEW_CARRYOVER_MAX_APPEARANCES = 3;
  const REVIEW_GENERATOR_VERSION = '1.2.0';
  const api = window.WLPStudyContext || null;
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();
  const pad = value => String(value ?? '').padStart(3, '0');
  const params = new URLSearchParams(location.search);
  let mode = ['continue', 'review'].includes(params.get('mode')) ? params.get('mode') : 'new';
  let rows = [];
  let rowsPromise = null;

  function compactStoredJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const compact = JSON.stringify(JSON.parse(raw));
      if (compact.length >= raw.length) return false;
      localStorage.setItem(key, compact);
      return true;
    } catch (error) {
      console.warn('WLP storage compaction failed:', key, error);
      return false;
    }
  }

  // Reclaim space before Review settings/contexts need to write.
  compactStoredJson(CLASSIFICATION_STORAGE_KEY);
  compactStoredJson(CLASSIFICATION_ROLLBACK_KEY);

  function normalizeReviewSettings(raw = {}) {
    const requestedSize = Math.max(1, Math.floor(Number(raw.setSize) || 15));
    const setSize = REVIEW_SET_SIZES.includes(requestedSize) ? requestedSize : 15;
    return {
      setSize,
      carryOver: raw.carryOver !== false,
      style: raw.style === 'quick' ? 'quick' : 'deep',
      autoAdvance: raw.autoAdvance !== false
    };
  }

  function readReviewSettings() {
    try { return normalizeReviewSettings(JSON.parse(localStorage.getItem(REVIEW_SETTINGS_KEY) || '{}')); }
    catch (_) { return normalizeReviewSettings(); }
  }

  function writeReviewSettings(patch = {}) {
    const next = normalizeReviewSettings({ ...readReviewSettings(), ...patch });
    try {
      localStorage.setItem(REVIEW_SETTINGS_KEY, JSON.stringify(next));
      return next;
    } catch (error) {
      console.warn('WLP Review settings write failed:', error);
      showToast('Review setting could not be saved. Local storage may be full.');
      return null;
    }
  }

  function latestQuickReviewEvidence() {
    const map = new Map();
    readJsonArray(REVIEW_QUICK_EVENT_KEY).forEach((event, index) => {
      const wordId = clean(event?.wordId);
      const rating = clean(event?.rating).toLowerCase();
      if (!wordId || !['again','hard','good','easy'].includes(rating)) return;
      const timestamp = timestampFrom([event?.occurredAt, event?.createdAt, event?.timestamp]);
      const prior = map.get(wordId);
      if (!prior || timestamp > prior.timestamp || (timestamp === prior.timestamp && index > prior.index)) {
        map.set(wordId, { event, timestamp, index });
      }
    });
    return map;
  }

  function quickReviewPriorityDelta(evidence) {
    if (!evidence?.event) return 0;
    const rating = clean(evidence.event.rating).toLowerCase();
    const ageDays = evidence.timestamp ? Math.max(0, Date.now() - evidence.timestamp) / 86400000 : 99;
    if (ageDays > 14) return 0;
    const base = ({ again: 95, hard: 55, good: -20, easy: -55 })[rating] || 0;
    return ageDays <= 2 ? base : Math.round(base * 0.5);
  }

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

  function readJsonArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  function timestampFrom(values) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const parsed = Date.parse(String(value || ''));
      if (parsed) return parsed;
    }
    return 0;
  }

  function standardEventTimestamp(event) {
    return Number(event?._reviewEvidenceTimestamp) || timestampFrom([
      event?.completedAt, event?.startedAt, event?.occurredAt, event?.createdAt, event?.timestamp, event?.updatedAt
    ]);
  }

  function aiEventTimestamp(event) {
    return timestampFrom([
      event?.observedAt, event?.createdAt, event?.timestamp, event?.committedAt,
      event?.recordedAt, event?.interpretedAt, event?.receivedAt, event?.occurredAt, event?.updatedAt
    ]);
  }

  function localDayKey(value = Date.now()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function readReviewPool() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        if (!(value?.review === true || value?.lastResult === 'review')) continue;
        const wordId = clean(value.wordId || key.slice(PROGRESS_PREFIX.length));
        if (!wordId) continue;
        const level = ['high', 'medium', 'light'].includes(clean(value.reviewLevel).toLowerCase())
          ? clean(value.reviewLevel).toLowerCase()
          : '';
        out.push({
          wordId,
          reviewLevel: level,
          reviewReasons: Array.isArray(value.reviewReasons) ? value.reviewReasons.map(item => clean(item).toLowerCase()).filter(Boolean) : [],
          reviewCount: Math.max(0, Number(value.reviewCount) || 0),
          lastSeen: Math.max(0, Number(value.lastSeen) || 0),
          lastAttentionUpdated: Math.max(0, Number(value.lastAttentionUpdated) || 0)
        });
      } catch (_) {}
    }
    return out;
  }

  function standardSessionFallbackEvents() {
    const out = [];
    readJsonArray(STUDYQ_SESSION_KEY).forEach(session => {
      const timestamp = timestampFrom([session?.completedAt, session?.endedAt, session?.startedAt]);
      (Array.isArray(session?.experiences) ? session.experiences : []).forEach(experience => {
        const attempt = experience?.attempt || {};
        const wordId = clean(experience?.wordId || attempt?.wordId);
        if (wordId) out.push({ ...attempt, wordId, _reviewEvidenceTimestamp: timestamp });
      });
    });
    return out;
  }

  function latestStandardEvidence() {
    const map = new Map();
    [...standardSessionFallbackEvents(), ...readJsonArray(STUDYQ_EVENT_KEY)].forEach((event, index) => {
      const wordId = clean(event?.wordId);
      if (!wordId) return;
      const timestamp = standardEventTimestamp(event);
      const prior = map.get(wordId);
      if (!prior || timestamp > prior.timestamp || (timestamp === prior.timestamp && index > prior.index)) {
        map.set(wordId, { event, timestamp, index });
      }
    });
    return map;
  }

  function readAIEvents() {
    try {
      const value = JSON.parse(localStorage.getItem(AI_STUDY_EVENT_KEY) || '[]');
      let list = [];
      if (Array.isArray(value)) list = value;
      else if (Array.isArray(value?.events)) list = value.events;
      else if (Array.isArray(value?.items)) list = value.items;
      else if (value?.records && typeof value.records === 'object') list = Array.isArray(value.records) ? value.records : Object.values(value.records);
      return list.filter(item => item && typeof item === 'object');
    } catch {
      return [];
    }
  }

  function aiWordId(event) {
    return clean(event?.wordId || event?.targetWordId || event?.target?.wordId || event?.selectedTarget?.wordId);
  }

  function latestAIEvidence() {
    const map = new Map();
    readAIEvents().forEach((event, index) => {
      const wordId = aiWordId(event);
      if (!wordId) return;
      const timestamp = aiEventTimestamp(event);
      const prior = map.get(wordId);
      if (!prior || timestamp > prior.timestamp || (timestamp === prior.timestamp && index > prior.index)) {
        map.set(wordId, { event, timestamp, index });
      }
    });
    return map;
  }

  function hasAIssue(value) {
    if (value === null || value === undefined || value === false) return false;
    const text = clean(value).toLowerCase();
    return !['', 'none', 'null', 'false', 'no', 'n/a'].includes(text);
  }

  function aiPrioritySignal(event) {
    const interpretation = event?.interpretation || event?.response?.interpretation || event?.result?.response?.interpretation || {};
    const classes = (Array.isArray(interpretation?.responseClasses) ? interpretation.responseClasses : Array.isArray(event?.responseClasses) ? event.responseClasses : [])
      .map(value => clean(value).toLowerCase()).filter(Boolean);
    const confidence = clean(interpretation?.interpretationConfidence || event?.interpretationConfidence).toLowerCase();
    const uncertain = classes.includes('stt-uncertain') || classes.includes('uncertain') || confidence === 'low';
    const formIssue = hasAIssue(interpretation?.formIssue ?? event?.formIssue);
    const senseIssue = hasAIssue(interpretation?.senseIssue ?? event?.senseIssue);
    const targetProduced = interpretation?.targetProduced === true || interpretation?.targetFamilyReached === true || event?.targetProduced === true || event?.targetFamilyReached === true;
    const failureClasses = new Set(['partial-concept', 'form-mismatch', 'sense-mismatch', 'unrelated']);
    const negative = !uncertain && (classes.some(value => failureClasses.has(value)) || formIssue || senseIssue || clean(event?.interpretationStatus).toLowerCase() === 'no-idea');
    const assistance = event?.assistance || event?.telemetry?.assistance || {};
    const experience = event?.experience || event?.interpretationContext?.experience || event?.request?.interpretationContext?.experience || {};
    const assisted = assistance?.targetRevealed === true || assistance?.targetShown === true || experience?.targetVisible === true || event?.targetShown === true || event?.targetRevealed === true;
    const positive = !uncertain && targetProduced && !formIssue && !senseIssue && !assisted;
    return { negative, positive };
  }

  function reviewAgePriority(lastSeen) {
    const seen = Number(lastSeen) || 0;
    if (!seen) return 55;
    const hours = Math.max(0, Date.now() - seen) / 3600000;
    if (hours < 6) return -20;
    if (hours < 24) return -8;
    const days = hours / 24;
    if (days < 3) return 8;
    if (days < 7) return 20;
    if (days < 14) return 32;
    if (days < 30) return 44;
    return 55;
  }

  function reviewPriorityScore(record, standardMap, aiMap, quickMap = null) {
    const base = ({ high: 320, medium: 240, light: 160, '': 180 })[record.reviewLevel] ?? 180;
    let score = base + reviewAgePriority(record.lastSeen) + Math.min(28, record.reviewCount * 2);
    const authority = Number(record.lastAttentionUpdated) || 0;
    const standard = standardMap.get(record.wordId);
    if (standard && (!authority || standard.timestamp > authority)) {
      const rating = clean(standard.event?.selfRating).toLowerCase();
      score += ({ 'no-idea': 70, 'not-yet': 55, almost: 20, 'got-it': -12 })[rating] || 0;
      if (Number(standard.event?.hintCount) >= 2) score += 8;
      if (standard.event?.targetShown === true && !['got-it'].includes(rating)) score += 6;
    }
    const ai = aiMap.get(record.wordId);
    if (ai && (!authority || ai.timestamp > authority)) {
      const signal = aiPrioritySignal(ai.event);
      if (signal.negative) score += 58;
      else if (signal.positive) score -= 12;
    }
    if (quickMap) score += quickReviewPriorityDelta(quickMap.get(record.wordId));
    return score;
  }

  function reviewBreakdown(records) {
    const counts = { high: 0, medium: 0, light: 0, unassigned: 0 };
    records.forEach(record => {
      if (record.reviewLevel && counts[record.reviewLevel] !== undefined) counts[record.reviewLevel]++;
      else counts.unassigned++;
    });
    return counts;
  }

  function reviewWeakEvidence(record, standardMap, aiMap) {
    const authority = Number(record?.lastAttentionUpdated) || 0;
    const standard = standardMap.get(record?.wordId);
    if (standard && (!authority || standard.timestamp > authority)) {
      const rating = clean(standard.event?.selfRating).toLowerCase();
      if (rating === 'no-idea' || rating === 'not-yet') return true;
    }
    const ai = aiMap.get(record?.wordId);
    if (ai && (!authority || ai.timestamp > authority) && aiPrioritySignal(ai.event).negative) return true;
    return false;
  }

  function todayReviewAppearanceCounts() {
    const counts = new Map();
    todaysReviewContexts().forEach(context => {
      sourceWordIds(context).forEach(wordId => counts.set(wordId, (counts.get(wordId) || 0) + 1));
    });
    return counts;
  }

  function generateNextTodayReview(pool = readReviewPool()) {
    const settings = readReviewSettings();
    const setSize = settings.setSize;
    const appearances = todayReviewAppearanceCounts();
    const standardMap = latestStandardEvidence();
    const aiMap = latestAIEvidence();
    const quickMap = latestQuickReviewEvidence();
    const ranked = records => records
      .map(record => ({ ...record, _score: reviewPriorityScore(record, standardMap, aiMap, quickMap) }))
      .sort((a, b) => (b._score - a._score) || ((a.lastSeen || 0) - (b.lastSeen || 0)) || (b.reviewCount - a.reviewCount) || (Number(a.wordId) - Number(b.wordId)) || a.wordId.localeCompare(b.wordId));

    const unseen = ranked(pool.filter(record => !appearances.has(record.wordId)));
    if (!unseen.length) return { wordIds: [], records: [], breakdown: reviewBreakdown([]), poolCount: pool.length, carryOverWordIds: [], freshWordIds: [] };

    const carryLimit = settings.carryOver
      ? Math.min(setSize - 1, Math.max(1, Math.round(setSize * REVIEW_CARRYOVER_RATIO)))
      : 0;
    const carryCandidates = carryLimit ? pool
      .filter(record => {
        const seenCount = appearances.get(record.wordId) || 0;
        if (!seenCount || seenCount >= REVIEW_CARRYOVER_MAX_APPEARANCES) return false;
        const quick = quickMap.get(record.wordId);
        const quickRating = clean(quick?.event?.rating).toLowerCase();
        return record.reviewLevel === 'high' || reviewWeakEvidence(record, standardMap, aiMap) || quickRating === 'again' || quickRating === 'hard';
      })
      .map(record => {
        const seenCount = appearances.get(record.wordId) || 0;
        const weak = reviewWeakEvidence(record, standardMap, aiMap);
        const quick = quickMap.get(record.wordId);
        const quickRating = clean(quick?.event?.rating).toLowerCase();
        const quickCarry = ({ again: 150, hard: 85, good: -90, easy: -180 })[quickRating] || 0;
        const carryScore = reviewPriorityScore(record, standardMap, aiMap, quickMap)
          + (record.reviewLevel === 'high' ? 72 : 0)
          + (weak ? 64 : 0)
          + quickCarry
          - (seenCount * 90);
        return { ...record, _carryScore: carryScore };
      })
      .sort((a, b) => (b._carryScore - a._carryScore) || ((a.lastSeen || 0) - (b.lastSeen || 0)) || (Number(a.wordId) - Number(b.wordId)) || a.wordId.localeCompare(b.wordId))
      : [];

    const carry = carryCandidates.slice(0, carryLimit);
    const freshLimit = Math.max(1, setSize - carry.length);
    const fresh = unseen.slice(0, freshLimit);
    const selected = [...fresh, ...carry].slice(0, setSize);
    return {
      wordIds: selected.map(record => record.wordId),
      records: selected,
      breakdown: reviewBreakdown(selected),
      poolCount: pool.length,
      carryOverWordIds: carry.map(record => record.wordId),
      freshWordIds: fresh.map(record => record.wordId)
    };
  }

  function generateTodayReview(pool = readReviewPool(), excludedWordIds = []) {
    const settings = readReviewSettings();
    const excluded = new Set(api?.uniqueWordIds(excludedWordIds) || []);
    const standardMap = latestStandardEvidence();
    const aiMap = latestAIEvidence();
    const quickMap = latestQuickReviewEvidence();
    const ranked = pool
      .filter(record => !excluded.has(record.wordId))
      .map(record => ({ ...record, _score: reviewPriorityScore(record, standardMap, aiMap, quickMap) }))
      .sort((a, b) => (b._score - a._score) || ((a.lastSeen || 0) - (b.lastSeen || 0)) || (b.reviewCount - a.reviewCount) || (Number(a.wordId) - Number(b.wordId)) || a.wordId.localeCompare(b.wordId));
    const selected = ranked.slice(0, settings.setSize);
    return {
      wordIds: selected.map(record => record.wordId),
      records: selected,
      breakdown: reviewBreakdown(selected),
      poolCount: pool.length,
      carryOverWordIds: [],
      freshWordIds: selected.map(record => record.wordId)
    };
  }

  function todaysReviewContexts() {
    if (!api) return [];
    const today = localDayKey();
    return api.readContexts().filter(context => (
      context.sourceType === 'review-set' &&
      context.practiceMode === 'cards' &&
      context.source?.selectionMode === 'today-review' &&
      context.source?.generatedFor === today
    ));
  }

  function todaysGeneratedReviewContext() {
    return todaysReviewContexts()[0] || null;
  }

  function reviewedTodayWordIds() {
    if (!api) return [];
    return api.uniqueWordIds(todaysReviewContexts().flatMap(context => sourceWordIds(context)));
  }

  function createTodayReviewContext(selection) {
    if (!api || !selection?.wordIds?.length) return null;
    const setNumber = todaysReviewContexts().length + 1;
    const settings = readReviewSettings();
    return api.createContext({
      sourceType: 'review-set',
      practiceMode: 'cards',
      status: 'active',
      source: {
        label: "Today's Review",
        selectionMode: 'today-review',
        generatedFor: localDayKey(),
        generatorVersion: REVIEW_GENERATOR_VERSION,
        reviewSetNumber: setNumber,
        reviewStyle: settings.style,
        reviewSetSize: selection.wordIds.length,
        requestedReviewSetSize: settings.setSize,
        carryOverEnabled: settings.carryOver,
        quickAutoAdvance: settings.autoAdvance,
        attentionBreakdown: selection.breakdown,
        selectionPolicy: selection.carryOverWordIds?.length ? 'fresh-first-carryover-v1' : 'priority-v1',
        carryOverWordIds: api.uniqueWordIds(selection.carryOverWordIds || []),
        freshWordIds: api.uniqueWordIds(selection.freshWordIds || selection.wordIds || []),
        wordIds: selection.wordIds
      },
      progress: { currentIndex: 0, completedCount: 0, totalCount: selection.wordIds.length, completedWordIds: [] }
    });
  }

  function cloneReviewContextForRestart(context) {
    if (!api || !context) return null;
    const ids = sourceWordIds(context);
    if (!ids.length) return null;
    const settings = readReviewSettings();
    return api.createContext({
      sourceType: 'review-set',
      practiceMode: 'cards',
      status: 'active',
      source: {
        ...context.source,
        wordIds: ids,
        reviewStyle: settings.style,
        quickAutoAdvance: settings.autoAdvance
      },
      progress: { currentIndex: 0, completedCount: 0, totalCount: ids.length, completedWordIds: [] }
    });
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
      if (restart) {
        try { sessionStorage.removeItem(ACTIVE_CARD_CONTEXT_KEY); } catch (_) {}
      }
      // Review Setup is the learner's current choice. Resume keeps the same
      // frozen card snapshot/progress, but may switch between Deep and Quick.
      const settings = readReviewSettings();
      const launchContext = restart
        ? cloneReviewContextForRestart(context)
        : api?.updateContext(context.contextId, {
            source: {
              reviewStyle: settings.style,
              quickAutoAdvance: settings.autoAdvance
            }
          });
      if (!launchContext) return '';
      // Card-page Auto Next is only a per-visit override. Leaving the card
      // page and launching again should start from Review Setup's default.
      try { sessionStorage.removeItem(QUICK_REVIEW_SESSION_KEY); } catch (_) {}
      const query = new URLSearchParams();
      query.set('review', '1');
      query.set('from', 'review');
      query.set('return', '../../deck-browser.html?mode=review');
      query.set('context', launchContext.contextId);
      const reviewStyle = clean(launchContext.source?.reviewStyle) === 'quick' ? 'quick' : 'deep';
      query.set('reviewstyle', reviewStyle);
      if (reviewStyle === 'quick') query.set('autonext', launchContext.source?.quickAutoAdvance === false ? '0' : '1');
      const ids = sourceWordIds(launchContext);
      const index = ids.indexOf(nextWordId(launchContext, false));
      if (index >= 0) query.set('s7card', String(index + 1));
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
    context = api?.getContext(context.contextId) || context;
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
      query.set('return', './deck-browser.html?mode=continue');
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

  function renderReviewSettings() {
    const settings = readReviewSettings();
    document.querySelectorAll('[data-review-style]').forEach(button => {
      const active = button.dataset.reviewStyle === settings.style;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const size = $('study-review-set-size');
    if (size) size.value = String(settings.setSize);
    const carry = $('study-review-carry-over');
    if (carry) {
      carry.setAttribute('aria-checked', String(settings.carryOver));
      carry.classList.toggle('is-on', settings.carryOver);
      carry.querySelector('span').textContent = settings.carryOver ? 'On' : 'Off';
    }
    const auto = $('study-review-auto-next');
    const autoRow = $('study-review-auto-next-row');
    if (autoRow) autoRow.hidden = settings.style !== 'quick';
    if (auto) {
      auto.setAttribute('aria-checked', String(settings.autoAdvance));
      auto.classList.toggle('is-on', settings.autoAdvance);
      auto.querySelector('span').textContent = settings.autoAdvance ? 'On' : 'Off';
    }
    const note = $('study-review-settings-note');
    if (note) note.textContent = todaysGeneratedReviewContext()
      ? 'Resume, Start Again, and new Review sets use the Review Setup above.'
      : 'These settings apply when the next Review set is created.';
  }

  function bindReviewSettings() {
    document.querySelectorAll('[data-review-style]').forEach(button => {
      if (button.dataset.reviewSettingsBound === '1') return;
      button.dataset.reviewSettingsBound = '1';
      button.addEventListener('click', () => {
        if (!writeReviewSettings({ style: button.dataset.reviewStyle })) return;
        renderReviewSettings();
        renderReviewSummary();
      });
    });
    const size = $('study-review-set-size');
    if (size && size.dataset.reviewSettingsBound !== '1') {
      size.dataset.reviewSettingsBound = '1';
      size.addEventListener('change', () => {
        if (!writeReviewSettings({ setSize: Number(size.value) })) return;
        renderReviewSettings();
        renderReviewSummary();
      });
    }
    const carry = $('study-review-carry-over');
    if (carry && carry.dataset.reviewSettingsBound !== '1') {
      carry.dataset.reviewSettingsBound = '1';
      carry.addEventListener('click', () => {
        if (!writeReviewSettings({ carryOver: carry.getAttribute('aria-checked') !== 'true' })) return;
        renderReviewSettings();
        renderReviewSummary();
      });
    }
    const auto = $('study-review-auto-next');
    if (auto && auto.dataset.reviewSettingsBound !== '1') {
      auto.dataset.reviewSettingsBound = '1';
      auto.addEventListener('click', () => {
        if (!writeReviewSettings({ autoAdvance: auto.getAttribute('aria-checked') !== 'true' })) return;
        renderReviewSettings();
      });
    }
  }

  function renderReviewSummary() {
    renderReviewSettings();
    const pool = readReviewPool();
    const counts = { total: pool.length, ...reviewBreakdown(pool) };
    $('study-review-total').textContent = counts.total.toLocaleString();
    $('study-review-high').textContent = counts.high.toLocaleString();
    $('study-review-medium').textContent = counts.medium.toLocaleString();
    $('study-review-light').textContent = counts.light.toLocaleString();
    $('study-review-unassigned').textContent = counts.unassigned.toLocaleString();

    const existing = todaysGeneratedReviewContext();
    const generated = existing ? null : generateTodayReview(pool);
    const wordIds = existing ? sourceWordIds(existing) : generated.wordIds;
    const breakdown = existing?.source?.attentionBreakdown && typeof existing.source.attentionBreakdown === 'object'
      ? existing.source.attentionBreakdown
      : generated.breakdown;
    const progress = existing ? progressFor(existing) : { completed: 0, total: wordIds.length };

    $('study-review-today-total').textContent = wordIds.length.toLocaleString();
    $('study-review-selected-high').textContent = Number(breakdown?.high || 0).toLocaleString();
    $('study-review-selected-medium').textContent = Number(breakdown?.medium || 0).toLocaleString();
    $('study-review-selected-light').textContent = Number(breakdown?.light || 0).toLocaleString();
    $('study-review-selected-unassigned').textContent = Number(breakdown?.unassigned || 0).toLocaleString();

    const status = $('study-review-today-status');
    const copy = $('study-review-today-copy');
    const primary = $('study-review-start');
    const secondary = $('study-review-restart');
    if (!wordIds.length) {
      status.textContent = 'Nothing waiting right now';
      copy.textContent = 'Cards will appear here when they are marked for Review.';
      primary.textContent = 'Start Review';
      primary.disabled = true;
      secondary.hidden = true;
      return;
    }

    primary.disabled = false;
    if (!existing) {
      status.textContent = `${wordIds.length} ${wordIds.length === 1 ? 'card' : 'cards'} ready`;
      copy.textContent = "Higher Attention leads the set; older cards and recent difficulty can move cards up. Recent success can lower priority, but never removes a card from Review. The set stays fixed once you start it.";
      primary.textContent = 'Start Review';
      secondary.hidden = true;
      primary.onclick = () => {
        const context = createTodayReviewContext(generated);
        if (!context) { showToast('This Review set could not be created.'); return; }
        void openContext(context, 'resume');
      };
      return;
    }

    const resumable = existing.status !== 'completed' && progress.completed < progress.total;
    status.textContent = existing.status === 'completed'
      ? `Completed today · ${progress.total} ${progress.total === 1 ? 'card' : 'cards'}`
      : `${progress.completed} / ${progress.total} completed`;
    copy.textContent = existing.status === 'completed'
      ? readReviewSettings().carryOver
        ? "This set stays fixed. Next Review Set prioritizes cards not yet seen today and may carry over a few cards that still need attention."
        : "This set stays fixed. Carry Over is off, so the next Review Set uses only cards not yet seen today."
      : "Today's set is fixed to the snapshot you started earlier, so you can resume it or run the same set again without the selection changing underneath you.";
    primary.textContent = resumable ? 'Resume' : 'Start Again';
    primary.onclick = () => { void openContext(existing, resumable ? 'resume' : 'restart'); };

    secondary.hidden = false;
    secondary.disabled = false;
    secondary.removeAttribute('title');
    if (resumable) {
      secondary.textContent = 'Start Again';
      secondary.onclick = () => { void openContext(existing, 'restart'); };
    } else {
      const nextSelection = generateNextTodayReview(pool);
      secondary.textContent = 'Next Review Set';
      secondary.disabled = !nextSelection.wordIds.length;
      if (!nextSelection.wordIds.length) secondary.title = 'All current Review cards have already appeared in today\'s Review sets.';
      secondary.onclick = () => {
        if (!nextSelection.wordIds.length) return;
        const context = createTodayReviewContext(nextSelection);
        if (!context) { showToast('The next Review set could not be created.'); return; }
        void openContext(context, 'resume');
      };
    }
  }

  function refreshActiveStudyPanel() {
    if (mode === 'continue') renderContinue();
    else if (mode === 'review') renderReviewSummary();
  }

  window.addEventListener('pageshow', refreshActiveStudyPanel);

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
      copy.textContent = "Start with today's focused Review set, or inspect the full Review pool.";
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
  bindReviewSettings();
  renderReviewSettings();
  setMode(mode);
})();
