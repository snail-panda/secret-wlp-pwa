(() => {
  'use strict';

  // Learning Metadata v2 foundation.
  //
  // Goals:
  // - keep Sense / Memory separate from canonical Master/TSV fields;
  // - preserve every v1 Hook during automatic migration;
  // - give each metadata record stable identity + revision lineage;
  // - keep room for Entry Type / Situations / Alternative Expressions;
  // - record the device that created/changed a revision without making data
  //   device-siloed. Device identity is local-only and is not part of backup.
  //
  // IMPORTANT: v1 is intentionally left untouched as a local rollback shadow.
  const STORAGE_KEY = 'wlp:learning-meta:v2';
  const LEGACY_STORAGE_KEY = 'wlp:learning-meta:v1';
  const DEVICE_ID_KEY = 'wlp:device-id:v1';
  const SCHEMA_VERSION = 2;
  const KNOWN_FIELDS = ['senseHook', 'memoryHook', 'situations'];

  function clean(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function makeId(prefix = 'id') {
    let value = '';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') value = crypto.randomUUID();
    } catch {}
    if (!value) value = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}-${value}`;
  }

  function ensureDeviceId() {
    let id = clean(localStorage.getItem(DEVICE_ID_KEY));
    if (!id) {
      id = makeId('device');
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function parseJson(raw, fallback) {
    try {
      const value = JSON.parse(raw || '');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function parseEntryKey(key) {
    const safeKey = clean(key);
    if (safeKey.startsWith('wid:')) {
      return { entryKind: 'master', wordId: safeKey.slice(4), localDraftId: '' };
    }
    if (safeKey.startsWith('draft:')) {
      return { entryKind: 'draft', wordId: '', localDraftId: safeKey.slice(6) };
    }
    return { entryKind: 'local', wordId: '', localDraftId: '' };
  }

  function situationSnapshot(situation) {
    return {
      versionId: clean(situation?.versionId),
      parentVersionId: clean(situation?.parentVersionId),
      revision: Math.max(1, Number(situation?.revision) || 1),
      changedAt: clean(situation?.updatedAt),
      changedByDevice: clean(situation?.updatedByDevice),
      status: clean(situation?.status) || 'provisional',
      deletedAt: clean(situation?.deletedAt),
      anchor: clean(situation?.anchor),
      communicativeNeed: clean(situation?.communicativeNeed)
    };
  }

  function normalizeSituation(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { anchor: typeof value === 'string' ? value : '' };
    const now = new Date().toISOString();
    const updatedAt = clean(input.updatedAt) || now;
    const createdAt = clean(input.createdAt) || updatedAt;
    const deviceId = ensureDeviceId();
    return {
      situationId: clean(input.situationId) || makeId('sit'),
      status: clean(input.status) || 'provisional',
      revision: Math.max(1, Number(input.revision) || 1),
      versionId: clean(input.versionId) || makeId('sitver'),
      parentVersionId: clean(input.parentVersionId),
      createdAt,
      updatedAt,
      createdByDevice: clean(input.createdByDevice) || deviceId,
      updatedByDevice: clean(input.updatedByDevice) || deviceId,
      deletedAt: clean(input.deletedAt),
      anchor: clean(input.anchor ?? input.situationAnchor ?? input.text),
      communicativeNeed: clean(input.communicativeNeed),
      history: Array.isArray(input.history) ? clone(input.history) : []
    };
  }

  function normalizeSituations(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeSituation);
  }

  function activeSituations(value) {
    return normalizeSituations(value).filter(item => !item.deletedAt && item.anchor);
  }

  function emptyContent() {
    return {
      senseHook: '',
      memoryHook: '',
      entryType: '',
      situations: [],
      alternativeExpressions: []
    };
  }

  function normalizeContent(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      ...input,
      senseHook: clean(input.senseHook),
      memoryHook: clean(input.memoryHook),
      entryType: clean(input.entryType),
      situations: normalizeSituations(input.situations),
      alternativeExpressions: Array.isArray(input.alternativeExpressions) ? clone(input.alternativeExpressions) : []
    };
  }

  function hasContentPayload(content) {
    const value = normalizeContent(content);
    if (value.senseHook || value.memoryHook || value.entryType) return true;
    if (activeSituations(value.situations).length || value.alternativeExpressions.length) return true;
    return Object.entries(value).some(([key, item]) => {
      if (['senseHook','memoryHook','entryType','situations','alternativeExpressions'].includes(key)) return false;
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === 'object') return Object.keys(item).length > 0;
      return clean(item) !== '';
    });
  }

  function versionSnapshot(record) {
    return {
      versionId: clean(record?.versionId),
      parentVersionId: clean(record?.parentVersionId),
      revision: Math.max(1, Number(record?.revision) || 1),
      changedAt: clean(record?.updatedAt),
      changedByDevice: clean(record?.updatedByDevice),
      status: clean(record?.status) || 'provisional',
      deletedAt: clean(record?.deletedAt),
      content: normalizeContent(record?.content)
    };
  }

  function normalizeRecord(value, key) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const entry = parseEntryKey(key || input.entryKey);
    const now = new Date().toISOString();
    const updatedAt = clean(input.updatedAt) || now;
    const createdAt = clean(input.createdAt) || updatedAt;
    const deviceId = ensureDeviceId();
    return {
      metadataId: clean(input.metadataId) || makeId('meta'),
      entryKey: clean(key || input.entryKey),
      entryKind: clean(input.entryKind) || entry.entryKind,
      wordId: clean(input.wordId) || entry.wordId,
      localDraftId: clean(input.localDraftId) || entry.localDraftId,
      status: clean(input.status) || 'provisional',
      revision: Math.max(1, Number(input.revision) || 1),
      versionId: clean(input.versionId) || makeId('ver'),
      parentVersionId: clean(input.parentVersionId),
      createdAt,
      updatedAt,
      createdByDevice: clean(input.createdByDevice) || deviceId,
      updatedByDevice: clean(input.updatedByDevice) || deviceId,
      deletedAt: clean(input.deletedAt),
      content: normalizeContent(input.content || input),
      history: Array.isArray(input.history) ? clone(input.history) : []
    };
  }

  function emptyStore() {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      migratedFrom: '',
      migratedAt: '',
      records: {}
    };
  }

  function normalizeStore(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const store = {
      ...emptyStore(),
      ...input,
      schemaVersion: SCHEMA_VERSION,
      records: {}
    };
    const source = input.records && typeof input.records === 'object' && !Array.isArray(input.records) ? input.records : {};
    Object.entries(source).forEach(([key, record]) => {
      const safeKey = clean(key);
      if (!safeKey) return;
      store.records[safeKey] = normalizeRecord(record, safeKey);
    });
    return store;
  }

  function writeStore(store, emit = true) {
    const next = normalizeStore(store);
    next.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next, null, 2));
    if (emit) window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
    return next;
  }

  function migrateLegacyStore() {
    const legacy = parseJson(localStorage.getItem(LEGACY_STORAGE_KEY), {});
    const store = emptyStore();
    const migratedAt = new Date().toISOString();
    const deviceId = ensureDeviceId();
    store.migratedFrom = LEGACY_STORAGE_KEY;
    store.migratedAt = migratedAt;

    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      Object.entries(legacy).forEach(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const content = normalizeContent({
          senseHook: value.senseHook,
          memoryHook: value.memoryHook
        });
        if (!hasContentPayload(content)) return;
        const entry = parseEntryKey(key);
        const previousUpdatedAt = clean(value.updatedAt) || migratedAt;
        store.records[key] = {
          metadataId: makeId('meta'),
          entryKey: key,
          entryKind: entry.entryKind,
          wordId: entry.wordId,
          localDraftId: entry.localDraftId,
          status: 'provisional',
          revision: 1,
          versionId: makeId('ver'),
          parentVersionId: '',
          createdAt: previousUpdatedAt,
          updatedAt: previousUpdatedAt,
          createdByDevice: deviceId,
          updatedByDevice: deviceId,
          deletedAt: '',
          content,
          history: []
        };
      });
    }

    // Never delete or rewrite v1 here. It remains available as a rollback shadow.
    return writeStore(store, false);
  }

  function readStore() {
    const raw = parseJson(localStorage.getItem(STORAGE_KEY), null);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Number(raw.schemaVersion) === SCHEMA_VERSION && raw.records && typeof raw.records === 'object') {
      return normalizeStore(raw);
    }
    return migrateLegacyStore();
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

  function publicEntry(record) {
    if (!record || record.deletedAt) {
      return {
        ...emptyContent(),
        metadataId: '', status: 'provisional', revision: 0,
        versionId: '', parentVersionId: '', createdAt: '', updatedAt: '',
        createdByDevice: '', updatedByDevice: '', deletedAt: ''
      };
    }
    const content = normalizeContent(record.content);
    return {
      ...content,
      situations: activeSituations(content.situations),
      metadataId: record.metadataId,
      entryKey: record.entryKey,
      entryKind: record.entryKind,
      wordId: record.wordId,
      localDraftId: record.localDraftId,
      status: record.status,
      revision: record.revision,
      versionId: record.versionId,
      parentVersionId: record.parentVersionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdByDevice: record.createdByDevice,
      updatedByDevice: record.updatedByDevice,
      deletedAt: record.deletedAt
    };
  }

  function getRecord(key, includeDeleted = false) {
    const safeKey = clean(key);
    if (!safeKey) return null;
    const record = readStore().records[safeKey];
    if (!record || (!includeDeleted && record.deletedAt)) return null;
    return normalizeRecord(record, safeKey);
  }

  function get(key) {
    return publicEntry(getRecord(key));
  }

  function newSituation(value) {
    const now = new Date().toISOString();
    const deviceId = ensureDeviceId();
    return normalizeSituation({
      situationId: clean(value?.situationId) || makeId('sit'),
      status: clean(value?.status) || 'provisional',
      revision: 1,
      versionId: makeId('sitver'),
      parentVersionId: '',
      createdAt: now,
      updatedAt: now,
      createdByDevice: deviceId,
      updatedByDevice: deviceId,
      deletedAt: '',
      anchor: clean(value?.anchor),
      communicativeNeed: clean(value?.communicativeNeed),
      history: []
    });
  }

  function reconcileSituations(existingValue, requestedValue) {
    const existing = normalizeSituations(existingValue);
    if (!Array.isArray(requestedValue)) return existing;

    const currentById = new Map(existing.map(item => [item.situationId, item]));
    const requested = requestedValue
      .map(item => ({
        situationId: clean(item?.situationId),
        anchor: clean(item?.anchor ?? item?.situationAnchor ?? item?.text),
        communicativeNeed: clean(item?.communicativeNeed)
      }))
      .filter(item => item.anchor);

    const seen = new Set();
    const nextActive = requested.map(item => {
      let current = item.situationId ? currentById.get(item.situationId) : null;
      if (!current) {
        const created = newSituation(item);
        seen.add(created.situationId);
        return created;
      }
      seen.add(current.situationId);
      const same = !current.deletedAt
        && clean(current.anchor) === item.anchor
        && clean(current.communicativeNeed) === item.communicativeNeed;
      if (same) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        status: current.status || 'provisional',
        revision: current.revision + 1,
        parentVersionId: current.versionId,
        versionId: makeId('sitver'),
        updatedAt: now,
        updatedByDevice: ensureDeviceId(),
        deletedAt: '',
        anchor: item.anchor,
        communicativeNeed: item.communicativeNeed,
        history: [...current.history, situationSnapshot(current)]
      };
    });

    const removed = existing
      .filter(item => !item.deletedAt && !seen.has(item.situationId))
      .map(current => {
        const now = new Date().toISOString();
        return {
          ...current,
          revision: current.revision + 1,
          parentVersionId: current.versionId,
          versionId: makeId('sitver'),
          updatedAt: now,
          updatedByDevice: ensureDeviceId(),
          deletedAt: now,
          history: [...current.history, situationSnapshot(current)]
        };
      });
    const oldTombstones = existing.filter(item => item.deletedAt);
    return [...nextActive, ...removed, ...oldTombstones];
  }

  function contentSignature(content) {
    const value = normalizeContent(content);
    return JSON.stringify(value);
  }

  function makeNewRecord(key, values) {
    const now = new Date().toISOString();
    const deviceId = ensureDeviceId();
    const entry = parseEntryKey(key);
    return {
      metadataId: makeId('meta'),
      entryKey: key,
      entryKind: entry.entryKind,
      wordId: entry.wordId,
      localDraftId: entry.localDraftId,
      status: 'provisional',
      revision: 1,
      versionId: makeId('ver'),
      parentVersionId: '',
      createdAt: now,
      updatedAt: now,
      createdByDevice: deviceId,
      updatedByDevice: deviceId,
      deletedAt: '',
      content: normalizeContent({
        ...emptyContent(),
        senseHook: clean(values?.senseHook),
        memoryHook: clean(values?.memoryHook),
        situations: reconcileSituations([], Array.isArray(values?.situations) ? values.situations : [])
      }),
      history: []
    };
  }

  function save(key, values = {}) {
    const safeKey = clean(key);
    if (!safeKey) return publicEntry(null);
    const store = readStore();
    const currentRaw = store.records[safeKey];
    const current = currentRaw ? normalizeRecord(currentRaw, safeKey) : null;
    const requested = {
      senseHook: Object.prototype.hasOwnProperty.call(values, 'senseHook') ? clean(values.senseHook) : undefined,
      memoryHook: Object.prototype.hasOwnProperty.call(values, 'memoryHook') ? clean(values.memoryHook) : undefined,
      situations: Array.isArray(values?.situations) ? values.situations : undefined
    };

    if (!current) {
      const record = makeNewRecord(safeKey, requested);
      if (!hasContentPayload(record.content)) return publicEntry(null);
      store.records[safeKey] = record;
      writeStore(store);
      return publicEntry(record);
    }

    const nextContent = normalizeContent({
      ...current.content,
      senseHook: requested.senseHook === undefined ? current.content.senseHook : requested.senseHook,
      memoryHook: requested.memoryHook === undefined ? current.content.memoryHook : requested.memoryHook,
      situations: requested.situations === undefined
        ? current.content.situations
        : reconcileSituations(current.content.situations, requested.situations)
    });
    const willDelete = !hasContentPayload(nextContent);
    const alreadyDeleted = Boolean(current.deletedAt);
    if (contentSignature(current.content) === contentSignature(nextContent) && willDelete === alreadyDeleted) return publicEntry(current);

    const now = new Date().toISOString();
    const next = {
      ...current,
      revision: current.revision + 1,
      parentVersionId: current.versionId,
      versionId: makeId('ver'),
      updatedAt: now,
      updatedByDevice: ensureDeviceId(),
      deletedAt: willDelete ? now : '',
      content: nextContent,
      history: [...current.history, versionSnapshot(current)]
    };
    store.records[safeKey] = next;
    writeStore(store);
    return publicEntry(next);
  }

  function remove(key) {
    const safeKey = clean(key);
    if (!safeKey) return;
    const store = readStore();
    const currentRaw = store.records[safeKey];
    if (!currentRaw) return;
    const current = normalizeRecord(currentRaw, safeKey);
    if (current.deletedAt) return;
    const now = new Date().toISOString();
    const next = {
      ...current,
      revision: current.revision + 1,
      parentVersionId: current.versionId,
      versionId: makeId('ver'),
      updatedAt: now,
      updatedByDevice: ensureDeviceId(),
      deletedAt: now,
      history: [...current.history, versionSnapshot(current)]
    };
    store.records[safeKey] = next;
    writeStore(store);
  }

  function all() {
    const store = readStore();
    const out = {};
    Object.entries(store.records).forEach(([key, raw]) => {
      const record = normalizeRecord(raw, key);
      if (record.deletedAt || !hasContentPayload(record.content)) return;
      out[key] = publicEntry(record);
    });
    return out;
  }

  function allRecords(options = {}) {
    const includeDeleted = Boolean(options.includeDeleted);
    const store = readStore();
    const out = {};
    Object.entries(store.records).forEach(([key, raw]) => {
      const record = normalizeRecord(raw, key);
      if (!includeDeleted && record.deletedAt) return;
      out[key] = clone(record);
    });
    return out;
  }

  function count() {
    return Object.keys(all()).length;
  }

  function situationEditorParts(form) {
    const block = form?.querySelector?.('[data-learning-situations]');
    return {
      block,
      list: block?.querySelector?.('[data-situation-list]') || null,
      add: block?.querySelector?.('[data-add-situation]') || null
    };
  }

  function makeSituationRow(value = {}, index = 0) {
    const row = document.createElement('div');
    row.className = 'learning-situation-row';
    row.dataset.situationRow = '';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'Situation ID';
    hidden.value = clean(value.situationId);
    hidden.dataset.situationId = '';

    const top = document.createElement('div');
    top.className = 'learning-situation-row-head';
    const label = document.createElement('span');
    label.className = 'learning-situation-row-label';
    label.textContent = `Situation ${index + 1}`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'learning-situation-remove';
    removeButton.dataset.removeSituation = '';
    removeButton.textContent = 'Remove';
    top.append(label, removeButton);

    const textarea = document.createElement('textarea');
    textarea.name = 'Situation Anchor';
    textarea.rows = 3;
    textarea.dataset.situationAnchor = '';
    textarea.placeholder = "e.g. You've asked them several times to fix the same problem. Nothing has changed.";
    textarea.value = clean(value.anchor);
    textarea.setAttribute('aria-label', `Situation Anchor ${index + 1}`);

    row.append(hidden, top, textarea);
    return row;
  }

  function refreshSituationRowLabels(list) {
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('[data-situation-row]'));
    rows.forEach((row, index) => {
      const label = row.querySelector('.learning-situation-row-label');
      const textarea = row.querySelector('[data-situation-anchor]');
      if (label) label.textContent = `Situation ${index + 1}`;
      if (textarea) textarea.setAttribute('aria-label', `Situation Anchor ${index + 1}`);
    });
  }

  function renderSituationRows(form, situations = []) {
    const { list } = situationEditorParts(form);
    if (!list) return;
    const active = Array.isArray(situations)
      ? situations.filter(item => !item?.deletedAt && clean(item?.anchor))
      : [];
    list.innerHTML = '';
    const rows = active.length ? active : [{}];
    rows.forEach((item, index) => list.appendChild(makeSituationRow(item, index)));
    refreshSituationRowLabels(list);
  }

  function installSituationEditor(form) {
    const { block, list, add } = situationEditorParts(form);
    if (!block || !list || block.dataset.situationEditorInstalled === 'true') return;
    block.dataset.situationEditorInstalled = 'true';
    if (!list.querySelector('[data-situation-row]')) renderSituationRows(form, []);

    add?.addEventListener('click', () => {
      const index = list.querySelectorAll('[data-situation-row]').length;
      const row = makeSituationRow({}, index);
      list.appendChild(row);
      row.querySelector('[data-situation-anchor]')?.focus();
    });
    list.addEventListener('click', event => {
      const button = event.target.closest?.('[data-remove-situation]');
      if (!button) return;
      button.closest('[data-situation-row]')?.remove();
      if (!list.querySelector('[data-situation-row]')) list.appendChild(makeSituationRow({}, 0));
      refreshSituationRowLabels(list);
    });
    form.addEventListener('reset', () => setTimeout(() => renderSituationRows(form, []), 0));
  }

  function situationsFromForm(form) {
    installSituationEditor(form);
    const { list } = situationEditorParts(form);
    if (!list) return [];
    return Array.from(list.querySelectorAll('[data-situation-row]')).map(row => {
      const anchor = clean(row.querySelector('[data-situation-anchor]')?.value);
      const hidden = row.querySelector('[data-situation-id]');
      if (anchor && hidden && !clean(hidden.value)) hidden.value = makeId('sit');
      return { situationId: clean(hidden?.value), anchor, communicativeNeed: '' };
    }).filter(item => item.anchor);
  }

  function fromForm(form) {
    if (!form) return { senseHook: '', memoryHook: '', situations: [] };
    const fd = new FormData(form);
    return {
      senseHook: clean(fd.get('Sense Hook')),
      memoryHook: clean(fd.get('Memory Hook')),
      situations: situationsFromForm(form)
    };
  }

  function fillForm(form, entry) {
    if (!form) return;
    installSituationEditor(form);
    const hooks = entry && typeof entry === 'object' ? entry : publicEntry(null);
    const sense = form.elements.namedItem('Sense Hook');
    const memory = form.elements.namedItem('Memory Hook');
    if (sense) sense.value = clean(hooks.senseHook);
    if (memory) memory.value = clean(hooks.memoryHook);
    renderSituationRows(form, Array.isArray(hooks.situations) ? hooks.situations : []);
  }

  // Future Draft -> Master promotion can preserve metadata identity rather than
  // creating an unrelated record. This is deliberately API-only in v2.
  function promoteDraftToMaster(localId, wordId) {
    const fromKey = draftKey(localId);
    const toKey = masterKey(wordId);
    if (!fromKey || !toKey || fromKey === toKey) return false;
    const store = readStore();
    const sourceRaw = store.records[fromKey];
    if (!sourceRaw) return false;
    if (store.records[toKey] && !normalizeRecord(store.records[toKey], toKey).deletedAt) return false;
    const source = normalizeRecord(sourceRaw, fromKey);
    const now = new Date().toISOString();
    const next = {
      ...source,
      entryKey: toKey,
      entryKind: 'master',
      wordId: clean(wordId),
      localDraftId: '',
      revision: source.revision + 1,
      parentVersionId: source.versionId,
      versionId: makeId('ver'),
      updatedAt: now,
      updatedByDevice: ensureDeviceId(),
      deletedAt: '',
      history: [...source.history, versionSnapshot(source)]
    };
    store.records[toKey] = next;
    delete store.records[fromKey];
    writeStore(store);
    return true;
  }

  function portableSnapshot() {
    const store = readStore();
    return {
      format: 'WLP_LEARNING_METADATA',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceDeviceId: ensureDeviceId(),
      records: clone(store.records)
    };
  }

  // Trigger migration as soon as the shared module loads so pages never have
  // to know whether the browser still has v1 or already has v2.
  readStore();

  const installSituationEditors = () => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('form').forEach(form => installSituationEditor(form));
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSituationEditors, { once: true });
    else installSituationEditors();
  }

  window.WLPLearningHooks = Object.freeze({
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    DEVICE_ID_KEY,
    SCHEMA_VERSION,
    KNOWN_FIELDS,
    masterKey,
    draftKey,
    keyForRow,
    get,
    getRecord,
    getForMaster: wordId => get(masterKey(wordId)),
    getForDraft: localId => get(draftKey(localId)),
    save,
    saveForMaster: (wordId, values) => save(masterKey(wordId), values),
    saveForDraft: (localId, values) => save(draftKey(localId), values),
    remove,
    removeForDraft: localId => remove(draftKey(localId)),
    all,
    allRecords,
    count,
    fromForm,
    fillForm,
    installSituationEditor,
    activeSituations,
    promoteDraftToMaster,
    portableSnapshot,
    deviceId: ensureDeviceId
  });
})();
