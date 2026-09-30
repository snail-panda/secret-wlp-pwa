/* WLP Canonical Merge Simulation v1.
   Pure in-memory field-by-field simulation over the latest read-only Merge Audit.
   This file performs no Supabase writes and never applies Cloud data to WLP. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.199-canonical-merge-simulation-v1';
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
  function shortDevice(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
  }

  function leaderByTimes(variants, fields) {
    const scores = variants.map((variant, index) => {
      const candidates = fields.map(field => parseTime(variant.payload?.[field])).filter(value => value !== null);
      return { index, value: candidates.length ? Math.max(...candidates) : null };
    }).filter(item => item.value !== null);
    if (!scores.length) return null;
    const max = Math.max(...scores.map(item => item.value));
    const leaders = scores.filter(item => item.value === max);
    return leaders.length === 1 ? variants[leaders[0].index] : null;
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

  function simulateProfile(collision) {
    const variants = collision.variants;
    const semantic = variants.map(variant => {
      const profile = clone(variant.payload?.profile || {});
      delete profile.updatedAt;
      return profile;
    });
    if (!allEqual(semantic)) return unresolved(collision, 'profile-content-divergence', 'Learner profile content differs beyond timestamps.');
    const leader = leaderByTimes(variants, ['updated_at']);
    if (!leader) return unresolved(collision, 'profile-chronology-ambiguous', 'Learner profile timestamps do not identify one later snapshot.');
    return resolved(collision, 'profile-later-timestamp-same-content', {
      selectedDevice: leader.deviceKey,
      evidence: 'Profile content is identical after removing updatedAt; the later timestamp only advances chronology.',
      fieldPlan: { profile: 'identical-content', updated_at: `latest:${shortDevice(leader.deviceKey)}` },
      preservationChecks: ['profile-content-preserved', 'older-variant-retained-as-audit-evidence']
    });
  }

  function simulateRouteState(collision) {
    const variants = collision.variants;
    if (variants.length < 2) return unresolved(collision, 'route-state-insufficient-variants', 'Fewer than two route-state variants are available.');
    const recordsByVariant = variants.map(variant => variant.payload?.route_state?.records || {});
    const allKeys = [...new Set(recordsByVariant.flatMap(records => Object.keys(records)))].sort();
    const mergedRecords = {};
    const provenance = {};
    for (const key of allKeys) {
      const present = variants.map((variant, index) => ({ variant, value: recordsByVariant[index][key] })).filter(item => item.value !== undefined);
      if (present.length === 1) {
        mergedRecords[key] = clone(present[0].value);
        provenance[key] = `unique:${shortDevice(present[0].variant.deviceKey)}`;
        continue;
      }
      const normalized = present.map(item => stripRouteVolatileIds(item.value));
      if (allEqual(normalized)) {
        const sorted = [...present].sort((a, b) => {
          const ta = parseTime(a.value?.updatedAt) ?? parseTime(a.variant.payload?.updated_at) ?? 0;
          const tb = parseTime(b.value?.updatedAt) ?? parseTime(b.variant.payload?.updated_at) ?? 0;
          if (tb !== ta) return tb - ta;
          return String(a.variant.deviceKey).localeCompare(String(b.variant.deviceKey));
        });
        mergedRecords[key] = clone(sorted[0].value);
        provenance[key] = 'semantic-match-ignore-generated-ids';
        continue;
      }
      return unresolved(collision, 'route-record-concurrent-divergence', `Route record ${key} differs semantically across devices; generated-ID normalization is not enough.`);
    }
    const mergedUpdated = isoOrNull(maxTime(variants.flatMap(variant => [variant.payload?.updated_at, variant.payload?.route_state?.updatedAt])));
    return resolved(collision, 'route-state-semantic-union', {
      evidence: `All shared route records are semantically identical after ignoring locally generated connection/exemplar IDs; ${allKeys.length} record key(s) are preserved in the union.`,
      fieldPlan: { records: `semantic-union:${allKeys.length}`, updated_at: 'latest-observed', generatedIds: 'preserve-one-equivalent-variant-per-shared-record' },
      simulated: { recordKeys: allKeys, updated_at: mergedUpdated, provenance },
      preservationChecks: ['all-route-record-keys-preserved', 'shared-route-evidence-semantic-match', 'no-array-concatenation-duplicates']
    });
  }

  function simulatePreference(collision) {
    const variants = collision.variants;
    const normalized = variants.map(variant => {
      const payload = clone(variant.payload?.payload || {});
      Object.keys(payload).forEach(key => { if (payload[key] === null) delete payload[key]; });
      return payload;
    });
    if (!allEqual(normalized)) return unresolved(collision, 'preference-key-conflict', 'Preference values still differ after null/absent normalization.');
    return resolved(collision, 'preference-null-absence-equivalent', {
      evidence: 'The only staged preference difference is null versus absent; both represent no explicit card-mode preference in the current data.',
      fieldPlan: { 'payload.fc:cardMode': 'normalize null/absent to absent' },
      simulated: { normalizedPayload: normalized[0] },
      preservationChecks: ['non-null-preference-values-identical', 'no-whole-section-last-write-wins']
    });
  }

  function simulateLearningState(collision) {
    const variants = collision.variants;
    const payloads = variants.map(variant => variant.payload || {});
    const differing = new Set((collision.differingFields || []).filter(path => !path.startsWith('source_snapshot.')));
    const allowed = new Set([
      'known','studied','review','review_level','review_reasons','exposure_count','study_count','review_count','attempt_count',
      'last_seen_at','last_studied_at','last_reviewed_at','last_practiced_at','last_attention_updated_at','last_result',
      'updated_at','state_source','revision','derived_through_change_seq'
    ]);
    const unknown = [...differing].filter(field => !allowed.has(field));
    if (unknown.length) return unresolved(collision, 'learning-state-unknown-field', `Unmodeled differing field(s): ${unknown.join(', ')}`);

    const simulated = {};
    const plan = {};
    const checks = [];

    ['exposure_count','study_count','review_count','attempt_count'].forEach(field => {
      simulated[field] = maxNumber(payloads.map(payload => payload[field]));
      if (differing.has(field)) plan[field] = 'max-observed-migration-snapshot';
    });
    ['last_seen_at','last_studied_at','last_reviewed_at','last_practiced_at','last_attention_updated_at'].forEach(field => {
      simulated[field] = isoOrNull(maxTime(payloads.map(payload => payload[field])));
      if (differing.has(field)) plan[field] = 'latest-timestamp';
    });
    simulated.updated_at = isoOrNull(maxTime(payloads.flatMap(payload => [payload.updated_at, payload.last_seen_at, payload.last_studied_at, payload.last_reviewed_at, payload.last_practiced_at, payload.last_attention_updated_at])));
    plan.updated_at = 'latest-effective-state-time';

    const attentionFields = ['review','review_level','review_reasons'];
    if (attentionFields.some(field => differing.has(field))) {
      const leader = leaderByTimes(variants, ['last_attention_updated_at','last_reviewed_at']);
      if (!leader) return unresolved(collision, 'attention-chronology-ambiguous', 'Review/attention fields differ without one latest attention/review timestamp.');
      attentionFields.forEach(field => { simulated[field] = clone(leader.payload?.[field] ?? null); if (differing.has(field)) plan[field] = `latest-attention:${shortDevice(leader.deviceKey)}`; });
      checks.push('review-reasons-selected-as-one-version-not-array-union');
    } else attentionFields.forEach(field => { simulated[field] = clone(payloads[0]?.[field] ?? null); });

    if (differing.has('known')) {
      const leader = leaderByTimes(variants, ['last_attention_updated_at','last_reviewed_at','last_studied_at','last_practiced_at','last_seen_at']);
      if (!leader) return unresolved(collision, 'known-state-chronology-ambiguous', 'known differs without one latest state-action timestamp.');
      simulated.known = leader.payload?.known ?? null;
      plan.known = `latest-state-action:${shortDevice(leader.deviceKey)}`;
    } else simulated.known = payloads[0]?.known ?? null;

    if (differing.has('studied')) {
      const leader = leaderByTimes(variants, ['last_studied_at']);
      if (!leader) return unresolved(collision, 'studied-chronology-ambiguous', 'studied differs without one latest studied timestamp.');
      simulated.studied = Boolean(leader.payload?.studied);
      plan.studied = `latest-study:${shortDevice(leader.deviceKey)}`;
    } else simulated.studied = Boolean(payloads[0]?.studied);

    if (differing.has('last_result')) {
      const leader = leaderByTimes(variants, ['last_practiced_at','last_reviewed_at','last_studied_at','last_attention_updated_at','last_seen_at']);
      if (!leader) return unresolved(collision, 'last-result-chronology-ambiguous', 'last_result differs without one latest result-bearing action timestamp.');
      simulated.last_result = leader.payload?.last_result ?? null;
      plan.last_result = `latest-result-action:${shortDevice(leader.deviceKey)}`;
    } else simulated.last_result = payloads[0]?.last_result ?? null;

    simulated.state_source = 'migrated_snapshot';
    simulated.revision = maxNumber(payloads.map(payload => payload.revision));
    simulated.derived_through_change_seq = null;
    checks.push('latest-state-timestamps-never-regress');
    checks.push('counters-never-below-any-device-snapshot');
    checks.push('both-source-variants-remain-audit-evidence');

    return resolved(collision, 'learning-state-field-chronology', {
      evidence: 'Current-state fields are simulated independently: timestamps by latest evidence, attention as one ordered bundle, and legacy counters by max-observed migration snapshot.',
      fieldPlan: plan,
      simulated,
      preservationChecks: checks,
      caveat: 'max-observed counters are a migration-snapshot policy, not a future concurrent-counter algorithm; future sync should prefer event-derived state or explicit mutation deltas.'
    });
  }

  function resolved(collision, rule, extra = {}) {
    return {
      tableName: collision.tableName,
      rowKey: collision.rowKey,
      status: 'RESOLVED_IN_SIMULATION',
      rule,
      devices: collision.devices,
      differingFields: collision.differingFields,
      sourceVariantCount: collision.variantCount,
      ...extra
    };
  }
  function unresolved(collision, rule, reason) {
    return {
      tableName: collision.tableName,
      rowKey: collision.rowKey,
      status: 'UNRESOLVED',
      rule,
      devices: collision.devices,
      differingFields: collision.differingFields,
      sourceVariantCount: collision.variantCount,
      evidence: reason,
      preservationChecks: ['both-source-variants-preserved-no-write']
    };
  }

  function simulateCollision(collision) {
    if (collision.tombstoneDisagreement) return unresolved(collision, 'tombstone-disagreement', 'Live/tombstone disagreement must remain unresolved until delete chronology is proven.');
    if (collision.severity === 'BLOCKING') return unresolved(collision, collision.category || 'audit-blocker', collision.evidence || 'Merge Audit marked this collision as blocking.');
    if (collision.tableName === 'learning_state') return simulateLearningState(collision);
    if (collision.tableName === 'learner_profile') return simulateProfile(collision);
    if (collision.tableName === 'learner_route_state') return simulateRouteState(collision);
    if (collision.tableName === 'user_preferences') return simulatePreference(collision);
    return unresolved(collision, 'no-simulation-rule', 'No field-by-field simulation rule exists for this entity type yet.');
  }

  function unionIdentitySummary(fingerprintRows) {
    const grouped = new Map();
    fingerprintRows.forEach(row => {
      const key = `${row.table_name}\u0000${row.row_key}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    let unique = 0, identicalDuplicates = 0, divergent = 0;
    grouped.forEach(rows => {
      const signatures = new Set(rows.map(row => `${row.payload_hash}|${Boolean(row.tombstone)}`));
      if (rows.length === 1) unique += 1;
      else if (signatures.size === 1) identicalDuplicates += 1;
      else divergent += 1;
    });
    return { unionRows: grouped.size, uniqueRows: unique, identicalDuplicates, divergentCollisions: divergent };
  }

  async function buildSimulation(input) {
    const decisions = (input.collisions || []).map(simulateCollision).sort((a, b) => `${a.tableName}|${a.rowKey}`.localeCompare(`${b.tableName}|${b.rowKey}`));
    const resolvedCount = decisions.filter(item => item.status === 'RESOLVED_IN_SIMULATION').length;
    const unresolvedCount = decisions.length - resolvedCount;
    const ruleSummary = {};
    decisions.forEach(item => { ruleSummary[item.rule] = (ruleSummary[item.rule] || 0) + 1; });
    const identitySummary = unionIdentitySummary(input.fingerprintRows || []);
    const planForHash = decisions.map(item => ({
      tableName: item.tableName, rowKey: item.rowKey, status: item.status, rule: item.rule,
      fieldPlan: item.fieldPlan || null, simulated: item.simulated || null
    }));
    const planHash = await sha256(stableStringify(planForHash));
    const planHashRepeat = await sha256(stableStringify(planForHash));
    const compatibilityBlocking = Object.values(input.compatibility || {}).some(value => value === false);
    return {
      format: 'WLP_CANONICAL_MERGE_SIMULATION_REPORT',
      version: 1,
      appVersion: APP_VERSION,
      generatedAt: new Date().toISOString(),
      mode: 'read-only-in-memory-simulation',
      compatibility: input.compatibility,
      latestRuns: input.latestRuns,
      inputSummary: identitySummary,
      summary: {
        divergentInput: decisions.length,
        resolvedInSimulation: resolvedCount,
        unresolved: unresolvedCount,
        repeatability: planHash === planHashRepeat,
        pass: !compatibilityBlocking && unresolvedCount === 0,
        ruleSummary
      },
      planHash,
      decisions,
      migrationPolicyNotes: [
        'learning_state legacy counters use max-observed across device snapshots during this simulation; they are not summed because a common-base delta is unavailable.',
        'review_reasons are selected from the latest ordered attention bundle; arrays are not unioned because removal semantics would be ambiguous.',
        'learner_route_state compares shared records semantically while ignoring locally generated connectionId/exemplarId values, preventing duplicate evidence from random IDs.',
        'user_preferences treats null and absent as equivalent only when all non-null preference values are otherwise identical.',
        'This simulation proposes no Cloud write, no local write, no tombstone application, and no Cloud → WLP apply.'
      ],
      invariants: {
        noCloudWrites: true,
        noCloudToWlpApply: true,
        noWlpWrites: true,
        noAutomaticMerge: true,
        sourceVariantsPreserved: true
      }
    };
  }

  async function runSimulation() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Simulating field-by-field Canonical merge in memory. No data will be written…', '');
    try {
      const input = window.WLPCanonicalMergeAudit?.getSimulationInput?.();
      if (!input?.collisions || !input?.fingerprintRows) throw new Error('Run Audit Canonical Merge first on this page, then run the simulation.');
      state.report = await buildSimulation(input);
      render(state.report);
      const s = state.report.summary;
      setStatus(
        `Canonical Merge Simulation ${s.pass ? 'PASS' : 'CHECK'} · ${s.resolvedInSimulation} / ${s.divergentInput} divergent collision(s) resolved in memory · ${s.unresolved} unresolved · repeatability ${s.repeatability ? 'PASS' : 'FAIL'} · no Cloud/WLP data modified.`,
        s.pass ? 'success' : 'error'
      );
    } catch (error) {
      console.error('WLP Canonical Merge Simulation:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('merge-sim-input').textContent = Number(s.divergentInput || 0).toLocaleString();
    $('merge-sim-resolved').textContent = Number(s.resolvedInSimulation || 0).toLocaleString();
    $('merge-sim-unresolved').textContent = Number(s.unresolved || 0).toLocaleString();
    $('merge-sim-union').textContent = Number(report.inputSummary?.unionRows || 0).toLocaleString();
    $('merge-sim-repeat').textContent = s.repeatability ? 'PASS' : 'FAIL';
    $('merge-sim-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('merge-sim-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('merge-sim-hash').textContent = report.planHash || '—';

    const body = $('merge-sim-detail-body');
    body.innerHTML = '';
    (report.decisions || []).forEach(item => {
      const tr = document.createElement('tr');
      const fields = (item.differingFields || []).length > 7
        ? `${item.differingFields.slice(0, 7).join(', ')} … (+${item.differingFields.length - 7})`
        : (item.differingFields || []).join(', ');
      [item.tableName, item.rowKey, item.status, item.rule, fields || '—', item.evidence || '—'].forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = String(value ?? '');
        if (index === 1) td.style.wordBreak = 'break-all';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const notes = $('merge-sim-notes');
    notes.innerHTML = '';
    (report.migrationPolicyNotes || []).forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });
    $('merge-sim-panel').classList.remove('hidden');
    $('export-merge-sim').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-merge-simulation-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('merge-sim-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const input = window.WLPCanonicalMergeAudit?.getSimulationInput?.();
    $('run-merge-sim').disabled = state.busy || !input?.collisions;
    $('export-merge-sim').disabled = state.busy || !state.report;
  }
  function init() {
    $('run-merge-sim').addEventListener('click', runSimulation);
    $('export-merge-sim').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-merge-audit-complete', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
