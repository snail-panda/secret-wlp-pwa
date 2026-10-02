/* WLP v1.8.6.267 · Canonical Mirror Compatibility Adapter · authoritative state overlay on preserved migration evidence.
   Reads only the installed wlp-cloud-v1 IndexedDB mirror and projects it into
   legacy-scanner logical record shapes in memory. Authority v2 introduced explicit
   first_seen_at to learning_state; the adapter carries that exact value into
   the page-facing logical snapshot. No Cloud, IndexedDB, localStorage, or live
   WLP write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.267-canonical-compat-adapter-authoritative-state-overlay-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const AUTHORITY_SPECS = Object.freeze({
    'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283': Object.freeze({ label:'v2', headVersion:2, migrationVersion:'3', manifest:'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3', rows:21424 }),
    'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc': Object.freeze({ label:'v3', headVersion:3, migrationVersion:'3', manifest:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63', rows:21425 })
  });
  const EXPECTED_FIRST_SEEN_ROWS = 111;
  function authoritySpec(meta) { return AUTHORITY_SPECS[String(meta?.candidateKey || '')] || null; }
  function mirrorSpec(meta) {
    const base = authoritySpec(meta);
    if (!base) return null;
    const cursor = Number(meta?.materializedSyncCursor ?? meta?.lastSyncCursor ?? 0);
    const materializedManifest = String(meta?.materializedManifestHash || '');
    const materializedRows = Number(meta?.materializedCanonicalRowCount || 0);
    if (cursor > 2 && /^[0-9a-f]{64}$/i.test(materializedManifest) && materializedRows >= base.rows) {
      return Object.freeze({ ...base, label:`${base.label}+sync@${cursor}`, manifest:materializedManifest, rows:materializedRows, materialized:true, cursor });
    }
    return Object.freeze({ ...base, materialized:false, cursor });
  }
  const CANONICAL_TABLES = Object.freeze([
    'card_classification', 'card_content', 'card_learning_metadata', 'cards',
    'learner_profile', 'learner_route_state', 'learning_alternative_situations',
    'learning_alternatives', 'learning_events', 'learning_sessions',
    'learning_situations', 'learning_state', 'study_build_cards', 'study_builds',
    'study_context_cards', 'study_contexts', 'user_preferences'
  ]);
  const state = { busy: false, report: null };

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }
  function clean(value) { return String(value ?? '').trim(); }
  function asArray(value) { return Array.isArray(value) ? value : []; }
  function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        if (value[key] !== undefined) out[key] = stableValue(value[key]);
      });
      return out;
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(stableValue(value)); }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }
  function toMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = Number(value);
    if (Number.isFinite(number) && String(value).trim() !== '') {
      if (number <= 0) return 0;
      return number < 100000000000 ? Math.round(number * 1000) : Math.round(number);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }
  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });
  }

  function openExistingMirrorReadOnly() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
    return new Promise((resolve, reject) => {
      let rejectedForUpgrade = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        rejectedForUpgrade = true;
        try { request.transaction.abort(); } catch (_) {}
      };
      request.onsuccess = () => {
        if (rejectedForUpgrade) {
          request.result.close();
          reject(new Error('Compatibility projection blocked: wlp-cloud-v1 does not already exist at schema version 1.'));
          return;
        }
        const db = request.result;
        const required = [...CANONICAL_TABLES, META_STORE, OUTBOX_STORE];
        const missing = required.filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) {
          db.close();
          reject(new Error(`Compatibility projection blocked: mirror schema is missing object store(s): ${missing.join(', ')}.`));
          return;
        }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open existing wlp-cloud-v1 IndexedDB.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP page. Close other WLP tabs and retry.'));
    });
  }

  async function getAll(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const rows = await requestPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return rows || [];
  }
  async function getOne(db, storeName, key) {
    const tx = db.transaction(storeName, 'readonly');
    const value = await requestPromise(tx.objectStore(storeName).get(key));
    await transactionDone(tx);
    return value || null;
  }
  async function countStore(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const count = await requestPromise(tx.objectStore(storeName).count());
    await transactionDone(tx);
    return Number(count || 0);
  }

  function tablePrimaryKey(table, row) {
    const keys = {
      cards: item => item.card_id,
      card_content: item => item.card_id,
      card_learning_metadata: item => item.card_id,
      learning_situations: item => item.situation_id,
      learning_alternatives: item => item.alternative_id,
      learning_alternative_situations: item => `${item.alternative_id}|${item.situation_id}`,
      card_classification: item => item.card_id,
      learning_sessions: item => item.session_id,
      learning_events: item => item.event_id,
      learning_state: item => item.card_id,
      learner_profile: () => 'account',
      learner_route_state: () => 'account',
      study_contexts: item => item.context_id,
      study_context_cards: item => `${item.context_id}|${item.ordinal}`,
      study_builds: item => item.build_id,
      study_build_cards: item => `${item.build_id}|${item.ordinal}`,
      user_preferences: item => item.section
    };
    return String(keys[table]?.(row) || '');
  }

  async function readMirror(db) {
    const tables = {};
    const wrapperByIdentity = new Map();
    const payloadHashMismatches = [];
    const rowKeyMismatches = [];
    const fingerprints = [];
    let payloadHashesVerified = 0;

    for (const tableName of CANONICAL_TABLES) {
      const wrappers = await getAll(db, tableName);
      tables[tableName] = wrappers.map(wrapper => clone(wrapper.payload));
      for (const wrapper of wrappers) {
        const rowKey = String(wrapper.rowKey || '');
        const payload = wrapper.payload || {};
        const payloadKey = tablePrimaryKey(tableName, payload);
        if (payloadKey !== rowKey) rowKeyMismatches.push(`${tableName}|${rowKey}: payload primary key is ${payloadKey || '(missing)'}.`);
        const computed = await sha256(stableStringify(payload));
        if (computed !== String(wrapper.payloadHash || '')) payloadHashMismatches.push(`${tableName}|${rowKey}: stored ${wrapper.payloadHash || '(missing)'}, computed ${computed}.`);
        else payloadHashesVerified += 1;
        const item = {
          tableName,
          rowKey,
          tombstone: Boolean(wrapper.tombstone),
          payloadHash: String(wrapper.payloadHash || ''),
          payload: clone(payload)
        };
        wrapperByIdentity.set(identity(tableName, rowKey), item);
        fingerprints.push({ tableName, rowKey, tombstone: item.tombstone, payloadHash: item.payloadHash });
      }
    }
    fingerprints.sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    return {
      tables,
      wrapperByIdentity,
      fingerprints,
      rowCount: fingerprints.length,
      payloadHashesVerified,
      payloadHashMismatches,
      rowKeyMismatches,
      meta: await getOne(db, META_STORE, META_KEY),
      outboxRows: await countStore(db, OUTBOX_STORE),
      manifestHash: await sha256(stableStringify(fingerprints))
    };
  }

  async function makeLogicalRecord(entityType, entityKey, payload, options = {}) {
    const payloadHash = options.payloadHash !== undefined
      ? options.payloadHash
      : await sha256(stableStringify(payload));
    return {
      entityType,
      entityKey: String(entityKey || ''),
      payloadHash: payloadHash == null ? '' : String(payloadHash),
      tombstone: Boolean(options.tombstone),
      payloadBytes: new TextEncoder().encode(stableStringify(payload)).byteLength,
      source: options.source || '',
      payload: clone(payload)
    };
  }

  function cardLookup(tables) {
    const byId = new Map();
    const byLegacy = new Map();
    for (const card of asArray(tables.cards)) {
      byId.set(card.card_id, card);
      byLegacy.set(card.legacy_key, card);
    }
    return { byId, byLegacy };
  }

  function isoOrEmpty(value) { return value || ''; }

  function synthesizeLearningState(row) {
    return {
      studied: Boolean(row.studied),
      known: typeof row.known === 'boolean' ? row.known : null,
      review: Boolean(row.review),
      reviewLevel: row.review_level || null,
      reviewReasons: asArray(row.review_reasons).map(String),
      exposureCount: Number(row.exposure_count || 0),
      studyCount: Number(row.study_count || 0),
      reviewCount: Number(row.review_count || 0),
      attemptCount: Number(row.attempt_count || 0),
      firstSeen: toMs(row.first_seen_at) || null,
      lastSeen: row.last_seen_at || null,
      lastStudiedAt: row.last_studied_at || null,
      lastReviewedAt: row.last_reviewed_at || null,
      lastPracticedAt: row.last_practiced_at || null,
      lastResult: row.last_result || null,
      lastAttentionUpdatedAt: row.last_attention_updated_at || null,
      revision: Number(row.revision || 1),
      updatedAt: row.updated_at || null
    };
  }

  async function projectLogicalRecords(tables) {
    const blocking = [];
    const warnings = [];
    const records = [];
    const keys = new Set();
    const stats = {};
    const count = type => { stats[type] = (stats[type] || 0) + 1; };
    const push = record => {
      const key = `${record.entityType}|${record.entityKey}`;
      if (!record.entityKey) blocking.push(`Projected ${record.entityType} record has empty identity.`);
      if (keys.has(key)) blocking.push(`Duplicate projected logical identity: ${key}.`);
      keys.add(key);
      records.push(record);
      count(record.entityType);
    };

    const cards = [...asArray(tables.cards)].sort((a, b) => String(a.order_key || '').localeCompare(String(b.order_key || '')) || String(a.legacy_key || '').localeCompare(String(b.legacy_key || '')));
    const cardsById = new Map(cards.map(row => [row.card_id, row]));
    const officialBaseHashes = [...new Set(cards.map(row => row.official_base_hash).filter(Boolean))];
    if (officialBaseHashes.length > 1) blocking.push(`Official cards contain ${officialBaseHashes.length} different official_base_hash values.`);
    const sourceMasterHash = officialBaseHashes[0] || null;

    for (const row of cards) {
      const payload = {
        cardKey: row.legacy_key,
        wordId: row.word_id,
        status: row.status,
        originKind: row.origin_kind,
        originRef: row.origin_ref,
        legacyBatch: row.legacy_batch,
        legacyGuidance: row.legacy_guidance,
        createdAt: isoOrEmpty(row.created_at),
        updatedAt: isoOrEmpty(row.updated_at),
        deletedAt: isoOrEmpty(row.deleted_at)
      };
      push(await makeLogicalRecord('card', row.legacy_key, payload, { tombstone: Boolean(row.deleted_at), source: row.origin_kind === 'personal' ? 'draft' : 'master' }));
    }

    for (const row of asArray(tables.card_content)) {
      const card = cardsById.get(row.card_id);
      if (!card) { blocking.push(`card_content ${row.card_id} has no Card for compatibility projection.`); continue; }
      const payload = {
        Word: row.word ?? '',
        IPA: row.ipa ?? '',
        'Part of Speech': row.part_of_speech ?? '',
        Definition: row.definition ?? '',
        'Synonym(s)': row.synonyms ?? '',
        'Example Sentence': row.example_sentence ?? '',
        'Note(s)': row.notes ?? '',
        Category: row.category ?? '',
        Source: row.source ?? ''
      };
      push(await makeLogicalRecord('card_content', card.legacy_key, payload, { source: row.migration_source || '', payloadHash: row.source_payload_hash || '' }));
    }

    const situationsByCard = new Map();
    const sourceSituationByCanonical = new Map();
    for (const row of asArray(tables.learning_situations)) {
      if (!situationsByCard.has(row.card_id)) situationsByCard.set(row.card_id, []);
      situationsByCard.get(row.card_id).push(row);
      sourceSituationByCanonical.set(row.situation_id, row.source_situation_id);
    }
    const linksByAlternative = new Map();
    for (const row of asArray(tables.learning_alternative_situations)) {
      if (!linksByAlternative.has(row.alternative_id)) linksByAlternative.set(row.alternative_id, []);
      linksByAlternative.get(row.alternative_id).push(row.situation_id);
    }
    const alternativesByCard = new Map();
    for (const row of asArray(tables.learning_alternatives)) {
      if (!alternativesByCard.has(row.card_id)) alternativesByCard.set(row.card_id, []);
      alternativesByCard.get(row.card_id).push(row);
    }

    for (const row of asArray(tables.card_learning_metadata)) {
      const card = cardsById.get(row.card_id);
      if (!card) { blocking.push(`card_learning_metadata ${row.card_id} has no Card for compatibility projection.`); continue; }
      const situations = [...(situationsByCard.get(row.card_id) || [])].sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0)).map(s => ({
        situationId: s.source_situation_id,
        title: s.title ?? '',
        anchor: s.anchor ?? '',
        communicativeNeed: s.communicative_need ?? '',
        status: s.status,
        revision: s.revision,
        versionId: s.version_id,
        parentVersionId: s.parent_version_id,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        createdByDevice: s.created_by_device,
        updatedByDevice: s.updated_by_device,
        deletedAt: s.deleted_at,
        history: clone(s.source_history || [])
      }));
      const alternatives = [...(alternativesByCard.get(row.card_id) || [])].sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0)).map(a => ({
        alternativeId: a.source_alternative_id,
        expression: a.expression ?? '',
        note: a.notes ?? '',
        status: a.status,
        revision: a.revision,
        versionId: a.version_id,
        parentVersionId: a.parent_version_id,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        updatedByDevice: a.updated_by_device,
        deletedAt: a.deleted_at,
        history: clone(a.source_history || []),
        situationIds: (linksByAlternative.get(a.alternative_id) || []).map(id => sourceSituationByCanonical.get(id)).filter(Boolean)
      }));
      const payload = {
        metadataId: row.metadata_id,
        status: row.status,
        revision: row.revision,
        versionId: row.version_id,
        parentVersionId: row.parent_version_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdByDevice: row.created_by_device,
        updatedByDevice: row.updated_by_device,
        deletedAt: row.deleted_at,
        history: clone(row.source_history || []),
        content: {
          entryType: row.entry_type ?? '',
          senseHook: row.sense_hook ?? '',
          memoryHook: row.memory_hook ?? '',
          situations,
          alternativeExpressions: alternatives
        }
      };
      push(await makeLogicalRecord('card_learning_metadata', card.legacy_key, payload, { tombstone: Boolean(row.deleted_at), source: 'learning-meta' }));
    }

    for (const row of asArray(tables.card_classification)) {
      const card = cardsById.get(row.card_id);
      if (!card) { blocking.push(`card_classification ${row.card_id} has no Card for compatibility projection.`); continue; }
      const payload = {
        entryTypes: clone(row.entry_types || []),
        usageTags: clone(row.usage_tags || []),
        topicTags: clone(row.topic_tags || []),
        discoveryTags: clone(row.discovery_tags || []),
        revision: row.revision,
        updatedAt: row.updated_at,
        updatedByDevice: row.updated_by_device,
        deletedAt: row.deleted_at
      };
      push(await makeLogicalRecord('card_classification', card.legacy_key, payload, { tombstone: Boolean(row.deleted_at), source: 'classification' }));
    }

    for (const row of asArray(tables.learning_sessions)) {
      const stream = clean(row.session_type) || 'unknown';
      const sourceId = clean(row.source_session_id);
      if (!sourceId) { blocking.push(`learning_session ${row.session_id} has no source_session_id for compatibility projection.`); continue; }
      push(await makeLogicalRecord('learning_session', `${stream}:${sourceId}`, { sourceStream: stream, session: clone(row.payload || {}) }, { source: `projected:${stream}:sessions` }));
    }

    for (const row of asArray(tables.learning_events)) {
      const stream = clean(row.source_stream) || 'unknown';
      const sourceId = clean(row.source_event_id);
      if (!sourceId) { blocking.push(`learning_event ${row.event_id} has no source_event_id for compatibility projection.`); continue; }
      push(await makeLogicalRecord('learning_event', `${stream}:${sourceId}`, { sourceStream: stream, event: clone(row.payload || {}) }, { source: `projected:${stream}:events` }));
    }

    let synthesizedStateRows = 0;
    let preservedSourceSnapshotRows = 0;
    let explicitFirstSeenRows = 0;
    for (const row of asArray(tables.learning_state)) {
      const card = cardsById.get(row.card_id);
      if (!card) { blocking.push(`learning_state ${row.card_id} has no Card for compatibility projection.`); continue; }
      const explicitFirstSeen = toMs(row.first_seen_at);
      if (explicitFirstSeen) explicitFirstSeenRows += 1;
      else blocking.push(`learning_state ${row.card_id} is missing explicit Canonical first_seen_at.`);
      const authoritativeState = synthesizeLearningState(row);
      let payload;
      if (hasOwn(row, 'source_snapshot') && row.source_snapshot && typeof row.source_snapshot === 'object') {
        // Preserve migration-only evidence, but current Canonical fields are authority.
        // A materialized post-cutover mutation must never be hidden by a stale source_snapshot.
        payload = { ...clone(row.source_snapshot), ...authoritativeState };
        preservedSourceSnapshotRows += 1;
      } else {
        payload = authoritativeState;
        synthesizedStateRows += 1;
      }
      if (explicitFirstSeen) payload.firstSeen = explicitFirstSeen;
      push(await makeLogicalRecord('learning_state', card.legacy_key, payload, { source: `fc:wordid:${card.word_id ?? ''}` }));
    }

    for (const row of asArray(tables.learner_profile)) push(await makeLogicalRecord('learner_profile', 'account', clone(row.profile || {}), { source: 'wlp:ai-learner-profile:v1' }));
    for (const row of asArray(tables.learner_route_state)) push(await makeLogicalRecord('learner_route_state', 'account', clone(row.route_state || {}), { source: 'wlp:ai-route-state:v1' }));

    for (const row of asArray(tables.study_contexts)) {
      const sourceId = clean(row.source_context_id);
      if (!sourceId) { blocking.push(`study_context ${row.context_id} has no source_context_id for compatibility projection.`); continue; }
      push(await makeLogicalRecord('study_context', sourceId, clone(row.payload || {}), { tombstone: Boolean(row.deleted_at), source: 'wlp:study-contexts:v1' }));
    }
    for (const row of asArray(tables.study_builds)) {
      const sourceId = clean(row.source_build_id);
      if (!sourceId) { blocking.push(`study_build ${row.build_id} has no source_build_id for compatibility projection.`); continue; }
      push(await makeLogicalRecord('study_build', sourceId, clone(row.payload || {}), { tombstone: Boolean(row.deleted_at), source: 'wlp:build-history:v1' }));
    }

    let preferenceKeys = 0;
    for (const row of asArray(tables.user_preferences)) {
      const payload = asObject(row.payload);
      for (const key of Object.keys(payload).sort()) {
        preferenceKeys += 1;
        push(await makeLogicalRecord('user_preference', key, { key, value: clone(payload[key]) }, { source: key }));
      }
    }

    const projectionHash = await sha256(stableStringify(records.map(record => ({
      entityType: record.entityType,
      entityKey: record.entityKey,
      payloadHash: record.payloadHash,
      tombstone: record.tombstone,
      source: record.source,
      payload: record.payload
    }))));

    warnings.push(`${preservedSourceSnapshotRows} learning_state row(s) preserve migration source_snapshot evidence while authoritative Canonical state fields override it; ${synthesizedStateRows} row(s) are projected directly from authoritative Canonical fields.`);
    warnings.push(`${explicitFirstSeenRows} learning_state row(s) carry explicit Canonical first_seen_at into the compatibility projection.`);

    return { records, sourceMasterHash, blocking, warnings, stats, preferenceKeys, synthesizedStateRows, preservedSourceSnapshotRows, explicitFirstSeenRows, projectionHash };
  }


  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function buildReadOnlyAdapter(projection, mirrorMeta, outboxRows = 0) {
    const internal = new Map();
    const byType = new Map();
    for (const sourceRecord of projection.records) {
      const record = clone(sourceRecord);
      const id = `${record.entityType}\u0000${record.entityKey}`;
      internal.set(id, record);
      if (!byType.has(record.entityType)) byType.set(record.entityType, []);
      byType.get(record.entityType).push(id);
    }
    for (const ids of byType.values()) ids.sort();

    const getRecord = (entityType, entityKey) => {
      const row = internal.get(`${String(entityType)}\u0000${String(entityKey)}`);
      return row ? clone(row) : null;
    };
    const list = entityType => (byType.get(String(entityType)) || []).map(id => clone(internal.get(id)));
    const getCardBundle = legacyKey => {
      const key = String(legacyKey || '');
      const card = getRecord('card', key);
      if (!card) return null;
      return {
        card,
        content: getRecord('card_content', key),
        learningMetadata: getRecord('card_learning_metadata', key),
        classification: getRecord('card_classification', key),
        learningState: getRecord('learning_state', key)
      };
    };
    const getPreference = key => {
      const row = getRecord('user_preference', String(key || ''));
      return row ? clone(row.payload?.value) : undefined;
    };
    const listEvents = stream => list('learning_event').filter(row => !stream || row.payload?.sourceStream === stream);
    const listSessions = stream => list('learning_session').filter(row => !stream || row.payload?.sourceStream === stream);
    const exportLogicalSnapshot = () => projection.records.map(clone);

    return Object.freeze({
      version: 1,
      readOnly: true,
      source: 'wlp-cloud-v1',
      projectionHash: projection.projectionHash,
      logicalRecordCount: projection.records.length,
      pendingOutboxRows: Number(outboxRows || 0),
      meta: deepFreeze(clone({
        candidateKey: mirrorMeta?.candidateKey || null,
        headVersion: mirrorMeta?.headVersion ?? null,
        snapshotManifestHash: mirrorMeta?.snapshotManifestHash || null,
        canonicalRowCount: mirrorMeta?.canonicalRowCount ?? null,
        migrationVersion: mirrorMeta?.migrationVersion || null,
        authorityRevision: mirrorMeta?.authorityRevision ?? null,
        namespaceUuid: mirrorMeta?.namespaceUuid || null,
        cardMappingHash: mirrorMeta?.cardMappingHash || null,
        coreLibraryHash: mirrorMeta?.coreLibraryHash || null
      })),
      get: getRecord,
      list,
      getCardBundle,
      getPreference,
      listEvents,
      listSessions,
      exportLogicalSnapshot
    });
  }

  async function openAdapterInternal() {
    let db = null;
    try {
      db = await openExistingMirrorReadOnly();
      const mirror = await readMirror(db);
      const blocking = [];
      if (!mirror.meta) blocking.push('authority_mirror metadata is missing.');
      if (mirror.meta && !mirror.meta.userId) blocking.push('authority_mirror metadata is not user-bound.');
      const expectedAuthority = authoritySpec(mirror.meta);
      const expectedMirror = mirrorSpec(mirror.meta);
      if (!expectedAuthority || !expectedMirror) blocking.push('Mirror metadata is not a supported verified Authority bootstrap revision.');
      if (expectedMirror && mirror.rowCount !== expectedMirror.rows) blocking.push(`Mirror row count mismatch: expected ${expectedMirror.rows}, got ${mirror.rowCount}.`);
      if (expectedMirror && mirror.manifestHash !== expectedMirror.manifest) blocking.push(`Mirror manifest does not match ${expectedMirror.label}.`);
      if (expectedAuthority && String(mirror.meta?.snapshotManifestHash || '') !== expectedAuthority.manifest) blocking.push(`Mirror bootstrap manifest does not match supported ACTIVE Authority ${expectedAuthority.label}.`);
      if (expectedAuthority && Number(mirror.meta?.headVersion || 0) !== expectedAuthority.headVersion) blocking.push(`Mirror metadata Head version is not ${expectedAuthority.headVersion}.`);
      if (expectedAuthority && String(mirror.meta?.migrationVersion || '') !== expectedAuthority.migrationVersion) blocking.push(`Mirror metadata migration version is not ${expectedAuthority.migrationVersion}.`);
      if (expectedAuthority && Number(mirror.meta?.canonicalRowCount || 0) !== expectedAuthority.rows) blocking.push(`Mirror bootstrap row-count metadata is not ${expectedAuthority.rows}.`);
      if (mirror.payloadHashMismatches.length) blocking.push(`${mirror.payloadHashMismatches.length} mirror payload hash mismatch(es).`);
      if (mirror.rowKeyMismatches.length) blocking.push(`${mirror.rowKeyMismatches.length} mirror row-key mismatch(es).`);
      if (blocking.length) throw new Error(blocking.join(' '));

      const projection = await projectLogicalRecords(mirror.tables);
      if (projection.blocking.length) throw new Error(projection.blocking.join(' '));
      const materializedStateRows = asArray(mirror.tables.learning_state).length;
      if (materializedStateRows < EXPECTED_FIRST_SEEN_ROWS || projection.explicitFirstSeenRows !== materializedStateRows) throw new Error(`Compatibility projection firstSeen coverage mismatch: expected at least ${EXPECTED_FIRST_SEEN_ROWS} learning_state row(s) and explicit firstSeen on all materialized rows; got ${projection.explicitFirstSeenRows}/${materializedStateRows}.`);
      return { adapter: buildReadOnlyAdapter(projection, mirror.meta, mirror.outboxRows), mirror, projection };
    } finally {
      if (db) db.close();
    }
  }

  async function auditAdapter() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Opening the read-only Canonical compatibility adapter from the persisted mirror…', '');
    try {
      const first = await openAdapterInternal();
      const second = await openAdapterInternal();
      const adapter = first.adapter;
      const blocking = [];

      const cards = adapter.list('card');
      const contents = adapter.list('card_content');
      const learningStates = adapter.list('learning_state');
      const metadataRows = adapter.list('card_learning_metadata');
      const classifications = adapter.list('card_classification');
      const preferences = adapter.list('user_preference');
      const events = adapter.list('learning_event');
      const sessions = adapter.list('learning_session');

      let missingCardContent = 0;
      let unresolvedStateCards = 0;
      let unresolvedMetadataCards = 0;
      let unresolvedClassificationCards = 0;
      for (const row of cards) if (!adapter.get('card_content', row.entityKey)) missingCardContent += 1;
      for (const row of learningStates) if (!adapter.get('card', row.entityKey)) unresolvedStateCards += 1;
      for (const row of metadataRows) if (!adapter.get('card', row.entityKey)) unresolvedMetadataCards += 1;
      for (const row of classifications) if (!adapter.get('card', row.entityKey)) unresolvedClassificationCards += 1;

      if (cards.length !== 6546) blocking.push(`Adapter card count mismatch: expected 6546, got ${cards.length}.`);
      if (contents.length !== 6546) blocking.push(`Adapter card_content count mismatch: expected 6546, got ${contents.length}.`);
      const baseAuthority = authoritySpec(first.mirror.meta);
      const currentMirrorSpec = mirrorSpec(first.mirror.meta);
      if (!currentMirrorSpec?.materialized && learningStates.length !== EXPECTED_FIRST_SEEN_ROWS) blocking.push(`Adapter learning_state count mismatch: expected ${EXPECTED_FIRST_SEEN_ROWS}, got ${learningStates.length}.`);
      if (currentMirrorSpec?.materialized && learningStates.length < EXPECTED_FIRST_SEEN_ROWS) blocking.push(`Adapter learning_state count regressed below bootstrap: expected at least ${EXPECTED_FIRST_SEEN_ROWS}, got ${learningStates.length}.`);
      if (preferences.length !== 9) blocking.push(`Adapter portable preference count mismatch: expected 9, got ${preferences.length}.`);
      const expectedBaseEventRows = baseAuthority?.label === 'v3' ? 1151 : 1150;
      if (!currentMirrorSpec?.materialized && events.length !== expectedBaseEventRows) blocking.push(`Adapter learning_event count mismatch: expected ${expectedBaseEventRows}, got ${events.length}.`);
      if (currentMirrorSpec?.materialized && events.length < expectedBaseEventRows) blocking.push(`Adapter learning_event count regressed below bootstrap: expected at least ${expectedBaseEventRows}, got ${events.length}.`);
      if (sessions.length !== 55) blocking.push(`Adapter learning_session count mismatch: expected 55, got ${sessions.length}.`);
      if (missingCardContent) blocking.push(`${missingCardContent} card bundle(s) lack card_content.`);
      if (unresolvedStateCards) blocking.push(`${unresolvedStateCards} learning_state row(s) do not resolve to a card.`);
      if (unresolvedMetadataCards) blocking.push(`${unresolvedMetadataCards} metadata row(s) do not resolve to a card.`);
      if (unresolvedClassificationCards) blocking.push(`${unresolvedClassificationCards} classification row(s) do not resolve to a card.`);
      if (first.projection.projectionHash !== second.projection.projectionHash) blocking.push('Opening the adapter twice produced different compatibility projection hashes.');
      if (first.projection.records.length !== second.projection.records.length) blocking.push('Opening the adapter twice produced different logical record counts.');

      // Mutation-isolation proof: callers receive clones, never the adapter's internal record.
      let mutationIsolation = false;
      const probeSource = contents[0] || cards[0] || null;
      if (probeSource) {
        const before = adapter.get(probeSource.entityType, probeSource.entityKey);
        const originalHash = before?.payloadHash || '';
        if (before?.payload && typeof before.payload === 'object') before.payload.__wlpMutationProbe = 'mutated-outside-adapter';
        const after = adapter.get(probeSource.entityType, probeSource.entityKey);
        mutationIsolation = Boolean(after && after.payloadHash === originalHash && !hasOwn(after.payload, '__wlpMutationProbe'));
      }
      if (!mutationIsolation) blocking.push('Adapter mutation-isolation proof failed; returned data may share mutable internal references.');

      const randomCardKey = cards[0]?.entityKey || null;
      const cardBundle = randomCardKey ? adapter.getCardBundle(randomCardKey) : null;
      const cardBundleResolved = Boolean(cardBundle?.card && cardBundle?.content);
      if (!cardBundleResolved) blocking.push('Adapter card-bundle lookup failed for the first card.');

      const pass = blocking.length === 0;
      state.report = {
        format: 'WLP_CANONICAL_COMPATIBILITY_ADAPTER_AUDIT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'indexeddb-read-only-logical-adapter-api-audit',
        device: { deviceKey: first.mirror.meta?.deviceKey || null, platform: platformLabel() },
        database: { name: DB_NAME, version: DB_VERSION, canonicalStores: CANONICAL_TABLES.length },
        authority: {
          candidateKey: first.mirror.meta?.candidateKey || null,
          headVersion: first.mirror.meta?.headVersion ?? null,
          snapshotManifestHash: first.mirror.meta?.snapshotManifestHash || null,
          migrationVersion: first.mirror.meta?.migrationVersion || null,
          authorityRevision: first.mirror.meta?.authorityRevision ?? null,
          canonicalRows: first.mirror.rowCount
        },
        summary: {
          mirrorRows: first.mirror.rowCount,
          mirrorPayloadHashesVerified: first.mirror.payloadHashesVerified,
          logicalRecords: adapter.logicalRecordCount,
          cards: cards.length,
          cardContents: contents.length,
          learningStates: learningStates.length,
          learningEvents: events.length,
          learningSessions: sessions.length,
          portablePreferenceKeys: preferences.length,
          cardBundlesMissingContent: missingCardContent,
          unresolvedStateCards,
          unresolvedMetadataCards,
          unresolvedClassificationCards,
          outboxRows: first.mirror.outboxRows,
          projectionRepeatability: first.projection.projectionHash === second.projection.projectionHash,
          explicitFirstSeenRows: first.projection.explicitFirstSeenRows,
          mutationIsolation,
          cardBundleResolved,
          blockingIssues: blocking.length,
          pass
        },
        hashes: {
          mirrorManifestHash: first.mirror.manifestHash,
          compatibilityProjectionHash: first.projection.projectionHash,
          repeatedCompatibilityProjectionHash: second.projection.projectionHash,
          projectionContract: `authority-${mirrorSpec(first.mirror.meta)?.label || 'unsupported'}-explicit-first-seen-at`
        },
        api: {
          version: adapter.version,
          readOnly: adapter.readOnly,
          source: adapter.source,
          methods: ['get', 'list', 'getCardBundle', 'getPreference', 'listEvents', 'listSessions', 'exportLogicalSnapshot'],
          writeMethodsExposed: false,
          returnedValuesAreCloned: mutationIsolation
        },
        logicalEntityCounts: first.projection.stats,
        issues: {
          blocking,
          warnings: [
            ...first.projection.warnings,
            `The adapter reads the installed ${mirrorSpec(first.mirror.meta)?.label || 'unknown'} Canonical materialized mirror from wlp-cloud-v1 and exposes cloned logical records through a read-only API. Pending sync_outbox rows are counted but never applied by the adapter itself.`,
            'No Cloud endpoint is contacted, no IndexedDB row is changed, and no localStorage value is written.',
            `A PASS establishes the supported ${mirrorSpec(first.mirror.meta)?.label || 'unknown'} read-only adapter with exact firstSeen preservation. Pending outbox overlay application is owned by the Storage Compatibility Facade, not this adapter.`
          ],
          mirrorPayloadHashMismatches: first.mirror.payloadHashMismatches,
          mirrorRowKeyMismatches: first.mirror.rowKeyMismatches
        },
        invariants: {
          noCloudCalls: true,
          indexedDbReadOnly: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noCloudWrites: true,
          noCloudToLegacyWlpApply: true,
          noLiveWlpWrites: true,
          syncOutboxReadable: Number.isFinite(first.mirror.outboxRows) && first.mirror.outboxRows >= 0,
          existingMirrorManifestVerified: Boolean(mirrorSpec(first.mirror.meta)) && first.mirror.manifestHash === mirrorSpec(first.mirror.meta).manifest,
          explicitFirstSeenComplete: first.projection.explicitFirstSeenRows === learningStates.length && learningStates.length >= EXPECTED_FIRST_SEEN_ROWS,
          compatibilityProjectionRepeatable: first.projection.projectionHash === second.projection.projectionHash,
          adapterReadOnly: adapter.readOnly === true,
          adapterMutationIsolationVerified: mutationIsolation,
          adapterOpenRepeatable: first.projection.projectionHash === second.projection.projectionHash
        }
      };
      render(state.report);
      setStatus(pass
        ? `Read-only adapter PASS. ${adapter.logicalRecordCount.toLocaleString()} logical record(s) are available through the compatibility API with mutation isolation; no live WLP path was changed.`
        : `Read-only adapter BLOCKED with ${blocking.length} issue(s). No write occurred.`, pass ? 'ok' : 'bad');
    } catch (error) {
      state.report = null;
      renderError(error);
      setStatus(error?.message || String(error), 'bad');
    } finally {
      setBusy(false);
    }
  }

  function platformLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) return 'iPhone Safari/WebKit';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    return navigator.platform || 'Browser';
  }

  function render(report) {
    $('compat-adapter-panel').classList.remove('hidden');
    $('compat-adapter-result').textContent = report.summary.pass ? 'PASS' : 'BLOCKED';
    $('compat-adapter-mirror').textContent = report.summary.mirrorRows.toLocaleString();
    $('compat-adapter-logical').textContent = report.summary.logicalRecords.toLocaleString();
    $('compat-adapter-cards').textContent = report.summary.cards.toLocaleString();
    $('compat-adapter-states').textContent = report.summary.learningStates.toLocaleString();
    $('compat-adapter-events').textContent = report.summary.learningEvents.toLocaleString();
    $('compat-adapter-prefs').textContent = report.summary.portablePreferenceKeys.toLocaleString();
    $('compat-adapter-outbox').textContent = report.summary.outboxRows.toLocaleString();
    $('compat-adapter-repeat').textContent = report.summary.projectionRepeatability ? 'PASS' : 'FAIL';
    $('compat-adapter-isolation').textContent = report.summary.mutationIsolation ? 'PASS' : 'FAIL';
    $('compat-adapter-blocking').textContent = report.summary.blockingIssues.toLocaleString();
    $('compat-adapter-hash').textContent = report.hashes.compatibilityProjectionHash || '—';
    const body = $('compat-adapter-table-body');
    body.innerHTML = '';
    Object.entries(report.logicalEntityCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
      const tr = document.createElement('tr');
      [name, Number(count).toLocaleString()].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      body.appendChild(tr);
    });
    const notes = $('compat-adapter-notes');
    notes.innerHTML = '';
    [...report.issues.blocking, ...report.issues.warnings].forEach(message => { const li = document.createElement('li'); li.textContent = message; notes.appendChild(li); });
    $('export-compat-adapter').disabled = false;
  }

  function renderError(error) {
    $('compat-adapter-panel').classList.remove('hidden');
    $('compat-adapter-result').textContent = 'BLOCKED';
    $('compat-adapter-blocking').textContent = '1';
    const notes = $('compat-adapter-notes');
    notes.innerHTML = '';
    const li = document.createElement('li'); li.textContent = error?.message || String(error); notes.appendChild(li);
    $('export-compat-adapter').disabled = true;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-compatibility-adapter-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('compat-adapter-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    $('run-compat-adapter').disabled = state.busy;
    $('export-compat-adapter').disabled = state.busy || !state.report;
  }

  function init() {
    window.WLPCanonicalCompatibilityAdapter = Object.freeze({
      version: 1,
      open: async () => (await openAdapterInternal()).adapter
    });
    const run = $('run-compat-adapter');
    const exportButton = $('export-compat-adapter');
    if (run) run.addEventListener('click', auditAdapter);
    if (exportButton) exportButton.addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
