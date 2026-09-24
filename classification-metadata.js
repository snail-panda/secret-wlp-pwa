/* WLP Stage 7 v1.8.6.118 — Classification Metadata v1 data layer. */
(() => {
  'use strict';

  const STORAGE_KEY = 'wlp:classification-meta:v1';
  const EVENT_NAME = 'wlp-classification-metadata-changed';
  const VERSION = 1;
  const ARRAY_FIELDS = ['entryTypes', 'usageTags', 'topicTags', 'discoveryTags'];

  const cleanTag = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const fold = value => cleanTag(value).toLocaleLowerCase('en-US');

  function uniqueTags(values) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach(value => {
      const tag = cleanTag(value);
      const key = fold(tag);
      if (!tag || seen.has(key)) return;
      seen.add(key);
      out.push(tag);
    });
    return out;
  }

  function emptyState() {
    return {version: VERSION, records: {}};
  }

  function normalizeRecord(record = {}) {
    const next = {};
    ARRAY_FIELDS.forEach(field => { next[field] = uniqueTags(record[field]); });
    if (record.wordId != null && cleanTag(record.wordId)) next.wordId = cleanTag(record.wordId);
    if (record.localDraftId != null && cleanTag(record.localDraftId)) next.localDraftId = cleanTag(record.localDraftId);
    if (cleanTag(record.updatedAt)) next.updatedAt = cleanTag(record.updatedAt);
    return next;
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
      const rawRecords = parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)
        ? parsed.records
        : parsed;
      const records = {};
      Object.entries(rawRecords).forEach(([key, value]) => {
        if (!/^wid:|^draft:/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return;
        records[key] = normalizeRecord(value);
      });
      return {version: VERSION, records};
    } catch {
      return emptyState();
    }
  }

  function writeState(state) {
    const records = state?.records && typeof state.records === 'object' ? state.records : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: VERSION, records}, null, 2));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }

  function hasClassification(record) {
    return ARRAY_FIELDS.some(field => Array.isArray(record?.[field]) && record[field].length > 0);
  }

  function makeMasterKey(wid) {
    const id = cleanTag(wid);
    return id ? `wid:${id}` : '';
  }

  function makeDraftKey(localId) {
    const id = cleanTag(localId);
    return id ? `draft:${id}` : '';
  }

  function get(key) {
    const record = readState().records[String(key || '')];
    return record ? normalizeRecord(record) : normalizeRecord();
  }

  function all() {
    return readState().records;
  }

  function count() {
    return Object.values(all()).filter(hasClassification).length;
  }

  function save(key, record = {}) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || !(/^(?:wid|draft):/.test(cleanKey))) throw new Error('Invalid Classification identity.');
    const state = readState();
    const next = normalizeRecord({...record, updatedAt: new Date().toISOString()});
    if (cleanKey.startsWith('wid:')) {
      next.wordId = cleanTag(record.wordId || cleanKey.slice(4));
      delete next.localDraftId;
    } else {
      next.localDraftId = cleanTag(record.localDraftId || cleanKey.slice(6));
      delete next.wordId;
    }
    if (!hasClassification(next)) delete state.records[cleanKey];
    else state.records[cleanKey] = next;
    writeState(state);
    return next;
  }

  function remove(key) {
    const state = readState();
    if (!Object.prototype.hasOwnProperty.call(state.records, key)) return false;
    delete state.records[key];
    writeState(state);
    return true;
  }

  function tagsFor(field) {
    if (!ARRAY_FIELDS.includes(field)) return [];
    const values = [];
    Object.values(all()).forEach(record => values.push(...(record?.[field] || [])));
    return uniqueTags(values).sort((a, b) => a.localeCompare(b, undefined, {sensitivity:'base'}));
  }

  window.WLPClassificationMetadata = Object.freeze({
    STORAGE_KEY,
    EVENT_NAME,
    VERSION,
    ARRAY_FIELDS: [...ARRAY_FIELDS],
    cleanTag,
    uniqueTags,
    hasClassification,
    makeMasterKey,
    makeDraftKey,
    get,
    all,
    count,
    save,
    remove,
    tagsFor
  });
})();
