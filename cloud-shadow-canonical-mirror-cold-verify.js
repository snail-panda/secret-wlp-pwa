/* WLP Canonical Local Mirror Cold-Start Verification v1.
   Reads the already-installed wlp-cloud-v1 IndexedDB mirror only.
   It performs no Cloud calls, no IndexedDB writes, no localStorage writes,
   and no live WLP writes. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.208-canonical-mirror-cold-verify-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const HASH_BATCH = 128;
  const EXPECTED = Object.freeze({
    candidateKey: 'v1:5d5ad23a7d6fa181e2ec1642649b059cd4afa21a7af1fd64efc794efe01bae54',
    headVersion: 1,
    snapshotManifestHash: '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a',
    canonicalRowCount: 21424,
    namespaceUuid: '87dc20ed-dd35-5ba3-8bde-04bf389874ce',
    migrationVersion: '2',
    cardMappingHash: 'a8583404626e6c9fea9f602dbdae8d7972af937f30400efef1ccb770c59a125a',
    coreLibraryHash: 'cd6e9f05b7a5582285f9e8b6dfa357e113eecbbbea612a2937ae7f819c04d15c',
    cutoverTicketHash: '5d5ad23a7d6fa181e2ec1642649b059cd4afa21a7af1fd64efc794efe01bae54'
  });
  const EXPECTED_COUNTS = Object.freeze({
    card_classification: 6538,
    card_content: 6546,
    card_learning_metadata: 18,
    cards: 6546,
    learner_profile: 1,
    learner_route_state: 1,
    learning_alternative_situations: 2,
    learning_alternatives: 2,
    learning_events: 1150,
    learning_sessions: 55,
    learning_situations: 6,
    learning_state: 111,
    study_build_cards: 38,
    study_builds: 2,
    study_context_cards: 342,
    study_contexts: 62,
    user_preferences: 4
  });
  const CANONICAL_TABLES = Object.freeze(Object.keys(EXPECTED_COUNTS).sort());
  const state = { busy: false, report: null };

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
          reject(new Error('Cold verification blocked: wlp-cloud-v1 did not already exist at schema version 1. Run v207 mirror installation first.'));
          return;
        }
        const db = request.result;
        const required = [...CANONICAL_TABLES, META_STORE, OUTBOX_STORE];
        const missing = required.filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) {
          db.close();
          reject(new Error(`Cold verification blocked: mirror schema is missing object store(s): ${missing.join(', ')}.`));
          return;
        }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open existing wlp-cloud-v1 IndexedDB.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP page. Close other WLP tabs and retry.'));
    });
  }

  async function getOne(db, storeName, key) {
    const tx = db.transaction(storeName, 'readonly');
    const value = await requestPromise(tx.objectStore(storeName).get(key));
    await transactionDone(tx);
    return value || null;
  }

  async function getAll(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const rows = await requestPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return rows || [];
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

  async function manifestProof(fingerprintRows) {
    const rows = [...fingerprintRows].sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    const tableCounts = {};
    rows.forEach(row => { tableCounts[row.tableName] = (tableCounts[row.tableName] || 0) + 1; });
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(rows.filter(row => row.tableName === tableName)));
    }
    const snapshotManifestHash = await sha256(stableStringify(rows));
    return { rowCount: rows.length, snapshotManifestHash, tableCounts, tableManifestHashes };
  }

  function currentHotReports() {
    const entries = [
      ['Pull Compare', window.WLPCanonicalAuthorityPullCompare?.getReport?.()],
      ['Apply Dry Run', window.WLPCanonicalAuthorityApplyDryRun?.getReport?.()],
      ['Mirror Install/Retry', window.WLPCanonicalLocalMirror?.getReport?.()]
    ];
    return entries.filter(([, report]) => Boolean(report)).map(([name]) => name);
  }

  function compareExpectedMeta(meta, blocking) {
    if (!meta) {
      blocking.push('authority_mirror metadata is missing.');
      return;
    }
    if (meta.key !== META_KEY) blocking.push(`Mirror meta key mismatch: ${meta.key || '(missing)'}.`);
    if (Number(meta.dbSchemaVersion || 0) !== DB_VERSION) blocking.push(`Mirror DB schema version mismatch: ${meta.dbSchemaVersion || '(missing)'}.`);
    for (const [key, expected] of Object.entries(EXPECTED)) {
      if (String(meta[key] ?? '') !== String(expected)) blocking.push(`Mirror metadata mismatch for ${key}: expected ${expected}, got ${meta[key] ?? '(missing)'}.`);
    }
    if (!meta.userId) blocking.push('Mirror metadata is not user-bound.');
    if (!meta.deviceKey) blocking.push('Mirror metadata deviceKey is missing.');
    if (!meta.installedAt) blocking.push('Mirror metadata installedAt is missing.');
    if (meta.installSource !== 'active-authority-bootstrap-v1') blocking.push(`Unexpected mirror installSource: ${meta.installSource || '(missing)'}.`);
  }

  function compareCounts(actual, blocking) {
    for (const tableName of CANONICAL_TABLES) {
      const expected = Number(EXPECTED_COUNTS[tableName] || 0);
      const got = Number(actual[tableName] || 0);
      if (expected !== got) blocking.push(`Cold mirror table count mismatch for ${tableName}: expected ${expected}, got ${got}.`);
    }
  }

  async function readMirror(db) {
    const fingerprintRows = [];
    const tableCounts = {};
    const payloadHashMismatches = [];
    const rowKeyMismatches = [];
    let payloadHashesVerified = 0;

    for (const storeName of CANONICAL_TABLES) {
      const rows = await getAll(db, storeName);
      tableCounts[storeName] = rows.length;
      for (let start = 0; start < rows.length; start += HASH_BATCH) {
        const batch = rows.slice(start, start + HASH_BATCH);
        const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
        hashes.forEach((hash, index) => {
          const row = batch[index];
          const payloadKey = tablePrimaryKey(storeName, row.payload || {});
          if (payloadKey !== String(row.rowKey)) rowKeyMismatches.push(`${storeName}|${row.rowKey}: payload primary key is ${payloadKey || '(missing)'}.`);
          if (hash !== row.payloadHash) payloadHashMismatches.push(`${storeName}|${row.rowKey}: stored ${row.payloadHash}, computed ${hash}.`);
          else payloadHashesVerified += 1;
          fingerprintRows.push({
            tableName: storeName,
            rowKey: String(row.rowKey),
            tombstone: Boolean(row.tombstone),
            payloadHash: String(row.payloadHash)
          });
        });
        setStatus(`Cold-reading ${DB_NAME}… ${payloadHashesVerified.toLocaleString()} payload hash(es) verified so far.`, '');
      }
    }
    const proof = await manifestProof(fingerprintRows);
    const repeatProof = await manifestProof(fingerprintRows);
    return {
      ...proof,
      repeatSnapshotManifestHash: repeatProof.snapshotManifestHash,
      tableCounts,
      payloadHashesVerified,
      payloadHashMismatches,
      rowKeyMismatches,
      meta: await getOne(db, META_STORE, META_KEY),
      outboxRows: await countStore(db, OUTBOX_STORE)
    };
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
    setStatus('Opening the already-installed wlp-cloud-v1 mirror locally only… no Cloud calls will be made.', '');
    let db = null;
    try {
      const hotReports = currentHotReports();
      if (hotReports.length) {
        throw new Error(`Cold verification requires a fresh page load with no prerequisite workflow run in memory. Reload cloud-shadow.html, then click only Verify Mirror Cold Start. In-memory report(s) currently present: ${hotReports.join(', ')}.`);
      }

      db = await openExistingMirrorReadOnly();
      const readBack = await readMirror(db);
      const blocking = [];
      compareExpectedMeta(readBack.meta, blocking);
      compareCounts(readBack.tableCounts, blocking);
      if (readBack.rowCount !== EXPECTED.canonicalRowCount) blocking.push(`Cold mirror row count mismatch: expected ${EXPECTED.canonicalRowCount}, got ${readBack.rowCount}.`);
      if (readBack.snapshotManifestHash !== EXPECTED.snapshotManifestHash) blocking.push('Cold mirror manifest does not match the promoted Authority v1 manifest.');
      if (readBack.repeatSnapshotManifestHash !== readBack.snapshotManifestHash) blocking.push('Cold mirror manifest proof was not repeatable from the same read-back fingerprint set.');
      if (readBack.payloadHashMismatches.length) blocking.push(`${readBack.payloadHashMismatches.length} mirror payload hash mismatch(es).`);
      if (readBack.rowKeyMismatches.length) blocking.push(`${readBack.rowKeyMismatches.length} mirror row-key mismatch(es).`);
      if (readBack.outboxRows !== 0) blocking.push(`sync_outbox is not empty: ${readBack.outboxRows} row(s).`);

      const repeatability = readBack.repeatSnapshotManifestHash === readBack.snapshotManifestHash;
      const pass = blocking.length === 0;
      const sanitizedMeta = readBack.meta ? {
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
      } : null;

      state.report = {
        format: 'WLP_CANONICAL_LOCAL_MIRROR_COLD_VERIFY',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'indexeddb-local-only-cold-start-verify',
        device: { deviceKey: sanitizedMeta?.deviceKey || null, platform: platformLabel() },
        database: { name: DB_NAME, version: DB_VERSION, canonicalStores: CANONICAL_TABLES.length, metaStore: META_STORE, outboxStore: OUTBOX_STORE },
        expectedAuthority: { ...EXPECTED },
        summary: {
          mirrorRows: readBack.rowCount,
          payloadHashesVerified: readBack.payloadHashesVerified,
          payloadHashMismatches: readBack.payloadHashMismatches.length,
          rowKeyMismatches: readBack.rowKeyMismatches.length,
          tableCount: CANONICAL_TABLES.length,
          tableCountMatches: CANONICAL_TABLES.filter(name => Number(readBack.tableCounts[name] || 0) === Number(EXPECTED_COUNTS[name] || 0)).length,
          mirrorManifestMatch: readBack.snapshotManifestHash === EXPECTED.snapshotManifestHash,
          mirrorMetaExpectedMatch: !blocking.some(item => item.startsWith('Mirror meta') || item.startsWith('Mirror metadata') || item.startsWith('Unexpected mirror') || item.startsWith('authority_mirror')),
          outboxRows: readBack.outboxRows,
          blockingIssues: blocking.length,
          repeatability,
          pass
        },
        hashes: {
          storedManifestHash: sanitizedMeta?.snapshotManifestHash || null,
          readBackManifestHash: readBack.snapshotManifestHash,
          repeatedReadBackManifestHash: readBack.repeatSnapshotManifestHash
        },
        tableCounts: readBack.tableCounts,
        expectedTableCounts: { ...EXPECTED_COUNTS },
        tableManifestHashes: readBack.tableManifestHashes,
        mirrorMeta: sanitizedMeta,
        issues: {
          blocking,
          warnings: [
            'This verification reads only the already-installed wlp-cloud-v1 IndexedDB mirror. It does not contact Supabase or any Cloud endpoint.',
            'No IndexedDB write, localStorage write, Cloud write, or live WLP write occurs in this step.',
            'The Canonical mirror is still not wired into Study, Review, Editor, Progress, or search.',
            'sync_outbox must remain empty before any live dual-write or sync transport is introduced.'
          ],
          payloadHashMismatches: readBack.payloadHashMismatches,
          rowKeyMismatches: readBack.rowKeyMismatches
        },
        invariants: {
          noCloudCallsByVerifier: true,
          indexedDbReadOnly: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noCloudWrites: true,
          noCloudToLegacyWlpApply: true,
          noLiveWlpWrites: true,
          coldStartPrerequisiteReportsAbsent: true,
          syncOutboxEmpty: readBack.outboxRows === 0,
          fullPayloadRoundTripVerified: readBack.payloadHashesVerified === readBack.rowCount && readBack.payloadHashMismatches.length === 0,
          promotedAuthorityManifestMatched: readBack.snapshotManifestHash === EXPECTED.snapshotManifestHash
        }
      };

      render(state.report);
      setStatus(pass
        ? `Cold-start local-only verification PASS. ${readBack.rowCount.toLocaleString()} persisted Canonical row(s) match the promoted Authority manifest; no write occurred.`
        : `Cold-start verification BLOCKED with ${blocking.length} issue(s). No write occurred.`, pass ? 'ok' : 'bad');
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
    $('canonical-mirror-cold-panel').classList.remove('hidden');
    $('canonical-mirror-cold-result').textContent = report.summary.pass ? 'PASS' : 'BLOCKED';
    $('canonical-mirror-cold-rows').textContent = report.summary.mirrorRows.toLocaleString();
    $('canonical-mirror-cold-hashes').textContent = report.summary.payloadHashesVerified.toLocaleString();
    $('canonical-mirror-cold-hash-mismatch').textContent = report.summary.payloadHashMismatches.toLocaleString();
    $('canonical-mirror-cold-key-mismatch').textContent = report.summary.rowKeyMismatches.toLocaleString();
    $('canonical-mirror-cold-outbox').textContent = report.summary.outboxRows.toLocaleString();
    $('canonical-mirror-cold-blocking').textContent = report.summary.blockingIssues.toLocaleString();
    $('canonical-mirror-cold-repeat').textContent = report.summary.repeatability ? 'PASS' : 'FAIL';
    $('canonical-mirror-cold-write').textContent = 'NO';
    $('canonical-mirror-cold-stored-hash').textContent = report.hashes.storedManifestHash || '—';
    $('canonical-mirror-cold-read-hash').textContent = report.hashes.readBackManifestHash || '—';
    const notes = $('canonical-mirror-cold-notes');
    notes.innerHTML = '';
    [...report.issues.blocking, ...report.issues.warnings].forEach(text => {
      const li = document.createElement('li'); li.textContent = text; notes.appendChild(li);
    });
    $('export-canonical-mirror-cold').disabled = false;
  }

  function renderError(error) {
    $('canonical-mirror-cold-panel').classList.remove('hidden');
    $('canonical-mirror-cold-result').textContent = 'BLOCKED';
    $('canonical-mirror-cold-blocking').textContent = '1';
    const notes = $('canonical-mirror-cold-notes');
    notes.innerHTML = '';
    const li = document.createElement('li'); li.textContent = error?.message || String(error); notes.appendChild(li);
    $('export-canonical-mirror-cold').disabled = true;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-local-mirror-cold-verify-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('canonical-mirror-cold-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    $('verify-canonical-mirror-cold').disabled = state.busy;
    $('export-canonical-mirror-cold').disabled = state.busy || !state.report;
  }

  function init() {
    $('verify-canonical-mirror-cold').addEventListener('click', run);
    $('export-canonical-mirror-cold').addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
