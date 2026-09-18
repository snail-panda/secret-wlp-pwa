(() => {
  'use strict';

  // Provisional learning metadata layer. Keep this separate from the canonical
  // Master/TSV fields so future layers (Situation Anchor, alternatives, etc.)
  // can grow without repurposing Category / Source / Notes.
  const STORAGE_KEY = 'wlp:learning-meta:v1';
  const KNOWN_FIELDS = ['senseHook', 'memoryHook'];

  function clean(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
  }

  function parseStore() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      console.warn('Could not read WLP learning metadata:', error);
      return {};
    }
  }

  function writeStore(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value, null, 2));
    window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
  }

  function normalizeEntry(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      ...input,
      senseHook: clean(input.senseHook),
      memoryHook: clean(input.memoryHook),
      updatedAt: clean(input.updatedAt)
    };
  }

  function masterKey(wordId) {
    const id = clean(wordId);
    return id ? `wid:${id}` : '';
  }

  function draftKey(localId) {
    const id = clean(localId);
    return id ? `draft:${id}` : '';
  }

  function keyForRow(row) {
    const wid = clean(row?.WordID);
    if (wid) return masterKey(wid);
    return draftKey(row?.__localId || row?.localId);
  }

  function get(key) {
    const safeKey = clean(key);
    if (!safeKey) return normalizeEntry({});
    return normalizeEntry(parseStore()[safeKey]);
  }

  function hasPayload(entry) {
    return Object.entries(entry || {}).some(([key, value]) => {
      if (key === 'updatedAt') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return clean(value) !== '';
    });
  }

  function save(key, values = {}) {
    const safeKey = clean(key);
    if (!safeKey) return normalizeEntry({});
    const store = parseStore();
    const current = normalizeEntry(store[safeKey]);
    const next = {
      ...current,
      senseHook: clean(values.senseHook),
      memoryHook: clean(values.memoryHook),
      updatedAt: new Date().toISOString()
    };
    if (hasPayload(next)) {
      store[safeKey] = next;
    } else {
      delete store[safeKey];
    }
    writeStore(store);
    return normalizeEntry(store[safeKey]);
  }

  function remove(key) {
    const safeKey = clean(key);
    if (!safeKey) return;
    const store = parseStore();
    if (!Object.prototype.hasOwnProperty.call(store, safeKey)) return;
    delete store[safeKey];
    writeStore(store);
  }

  function all() {
    const store = parseStore();
    const out = {};
    Object.entries(store).forEach(([key, value]) => {
      const entry = normalizeEntry(value);
      if (hasPayload(entry)) out[key] = entry;
    });
    return out;
  }

  function count() {
    return Object.keys(all()).length;
  }

  function fromForm(form) {
    if (!form) return { senseHook: '', memoryHook: '' };
    const fd = new FormData(form);
    return {
      senseHook: clean(fd.get('Sense Hook')),
      memoryHook: clean(fd.get('Memory Hook'))
    };
  }

  function fillForm(form, entry) {
    if (!form) return;
    const hooks = normalizeEntry(entry);
    const sense = form.elements.namedItem('Sense Hook');
    const memory = form.elements.namedItem('Memory Hook');
    if (sense) sense.value = hooks.senseHook;
    if (memory) memory.value = hooks.memoryHook;
  }

  window.WLPLearningHooks = Object.freeze({
    STORAGE_KEY,
    KNOWN_FIELDS,
    masterKey,
    draftKey,
    keyForRow,
    get,
    getForMaster: wordId => get(masterKey(wordId)),
    getForDraft: localId => get(draftKey(localId)),
    save,
    saveForMaster: (wordId, values) => save(masterKey(wordId), values),
    saveForDraft: (localId, values) => save(draftKey(localId), values),
    remove,
    removeForDraft: localId => remove(draftKey(localId)),
    all,
    count,
    fromForm,
    fillForm
  });
})();
