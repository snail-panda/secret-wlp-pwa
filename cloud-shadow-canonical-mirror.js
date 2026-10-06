/* WLP Canonical Local Mirror Bootstrap v1.
   Installs the ACTIVE verified Canonical Authority into an isolated IndexedDB
   database named wlp-cloud-v1, then fully reads it back and verifies hashes.
   This file never writes Cloud data, legacy localStorage, or live WLP state. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.207-canonical-local-mirror-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const HASH_BATCH = 128;
  const CANONICAL_TABLES = Object.freeze([
    'cards',
    'card_content',
    'card_learning_metadata',
    'learning_situations',
    'learning_alternatives',
    'learning_alternative_situations',
    'card_classification',
    'learning_sessions',
    'learning_events',
    'learning_state',
    'learner_profile',
    'learner_route_state',
    'study_contexts',
    'study_context_cards',
    'study_builds',
    'study_build_cards',
    'user_preferences'
  ]);
  const state = { busy: false, report: null, lastMirrorKey: '' };

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
        const db = request.result;
        CANONICAL_TABLES.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'rowKey' });
        });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'mutationId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const required = [...CANONICAL_TABLES, META_STORE, OUTBOX_STORE];
        const missing = required.filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) {
          db.close();
          reject(new Error(`Canonical mirror schema mismatch: missing object store(s): ${missing.join(', ')}.`));
          return;
        }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open wlp-cloud-v1 IndexedDB.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another open page. Close other WLP tabs and retry.'));
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

  async function countAllStores(db) {
    const counts = {};
    for (const storeName of CANONICAL_TABLES) counts[storeName] = await countStore(db, storeName);
    return counts;
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Canonical Mirror blocked: expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,status,canonical_row_count,snapshot_manifest_hash,table_counts,table_manifest_hashes,cutover_ticket_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Canonical Mirror blocked: expected exactly one ACTIVE candidate row, found ${rows.length}.`);
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

  async function verifyAuthorityPayloads(rows) {
    let verified = 0;
    const mismatches = [];
    const identityIssues = [];
    const seen = new Set();
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        const key = identity(row.table_name, row.row_key);
        if (!CANONICAL_TABLES.includes(row.table_name)) identityIssues.push(`${row.table_name}|${row.row_key}: unsupported Canonical table.`);
        if (seen.has(key)) identityIssues.push(`${row.table_name}|${row.row_key}: duplicate Authority row identity.`);
        seen.add(key);
        const payloadKey = tablePrimaryKey(row.table_name, row.payload || {});
        if (payloadKey !== String(row.row_key)) identityIssues.push(`${row.table_name}|${row.row_key}: payload primary key is ${payloadKey || '(missing)'}.`);
        if (hash !== row.payload_hash) mismatches.push(`${row.table_name}|${row.row_key}: stored ${row.payload_hash}, computed ${hash}`);
        else verified += 1;
      });
      setStatus(`Preparing Canonical mirror… ${Math.min(start + batch.length, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} Authority payload hashes checked.`, '');
    }
    return { verified, mismatches, identityIssues };
  }

  async function manifestProof(rows) {
    const hashRows = rows.map(row => ({
      tableName: row.tableName ?? row.table_name,
      rowKey: row.rowKey ?? row.row_key,
      tombstone: Boolean(row.tombstone),
      payloadHash: row.payloadHash ?? row.payload_hash
    })).sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    const tableCounts = {};
    hashRows.forEach(row => { tableCounts[row.tableName] = (tableCounts[row.tableName] || 0) + 1; });
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(hashRows.filter(row => row.tableName === tableName)));
    }
    return {
      rowCount: hashRows.length,
      snapshotManifestHash: await sha256(stableStringify(hashRows)),
      tableCounts,
      tableManifestHashes
    };
  }

  function compareObjects(expected, actual, label, blocking) {
    const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
    [...keys].sort().forEach(key => {
      if (String(expected?.[key] ?? '') !== String(actual?.[key] ?? '')) {
        blocking.push(`${label} mismatch for ${key}: expected ${expected?.[key] ?? '(missing)'}, got ${actual?.[key] ?? '(missing)'}.`);
      }
    });
  }

  function sumCounts(counts) { return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0); }

  async function installInitialMirror(db, authorityRows, meta) {
    const storeNames = [...CANONICAL_TABLES, META_STORE];
    const tx = db.transaction(storeNames, 'readwrite');
    for (const row of authorityRows) {
      tx.objectStore(row.table_name).put({
        rowKey: String(row.row_key),
        payloadHash: String(row.payload_hash),
        tombstone: Boolean(row.tombstone),
        payload: clone(row.payload)
      });
    }
    tx.objectStore(META_STORE).put(meta);
    await transactionDone(tx);
  }

  async function readBackMirror(db) {
    const fingerprintRows = [];
    const tableCounts = {};
    const payloadMismatches = [];
    const rowKeyMismatches = [];
    let payloadHashesVerified = 0;

    for (const storeName of CANONICAL_TABLES) {
      const tx = db.transaction(storeName, 'readonly');
      const rows = await requestPromise(tx.objectStore(storeName).getAll());
      await transactionDone(tx);
      tableCounts[storeName] = rows.length;
      for (let start = 0; start < rows.length; start += HASH_BATCH) {
        const batch = rows.slice(start, start + HASH_BATCH);
        const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
        hashes.forEach((hash, index) => {
          const row = batch[index];
          const payloadKey = tablePrimaryKey(storeName, row.payload || {});
          if (payloadKey !== String(row.rowKey)) rowKeyMismatches.push(`${storeName}|${row.rowKey}: payload primary key is ${payloadKey || '(missing)'}.`);
          if (hash !== row.payloadHash) payloadMismatches.push(`${storeName}|${row.rowKey}: stored ${row.payloadHash}, computed ${hash}`);
          else payloadHashesVerified += 1;
          fingerprintRows.push({ tableName: storeName, rowKey: String(row.rowKey), tombstone: Boolean(row.tombstone), payloadHash: String(row.payloadHash) });
        });
        setStatus(`Reading back wlp-cloud-v1… ${payloadHashesVerified.toLocaleString()} payload hash(es) verified so far.`, '');
      }
    }

    const proof = await manifestProof(fingerprintRows);
    const outboxCount = await countStore(db, OUTBOX_STORE);
    const meta = await getMeta(db);
    return { ...proof, tableCounts, payloadHashesVerified, payloadMismatches, rowKeyMismatches, outboxCount, meta };
  }

  function sameAuthorityMeta(meta, head, candidate, userId) {
    return Boolean(
      meta &&
      meta.userId === userId &&
      meta.candidateKey === head.candidate_key &&
      Number(meta.headVersion || 0) === Number(head.head_version || 0) &&
      meta.snapshotManifestHash === head.snapshot_manifest_hash &&
      Number(meta.canonicalRowCount || 0) === Number(head.canonical_row_count || 0) &&
      meta.namespaceUuid === head.namespace_uuid &&
      String(meta.migrationVersion || '') === String(head.migration_version || '') &&
      meta.cardMappingHash === head.card_mapping_hash &&
      meta.coreLibraryHash === head.core_library_hash &&
      meta.cutoverTicketHash === head.cutover_ticket_hash &&
      candidate.status === 'verified'
    );
  }

  async function run(retryRequested = false) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryRequested ? 'Re-reading the existing isolated Canonical mirror without rewriting it…' : 'Installing the ACTIVE Authority into isolated IndexedDB wlp-cloud-v1, then reading it back…', '');
    let db = null;
    try {
      const pullReport = window.WLPCanonicalAuthorityPullCompare?.getReport?.();
      const dryRun = window.WLPCanonicalAuthorityApplyDryRun?.getReport?.();
      if (!pullReport?.summary?.pass || !pullReport?.summary?.nextPhaseEligible || pullReport?.summary?.sourceSnapshotMatch !== true || pullReport?.summary?.localOnly !== 0) {
        throw new Error('Canonical Mirror blocked: run a fresh Local Scan and Pull Authority + Compare Local first; it must be PASS / next-phase eligible with the source anchor MATCH and Local-only 0.');
      }
      if (!dryRun?.summary?.pass || !dryRun?.summary?.projectedMatchesAuthority || dryRun?.summary?.localOnlyBlocked !== 0) {
        throw new Error('Canonical Mirror blocked: run Authority Apply Dry Run first on this device and confirm PASS / projected Authority MATCH.');
      }
      if (dryRun.local?.snapshotHash !== pullReport.local?.snapshotHash || dryRun.local?.fullCanonicalHash !== pullReport.local?.fullCanonicalHash) {
        throw new Error('Canonical Mirror blocked: Pull Compare and Apply Dry Run do not reference the same current Local Scan.');
      }

      const api = window.WLPCloudShadowSupabase;
      if (!api?.fetchPaged || !api?.ensureSession || !api?.getDevice || !api?.getState) throw new Error('Supabase Shadow transport is unavailable.');
      await api.ensureSession();
      const device = await api.getDevice();
      const cloudState = api.getState();
      const userId = cloudState.userId || '';
      if (!userId) throw new Error('Canonical Mirror blocked: signed-in user ID is unavailable.');
      if (device.deviceKey !== pullReport.device?.deviceKey) throw new Error('Canonical Mirror blocked: current device identity differs from the Pull Compare report.');

      const head = await fetchHead(api);
      const candidate = await fetchCandidate(api, head.candidate_key);
      if (candidate.status !== 'verified') throw new Error(`Canonical Mirror blocked: ACTIVE candidate status is ${candidate.status || 'missing'}, not verified.`);
      if (head.candidate_key !== dryRun.authority?.candidateKey || Number(head.head_version || 0) !== Number(dryRun.authority?.headVersion || 0) || head.snapshot_manifest_hash !== dryRun.authority?.snapshotManifestHash) {
        throw new Error('Canonical Mirror blocked: ACTIVE Authority Head changed after the Apply Dry Run. Re-run Pull Compare and Apply Dry Run.');
      }

      const authorityRows = await fetchAuthorityRows(api, head.candidate_key);
      const authorityCheck = await verifyAuthorityPayloads(authorityRows);
      const authorityProof = await manifestProof(authorityRows);
      const blocking = [];
      if (authorityCheck.mismatches.length) blocking.push(`${authorityCheck.mismatches.length} Authority payload hash mismatch(es).`);
      if (authorityCheck.identityIssues.length) blocking.push(`${authorityCheck.identityIssues.length} Authority identity issue(s).`);
      if (authorityRows.length !== Number(head.canonical_row_count || 0)) blocking.push(`Authority row count mismatch: head=${head.canonical_row_count}, pulled=${authorityRows.length}.`);
      if (authorityRows.length !== Number(candidate.canonical_row_count || 0)) blocking.push(`Candidate row count mismatch: candidate=${candidate.canonical_row_count}, pulled=${authorityRows.length}.`);
      if (authorityProof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Recomputed Authority manifest does not match ACTIVE Head manifest.');
      if (head.snapshot_manifest_hash !== candidate.snapshot_manifest_hash) blocking.push('Authority Head manifest does not match candidate manifest.');
      if (head.cutover_ticket_hash !== candidate.cutover_ticket_hash) blocking.push('Authority Head Cutover Ticket does not match candidate.');
      if (head.migration_version !== candidate.migration_version) blocking.push('Authority Head migration version does not match candidate.');
      if (head.namespace_uuid !== candidate.namespace_uuid) blocking.push('Authority Head namespace UUID does not match candidate.');
      if (head.card_mapping_hash !== candidate.card_mapping_hash) blocking.push('Authority Head Card Mapping hash does not match candidate.');
      if (head.core_library_hash !== candidate.core_library_hash) blocking.push('Authority Head Core Library hash does not match candidate.');
      compareObjects(candidate.table_counts || {}, authorityProof.tableCounts, 'Authority table count', blocking);
      compareObjects(candidate.table_manifest_hashes || {}, authorityProof.tableManifestHashes, 'Authority table manifest', blocking);
      if (authorityProof.snapshotManifestHash !== dryRun.hashes?.projectedManifestHash) blocking.push('Authority manifest no longer matches the device Apply Dry Run projected manifest.');
      if (blocking.length) throw new Error(`Canonical Mirror blocked before IndexedDB write: ${blocking.join(' ')}`);

      db = await openMirrorDb();
      const beforeMeta = await getMeta(db);
      const beforeCounts = await countAllStores(db);
      const beforeRows = sumCounts(beforeCounts);
      const outboxBefore = await countStore(db, OUTBOX_STORE);
      const sameExisting = sameAuthorityMeta(beforeMeta, head, candidate, userId);
      let writePerformed = false;
      let mode = 'initial-authority-mirror-install';

      if (beforeMeta) {
        if (!sameExisting) {
          throw new Error('Canonical Mirror blocked: wlp-cloud-v1 already contains metadata for a different account or Authority revision. v207 will not overwrite an existing different mirror.');
        }
        mode = retryRequested ? 'retry-existing-authority-mirror' : 'verify-existing-authority-mirror';
      } else {
        if (retryRequested) throw new Error('Retry Same Mirror blocked: no installed Canonical mirror metadata exists yet. Run Install Canonical Mirror + Read-back first.');
        if (beforeRows !== 0 || outboxBefore !== 0) {
          throw new Error(`Canonical Mirror blocked: wlp-cloud-v1 has ${beforeRows.toLocaleString()} Canonical row(s) or ${outboxBefore.toLocaleString()} outbox row(s) but no valid authority_mirror metadata. v207 will not clear or overwrite ambiguous IndexedDB state.`);
        }
        const installedAt = new Date().toISOString();
        const meta = {
          key: META_KEY,
          dbSchemaVersion: DB_VERSION,
          userId,
          deviceKey: device.deviceKey,
          candidateKey: head.candidate_key,
          headVersion: Number(head.head_version || 0),
          snapshotManifestHash: head.snapshot_manifest_hash,
          canonicalRowCount: Number(head.canonical_row_count || 0),
          namespaceUuid: head.namespace_uuid,
          migrationVersion: String(head.migration_version || ''),
          cardMappingHash: head.card_mapping_hash,
          coreLibraryHash: head.core_library_hash,
          cutoverTicketHash: head.cutover_ticket_hash,
          installedAt,
          installSource: 'active-authority-bootstrap-v1'
        };
        setStatus(`Writing ${authorityRows.length.toLocaleString()} Authority row(s) into isolated IndexedDB ${DB_NAME}… legacy WLP remains untouched.`, '');
        await installInitialMirror(db, authorityRows, meta);
        writePerformed = true;
      }

      const readBack = await readBackMirror(db);
      const mirrorMetaMatch = sameAuthorityMeta(readBack.meta, head, candidate, userId);
      const mirrorManifestMatch = readBack.snapshotManifestHash === head.snapshot_manifest_hash;
      const mirrorCountMatch = readBack.rowCount === Number(head.canonical_row_count || 0);
      const outboxEmpty = readBack.outboxCount === 0;
      const tableCountsComparable = {};
      CANONICAL_TABLES.forEach(name => {
        const count = Number(readBack.tableCounts[name] || 0);
        if (count || Object.prototype.hasOwnProperty.call(candidate.table_counts || {}, name)) tableCountsComparable[name] = count;
      });
      compareObjects(candidate.table_counts || {}, tableCountsComparable, 'Mirror table count', blocking);
      compareObjects(candidate.table_manifest_hashes || {}, readBack.tableManifestHashes, 'Mirror table manifest', blocking);
      if (!mirrorMetaMatch) blocking.push('Mirror authority metadata does not match the ACTIVE Authority Head.');
      if (!mirrorManifestMatch) blocking.push('Mirror manifest does not match ACTIVE Authority manifest.');
      if (!mirrorCountMatch) blocking.push(`Mirror row count mismatch: head=${head.canonical_row_count}, mirror=${readBack.rowCount}.`);
      if (readBack.payloadMismatches.length) blocking.push(`${readBack.payloadMismatches.length} IndexedDB payload hash mismatch(es).`);
      if (readBack.rowKeyMismatches.length) blocking.push(`${readBack.rowKeyMismatches.length} IndexedDB row-key mismatch(es).`);
      if (!outboxEmpty) blocking.push(`Canonical sync outbox is not empty (${readBack.outboxCount}); bootstrap mirror must start with an empty outbox.`);

      const retryIdempotent = mode !== 'retry-existing-authority-mirror' || (!writePerformed && mirrorManifestMatch && mirrorMetaMatch && mirrorCountMatch && outboxEmpty);
      const pass = blocking.length === 0 && mirrorManifestMatch && mirrorMetaMatch && mirrorCountMatch && outboxEmpty && retryIdempotent;
      const warnings = [
        `The isolated ${DB_NAME} mirror now contains ${readBack.rowCount.toLocaleString()} Canonical row(s). Live WLP continues to read its legacy/local data exactly as before; this mirror is not wired into Study, Review, Editor, Progress, or search.`,
        writePerformed ? 'This run performed the first controlled write to the new Canonical mirror database, restricted to the isolated wlp-cloud-v1 IndexedDB.' : 'This run detected the same installed Authority mirror and performed read-back verification only; it did not rewrite Canonical rows.',
        'No Cloud write and no legacy localStorage write occurred. The sync_outbox store exists but remains empty.',
        'No explicit tombstones exist in Authority v1 real data, so tombstone storage is schema-ready but still not empirically exercised.'
      ];

      state.lastMirrorKey = `${head.candidate_key}|${head.head_version}|${head.snapshot_manifest_hash}`;
      state.report = {
        format: 'WLP_CANONICAL_LOCAL_MIRROR_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode,
        device: { deviceKey: device.deviceKey, label: device.label || '', platform: device.platform || '' },
        database: { name: DB_NAME, version: DB_VERSION, canonicalStores: CANONICAL_TABLES.length, metaStore: META_STORE, outboxStore: OUTBOX_STORE },
        authority: {
          candidateKey: head.candidate_key,
          headVersion: Number(head.head_version || 0),
          snapshotManifestHash: head.snapshot_manifest_hash,
          canonicalRows: Number(head.canonical_row_count || 0),
          namespaceUuid: head.namespace_uuid,
          migrationVersion: String(head.migration_version || ''),
          cardMappingHash: head.card_mapping_hash,
          coreLibraryHash: head.core_library_hash,
          cutoverTicketHash: head.cutover_ticket_hash
        },
        before: { metaPresent: Boolean(beforeMeta), canonicalRows: beforeRows, tableCounts: beforeCounts, outboxRows: outboxBefore },
        summary: {
          writePerformed,
          authorityRows: authorityRows.length,
          mirrorRows: readBack.rowCount,
          payloadHashesVerified: readBack.payloadHashesVerified,
          payloadHashMismatches: readBack.payloadMismatches.length,
          rowKeyMismatches: readBack.rowKeyMismatches.length,
          tableCount: Object.keys(candidate.table_counts || {}).length,
          tableManifestMatches: Object.keys(candidate.table_manifest_hashes || {}).filter(name => candidate.table_manifest_hashes[name] === readBack.tableManifestHashes[name]).length,
          mirrorManifestMatch,
          mirrorMetaMatch,
          outboxRows: readBack.outboxCount,
          blockingIssues: blocking.length,
          retryRequested: Boolean(retryRequested),
          retryIdempotent,
          pass
        },
        hashes: {
          authorityManifestHash: head.snapshot_manifest_hash,
          mirrorManifestHash: readBack.snapshotManifestHash,
          applyPlanHash: dryRun.hashes?.applyPlanHash || ''
        },
        tableCounts: readBack.tableCounts,
        tableManifestHashes: readBack.tableManifestHashes,
        mirrorMeta: readBack.meta ? {
          key: readBack.meta.key,
          dbSchemaVersion: readBack.meta.dbSchemaVersion,
          userBound: Boolean(readBack.meta.userId),
          deviceKey: readBack.meta.deviceKey,
          candidateKey: readBack.meta.candidateKey,
          headVersion: readBack.meta.headVersion,
          snapshotManifestHash: readBack.meta.snapshotManifestHash,
          canonicalRowCount: readBack.meta.canonicalRowCount,
          namespaceUuid: readBack.meta.namespaceUuid,
          migrationVersion: readBack.meta.migrationVersion,
          cardMappingHash: readBack.meta.cardMappingHash,
          coreLibraryHash: readBack.meta.coreLibraryHash,
          cutoverTicketHash: readBack.meta.cutoverTicketHash,
          installedAt: readBack.meta.installedAt,
          installSource: readBack.meta.installSource
        } : null,
        issues: {
          blocking,
          warnings,
          authorityPayloadHashMismatches: authorityCheck.mismatches,
          authorityIdentityIssues: authorityCheck.identityIssues,
          mirrorPayloadHashMismatches: readBack.payloadMismatches,
          mirrorRowKeyMismatches: readBack.rowKeyMismatches
        },
        invariants: {
          cloudReadsOnly: true,
          indexedDbWritesRestrictedToWlpCloudV1: true,
          noLegacyLocalStorageWrites: true,
          noCloudToLegacyWlpApply: true,
          noLiveWlpWrites: true,
          noAbsenceBasedLegacyDeletion: true,
          existingDifferentMirrorCannotBeOverwritten: true,
          sameAuthorityRetryReadOnly: mode !== 'retry-existing-authority-mirror' || !writePerformed,
          syncOutboxStartsEmpty: outboxEmpty,
          fullPayloadRoundTripVerified: readBack.payloadHashesVerified === readBack.rowCount && readBack.payloadMismatches.length === 0,
          activeAuthorityManifestMatched: mirrorManifestMatch
        }
      };

      render(state.report);
      setStatus(
        `Canonical Mirror ${pass ? 'PASS' : 'CHECK'} · ${writePerformed ? 'installed' : 'verified'} ${readBack.rowCount.toLocaleString()} row(s) in ${DB_NAME} · payload hashes ${readBack.payloadHashesVerified.toLocaleString()} · manifest ${mirrorManifestMatch ? 'MATCH' : 'MISMATCH'} · outbox ${readBack.outboxCount} · legacy WLP untouched.`,
        pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-local-mirror-complete'));
    } catch (error) {
      console.error('WLP Canonical Local Mirror:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      if (db) db.close();
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('canonical-mirror-db').textContent = report.database?.name || '—';
    $('canonical-mirror-authority').textContent = Number(s.authorityRows || 0).toLocaleString();
    $('canonical-mirror-rows').textContent = Number(s.mirrorRows || 0).toLocaleString();
    $('canonical-mirror-hashes').textContent = Number(s.payloadHashesVerified || 0).toLocaleString();
    $('canonical-mirror-mismatches').textContent = Number(s.payloadHashMismatches || 0).toLocaleString();
    $('canonical-mirror-outbox').textContent = Number(s.outboxRows || 0).toLocaleString();
    $('canonical-mirror-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('canonical-mirror-write').textContent = s.writePerformed ? 'YES' : 'NO';
    $('canonical-mirror-result').textContent = s.pass ? 'PASS' : 'FAIL';
    $('canonical-mirror-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('canonical-mirror-authority-hash').textContent = report.hashes?.authorityManifestHash || '—';
    $('canonical-mirror-mirror-hash').textContent = report.hashes?.mirrorManifestHash || '—';

    const body = $('canonical-mirror-table-body');
    body.innerHTML = '';
    CANONICAL_TABLES.forEach(tableName => {
      const tr = document.createElement('tr');
      const actual = Number(report.tableCounts?.[tableName] || 0);
      const hash = report.tableManifestHashes?.[tableName] || '—';
      const values = [tableName, actual, hash === '—' ? '—' : hash];
      values.forEach(value => { const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td); });
      body.appendChild(tr);
    });

    const notes = $('canonical-mirror-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No Canonical mirror issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('canonical-mirror-panel').classList.remove('hidden');
    $('export-canonical-mirror').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-local-mirror-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('canonical-mirror-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }

  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const pullReport = window.WLPCanonicalAuthorityPullCompare?.getReport?.();
    const dryRun = window.WLPCanonicalAuthorityApplyDryRun?.getReport?.();
    const eligible = Boolean(
      pullReport?.summary?.pass &&
      pullReport?.summary?.nextPhaseEligible &&
      pullReport?.summary?.sourceSnapshotMatch === true &&
      pullReport?.summary?.localOnly === 0 &&
      dryRun?.summary?.pass &&
      dryRun?.summary?.projectedMatchesAuthority &&
      dryRun?.summary?.localOnlyBlocked === 0
    );
    $('install-canonical-mirror').disabled = state.busy || !cloud.configured || !cloud.signedIn || !eligible;
    $('retry-canonical-mirror').disabled = state.busy || !cloud.configured || !cloud.signedIn || !eligible || !state.lastMirrorKey;
    $('export-canonical-mirror').disabled = state.busy || !state.report;
  }

  function resetAfterPrerequisite(message) {
    state.report = null;
    $('export-canonical-mirror').disabled = true;
    setStatus(message, '');
    refreshButtons();
  }

  window.WLPCanonicalLocalMirror = Object.freeze({ getReport: () => state.report, dbName: DB_NAME, dbVersion: DB_VERSION });

  function init() {
    $('install-canonical-mirror').addEventListener('click', () => run(false));
    $('retry-canonical-mirror').addEventListener('click', () => run(true));
    $('export-canonical-mirror').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', () => resetAfterPrerequisite('Fresh Local Scan captured. Run Pull Authority + Compare Local and Apply Dry Run again before installing/verifying the Canonical mirror.'));
    window.addEventListener('wlp-canonical-authority-pull-compare-complete', () => resetAfterPrerequisite('Pull Compare completed. Run Authority Apply Dry Run before installing/verifying the Canonical mirror.'));
    window.addEventListener('wlp-canonical-authority-apply-dry-run-complete', () => resetAfterPrerequisite('Apply Dry Run completed. If PASS, install the isolated wlp-cloud-v1 Canonical mirror and verify its read-back.'));
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
