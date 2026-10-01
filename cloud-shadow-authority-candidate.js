/* WLP Canonical Authority Candidate v1.
   Commits the exact v201 preflight-verified merged Canonical payload set into
   isolated, inactive Cloud candidate tables, then reads every payload back and
   re-verifies hashes/manifests. This DOES write to isolated candidate tables,
   but it does NOT promote an authority head and does NOT apply Cloud data to WLP. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.202-canonical-authority-candidate-v1';
  const CANDIDATE_SCHEMA_VERSION = 1;
  const UPLOAD_BATCH = 250;
  const HASH_BATCH = 128;
  const state = { busy: false, report: null, lastCandidateKey: '' };

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
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }
  function sleep(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function supabaseApi() {
    const api = window.WLPCloudShadowSupabase;
    if (!api?.ensureSession || !api?.registerDevice || !api?.rest || !api?.fetchPaged) {
      throw new Error('Shadow Supabase transport is not ready. Reload this diagnostics page.');
    }
    return api;
  }

  function verifiedInput() {
    const verified = window.WLPCanonicalCutoverPreflight?.getVerifiedSnapshot?.();
    const materialization = window.WLPCanonicalMergeMaterialization?.getReport?.();
    if (!verified?.report?.summary?.pass || !Array.isArray(verified.rows)) {
      throw new Error('Run Cutover Preflight and obtain PASS first in this page session.');
    }
    if (!materialization?.summary?.pass) throw new Error('Merged Canonical materialization is not a clean PASS.');
    if (verified.report.sourceMaterializationHash !== materialization.hashes?.snapshotManifestHash) {
      throw new Error('Authority candidate blocked: the verified preflight no longer matches the current materialization. Run Cutover Preflight again.');
    }
    if (verified.report.hashes?.snapshotManifestHash !== materialization.hashes?.snapshotManifestHash) {
      throw new Error('Authority candidate blocked: preflight/materialization manifest mismatch.');
    }
    if (verified.rows.length !== Number(verified.report.summary.hydratedRows || 0)) {
      throw new Error('Authority candidate blocked: verified hydrated payload cache is incomplete. Run Cutover Preflight again.');
    }
    if (!verified.report.cutoverTicketHash) throw new Error('Authority candidate blocked: Cutover Ticket is missing.');
    return { preflight: verified.report, rows: verified.rows, materialization };
  }

  async function exactCount(api, path) {
    const { data, response } = await api.rest(path, { headers: { Range: '0-0', Prefer: 'count=exact' } });
    const range = response.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    if (Number.isFinite(total)) return total;
    return Array.isArray(data) ? data.length : 0;
  }

  async function countExisting(api, candidateKey) {
    const filter = `candidate_key=eq.${encodeURIComponent(candidateKey)}`;
    const runCount = await exactCount(api, `wlp_canonical_authority_candidates?select=candidate_key&${filter}`);
    const recordCount = await exactCount(api, `wlp_canonical_authority_candidate_records?select=row_key&${filter}`);
    return { runCount, recordCount };
  }

  async function upsertCandidate(api, session, device, input, candidateKey, status, diagnostics = {}) {
    const preflight = input.preflight;
    const latestRun = preflight.latestRuns?.[0] || {};
    const now = new Date().toISOString();
    await api.rest('wlp_canonical_authority_candidates?on_conflict=owner_id,candidate_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        owner_id: session.userId,
        candidate_key: candidateKey,
        candidate_schema_version: CANDIDATE_SCHEMA_VERSION,
        migration_version: latestRun.migration_version || '',
        namespace_uuid: latestRun.namespace_uuid || '',
        app_version: APP_VERSION,
        status,
        committed_by_device_key: device.deviceKey,
        source_plan_hash: preflight.sourcePlanHash || '',
        source_materialization_hash: preflight.sourceMaterializationHash || '',
        cutover_ticket_hash: preflight.cutoverTicketHash,
        snapshot_manifest_hash: preflight.hashes?.snapshotManifestHash || '',
        card_mapping_hash: latestRun.card_mapping_hash || '',
        core_library_hash: latestRun.core_library_hash || '',
        canonical_row_count: Number(preflight.summary?.hydratedRows || input.rows.length),
        table_counts: preflight.tableCounts || {},
        table_manifest_hashes: preflight.hashes?.tableManifestHashes || {},
        source_devices: (preflight.latestRuns || []).map(run => ({
          device_key: run.device_key,
          stage_key: run.stage_key,
          migration_version: run.migration_version,
          full_canonical_hash: run.full_canonical_hash
        })),
        diagnostics: {
          sourceMode: preflight.mode || '',
          preflightAppVersion: preflight.appVersion || '',
          invariants: {
            inactiveCandidateOnly: true,
            noAuthorityHeadPromotion: true,
            noCloudToWlpApply: true,
            noWlpWrites: true,
            noAbsenceBasedDeletion: true
          },
          ...diagnostics
        },
        last_committed_at: now
      }]
    });
  }

  async function uploadRows(api, session, candidateKey, rows) {
    const batches = chunk(rows, UPLOAD_BATCH);
    let attempted = 0;
    for (let i = 0; i < batches.length; i += 1) {
      const now = new Date().toISOString();
      const body = batches[i].map(row => ({
        owner_id: session.userId,
        candidate_key: candidateKey,
        table_name: row.tableName,
        row_key: row.rowKey,
        payload: row.payload,
        payload_hash: row.payloadHash,
        tombstone: Boolean(row.tombstone),
        last_committed_at: now
      }));
      await api.rest('wlp_canonical_authority_candidate_records?on_conflict=owner_id,candidate_key,table_name,row_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body
      });
      attempted += body.length;
      setStatus(`Committing inactive Authority Candidate rows… ${attempted.toLocaleString()} / ${rows.length.toLocaleString()}`, '');
      if (i && i % 8 === 0) await sleep(0);
    }
    return attempted;
  }

  async function fetchCandidateRows(api, candidateKey) {
    return api.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  async function fetchCandidateMeta(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    return rows[0] || null;
  }

  function tableCounts(rows) {
    const out = {};
    rows.forEach(row => { out[row.table_name] = (out[row.table_name] || 0) + 1; });
    return out;
  }

  async function manifestProof(rows) {
    const hashRows = [...rows]
      .sort((a, b) => identity(a.table_name, a.row_key).localeCompare(identity(b.table_name, b.row_key)))
      .map(row => ({ tableName: row.table_name, rowKey: row.row_key, tombstone: Boolean(row.tombstone), payloadHash: row.payload_hash }));
    const counts = tableCounts(rows);
    const snapshotManifestHash = await sha256(stableStringify(hashRows));
    const tableManifestHashes = {};
    for (const tableName of Object.keys(counts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(hashRows.filter(row => row.tableName === tableName)));
    }
    return { counts, snapshotManifestHash, tableManifestHashes };
  }

  function compareObjects(expected, actual, label, blocking) {
    const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
    [...keys].sort().forEach(key => {
      if (String(expected?.[key] ?? '') !== String(actual?.[key] ?? '')) {
        blocking.push(`${label} mismatch for ${key}: expected ${expected?.[key] ?? '(missing)'}, got ${actual?.[key] ?? '(missing)'}.`);
      }
    });
  }

  async function verifyRoundTrip(input, candidateKey, cloudRows, cloudMeta) {
    const blocking = [];
    const expected = new Map(input.rows.map(row => [identity(row.tableName, row.rowKey), row]));
    const seen = new Set();
    let payloadHashesVerified = 0;
    const payloadHashMismatches = [];
    const identityMismatches = [];

    for (let start = 0; start < cloudRows.length; start += HASH_BATCH) {
      const batch = cloudRows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        const key = identity(row.table_name, row.row_key);
        const source = expected.get(key);
        seen.add(key);
        if (!source || source.payloadHash !== row.payload_hash || Boolean(source.tombstone) !== Boolean(row.tombstone)) identityMismatches.push(key);
        if (hash === row.payload_hash) payloadHashesVerified += 1;
        else payloadHashMismatches.push(key);
      });
      setStatus(`Verifying Authority Candidate payloads… ${Math.min(start + HASH_BATCH, cloudRows.length).toLocaleString()} / ${cloudRows.length.toLocaleString()}`, '');
      if (start && start % (HASH_BATCH * 8) === 0) await sleep(0);
    }

    const missing = [...expected.keys()].filter(key => !seen.has(key));
    const extras = cloudRows.filter(row => !expected.has(identity(row.table_name, row.row_key))).map(row => identity(row.table_name, row.row_key));
    if (missing.length) blocking.push(`Authority Candidate read-back is missing ${missing.length} expected row(s).`);
    if (extras.length) blocking.push(`Authority Candidate read-back contains ${extras.length} unexpected row(s).`);
    if (identityMismatches.length) blocking.push(`Authority Candidate source identity/hash mismatch on ${identityMismatches.length} row(s).`);
    if (payloadHashMismatches.length) blocking.push(`Authority Candidate payload SHA-256 mismatch on ${payloadHashMismatches.length} row(s).`);

    const proof = await manifestProof(cloudRows);
    if (proof.snapshotManifestHash !== input.preflight.hashes?.snapshotManifestHash) blocking.push('Authority Candidate manifest hash does not match the verified Cutover Preflight manifest.');
    compareObjects(input.preflight.tableCounts || {}, proof.counts, 'Authority Candidate table count', blocking);
    compareObjects(input.preflight.hashes?.tableManifestHashes || {}, proof.tableManifestHashes, 'Authority Candidate table manifest hash', blocking);

    if (!cloudMeta) blocking.push('Authority Candidate metadata row is missing after commit.');
    else {
      if (cloudMeta.candidate_key !== candidateKey) blocking.push('Authority Candidate metadata key mismatch.');
      if (Number(cloudMeta.candidate_schema_version || 0) !== CANDIDATE_SCHEMA_VERSION) blocking.push('Authority Candidate schema version mismatch.');
      if (cloudMeta.cutover_ticket_hash !== input.preflight.cutoverTicketHash) blocking.push('Authority Candidate Cutover Ticket mismatch.');
      if (cloudMeta.source_plan_hash !== input.preflight.sourcePlanHash) blocking.push('Authority Candidate source plan hash mismatch.');
      if (cloudMeta.source_materialization_hash !== input.preflight.sourceMaterializationHash) blocking.push('Authority Candidate source materialization hash mismatch.');
      if (cloudMeta.snapshot_manifest_hash !== input.preflight.hashes?.snapshotManifestHash) blocking.push('Authority Candidate metadata manifest mismatch.');
      if (Number(cloudMeta.canonical_row_count || 0) !== input.rows.length) blocking.push('Authority Candidate metadata row-count mismatch.');
      compareObjects(input.preflight.tableCounts || {}, cloudMeta.table_counts || {}, 'Authority Candidate metadata table count', blocking);
      compareObjects(input.preflight.hashes?.tableManifestHashes || {}, cloudMeta.table_manifest_hashes || {}, 'Authority Candidate metadata table manifest hash', blocking);
      const latestRun = input.preflight.latestRuns?.[0] || {};
      if (cloudMeta.namespace_uuid !== latestRun.namespace_uuid) blocking.push('Authority Candidate namespace UUID mismatch.');
      if (String(cloudMeta.migration_version) !== String(latestRun.migration_version)) blocking.push('Authority Candidate migration version mismatch.');
      if (cloudMeta.card_mapping_hash !== latestRun.card_mapping_hash) blocking.push('Authority Candidate Card Mapping Hash mismatch.');
      if (cloudMeta.core_library_hash !== latestRun.core_library_hash) blocking.push('Authority Candidate Core Library Hash mismatch.');
    }

    return {
      blocking,
      payloadHashesVerified,
      payloadHashMismatches: payloadHashMismatches.length,
      sourceIdentityMismatches: identityMismatches.length,
      missingRows: missing.length,
      extraRows: extras.length,
      proof
    };
  }

  async function commitCandidate(retryOnly = false) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryOnly ? 'Retrying the same inactive Authority Candidate commit…' : 'Preparing the preflight-verified inactive Authority Candidate…', '');
    let input = null;
    let api = null;
    let session = null;
    let device = null;
    let candidateKey = '';
    try {
      input = verifiedInput();
      api = supabaseApi();
      session = await api.ensureSession();
      device = await api.registerDevice();
      candidateKey = `v1:${input.preflight.cutoverTicketHash}`;
      if (retryOnly && state.lastCandidateKey && state.lastCandidateKey !== candidateKey) {
        throw new Error('Retry blocked: the verified Cutover Ticket changed. Run the normal Authority Candidate commit instead.');
      }

      const before = await countExisting(api, candidateKey);
      if (retryOnly && (before.runCount !== 1 || before.recordCount !== input.rows.length)) {
        throw new Error('Retry blocked: the exact verified Authority Candidate is not already complete in Cloud candidate storage.');
      }

      await upsertCandidate(api, session, device, input, candidateKey, 'started', { retryRequested: retryOnly });
      const attempted = await uploadRows(api, session, candidateKey, input.rows);
      await upsertCandidate(api, session, device, input, candidateKey, 'uploaded', { retryRequested: retryOnly, uploadAttemptedRows: attempted });

      const cloudRows = await fetchCandidateRows(api, candidateKey);
      const cloudMetaBeforeVerify = await fetchCandidateMeta(api, candidateKey);
      const verification = await verifyRoundTrip(input, candidateKey, cloudRows, cloudMetaBeforeVerify);
      const after = await countExisting(api, candidateKey);
      const retryIdempotent = retryOnly
        ? before.runCount === 1 && after.runCount === 1
          && before.recordCount === after.recordCount
          && after.recordCount === input.rows.length
        : null;
      if (retryOnly && retryIdempotent !== true) verification.blocking.push('Retry idempotency check did not pass.');
      const pass = verification.blocking.length === 0 && (!retryOnly || retryIdempotent === true);

      await upsertCandidate(api, session, device, input, candidateKey, pass ? 'verified' : 'failed', {
        retryRequested: retryOnly,
        retryIdempotent,
        uploadAttemptedRows: attempted,
        readBackRows: cloudRows.length,
        payloadHashesVerified: verification.payloadHashesVerified,
        payloadHashMismatches: verification.payloadHashMismatches,
        sourceIdentityMismatches: verification.sourceIdentityMismatches,
        manifestHash: verification.proof.snapshotManifestHash,
        blockers: verification.blocking
      });
      const cloudMeta = await fetchCandidateMeta(api, candidateKey);
      if (pass && cloudMeta?.status !== 'verified') verification.blocking.push('Authority Candidate metadata did not persist verified status.');
      const finalPass = pass && verification.blocking.length === 0;

      state.lastCandidateKey = candidateKey;
      state.report = {
        format: 'WLP_CANONICAL_AUTHORITY_CANDIDATE_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: retryOnly ? 'retry-inactive-candidate' : 'commit-inactive-candidate',
        candidateKey,
        cutoverTicketHash: input.preflight.cutoverTicketHash,
        sourceMaterializationHash: input.preflight.sourceMaterializationHash,
        compatibility: clone(input.preflight.compatibility || {}),
        latestRuns: clone(input.preflight.latestRuns || []),
        summary: {
          expectedRows: input.rows.length,
          readBackRows: cloudRows.length,
          payloadHashesVerified: verification.payloadHashesVerified,
          payloadHashMismatches: verification.payloadHashMismatches,
          sourceIdentityMismatches: verification.sourceIdentityMismatches,
          missingRows: verification.missingRows,
          extraRows: verification.extraRows,
          blockingIssues: verification.blocking.length,
          tombstoneRows: cloudRows.filter(row => row.tombstone).length,
          retryRequested: retryOnly,
          retryIdempotent,
          candidateStatus: cloudMeta?.status || '',
          pass: finalPass
        },
        counts: { before, after },
        tableCounts: verification.proof.counts,
        hashes: {
          snapshotManifestHash: verification.proof.snapshotManifestHash,
          tableManifestHashes: verification.proof.tableManifestHashes
        },
        issues: {
          blocking: verification.blocking,
          warnings: [
            'This is an inactive Canonical Authority Candidate only; no authority head/pointer has been promoted.',
            'No Cloud data has been applied to WLP.',
            ...(cloudRows.some(row => row.tombstone) ? [] : ['No explicit tombstones exist in this real candidate snapshot; tombstone convergence remains to be exercised separately.'])
          ]
        },
        invariants: {
          cloudWritesRestrictedToInactiveCandidateTables: true,
          noAuthorityHeadPromotion: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noAbsenceBasedDeletion: true,
          candidateKeyContentAddressedByCutoverTicket: true,
          fullPayloadRoundTripVerified: verification.payloadHashesVerified === input.rows.length && verification.payloadHashMismatches === 0
        }
      };
      render(state.report);
      setStatus(
        finalPass
          ? `Inactive Authority Candidate round-trip PASS · ${cloudRows.length.toLocaleString()} rows read back exactly${retryOnly ? ' · retry idempotency PASS' : ''} · candidate remains inactive · no WLP data modified.`
          : `Authority Candidate commit completed with ${verification.blocking.length} blocker(s). Candidate was NOT promoted and no WLP data was modified.`,
        finalPass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-authority-candidate-complete'));
    } catch (error) {
      console.error('WLP Canonical Authority Candidate:', error);
      if (api && session && device && candidateKey && input) {
        try {
          await upsertCandidate(api, session, device, input, candidateKey, 'failed', { error: error?.message || String(error) });
        } catch {}
      }
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary || {};
    $('authority-candidate-rows').textContent = Number(s.readBackRows || 0).toLocaleString();
    $('authority-candidate-hashes').textContent = Number(s.payloadHashesVerified || 0).toLocaleString();
    $('authority-candidate-mismatches').textContent = Number(s.payloadHashMismatches || 0).toLocaleString();
    $('authority-candidate-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('authority-candidate-retry').textContent = s.retryRequested ? (s.retryIdempotent ? 'PASS' : 'FAIL') : '—';
    $('authority-candidate-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('authority-candidate-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('authority-candidate-key').textContent = report.candidateKey || '—';
    $('authority-candidate-ticket').textContent = report.cutoverTicketHash || '—';
    $('authority-candidate-manifest').textContent = report.hashes?.snapshotManifestHash || '—';

    const tableBody = $('authority-candidate-table-body');
    tableBody.innerHTML = '';
    const expected = window.WLPCanonicalCutoverPreflight?.getReport?.();
    Object.entries(report.tableCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([table, count]) => {
      const expectedCount = Number(expected?.tableCounts?.[table] || 0);
      const expectedHash = expected?.hashes?.tableManifestHashes?.[table] || '';
      const actualHash = report.hashes?.tableManifestHashes?.[table] || '';
      const tr = document.createElement('tr');
      [table, count, expectedCount, actualHash === expectedHash ? 'PASS' : 'CHECK'].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });

    const notes = $('authority-candidate-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No Authority Candidate issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('authority-candidate-panel').classList.remove('hidden');
    $('export-authority-candidate').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-candidate-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('authority-candidate-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const verified = window.WLPCanonicalCutoverPreflight?.getVerifiedSnapshot?.();
    const ready = Boolean(verified?.report?.summary?.pass && Array.isArray(verified.rows));
    $('commit-authority-candidate').disabled = state.busy || !ready;
    $('retry-authority-candidate').disabled = state.busy || !ready || !state.report?.summary?.pass;
    $('export-authority-candidate').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalAuthorityCandidate = Object.freeze({ getReport: () => state.report });

  function init() {
    $('commit-authority-candidate').addEventListener('click', () => commitCandidate(false));
    $('retry-authority-candidate').addEventListener('click', () => commitCandidate(true));
    $('export-authority-candidate').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-cutover-preflight-complete', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
