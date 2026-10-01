/* WLP v1.8.6.217 · Authority v2 FirstSeen Promotion Preflight
   Read-only gate before explicit Authority Head v1 -> v2 promotion.
   Re-verifies the full inactive v2 candidate, compares it with the ACTIVE v1
   parent, proves only learning_state changed, and checks promotion eligibility.
   No candidate write, head write, mirror write, localStorage write, or live WLP write. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.217-first-seen-authority-v2-promotion-preflight-v1';
  const EXPECTED_PARENT_CANDIDATE = 'v1:5d5ad23a7d6fa181e2ec1642649b059cd4afa21a7af1fd64efc794efe01bae54';
  const EXPECTED_PARENT_HEAD_VERSION = 1;
  const EXPECTED_PARENT_MANIFEST = '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a';
  const EXPECTED_V2_CANDIDATE = 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const EXPECTED_V2_TICKET = '5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const EXPECTED_REPAIR_PLAN_HASH = '887098646342a714d04d12d102f99477bb8cc9ecf2f7112afb9f9984767e9df9';
  const EXPECTED_V2_MANIFEST = 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3';
  const EXPECTED_V2_STATE_MANIFEST = '67381bd1aeee1f79ded1041590aa89f2e1614f010eff3ab9d9d6a44841582ccc';
  const EXPECTED_PARENT_STATE_MANIFEST = 'd55020386c1414dcbd5e76f8147cff842a9b886edd40b592373167d2ee8f9dcd';
  const EXPECTED_ROWS = 21424;
  const EXPECTED_STATE_ROWS = 111;
  const TARGET_MIGRATION_VERSION = '3';
  const HASH_BATCH = 192;
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
  function sameJSON(a, b) { return stableStringify(a ?? null) === stableStringify(b ?? null); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function api() {
    const helper = window.WLPCloudShadowSupabase;
    if (!helper?.ensureSession || !helper?.fetchPaged) throw new Error('Supabase Shadow helper is unavailable. Reload Cloud Shadow.');
    return helper;
  }

  async function fetchHead(helper) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Promotion preflight blocked: expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(helper, candidateKey) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Promotion preflight blocked: expected exactly one candidate row for ${candidateKey}, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidateRows(helper, candidateKey, includePayload) {
    const select = includePayload
      ? 'candidate_key,table_name,row_key,payload_hash,tombstone,payload'
      : 'candidate_key,table_name,row_key,payload_hash,tombstone';
    return helper.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      select,
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  async function manifestProof(rows) {
    const fingerprints = rows.map(row => ({
      tableName: row.table_name ?? row.tableName,
      rowKey: String(row.row_key ?? row.rowKey),
      tombstone: Boolean(row.tombstone),
      payloadHash: String(row.payload_hash ?? row.payloadHash)
    })).sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    const tableCounts = {};
    fingerprints.forEach(row => { tableCounts[row.tableName] = (tableCounts[row.tableName] || 0) + 1; });
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(fingerprints.filter(row => row.tableName === tableName)));
    }
    return {
      rows: fingerprints.length,
      tombstoneRows: fingerprints.filter(row => row.tombstone).length,
      snapshotManifestHash: await sha256(stableStringify(fingerprints)),
      tableCounts,
      tableManifestHashes,
      fingerprints
    };
  }

  async function verifyPayloadHashes(rows) {
    let verified = 0;
    const mismatches = [];
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        if (hash === String(row.payload_hash)) verified += 1;
        else mismatches.push(`${row.table_name}|${row.row_key}`);
      });
      if (start && start % (HASH_BATCH * 8) === 0) await sleep(0);
    }
    return { verified, mismatches };
  }

  function compareParentAndV2(parentRows, v2Rows) {
    const parent = new Map(parentRows.map(row => [identity(row.table_name, row.row_key), row]));
    const v2 = new Map(v2Rows.map(row => [identity(row.table_name, row.row_key), row]));
    const all = [...new Set([...parent.keys(), ...v2.keys()])].sort();
    const missingInV2 = [];
    const extraInV2 = [];
    const changed = [];
    const tombstoneChanges = [];
    for (const key of all) {
      const a = parent.get(key), b = v2.get(key);
      if (!a) { extraInV2.push(key); continue; }
      if (!b) { missingInV2.push(key); continue; }
      if (Boolean(a.tombstone) !== Boolean(b.tombstone)) tombstoneChanges.push(key);
      if (String(a.payload_hash) !== String(b.payload_hash) || Boolean(a.tombstone) !== Boolean(b.tombstone)) {
        const [tableName, rowKey] = key.split('\u0000');
        changed.push({ tableName, rowKey, parentHash: String(a.payload_hash), v2Hash: String(b.payload_hash) });
      }
    }
    const changedTables = [...new Set(changed.map(row => row.tableName))].sort();
    return { missingInV2, extraInV2, changed, changedTables, tombstoneChanges };
  }

  function validFirstSeen(payload) {
    const raw = payload?.first_seen_at;
    if (typeof raw !== 'string' || !raw) return false;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) && ms > 0;
  }

  function addCheck(checks, blocking, name, pass, evidence) {
    const item = { name, pass: Boolean(pass), evidence: String(evidence ?? '') };
    checks.push(item);
    if (!item.pass) blocking.push(`${name}: ${item.evidence}`);
  }

  async function buildReport() {
    const helper = api();
    await helper.ensureSession();
    const head = await fetchHead(helper);
    const parentCandidate = await fetchCandidate(helper, EXPECTED_PARENT_CANDIDATE);
    const v2Candidate = await fetchCandidate(helper, EXPECTED_V2_CANDIDATE);
    const parentRows = await fetchCandidateRows(helper, EXPECTED_PARENT_CANDIDATE, false);
    const v2Rows = await fetchCandidateRows(helper, EXPECTED_V2_CANDIDATE, true);
    const parentProof = await manifestProof(parentRows);
    const v2Proof1 = await manifestProof(v2Rows);
    const v2Proof2 = await manifestProof(v2Rows);
    const payloadCheck = await verifyPayloadHashes(v2Rows);
    const delta = compareParentAndV2(parentRows, v2Rows);
    const v2StateRows = v2Rows.filter(row => row.table_name === 'learning_state' && !row.tombstone);
    const stateRowsWithFirstSeen = v2StateRows.filter(row => validFirstSeen(row.payload)).length;

    const blocking = [];
    const warnings = [];
    const checks = [];
    addCheck(checks, blocking, 'ACTIVE Head remains parent v1', head.candidate_key === EXPECTED_PARENT_CANDIDATE && Number(head.head_version) === EXPECTED_PARENT_HEAD_VERSION, `${head.candidate_key} · head v${head.head_version}`);
    addCheck(checks, blocking, 'ACTIVE Head parent manifest matches', head.snapshot_manifest_hash === EXPECTED_PARENT_MANIFEST && parentProof.snapshotManifestHash === EXPECTED_PARENT_MANIFEST, parentProof.snapshotManifestHash);
    addCheck(checks, blocking, 'Parent candidate remains verified', parentCandidate.status === 'verified', `status=${parentCandidate.status}`);
    addCheck(checks, blocking, 'v2 candidate status verified', v2Candidate.status === 'verified', `status=${v2Candidate.status}`);
    addCheck(checks, blocking, 'v2 candidate key matches verified v216 result', v2Candidate.candidate_key === EXPECTED_V2_CANDIDATE, v2Candidate.candidate_key);
    addCheck(checks, blocking, 'v2 revision ticket matches', v2Candidate.cutover_ticket_hash === EXPECTED_V2_TICKET, v2Candidate.cutover_ticket_hash);
    addCheck(checks, blocking, 'v2 repair-plan hash matches', v2Candidate.source_plan_hash === EXPECTED_REPAIR_PLAN_HASH, v2Candidate.source_plan_hash);
    addCheck(checks, blocking, 'v2 parent/source manifest matches ACTIVE v1', v2Candidate.source_materialization_hash === EXPECTED_PARENT_MANIFEST, v2Candidate.source_materialization_hash);
    addCheck(checks, blocking, 'v2 migration version is 3', String(v2Candidate.migration_version) === TARGET_MIGRATION_VERSION, v2Candidate.migration_version);
    addCheck(checks, blocking, 'Namespace UUID unchanged', v2Candidate.namespace_uuid === head.namespace_uuid, v2Candidate.namespace_uuid);
    addCheck(checks, blocking, 'Card Mapping hash unchanged', v2Candidate.card_mapping_hash === head.card_mapping_hash, v2Candidate.card_mapping_hash);
    addCheck(checks, blocking, 'Core Library hash unchanged', v2Candidate.core_library_hash === head.core_library_hash, v2Candidate.core_library_hash);
    addCheck(checks, blocking, 'Canonical row count unchanged', Number(v2Candidate.canonical_row_count) === EXPECTED_ROWS && v2Proof1.rows === EXPECTED_ROWS, `${v2Proof1.rows} rows`);
    addCheck(checks, blocking, 'v2 full payload hashes reverified', payloadCheck.verified === EXPECTED_ROWS && payloadCheck.mismatches.length === 0, `${payloadCheck.verified}/${EXPECTED_ROWS}`);
    addCheck(checks, blocking, 'v2 snapshot manifest matches verified v215/v216 projection', v2Candidate.snapshot_manifest_hash === EXPECTED_V2_MANIFEST && v2Proof1.snapshotManifestHash === EXPECTED_V2_MANIFEST, v2Proof1.snapshotManifestHash);
    addCheck(checks, blocking, 'v2 table counts match candidate metadata', sameJSON(v2Proof1.tableCounts, v2Candidate.table_counts || {}), `${Object.keys(v2Proof1.tableCounts).length} tables`);
    addCheck(checks, blocking, 'v2 table manifests match candidate metadata', sameJSON(v2Proof1.tableManifestHashes, v2Candidate.table_manifest_hashes || {}), `${Object.keys(v2Proof1.tableManifestHashes).length} table hashes`);
    addCheck(checks, blocking, 'learning_state manifest is expected repaired manifest', v2Proof1.tableManifestHashes.learning_state === EXPECTED_V2_STATE_MANIFEST, v2Proof1.tableManifestHashes.learning_state);
    addCheck(checks, blocking, 'Parent learning_state manifest is verified v1 manifest', parentProof.tableManifestHashes.learning_state === EXPECTED_PARENT_STATE_MANIFEST, parentProof.tableManifestHashes.learning_state);
    addCheck(checks, blocking, 'Candidate row identities unchanged from parent', delta.missingInV2.length === 0 && delta.extraInV2.length === 0, `missing=${delta.missingInV2.length}, extra=${delta.extraInV2.length}`);
    addCheck(checks, blocking, 'Exactly 111 rows changed', delta.changed.length === EXPECTED_STATE_ROWS, `${delta.changed.length} changed rows`);
    addCheck(checks, blocking, 'Only learning_state changed', sameJSON(delta.changedTables, ['learning_state']), delta.changedTables.join(', ') || 'none');
    addCheck(checks, blocking, 'All 111 learning_state rows carry explicit first_seen_at', v2StateRows.length === EXPECTED_STATE_ROWS && stateRowsWithFirstSeen === EXPECTED_STATE_ROWS, `${stateRowsWithFirstSeen}/${v2StateRows.length}`);
    addCheck(checks, blocking, 'No tombstone semantics changed', delta.tombstoneChanges.length === 0 && v2Proof1.tombstoneRows === parentProof.tombstoneRows, `changes=${delta.tombstoneChanges.length}, v2 tombstones=${v2Proof1.tombstoneRows}`);
    addCheck(checks, blocking, 'Source-device provenance unchanged', sameJSON(v2Candidate.source_devices || [], parentCandidate.source_devices || []), `${(v2Candidate.source_devices || []).length} source device(s)`);

    const d = v2Candidate.diagnostics || {};
    addCheck(checks, blocking, 'v2 diagnostics identify Authority revision 2', Number(d.authorityRevision) === 2, d.authorityRevision);
    addCheck(checks, blocking, 'v2 diagnostics parent candidate matches ACTIVE v1', d.parentCandidateKey === EXPECTED_PARENT_CANDIDATE && Number(d.parentHeadVersion) === EXPECTED_PARENT_HEAD_VERSION && d.parentManifestHash === EXPECTED_PARENT_MANIFEST, `${d.parentCandidateKey || 'missing'} · head v${d.parentHeadVersion ?? '?'}`);
    addCheck(checks, blocking, 'v2 diagnostics record targeted FirstSeen repair', d.repair === 'explicit-first_seen_at' && d.changedTable === 'learning_state' && Number(d.changedRows) === EXPECTED_STATE_ROWS && Number(d.firstSeenEvidenceRows) === EXPECTED_STATE_ROWS && Number(d.sourceFirstSeenDisagreements) === 0, `repair=${d.repair || 'missing'} · changed=${d.changedRows ?? '?'} · evidence=${d.firstSeenEvidenceRows ?? '?'} · disagreements=${d.sourceFirstSeenDisagreements ?? '?'}`);

    const repeatability = v2Proof1.snapshotManifestHash === v2Proof2.snapshotManifestHash
      && sameJSON(v2Proof1.tableCounts, v2Proof2.tableCounts)
      && sameJSON(v2Proof1.tableManifestHashes, v2Proof2.tableManifestHashes);
    addCheck(checks, blocking, 'Manifest proof repeatability', repeatability, repeatability ? 'PASS' : 'recomputed proof differs');

    if (v2Proof1.tombstoneRows === 0) warnings.push('No explicit tombstones exist in current real data; tombstone behavior remains unexercised.');
    warnings.push('This is read-only promotion preflight. ACTIVE Head remains v1; the verified v2 candidate remains inactive.');
    warnings.push('The next step must use a separate narrow revision-promotion RPC that requires the current Head to be exactly v1 and atomically advances it to this exact v2 candidate.');
    warnings.push('No Canonical mirror, localStorage, Progress, Review, Study, Editor, or live WLP data is modified here.');

    const promotionEligible = blocking.length === 0;
    return {
      format: 'WLP_CANONICAL_AUTHORITY_V2_PROMOTION_PREFLIGHT',
      version: 1,
      appVersion: APP_VERSION,
      generatedAt: new Date().toISOString(),
      mode: 'read-only-authority-v2-promotion-preflight',
      head: clone(head),
      parentCandidate: {
        candidateKey: parentCandidate.candidate_key,
        status: parentCandidate.status,
        migrationVersion: String(parentCandidate.migration_version || ''),
        manifestHash: parentCandidate.snapshot_manifest_hash,
        canonicalRows: Number(parentCandidate.canonical_row_count || 0)
      },
      v2Candidate: {
        candidateKey: v2Candidate.candidate_key,
        status: v2Candidate.status,
        authorityRevision: Number(d.authorityRevision || 0),
        revisionTicketHash: v2Candidate.cutover_ticket_hash,
        repairPlanHash: v2Candidate.source_plan_hash,
        migrationVersion: String(v2Candidate.migration_version || ''),
        manifestHash: v2Candidate.snapshot_manifest_hash,
        canonicalRows: Number(v2Candidate.canonical_row_count || 0),
        changedLearningStateRows: Number(d.changedRows || 0),
        firstSeenEvidenceRows: Number(d.firstSeenEvidenceRows || 0),
        sourceFirstSeenDisagreements: Number(d.sourceFirstSeenDisagreements || 0)
      },
      summary: {
        parentFingerprints: parentProof.rows,
        candidateRows: v2Proof1.rows,
        payloadHashesVerified: payloadCheck.verified,
        payloadHashMismatches: payloadCheck.mismatches.length,
        changedRows: delta.changed.length,
        changedTables: delta.changedTables.length,
        learningStateRowsWithFirstSeen: stateRowsWithFirstSeen,
        missingRows: delta.missingInV2.length,
        extraRows: delta.extraInV2.length,
        tombstoneChanges: delta.tombstoneChanges.length,
        blockingIssues: blocking.length,
        repeatability,
        headState: 'PARENT_V1_ACTIVE',
        promotionEligible,
        pass: promotionEligible
      },
      hashes: {
        parentManifestHash: parentProof.snapshotManifestHash,
        candidateManifestHash: v2Proof1.snapshotManifestHash,
        parentLearningStateManifestHash: parentProof.tableManifestHashes.learning_state,
        candidateLearningStateManifestHash: v2Proof1.tableManifestHashes.learning_state
      },
      delta: {
        changedTableCounts: delta.changed.reduce((out, row) => { out[row.tableName] = (out[row.tableName] || 0) + 1; return out; }, {}),
        unchangedRows: EXPECTED_ROWS - delta.changed.length,
        missingInV2: delta.missingInV2,
        extraInV2: delta.extraInV2,
        tombstoneChanges: delta.tombstoneChanges
      },
      checks,
      issues: { blocking, warnings, payloadHashMismatches: payloadCheck.mismatches },
      invariants: {
        noCloudWrites: true,
        noAuthorityHeadPromotion: true,
        activeHeadStillV1: head.candidate_key === EXPECTED_PARENT_CANDIDATE && Number(head.head_version) === EXPECTED_PARENT_HEAD_VERSION,
        v2CandidateStillInactive: head.candidate_key !== EXPECTED_V2_CANDIDATE,
        noCanonicalMirrorWrites: true,
        noIndexedDbWrites: true,
        noLegacyLocalStorageWrites: true,
        noLiveWlpWrites: true,
        fullCandidatePayloadHashesReverified: payloadCheck.verified === EXPECTED_ROWS && payloadCheck.mismatches.length === 0,
        parentChildIdentitySetEqual: delta.missingInV2.length === 0 && delta.extraInV2.length === 0,
        onlyLearningStateChanged: sameJSON(delta.changedTables, ['learning_state']),
        explicitFirstSeenComplete: stateRowsWithFirstSeen === EXPECTED_STATE_ROWS,
        manifestProofRepeatable: repeatability
      }
    };
  }

  function setBusy(value) {
    state.busy = value;
    const run = $('run-first-seen-promotion-preflight');
    if (run) run.disabled = value;
  }
  function setStatus(message, kind = '') {
    const el = $('first-seen-promotion-preflight-status');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('success', 'error');
    if (kind) el.classList.add(kind);
  }
  function render(report) {
    $('first-seen-promotion-preflight-panel')?.classList.remove('hidden');
    const s = report.summary || {};
    $('first-seen-promotion-preflight-result').textContent = s.pass ? 'PASS' : 'BLOCKED';
    $('first-seen-promotion-preflight-rows').textContent = Number(s.candidateRows || 0).toLocaleString();
    $('first-seen-promotion-preflight-hashes').textContent = Number(s.payloadHashesVerified || 0).toLocaleString();
    $('first-seen-promotion-preflight-changed').textContent = Number(s.changedRows || 0).toLocaleString();
    $('first-seen-promotion-preflight-firstseen').textContent = Number(s.learningStateRowsWithFirstSeen || 0).toLocaleString();
    $('first-seen-promotion-preflight-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('first-seen-promotion-preflight-head').textContent = s.headState || '—';
    $('first-seen-promotion-preflight-eligible').textContent = s.promotionEligible ? 'YES' : 'NO';
    $('first-seen-promotion-preflight-repeat').textContent = s.repeatability ? 'PASS' : 'FAIL';
    $('first-seen-promotion-preflight-key').textContent = report.v2Candidate?.candidateKey || '';
    $('first-seen-promotion-preflight-manifest').textContent = report.hashes?.candidateManifestHash || '';
    const body = $('first-seen-promotion-preflight-proof-body');
    if (body) {
      body.innerHTML = '';
      (report.checks || []).forEach(check => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(check.name)}</td><td>${check.pass ? 'PASS' : 'FAIL'}</td><td>${escapeHtml(check.evidence)}</td>`;
        body.appendChild(tr);
      });
    }
    const notes = $('first-seen-promotion-preflight-notes');
    if (notes) {
      notes.innerHTML = '';
      [...(report.issues?.blocking || []).map(x => `BLOCKING · ${x}`), ...(report.issues?.warnings || [])].forEach(note => {
        const li = document.createElement('li'); li.textContent = note; notes.appendChild(li);
      });
    }
    const exp = $('export-first-seen-promotion-preflight');
    if (exp) exp.disabled = false;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-v2-promotion-preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function run() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Re-verifying ACTIVE v1 parent and full Authority v2 Candidate…', '');
    try {
      state.report = await buildReport();
      render(state.report);
      setStatus(state.report.summary.pass
        ? `Authority v2 Promotion Preflight PASS · ${state.report.summary.candidateRows.toLocaleString()} rows · ${state.report.summary.payloadHashesVerified.toLocaleString()} payload hashes · ${state.report.summary.changedRows} targeted learning_state changes · promotion eligible.`
        : `Authority v2 Promotion Preflight BLOCKED · ${state.report.summary.blockingIssues} issue(s). ACTIVE Head remains v1.`,
        state.report.summary.pass ? 'success' : 'error');
    } catch (error) {
      console.error('WLP Authority v2 Promotion Preflight:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function init() {
    $('run-first-seen-promotion-preflight')?.addEventListener('click', run);
    $('export-first-seen-promotion-preflight')?.addEventListener('click', exportReport);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
