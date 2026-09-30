/* WLP Canonical Merge Materialization v1.
   Builds a content-addressed merged Canonical snapshot manifest in memory from
   the latest read-only Merge Audit + successful Merge Simulation. Divergent
   rows are materialized as payloads in memory; unchanged rows reuse their
   verified staged payload hashes. This file performs no Supabase writes and
   never applies Cloud data to WLP. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.200-canonical-merge-materialization-v1';
  const CORE_TABLES = new Set(['cards', 'card_content', 'card_classification']);
  const SAFE_DIVERGENT_TABLES = new Set(['learning_state', 'learner_profile', 'learner_route_state', 'user_preferences']);
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

  function parseTime(value) {
    if (!value) return null;
    const time = Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
  }
  function maxTime(values) {
    const times = values.map(parseTime).filter(value => value !== null);
    return times.length ? Math.max(...times) : null;
  }
  function isoOrNull(time) { return time == null ? null : new Date(time).toISOString(); }
  function maxNumber(values) {
    const nums = values.map(value => Number(value)).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  function allEqual(values) { return new Set(values.map(stableStringify)).size <= 1; }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  function shortDevice(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
  }

  function stripRouteVolatileIds(value) {
    if (Array.isArray(value)) return value.map(stripRouteVolatileIds);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        if (key === 'connectionId' || key === 'exemplarId') return;
        out[key] = stripRouteVolatileIds(value[key]);
      });
      return out;
    }
    return value;
  }

  function latestVariant(variants, fields) {
    const ranked = variants.map(variant => {
      const times = fields.map(field => parseTime(variant.payload?.[field])).filter(value => value !== null);
      return { variant, time: times.length ? Math.max(...times) : -Infinity };
    }).sort((a, b) => {
      if (b.time !== a.time) return b.time - a.time;
      return String(a.variant.deviceKey).localeCompare(String(b.variant.deviceKey));
    });
    return ranked[0]?.variant || variants[0] || null;
  }

  function materializeProfile(collision, decision) {
    const selected = collision.variants.find(variant => variant.deviceKey === decision.selectedDevice);
    if (!selected) throw new Error(`Materialization could not find selected profile source for ${collision.rowKey}.`);
    return clone(selected.payload);
  }

  function materializePreference(collision, decision) {
    const variants = [...collision.variants].sort((a, b) => String(a.deviceKey).localeCompare(String(b.deviceKey)));
    const base = clone(variants[0]?.payload || {});
    base.payload = clone(decision.simulated?.normalizedPayload || {});
    base.revision = maxNumber(variants.map(variant => variant.payload?.revision)) || 1;
    base.updated_at = isoOrNull(maxTime(variants.map(variant => variant.payload?.updated_at)));
    const updatedBy = variants.map(variant => variant.payload?.updated_by_device ?? null);
    base.updated_by_device = allEqual(updatedBy) ? clone(updatedBy[0]) : null;
    return base;
  }

  function materializeRouteState(collision) {
    const variants = collision.variants;
    const recordsByVariant = variants.map(variant => variant.payload?.route_state?.records || {});
    const allKeys = [...new Set(recordsByVariant.flatMap(records => Object.keys(records)))].sort();
    const mergedRecords = {};

    for (const key of allKeys) {
      const present = variants.map((variant, index) => ({ variant, value: recordsByVariant[index][key] })).filter(item => item.value !== undefined);
      if (present.length === 1) {
        mergedRecords[key] = clone(present[0].value);
        continue;
      }
      const normalized = present.map(item => stripRouteVolatileIds(item.value));
      if (!allEqual(normalized)) throw new Error(`Route record ${key} stopped being semantically equivalent during materialization.`);
      present.sort((a, b) => {
        const ta = parseTime(a.value?.updatedAt) ?? parseTime(a.variant.payload?.updated_at) ?? 0;
        const tb = parseTime(b.value?.updatedAt) ?? parseTime(b.variant.payload?.updated_at) ?? 0;
        if (tb !== ta) return tb - ta;
        return String(a.variant.deviceKey).localeCompare(String(b.variant.deviceKey));
      });
      mergedRecords[key] = clone(present[0].value);
    }

    const leader = latestVariant(variants, ['updated_at']);
    const out = clone(leader?.payload || {});
    const mergedUpdated = isoOrNull(maxTime(variants.flatMap(variant => [variant.payload?.updated_at, variant.payload?.route_state?.updatedAt])));
    out.route_state = clone(out.route_state || {});
    out.route_state.records = mergedRecords;
    out.route_state.updatedAt = mergedUpdated;
    out.updated_at = mergedUpdated;
    out.revision = maxNumber(variants.map(variant => variant.payload?.revision)) || 1;
    return out;
  }

  function materializeLearningState(collision, decision) {
    if (!decision.simulated) throw new Error(`Learning-state materialization lacks simulated fields for ${collision.rowKey}.`);
    const leader = latestVariant(collision.variants, [
      'updated_at', 'last_seen_at', 'last_studied_at', 'last_reviewed_at', 'last_practiced_at', 'last_attention_updated_at'
    ]);
    const out = clone(leader?.payload || {});
    Object.entries(decision.simulated).forEach(([key, value]) => { out[key] = clone(value); });
    out.card_id = collision.rowKey;
    if (!out.field_meta || typeof out.field_meta !== 'object' || Array.isArray(out.field_meta)) out.field_meta = {};
    // source_snapshot is migration-only evidence from one device and cannot
    // truthfully represent a merged current-state row. The original variants
    // remain preserved in the audit/simulation evidence instead.
    delete out.source_snapshot;
    return out;
  }

  function materializeCollision(collision, decision) {
    if (!decision || decision.status !== 'RESOLVED_IN_SIMULATION') {
      throw new Error(`Collision ${collision.tableName}|${collision.rowKey} has no resolved simulation decision.`);
    }
    switch (decision.rule) {
      case 'profile-later-timestamp-same-content': return materializeProfile(collision, decision);
      case 'route-state-semantic-union': return materializeRouteState(collision, decision);
      case 'learning-state-field-chronology': return materializeLearningState(collision, decision);
      case 'preference-null-absence-equivalent': return materializePreference(collision, decision);
      default: throw new Error(`No materialization rule exists for ${decision.rule}.`);
    }
  }

  function groupFingerprints(rows) {
    const grouped = new Map();
    (rows || []).forEach(row => {
      const key = identity(row.table_name, row.row_key);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    return grouped;
  }

  function tableCountsFromManifest(manifest) {
    const counts = {};
    manifest.forEach(row => { counts[row.tableName] = (counts[row.tableName] || 0) + 1; });
    return counts;
  }

  async function buildOnce(auditInput, simulationReport) {
    const groups = groupFingerprints(auditInput.fingerprintRows || []);
    const decisions = new Map((simulationReport.decisions || []).map(item => [identity(item.tableName, item.rowKey), item]));
    const collisions = new Map((auditInput.collisions || []).map(item => [identity(item.tableName, item.rowKey), item]));
    const manifest = [];
    const materializedRows = [];
    const blocking = [];
    const warnings = [];

    const compatibilityBlocking = Object.values(auditInput.compatibility || {}).some(value => value === false);
    if (compatibilityBlocking) blocking.push('Latest staged devices are not Canonical-compatible.');
    if (!simulationReport.summary?.pass || simulationReport.summary?.unresolved) blocking.push('Merge Simulation is not a clean PASS.');
    if ((auditInput.latestRuns || []).some(run => run.status !== 'verified')) blocking.push('At least one latest staged device snapshot is not verified.');

    const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, rows] of sortedGroups) {
      const [tableName, rowKey] = key.split('\u0000');
      const signatures = new Set(rows.map(row => `${row.payload_hash}|${Boolean(row.tombstone)}`));
      const sourceDevices = [...new Set(rows.map(row => row.device_key))].sort();
      if (signatures.size === 1) {
        const chosen = [...rows].sort((a, b) => String(a.device_key).localeCompare(String(b.device_key)))[0];
        manifest.push({
          tableName,
          rowKey,
          tombstone: Boolean(chosen.tombstone),
          payloadHash: chosen.payload_hash,
          kind: rows.length > 1 ? 'identical-source' : 'unique-source',
          sourceDevices
        });
        continue;
      }

      const decision = decisions.get(key);
      const collision = collisions.get(key);
      if (!decision || !collision) {
        blocking.push(`Missing simulation/audit evidence for divergent ${tableName}|${rowKey}.`);
        continue;
      }
      if (!SAFE_DIVERGENT_TABLES.has(tableName)) {
        blocking.push(`Divergent table ${tableName} is outside the approved v200 materialization set.`);
        continue;
      }
      if (collision.tombstoneDisagreement) {
        blocking.push(`Tombstone disagreement remains for ${tableName}|${rowKey}.`);
        continue;
      }

      const payload = materializeCollision(collision, decision);
      const payloadHash = await sha256(stableStringify(payload));
      manifest.push({
        tableName,
        rowKey,
        tombstone: Boolean(collision.variants[0]?.tombstone),
        payloadHash,
        kind: 'materialized-merge',
        rule: decision.rule,
        sourceDevices
      });
      materializedRows.push({
        tableName,
        rowKey,
        rule: decision.rule,
        payloadHash,
        sourceDevices: sourceDevices.map(shortDevice),
        payload
      });
    }

    manifest.sort((a, b) => `${a.tableName}\u0000${a.rowKey}`.localeCompare(`${b.tableName}\u0000${b.rowKey}`));
    materializedRows.sort((a, b) => `${a.tableName}\u0000${a.rowKey}`.localeCompare(`${b.tableName}\u0000${b.rowKey}`));

    const tableCounts = tableCountsFromManifest(manifest);
    const cards = Number(tableCounts.cards || 0);
    const content = Number(tableCounts.card_content || 0);
    if (cards !== content) blocking.push(`Card/content identity count mismatch after materialization: ${cards} cards vs ${content} content rows.`);

    const coreMerged = manifest.filter(row => CORE_TABLES.has(row.tableName) && row.kind === 'materialized-merge');
    if (coreMerged.length) blocking.push(`Core Personal Library unexpectedly requires ${coreMerged.length} materialized merge(s).`);

    const expectedUnion = Number(simulationReport.inputSummary?.unionRows || 0);
    if (expectedUnion && manifest.length !== expectedUnion) blocking.push(`Union identity count mismatch: expected ${expectedUnion}, materialized ${manifest.length}.`);
    const expectedDivergent = Number(simulationReport.summary?.divergentInput || 0);
    if (materializedRows.length !== expectedDivergent) blocking.push(`Divergent materialization count mismatch: expected ${expectedDivergent}, materialized ${materializedRows.length}.`);

    const tombstoneRows = manifest.filter(row => row.tombstone).length;
    if (!tombstoneRows) warnings.push('No explicit tombstones exist in this materialized snapshot; delete/tombstone transport remains configured but not empirically exercised by current data.');
    warnings.push('Unchanged identities retain verified staged payload hashes; only divergent identities are rebuilt as payloads in memory in v200.');
    warnings.push('Merged learning_state rows omit migration-only source_snapshot because no single device snapshot truthfully represents the merged state; original source variants remain preserved in audit evidence.');

    const hashRows = manifest.map(row => ({
      tableName: row.tableName,
      rowKey: row.rowKey,
      tombstone: row.tombstone,
      payloadHash: row.payloadHash
    }));
    const snapshotManifestHash = await sha256(stableStringify(hashRows));
    const tableManifestHashes = {};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(hashRows.filter(row => row.tableName === tableName)));
    }
    const materializedMergePayloadHash = await sha256(stableStringify(materializedRows.map(row => ({
      tableName: row.tableName, rowKey: row.rowKey, rule: row.rule, payloadHash: row.payloadHash
    }))));

    const unchangedRows = manifest.filter(row => row.kind !== 'materialized-merge').length;
    const structuralSafety = blocking.length === 0
      && coreMerged.length === 0
      && [...new Set(materializedRows.map(row => row.tableName))].every(table => SAFE_DIVERGENT_TABLES.has(table));

    return {
      manifest,
      materializedRows,
      tableCounts,
      hashes: { snapshotManifestHash, tableManifestHashes, materializedMergePayloadHash },
      summary: {
        sourceDevices: (auditInput.latestRuns || []).length,
        unionRows: manifest.length,
        unchangedRows,
        materializedMerges: materializedRows.length,
        blockingIssues: blocking.length,
        tombstoneRows,
        coreUntouched: coreMerged.length === 0,
        structuralSafety,
        pass: blocking.length === 0 && structuralSafety
      },
      blocking,
      warnings
    };
  }

  async function buildMaterialization(auditInput, simulationReport) {
    if (!auditInput?.fingerprintRows || !auditInput?.collisions) throw new Error('Run Audit Canonical Merge first in this page session.');
    if (!simulationReport?.summary?.pass) throw new Error('Run Simulate Canonical Merge and obtain PASS first.');

    const first = await buildOnce(auditInput, simulationReport);
    const second = await buildOnce(auditInput, simulationReport);
    const repeatability = first.hashes.snapshotManifestHash === second.hashes.snapshotManifestHash
      && first.hashes.materializedMergePayloadHash === second.hashes.materializedMergePayloadHash
      && stableStringify(first.tableCounts) === stableStringify(second.tableCounts);
    const pass = first.summary.pass && repeatability;

    return {
      format: 'WLP_CANONICAL_MERGED_SNAPSHOT_MATERIALIZATION',
      version: 1,
      appVersion: APP_VERSION,
      generatedAt: new Date().toISOString(),
      mode: 'read-only-in-memory-materialization',
      compatibility: clone(auditInput.compatibility || {}),
      latestRuns: clone(auditInput.latestRuns || []),
      sourcePlanHash: simulationReport.planHash || null,
      summary: { ...first.summary, repeatability, pass },
      tableCounts: first.tableCounts,
      hashes: first.hashes,
      materializedRows: first.materializedRows,
      issues: { blocking: first.blocking, warnings: first.warnings },
      invariants: {
        noCloudWrites: true,
        noCloudToWlpApply: true,
        noWlpWrites: true,
        noAutomaticCutover: true,
        sourceVariantsPreserved: true,
        unchangedRowsUseVerifiedStageHashes: true
      }
    };
  }

  async function runMaterialization() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Materializing the merged Canonical snapshot manifest in memory. No data will be written…', '');
    try {
      const auditInput = window.WLPCanonicalMergeAudit?.getSimulationInput?.();
      const simulationReport = window.WLPCanonicalMergeSimulation?.getReport?.();
      state.report = await buildMaterialization(auditInput, simulationReport);
      render(state.report);
      const s = state.report.summary;
      setStatus(
        `Merged Canonical Snapshot Materialization ${s.pass ? 'PASS' : 'CHECK'} · ${s.unionRows.toLocaleString()} row identities · ${s.materializedMerges} divergent row(s) materialized · ${s.blockingIssues} blocker(s) · structural safety ${s.structuralSafety ? 'PASS' : 'CHECK'} · repeatability ${s.repeatability ? 'PASS' : 'FAIL'} · no Cloud/WLP data modified.`,
        s.pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-merge-materialization-complete'));
    } catch (error) {
      console.error('WLP Canonical Merge Materialization:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('merge-materialize-union').textContent = Number(s.unionRows || 0).toLocaleString();
    $('merge-materialize-unchanged').textContent = Number(s.unchangedRows || 0).toLocaleString();
    $('merge-materialize-merged').textContent = Number(s.materializedMerges || 0).toLocaleString();
    $('merge-materialize-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('merge-materialize-repeat').textContent = s.repeatability ? 'PASS' : 'FAIL';
    $('merge-materialize-structural').textContent = s.structuralSafety ? 'PASS' : 'CHECK';
    $('merge-materialize-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('merge-materialize-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('merge-materialize-hash').textContent = report.hashes?.snapshotManifestHash || '—';
    $('merge-materialize-merge-hash').textContent = report.hashes?.materializedMergePayloadHash || '—';

    const tableBody = $('merge-materialize-table-body');
    tableBody.innerHTML = '';
    Object.entries(report.tableCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([table, count]) => {
      const tr = document.createElement('tr');
      [table, count, report.hashes?.tableManifestHashes?.[table] || '—'].forEach((value, index) => {
        const td = document.createElement('td'); td.textContent = String(value); if (index === 2) td.style.wordBreak = 'break-all'; tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });

    const detailBody = $('merge-materialize-detail-body');
    detailBody.innerHTML = '';
    (report.materializedRows || []).forEach(item => {
      const tr = document.createElement('tr');
      [item.tableName, item.rowKey, item.rule, item.payloadHash, (item.sourceDevices || []).join(' / ')].forEach((value, index) => {
        const td = document.createElement('td'); td.textContent = String(value ?? ''); if (index === 1 || index === 3) td.style.wordBreak = 'break-all'; tr.appendChild(td);
      });
      detailBody.appendChild(tr);
    });

    const notes = $('merge-materialize-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No materialization issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('merge-materialize-panel').classList.remove('hidden');
    $('export-merge-materialize').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-merged-snapshot-materialization-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('merge-materialize-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const simulation = window.WLPCanonicalMergeSimulation?.getReport?.();
    $('run-merge-materialize').disabled = state.busy || !simulation?.summary?.pass;
    $('export-merge-materialize').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalMergeMaterialization = Object.freeze({
    getReport: () => state.report,
    buildReport: buildMaterialization
  });

  function init() {
    $('run-merge-materialize').addEventListener('click', runMaterialization);
    $('export-merge-materialize').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-merge-simulation-complete', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
