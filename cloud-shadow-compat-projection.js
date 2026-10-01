/* WLP Canonical Mirror Compatibility Projection Audit v1.
   Reads only the installed wlp-cloud-v1 IndexedDB mirror, projects it into
   legacy-scanner logical record shapes in memory, re-runs the canonical
   migration transformer, and proves the projected compatibility layer can
   reproduce the ACTIVE Authority payloads. No Cloud, IndexedDB, localStorage,
   or live WLP write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.209-canonical-compat-projection-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const EXPECTED_MANIFEST = '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a';
  const EXPECTED_ROWS = 21424;
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
    for (const row of asArray(tables.learning_state)) {
      const card = cardsById.get(row.card_id);
      if (!card) { blocking.push(`learning_state ${row.card_id} has no Card for compatibility projection.`); continue; }
      let payload;
      if (hasOwn(row, 'source_snapshot') && row.source_snapshot && typeof row.source_snapshot === 'object') {
        payload = clone(row.source_snapshot);
        preservedSourceSnapshotRows += 1;
      } else {
        payload = synthesizeLearningState(row);
        synthesizedStateRows += 1;
      }
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

    warnings.push(`${preservedSourceSnapshotRows} learning_state row(s) reuse preserved migration source_snapshot evidence; ${synthesizedStateRows} merged row(s) are projected from authoritative Canonical fields because source_snapshot was intentionally removed during merge materialization.`);

    return { records, sourceMasterHash, blocking, warnings, stats, preferenceKeys, synthesizedStateRows, preservedSourceSnapshotRows, projectionHash };
  }

  async function recanonicalize(projection) {
    const migration = window.WLPCanonicalMigrationDryRun;
    if (!migration?.buildCanonical) throw new Error('Canonical Migration transformer is not available on this page.');
    const snapshot = {
      records: projection.records,
      report: { master: { sha256: projection.sourceMasterHash || '' } }
    };
    return migration.buildCanonical(snapshot);
  }

  async function compareRoundTrip(mirror, canonical) {
    const mismatches = [];
    const missingRows = [];
    const extraRows = [];
    const fingerprints = [];
    const normalizedPayloads = new Map();
    let payloadHashesMatched = 0;

    for (const tableName of CANONICAL_TABLES) {
      for (const sourcePayload of asArray(canonical.tables?.[tableName])) {
        const payload = clone(sourcePayload);
        const rowKey = tablePrimaryKey(tableName, payload);
        const mirrorRow = mirror.wrapperByIdentity.get(identity(tableName, rowKey));
        if (!mirrorRow) {
          extraRows.push(`${tableName}|${rowKey}`);
          continue;
        }
        // v200 intentionally removed migration-only source_snapshot from merged
        // learning_state rows. Preserve that exact Authority shape on comparison.
        if (tableName === 'learning_state' && !hasOwn(mirrorRow.payload, 'source_snapshot')) delete payload.source_snapshot;
        const payloadHash = await sha256(stableStringify(payload));
        const tombstone = Boolean(payload && typeof payload === 'object' && payload.deleted_at);
        fingerprints.push({ tableName, rowKey, tombstone, payloadHash });
        normalizedPayloads.set(identity(tableName, rowKey), payload);
        if (payloadHash === mirrorRow.payloadHash && tombstone === mirrorRow.tombstone) payloadHashesMatched += 1;
        else mismatches.push({ tableName, rowKey, expectedHash: mirrorRow.payloadHash, projectedHash: payloadHash, expectedTombstone: mirrorRow.tombstone, projectedTombstone: tombstone });
      }
    }

    const projectedIds = new Set(fingerprints.map(row => identity(row.tableName, row.rowKey)));
    for (const row of mirror.fingerprints) {
      if (!projectedIds.has(identity(row.tableName, row.rowKey))) missingRows.push(`${row.tableName}|${row.rowKey}`);
    }
    fingerprints.sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    const manifestHash = await sha256(stableStringify(fingerprints));
    const repeatedManifestHash = await sha256(stableStringify(fingerprints));
    return { fingerprints, manifestHash, repeatedManifestHash, payloadHashesMatched, mismatches, missingRows, extraRows, normalizedPayloads };
  }

  function platformLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) return 'iPhone Safari/WebKit';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    return navigator.platform || 'Browser';
  }

  async function run() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Reading the installed Canonical mirror and building a legacy-compatible logical projection in memory…', '');
    let db = null;
    try {
      db = await openExistingMirrorReadOnly();
      const mirror = await readMirror(db);
      const blocking = [];
      if (!mirror.meta) blocking.push('authority_mirror metadata is missing.');
      if (mirror.meta && !mirror.meta.userId) blocking.push('authority_mirror metadata is not user-bound.');
      if (mirror.meta && Number(mirror.meta.headVersion || 0) !== 1) blocking.push(`Mirror metadata headVersion mismatch: expected 1, got ${mirror.meta.headVersion ?? '(missing)'}.`);
      if (mirror.meta && String(mirror.meta.migrationVersion || '') !== '2') blocking.push(`Mirror metadata migrationVersion mismatch: expected 2, got ${mirror.meta.migrationVersion ?? '(missing)'}.`);
      if (mirror.rowCount !== EXPECTED_ROWS) blocking.push(`Mirror row count mismatch: expected ${EXPECTED_ROWS}, got ${mirror.rowCount}.`);
      if (mirror.manifestHash !== EXPECTED_MANIFEST) blocking.push('Mirror manifest does not match the promoted Authority v1 manifest.');
      if (mirror.meta && String(mirror.meta.snapshotManifestHash || '') !== EXPECTED_MANIFEST) blocking.push('Mirror metadata manifest does not match the promoted Authority v1 manifest.');
      if (mirror.payloadHashMismatches.length) blocking.push(`${mirror.payloadHashMismatches.length} existing mirror payload hash mismatch(es).`);
      if (mirror.rowKeyMismatches.length) blocking.push(`${mirror.rowKeyMismatches.length} existing mirror row-key mismatch(es).`);
      if (mirror.outboxRows !== 0) blocking.push(`sync_outbox is not empty: ${mirror.outboxRows} row(s).`);
      if (blocking.length) throw new Error(blocking.join(' '));

      const projectionA = await projectLogicalRecords(mirror.tables);
      const projectionB = await projectLogicalRecords(mirror.tables);
      blocking.push(...projectionA.blocking);
      if (projectionA.projectionHash !== projectionB.projectionHash) blocking.push('Compatibility logical projection is not repeatable from the same mirror payloads.');

      setStatus(`Projected ${projectionA.records.length.toLocaleString()} legacy-scanner logical record(s). Re-canonicalizing in memory…`, '');
      const canonical = await recanonicalize(projectionA);
      if (canonical.blocking.length) blocking.push(...canonical.blocking.map(item => `Re-canonicalization: ${item}`));
      const roundTrip = await compareRoundTrip(mirror, canonical);
      if (roundTrip.mismatches.length) blocking.push(`${roundTrip.mismatches.length} projected Canonical payload/tombstone mismatch(es).`);
      if (roundTrip.missingRows.length) blocking.push(`${roundTrip.missingRows.length} Authority row(s) were missing after compatibility projection round-trip.`);
      if (roundTrip.extraRows.length) blocking.push(`${roundTrip.extraRows.length} extra Canonical row(s) appeared after compatibility projection round-trip.`);
      if (roundTrip.fingerprints.length !== EXPECTED_ROWS) blocking.push(`Projected Canonical row count mismatch: expected ${EXPECTED_ROWS}, got ${roundTrip.fingerprints.length}.`);
      if (roundTrip.manifestHash !== EXPECTED_MANIFEST) blocking.push('Compatibility projection round-trip manifest does not match Authority v1.');
      if (roundTrip.repeatedManifestHash !== roundTrip.manifestHash) blocking.push('Compatibility projection manifest proof was not repeatable.');

      const pass = blocking.length === 0;
      state.report = {
        format: 'WLP_CANONICAL_MIRROR_COMPATIBILITY_PROJECTION',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'indexeddb-read-only-legacy-logical-projection-roundtrip',
        device: { deviceKey: mirror.meta?.deviceKey || null, platform: platformLabel() },
        database: { name: DB_NAME, version: DB_VERSION, canonicalStores: CANONICAL_TABLES.length },
        authority: {
          candidateKey: mirror.meta?.candidateKey || null,
          headVersion: mirror.meta?.headVersion ?? null,
          snapshotManifestHash: EXPECTED_MANIFEST,
          canonicalRows: EXPECTED_ROWS
        },
        summary: {
          mirrorRows: mirror.rowCount,
          mirrorPayloadHashesVerified: mirror.payloadHashesVerified,
          projectedLogicalRecords: projectionA.records.length,
          projectedCanonicalRows: roundTrip.fingerprints.length,
          payloadHashesMatched: roundTrip.payloadHashesMatched,
          payloadMismatches: roundTrip.mismatches.length,
          missingRows: roundTrip.missingRows.length,
          extraRows: roundTrip.extraRows.length,
          migrationBlockingIssues: canonical.blocking.length,
          projectionBlockingIssues: projectionA.blocking.length,
          outboxRows: mirror.outboxRows,
          manifestMatch: roundTrip.manifestHash === EXPECTED_MANIFEST,
          repeatability: projectionA.projectionHash === projectionB.projectionHash && roundTrip.repeatedManifestHash === roundTrip.manifestHash,
          blockingIssues: blocking.length,
          pass
        },
        hashes: {
          mirrorManifestHash: mirror.manifestHash,
          compatibilityProjectionHash: projectionA.projectionHash,
          repeatedCompatibilityProjectionHash: projectionB.projectionHash,
          projectedCanonicalManifestHash: roundTrip.manifestHash,
          repeatedProjectedCanonicalManifestHash: roundTrip.repeatedManifestHash
        },
        projection: {
          logicalEntityCounts: projectionA.stats,
          portablePreferenceKeys: projectionA.preferenceKeys,
          learningStatePreservedSourceSnapshots: projectionA.preservedSourceSnapshotRows,
          learningStateSynthesizedFromCanonical: projectionA.synthesizedStateRows,
          sourceMasterHash: projectionA.sourceMasterHash
        },
        migrationWarnings: canonical.warnings,
        issues: {
          blocking,
          warnings: [
            ...projectionA.warnings,
            'This is a read-only compatibility proof. The Canonical mirror is projected into legacy-scanner logical record shapes in memory and then re-canonicalized; no legacy localStorage is written.',
            'No Cloud endpoint is contacted, no IndexedDB row is changed, and live Study / Review / Editor / Progress / Search continue using their existing data paths.',
            'A PASS proves the Canonical mirror contains enough information for a compatibility adapter to reproduce the promoted Authority snapshot exactly under the current v1 migration semantics.',
            'Historical missing-session references may remain migration audit warnings; this projection does not synthesize missing historical parents.'
          ],
          payloadMismatches: roundTrip.mismatches,
          missingRows: roundTrip.missingRows,
          extraRows: roundTrip.extraRows,
          mirrorPayloadHashMismatches: mirror.payloadHashMismatches,
          mirrorRowKeyMismatches: mirror.rowKeyMismatches
        },
        invariants: {
          noCloudCalls: true,
          indexedDbReadOnly: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noCloudWrites: true,
          noCloudToLegacyWlpApply: true,
          noLiveWlpWrites: true,
          syncOutboxEmpty: mirror.outboxRows === 0,
          existingMirrorManifestVerified: mirror.manifestHash === EXPECTED_MANIFEST,
          compatibilityProjectionInMemoryOnly: true,
          canonicalRoundTripMatchedAuthority: roundTrip.manifestHash === EXPECTED_MANIFEST && roundTrip.mismatches.length === 0 && !roundTrip.missingRows.length && !roundTrip.extraRows.length
        }
      };

      render(state.report);
      setStatus(pass
        ? `Compatibility projection PASS. ${projectionA.records.length.toLocaleString()} projected logical record(s) re-canonicalized to the exact ${EXPECTED_ROWS.toLocaleString()}-row Authority manifest; no write occurred.`
        : `Compatibility projection BLOCKED with ${blocking.length} issue(s). No write occurred.`, pass ? 'ok' : 'bad');
    } catch (error) {
      state.report = null;
      renderError(error);
      setStatus(error?.message || String(error), 'bad');
    } finally {
      if (db) db.close();
      setBusy(false);
    }
  }

  function render(report) {
    $('compat-projection-panel').classList.remove('hidden');
    $('compat-projection-result').textContent = report.summary.pass ? 'PASS' : 'BLOCKED';
    $('compat-projection-mirror').textContent = report.summary.mirrorRows.toLocaleString();
    $('compat-projection-logical').textContent = report.summary.projectedLogicalRecords.toLocaleString();
    $('compat-projection-canonical').textContent = report.summary.projectedCanonicalRows.toLocaleString();
    $('compat-projection-matched').textContent = report.summary.payloadHashesMatched.toLocaleString();
    $('compat-projection-mismatch').textContent = report.summary.payloadMismatches.toLocaleString();
    $('compat-projection-outbox').textContent = report.summary.outboxRows.toLocaleString();
    $('compat-projection-blocking').textContent = report.summary.blockingIssues.toLocaleString();
    $('compat-projection-repeat').textContent = report.summary.repeatability ? 'PASS' : 'FAIL';
    $('compat-projection-hash').textContent = report.hashes.compatibilityProjectionHash || '—';
    $('compat-projection-manifest').textContent = report.hashes.projectedCanonicalManifestHash || '—';
    const body = $('compat-projection-table-body');
    body.innerHTML = '';
    Object.entries(report.projection.logicalEntityCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
      const tr = document.createElement('tr');
      [name, Number(count).toLocaleString()].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      body.appendChild(tr);
    });
    const notes = $('compat-projection-notes');
    notes.innerHTML = '';
    [...report.issues.blocking, ...report.issues.warnings, ...report.migrationWarnings.map(item => `Migration audit · ${item}`)].forEach(text => {
      const li = document.createElement('li'); li.textContent = text; notes.appendChild(li);
    });
    $('export-compat-projection').disabled = false;
  }

  function renderError(error) {
    $('compat-projection-panel').classList.remove('hidden');
    $('compat-projection-result').textContent = 'BLOCKED';
    $('compat-projection-blocking').textContent = '1';
    const notes = $('compat-projection-notes');
    notes.innerHTML = '';
    const li = document.createElement('li'); li.textContent = error?.message || String(error); notes.appendChild(li);
    $('export-compat-projection').disabled = true;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-compatibility-projection-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('compat-projection-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    $('run-compat-projection').disabled = state.busy;
    $('export-compat-projection').disabled = state.busy || !state.report;
  }

  function init() {
    $('run-compat-projection').addEventListener('click', run);
    $('export-compat-projection').addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
