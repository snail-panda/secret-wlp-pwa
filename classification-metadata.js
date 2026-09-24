/* WLP Stage 7 v1.8.6.121 — Classification Metadata v1 transfer + merge support. */
(() => {
  'use strict';

  const STORAGE_KEY = 'wlp:classification-meta:v1';
  const EVENT_NAME = 'wlp-classification-metadata-changed';
  const VERSION = 1;
  const ARRAY_FIELDS = ['entryTypes', 'usageTags', 'topicTags', 'discoveryTags'];
  const PORTABLE_FORMAT = 'WLP_CLASSIFICATION_METADATA_V1';
  const MERGE_ROLLBACK_KEY = 'wlp:classification-meta:merge-rollback:v1';
  const DEVICE_ID_KEY = 'wlp:device-id:v1';

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
        if (!/^(?:wid|draft):/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return;
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

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function comparableRecord(record) {
    const normalized = normalizeRecord(record);
    return Object.fromEntries(ARRAY_FIELDS.map(field => [
      field,
      normalized[field].map(fold).sort((a, b) => a.localeCompare(b, 'en-US'))
    ]));
  }

  function parseTime(value) {
    const ms = Date.parse(String(value || '').trim());
    return Number.isFinite(ms) ? ms : null;
  }

  function timeRelation(localRecord, incomingRecord) {
    const local = parseTime(localRecord?.updatedAt);
    const incoming = parseTime(incomingRecord?.updatedAt);
    if (local === null || incoming === null) return 'unknown';
    if (incoming > local) return 'incoming-newer';
    if (incoming < local) return 'local-newer';
    return 'same-time';
  }

  function portableSnapshot() {
    return {
      format: PORTABLE_FORMAT,
      schemaVersion: VERSION,
      exportedAt: new Date().toISOString(),
      sourceDeviceId: String(localStorage.getItem(DEVICE_ID_KEY) || ''),
      records: all()
    };
  }

  function validatePortableSnapshot(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('This file is not a Classification Metadata JSON.');
    }
    if (String(payload.format || '') !== PORTABLE_FORMAT) {
      throw new Error('This JSON is not a compatible Classification Metadata export.');
    }
    if (Number(payload.schemaVersion) !== VERSION) {
      throw new Error(`Classification schema v${payload.schemaVersion ?? '?'} cannot be merged into v${VERSION}.`);
    }
    if (!payload.records || typeof payload.records !== 'object' || Array.isArray(payload.records)) {
      throw new Error('This Classification file has no records object.');
    }
    const records = {};
    Object.entries(payload.records).forEach(([key, value]) => {
      if (!/^(?:wid|draft):/.test(key)) throw new Error(`Invalid Classification identity: ${key}`);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid Classification record: ${key}`);
      const normalized = normalizeRecord(value);
      if (key.startsWith('wid:')) {
        normalized.wordId = cleanTag(value.wordId || key.slice(4));
        delete normalized.localDraftId;
      } else {
        normalized.localDraftId = cleanTag(value.localDraftId || key.slice(6));
        delete normalized.wordId;
      }
      if (hasClassification(normalized)) records[key] = normalized;
    });
    return {
      format: PORTABLE_FORMAT,
      schemaVersion: VERSION,
      exportedAt: String(payload.exportedAt || ''),
      sourceDeviceId: String(payload.sourceDeviceId || ''),
      records
    };
  }

  function comparePortableSnapshot(payload) {
    const incoming = validatePortableSnapshot(payload);
    const localRecords = all();
    const items = [];
    const counts = {new:0, incomingNewer:0, same:0, localNewer:0, conflict:0};

    Object.entries(incoming.records).forEach(([key, incomingRecord]) => {
      const localRecord = localRecords[key] ? normalizeRecord(localRecords[key]) : null;
      if (!localRecord) {
        items.push({id:key, key, kind:'new', local:null, incoming:incomingRecord, reason:'No Classification record with this identity exists on this device.'});
        counts.new += 1;
        return;
      }
      if (stableStringify(comparableRecord(localRecord)) === stableStringify(comparableRecord(incomingRecord))) {
        items.push({id:key, key, kind:'same', local:localRecord, incoming:incomingRecord, reason:'Same Classification content.'});
        counts.same += 1;
        return;
      }
      const relation = timeRelation(localRecord, incomingRecord);
      if (relation === 'incoming-newer') {
        items.push({id:key, key, kind:'incoming-newer', local:localRecord, incoming:incomingRecord, reason:'The incoming Classification record has a later Updated At time.'});
        counts.incomingNewer += 1;
      } else if (relation === 'local-newer') {
        items.push({id:key, key, kind:'local-newer', local:localRecord, incoming:incomingRecord, reason:'This device has the later Classification record.'});
        counts.localNewer += 1;
      } else {
        items.push({id:key, key, kind:'conflict', local:localRecord, incoming:incomingRecord, timeRelation:relation, reason:relation === 'same-time' ? 'Classification content differs with the same Updated At time.' : 'Classification content differs and WLP cannot safely determine which copy is newer.'});
        counts.conflict += 1;
      }
    });

    return {
      format: incoming.format,
      schemaVersion: incoming.schemaVersion,
      exportedAt: incoming.exportedAt,
      sourceDeviceId: incoming.sourceDeviceId,
      currentDeviceId: String(localStorage.getItem(DEVICE_ID_KEY) || ''),
      baseRaw: localStorage.getItem(STORAGE_KEY),
      items,
      counts
    };
  }

  function hasMergeRollback() {
    try {
      const rollback = JSON.parse(localStorage.getItem(MERGE_ROLLBACK_KEY) || 'null');
      return Boolean(rollback && Object.prototype.hasOwnProperty.call(rollback, 'beforeRaw'));
    } catch {
      return false;
    }
  }

  function applyPortableMerge(plan, resolutions = {}, options = {}) {
    if (!plan || !Array.isArray(plan.items)) throw new Error('Classification merge plan is invalid.');
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if ((currentRaw ?? null) !== (plan.baseRaw ?? null)) {
      throw new Error('Classification Metadata changed after this preview was created. Compare the file again before merging.');
    }
    const state = readState();
    let added = 0, updated = 0, conflictIncoming = 0, conflictLocal = 0;
    plan.items.forEach(item => {
      if (item.kind === 'new') {
        state.records[item.key] = normalizeRecord(item.incoming);
        added += 1;
      } else if (item.kind === 'incoming-newer') {
        state.records[item.key] = normalizeRecord(item.incoming);
        updated += 1;
      } else if (item.kind === 'conflict') {
        if (resolutions[item.id] === 'incoming') {
          state.records[item.key] = normalizeRecord(item.incoming);
          conflictIncoming += 1;
        } else {
          conflictLocal += 1;
        }
      }
    });
    const changed = added + updated + conflictIncoming;
    if (!changed) return {changed, added, updated, conflictIncoming, conflictLocal};

    const beforeRaw = currentRaw;
    writeState(state);
    const afterRaw = localStorage.getItem(STORAGE_KEY);
    if (options.saveRollback !== false) {
      localStorage.setItem(MERGE_ROLLBACK_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        sourceExportedAt: String(plan.exportedAt || ''),
        sourceDeviceId: String(plan.sourceDeviceId || ''),
        beforeRaw,
        afterRaw
      }, null, 2));
    }
    return {changed, added, updated, conflictIncoming, conflictLocal};
  }

  function undoLastPortableMerge() {
    try {
      const rollback = JSON.parse(localStorage.getItem(MERGE_ROLLBACK_KEY) || 'null');
      if (!rollback || !Object.prototype.hasOwnProperty.call(rollback, 'beforeRaw')) return false;
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      if ((currentRaw ?? null) !== (rollback.afterRaw ?? null)) return false;
      if (rollback.beforeRaw === null || rollback.beforeRaw === undefined) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, rollback.beforeRaw);
      localStorage.removeItem(MERGE_ROLLBACK_KEY);
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
      return true;
    } catch {
      return false;
    }
  }

  window.WLPClassificationMetadata = Object.freeze({
    STORAGE_KEY,
    EVENT_NAME,
    VERSION,
    ARRAY_FIELDS: [...ARRAY_FIELDS],
    PORTABLE_FORMAT,
    MERGE_ROLLBACK_KEY,
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
    tagsFor,
    portableSnapshot,
    validatePortableSnapshot,
    comparePortableSnapshot,
    applyPortableMerge,
    hasMergeRollback,
    undoLastPortableMerge
  });
})();
