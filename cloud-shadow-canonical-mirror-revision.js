/* WLP v1.8.6.219 · Canonical Local Mirror Authority v2 Revision Apply + Round-trip
   Updates the already-verified isolated wlp-cloud-v1 IndexedDB mirror from the
   exact Authority v1 snapshot to the exact ACTIVE Authority v2 FirstSeen repair.
   The only permitted semantic delta is 111 learning_state rows. The revision is
   applied atomically inside IndexedDB, then the full 21,424-row mirror is read
   back and re-verified. No Cloud write or live/legacy WLP write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.219-canonical-mirror-authority-v2-revision-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const HASH_BATCH = 128;
  const EXPECTED_ROWS = 21424;
  const EXPECTED_CHANGED_ROWS = 111;
  const PARENT_CANDIDATE = 'v1:5d5ad23a7d6fa181e2ec1642649b059cd4afa21a7af1fd64efc794efe01bae54';
  const PARENT_HEAD_VERSION = 1;
  const PARENT_MANIFEST = '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a';
  const PARENT_MIGRATION_VERSION = '2';
  const TARGET_CANDIDATE = 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const TARGET_HEAD_VERSION = 2;
  const TARGET_MANIFEST = 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3';
  const TARGET_MIGRATION_VERSION = '3';
  const TARGET_TICKET = '5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const TARGET_LEARNING_STATE_MANIFEST = '67381bd1aeee1f79ded1041590aa89f2e1614f010eff3ab9d9d6a44841582ccc';
  const SPOTCHECK_CARD_ID = 'ea2f787b-41fe-5446-bbff-49c0c6ed73e2';
  const SPOTCHECK_FIRST_SEEN = '2026-09-26T21:44:15.400Z';
  const CANONICAL_TABLES = Object.freeze([
    'cards', 'card_content', 'card_learning_metadata', 'learning_situations',
    'learning_alternatives', 'learning_alternative_situations', 'card_classification',
    'learning_sessions', 'learning_events', 'learning_state', 'learner_profile',
    'learner_route_state', 'study_contexts', 'study_context_cards', 'study_builds',
    'study_build_cards', 'user_preferences'
  ]);
  const state = { busy: false, report: null, lastRevisionKey: '', firstApplyEvidence: null };

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
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function sumCounts(counts) { return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0); }

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

  function openMirrorDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.transaction.abort();
      };
      request.onsuccess = () => {
        const db = request.result;
        const required = [...CANONICAL_TABLES, META_STORE, OUTBOX_STORE];
        const missing = required.filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) {
          db.close();
          reject(new Error(`Mirror revision blocked: missing object store(s): ${missing.join(', ')}.`));
          return;
        }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open existing wlp-cloud-v1 IndexedDB.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another open WLP page. Close other WLP tabs and retry.'));
    });
  }

  async function getMeta(db) {
    const tx = db.transaction(META_STORE, 'readonly');
    const value = await requestPromise(tx.objectStore(META_STORE).get(META_KEY));
    await transactionDone(tx);
    return value || null;
  }

  async function countStore(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const count = await requestPromise(tx.objectStore(storeName).count());
    await transactionDone(tx);
    return Number(count || 0);
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Mirror revision blocked: expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,status,canonical_row_count,snapshot_manifest_hash,table_counts,table_manifest_hashes,cutover_ticket_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,source_materialization_hash,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Mirror revision blocked: expected exactly one ACTIVE candidate row, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchAuthorityRows(api, candidateKey) {
    return api.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  function tablePrimaryKey(table, row) {
    const keys = {
      cards: item => item.card_id,
      card_content: item => item.card_id,
      card_learning_metadata: item => item.card_id,
      learning_situations: item => item.situation_id,
      learning_alternatives: item => item.alternative_id,
      learning_alternative_situations: item => item.link_id || `${item.alternative_id}|${item.situation_id}`,
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

  async function manifestProof(rows) {
    const fingerprintRows = rows.map(row => ({
      tableName: row.tableName ?? row.table_name,
      rowKey: String(row.rowKey ?? row.row_key),
      tombstone: Boolean(row.tombstone),
      payloadHash: String(row.payloadHash ?? row.payload_hash)
    })).sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    const tableCounts = {};
    fingerprintRows.forEach(row => { tableCounts[row.tableName] = (tableCounts[row.tableName] || 0) + 1; });
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(fingerprintRows.filter(row => row.tableName === tableName)));
    }
    return {
      rowCount: fingerprintRows.length,
      snapshotManifestHash: await sha256(stableStringify(fingerprintRows)),
      tableCounts,
      tableManifestHashes,
      fingerprintRows
    };
  }

  async function verifyAuthorityRows(rows) {
    let verified = 0;
    const payloadHashMismatches = [];
    const rowKeyMismatches = [];
    const duplicateIdentities = [];
    const seen = new Set();
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        const key = identity(row.table_name, row.row_key);
        if (seen.has(key)) duplicateIdentities.push(`${row.table_name}|${row.row_key}`);
        seen.add(key);
        const payloadKey = tablePrimaryKey(row.table_name, row.payload || {});
        if (payloadKey !== String(row.row_key)) rowKeyMismatches.push(`${row.table_name}|${row.row_key}`);
        if (hash !== row.payload_hash) payloadHashMismatches.push(`${row.table_name}|${row.row_key}`);
        else verified += 1;
      });
      setStatus(`Verifying ACTIVE Authority v2… ${Math.min(start + batch.length, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} payload hashes checked.`, '');
    }
    return { verified, payloadHashMismatches, rowKeyMismatches, duplicateIdentities };
  }

  async function readBackMirror(db) {
    const rows = [];
    const payloadHashMismatches = [];
    const rowKeyMismatches = [];
    let payloadHashesVerified = 0;
    for (const storeName of CANONICAL_TABLES) {
      const tx = db.transaction(storeName, 'readonly');
      const stored = await requestPromise(tx.objectStore(storeName).getAll());
      await transactionDone(tx);
      for (let start = 0; start < stored.length; start += HASH_BATCH) {
        const batch = stored.slice(start, start + HASH_BATCH);
        const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
        hashes.forEach((hash, index) => {
          const row = batch[index];
          const payloadKey = tablePrimaryKey(storeName, row.payload || {});
          if (payloadKey !== String(row.rowKey)) rowKeyMismatches.push(`${storeName}|${row.rowKey}`);
          if (hash !== row.payloadHash) payloadHashMismatches.push(`${storeName}|${row.rowKey}`);
          else payloadHashesVerified += 1;
          rows.push({ tableName: storeName, rowKey: String(row.rowKey), payloadHash: String(row.payloadHash), tombstone: Boolean(row.tombstone), payload: clone(row.payload) });
        });
        setStatus(`Reading ${DB_NAME}… ${payloadHashesVerified.toLocaleString()} payload hash(es) verified so far.`, '');
      }
    }
    const proof = await manifestProof(rows);
    const meta = await getMeta(db);
    const outboxRows = await countStore(db, OUTBOX_STORE);
    return { rows, meta, outboxRows, payloadHashesVerified, payloadHashMismatches, rowKeyMismatches, ...proof };
  }

  function compareTableMetadata(expectedCounts, expectedHashes, proof, blocking, label) {
    const tableNames = new Set([
      ...Object.keys(expectedCounts || {}), ...Object.keys(proof.tableCounts || {}),
      ...Object.keys(expectedHashes || {}), ...Object.keys(proof.tableManifestHashes || {})
    ]);
    [...tableNames].sort().forEach(tableName => {
      if (Number(expectedCounts?.[tableName] || 0) !== Number(proof.tableCounts?.[tableName] || 0)) {
        blocking.push(`${label} table count mismatch for ${tableName}.`);
      }
      if (String(expectedHashes?.[tableName] || '') !== String(proof.tableManifestHashes?.[tableName] || '')) {
        blocking.push(`${label} table manifest mismatch for ${tableName}.`);
      }
    });
  }

  function mirrorMetaState(meta) {
    if (!meta) return 'MISSING';
    if (meta.candidateKey === PARENT_CANDIDATE && Number(meta.headVersion || 0) === PARENT_HEAD_VERSION && meta.snapshotManifestHash === PARENT_MANIFEST && String(meta.migrationVersion || '') === PARENT_MIGRATION_VERSION) return 'V1';
    if (meta.candidateKey === TARGET_CANDIDATE && Number(meta.headVersion || 0) === TARGET_HEAD_VERSION && meta.snapshotManifestHash === TARGET_MANIFEST && String(meta.migrationVersion || '') === TARGET_MIGRATION_VERSION) return 'V2';
    return 'OTHER';
  }

  function computeDelta(mirrorRows, authorityRows) {
    const mirrorMap = new Map(mirrorRows.map(row => [identity(row.tableName, row.rowKey), row]));
    const authorityMap = new Map(authorityRows.map(row => [identity(row.table_name, row.row_key), row]));
    const missing = [];
    const extra = [];
    const changed = [];
    const tombstoneChanges = [];
    authorityMap.forEach((row, key) => {
      const current = mirrorMap.get(key);
      if (!current) { missing.push(key); return; }
      const hashChanged = String(current.payloadHash) !== String(row.payload_hash);
      const tombstoneChanged = Boolean(current.tombstone) !== Boolean(row.tombstone);
      if (hashChanged || tombstoneChanged) {
        changed.push(row);
        if (tombstoneChanged) tombstoneChanges.push(key);
      }
    });
    mirrorMap.forEach((_row, key) => { if (!authorityMap.has(key)) extra.push(key); });
    return { missing, extra, changed, tombstoneChanges };
  }

  async function applyRevision(db, changedRows, nextMeta) {
    const changedStores = [...new Set(changedRows.map(row => row.table_name))];
    const tx = db.transaction([...changedStores, META_STORE], 'readwrite');
    changedRows.forEach(row => {
      tx.objectStore(row.table_name).put({
        rowKey: String(row.row_key),
        payloadHash: String(row.payload_hash),
        tombstone: Boolean(row.tombstone),
        payload: clone(row.payload)
      });
    });
    tx.objectStore(META_STORE).put(nextMeta);
    await transactionDone(tx);
  }

  async function getLearningStateRow(db, cardId) {
    const tx = db.transaction('learning_state', 'readonly');
    const row = await requestPromise(tx.objectStore('learning_state').get(cardId));
    await transactionDone(tx);
    return row || null;
  }

  function precheckAuthority(head, candidate, blocking) {
    const d = candidate?.diagnostics || {};
    if (head?.candidate_key !== TARGET_CANDIDATE) blocking.push('ACTIVE Head is not the exact Authority v2 candidate.');
    if (Number(head?.head_version || 0) !== TARGET_HEAD_VERSION) blocking.push('ACTIVE Head version is not 2.');
    if (head?.previous_candidate_key !== PARENT_CANDIDATE) blocking.push('ACTIVE Head previous candidate is not the exact v1 parent.');
    if (head?.snapshot_manifest_hash !== TARGET_MANIFEST) blocking.push('ACTIVE Head v2 manifest mismatch.');
    if (String(head?.migration_version || '') !== TARGET_MIGRATION_VERSION) blocking.push('ACTIVE Head migration version is not 3.');
    if (Number(head?.canonical_row_count || 0) !== EXPECTED_ROWS) blocking.push('ACTIVE Head row count mismatch.');
    if (candidate?.candidate_key !== TARGET_CANDIDATE || candidate?.status !== 'verified') blocking.push('ACTIVE v2 candidate is missing or not verified.');
    if (candidate?.snapshot_manifest_hash !== TARGET_MANIFEST) blocking.push('ACTIVE v2 candidate manifest mismatch.');
    if (String(candidate?.migration_version || '') !== TARGET_MIGRATION_VERSION) blocking.push('ACTIVE v2 candidate migration version mismatch.');
    if (candidate?.cutover_ticket_hash !== TARGET_TICKET || head?.cutover_ticket_hash !== TARGET_TICKET) blocking.push('Authority v2 revision ticket mismatch.');
    if (candidate?.source_materialization_hash !== PARENT_MANIFEST) blocking.push('Authority v2 parent/source manifest mismatch.');
    if (Number(d.authorityRevision || 0) !== 2 || d.parentCandidateKey !== PARENT_CANDIDATE || Number(d.changedRows || 0) !== EXPECTED_CHANGED_ROWS || d.changedTable !== 'learning_state' || d.repair !== 'explicit-first_seen_at') {
      blocking.push('Authority v2 targeted FirstSeen repair diagnostics mismatch.');
    }
  }

  async function execute(retryRequested) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryRequested ? 'Re-verifying the already-revised v2 Canonical mirror without rewriting it…' : 'Preparing the exact Authority v1 → v2 Canonical mirror revision…', '');
    let db = null;
    try {
      const api = window.WLPCloudShadowSupabase;
      if (!api?.fetchPaged || !api?.ensureSession || !api?.getDevice || !api?.getState) throw new Error('Supabase Shadow transport is unavailable.');
      await api.ensureSession();
      const device = await api.getDevice();
      const cloudState = api.getState();
      const userId = cloudState.userId || '';
      if (!userId) throw new Error('Mirror revision blocked: signed-in user ID is unavailable.');

      const head = await fetchHead(api);
      const candidate = await fetchCandidate(api, head.candidate_key);
      const blocking = [];
      precheckAuthority(head, candidate, blocking);
      if (blocking.length) throw new Error(`Mirror revision blocked before local read: ${blocking.join(' ')}`);

      const authorityRows = await fetchAuthorityRows(api, TARGET_CANDIDATE);
      const authorityCheck = await verifyAuthorityRows(authorityRows);
      const authorityProof = await manifestProof(authorityRows);
      if (authorityRows.length !== EXPECTED_ROWS) blocking.push(`Authority v2 row count is ${authorityRows.length}, expected ${EXPECTED_ROWS}.`);
      if (authorityCheck.payloadHashMismatches.length) blocking.push(`${authorityCheck.payloadHashMismatches.length} Authority payload hash mismatch(es).`);
      if (authorityCheck.rowKeyMismatches.length) blocking.push(`${authorityCheck.rowKeyMismatches.length} Authority row-key mismatch(es).`);
      if (authorityCheck.duplicateIdentities.length) blocking.push(`${authorityCheck.duplicateIdentities.length} duplicate Authority row identity issue(s).`);
      if (authorityProof.snapshotManifestHash !== TARGET_MANIFEST) blocking.push('Recomputed Authority v2 manifest mismatch.');
      compareTableMetadata(candidate.table_counts || {}, candidate.table_manifest_hashes || {}, authorityProof, blocking, 'Authority v2');
      if (candidate.table_manifest_hashes?.learning_state !== TARGET_LEARNING_STATE_MANIFEST) blocking.push('Authority v2 learning_state manifest mismatch.');
      const authorityStatesWithFirstSeen = authorityRows.filter(row => row.table_name === 'learning_state' && typeof row.payload?.first_seen_at === 'string' && row.payload.first_seen_at).length;
      if (authorityStatesWithFirstSeen !== EXPECTED_CHANGED_ROWS) blocking.push(`Authority v2 has explicit first_seen_at on ${authorityStatesWithFirstSeen} learning_state row(s), expected ${EXPECTED_CHANGED_ROWS}.`);
      if (blocking.length) throw new Error(`Mirror revision blocked before IndexedDB open: ${blocking.join(' ')}`);

      db = await openMirrorDb();
      const before = await readBackMirror(db);
      const beforeState = mirrorMetaState(before.meta);
      if (!before.meta) blocking.push('Existing Canonical mirror metadata is missing.');
      if (before.meta?.userId !== userId) blocking.push('Existing Canonical mirror belongs to a different signed-in user.');
      if (before.meta?.deviceKey !== device.deviceKey) blocking.push('Existing Canonical mirror device identity does not match this browser device.');
      if (before.rowCount !== EXPECTED_ROWS) blocking.push(`Existing mirror row count is ${before.rowCount}, expected ${EXPECTED_ROWS}.`);
      if (before.payloadHashMismatches.length) blocking.push(`${before.payloadHashMismatches.length} existing mirror payload hash mismatch(es).`);
      if (before.rowKeyMismatches.length) blocking.push(`${before.rowKeyMismatches.length} existing mirror row-key mismatch(es).`);
      if (before.outboxRows !== 0) blocking.push(`sync_outbox contains ${before.outboxRows} row(s); Authority revision is blocked until the outbox is empty.`);

      let writePerformed = false;
      let mode = '';
      let delta = { missing: [], extra: [], changed: [], tombstoneChanges: [] };

      if (beforeState === 'V1') {
        if (retryRequested) blocking.push('Retry Same Mirror Revision requested, but the mirror is still Authority v1. Run Apply Authority v2 to Canonical Mirror first.');
        if (before.snapshotManifestHash !== PARENT_MANIFEST) blocking.push('Existing v1 mirror manifest does not match the verified Authority v1 parent.');
        delta = computeDelta(before.rows, authorityRows);
        if (delta.missing.length) blocking.push(`${delta.missing.length} Authority v2 identity row(s) are missing from the v1 mirror.`);
        if (delta.extra.length) blocking.push(`${delta.extra.length} v1 mirror identity row(s) are absent from Authority v2.`);
        if (delta.tombstoneChanges.length) blocking.push(`${delta.tombstoneChanges.length} tombstone semantic change(s) detected; v219 does not permit them.`);
        if (delta.changed.length !== EXPECTED_CHANGED_ROWS) blocking.push(`Mirror revision delta has ${delta.changed.length} changed row(s), expected ${EXPECTED_CHANGED_ROWS}.`);
        const changedTables = [...new Set(delta.changed.map(row => row.table_name))];
        if (changedTables.length !== 1 || changedTables[0] !== 'learning_state') blocking.push(`Mirror revision delta is not confined to learning_state: ${changedTables.join(', ') || '(none)'}.`);
        if (blocking.length) throw new Error(`Mirror revision blocked before IndexedDB write: ${blocking.join(' ')}`);

        const nextMeta = {
          ...before.meta,
          candidateKey: TARGET_CANDIDATE,
          headVersion: TARGET_HEAD_VERSION,
          previousCandidateKey: PARENT_CANDIDATE,
          snapshotManifestHash: TARGET_MANIFEST,
          canonicalRowCount: EXPECTED_ROWS,
          namespaceUuid: head.namespace_uuid,
          migrationVersion: TARGET_MIGRATION_VERSION,
          cardMappingHash: head.card_mapping_hash,
          coreLibraryHash: head.core_library_hash,
          cutoverTicketHash: TARGET_TICKET,
          authorityRevision: 2,
          revisedAt: new Date().toISOString(),
          revisionSource: 'active-authority-v2-explicit-first-seen-at'
        };
        setStatus(`Applying exactly ${delta.changed.length} verified learning_state revision row(s) to isolated ${DB_NAME}… live WLP remains untouched.`, '');
        await applyRevision(db, delta.changed, nextMeta);
        writePerformed = true;
        state.firstApplyEvidence = {
          beforeMirrorManifestHash: before.snapshotManifestHash,
          changedRowsWritten: delta.changed.length,
          changedTables: [...new Set(delta.changed.map(row => row.table_name))],
          appliedAt: nextMeta.revisedAt
        };
        mode = 'authority-v1-to-v2-mirror-revision';
      } else if (beforeState === 'V2') {
        delta = computeDelta(before.rows, authorityRows);
        if (delta.missing.length || delta.extra.length || delta.changed.length || delta.tombstoneChanges.length) {
          blocking.push(`Existing v2 mirror does not exactly match ACTIVE Authority v2 (missing=${delta.missing.length}, extra=${delta.extra.length}, changed=${delta.changed.length}, tombstone=${delta.tombstoneChanges.length}).`);
        }
        mode = retryRequested ? 'retry-existing-authority-v2-mirror' : 'verify-existing-authority-v2-mirror';
      } else {
        blocking.push(`Existing mirror metadata is neither the exact verified v1 parent nor exact v2 target (state=${beforeState}).`);
      }
      if (blocking.length) throw new Error(`Mirror revision blocked: ${blocking.join(' ')}`);

      const after = await readBackMirror(db);
      const afterState = mirrorMetaState(after.meta);
      compareTableMetadata(candidate.table_counts || {}, candidate.table_manifest_hashes || {}, after, blocking, 'Revised mirror');
      if (afterState !== 'V2') blocking.push(`Revised mirror metadata state is ${afterState}, expected V2.`);
      if (after.snapshotManifestHash !== TARGET_MANIFEST) blocking.push('Revised mirror manifest does not match ACTIVE Authority v2.');
      if (after.rowCount !== EXPECTED_ROWS) blocking.push(`Revised mirror row count is ${after.rowCount}, expected ${EXPECTED_ROWS}.`);
      if (after.payloadHashMismatches.length) blocking.push(`${after.payloadHashMismatches.length} revised mirror payload hash mismatch(es).`);
      if (after.rowKeyMismatches.length) blocking.push(`${after.rowKeyMismatches.length} revised mirror row-key mismatch(es).`);
      if (after.outboxRows !== 0) blocking.push(`Revised mirror sync_outbox contains ${after.outboxRows} row(s).`);
      const afterStatesWithFirstSeen = after.rows.filter(row => row.tableName === 'learning_state' && typeof row.payload?.first_seen_at === 'string' && row.payload.first_seen_at).length;
      if (afterStatesWithFirstSeen !== EXPECTED_CHANGED_ROWS) blocking.push(`Revised mirror has explicit first_seen_at on ${afterStatesWithFirstSeen} learning_state row(s), expected ${EXPECTED_CHANGED_ROWS}.`);
      const spot = await getLearningStateRow(db, SPOTCHECK_CARD_ID);
      const spotFirstSeen = spot?.payload?.first_seen_at || null;
      if (spotFirstSeen !== SPOTCHECK_FIRST_SEEN) blocking.push(`WID 2876 spot-check first_seen_at is ${spotFirstSeen || '(missing)'}, expected ${SPOTCHECK_FIRST_SEEN}.`);

      const retryIdempotent = !retryRequested || (!writePerformed && beforeState === 'V2' && afterState === 'V2' && before.snapshotManifestHash === after.snapshotManifestHash && after.snapshotManifestHash === TARGET_MANIFEST);
      const pass = blocking.length === 0 && afterState === 'V2' && after.snapshotManifestHash === TARGET_MANIFEST && after.outboxRows === 0 && retryIdempotent;
      const changedRowsWritten = writePerformed ? delta.changed.length : 0;

      state.lastRevisionKey = `${TARGET_CANDIDATE}|${TARGET_HEAD_VERSION}|${TARGET_MANIFEST}`;
      state.report = {
        format: 'WLP_CANONICAL_LOCAL_MIRROR_REVISION_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode,
        device: { deviceKey: device.deviceKey, label: device.label || '', platform: device.platform || '' },
        authority: {
          candidateKey: head.candidate_key,
          headVersion: Number(head.head_version || 0),
          previousCandidateKey: head.previous_candidate_key,
          snapshotManifestHash: head.snapshot_manifest_hash,
          migrationVersion: String(head.migration_version || ''),
          canonicalRows: Number(head.canonical_row_count || 0),
          learningStateRowsWithFirstSeen: authorityStatesWithFirstSeen
        },
        before: {
          mirrorState: beforeState,
          candidateKey: before.meta?.candidateKey || null,
          headVersion: Number(before.meta?.headVersion || 0),
          migrationVersion: String(before.meta?.migrationVersion || ''),
          snapshotManifestHash: before.snapshotManifestHash,
          mirrorRows: before.rowCount,
          outboxRows: before.outboxRows
        },
        summary: {
          writePerformed,
          authorityRows: authorityRows.length,
          authorityPayloadHashesVerified: authorityCheck.verified,
          plannedChangedRows: beforeState === 'V1' ? delta.changed.length : 0,
          changedRowsWritten,
          changedTables: beforeState === 'V1' ? [...new Set(delta.changed.map(row => row.table_name))] : [],
          missingRows: delta.missing.length,
          extraRows: delta.extra.length,
          tombstoneChanges: delta.tombstoneChanges.length,
          mirrorRows: after.rowCount,
          mirrorPayloadHashesVerified: after.payloadHashesVerified,
          payloadHashMismatches: after.payloadHashMismatches.length,
          rowKeyMismatches: after.rowKeyMismatches.length,
          learningStateRowsWithFirstSeen: afterStatesWithFirstSeen,
          spotCheck2876Match: spotFirstSeen === SPOTCHECK_FIRST_SEEN,
          mirrorManifestMatch: after.snapshotManifestHash === TARGET_MANIFEST,
          mirrorMetaState: afterState,
          outboxRows: after.outboxRows,
          blockingIssues: blocking.length,
          retryRequested: Boolean(retryRequested),
          retryIdempotent,
          initialRevisionWriteObserved: Boolean(state.firstApplyEvidence),
          initialChangedRowsWritten: Number(state.firstApplyEvidence?.changedRowsWritten || 0),
          pass
        },
        priorApply: state.firstApplyEvidence ? clone(state.firstApplyEvidence) : null,
        hashes: {
          parentMirrorManifestHash: PARENT_MANIFEST,
          activeAuthorityManifestHash: TARGET_MANIFEST,
          beforeMirrorManifestHash: before.snapshotManifestHash,
          afterMirrorManifestHash: after.snapshotManifestHash,
          learningStateManifestHash: after.tableManifestHashes?.learning_state || ''
        },
        spotCheck2876: {
          cardId: SPOTCHECK_CARD_ID,
          expectedFirstSeenAt: SPOTCHECK_FIRST_SEEN,
          actualFirstSeenAt: spotFirstSeen
        },
        mirrorMeta: after.meta ? {
          key: after.meta.key,
          dbSchemaVersion: after.meta.dbSchemaVersion,
          userBound: Boolean(after.meta.userId),
          deviceKey: after.meta.deviceKey,
          candidateKey: after.meta.candidateKey,
          headVersion: after.meta.headVersion,
          previousCandidateKey: after.meta.previousCandidateKey || null,
          snapshotManifestHash: after.meta.snapshotManifestHash,
          canonicalRowCount: after.meta.canonicalRowCount,
          migrationVersion: after.meta.migrationVersion,
          authorityRevision: after.meta.authorityRevision || null,
          installedAt: after.meta.installedAt || null,
          revisedAt: after.meta.revisedAt || null,
          revisionSource: after.meta.revisionSource || null
        } : null,
        issues: {
          blocking,
          warnings: [
            `The isolated ${DB_NAME} mirror is now aligned with ACTIVE Authority v2. Live Progress, Review, Study, Editor, search, and legacy localStorage are still untouched.`,
            writePerformed ? `Exactly ${changedRowsWritten} learning_state row(s) plus authority_mirror metadata were updated in one IndexedDB revision transaction; no other Canonical store was written.` : 'The mirror already matched Authority v2, so this run performed read-back verification only and wrote nothing.',
            'No Cloud write occurred. sync_outbox remains empty; no user mutation transport is active yet.',
            'Authority v2 adds explicit first_seen_at to all 111 learning_state rows so page-facing compatibility no longer needs to approximate earliest-seen time from later history.'
          ],
          authorityPayloadHashMismatches: authorityCheck.payloadHashMismatches,
          authorityRowKeyMismatches: authorityCheck.rowKeyMismatches,
          mirrorPayloadHashMismatches: after.payloadHashMismatches,
          mirrorRowKeyMismatches: after.rowKeyMismatches
        },
        invariants: {
          activeAuthorityV2Required: true,
          cloudReadsOnly: true,
          indexedDbWritesRestrictedToWlpCloudV1: true,
          exactParentMirrorRequiredForFirstRevision: true,
          parentChildIdentitySetEqual: delta.missing.length === 0 && delta.extra.length === 0,
          onlyLearningStateChanged: beforeState !== 'V1' || (delta.changed.length === EXPECTED_CHANGED_ROWS && delta.changed.every(row => row.table_name === 'learning_state')),
          noTombstoneSemanticChanges: delta.tombstoneChanges.length === 0,
          atomicRevisionTransaction: true,
          noLegacyLocalStorageWrites: true,
          noLiveWlpWrites: true,
          noCloudToLiveWlpApply: true,
          sameTargetRetryReadOnly: !retryRequested || !writePerformed,
          syncOutboxEmpty: after.outboxRows === 0,
          fullPayloadRoundTripVerified: after.payloadHashesVerified === after.rowCount && after.payloadHashMismatches.length === 0,
          activeAuthorityManifestMatched: after.snapshotManifestHash === TARGET_MANIFEST,
          explicitFirstSeenComplete: afterStatesWithFirstSeen === EXPECTED_CHANGED_ROWS
        }
      };

      render(state.report);
      setStatus(`Canonical Mirror v2 ${pass ? 'PASS' : 'CHECK'} · ${writePerformed ? `updated ${changedRowsWritten} learning_state rows` : 'read-only retry verified'} · mirror ${after.rowCount.toLocaleString()} rows · hashes ${after.payloadHashesVerified.toLocaleString()} · manifest ${after.snapshotManifestHash === TARGET_MANIFEST ? 'MATCH' : 'MISMATCH'} · WID 2876 ${spotFirstSeen === SPOTCHECK_FIRST_SEEN ? 'MATCH' : 'MISMATCH'} · outbox ${after.outboxRows}.`, pass ? 'success' : 'error');
      window.dispatchEvent(new CustomEvent('wlp-canonical-local-mirror-v2-revision-complete'));
    } catch (error) {
      console.error('WLP Canonical Mirror v2 Revision:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      if (db) db.close();
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('canonical-mirror-v2-before').textContent = report.before?.mirrorState || '—';
    $('canonical-mirror-v2-after').textContent = s.mirrorMetaState || '—';
    $('canonical-mirror-v2-planned').textContent = Number(s.plannedChangedRows || 0).toLocaleString();
    $('canonical-mirror-v2-written').textContent = Number(s.changedRowsWritten || 0).toLocaleString();
    $('canonical-mirror-v2-rows').textContent = Number(s.mirrorRows || 0).toLocaleString();
    $('canonical-mirror-v2-hashes').textContent = Number(s.mirrorPayloadHashesVerified || 0).toLocaleString();
    $('canonical-mirror-v2-firstseen').textContent = Number(s.learningStateRowsWithFirstSeen || 0).toLocaleString();
    $('canonical-mirror-v2-outbox').textContent = Number(s.outboxRows || 0).toLocaleString();
    $('canonical-mirror-v2-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('canonical-mirror-v2-repeat').textContent = s.retryRequested ? (s.retryIdempotent ? 'PASS' : 'FAIL') : '—';
    $('canonical-mirror-v2-result').textContent = s.pass ? 'PASS' : 'FAIL';
    $('canonical-mirror-v2-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('canonical-mirror-v2-authority-hash').textContent = report.hashes?.activeAuthorityManifestHash || '—';
    $('canonical-mirror-v2-mirror-hash').textContent = report.hashes?.afterMirrorManifestHash || '—';
    $('canonical-mirror-v2-spot').textContent = `${report.spotCheck2876?.actualFirstSeenAt || 'missing'} · expected ${report.spotCheck2876?.expectedFirstSeenAt || '—'}`;

    const notes = $('canonical-mirror-v2-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No Canonical mirror v2 revision issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });
    $('canonical-mirror-v2-panel').classList.remove('hidden');
    $('export-canonical-mirror-v2').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-local-mirror-v2-revision-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('canonical-mirror-v2-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }

  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const ready = Boolean(cloud.configured && cloud.signedIn);
    $('apply-canonical-mirror-v2').disabled = state.busy || !ready;
    $('retry-canonical-mirror-v2').disabled = state.busy || !ready || !state.lastRevisionKey;
    $('export-canonical-mirror-v2').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalLocalMirrorV2Revision = Object.freeze({ getReport: () => state.report, dbName: DB_NAME, dbVersion: DB_VERSION });

  function init() {
    $('apply-canonical-mirror-v2').addEventListener('click', () => execute(false));
    $('retry-canonical-mirror-v2').addEventListener('click', () => execute(true));
    $('export-canonical-mirror-v2').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
