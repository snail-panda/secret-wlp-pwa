/* WLP v1.8.6.215 — FirstSeen Preservation / Authority v2 Preflight.
   Targeted read-only repair planning for the live-shadow firstSeen regression.
   Reads the verified local Canonical mirror, ACTIVE Authority metadata, and the
   two source staging snapshots. It projects an explicit learning_state.first_seen_at
   (earliest non-zero source evidence) and computes a deterministic next Authority
   manifest in memory. No Cloud, IndexedDB, localStorage, or live WLP write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.215-first-seen-preservation-preflight-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const META_KEY = 'authority_mirror';
  const HASH_BATCH = 128;
  const CANONICAL_TABLES = Object.freeze([
    'cards','card_content','card_learning_metadata','learning_situations','learning_alternatives',
    'learning_alternative_situations','card_classification','learning_sessions','learning_events',
    'learning_state','learner_profile','learner_route_state','study_contexts','study_context_cards',
    'study_builds','study_build_cards','user_preferences'
  ]);
  const state = { busy: false, report: null };

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableValue(value[key]); });
      return out;
    }
    return value;
  }
  const stableStringify = value => JSON.stringify(stableValue(value));
  const identity = (tableName, rowKey) => `${tableName}\u0000${rowKey}`;
  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
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
  function iso(ms) { return ms > 0 ? new Date(ms).toISOString() : null; }
  function safeParse(raw, fallback) { try { return raw == null || raw === '' ? fallback : JSON.parse(raw); } catch { return fallback; } }

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
  function openExistingMirror() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        try { request.transaction.abort(); } catch {}
        reject(new Error('wlp-cloud-v1 is not installed. Run the verified Canonical Mirror bootstrap first.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        const missing = [...CANONICAL_TABLES, META_STORE].filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) { db.close(); reject(new Error(`wlp-cloud-v1 schema mismatch: missing ${missing.join(', ')}.`)); return; }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open wlp-cloud-v1.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));
    });
  }
  async function getAll(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const rows = await requestPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return rows || [];
  }
  async function getMeta(db) {
    const tx = db.transaction(META_STORE, 'readonly');
    const meta = await requestPromise(tx.objectStore(META_STORE).get(META_KEY));
    await transactionDone(tx);
    return meta || null;
  }
  async function readMirror(db) {
    const byTable = {};
    const fingerprints = [];
    for (const tableName of CANONICAL_TABLES) {
      const rows = await getAll(db, tableName);
      byTable[tableName] = rows;
      rows.forEach(row => fingerprints.push({ tableName, rowKey: String(row.rowKey), tombstone: Boolean(row.tombstone), payloadHash: String(row.payloadHash) }));
    }
    fingerprints.sort((a,b) => identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    return { byTable, fingerprints, meta: await getMeta(db) };
  }
  async function manifestProof(fingerprints) {
    const rows = [...fingerprints].sort((a,b) => identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    const tableCounts = {};
    rows.forEach(row => { tableCounts[row.tableName] = (tableCounts[row.tableName] || 0) + 1; });
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(rows.filter(row => row.tableName === tableName)));
    }
    return { rowCount: rows.length, snapshotManifestHash: await sha256(stableStringify(rows)), tableCounts, tableManifestHashes };
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged('wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc');
    if (rows.length !== 1) throw new Error(`Expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }
  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged('wlp_canonical_authority_candidates',
      'candidate_key,status,migration_version,namespace_uuid,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`);
    if (rows.length !== 1) throw new Error(`Expected one ACTIVE candidate metadata row, found ${rows.length}.`);
    return rows[0];
  }
  function compareObjects(expected, actual, label, blocking) {
    const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
    [...keys].sort().forEach(key => {
      if (String(expected?.[key] ?? '') !== String(actual?.[key] ?? '')) {
        blocking.push(`${label} mismatch for ${key}: expected ${expected?.[key] ?? '(missing)'}, got ${actual?.[key] ?? '(missing)'}.`);
      }
    });
  }

  async function fetchSourceLearningState(api, source) {
    return api.fetchPaged('wlp_canonical_stage_records',
      'device_key,stage_key,table_name,row_key,payload_hash,tombstone,payload',
      `device_key=eq.${encodeURIComponent(source.device_key)}&stage_key=eq.${encodeURIComponent(source.stage_key)}&table_name=eq.learning_state&order=row_key.asc`);
  }
  async function verifySourceRows(rows) {
    let verified = 0;
    const mismatches = [];
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const computed = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      computed.forEach((hash, index) => {
        const row = batch[index];
        if (hash === row.payload_hash) verified += 1;
        else mismatches.push(`${row.device_key}|${row.stage_key}|${row.row_key}: ${row.payload_hash} != ${hash}`);
      });
    }
    return { verified, mismatches };
  }
  function sourceFirstSeen(payload) {
    return toMs(payload?.first_seen_at ?? payload?.firstSeen ?? payload?.source_snapshot?.firstSeen ?? payload?.source_snapshot?.first_seen_at);
  }
  function readLegacyProgress() {
    const out = [];
    const prefix = 'fc:wordid:';
    for (let i=0;i<localStorage.length;i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const payload = safeParse(localStorage.getItem(key), {});
      const wordId = clean(payload.wordId || key.slice(prefix.length));
      if (!wordId) continue;
      out.push({ wordId, firstSeen: toMs(payload.firstSeen ?? payload.first_seen_at) });
    }
    return out;
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
    setStatus('Reading ACTIVE Authority metadata, verified source stages, and the installed mirror…', '');
    let db;
    try {
      const api = window.WLPCloudShadowSupabase;
      if (!api?.fetchPaged || !api?.ensureSession) throw new Error('Supabase read transport is unavailable. Reload Cloud Shadow.');
      await api.ensureSession();
      const [head] = await Promise.all([fetchHead(api)]);
      const candidate = await fetchCandidate(api, head.candidate_key);
      if (candidate.status !== 'verified') throw new Error(`ACTIVE candidate status is ${candidate.status || '(missing)'}, expected verified.`);
      const sources = Array.isArray(candidate.source_devices) ? candidate.source_devices : [];
      if (sources.length < 2) throw new Error(`Expected at least two verified Authority source devices, found ${sources.length}.`);

      db = await openExistingMirror();
      const mirror = await readMirror(db);
      const activeProof = await manifestProof(mirror.fingerprints);
      const blocking = [];
      if (!mirror.meta) blocking.push('Canonical mirror metadata is missing.');
      if (head.candidate_key !== candidate.candidate_key) blocking.push('ACTIVE Head candidate key does not match candidate metadata.');
      if (head.snapshot_manifest_hash !== candidate.snapshot_manifest_hash) blocking.push('ACTIVE Head manifest does not match candidate metadata.');
      if (Number(head.canonical_row_count || 0) !== Number(candidate.canonical_row_count || 0)) blocking.push('ACTIVE Head row count does not match candidate metadata.');
      if (String(head.migration_version || '') !== String(candidate.migration_version || '')) blocking.push('ACTIVE Head migration version does not match candidate metadata.');
      if (activeProof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Installed mirror fingerprint manifest does not match ACTIVE Authority Head.');
      if (Number(activeProof.rowCount) !== Number(head.canonical_row_count || 0)) blocking.push(`Mirror row count ${activeProof.rowCount} does not match ACTIVE Authority ${head.canonical_row_count}.`);
      if (mirror.meta?.candidateKey !== head.candidate_key) blocking.push('Mirror candidate key does not match ACTIVE Authority Head.');
      if (mirror.meta?.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Mirror metadata manifest does not match ACTIVE Authority Head.');
      compareObjects(candidate.table_counts || {}, activeProof.tableCounts, 'ACTIVE table count', blocking);
      compareObjects(candidate.table_manifest_hashes || {}, activeProof.tableManifestHashes, 'ACTIVE table manifest', blocking);

      const sourceRowsBySource = [];
      for (const source of sources) {
        const rows = await fetchSourceLearningState(api, source);
        const check = await verifySourceRows(rows);
        if (check.mismatches.length) blocking.push(`${check.mismatches.length} source-stage learning_state payload hash mismatch(es) for ${source.device_key}.`);
        sourceRowsBySource.push({ source, rows, check });
      }
      const allSourceRows = sourceRowsBySource.flatMap(item => item.rows);
      const evidenceByCard = new Map();
      for (const row of allSourceRows) {
        if (row.tombstone) continue;
        const ms = sourceFirstSeen(row.payload);
        const list = evidenceByCard.get(String(row.row_key)) || [];
        list.push({ deviceKey: row.device_key, stageKey: row.stage_key, ms, iso: iso(ms) });
        evidenceByCard.set(String(row.row_key), list);
      }

      const activeStates = mirror.byTable.learning_state || [];
      const cards = mirror.byTable.cards || [];
      const wordIdByCard = new Map(cards.map(row => {
        const legacy = clean(row.payload?.legacy_key);
        const wordId = legacy.startsWith('wid:') ? clean(legacy.slice(4)) : '';
        return [String(row.rowKey), wordId];
      }));
      const projectedStateByCard = new Map();
      const evidenceSummary = [];
      let evidenceCoverage = 0, activeSnapshotMissing = 0, sourceDisagreements = 0, changedRows = 0;
      const missingEvidence = [];

      for (const row of activeStates) {
        const rowKey = String(row.rowKey);
        const evidence = (evidenceByCard.get(rowKey) || []).filter(item => item.ms > 0);
        const unique = [...new Set(evidence.map(item => item.ms))].sort((a,b)=>a-b);
        const selected = unique[0] || 0;
        if (selected) evidenceCoverage += 1; else missingEvidence.push(rowKey);
        if (!row.payload?.source_snapshot) activeSnapshotMissing += 1;
        if (unique.length > 1) sourceDisagreements += 1;
        const projected = clone(row.payload || {});
        if (selected) projected.first_seen_at = iso(selected);
        const currentExplicit = toMs(row.payload?.first_seen_at);
        const changed = selected > 0 && currentExplicit !== selected;
        if (changed) changedRows += 1;
        projectedStateByCard.set(rowKey, { payload: projected, selected, evidence, unique, changed });
        evidenceSummary.push({ rowKey, wordId: wordIdByCard.get(rowKey) || '', selected, unique, sourceVariantCount: evidence.length, activeHasSourceSnapshot: Boolean(row.payload?.source_snapshot) });
      }
      if (missingEvidence.length) blocking.push(`${missingEvidence.length} active learning_state row(s) have no non-zero source firstSeen evidence.`);

      const projectedFingerprints = [];
      for (const tableName of CANONICAL_TABLES) {
        for (const row of mirror.byTable[tableName] || []) {
          if (tableName === 'learning_state') {
            const projected = projectedStateByCard.get(String(row.rowKey));
            const payloadHash = projected?.changed ? await sha256(stableStringify(projected.payload)) : String(row.payloadHash);
            projectedFingerprints.push({ tableName, rowKey: String(row.rowKey), tombstone: Boolean(row.tombstone), payloadHash });
          } else {
            projectedFingerprints.push({ tableName, rowKey: String(row.rowKey), tombstone: Boolean(row.tombstone), payloadHash: String(row.payloadHash) });
          }
        }
      }
      const projectedProof = await manifestProof(projectedFingerprints);
      if (projectedProof.rowCount !== activeProof.rowCount) blocking.push('Projected Authority row count changed unexpectedly.');
      if (changedRows > 0 && projectedProof.snapshotManifestHash === activeProof.snapshotManifestHash) blocking.push('Projected payload changes did not change the Authority manifest.');

      const facadeProvider = window.WLPCanonicalStorageCompatibilityFacade;
      let currentFacade = null;
      if (facadeProvider?.open) currentFacade = await facadeProvider.open();
      const localRows = readLegacyProgress();
      const currentByWord = new Map((currentFacade?.readProgressRecords?.() || []).map(row => [clean(row.wordId), row]));
      const proposedFirstByWord = new Map(evidenceSummary.filter(row => row.wordId).map(row => [row.wordId, row.selected]));
      const beforeRegressionIds = [], afterRegressionIds = [];
      for (const local of localRows) {
        if (!local.firstSeen) continue;
        const current = toMs(currentByWord.get(local.wordId)?.firstSeen);
        const proposed = toMs(proposedFirstByWord.get(local.wordId));
        if (current > local.firstSeen) beforeRegressionIds.push(local.wordId);
        if (proposed > local.firstSeen) afterRegressionIds.push(local.wordId);
      }
      if (afterRegressionIds.length) blocking.push(`${afterRegressionIds.length} current-device firstSeen regression(s) remain after the projected repair.`);

      const spot = evidenceSummary.find(row => row.wordId === '2876') || null;
      const local2876 = localRows.find(row => row.wordId === '2876') || null;
      const facade2876 = currentByWord.get('2876') || null;
      const sourceEvidence2876 = spot?.unique || [];
      const spotCheck = {
        wordId: '2876',
        cardId: spot?.rowKey || '',
        localFirstSeen: local2876?.firstSeen || 0,
        localFirstSeenIso: iso(local2876?.firstSeen || 0),
        currentFacadeFirstSeen: toMs(facade2876?.firstSeen),
        currentFacadeFirstSeenIso: iso(toMs(facade2876?.firstSeen)),
        sourceStageFirstSeenValues: sourceEvidence2876,
        sourceStageFirstSeenIsos: sourceEvidence2876.map(iso),
        projectedFirstSeen: spot?.selected || 0,
        projectedFirstSeenIso: iso(spot?.selected || 0)
      };

      const pass = blocking.length === 0;
      const nextPhaseEligible = pass && changedRows > 0 && projectedProof.snapshotManifestHash !== head.snapshot_manifest_hash;
      const warnings = [
        `${activeSnapshotMissing} active learning_state row(s) do not retain source_snapshot after merge materialization; explicit first_seen_at removes the need to reconstruct their earliest-seen time from later event history.`,
        sourceDisagreements ? `${sourceDisagreements} state row(s) have differing source-device firstSeen evidence; the projected merge rule uses the earliest non-zero timestamp.` : 'No cross-device firstSeen disagreements were found in the source stages.',
        `${changedRows} learning_state row(s) would receive explicit first_seen_at in a new Authority revision; no other table is modified.`,
        'This preflight is read-only. It does not commit a candidate, advance the Authority Head, rewrite the Canonical mirror, or change live WLP.'
      ];

      state.report = {
        format: 'WLP_CANONICAL_FIRST_SEEN_PRESERVATION_PREFLIGHT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-authority-v2-first-seen-preflight',
        device: { platform: platformLabel() },
        authority: {
          activeCandidateKey: head.candidate_key,
          activeHeadVersion: Number(head.head_version || 0),
          activeMigrationVersion: String(head.migration_version || ''),
          activeManifestHash: head.snapshot_manifest_hash,
          canonicalRows: Number(head.canonical_row_count || 0),
          sourceDevices: sources.map(item => ({ deviceKey: item.device_key, stageKey: item.stage_key }))
        },
        summary: {
          activeRows: activeProof.rowCount,
          activeLearningStateRows: activeStates.length,
          sourceStageStateRows: allSourceRows.length,
          firstSeenEvidenceRows: evidenceCoverage,
          mergedRowsWithoutSourceSnapshot: activeSnapshotMissing,
          sourceFirstSeenDisagreements: sourceDisagreements,
          currentDeviceRegressionsBefore: beforeRegressionIds.length,
          currentDeviceRegressionsAfter: afterRegressionIds.length,
          authorityRowsChanged: changedRows,
          projectedRows: projectedProof.rowCount,
          projectedMigrationVersion: '3',
          blockingIssues: blocking.length,
          nextPhaseEligible,
          pass
        },
        hashes: {
          activeManifestHash: activeProof.snapshotManifestHash,
          projectedManifestHash: projectedProof.snapshotManifestHash,
          activeLearningStateTableManifestHash: activeProof.tableManifestHashes.learning_state || '',
          projectedLearningStateTableManifestHash: projectedProof.tableManifestHashes.learning_state || ''
        },
        sourceAudit: {
          perSource: sourceRowsBySource.map(item => ({ deviceKey: item.source.device_key, stageKey: item.source.stage_key, rows: item.rows.length, payloadHashesVerified: item.check.verified, payloadHashMismatches: item.check.mismatches.length })),
          missingEvidenceRowKeys: missingEvidence,
          disagreementRows: evidenceSummary.filter(row => row.unique.length > 1).map(row => ({ rowKey: row.rowKey, wordId: row.wordId, values: row.unique, isos: row.unique.map(iso) }))
        },
        currentDevice: { localProgressRows: localRows.length, regressionWordIdsBefore: beforeRegressionIds, regressionWordIdsAfter: afterRegressionIds },
        spotCheck2876: spotCheck,
        issues: { blocking, warnings },
        invariants: {
          noCloudWrites: true,
          indexedDbReadOnly: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noLiveWlpWrites: true,
          activeAuthorityUnchanged: true,
          onlyLearningStateProjected: true,
          projectedRowCountUnchanged: projectedProof.rowCount === activeProof.rowCount,
          sourceStagePayloadHashesVerified: sourceRowsBySource.every(item => item.check.mismatches.length === 0),
          currentDeviceRegressionResolved: afterRegressionIds.length === 0
        }
      };
      render(state.report);
      setStatus(`FirstSeen preflight ${pass ? 'PASS' : 'BLOCKED'} · source evidence ${evidenceCoverage}/${activeStates.length} state rows · current-device regression ${beforeRegressionIds.length} → ${afterRegressionIds.length} · Authority rows changed ${changedRows} · projected manifest ${projectedProof.snapshotManifestHash.slice(0,12)}… · no writes.`, pass ? 'success' : 'error');
    } catch (error) {
      console.error('WLP FirstSeen Preservation Preflight:', error);
      state.report = null;
      setStatus(error?.message || String(error), 'error');
    } finally {
      try { db?.close(); } catch {}
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('first-seen-active-states').textContent = Number(s.activeLearningStateRows || 0).toLocaleString();
    $('first-seen-evidence').textContent = Number(s.firstSeenEvidenceRows || 0).toLocaleString();
    $('first-seen-merged-gap').textContent = Number(s.mergedRowsWithoutSourceSnapshot || 0).toLocaleString();
    $('first-seen-disagreement').textContent = Number(s.sourceFirstSeenDisagreements || 0).toLocaleString();
    $('first-seen-before-regressions').textContent = Number(s.currentDeviceRegressionsBefore || 0).toLocaleString();
    $('first-seen-after-regressions').textContent = Number(s.currentDeviceRegressionsAfter || 0).toLocaleString();
    $('first-seen-changed-rows').textContent = Number(s.authorityRowsChanged || 0).toLocaleString();
    $('first-seen-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('first-seen-preflight-result').textContent = s.pass ? 'PASS' : 'BLOCKED';
    $('first-seen-preflight-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('first-seen-projected-manifest').textContent = report.hashes?.projectedManifestHash || '—';

    const spot = report.spotCheck2876 || {};
    const tr = document.createElement('tr');
    [spot.localFirstSeenIso || '—', spot.currentFacadeFirstSeenIso || '—', (spot.sourceStageFirstSeenIsos || []).join(' / ') || '—', spot.projectedFirstSeenIso || '—'].forEach(value => {
      const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
    });
    const body = $('first-seen-2876-body'); body.innerHTML = ''; body.appendChild(tr);

    const notes = $('first-seen-preflight-notes'); notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No FirstSeen preservation issues detected.');
    values.forEach(value => { const li=document.createElement('li'); li.textContent=value; notes.appendChild(li); });
    $('first-seen-preflight-panel').classList.remove('hidden');
    $('export-first-seen-preflight').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-first-seen-preflight-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function setStatus(message, kind) {
    const el = $('first-seen-preflight-status'); if (!el) return;
    el.textContent = message; el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(busy) {
    state.busy = busy;
    const runButton = $('run-first-seen-preflight');
    if (runButton) { runButton.disabled = busy; runButton.textContent = busy ? 'Running FirstSeen preflight…' : 'Run FirstSeen Preservation Preflight'; }
  }
  $('run-first-seen-preflight')?.addEventListener('click', run);
  $('export-first-seen-preflight')?.addEventListener('click', exportReport);
  window.WLPCanonicalFirstSeenPreflight = Object.freeze({ run, getReport: () => clone(state.report) });
})();
