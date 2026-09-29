/* WLP v1.8.6.176 — Study Context V1 + Review completion timestamp foundation. */
(() => {
  const CONTEXT_KEY = 'wlp:study-contexts:v1';
  const BUILD_HISTORY_KEY = 'wlp:build-history:v1';
  const CONTEXT_LIMIT = 60;
  const BUILD_LIMIT = 30;
  const BUILD_WORDID_BUDGET = 20000;

  const clean = value => String(value ?? '').trim();
  const nowIso = () => new Date().toISOString();
  const clone = value => {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  };
  const uniqueWordIds = values => Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => clean(value))
    .filter(Boolean)));

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('WLP Study Context storage write failed:', key, error);
      return false;
    }
  }

  function makeId(prefix) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeBuildSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) return null;
    const items = snapshot.items.map(item => ({
      wordId: clean(item?.wordId),
      batch: clean(item?.batch),
      word: clean(item?.word)
    })).filter(item => item.wordId);
    if (!items.length) return null;
    return {
      criteria: clone(snapshot.criteria && typeof snapshot.criteria === 'object' ? snapshot.criteria : {}),
      items,
      wordIds: uniqueWordIds(items.map(item => item.wordId))
    };
  }

  function buildSignature(normalized) {
    if (!normalized) return '';
    return JSON.stringify({ criteria: normalized.criteria, wordIds: normalized.wordIds });
  }

  function readBuildHistory() {
    return readArray(BUILD_HISTORY_KEY)
      .filter(item => clean(item.buildId))
      .map(item => ({ ...item, wordIds: uniqueWordIds(item.wordIds) }))
      .sort((a, b) => Date.parse(b.lastUsedAt || b.createdAt || 0) - Date.parse(a.lastUsedAt || a.createdAt || 0));
  }

  function trimBuildHistory(history) {
    const trimmed = history.slice(0, BUILD_LIMIT);
    let wordIdTotal = trimmed.reduce((sum, item) => sum + uniqueWordIds(item.wordIds).length, 0);
    while (trimmed.length > 1 && wordIdTotal > BUILD_WORDID_BUDGET) {
      const removed = trimmed.pop();
      wordIdTotal -= uniqueWordIds(removed?.wordIds).length;
    }
    return trimmed;
  }

  function getBuild(buildId) {
    const id = clean(buildId);
    if (!id) return null;
    const found = readBuildHistory().find(item => item.buildId === id);
    return found ? clone(found) : null;
  }

  function ensureBuild(snapshot) {
    const normalized = normalizeBuildSnapshot(snapshot);
    if (!normalized) return null;
    const signature = buildSignature(normalized);
    const history = readBuildHistory();
    const now = nowIso();
    const existingIndex = history.findIndex(item => clean(item.signature) === signature);
    if (existingIndex >= 0) {
      const existing = {
        ...history[existingIndex],
        lastUsedAt: now,
        recipe: normalized.criteria,
        wordIds: normalized.wordIds,
        cardCount: normalized.wordIds.length,
        signature
      };
      history.splice(existingIndex, 1);
      history.unshift(existing);
      if (!writeArray(BUILD_HISTORY_KEY, trimBuildHistory(history))) return null;
      return clone(existing);
    }

    const record = {
      schemaVersion: 1,
      buildId: makeId('build'),
      createdAt: clean(snapshot.createdAt) || now,
      lastUsedAt: now,
      recipe: normalized.criteria,
      wordIds: normalized.wordIds,
      cardCount: normalized.wordIds.length,
      signature
    };
    history.unshift(record);
    if (!writeArray(BUILD_HISTORY_KEY, trimBuildHistory(history))) return null;
    return clone(record);
  }

  function normalizeProgress(progress = {}, sourceWordIds = []) {
    const sourceIds = uniqueWordIds(sourceWordIds);
    const completedWordIds = uniqueWordIds(progress.completedWordIds)
      .filter(wordId => !sourceIds.length || sourceIds.includes(wordId));
    const totalCount = Math.max(0, Number(progress.totalCount) || sourceIds.length || 0);
    const currentIndex = Number.isFinite(Number(progress.currentIndex)) ? Math.max(0, Number(progress.currentIndex)) : 0;
    return {
      currentIndex,
      currentWordId: clean(progress.currentWordId),
      completedCount: Math.min(totalCount || completedWordIds.length, Number(progress.completedCount) || completedWordIds.length),
      totalCount,
      completedWordIds
    };
  }

  function normalizeContext(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw.source && typeof raw.source === 'object' ? clone(raw.source) : {};
    source.wordIds = uniqueWordIds(source.wordIds);
    const contextId = clean(raw.contextId);
    if (!contextId) return null;
    return {
      schemaVersion: 1,
      contextId,
      sourceType: clean(raw.sourceType),
      practiceMode: clean(raw.practiceMode) || 'cards',
      createdAt: clean(raw.createdAt) || nowIso(),
      lastMeaningfulAt: clean(raw.lastMeaningfulAt) || clean(raw.createdAt) || nowIso(),
      completedAt: clean(raw.completedAt),
      status: ['active', 'incomplete', 'completed'].includes(clean(raw.status)) ? clean(raw.status) : 'active',
      source,
      progress: normalizeProgress(raw.progress, source.wordIds),
      sessionRef: raw.sessionRef && typeof raw.sessionRef === 'object' ? clone(raw.sessionRef) : {}
    };
  }

  function readContexts() {
    return readArray(CONTEXT_KEY)
      .map(normalizeContext)
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.lastMeaningfulAt || b.createdAt || 0) - Date.parse(a.lastMeaningfulAt || a.createdAt || 0));
  }

  function createContext(input = {}) {
    const now = nowIso();
    const source = input.source && typeof input.source === 'object' ? clone(input.source) : {};
    source.wordIds = uniqueWordIds(source.wordIds);
    const context = normalizeContext({
      schemaVersion: 1,
      contextId: clean(input.contextId) || makeId('ctx'),
      sourceType: clean(input.sourceType),
      practiceMode: clean(input.practiceMode) || 'cards',
      createdAt: clean(input.createdAt) || now,
      lastMeaningfulAt: clean(input.lastMeaningfulAt) || now,
      completedAt: clean(input.completedAt),
      status: clean(input.status) || 'active',
      source,
      progress: {
        currentIndex: Number(input.progress?.currentIndex) || 0,
        currentWordId: clean(input.progress?.currentWordId),
        completedWordIds: uniqueWordIds(input.progress?.completedWordIds),
        completedCount: Number(input.progress?.completedCount) || 0,
        totalCount: Number(input.progress?.totalCount) || source.wordIds.length
      },
      sessionRef: input.sessionRef && typeof input.sessionRef === 'object' ? clone(input.sessionRef) : {}
    });
    if (!context) return null;
    const contexts = readContexts().filter(item => item.contextId !== context.contextId);
    contexts.unshift(context);
    if (!writeArray(CONTEXT_KEY, contexts.slice(0, CONTEXT_LIMIT))) return null;
    return clone(context);
  }

  function getContext(contextId) {
    const id = clean(contextId);
    if (!id) return null;
    const found = readContexts().find(item => item.contextId === id);
    return found ? clone(found) : null;
  }

  function updateContext(contextId, patch = {}) {
    const id = clean(contextId);
    if (!id) return null;
    const contexts = readContexts();
    const index = contexts.findIndex(item => item.contextId === id);
    if (index < 0) return null;
    const current = contexts[index];
    const patchValue = typeof patch === 'function' ? patch(clone(current)) : patch;
    if (!patchValue || typeof patchValue !== 'object') return clone(current);
    const source = patchValue.source
      ? { ...current.source, ...clone(patchValue.source) }
      : current.source;
    if (patchValue.source?.wordIds) source.wordIds = uniqueWordIds(patchValue.source.wordIds);
    const progress = patchValue.progress
      ? normalizeProgress({ ...current.progress, ...clone(patchValue.progress) }, source.wordIds)
      : current.progress;
    const next = normalizeContext({
      ...current,
      ...clone(patchValue),
      source,
      progress,
      sessionRef: patchValue.sessionRef ? { ...current.sessionRef, ...clone(patchValue.sessionRef) } : current.sessionRef
    });
    contexts.splice(index, 1);
    contexts.unshift(next);
    if (!writeArray(CONTEXT_KEY, contexts.slice(0, CONTEXT_LIMIT))) return null;
    return clone(next);
  }

  function discardContext(contextId) {
    const id = clean(contextId);
    if (!id) return false;
    const contexts = readContexts();
    const next = contexts.filter(item => item.contextId !== id);
    if (next.length === contexts.length) return false;
    return writeArray(CONTEXT_KEY, next);
  }

  function findLatest(predicate) {
    const test = typeof predicate === 'function' ? predicate : () => true;
    const found = readContexts().find(test);
    return found ? clone(found) : null;
  }

  window.WLPStudyContext = Object.freeze({
    CONTEXT_KEY,
    BUILD_HISTORY_KEY,
    readContexts,
    readBuildHistory,
    getBuild,
    ensureBuild,
    createContext,
    getContext,
    updateContext,
    discardContext,
    findLatest,
    uniqueWordIds
  });
})();
