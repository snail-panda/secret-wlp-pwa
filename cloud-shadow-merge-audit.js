/* WLP Canonical Merge Audit v1.
   Read-only classification of divergent same-key rows in the latest Canonical
   Cloud staging snapshots. This file performs no Supabase writes and never
   applies Cloud data to WLP. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.197-canonical-merge-audit-v1';
  const CORE_TABLES = new Set(['cards', 'card_content', 'card_classification']);
  const APPEND_ONLY_TABLES = new Set(['learning_events']);
  const STRUCTURAL_CHILD_TABLES = new Set([
    'learning_alternative_situations', 'study_context_cards', 'study_build_cards'
  ]);
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

  function supabaseApi() {
    const api = window.WLPCloudShadowSupabase;
    if (!api?.ensureSession || !api?.fetchPaged || !api?.getState) {
      throw new Error('Shadow Supabase transport is not ready. Reload this diagnostics page.');
    }
    return api;
  }

  async function fetchLatestRuns(api) {
    const runs = await api.fetchPaged(
      'wlp_canonical_stage_runs',
      'device_key,stage_key,status,last_staged_at,canonical_row_count,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,full_canonical_hash',
      'status=eq.verified&order=last_staged_at.desc'
    );
    const latest = new Map();
    runs.forEach(run => { if (!latest.has(run.device_key)) latest.set(run.device_key, run); });
    return [...latest.values()];
  }

  async function fetchFingerprints(api, run) {
    return api.fetchPaged(
      'wlp_canonical_stage_records',
      'device_key,stage_key,table_name,row_key,payload_hash,tombstone',
      `device_key=eq.${encodeURIComponent(run.device_key)}&stage_key=eq.${encodeURIComponent(run.stage_key)}&order=table_name.asc,row_key.asc`
    );
  }

  function divergentGroups(rows) {
    const grouped = new Map();
    rows.forEach(row => {
      const key = `${row.table_name}\u0000${row.row_key}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    return [...grouped.entries()].map(([key, variants]) => {
      const [tableName, rowKey] = key.split('\u0000');
      const signatures = new Set(variants.map(row => `${row.payload_hash}|${Boolean(row.tombstone)}`));
      return { tableName, rowKey, variants, signatures };
    }).filter(item => item.variants.length > 1 && item.signatures.size > 1);
  }

  async function fetchPayloadVariants(api, latestRuns, collisions) {
    const keysByTable = new Map();
    collisions.forEach(item => {
      if (!keysByTable.has(item.tableName)) keysByTable.set(item.tableName, new Set());
      keysByTable.get(item.tableName).add(item.rowKey);
    });

    const byIdentity = new Map();
    for (const run of latestRuns) {
      for (const [tableName, wantedKeys] of keysByTable.entries()) {
        setStatus(`Reading divergent ${tableName} payloads from staged devices…`, '');
        const rows = await api.fetchPaged(
          'wlp_canonical_stage_records',
          'device_key,stage_key,table_name,row_key,payload_hash,tombstone,payload',
          `device_key=eq.${encodeURIComponent(run.device_key)}&stage_key=eq.${encodeURIComponent(run.stage_key)}&table_name=eq.${encodeURIComponent(tableName)}&order=row_key.asc`
        );
        rows.forEach(row => {
          if (!wantedKeys.has(row.row_key)) return;
          const key = `${row.table_name}\u0000${row.row_key}`;
          if (!byIdentity.has(key)) byIdentity.set(key, []);
          byIdentity.get(key).push(row);
        });
      }
    }
    return byIdentity;
  }

  function diffPaths(values, path = '', out = new Set(), depth = 0) {
    if (values.length < 2 || out.size >= 32) return out;
    const serialized = values.map(stableStringify);
    if (new Set(serialized).size <= 1) return out;
    if (depth >= 5) { out.add(path || '(row)'); return out; }

    const allObjects = values.every(value => value && typeof value === 'object' && !Array.isArray(value));
    if (allObjects) {
      const keys = new Set();
      values.forEach(value => Object.keys(value).forEach(key => keys.add(key)));
      for (const key of [...keys].sort()) {
        if (out.size >= 32) break;
        diffPaths(values.map(value => value?.[key]), path ? `${path}.${key}` : key, out, depth + 1);
      }
      return out;
    }

    out.add(path || '(row)');
    return out;
  }

  function parseTime(value) {
    if (!value) return null;
    const time = Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
  }

  function effectiveTime(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidates = [
      payload.updated_at, payload.last_attention_updated_at, payload.ended_at,
      payload.completed_at, payload.occurred_at, payload.created_at
    ].map(parseTime).filter(value => value !== null);
    return candidates.length ? Math.max(...candidates) : null;
  }

  function revisionOf(payload) {
    const value = Number(payload?.revision ?? payload?.row_version);
    return Number.isFinite(value) ? value : null;
  }

  function uniqueLeader(variants, selector) {
    const scored = variants.map((variant, index) => ({ index, value: selector(variant.payload) }))
      .filter(item => item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)));
    if (scored.length < 2) return null;
    const max = Math.max(...scored.map(item => Number(item.value)));
    const leaders = scored.filter(item => Number(item.value) === max);
    const others = scored.filter(item => Number(item.value) !== max);
    if (leaders.length !== 1 || !others.length) return null;
    if (!others.every(item => Number(item.value) < max)) return null;
    return { variant: variants[leaders[0].index], value: max };
  }

  function directLineage(variants) {
    if (variants.length !== 2) return null;
    const [a, b] = variants;
    if (a.payload?.version_id && b.payload?.parent_version_id === a.payload.version_id) return b;
    if (b.payload?.version_id && a.payload?.parent_version_id === b.payload.version_id) return a;
    return null;
  }

  function shortDevice(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
  }

  function classifyCollision(tableName, rowKey, variants) {
    const paths = [...diffPaths(variants.map(item => item.payload))];
    const tombstones = new Set(variants.map(item => Boolean(item.tombstone)));
    const revisions = variants.map(item => revisionOf(item.payload)).filter(value => value !== null);
    const times = variants.map(item => effectiveTime(item.payload)).filter(value => value !== null);
    const devices = variants.map(item => shortDevice(item.device_key)).join(' / ');
    const base = {
      tableName, rowKey, devices, differingFields: paths,
      tombstoneDisagreement: tombstones.size > 1,
      variantCount: variants.length,
      variants: variants.map(item => ({
        deviceKey: item.device_key,
        stageKey: item.stage_key,
        payloadHash: item.payload_hash,
        tombstone: Boolean(item.tombstone),
        payload: item.payload
      }))
    };

    if (tombstones.size > 1) return {
      ...base, severity: 'BLOCKING', category: 'tombstone-disagreement', orderedCandidate: false,
      evidence: `Live/deleted state differs across ${variants.length} staged variant(s).`,
      recommendation: 'Do not auto-merge. Preserve the tombstone and live variant until explicit delete chronology/base-version semantics are proven.'
    };

    if (CORE_TABLES.has(tableName)) return {
      ...base, severity: 'BLOCKING', category: 'core-library-conflict', orderedCandidate: false,
      evidence: `Core Personal Library same-key payload differs across ${devices}.`,
      recommendation: 'Do not choose a winner. Resolve with field/base-version conflict rules before any Canonical write.'
    };

    const sameSourcePayload = variants.every(item => stableStringify(item.payload?.payload) === stableStringify(variants[0].payload?.payload));
    const onlySessionReferenceDiff = paths.length > 0 && paths.every(path => path === 'session_id');
    const sessionValues = variants.map(item => item.payload?.session_id ?? null);
    const resolvedSessionIds = new Set(sessionValues.filter(Boolean));
    if (sameSourcePayload && onlySessionReferenceDiff && resolvedSessionIds.size === 1 && sessionValues.some(value => !value)) return {
      ...base, severity: 'CANDIDATE', category: 'reference-enrichment-candidate', orderedCandidate: true,
      evidence: `Source payload is identical; one staged snapshot resolves session_id while another preserves it as null because the referenced historical session was absent locally.`,
      recommendation: 'After the session union is established, the resolved valid Canonical session reference can enrich the null variant without changing append-only source evidence.'
    };

    if (APPEND_ONLY_TABLES.has(tableName)) return {
      ...base, severity: 'BLOCKING', category: 'append-only-identity-conflict', orderedCandidate: false,
      evidence: `The same append-only event identity has different payloads across ${devices}.`,
      recommendation: 'Inspect source event identity and provenance. Append-only events must not silently overwrite one another.'
    };

    if (STRUCTURAL_CHILD_TABLES.has(tableName)) return {
      ...base, severity: 'BLOCKING', category: 'structural-key-conflict', orderedCandidate: false,
      evidence: `A structural child row with the same canonical key points to different content across ${devices}.`,
      recommendation: 'Inspect parent/ordinal identity before merge; never resolve this by last-write-wins.'
    };

    if (tableName === 'card_learning_metadata') {
      const successor = directLineage(variants);
      if (successor) return {
        ...base, severity: 'CANDIDATE', category: 'lineage-successor', orderedCandidate: true,
        evidence: `Version lineage is explicit; ${shortDevice(successor.device_key)} carries a child version whose parent matches the other staged version.`,
        recommendation: 'Candidate for deterministic successor selection after validating lineage/tombstone rules. No selection is made by this audit.'
      };
      const revisionLeader = uniqueLeader(variants, revisionOf);
      if (revisionLeader) return {
        ...base, severity: 'CANDIDATE', category: 'revision-ordered-metadata', orderedCandidate: true,
        evidence: `Revision values differ (${revisions.join(' / ')}); unique highest revision is on ${shortDevice(revisionLeader.variant.device_key)}.`,
        recommendation: 'Candidate for revision-aware merge, but verify version lineage before applying.'
      };
      return {
        ...base, severity: 'REVIEW', category: 'metadata-same-revision-conflict', orderedCandidate: false,
        evidence: 'Metadata differs without a provable successor revision/lineage.',
        recommendation: 'Requires field/lineage inspection before Canonical merge.'
      };
    }

    if (tableName === 'learning_state') {
      const timeLeader = uniqueLeader(variants, effectiveTime);
      return timeLeader ? {
        ...base, severity: 'CANDIDATE', category: 'state-field-chronology-candidate', orderedCandidate: true,
        evidence: `Effective state timestamps differ; latest evidence is on ${shortDevice(timeLeader.variant.device_key)}.`,
        recommendation: 'Merge per state field using effective timestamps/event chronology. Do not replace the whole row with the latest snapshot.'
      } : {
        ...base, severity: 'REVIEW', category: 'state-chronology-ambiguous', orderedCandidate: false,
        evidence: 'State differs but no unique effective timestamp orders the complete change.',
        recommendation: 'Requires per-field/event-history inspection.'
      };
    }

    if (['learner_profile', 'learner_route_state', 'study_contexts'].includes(tableName)) {
      const revisionLeader = uniqueLeader(variants, revisionOf);
      if (revisionLeader) return {
        ...base, severity: 'CANDIDATE', category: 'revision-ordered-state', orderedCandidate: true,
        evidence: `Unique highest revision is ${revisionLeader.value} on ${shortDevice(revisionLeader.variant.device_key)}.`,
        recommendation: 'Candidate for revision-aware merge after confirming no same-revision concurrent edit is hidden in nested fields.'
      };
      const timeLeader = uniqueLeader(variants, effectiveTime);
      if (timeLeader) return {
        ...base, severity: 'CANDIDATE', category: 'chronology-ordered-state', orderedCandidate: true,
        evidence: `A unique later effective timestamp exists on ${shortDevice(timeLeader.variant.device_key)}.`,
        recommendation: 'Candidate for chronology-aware merge; keep the older variant as audit evidence until cutover.'
      };
      return {
        ...base, severity: 'REVIEW', category: 'state-order-ambiguous', orderedCandidate: false,
        evidence: 'No unique revision/timestamp ordering proves which staged variant supersedes the other.',
        recommendation: 'Requires explicit merge policy or manual inspection.'
      };
    }

    if (tableName === 'learning_sessions' || tableName === 'study_builds') {
      const timeLeader = uniqueLeader(variants, effectiveTime);
      return timeLeader ? {
        ...base, severity: 'CANDIDATE', category: 'chronology-ordered-history', orderedCandidate: true,
        evidence: `A unique later session/history timestamp exists on ${shortDevice(timeLeader.variant.device_key)}.`,
        recommendation: 'Candidate for richer/newer history merge. Preserve source payload and never erase older evidence silently.'
      } : {
        ...base, severity: 'REVIEW', category: 'history-order-ambiguous', orderedCandidate: false,
        evidence: 'Same history identity differs without a unique chronology winner.',
        recommendation: 'Inspect source payload/status before defining the merge rule.'
      };
    }

    if (tableName === 'user_preferences') return {
      ...base, severity: 'REVIEW', category: 'preference-section-conflict', orderedCandidate: false,
      evidence: `The same preference section differs; current migration rows do not carry a reliable common-base timestamp.`,
      recommendation: 'Define per-preference-key merge semantics later; do not use whole-section last-write-wins during canonical cutover.'
    };

    const revisionLeader = uniqueLeader(variants, revisionOf);
    if (revisionLeader) return {
      ...base, severity: 'CANDIDATE', category: 'generic-revision-candidate', orderedCandidate: true,
      evidence: `Unique highest revision is ${revisionLeader.value} on ${shortDevice(revisionLeader.variant.device_key)}.`,
      recommendation: 'Potential revision-aware successor; validate entity-specific semantics before applying.'
    };
    const timeLeader = uniqueLeader(variants, effectiveTime);
    if (timeLeader) return {
      ...base, severity: 'CANDIDATE', category: 'generic-chronology-candidate', orderedCandidate: true,
      evidence: `Unique later timestamp exists on ${shortDevice(timeLeader.variant.device_key)}.`,
      recommendation: 'Potential chronology-aware successor; validate entity-specific semantics before applying.'
    };
    return {
      ...base, severity: 'REVIEW', category: 'manual-policy-required', orderedCandidate: false,
      evidence: `Same canonical key differs across ${devices}; no safe ordering rule is proven by current staged metadata.`,
      recommendation: 'Preserve both variants and define an entity-specific merge rule before Canonical write.'
    };
  }

  function compatibilityAudit(runs) {
    const distinct = key => new Set(runs.map(run => String(run[key] || '')).filter(Boolean));
    return {
      namespaceMatch: distinct('namespace_uuid').size <= 1,
      migrationVersionMatch: distinct('migration_version').size <= 1,
      cardMappingHashMatch: distinct('card_mapping_hash').size <= 1,
      coreLibraryHashMatch: distinct('core_library_hash').size <= 1
    };
  }

  function summarize(collisions) {
    const tableSummary = {};
    const categorySummary = {};
    let ordered = 0, review = 0, blocking = 0, tombstone = 0;
    collisions.forEach(item => {
      tableSummary[item.tableName] ||= { divergent: 0, ordered: 0, review: 0, blocking: 0 };
      tableSummary[item.tableName].divergent += 1;
      categorySummary[item.category] = (categorySummary[item.category] || 0) + 1;
      if (item.severity === 'BLOCKING') {
        blocking += 1; tableSummary[item.tableName].blocking += 1;
      } else if (item.orderedCandidate) {
        ordered += 1; tableSummary[item.tableName].ordered += 1;
      } else {
        review += 1; tableSummary[item.tableName].review += 1;
      }
      if (item.tombstoneDisagreement) tombstone += 1;
    });
    return { divergent: collisions.length, ordered, review, blocking, tombstone, tableSummary, categorySummary };
  }

  async function runAudit() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Reading latest Canonical staging fingerprints. This audit is read only…', '');
    try {
      const api = supabaseApi();
      await api.ensureSession();
      const latestRuns = await fetchLatestRuns(api);
      if (latestRuns.length < 2) throw new Error('Canonical Merge Audit requires at least two verified staged device snapshots.');

      const compatibility = compatibilityAudit(latestRuns);
      const fingerprintRows = [];
      for (let i = 0; i < latestRuns.length; i += 1) {
        fingerprintRows.push(...await fetchFingerprints(api, latestRuns[i]));
        setStatus(`Reading staging fingerprints… ${i + 1} / ${latestRuns.length} device(s)`, '');
      }
      const groups = divergentGroups(fingerprintRows);
      const payloads = await fetchPayloadVariants(api, latestRuns, groups);
      const collisions = groups.map(group => {
        const variants = payloads.get(`${group.tableName}\u0000${group.rowKey}`) || [];
        if (variants.length < 2) return {
          tableName: group.tableName, rowKey: group.rowKey, devices: '', differingFields: [],
          tombstoneDisagreement: false, variantCount: variants.length, variants: [], severity: 'BLOCKING',
          category: 'payload-readback-incomplete', orderedCandidate: false,
          evidence: 'Divergent fingerprint was detected but fewer than two payload variants were read back.',
          recommendation: 'Repeat the audit; do not merge until both payload variants can be inspected.'
        };
        return classifyCollision(group.tableName, group.rowKey, variants);
      }).sort((a, b) => `${a.severity}|${a.tableName}|${a.rowKey}`.localeCompare(`${b.severity}|${b.tableName}|${b.rowKey}`));

      const summary = summarize(collisions);
      const compatibilityBlocking = Object.values(compatibility).some(value => value === false);
      state.report = {
        format: 'WLP_CANONICAL_MERGE_AUDIT_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only',
        latestRuns,
        compatibility,
        summary: { ...summary, latestDevices: latestRuns.length, compatibilityBlocking },
        collisions,
        invariants: {
          noCloudWrites: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noAutomaticMerge: true,
          bothVariantsPreserved: true
        }
      };
      render(state.report);
      setStatus(
        `Canonical Merge Audit complete · ${summary.divergent} divergent collision(s) classified · ${summary.ordered} ordered candidate(s) · ${summary.review} review candidate(s) · ${summary.blocking} automatic-merge blocker(s) · no Cloud/WLP data modified.`,
        summary.blocking || compatibilityBlocking ? 'error' : 'success'
      );
    } catch (error) {
      console.error('WLP Canonical Merge Audit:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const summary = report.summary;
    $('merge-audit-devices').textContent = Number(summary.latestDevices || 0).toLocaleString();
    $('merge-audit-divergent').textContent = Number(summary.divergent || 0).toLocaleString();
    $('merge-audit-ordered').textContent = Number(summary.ordered || 0).toLocaleString();
    $('merge-audit-review').textContent = Number(summary.review || 0).toLocaleString();
    $('merge-audit-blocking').textContent = Number(summary.blocking || 0).toLocaleString();
    $('merge-audit-tombstone').textContent = Number(summary.tombstone || 0).toLocaleString();
    $('merge-audit-result').textContent = 'COMPLETE';
    $('merge-audit-result').className = summary.blocking || summary.compatibilityBlocking ? 'compare-check' : 'compare-pass';

    const tableBody = $('merge-audit-table-body');
    tableBody.innerHTML = '';
    Object.entries(summary.tableSummary || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([table, item]) => {
      const tr = document.createElement('tr');
      [table, item.divergent, item.ordered, item.review, item.blocking].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });

    const detailBody = $('merge-audit-detail-body');
    detailBody.innerHTML = '';
    (report.collisions || []).forEach(item => {
      const tr = document.createElement('tr');
      const fields = item.differingFields.length > 8
        ? `${item.differingFields.slice(0, 8).join(', ')} … (+${item.differingFields.length - 8})`
        : item.differingFields.join(', ');
      const values = [item.tableName, item.rowKey, item.severity, item.category, fields || '—', item.evidence];
      values.forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = String(value ?? '');
        if (index === 1) td.style.wordBreak = 'break-all';
        tr.appendChild(td);
      });
      detailBody.appendChild(tr);
    });

    const issues = $('merge-audit-issues');
    issues.innerHTML = '';
    const values = [];
    if (report.compatibility.namespaceMatch === false) values.push('BLOCKING · Canonical UUID namespace differs across latest staged devices.');
    if (report.compatibility.migrationVersionMatch === false) values.push('BLOCKING · Canonical migration version differs across latest staged devices.');
    if (report.compatibility.cardMappingHashMatch === false) values.push('BLOCKING · Card Mapping Hash differs across latest staged devices.');
    if (report.compatibility.coreLibraryHashMatch === false) values.push('BLOCKING · Core Library Hash differs across latest staged devices.');
    if (!values.length) values.push('Canonical identity/core compatibility remains aligned across the latest staged devices.');
    values.push('No merge is executed by this audit. Candidate labels describe evidence only; they are not winner selections.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; issues.appendChild(li); });

    $('merge-audit-panel').classList.remove('hidden');
    $('export-merge-audit').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-merge-audit-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('merge-audit-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }

  function refreshButtons() {
    const apiState = window.WLPCloudShadowSupabase?.getState?.() || {};
    $('run-merge-audit').disabled = state.busy || !apiState.configured || !apiState.signedIn;
    $('export-merge-audit').disabled = state.busy || !state.report;
  }

  function init() {
    $('run-merge-audit').addEventListener('click', runAudit);
    $('export-merge-audit').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
    setTimeout(refreshButtons, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
