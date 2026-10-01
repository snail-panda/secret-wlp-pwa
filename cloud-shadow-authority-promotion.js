/* WLP v1.8.6.204 · Canonical Authority Initial Promotion + Read-back
   Explicitly promotes the already-verified inactive candidate by calling the
   narrowly scoped server-side RPC installed for v204, then reads the single
   authority head back and verifies exact identity. This NEVER applies Cloud
   data to WLP and never rewrites candidate payload rows. Same-candidate retry
   is required to be idempotent. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.204-canonical-authority-promotion-v1';
  const $ = id => document.getElementById(id);
  const state = { busy: false, report: null, promotedSignature: '' };

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

  function expectedInput() {
    const preflight = window.WLPCanonicalAuthorityPromotionPreflight?.getReport?.();
    if (!preflight?.summary?.pass || !preflight.summary.promotionEligible) {
      throw new Error('Authority promotion blocked: run Authority Promotion Preflight and obtain PASS first.');
    }
    if (!['ABSENT', 'SAME_CANDIDATE'].includes(preflight.summary.headState)) {
      throw new Error(`Authority promotion blocked: unsupported head state ${preflight.summary.headState || 'unknown'}.`);
    }
    if (!preflight.candidateKey || !preflight.cutoverTicketHash || !preflight.hashes?.snapshotManifestHash) {
      throw new Error('Authority promotion blocked: candidate/ticket/manifest proof is incomplete.');
    }
    return preflight;
  }

  async function fetchHead(api) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length > 1) throw new Error(`Authority promotion blocked: authority head table returned ${rows.length} rows; expected exactly zero or one.`);
    return rows[0] || null;
  }

  async function fetchCandidate(api, candidateKey) {
    const rows = await api.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,status,last_committed_at,canonical_row_count,cutover_ticket_hash,snapshot_manifest_hash,source_materialization_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`
    );
    if (rows.length !== 1) throw new Error(`Authority promotion blocked: expected one candidate row, found ${rows.length}.`);
    return rows[0];
  }

  function headSignature(head) {
    if (!head) return '';
    return stableStringify({
      head_schema_version: head.head_schema_version,
      candidate_key: head.candidate_key,
      head_version: head.head_version,
      previous_candidate_key: head.previous_candidate_key,
      cutover_ticket_hash: head.cutover_ticket_hash,
      snapshot_manifest_hash: head.snapshot_manifest_hash,
      migration_version: head.migration_version,
      namespace_uuid: head.namespace_uuid,
      card_mapping_hash: head.card_mapping_hash,
      core_library_hash: head.core_library_hash,
      canonical_row_count: head.canonical_row_count,
      promoted_by_device_key: head.promoted_by_device_key,
      promoted_at: head.promoted_at
    });
  }

  async function callPromotionRpc(api, expected, deviceKey) {
    const { data } = await api.rest('rpc/wlp_promote_canonical_authority_initial_v1', {
      method: 'POST',
      body: {
        p_candidate_key: expected.candidateKey,
        p_cutover_ticket_hash: expected.cutoverTicketHash,
        p_snapshot_manifest_hash: expected.hashes.snapshotManifestHash,
        p_device_key: deviceKey
      }
    });
    return data;
  }

  function validate(expected, beforeCandidate, beforeHead, rpcResult, afterCandidate, afterHead, retryRequested) {
    const blocking = [];
    const checks = [];
    const add = (name, pass, evidence) => {
      checks.push({ name, pass: Boolean(pass), evidence: String(evidence ?? '') });
      if (!pass) blocking.push(`${name}: ${evidence}`);
    };

    add('Candidate remains verified', afterCandidate?.status === 'verified', afterCandidate?.status || 'missing');
    add('Candidate metadata unchanged by promotion', stableStringify(beforeCandidate) === stableStringify(afterCandidate), stableStringify(beforeCandidate) === stableStringify(afterCandidate) ? 'unchanged' : 'changed');
    add('Authority head exists after RPC', Boolean(afterHead), afterHead ? 'present' : 'missing');
    add('Head candidate matches verified candidate', afterHead?.candidate_key === expected.candidateKey, afterHead?.candidate_key || 'missing');
    add('Head Cutover Ticket matches', afterHead?.cutover_ticket_hash === expected.cutoverTicketHash, afterHead?.cutover_ticket_hash || 'missing');
    add('Head snapshot manifest matches', afterHead?.snapshot_manifest_hash === expected.hashes.snapshotManifestHash, afterHead?.snapshot_manifest_hash || 'missing');
    add('Head migration version matches', String(afterHead?.migration_version || '') === String(expected.candidate?.migration_version || ''), afterHead?.migration_version || 'missing');
    add('Head namespace matches', afterHead?.namespace_uuid === expected.candidate?.namespace_uuid, afterHead?.namespace_uuid || 'missing');
    add('Head Card Mapping hash matches', afterHead?.card_mapping_hash === expected.candidate?.card_mapping_hash, afterHead?.card_mapping_hash || 'missing');
    add('Head Core Library hash matches', afterHead?.core_library_hash === expected.candidate?.core_library_hash, afterHead?.core_library_hash || 'missing');
    add('Head canonical row count matches', Number(afterHead?.canonical_row_count || 0) === Number(expected.candidate?.canonical_row_count || 0), afterHead?.canonical_row_count ?? 'missing');
    add('Initial head version is 1', Number(afterHead?.head_version || 0) === 1, afterHead?.head_version ?? 'missing');
    add('Initial previous candidate is null', afterHead?.previous_candidate_key == null, afterHead?.previous_candidate_key ?? 'null');
    add('RPC reports active verified authority', rpcResult?.status === 'verified-active', rpcResult?.status || 'missing');

    const beforeSignature = headSignature(beforeHead);
    const afterSignature = headSignature(afterHead);
    let retryIdempotent = null;
    if (retryRequested) {
      retryIdempotent = Boolean(beforeHead && beforeSignature === afterSignature && rpcResult?.idempotent === true && rpcResult?.created === false);
      add('Same-promotion retry is idempotent', retryIdempotent, retryIdempotent ? 'head unchanged; RPC idempotent=true' : 'head changed or RPC did not report idempotency');
    } else if (beforeHead) {
      add('Existing same head remains unchanged', beforeSignature === afterSignature, beforeSignature === afterSignature ? 'unchanged' : 'changed');
    } else {
      add('Initial RPC created the head', rpcResult?.created === true && rpcResult?.idempotent === false, `created=${String(rpcResult?.created)} idempotent=${String(rpcResult?.idempotent)}`);
    }

    return { blocking, checks, retryIdempotent, beforeSignature, afterSignature };
  }

  async function execute(retryRequested) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryRequested
      ? 'Retrying the exact same authority promotion to verify idempotency. No WLP data will be modified…'
      : 'Promoting the verified inactive candidate to the single Canonical Authority Head, then reading it back. No Cloud data will be applied to WLP…', '');

    try {
      const expected = expectedInput();
      const api = window.WLPCloudShadowSupabase;
      if (!api) throw new Error('Supabase Shadow helper is unavailable.');
      await api.ensureSession();
      const device = await api.getDevice();
      const beforeCandidate = await fetchCandidate(api, expected.candidateKey);
      const beforeHead = await fetchHead(api);

      if (retryRequested && !beforeHead) throw new Error('Retry Same Promotion blocked: no authority head exists yet. Run the initial promotion first.');
      if (beforeHead && beforeHead.candidate_key !== expected.candidateKey) {
        throw new Error(`Authority promotion blocked: current head points to a different candidate (${beforeHead.candidate_key}).`);
      }

      const rpcResult = await callPromotionRpc(api, expected, device.deviceKey);
      const afterCandidate = await fetchCandidate(api, expected.candidateKey);
      const afterHead = await fetchHead(api);
      const validation = validate(expected, beforeCandidate, beforeHead, rpcResult, afterCandidate, afterHead, retryRequested);
      const pass = validation.blocking.length === 0;

      state.promotedSignature = validation.afterSignature || state.promotedSignature;
      state.report = {
        format: 'WLP_CANONICAL_AUTHORITY_PROMOTION_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: retryRequested ? 'retry-same-authority-promotion' : 'explicit-initial-authority-promotion',
        candidateKey: expected.candidateKey,
        cutoverTicketHash: expected.cutoverTicketHash,
        snapshotManifestHash: expected.hashes.snapshotManifestHash,
        rpcResult: clone(rpcResult),
        before: { candidate: clone(beforeCandidate), head: clone(beforeHead) },
        after: { candidate: clone(afterCandidate), head: clone(afterHead) },
        summary: {
          candidateStatus: afterCandidate?.status || '',
          headState: afterHead ? 'ACTIVE' : 'ABSENT',
          headVersion: Number(afterHead?.head_version || 0),
          canonicalRows: Number(afterHead?.canonical_row_count || 0),
          blockingIssues: validation.blocking.length,
          retryRequested: Boolean(retryRequested),
          retryIdempotent: retryRequested ? Boolean(validation.retryIdempotent) : null,
          pass
        },
        checks: validation.checks,
        issues: {
          blocking: validation.blocking,
          warnings: [
            'The authority head now identifies the verified Canonical candidate as Cloud authority, but no Cloud data has been applied to WLP.',
            'Candidate payload rows remain immutable audit evidence; promotion changes only the single authority head pointer.',
            'No explicit tombstones exist in this real authority snapshot; tombstone convergence remains to be exercised separately.'
          ]
        },
        invariants: {
          candidatePayloadRowsNotRewrittenByPromotion: true,
          directClientHeadWritesRemainLocked: true,
          promotionViaNarrowServerRpcOnly: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noAbsenceBasedDeletion: true,
          differentExistingHeadCannotBeOverwrittenByInitialRpc: true
        }
      };

      render(state.report);
      setStatus(
        `Authority Promotion ${pass ? 'PASS' : 'CHECK'} · head ${state.report.summary.headState} v${state.report.summary.headVersion} · ${state.report.summary.canonicalRows.toLocaleString()} Canonical rows · ${state.report.summary.blockingIssues} blocker(s)${retryRequested ? ` · retry idempotency ${state.report.summary.retryIdempotent ? 'PASS' : 'FAIL'}` : ''} · no Cloud → WLP apply.`,
        pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-authority-promotion-complete'));
    } catch (error) {
      console.error('WLP Canonical Authority Promotion:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('authority-promotion-head-state').textContent = s.headState || '—';
    $('authority-promotion-head-version').textContent = String(s.headVersion || 0);
    $('authority-promotion-rows').textContent = Number(s.canonicalRows || 0).toLocaleString();
    $('authority-promotion-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('authority-promotion-idempotent').textContent = s.retryRequested ? (s.retryIdempotent ? 'PASS' : 'FAIL') : '—';
    $('authority-promotion-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('authority-promotion-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('authority-promotion-key').textContent = report.candidateKey || '—';
    $('authority-promotion-manifest').textContent = report.snapshotManifestHash || '—';

    const body = $('authority-promotion-proof-body');
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

    const notes = $('authority-promotion-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No authority promotion issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('authority-promotion-panel').classList.remove('hidden');
    $('export-authority-promotion').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-promotion-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('authority-promotion-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const cloud = window.WLPCloudShadowSupabase?.getState?.() || {};
    const preflight = window.WLPCanonicalAuthorityPromotionPreflight?.getReport?.();
    const ready = Boolean(cloud.configured && cloud.signedIn && preflight?.summary?.pass && preflight?.summary?.promotionEligible);
    $('promote-authority-head').disabled = state.busy || !ready;
    $('retry-authority-promotion').disabled = state.busy || !ready || !state.report?.summary?.pass || state.report?.summary?.headState !== 'ACTIVE';
    $('export-authority-promotion').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalAuthorityPromotion = Object.freeze({
    getReport: () => state.report
  });

  function init() {
    $('promote-authority-head').addEventListener('click', () => execute(false));
    $('retry-authority-promotion').addEventListener('click', () => execute(true));
    $('export-authority-promotion').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-authority-promotion-preflight-complete', refreshButtons);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
