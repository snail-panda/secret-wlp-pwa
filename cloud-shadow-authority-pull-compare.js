/* WLP Canonical Authority read-only Pull + Local Compare v1.
   Reads the ACTIVE Canonical Authority and compares it with a freshly scanned
   local Canonical snapshot. No Cloud write and no Cloud -> WLP apply path exists. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.205-authority-pull-compare-v1';
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
          tombstone: isExplicitTombstone(payload)
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
    if (rows.length !== 1) throw new Error(`Authority Pull blocked: expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Authority Pull blocked: expected exactly one candidate row for the ACTIVE head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchAuthorityRows(api, candidateKey) {
    return api.fetchPaged(
      'wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`
    );
  }

  async function manifestProof(rows) {
    const hashRows = rows.map(row => ({
      tableName: row.table_name,
      rowKey: row.row_key,
      tombstone: Boolean(row.tombstone),
      payloadHash: row.payload_hash
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

  async function verifyAuthorityPayloads(rows) {
    let verified = 0;
    const mismatches = [];
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        if (hash !== row.payload_hash) {
          mismatches.push(`${row.table_name}|${row.row_key}: stored ${row.payload_hash}, computed ${hash}`);
        } else verified += 1;
      });
      setStatus(`Reading ACTIVE Authority payloads… ${Math.min(start + batch.length, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} hashes checked.`, '');
    }
    return { verified, mismatches };
  }

  function compareRows(localRows, authorityRows) {
    const localMap = new Map(localRows.map(row => [identity(row.tableName, row.rowKey), row]));
    const cloudMap = new Map(authorityRows.map(row => [identity(row.table_name, row.row_key), row]));
    const keys = [...new Set([...localMap.keys(), ...cloudMap.keys()])].sort();
    const summary = { same: 0, authorityOnly: 0, localOnly: 0, different: 0 };
    const perTable = {};
    const differences = { authorityOnly: [], localOnly: [], different: [] };

    function bucket(tableName) {
      if (!perTable[tableName]) perTable[tableName] = { local: 0, authority: 0, same: 0, authorityOnly: 0, localOnly: 0, different: 0 };
      return perTable[tableName];
    }
    localRows.forEach(row => { bucket(row.tableName).local += 1; });
    authorityRows.forEach(row => { bucket(row.table_name).authority += 1; });

    keys.forEach(key => {
      const local = localMap.get(key);
      const cloud = cloudMap.get(key);
      const tableName = local?.tableName || cloud?.table_name || 'unknown';
      const rowKey = local?.rowKey || cloud?.row_key || key;
      const b = bucket(tableName);
      if (!local) {
        summary.authorityOnly += 1; b.authorityOnly += 1;
        differences.authorityOnly.push({ tableName, rowKey, authorityHash: cloud.payload_hash, tombstone: Boolean(cloud.tombstone) });
      } else if (!cloud) {
        summary.localOnly += 1; b.localOnly += 1;
        differences.localOnly.push({ tableName, rowKey, localHash: local.payloadHash, tombstone: Boolean(local.tombstone) });
      } else if (local.payloadHash === cloud.payload_hash && Boolean(local.tombstone) === Boolean(cloud.tombstone)) {
        summary.same += 1; b.same += 1;
      } else {
        summary.different += 1; b.different += 1;
        differences.different.push({
          tableName, rowKey,
          localHash: local.payloadHash,
          authorityHash: cloud.payload_hash,
          localTombstone: Boolean(local.tombstone),
          authorityTombstone: Boolean(cloud.tombstone)
        });
      }
    });
    return { summary, perTable, differences };
  }

  function compareObjects(expected, actual, label, blocking) {
    const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
    [...keys].sort().forEach(key => {
      if (String(expected?.[key] ?? '') !== String(actual?.[key] ?? '')) {
        blocking.push(`${label} mismatch for ${key}: expected ${expected?.[key] ?? '(missing)'}, got ${actual?.[key] ?? '(missing)'}.`);
      }
    });
  }

  async function run() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Pulling the ACTIVE Canonical Authority read-only and rebuilding this device\'s current local Canonical snapshot…', '');
    try {
      const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
      if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Run Local Scan first on this device. Authority Pull Compare always uses a fresh local snapshot.');
      if (snapshot.report?.summary?.errors !== 0 || (snapshot.report?.unexpectedNamespaces || []).length !== 0) {
        throw new Error('Authority Pull Compare blocked: the current Local Scan has errors or unexpected namespaces.');
      }
      const migration = window.WLPCanonicalMigrationDryRun;
      if (!migration?.buildCanonical) throw new Error('Canonical Migration v2 transformer is unavailable. Reload this diagnostics page.');
      const api = window.WLPCloudShadowSupabase;
      if (!api?.fetchPaged || !api?.ensureSession || !api?.getDevice) throw new Error('Supabase Shadow transport is unavailable.');
      await api.ensureSession();
      const device = await api.getDevice();

      const localCanonical = await migration.buildCanonical(snapshot);
      if ((localCanonical.blocking || []).length) throw new Error(`Authority Pull Compare blocked: local Canonical migration has ${localCanonical.blocking.length} blocking issue(s).`);
      const localRows = await flattenLocal(localCanonical);

      const head = await fetchHead(api);
      const candidate = await fetchCandidate(api, head.candidate_key);
      if (candidate.status !== 'verified') throw new Error(`Authority Pull blocked: ACTIVE head candidate status is ${candidate.status || 'missing'}, not verified.`);
      const authorityRows = await fetchAuthorityRows(api, head.candidate_key);
      const payloadCheck = await verifyAuthorityPayloads(authorityRows);
      const proof = await manifestProof(authorityRows);
      const comparison = compareRows(localRows, authorityRows);

      const blocking = [];
      if (payloadCheck.mismatches.length) blocking.push(`${payloadCheck.mismatches.length} Authority payload hash mismatch(es).`);
      if (head.candidate_key !== candidate.candidate_key) blocking.push('Authority Head candidate key does not match fetched candidate metadata.');
      if (head.snapshot_manifest_hash !== candidate.snapshot_manifest_hash) blocking.push('Authority Head manifest does not match candidate manifest.');
      if (proof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Recomputed Authority manifest does not match ACTIVE Head manifest.');
      if (proof.rowCount !== Number(head.canonical_row_count || 0)) blocking.push(`Authority row count mismatch: head=${head.canonical_row_count}, pulled=${proof.rowCount}.`);
      if (proof.rowCount !== Number(candidate.canonical_row_count || 0)) blocking.push(`Candidate row count mismatch: candidate=${candidate.canonical_row_count}, pulled=${proof.rowCount}.`);
      if (head.cutover_ticket_hash !== candidate.cutover_ticket_hash) blocking.push('Authority Head Cutover Ticket does not match candidate.');
      if (head.migration_version !== candidate.migration_version) blocking.push('Authority Head migration version does not match candidate.');
      if (head.namespace_uuid !== candidate.namespace_uuid) blocking.push('Authority Head namespace UUID does not match candidate.');
      if (head.card_mapping_hash !== candidate.card_mapping_hash) blocking.push('Authority Head Card Mapping hash does not match candidate.');
      if (head.core_library_hash !== candidate.core_library_hash) blocking.push('Authority Head Core Library hash does not match candidate.');
      compareObjects(candidate.table_counts || {}, proof.tableCounts, 'Authority table count', blocking);
      compareObjects(candidate.table_manifest_hashes || {}, proof.tableManifestHashes, 'Authority table manifest', blocking);

      const sourceDevice = (candidate.source_devices || []).find(item => item.device_key === device.deviceKey) || null;
      const sourceSnapshotMatch = sourceDevice ? sourceDevice.full_canonical_hash === localCanonical.hashes?.fullCanonicalHash : null;
      if (sourceSnapshotMatch === true && comparison.summary.localOnly !== 0) {
        blocking.push(`Source snapshot anchor matches, but ${comparison.summary.localOnly} local row(s) are absent from Authority. This violates the promoted union invariant.`);
      }

      const freshLocalChanges = sourceSnapshotMatch === false;
      const nextPhaseEligible = blocking.length === 0 && sourceSnapshotMatch === true && comparison.summary.localOnly === 0;
      const pass = blocking.length === 0;
      const warnings = [
        `${comparison.summary.authorityOnly.toLocaleString()} Authority-only row(s) and ${comparison.summary.different.toLocaleString()} differing row(s) are a read-only preview of what a future controlled pull would need to reconcile; they are not applied here.`,
        sourceDevice
          ? (sourceSnapshotMatch ? 'This device still matches the exact staged source snapshot that contributed to the promoted Authority.' : 'This device has changed since the staged source snapshot that contributed to the promoted Authority. Do not proceed to any apply step until those local changes are incorporated into a new Authority revision.')
          : 'This device was not one of the two source devices used to build the promoted Authority; no source-snapshot anchor is available.',
        'No explicit tombstones exist in this Authority revision; deletion convergence remains unexercised by current real data.',
        'This step performs Cloud reads only. No Cloud data is written into WLP or local storage.'
      ];

      state.report = {
        format: 'WLP_CANONICAL_AUTHORITY_PULL_COMPARE',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-active-authority-pull-compare',
        device: { deviceKey: device.deviceKey, label: device.label || '', platform: device.platform || '' },
        authority: { head: clone(head), candidate: clone(candidate) },
        local: {
          snapshotHash: snapshot.report?.snapshotHash || '',
          migrationVersion: localCanonical.migrationVersion,
          namespaceUuid: localCanonical.namespaceUuid,
          cardMappingHash: localCanonical.hashes?.cardMappingHash || '',
          coreLibraryHash: localCanonical.hashes?.coreLibraryHash || '',
          fullCanonicalHash: localCanonical.hashes?.fullCanonicalHash || '',
          canonicalRows: localRows.length,
          sourceDeviceAnchor: clone(sourceDevice),
          sourceSnapshotMatch
        },
        authorityProof: {
          pulledRows: authorityRows.length,
          payloadHashesVerified: payloadCheck.verified,
          payloadHashMismatches: payloadCheck.mismatches.length,
          snapshotManifestHash: proof.snapshotManifestHash,
          tableCounts: proof.tableCounts,
          tableManifestHashes: proof.tableManifestHashes
        },
        summary: {
          headState: 'ACTIVE',
          headVersion: Number(head.head_version || 0),
          authorityRows: authorityRows.length,
          localRows: localRows.length,
          same: comparison.summary.same,
          authorityOnly: comparison.summary.authorityOnly,
          localOnly: comparison.summary.localOnly,
          different: comparison.summary.different,
          sourceSnapshotMatch,
          freshLocalChanges,
          blockingIssues: blocking.length,
          nextPhaseEligible,
          pass
        },
        perTable: comparison.perTable,
        differences: comparison.differences,
        issues: { blocking, warnings, payloadHashMismatches: payloadCheck.mismatches },
        invariants: {
          noCloudWrites: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noLocalStorageWrites: true,
          noAbsenceBasedDeletion: true,
          activeHeadReadOnly: true,
          allAuthorityPayloadHashesReverified: payloadCheck.verified === authorityRows.length && payloadCheck.mismatches.length === 0
        }
      };

      render(state.report);
      setStatus(
        `Authority Pull Compare ${pass ? 'PASS' : 'CHECK'} · Head ACTIVE v${state.report.summary.headVersion} · Authority ${authorityRows.length.toLocaleString()} / Local ${localRows.length.toLocaleString()} · same ${comparison.summary.same.toLocaleString()} · Authority-only ${comparison.summary.authorityOnly.toLocaleString()} · Local-only ${comparison.summary.localOnly.toLocaleString()} · different ${comparison.summary.different.toLocaleString()} · source anchor ${sourceSnapshotMatch === true ? 'MATCH' : sourceSnapshotMatch === false ? 'CHANGED' : 'N/A'} · no apply.`,
        pass ? (nextPhaseEligible ? 'success' : '') : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-authority-pull-compare-complete'));
    } catch (error) {
      console.error('WLP Canonical Authority Pull Compare:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('authority-pull-head').textContent = `${s.headState} v${s.headVersion}`;
    $('authority-pull-cloud-rows').textContent = Number(s.authorityRows || 0).toLocaleString();
    $('authority-pull-local-rows').textContent = Number(s.localRows || 0).toLocaleString();
    $('authority-pull-same').textContent = Number(s.same || 0).toLocaleString();
    $('authority-pull-cloud-only').textContent = Number(s.authorityOnly || 0).toLocaleString();
    $('authority-pull-local-only').textContent = Number(s.localOnly || 0).toLocaleString();
    $('authority-pull-different').textContent = Number(s.different || 0).toLocaleString();
    $('authority-pull-source-match').textContent = s.sourceSnapshotMatch === true ? 'MATCH' : s.sourceSnapshotMatch === false ? 'CHANGED' : 'N/A';
    $('authority-pull-compare-result').textContent = s.pass ? (s.nextPhaseEligible ? 'PASS' : 'CHECK') : 'FAIL';
    $('authority-pull-compare-result').className = s.pass && s.nextPhaseEligible ? 'compare-pass' : 'compare-check';
    $('authority-pull-candidate-key').textContent = report.authority?.head?.candidate_key || '—';
    $('authority-pull-manifest').textContent = report.authorityProof?.snapshotManifestHash || '—';

    const body = $('authority-pull-table-body');
    body.innerHTML = '';
    Object.entries(report.perTable || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([tableName, counts]) => {
      const tr = document.createElement('tr');
      [tableName, counts.local, counts.authority, counts.same, counts.authorityOnly, counts.localOnly, counts.different].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value ?? ''); tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const notes = $('authority-pull-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No pull/compare issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('authority-pull-compare-panel').classList.remove('hidden');
    $('export-authority-pull-compare').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-pull-compare-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('authority-pull-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    const scanClean = Boolean(snapshot && snapshot.report?.summary?.errors === 0 && (snapshot.report?.unexpectedNamespaces || []).length === 0);
    $('run-authority-pull-compare').disabled = state.busy || !cloud.configured || !cloud.signedIn || !scanClean;
    $('export-authority-pull-compare').disabled = state.busy || !state.report;
  }

  function resetAfterScan() {
    state.report = null;
    $('export-authority-pull-compare').disabled = true;
    if (!$('authority-pull-compare-panel').classList.contains('hidden')) {
      setStatus('Fresh Local Scan captured. Pull the ACTIVE Authority again to compare against this exact device state.', '');
    }
    refreshButtons();
  }

  window.WLPCanonicalAuthorityPullCompare = Object.freeze({ getReport: () => state.report });

  function init() {
    $('run-authority-pull-compare').addEventListener('click', run);
    $('export-authority-pull-compare').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', resetAfterScan);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
