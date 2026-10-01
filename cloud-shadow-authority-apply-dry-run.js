/* WLP Canonical Authority Apply Dry Run v1.
   Builds a deterministic projected local Canonical mirror from the ACTIVE Authority
   and the current fresh Local Scan. It performs no Cloud writes, no IndexedDB writes,
   no localStorage writes, and no Cloud -> WLP apply. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.206-authority-apply-dry-run-v1';
  const HASH_BATCH = 128;
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
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
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
      user_link_categories: item => item.category_id,
      user_links: item => item.link_id,
      user_preferences: item => item.section
    };
    return String(keys[table]?.(row) || '');
  }

  function isExplicitTombstone(row) {
    return Boolean(row && typeof row === 'object' && row.deleted_at);
  }

  async function flattenLocal(canonical) {
    const rows = [];
    for (const [tableName, tableRows] of Object.entries(canonical.tables || {})) {
      for (const payload of tableRows || []) {
        const rowKey = tablePrimaryKey(tableName, payload);
        if (!rowKey) throw new Error(`${tableName}: local Canonical row has no stable row key.`);
        rows.push({
          tableName,
          rowKey,
          payloadHash: await sha256(stableStringify(payload)),
          tombstone: isExplicitTombstone(payload),
          payload: clone(payload)
        });
      }
    }
    rows.sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
    return rows;
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Apply Dry Run blocked: expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,status,canonical_row_count,snapshot_manifest_hash,table_counts,table_manifest_hashes,cutover_ticket_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,source_devices',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Apply Dry Run blocked: expected exactly one candidate row for ACTIVE Authority, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchAuthorityRows(api, candidateKey) {
    return api.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  async function verifyAuthorityPayloads(rows) {
    let verified = 0;
    const mismatches = [];
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        if (hash !== row.payload_hash) mismatches.push(`${row.table_name}|${row.row_key}: stored ${row.payload_hash}, computed ${hash}`);
        else verified += 1;
      });
      setStatus(`Building Apply Dry Run… ${Math.min(start + batch.length, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} Authority payload hashes checked.`, '');
    }
    return { verified, mismatches };
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

  function buildPlan(localRows, authorityRows) {
    const localMap = new Map(localRows.map(row => [identity(row.tableName, row.rowKey), row]));
    const authorityMap = new Map(authorityRows.map(row => [identity(row.table_name, row.row_key), row]));
    const keys = [...new Set([...localMap.keys(), ...authorityMap.keys()])].sort();
    const summary = { noop: 0, insert: 0, replace: 0, tombstone: 0, localOnlyBlocked: 0 };
    const perTable = {};
    const actions = [];

    function bucket(tableName) {
      if (!perTable[tableName]) perTable[tableName] = { local: 0, authority: 0, noop: 0, insert: 0, replace: 0, tombstone: 0, localOnlyBlocked: 0 };
      return perTable[tableName];
    }
    localRows.forEach(row => { bucket(row.tableName).local += 1; });
    authorityRows.forEach(row => { bucket(row.table_name).authority += 1; });

    keys.forEach(key => {
      const local = localMap.get(key);
      const authority = authorityMap.get(key);
      const tableName = local?.tableName || authority?.table_name || 'unknown';
      const rowKey = local?.rowKey || authority?.row_key || key;
      const b = bucket(tableName);

      if (!authority) {
        summary.localOnlyBlocked += 1; b.localOnlyBlocked += 1;
        actions.push({
          tableName, rowKey, action: 'BLOCK_LOCAL_ONLY',
          localHash: local?.payloadHash || null,
          authorityHash: null,
          reason: 'Authority absence is not a deletion signal; preserve local row and block convergence until reconciled.'
        });
        return;
      }

      if (!local) {
        const action = Boolean(authority.tombstone) ? 'TOMBSTONE' : 'INSERT';
        if (action === 'TOMBSTONE') { summary.tombstone += 1; b.tombstone += 1; }
        else { summary.insert += 1; b.insert += 1; }
        actions.push({
          tableName, rowKey, action,
          localHash: null,
          authorityHash: authority.payload_hash,
          localTombstone: null,
          authorityTombstone: Boolean(authority.tombstone)
        });
        return;
      }

      const same = local.payloadHash === authority.payload_hash && Boolean(local.tombstone) === Boolean(authority.tombstone);
      if (same) {
        summary.noop += 1; b.noop += 1;
        return;
      }

      if (Boolean(authority.tombstone) && !Boolean(local.tombstone)) {
        summary.tombstone += 1; b.tombstone += 1;
        actions.push({
          tableName, rowKey, action: 'TOMBSTONE',
          localHash: local.payloadHash,
          authorityHash: authority.payload_hash,
          localTombstone: Boolean(local.tombstone),
          authorityTombstone: true
        });
      } else {
        summary.replace += 1; b.replace += 1;
        actions.push({
          tableName, rowKey, action: 'REPLACE',
          localHash: local.payloadHash,
          authorityHash: authority.payload_hash,
          localTombstone: Boolean(local.tombstone),
          authorityTombstone: Boolean(authority.tombstone)
        });
      }
    });

    return { summary, perTable, actions };
  }

  function buildProjectedRows(localRows, authorityRows) {
    const projected = new Map(localRows.map(row => [identity(row.tableName, row.rowKey), {
      tableName: row.tableName,
      rowKey: row.rowKey,
      payloadHash: row.payloadHash,
      tombstone: Boolean(row.tombstone)
    }]));

    authorityRows.forEach(row => {
      projected.set(identity(row.table_name, row.row_key), {
        tableName: row.table_name,
        rowKey: row.row_key,
        payloadHash: row.payload_hash,
        tombstone: Boolean(row.tombstone)
      });
    });

    return [...projected.values()].sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
  }

  async function run() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Building a deterministic Authority → Local Canonical apply plan in memory only…', '');
    try {
      const pullReport = window.WLPCanonicalAuthorityPullCompare?.getReport?.();
      if (!pullReport?.summary?.pass || !pullReport?.summary?.nextPhaseEligible) {
        throw new Error('Run Pull Authority + Compare Local first on this device and confirm PASS / next-phase eligible.');
      }

      const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
      if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Run Local Scan first on this device.');
      if (snapshot.report?.snapshotHash !== pullReport.local?.snapshotHash) {
        throw new Error('Apply Dry Run blocked: the Local Scan changed after Pull Compare. Run Pull Authority + Compare Local again.');
      }

      const migration = window.WLPCanonicalMigrationDryRun;
      if (!migration?.buildCanonical) throw new Error('Canonical Migration v2 transformer is unavailable. Reload this diagnostics page.');
      const api = window.WLPCloudShadowSupabase;
      if (!api?.fetchPaged || !api?.ensureSession || !api?.getDevice) throw new Error('Supabase Shadow transport is unavailable.');
      await api.ensureSession();
      const device = await api.getDevice();
      if (device.deviceKey !== pullReport.device?.deviceKey) throw new Error('Apply Dry Run blocked: current device identity differs from the Pull Compare report.');

      const localCanonical = await migration.buildCanonical(snapshot);
      if ((localCanonical.blocking || []).length) throw new Error(`Apply Dry Run blocked: local Canonical migration has ${localCanonical.blocking.length} blocking issue(s).`);
      if (localCanonical.hashes?.fullCanonicalHash !== pullReport.local?.fullCanonicalHash) {
        throw new Error('Apply Dry Run blocked: rebuilt local Canonical hash no longer matches the Pull Compare anchor.');
      }
      const localRows = await flattenLocal(localCanonical);

      const head = await fetchHead(api);
      if (head.candidate_key !== pullReport.authority?.head?.candidate_key || Number(head.head_version || 0) !== Number(pullReport.authority?.head?.head_version || 0)) {
        throw new Error('Apply Dry Run blocked: ACTIVE Authority Head changed after Pull Compare. Run Pull Authority + Compare Local again.');
      }
      const candidate = await fetchCandidate(api, head.candidate_key);
      if (candidate.status !== 'verified') throw new Error(`Apply Dry Run blocked: ACTIVE candidate status is ${candidate.status || 'missing'}, not verified.`);
      const authorityRows = await fetchAuthorityRows(api, head.candidate_key);
      const payloadCheck = await verifyAuthorityPayloads(authorityRows);

      const blocking = [];
      if (payloadCheck.mismatches.length) blocking.push(`${payloadCheck.mismatches.length} Authority payload hash mismatch(es).`);
      if (authorityRows.length !== Number(head.canonical_row_count || 0)) blocking.push(`Authority row count mismatch: head=${head.canonical_row_count}, pulled=${authorityRows.length}.`);
      if (authorityRows.length !== Number(candidate.canonical_row_count || 0)) blocking.push(`Candidate row count mismatch: candidate=${candidate.canonical_row_count}, pulled=${authorityRows.length}.`);
      if (head.snapshot_manifest_hash !== candidate.snapshot_manifest_hash) blocking.push('Authority Head manifest does not match candidate manifest.');
      if (head.cutover_ticket_hash !== candidate.cutover_ticket_hash) blocking.push('Authority Head Cutover Ticket does not match candidate.');
      if (head.migration_version !== candidate.migration_version) blocking.push('Authority Head migration version does not match candidate.');
      if (head.namespace_uuid !== candidate.namespace_uuid) blocking.push('Authority Head namespace UUID does not match candidate.');
      if (head.card_mapping_hash !== candidate.card_mapping_hash) blocking.push('Authority Head Card Mapping hash does not match candidate.');
      if (head.core_library_hash !== candidate.core_library_hash) blocking.push('Authority Head Core Library hash does not match candidate.');

      const planA = buildPlan(localRows, authorityRows);
      const planB = buildPlan(localRows, authorityRows);
      const planHashA = await sha256(stableStringify({ headVersion: Number(head.head_version || 0), candidateKey: head.candidate_key, localFullCanonicalHash: localCanonical.hashes?.fullCanonicalHash || '', actions: planA.actions }));
      const planHashB = await sha256(stableStringify({ headVersion: Number(head.head_version || 0), candidateKey: head.candidate_key, localFullCanonicalHash: localCanonical.hashes?.fullCanonicalHash || '', actions: planB.actions }));
      const repeatability = planHashA === planHashB && stableStringify(planA.summary) === stableStringify(planB.summary) && stableStringify(planA.perTable) === stableStringify(planB.perTable);
      if (!repeatability) blocking.push('Apply plan repeatability failed inside the same run.');
      if (planA.summary.localOnlyBlocked) blocking.push(`${planA.summary.localOnlyBlocked} local-only row(s) cannot be deleted by Authority absence; reconcile them before apply.`);

      const projectedRows = buildProjectedRows(localRows, authorityRows);
      const projectedProof = await manifestProof(projectedRows);
      const authorityProof = await manifestProof(authorityRows);
      if (authorityProof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Recomputed Authority manifest does not match ACTIVE Head manifest.');
      if (projectedProof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Projected local Canonical mirror does not converge exactly to the ACTIVE Authority manifest.');
      compareObjects(candidate.table_counts || {}, authorityProof.tableCounts, 'Authority table count', blocking);
      compareObjects(candidate.table_manifest_hashes || {}, authorityProof.tableManifestHashes, 'Authority table manifest', blocking);
      compareObjects(authorityProof.tableCounts, projectedProof.tableCounts, 'Projected table count', blocking);
      compareObjects(authorityProof.tableManifestHashes, projectedProof.tableManifestHashes, 'Projected table manifest', blocking);

      const sourceDevice = (candidate.source_devices || []).find(item => item.device_key === device.deviceKey) || null;
      const sourceSnapshotMatch = sourceDevice ? sourceDevice.full_canonical_hash === localCanonical.hashes?.fullCanonicalHash : null;
      if (sourceSnapshotMatch !== true) blocking.push('Apply Dry Run requires this source device to remain anchored to the exact snapshot used for Authority v1.');
      if (pullReport.summary?.localOnly !== 0) blocking.push(`Pull Compare reported ${pullReport.summary.localOnly} local-only row(s); safe convergence is blocked.`);

      const projectedMatchesAuthority = projectedProof.snapshotManifestHash === authorityProof.snapshotManifestHash;
      const plannedMutations = planA.summary.insert + planA.summary.replace + planA.summary.tombstone;
      const pass = blocking.length === 0 && projectedMatchesAuthority && repeatability;
      const warnings = [
        `${plannedMutations.toLocaleString()} row mutation(s) are planned for a future isolated Canonical local mirror on this device; ${planA.summary.noop.toLocaleString()} row(s) are already identical and require no write.`,
        'This dry run targets the future Canonical local mirror shape only. It does not reverse-map Authority rows into legacy WLP localStorage and does not modify Study / Review / Editor data.',
        'Authority absence is never interpreted as deletion. Any local-only row blocks apply until it is explicitly reconciled or represented by a tombstone.',
        'No explicit tombstones exist in Authority v1 real data, so the tombstone action path is implemented in planning but remains empirically unexercised.',
        'No Cloud write, IndexedDB write, localStorage write, or WLP write occurs in this step.'
      ];

      state.report = {
        format: 'WLP_CANONICAL_AUTHORITY_APPLY_DRY_RUN',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-in-memory-authority-apply-dry-run',
        device: { deviceKey: device.deviceKey, label: device.label || '', platform: device.platform || '' },
        authority: {
          candidateKey: head.candidate_key,
          headVersion: Number(head.head_version || 0),
          snapshotManifestHash: head.snapshot_manifest_hash,
          canonicalRows: Number(head.canonical_row_count || 0)
        },
        local: {
          snapshotHash: snapshot.report?.snapshotHash || '',
          fullCanonicalHash: localCanonical.hashes?.fullCanonicalHash || '',
          canonicalRows: localRows.length,
          sourceSnapshotMatch
        },
        summary: {
          localRows: localRows.length,
          authorityRows: authorityRows.length,
          alreadySame: planA.summary.noop,
          plannedInsert: planA.summary.insert,
          plannedReplace: planA.summary.replace,
          plannedTombstone: planA.summary.tombstone,
          localOnlyBlocked: planA.summary.localOnlyBlocked,
          plannedMutations,
          projectedRows: projectedRows.length,
          projectedMatchesAuthority,
          payloadHashesVerified: payloadCheck.verified,
          payloadHashMismatches: payloadCheck.mismatches.length,
          blockingIssues: blocking.length,
          repeatability,
          pass
        },
        hashes: {
          applyPlanHash: planHashA,
          authorityManifestHash: authorityProof.snapshotManifestHash,
          projectedManifestHash: projectedProof.snapshotManifestHash,
          localFullCanonicalHash: localCanonical.hashes?.fullCanonicalHash || ''
        },
        perTable: planA.perTable,
        actions: planA.actions,
        issues: { blocking, warnings, payloadHashMismatches: payloadCheck.mismatches },
        invariants: {
          noCloudWrites: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noLocalStorageWrites: true,
          noIndexedDBWrites: true,
          noAbsenceBasedDeletion: true,
          legacyReverseMappingNotAttempted: true,
          projectedMirrorBuiltInMemoryOnly: true,
          activeAuthorityPayloadsReverified: payloadCheck.verified === authorityRows.length && payloadCheck.mismatches.length === 0
        }
      };

      render(state.report);
      setStatus(
        `Authority Apply Dry Run ${pass ? 'PASS' : 'CHECK'} · Local ${localRows.length.toLocaleString()} → projected ${projectedRows.length.toLocaleString()} · no-op ${planA.summary.noop.toLocaleString()} · insert ${planA.summary.insert.toLocaleString()} · replace ${planA.summary.replace.toLocaleString()} · tombstone ${planA.summary.tombstone.toLocaleString()} · local-only blockers ${planA.summary.localOnlyBlocked.toLocaleString()} · projected manifest ${projectedMatchesAuthority ? 'MATCH' : 'MISMATCH'} · no writes.`,
        pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-authority-apply-dry-run-complete'));
    } catch (error) {
      console.error('WLP Canonical Authority Apply Dry Run:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('authority-apply-local').textContent = Number(s.localRows || 0).toLocaleString();
    $('authority-apply-authority').textContent = Number(s.authorityRows || 0).toLocaleString();
    $('authority-apply-noop').textContent = Number(s.alreadySame || 0).toLocaleString();
    $('authority-apply-insert').textContent = Number(s.plannedInsert || 0).toLocaleString();
    $('authority-apply-replace').textContent = Number(s.plannedReplace || 0).toLocaleString();
    $('authority-apply-tombstone').textContent = Number(s.plannedTombstone || 0).toLocaleString();
    $('authority-apply-blocked').textContent = Number(s.localOnlyBlocked || 0).toLocaleString();
    $('authority-apply-projected').textContent = Number(s.projectedRows || 0).toLocaleString();
    $('authority-apply-result').textContent = s.pass ? 'PASS' : 'FAIL';
    $('authority-apply-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('authority-apply-plan-hash').textContent = report.hashes?.applyPlanHash || '—';
    $('authority-apply-projected-hash').textContent = report.hashes?.projectedManifestHash || '—';

    const body = $('authority-apply-table-body');
    body.innerHTML = '';
    Object.entries(report.perTable || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([tableName, counts]) => {
      const tr = document.createElement('tr');
      [tableName, counts.local, counts.authority, counts.noop, counts.insert, counts.replace, counts.tombstone, counts.localOnlyBlocked].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value ?? ''); tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const notes = $('authority-apply-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No Apply Dry Run issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('authority-apply-dry-run-panel').classList.remove('hidden');
    $('export-authority-apply-dry-run').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-apply-dry-run-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('authority-apply-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const pullReport = window.WLPCanonicalAuthorityPullCompare?.getReport?.();
    const eligible = Boolean(pullReport?.summary?.pass && pullReport?.summary?.nextPhaseEligible && pullReport?.summary?.sourceSnapshotMatch === true && pullReport?.summary?.localOnly === 0);
    $('run-authority-apply-dry-run').disabled = state.busy || !cloud.configured || !cloud.signedIn || !eligible;
    $('export-authority-apply-dry-run').disabled = state.busy || !state.report;
  }

  function resetAfterScan() {
    state.report = null;
    $('export-authority-apply-dry-run').disabled = true;
    setStatus('Fresh Local Scan captured. Run Pull Authority + Compare Local again before this Apply Dry Run.', '');
    refreshButtons();
  }

  function resetAfterPull() {
    state.report = null;
    $('export-authority-apply-dry-run').disabled = true;
    setStatus('Pull Compare completed. If it is PASS / next-phase eligible, run the Apply Dry Run. No local write will occur.', '');
    refreshButtons();
  }

  window.WLPCanonicalAuthorityApplyDryRun = Object.freeze({ getReport: () => state.report });

  function init() {
    $('run-authority-apply-dry-run').addEventListener('click', run);
    $('export-authority-apply-dry-run').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', resetAfterScan);
    window.addEventListener('wlp-canonical-authority-pull-compare-complete', resetAfterPull);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
