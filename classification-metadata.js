/* WLP Stage 7 v1.8.6.138 — Classification Metadata v1 + safe snapshot import. */
(() => {
  'use strict';

  const STORAGE_KEY = 'wlp:classification-meta:v1';
  const EVENT_NAME = 'wlp-classification-metadata-changed';
  const VERSION = 1;
  const FORMAT = 'WLP_CLASSIFICATION_METADATA_V1';
  const ROLLBACK_KEY = 'wlp:classification-import-rollback:v1';
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


  function contentEqual(a = {}, b = {}) {
    return ARRAY_FIELDS.every(field => {
      const left = uniqueTags(a?.[field]);
      const right = uniqueTags(b?.[field]);
      return left.length === right.length && left.every((value, index) => fold(value) === fold(right[index]));
    });
  }

  function portableSnapshot() {
    return {
      format: FORMAT,
      schemaVersion: VERSION,
      exportedAt: new Date().toISOString(),
      records: all()
    };
  }

  function normalizePortableSnapshot(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Classification JSON must be an object.');
    if (cleanTag(payload.format) !== FORMAT) throw new Error('This is not a WLP Classification Metadata JSON.');
    if (Number(payload.schemaVersion) !== VERSION) throw new Error(`Unsupported Classification schema version: ${payload.schemaVersion ?? 'unknown'}.`);
    if (!payload.records || typeof payload.records !== 'object' || Array.isArray(payload.records)) throw new Error('Classification JSON has no records object.');

    const records = {};
    let invalid = 0;
    Object.entries(payload.records).forEach(([rawKey, rawRecord]) => {
      const key = String(rawKey || '').trim();
      if (!/^(?:wid|draft):/.test(key) || !rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) { invalid++; return; }
      const record = normalizeRecord(rawRecord);
      if (key.startsWith('wid:')) {
        const id = cleanTag(rawRecord.wordId || key.slice(4));
        if (!id || key !== `wid:${id}`) { invalid++; return; }
        record.wordId = id;
        delete record.localDraftId;
      } else {
        const id = cleanTag(rawRecord.localDraftId || key.slice(6));
        if (!id || key !== `draft:${id}`) { invalid++; return; }
        record.localDraftId = id;
        delete record.wordId;
      }
      if (!hasClassification(record)) { invalid++; return; }
      records[key] = record;
    });
    return {
      format: FORMAT,
      schemaVersion: VERSION,
      exportedAt: cleanTag(payload.exportedAt),
      sourceDeviceId: cleanTag(payload.sourceDeviceId),
      records,
      invalid
    };
  }

  function comparePortableSnapshot(payload, options = {}) {
    const snapshot = normalizePortableSnapshot(payload);
    const state = readState();
    const allowedInput = Array.isArray(options.allowedKeys) ? options.allowedKeys : [];
    const allowed = allowedInput.length ? new Set(allowedInput.map(value => String(value || '').trim())) : null;
    const counts = {incoming:0, new:0, incomingNewer:0, same:0, localNewer:0, conflict:0, unknown:0, invalid:snapshot.invalid};
    const items = [];

    Object.entries(snapshot.records).forEach(([key, incoming]) => {
      counts.incoming++;
      if (allowed && !allowed.has(key)) {
        counts.unknown++;
        items.push({key, kind:'unknown', incoming, existing:null});
        return;
      }
      const existing = state.records[key] ? normalizeRecord(state.records[key]) : null;
      if (!existing) {
        counts.new++;
        items.push({key, kind:'new', incoming, existing:null});
        return;
      }
      if (contentEqual(existing, incoming)) {
        counts.same++;
        items.push({key, kind:'same', incoming, existing});
        return;
      }
      const incomingTime = Date.parse(incoming.updatedAt || '');
      const localTime = Date.parse(existing.updatedAt || '');
      let kind = 'conflict';
      if (Number.isFinite(incomingTime) && Number.isFinite(localTime) && incomingTime !== localTime) {
        kind = incomingTime > localTime ? 'incomingNewer' : 'localNewer';
      }
      counts[kind]++;
      items.push({key, kind, incoming, existing});
    });

    return {
      snapshot,
      items,
      counts,
      actionable: counts.new + counts.incomingNewer
    };
  }

  function applyPortableMerge(plan, resolutions = {}) {
    if (!plan || !Array.isArray(plan.items) || !plan.counts) throw new Error('Classification import plan is invalid.');
    const current = readState();
    localStorage.setItem(ROLLBACK_KEY, JSON.stringify({savedAt:new Date().toISOString(), state:current}, null, 2));
    const next = {version: VERSION, records: {...current.records}};
    const result = {added:0, updated:0, conflictIncoming:0, conflictLocal:0, localNewer:0, same:0, unknown:0};

    plan.items.forEach(item => {
      if (!item || !item.key || !item.incoming) return;
      if (item.kind === 'new') {
        next.records[item.key] = normalizeRecord(item.incoming);
        result.added++;
      } else if (item.kind === 'incomingNewer') {
        next.records[item.key] = normalizeRecord(item.incoming);
        result.updated++;
      } else if (item.kind === 'conflict') {
        if (resolutions[item.key] === 'incoming') {
          next.records[item.key] = normalizeRecord(item.incoming);
          result.conflictIncoming++;
        } else result.conflictLocal++;
      } else if (item.kind === 'localNewer') result.localNewer++;
      else if (item.kind === 'same') result.same++;
      else if (item.kind === 'unknown') result.unknown++;
    });

    writeState(next);
    return result;
  }

  function canUndoPortableMerge() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ROLLBACK_KEY) || 'null');
      return Boolean(parsed?.state?.records && typeof parsed.state.records === 'object');
    } catch { return false; }
  }

  function undoLastPortableMerge() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ROLLBACK_KEY) || 'null');
      if (!parsed?.state?.records || typeof parsed.state.records !== 'object') return false;
      writeState(parsed.state);
      localStorage.removeItem(ROLLBACK_KEY);
      return true;
    } catch { return false; }
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
    FORMAT,
    ROLLBACK_KEY,
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
    portableSnapshot,
    comparePortableSnapshot,
    applyPortableMerge,
    canUndoPortableMerge,
    undoLastPortableMerge,
    tagsFor
  });
})();
