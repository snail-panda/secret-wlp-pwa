/* WLP v1.8.6.203 · Canonical Authority Promotion Preflight
   Read-only gate immediately before an explicit authority-head promotion.
   Re-verifies the inactive candidate from Cloud fingerprints and inspects the
   locked head table. No candidate write, head write, or Cloud -> WLP apply. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.203-authority-promotion-preflight-v1';
  const HEAD_SCHEMA_VERSION = 1;
  const $ = id => document.getElementById(id);
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
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function sameJSON(a, b) { return stableStringify(a ?? null) === stableStringify(b ?? null); }

  function expectedInput() {
    const verified = window.WLPCanonicalCutoverPreflight?.getVerifiedSnapshot?.();
    const report = verified?.report;
    if (!report?.summary?.pass) throw new Error('Promotion preflight blocked: run Cutover Preflight and obtain PASS first.');
    if (!report.cutoverTicketHash || !report.hashes?.snapshotManifestHash) throw new Error('Promotion preflight blocked: Cutover Ticket or materialization manifest is missing.');
    if (!report.compatibility?.namespaceMatch || !report.compatibility?.migrationVersionMatch || !report.compatibility?.cardMappingHashMatch || !report.compatibility?.coreLibraryHashMatch) {
      throw new Error('Promotion preflight blocked: Cutover Preflight compatibility gates are not all PASS.');
    }
    return report;
  }

  async function fetchCandidateMeta(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Promotion preflight blocked: expected exactly one inactive Authority Candidate row for ${candidateKey}, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchFingerprints(api, candidateKey) {
    return api.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length > 1) throw new Error(`Promotion preflight blocked: authority head table returned ${rows.length} rows for this account; expected at most one.`);
    return rows[0] || null;
  }

  function tableCounts(rows) {
    const out = {};
    rows.forEach(row => { out[row.table_name] = (out[row.table_name] || 0) + 1; });
    return out;
  }

  async function manifestProof(rows) {
    const hashRows = rows.map(row => ({
      tableName: row.table_name,
      rowKey: row.row_key,
      tombstone: Boolean(row.tombstone),
      payloadHash: row.payload_hash
    })).sort((a, b) => `${a.tableName}\u0000${a.rowKey}`.localeCompare(`${b.tableName}\u0000${b.rowKey}`));

    const counts = {};
    hashRows.forEach(row => { counts[row.tableName] = (counts[row.tableName] || 0) + 1; });
    const snapshotManifestHash = await sha256(stableStringify(hashRows));
    const tableManifestHashes = {};
    for (const tableName of Object.keys(counts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(hashRows.filter(row => row.tableName === tableName)));
    }
    return { snapshotManifestHash, tableManifestHashes, tableCounts: counts, rows: hashRows.length, tombstoneRows: hashRows.filter(row => row.tombstone).length };
  }

  async function buildReport() {
    const expected = expectedInput();
    const api = window.WLPCloudShadowSupabase;
    if (!api) throw new Error('Supabase Shadow helper is unavailable.');
    await api.ensureSession();

    const candidateKey = `v1:${expected.cutoverTicketHash}`;
    const candidate = await fetchCandidateMeta(api, candidateKey);
    const fingerprints = await fetchFingerprints(api, candidateKey);
    const head = await fetchHead(api);
    const proof1 = await manifestProof(fingerprints);
    const proof2 = await manifestProof(fingerprints);

    const blocking = [];
    const warnings = [];
    const checks = [];
    const addCheck = (name, pass, evidence) => { checks.push({ name, pass: Boolean(pass), evidence: String(evidence || '') }); if (!pass) blocking.push(`${name}: ${evidence}`); };

    addCheck('Candidate status verified', candidate.status === 'verified', `status=${candidate.status || 'missing'}`);
    addCheck('Candidate key matches Cutover Ticket', candidate.candidate_key === candidateKey, candidate.candidate_key || 'missing');
    addCheck('Cutover Ticket hash matches', candidate.cutover_ticket_hash === expected.cutoverTicketHash, candidate.cutover_ticket_hash || 'missing');
    addCheck('Snapshot manifest matches current preflight', candidate.snapshot_manifest_hash === expected.hashes.snapshotManifestHash && proof1.snapshotManifestHash === expected.hashes.snapshotManifestHash, proof1.snapshotManifestHash);
    addCheck('Canonical row count matches', Number(candidate.canonical_row_count || 0) === Number(expected.summary.hydratedRows || 0) && proof1.rows === Number(expected.summary.hydratedRows || 0), `${proof1.rows} rows`);
    addCheck('Table counts match', sameJSON(candidate.table_counts || {}, expected.tableCounts || {}) && sameJSON(proof1.tableCounts, expected.tableCounts || {}), `${Object.keys(proof1.tableCounts).length} tables`);
    addCheck('Table manifest hashes match', sameJSON(candidate.table_manifest_hashes || {}, expected.hashes.tableManifestHashes || {}) && sameJSON(proof1.tableManifestHashes, expected.hashes.tableManifestHashes || {}), `${Object.keys(proof1.tableManifestHashes).length} table hashes`);
    addCheck('Migration version matches', String(candidate.migration_version || '') === String(expected.latestRuns?.[0]?.migration_version || ''), candidate.migration_version || 'missing');
    addCheck('Namespace UUID matches', candidate.namespace_uuid === expected.latestRuns?.[0]?.namespace_uuid, candidate.namespace_uuid || 'missing');
    addCheck('Card Mapping hash matches', candidate.card_mapping_hash === expected.latestRuns?.[0]?.card_mapping_hash, candidate.card_mapping_hash || 'missing');
    addCheck('Core Library hash matches', candidate.core_library_hash === expected.latestRuns?.[0]?.core_library_hash, candidate.core_library_hash || 'missing');
    addCheck('Source materialization hash matches', candidate.source_materialization_hash === expected.sourceMaterializationHash, candidate.source_materialization_hash || 'missing');

    const repeatability = proof1.snapshotManifestHash === proof2.snapshotManifestHash
      && sameJSON(proof1.tableManifestHashes, proof2.tableManifestHashes)
      && sameJSON(proof1.tableCounts, proof2.tableCounts);
    addCheck('Manifest proof repeatability', repeatability, repeatability ? 'PASS' : 'recomputed proof differs');

    let headState = 'ABSENT';
    let promotionEligible = true;
    if (head) {
      if (head.candidate_key === candidateKey
          && head.cutover_ticket_hash === expected.cutoverTicketHash
          && head.snapshot_manifest_hash === expected.hashes.snapshotManifestHash) {
        headState = 'SAME_CANDIDATE';
        warnings.push('The authority head already points to this exact candidate. A later promotion action should be idempotent rather than create another logical authority version.');
      } else {
        headState = 'DIFFERENT_CANDIDATE';
        promotionEligible = false;
        blocking.push(`Authority head already points to a different candidate (${head.candidate_key || 'unknown'}). Initial cutover promotion will not overwrite it automatically.`);
      }
    }

    if (!proof1.tombstoneRows) warnings.push('No explicit tombstones exist in this candidate; tombstone convergence remains unexercised by current real data.');
    warnings.push('The authority-head table is SELECT-only for authenticated clients in v203. This preflight has no promotion write path.');
    warnings.push('No Cloud data is applied to WLP in this step.');

    const pass = blocking.length === 0 && promotionEligible;
    return {
      format: 'WLP_CANONICAL_AUTHORITY_PROMOTION_PREFLIGHT',
      version: 1,
      appVersion: APP_VERSION,
      generatedAt: new Date().toISOString(),
      mode: 'read-only-authority-promotion-preflight',
      candidateKey,
      cutoverTicketHash: expected.cutoverTicketHash,
      sourceMaterializationHash: expected.sourceMaterializationHash,
      compatibility: clone(expected.compatibility || {}),
      candidate: clone(candidate),
      currentHead: clone(head),
      summary: {
        candidateStatus: candidate.status || '',
        candidateFingerprints: proof1.rows,
        tableManifestMatches: Object.keys(proof1.tableManifestHashes).filter(name => proof1.tableManifestHashes[name] === expected.hashes?.tableManifestHashes?.[name]).length,
        tableCount: Object.keys(proof1.tableCounts).length,
        blockingIssues: blocking.length,
        tombstoneRows: proof1.tombstoneRows,
        headState,
        promotionEligible,
        repeatability,
        pass
      },
      hashes: {
        snapshotManifestHash: proof1.snapshotManifestHash,
        tableManifestHashes: proof1.tableManifestHashes
      },
      tableCounts: proof1.tableCounts,
      checks,
      issues: { blocking, warnings },
      invariants: {
        noCandidateWrites: true,
        noAuthorityHeadWrites: true,
        noCloudToWlpApply: true,
        noWlpWrites: true,
        noAutomaticPromotion: true,
        authorityHeadClientWriteLocked: true,
        candidateFingerprintsFullyReverified: true
      }
    };
  }

  async function run() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Re-verifying the inactive Authority Candidate and inspecting the locked authority head. No promotion will occur…', '');
    try {
      state.report = await buildReport();
      render(state.report);
      const s = state.report.summary;
      setStatus(
        `Authority Promotion Preflight ${s.pass ? 'PASS' : 'CHECK'} · ${Number(s.candidateFingerprints || 0).toLocaleString()} candidate fingerprints verified · head ${s.headState} · ${s.blockingIssues} blocker(s) · repeatability ${s.repeatability ? 'PASS' : 'FAIL'} · no authority promotion and no WLP data modified.`,
        s.pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-authority-promotion-preflight-complete'));
    } catch (error) {
      console.error('WLP Canonical Authority Promotion Preflight:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('authority-promotion-preflight-rows').textContent = Number(s.candidateFingerprints || 0).toLocaleString();
    $('authority-promotion-preflight-hashes').textContent = `${Number(s.tableManifestMatches || 0)}/${Number(s.tableCount || 0)}`;
    $('authority-promotion-preflight-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('authority-promotion-preflight-head').textContent = s.headState || '—';
    $('authority-promotion-preflight-repeat').textContent = s.repeatability ? 'PASS' : 'FAIL';
    $('authority-promotion-preflight-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('authority-promotion-preflight-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('authority-promotion-preflight-key').textContent = report.candidateKey || '—';
    $('authority-promotion-preflight-manifest').textContent = report.hashes?.snapshotManifestHash || '—';

    const body = $('authority-promotion-preflight-proof-body');
    body.innerHTML = '';
    (report.checks || []).forEach(check => {
      const tr = document.createElement('tr');
      [check.name, check.pass ? 'PASS' : 'FAIL', check.evidence].forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = String(value ?? '');
        if (index === 2) td.style.wordBreak = 'break-all';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const notes = $('authority-promotion-preflight-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No promotion preflight issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('authority-promotion-preflight-panel').classList.remove('hidden');
    $('export-authority-promotion-preflight').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-promotion-preflight-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('authority-promotion-preflight-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const verified = window.WLPCanonicalCutoverPreflight?.getVerifiedSnapshot?.();
    const ready = Boolean(cloud.configured && cloud.signedIn && verified?.report?.summary?.pass);
    $('run-authority-promotion-preflight').disabled = state.busy || !ready;
    $('export-authority-promotion-preflight').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalAuthorityPromotionPreflight = Object.freeze({
    getReport: () => state.report,
    buildReport
  });

  function init() {
    $('run-authority-promotion-preflight').addEventListener('click', run);
    $('export-authority-promotion-preflight').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-cutover-preflight-complete', refreshButtons);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
