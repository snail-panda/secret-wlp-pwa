/* WLP v1.8.6.237 · Incremental ACTIVE v3 change-feed pull → local Canonical mirror.
   Reads server-owned wlp_sync_changes_v1 after the persisted local cursor and applies
   only the exact verified WID2876 state/event delta into wlp-cloud-v1 atomically.
   No Cloud write, localStorage write, live WLP write, or sync_outbox mutation occurs. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.237-cloud-v3-incremental-pull-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const CURSOR_KEY = 'sync_cursor';
  const CHANGE_TABLE = 'wlp_sync_changes_v1';
  const PARENT = Object.freeze({
    key: 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283',
    head: 2,
    manifest: 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3',
    rows: 21424
  });
  const TARGET = Object.freeze({
    key: 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    head: 3,
    manifest: '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',
    rows: 21425,
    migrationVersion: '3'
  });
  const ACTION_ID = 'e260e218-3202-5244-9f05-a620cb3dd6bd';
  const STATE_MUTATION = 'ff223731-ac0c-5dd7-9399-0d71b5ba1582';
  const EVENT_MUTATION = 'fe5a8572-ea64-549c-ab82-6d3034d3b8f3';
  const STATE_ROW = 'ea2f787b-41fe-5446-bbff-49c0c6ed73e2';
  const EVENT_ROW = 'bd5bd586-4b12-57a9-a837-61174d3cd5a2';
  const PARENT_STATE_HASH = '8cd514ac677e859b38aa7d5c31991e81cc717e45a0906cb9b2c573fdf528d3b6';
  const TARGET_STATE_HASH = 'a3ed7a424a5b53a172a4a02d0ad17591a106fe74a6bdf03017445e3e054ff399';
  const TARGET_EVENT_HASH = '81e8523bcb9a30f6c59aee20f684d69c4a874d0438f6922504501e705218fff1';
  const EXPECTED_FIRST_SEEN = '2026-09-26T21:44:15.400Z';
  const EXPECTED_CHANGE_MAX = 2;
  const CANONICAL_TABLES = Object.freeze([
    'cards','card_content','card_learning_metadata','learning_situations','learning_alternatives',
    'learning_alternative_situations','card_classification','learning_sessions','learning_events',
    'learning_state','learner_profile','learner_route_state','study_contexts','study_context_cards',
    'study_builds','study_build_cards','user_preferences'
  ]);

  const $ = id => document.getElementById(id);
  const state = { busy: false, report: null };
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableValue(value[key]); });
      return out;
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(stableValue(value)); }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
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
  function api() {
    const helper = window.WLPCloudShadowSupabase;
    if (!helper?.ensureSession || !helper?.fetchPaged) throw new Error('Supabase Shadow helper unavailable. Reload Cloud Shadow.');
    return helper;
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      let upgrading = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => { upgrading = true; };
      request.onsuccess = () => {
        const db = request.result;
        if (upgrading) { db.close(); reject(new Error('wlp-cloud-v1 is not installed at schema v1.')); return; }
        const required = [...CANONICAL_TABLES, META_STORE, OUTBOX_STORE];
        const missing = required.filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) { db.close(); reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}`)); return; }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open wlp-cloud-v1.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab. Close other WLP tabs and retry.'));
    });
  }
  async function getMeta(db, key) {
    const tx = db.transaction(META_STORE, 'readonly');
    const value = await requestPromise(tx.objectStore(META_STORE).get(key));
    await transactionDone(tx);
    return value || null;
  }
  async function getRow(db, storeName, rowKey) {
    const tx = db.transaction(storeName, 'readonly');
    const value = await requestPromise(tx.objectStore(storeName).get(rowKey));
    await transactionDone(tx);
    return value || null;
  }
  async function countStore(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const value = await requestPromise(tx.objectStore(storeName).count());
    await transactionDone(tx);
    return Number(value || 0);
  }
  async function fetchHead(helper) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_heads',
      'candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Expected one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }
  async function fetchCandidate(helper) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,status,canonical_row_count,snapshot_manifest_hash,table_counts,table_manifest_hashes,cutover_ticket_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,diagnostics',
      `candidate_key=eq.${encodeURIComponent(TARGET.key)}`
    );
    if (rows.length !== 1) throw new Error(`Expected exact v3 candidate metadata, found ${rows.length}.`);
    return rows[0];
  }
  async function fetchChangesAfter(helper, cursor) {
    return helper.fetchPaged(
      CHANGE_TABLE,
      'change_seq,candidate_key,head_version,table_name,row_key,operation,changed_fields,mutation_id,action_id,device_key,payload_hash,server_at',
      `change_seq=gt.${Number(cursor || 0)}&order=change_seq.asc`
    );
  }
  async function fetchCandidateRow(helper, tableName, rowKey) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(TARGET.key)}&table_name=eq.${encodeURIComponent(tableName)}&row_key=eq.${encodeURIComponent(rowKey)}`
    );
    if (rows.length !== 1) throw new Error(`Expected one ${tableName}|${rowKey} target row, found ${rows.length}.`);
    return rows[0];
  }
  async function verifyTargetRow(row, expectedHash) {
    const actual = await sha256(stableStringify(row?.payload));
    if (String(row?.payload_hash || '') !== expectedHash || actual !== expectedHash) {
      throw new Error(`${row?.table_name || 'target'} payload hash mismatch.`);
    }
  }
  async function fingerprintMirror(db) {
    const rows = [];
    const tableCounts = {};
    for (const storeName of CANONICAL_TABLES) {
      const tx = db.transaction(storeName, 'readonly');
      const items = await requestPromise(tx.objectStore(storeName).getAll());
      await transactionDone(tx);
      tableCounts[storeName] = items.length;
      for (const item of items) rows.push({
        tableName: storeName,
        rowKey: String(item.rowKey),
        tombstone: Boolean(item.tombstone),
        payloadHash: String(item.payloadHash)
      });
    }
    rows.sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    return { rowCount: rows.length, tableCounts, manifestHash: await sha256(stableStringify(rows)) };
  }
  function metaState(meta) {
    if (!meta) return 'MISSING';
    if (String(meta.candidateKey || '') === PARENT.key && Number(meta.headVersion || 0) === PARENT.head && String(meta.snapshotManifestHash || '') === PARENT.manifest && Number(meta.canonicalRowCount || 0) === PARENT.rows) return 'V2';
    if (String(meta.candidateKey || '') === TARGET.key && Number(meta.headVersion || 0) === TARGET.head && String(meta.snapshotManifestHash || '') === TARGET.manifest && Number(meta.canonicalRowCount || 0) === TARGET.rows) return 'V3';
    return 'OTHER';
  }
  async function applyIncremental(db, stateRow, eventRow, beforeMeta, candidate, cursorValue, appliedAt) {
    const nextMeta = {
      ...beforeMeta,
      candidateKey: TARGET.key,
      headVersion: TARGET.head,
      previousCandidateKey: PARENT.key,
      snapshotManifestHash: TARGET.manifest,
      canonicalRowCount: TARGET.rows,
      namespaceUuid: candidate.namespace_uuid,
      migrationVersion: String(candidate.migration_version || TARGET.migrationVersion),
      cardMappingHash: candidate.card_mapping_hash,
      coreLibraryHash: candidate.core_library_hash,
      cutoverTicketHash: candidate.cutover_ticket_hash,
      authorityRevision: 3,
      revisedAt: appliedAt,
      revisionSource: 'wlp_sync_changes_v1-incremental-pull',
      lastSyncCursor: cursorValue,
      lastSuccessfulSyncAt: appliedAt
    };
    const cursorMeta = {
      key: CURSOR_KEY,
      lastSyncCursor: cursorValue,
      lastSuccessfulSyncAt: appliedAt,
      candidateKey: TARGET.key,
      headVersion: TARGET.head,
      snapshotManifestHash: TARGET.manifest
    };
    const tx = db.transaction(['learning_state', 'learning_events', META_STORE], 'readwrite');
    tx.objectStore('learning_state').put({ rowKey: STATE_ROW, payloadHash: TARGET_STATE_HASH, tombstone: Boolean(stateRow.tombstone), payload: clone(stateRow.payload) });
    tx.objectStore('learning_events').put({ rowKey: EVENT_ROW, payloadHash: TARGET_EVENT_HASH, tombstone: Boolean(eventRow.tombstone), payload: clone(eventRow.payload) });
    tx.objectStore(META_STORE).put(nextMeta);
    tx.objectStore(META_STORE).put(cursorMeta);
    await transactionDone(tx);
    return { nextMeta, cursorMeta };
  }
  function setText(id, value) { const el = $(id); if (el) el.textContent = String(value ?? '—'); }
  function renderProof(checks) {
    const body = $('cloud-v3-pull-proof-body'); if (!body) return; body.innerHTML = '';
    for (const check of checks || []) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${String(check.name || '')}</td><td><strong>${check.pass ? 'PASS' : 'FAIL'}</strong></td><td>${String(check.evidence || '')}</td>`;
      body.appendChild(tr);
    }
  }
  function renderNotes(report) {
    const ul = $('cloud-v3-pull-notes'); if (!ul) return; ul.innerHTML = '';
    for (const note of [...(report?.issues?.blocking || []), ...(report?.issues?.warnings || [])]) {
      const li = document.createElement('li'); li.textContent = String(note); ul.appendChild(li);
    }
  }
  function render(report) {
    const summary = report?.summary || {};
    setText('cloud-v3-pull-result', summary.pass ? 'PASS' : (summary.blockingIssues ? 'CHECK' : '—'));
    setText('cloud-v3-pull-before', report?.before?.mirrorState || '—');
    setText('cloud-v3-pull-changes', summary.changeRowsPulled ?? 0);
    setText('cloud-v3-pull-written', summary.canonicalRowsWritten ?? 0);
    setText('cloud-v3-pull-cursor', `${summary.cursorBefore ?? '?'} → ${summary.cursorAfter ?? '?'}`);
    setText('cloud-v3-pull-after', report?.after?.mirrorState || '—');
    setText('cloud-v3-pull-state', report?.targetRows?.learningState?.reviewLevel || '—');
    setText('cloud-v3-pull-event', report?.targetRows?.learningEvent?.eventType || '—');
    setText('cloud-v3-pull-blocking', summary.blockingIssues || 0);
    setText('cloud-v3-pull-manifest', report?.after?.snapshotManifestHash || '');
    renderProof(report?.checks || []); renderNotes(report);
    const status = $('cloud-v3-pull-status');
    if (status) {
      status.textContent = summary.pass
        ? `PASS · local Canonical mirror is v3 at cursor ${summary.cursorAfter}; exact retry found ${summary.retryChangeRows} new change(s). Progress reader files in this patch accept both v2 and v3.`
        : `CHECK · ${(report?.issues?.blocking || []).join(' ')}`;
      status.className = `status-line ${summary.pass ? 'success' : 'error'}`;
    }
    const exportButton = $('export-cloud-v3-pull'); if (exportButton) exportButton.disabled = !report;
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    const runButton = $('run-cloud-v3-pull'); const exportButton = $('export-cloud-v3-pull');
    if (runButton) runButton.disabled = true; if (exportButton) exportButton.disabled = true;
    $('cloud-v3-pull-panel')?.classList.remove('hidden'); setText('cloud-v3-pull-result', 'RUNNING');
    const status = $('cloud-v3-pull-status'); if (status) { status.textContent = 'Reading the local cursor, pulling ordered server changes, and verifying the exact ACTIVE v3 target before any IndexedDB write…'; status.className = 'status-line'; }
    let db = null;
    try {
      const helper = api(); const session = await helper.ensureSession();
      db = await openDb();
      const beforeMeta = await getMeta(db, META_KEY); const cursorMeta = await getMeta(db, CURSOR_KEY);
      const beforeState = metaState(beforeMeta); const cursorBefore = Number(cursorMeta?.lastSyncCursor ?? beforeMeta?.lastSyncCursor ?? 0);
      const outboxBefore = await countStore(db, OUTBOX_STORE);
      if (!beforeMeta) throw new Error('authority_mirror metadata missing.');
      if (outboxBefore !== 0) throw new Error(`Expected clean local sync_outbox; found ${outboxBefore}.`);
      if (!['V2','V3'].includes(beforeState)) throw new Error(`Local Canonical mirror is ${beforeState}; expected exact v2 parent or v3 target.`);
      if (beforeState === 'V2' && cursorBefore !== 0) throw new Error(`Exact v2 parent requires initial sync cursor 0; found ${cursorBefore}.`);
      if (beforeState === 'V3' && cursorBefore !== EXPECTED_CHANGE_MAX) throw new Error(`Exact v3 mirror requires sync cursor ${EXPECTED_CHANGE_MAX}; found ${cursorBefore}.`);

      const head = await fetchHead(helper); const candidate = await fetchCandidate(helper);
      if (String(head.candidate_key) !== TARGET.key || Number(head.head_version) !== TARGET.head || String(head.previous_candidate_key) !== PARENT.key || String(head.snapshot_manifest_hash) !== TARGET.manifest || Number(head.canonical_row_count) !== TARGET.rows) throw new Error('ACTIVE Cloud Authority is not the exact verified v3 target.');
      if (String(candidate.status) !== 'verified' || String(candidate.candidate_key) !== TARGET.key || String(candidate.snapshot_manifest_hash) !== TARGET.manifest || Number(candidate.canonical_row_count) !== TARGET.rows) throw new Error('Verified v3 candidate metadata mismatch.');

      const changes = await fetchChangesAfter(helper, cursorBefore);
      let stateChange = null, eventChange = null, stateRow = null, eventRow = null;
      let canonicalRowsWritten = 0, writePerformed = false;
      if (beforeState === 'V2') {
        stateChange = changes.find(row => Number(row.change_seq) === 1 && row.mutation_id === STATE_MUTATION && row.table_name === 'learning_state' && row.row_key === STATE_ROW && row.operation === 'upsert');
        eventChange = changes.find(row => Number(row.change_seq) === 2 && row.mutation_id === EVENT_MUTATION && row.table_name === 'learning_events' && row.row_key === EVENT_ROW && row.operation === 'append');
        if (changes.length !== 2 || !stateChange || !eventChange || changes.some(row => String(row.candidate_key) !== TARGET.key || Number(row.head_version) !== TARGET.head || String(row.action_id) !== ACTION_ID)) throw new Error(`Expected exact change_seq 1 → 2 for the v3 action; received ${changes.length} row(s).`);
        if (String(stateChange.payload_hash) !== TARGET_STATE_HASH || String(eventChange.payload_hash) !== TARGET_EVENT_HASH) throw new Error('Change-feed payload hash proof mismatch.');
        const localParentState = await getRow(db, 'learning_state', STATE_ROW); const localEventBefore = await getRow(db, 'learning_events', EVENT_ROW);
        if (!localParentState || String(localParentState.payloadHash) !== PARENT_STATE_HASH || String(localParentState.payload?.review_level || '') !== 'high') throw new Error('Local v2 WID2876 parent row is not the exact guarded High-attention base.');
        if (localEventBefore) throw new Error('Target attention_set event already exists before v3 apply.');

        [stateRow, eventRow] = await Promise.all([
          fetchCandidateRow(helper, 'learning_state', STATE_ROW),
          fetchCandidateRow(helper, 'learning_events', EVENT_ROW)
        ]);
        await verifyTargetRow(stateRow, TARGET_STATE_HASH); await verifyTargetRow(eventRow, TARGET_EVENT_HASH);
        if (String(stateRow.payload?.review_level || '') !== 'medium' || String(stateRow.payload?.first_seen_at || '') !== EXPECTED_FIRST_SEEN) throw new Error('Target WID2876 state payload does not preserve Medium + exact firstSeen.');
        if (String(eventRow.payload?.event_type || '') !== 'attention_set') throw new Error('Target event payload is not attention_set.');
        const appliedAt = new Date().toISOString();
        await applyIncremental(db, stateRow, eventRow, beforeMeta, candidate, EXPECTED_CHANGE_MAX, appliedAt);
        canonicalRowsWritten = 2; writePerformed = true;
      } else {
        if (changes.length !== 0) throw new Error(`Already-v3 mirror unexpectedly sees ${changes.length} change(s) after cursor ${cursorBefore}.`);
      }

      const afterMeta = await getMeta(db, META_KEY); const afterCursorMeta = await getMeta(db, CURSOR_KEY); const afterState = metaState(afterMeta);
      const cursorAfter = Number(afterCursorMeta?.lastSyncCursor ?? afterMeta?.lastSyncCursor ?? 0);
      const outboxAfter = await countStore(db, OUTBOX_STORE);
      const [localState, localEvent, mirrorProof] = await Promise.all([
        getRow(db, 'learning_state', STATE_ROW), getRow(db, 'learning_events', EVENT_ROW), fingerprintMirror(db)
      ]);
      const targetStateHashVerified = localState ? await sha256(stableStringify(localState.payload)) === TARGET_STATE_HASH && String(localState.payloadHash) === TARGET_STATE_HASH : false;
      const targetEventHashVerified = localEvent ? await sha256(stableStringify(localEvent.payload)) === TARGET_EVENT_HASH && String(localEvent.payloadHash) === TARGET_EVENT_HASH : false;
      const tableCountsExact = Object.entries(candidate.table_counts || {}).every(([name, count]) => Number(mirrorProof.tableCounts[name] || 0) === Number(count || 0)) && Object.keys(mirrorProof.tableCounts).every(name => Number(candidate.table_counts?.[name] || 0) === Number(mirrorProof.tableCounts[name] || 0));
      const retryChanges = await fetchChangesAfter(helper, cursorAfter);
      const blocking = [];
      if (!session?.userId) blocking.push('Authenticated Supabase user missing.');
      if (afterState !== 'V3') blocking.push(`Local mirror metadata is ${afterState}, expected V3.`);
      if (cursorAfter !== EXPECTED_CHANGE_MAX) blocking.push(`Local sync cursor is ${cursorAfter}, expected ${EXPECTED_CHANGE_MAX}.`);
      if (mirrorProof.rowCount !== TARGET.rows) blocking.push(`Local mirror row count is ${mirrorProof.rowCount}, expected ${TARGET.rows}.`);
      if (mirrorProof.manifestHash !== TARGET.manifest) blocking.push('Local mirror manifest does not match ACTIVE v3.');
      if (!tableCountsExact) blocking.push('Local mirror table counts do not match verified v3 candidate metadata.');
      if (!targetStateHashVerified || String(localState?.payload?.review_level || '') !== 'medium' || String(localState?.payload?.first_seen_at || '') !== EXPECTED_FIRST_SEEN) blocking.push('Local WID2876 state is not exact v3 Medium + preserved firstSeen.');
      if (!targetEventHashVerified || String(localEvent?.payload?.event_type || '') !== 'attention_set') blocking.push('Local attention_set event does not match exact v3 target.');
      if (outboxAfter !== outboxBefore) blocking.push(`Local sync_outbox changed ${outboxBefore} → ${outboxAfter}.`);
      if (retryChanges.length !== 0) blocking.push(`Exact retry after cursor ${cursorAfter} returned ${retryChanges.length} new change(s).`);

      const checks = [
        ['ACTIVE Cloud Authority is exact v3', true, `${head.candidate_key} · head ${head.head_version}`],
        ['Ordered change feed consumed from local cursor', beforeState === 'V3' || (changes.length === 2 && Number(changes[0].change_seq) === 1 && Number(changes[1].change_seq) === 2), beforeState === 'V3' ? `already at cursor ${cursorBefore}` : 'seq 1 → 2'],
        ['Exactly two Canonical rows applied on first pull', beforeState === 'V3' || canonicalRowsWritten === 2, `${canonicalRowsWritten} row write(s)`],
        ['Local full mirror equals ACTIVE v3 manifest', mirrorProof.manifestHash === TARGET.manifest && mirrorProof.rowCount === TARGET.rows, `${mirrorProof.rowCount} rows · ${mirrorProof.manifestHash}`],
        ['WID2876 is Medium with explicit firstSeen preserved', targetStateHashVerified && String(localState?.payload?.review_level || '') === 'medium' && String(localState?.payload?.first_seen_at || '') === EXPECTED_FIRST_SEEN, `${localState?.payload?.review_level || 'missing'} · ${localState?.payload?.first_seen_at || 'missing'}`],
        ['attention_set learning_event is present', targetEventHashVerified && String(localEvent?.payload?.event_type || '') === 'attention_set', EVENT_ROW],
        ['Sync cursor advanced only after atomic local commit', cursorAfter === EXPECTED_CHANGE_MAX, `${cursorBefore} → ${cursorAfter}`],
        ['Exact retry pulls zero new changes', retryChanges.length === 0, `${retryChanges.length} row(s) after cursor ${cursorAfter}`],
        ['Local outbox remains untouched', outboxBefore === outboxAfter, `${outboxBefore} → ${outboxAfter}`]
      ].map(([name, pass, evidence]) => ({ name, pass: Boolean(pass), evidence: String(evidence) }));

      state.report = {
        format: 'WLP_CANONICAL_CLOUD_V3_INCREMENTAL_LOCAL_PULL', version: 1, appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(), mode: 'ordered-change-feed-to-atomic-local-canonical-mirror-apply',
        device: { deviceKey: beforeMeta.deviceKey || null, platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'iPhone Safari/WebKit' : 'Windows Browser' },
        authority: { candidateKey: head.candidate_key, headVersion: Number(head.head_version), previousCandidateKey: head.previous_candidate_key, snapshotManifestHash: head.snapshot_manifest_hash, canonicalRows: Number(head.canonical_row_count) },
        before: { mirrorState: beforeState, candidateKey: beforeMeta.candidateKey || null, headVersion: Number(beforeMeta.headVersion || 0), snapshotManifestHash: beforeMeta.snapshotManifestHash || null, cursor: cursorBefore, outboxRows: outboxBefore },
        summary: { authenticated: Boolean(session?.userId), changeRowsPulled: changes.length, canonicalRowsWritten, writePerformed, cursorBefore, cursorAfter, mirrorRows: mirrorProof.rowCount, mirrorManifestMatch: mirrorProof.manifestHash === TARGET.manifest, stateLevel: String(localState?.payload?.review_level || ''), eventPresent: Boolean(localEvent), firstSeenPreserved: String(localState?.payload?.first_seen_at || '') === EXPECTED_FIRST_SEEN, retryChangeRows: retryChanges.length, retryIdempotent: retryChanges.length === 0, outboxRowsBefore: outboxBefore, outboxRowsAfter: outboxAfter, blockingIssues: blocking.length, nextPhaseEligible: blocking.length === 0, pass: blocking.length === 0 },
        pulledChanges: clone(changes),
        after: { mirrorState: afterState, candidateKey: afterMeta?.candidateKey || null, headVersion: Number(afterMeta?.headVersion || 0), snapshotManifestHash: mirrorProof.manifestHash, canonicalRows: mirrorProof.rowCount, cursor: cursorAfter, outboxRows: outboxAfter },
        targetRows: { learningState: { rowKey: STATE_ROW, payloadHash: localState?.payloadHash || null, reviewLevel: localState?.payload?.review_level || null, firstSeenAt: localState?.payload?.first_seen_at || null, revision: localState?.payload?.revision ?? null }, learningEvent: { rowKey: EVENT_ROW, payloadHash: localEvent?.payloadHash || null, eventType: localEvent?.payload?.event_type || null, sourceStream: localEvent?.payload?.source_stream || null, occurredAt: localEvent?.payload?.occurred_at || null } },
        syncCursor: clone(afterCursorMeta), checks,
        issues: { blocking, warnings: ['This step performs the first incremental Cloud → local Canonical mirror apply using the ordered v1 change feed. It writes only wlp-cloud-v1 learning_state, learning_events, and sync_meta.', 'No localStorage, live Study/Review write, Cloud write, or sync_outbox mutation occurs.', 'The bundled Compatibility Adapter / Storage Facade / Progress read path accepts both exact v2 and exact v3 mirrors so Progress does not regress when the mirror advances.'] },
        invariants: { cloudReadsOnly: true, indexedDbWritesRestrictedToCanonicalMirrorAndSyncMeta: true, noLocalStorageWrites: true, noLiveWlpWrites: true, noLocalOutboxWrites: outboxBefore === outboxAfter, cursorAdvancesAfterAtomicCommit: cursorAfter === EXPECTED_CHANGE_MAX, fullV3ManifestMatched: mirrorProof.manifestHash === TARGET.manifest, exactRetryIdempotent: retryChanges.length === 0, noConflictAutoOverwrite: true }
      };
      render(state.report);
    } catch (error) {
      const message = error?.message || String(error);
      state.report = { format: 'WLP_CANONICAL_CLOUD_V3_INCREMENTAL_LOCAL_PULL', version: 1, appVersion: APP_VERSION, generatedAt: new Date().toISOString(), mode: 'ordered-change-feed-to-atomic-local-canonical-mirror-apply', summary: { blockingIssues: 1, nextPhaseEligible: false, pass: false }, checks: [], issues: { blocking: [message], warnings: ['No fallback write is performed when the incremental pull/apply safety gate blocks.'] }, invariants: { noLocalStorageWrites: true, noLiveWlpWrites: true, noCloudWrites: true } };
      render(state.report);
    } finally {
      try { db?.close(); } catch {}
      state.busy = false; if (runButton) runButton.disabled = false; if (exportButton) exportButton.disabled = !state.report;
    }
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `wlp-canonical-cloud-v3-local-pull-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function init() {
    $('run-cloud-v3-pull')?.addEventListener('click', run);
    $('export-cloud-v3-pull')?.addEventListener('click', exportReport);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
