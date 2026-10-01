/* WLP v1.8.6.218 · Authority v2 FirstSeen Explicit Promotion + Read-back
   Atomically advances the single Canonical Authority Head from the exact
   verified v1 parent to the exact verified v2 FirstSeen-repair candidate via
   a narrowly scoped SECURITY DEFINER RPC. Same-target retry is idempotent.
   This changes only the Cloud authority pointer. It does NOT update the local
   Canonical mirror, legacy localStorage, Progress, Review, Study, or Editor. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.218-first-seen-authority-v2-promotion-v1';
  const RPC_NAME = 'wlp_promote_canonical_authority_revision_v1';
  const PARENT_CANDIDATE = 'v1:5d5ad23a7d6fa181e2ec1642649b059cd4afa21a7af1fd64efc794efe01bae54';
  const PARENT_HEAD_VERSION = 1;
  const PARENT_MANIFEST = '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a';
  const TARGET_CANDIDATE = 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const TARGET_TICKET = '5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const REPAIR_PLAN_HASH = '887098646342a714d04d12d102f99477bb8cc9ecf2f7112afb9f9984767e9df9';
  const TARGET_MANIFEST = 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3';
  const TARGET_MIGRATION_VERSION = '3';
  const EXPECTED_ROWS = 21424;
  const EXPECTED_CHANGED_ROWS = 111;
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

  function api() {
    const helper = window.WLPCloudShadowSupabase;
    if (!helper?.ensureSession || !helper?.fetchPaged || !helper?.rest || !helper?.getDevice) {
      throw new Error('Supabase Shadow helper is unavailable. Reload Cloud Shadow.');
    }
    return helper;
  }

  async function fetchHead(helper) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc'
    );
    if (rows.length !== 1) throw new Error(`Authority v2 promotion blocked: expected exactly one Authority Head, found ${rows.length}.`);
    return rows[0];
  }

  async function fetchCandidate(helper) {
    const rows = await helper.fetchPaged(
      'wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(TARGET_CANDIDATE)}`
    );
    if (rows.length !== 1) throw new Error(`Authority v2 promotion blocked: expected exactly one target candidate, found ${rows.length}.`);
    return rows[0];
  }

  function headSignature(head) {
    return stableStringify({
      head_schema_version: head?.head_schema_version,
      candidate_key: head?.candidate_key,
      head_version: head?.head_version,
      previous_candidate_key: head?.previous_candidate_key,
      cutover_ticket_hash: head?.cutover_ticket_hash,
      snapshot_manifest_hash: head?.snapshot_manifest_hash,
      migration_version: head?.migration_version,
      namespace_uuid: head?.namespace_uuid,
      card_mapping_hash: head?.card_mapping_hash,
      core_library_hash: head?.core_library_hash,
      canonical_row_count: head?.canonical_row_count,
      promoted_by_device_key: head?.promoted_by_device_key,
      promoted_at: head?.promoted_at
    });
  }

  function candidateSignature(candidate) {
    return stableStringify(candidate || null);
  }

  function precheck(head, candidate, retryRequested) {
    const blocking = [];
    const add = (pass, message) => { if (!pass) blocking.push(message); };
    const d = candidate?.diagnostics || {};

    add(candidate?.candidate_key === TARGET_CANDIDATE, 'Target candidate key mismatch.');
    add(candidate?.status === 'verified', `Target candidate status is ${candidate?.status || 'missing'}, expected verified.`);
    add(Number(candidate?.candidate_schema_version || 0) === 1, 'Target candidate schema version mismatch.');
    add(String(candidate?.migration_version || '') === TARGET_MIGRATION_VERSION, 'Target migration version mismatch.');
    add(candidate?.source_plan_hash === REPAIR_PLAN_HASH, 'Target repair-plan hash mismatch.');
    add(candidate?.source_materialization_hash === PARENT_MANIFEST, 'Target parent/source manifest mismatch.');
    add(candidate?.cutover_ticket_hash === TARGET_TICKET, 'Target revision ticket mismatch.');
    add(candidate?.snapshot_manifest_hash === TARGET_MANIFEST, 'Target snapshot manifest mismatch.');
    add(Number(candidate?.canonical_row_count || 0) === EXPECTED_ROWS, 'Target canonical row count mismatch.');
    add(Number(d.authorityRevision || 0) === 2, 'Target diagnostics authority revision mismatch.');
    add(d.parentCandidateKey === PARENT_CANDIDATE, 'Target diagnostics parent candidate mismatch.');
    add(Number(d.parentHeadVersion || 0) === PARENT_HEAD_VERSION, 'Target diagnostics parent head version mismatch.');
    add(d.parentManifestHash === PARENT_MANIFEST, 'Target diagnostics parent manifest mismatch.');
    add(d.repair === 'explicit-first_seen_at', 'Target diagnostics repair kind mismatch.');
    add(d.changedTable === 'learning_state', 'Target diagnostics changed table mismatch.');
    add(Number(d.changedRows || 0) === EXPECTED_CHANGED_ROWS, 'Target diagnostics changed row count mismatch.');
    add(Number(d.firstSeenEvidenceRows || 0) === EXPECTED_CHANGED_ROWS, 'Target diagnostics FirstSeen evidence count mismatch.');
    add(Number(d.sourceFirstSeenDisagreements || 0) === 0, 'Target diagnostics source FirstSeen disagreement detected.');

    const parentState = head?.candidate_key === PARENT_CANDIDATE
      && Number(head?.head_version || 0) === PARENT_HEAD_VERSION
      && head?.snapshot_manifest_hash === PARENT_MANIFEST;
    const targetState = head?.candidate_key === TARGET_CANDIDATE
      && Number(head?.head_version || 0) === 2
      && head?.previous_candidate_key === PARENT_CANDIDATE
      && head?.cutover_ticket_hash === TARGET_TICKET
      && head?.snapshot_manifest_hash === TARGET_MANIFEST
      && String(head?.migration_version || '') === TARGET_MIGRATION_VERSION;

    if (retryRequested) add(targetState, 'Retry blocked: Authority Head is not already the exact promoted v2 target.');
    else add(parentState || targetState, `Promotion blocked: Authority Head is neither the exact v1 parent nor the exact already-promoted v2 target (found ${head?.candidate_key || 'missing'} · v${head?.head_version ?? '?'}).`);

    add(candidate?.namespace_uuid === head?.namespace_uuid, 'Namespace UUID does not match current Authority Head.');
    add(candidate?.card_mapping_hash === head?.card_mapping_hash, 'Card Mapping hash does not match current Authority Head.');
    add(candidate?.core_library_hash === head?.core_library_hash, 'Core Library hash does not match current Authority Head.');

    if (blocking.length) throw new Error(`Authority v2 promotion blocked: ${blocking.join(' ')}`);
    return { parentState, targetState };
  }

  async function callRpc(helper, deviceKey) {
    const { data } = await helper.rest(`rpc/${RPC_NAME}`, {
      method: 'POST',
      body: {
        p_parent_candidate_key: PARENT_CANDIDATE,
        p_parent_head_version: PARENT_HEAD_VERSION,
        p_parent_snapshot_manifest_hash: PARENT_MANIFEST,
        p_candidate_key: TARGET_CANDIDATE,
        p_revision_ticket_hash: TARGET_TICKET,
        p_repair_plan_hash: REPAIR_PLAN_HASH,
        p_snapshot_manifest_hash: TARGET_MANIFEST,
        p_device_key: deviceKey
      }
    });
    return data;
  }

  function validate(beforeHead, beforeCandidate, rpcResult, afterHead, afterCandidate, retryRequested) {
    const blocking = [];
    const checks = [];
    const add = (name, pass, evidence) => {
      const item = { name, pass: Boolean(pass), evidence: String(evidence ?? '') };
      checks.push(item);
      if (!item.pass) blocking.push(`${name}: ${item.evidence}`);
    };

    add('Target candidate remains verified', afterCandidate?.status === 'verified', `status=${afterCandidate?.status || 'missing'}`);
    add('Target candidate metadata unchanged by promotion', candidateSignature(beforeCandidate) === candidateSignature(afterCandidate), candidateSignature(beforeCandidate) === candidateSignature(afterCandidate) ? 'unchanged' : 'changed');
    add('Head candidate advanced to exact v2 candidate', afterHead?.candidate_key === TARGET_CANDIDATE, afterHead?.candidate_key || 'missing');
    add('Head version advanced to 2', Number(afterHead?.head_version || 0) === 2, afterHead?.head_version ?? 'missing');
    add('Head previous candidate records exact v1 parent', afterHead?.previous_candidate_key === PARENT_CANDIDATE, afterHead?.previous_candidate_key || 'missing');
    add('Head revision ticket matches v2', afterHead?.cutover_ticket_hash === TARGET_TICKET, afterHead?.cutover_ticket_hash || 'missing');
    add('Head v2 manifest matches', afterHead?.snapshot_manifest_hash === TARGET_MANIFEST, afterHead?.snapshot_manifest_hash || 'missing');
    add('Head migration version is 3', String(afterHead?.migration_version || '') === TARGET_MIGRATION_VERSION, afterHead?.migration_version || 'missing');
    add('Head namespace unchanged', afterHead?.namespace_uuid === afterCandidate?.namespace_uuid, afterHead?.namespace_uuid || 'missing');
    add('Head Card Mapping hash unchanged', afterHead?.card_mapping_hash === afterCandidate?.card_mapping_hash, afterHead?.card_mapping_hash || 'missing');
    add('Head Core Library hash unchanged', afterHead?.core_library_hash === afterCandidate?.core_library_hash, afterHead?.core_library_hash || 'missing');
    add('Head canonical row count remains 21,424', Number(afterHead?.canonical_row_count || 0) === EXPECTED_ROWS, afterHead?.canonical_row_count ?? 'missing');
    add('RPC reports verified active revision', rpcResult?.status === 'verified-active-revision', rpcResult?.status || 'missing');
    add('RPC reports exact parent transition', rpcResult?.previous_candidate_key === PARENT_CANDIDATE, rpcResult?.previous_candidate_key || 'missing');
    add('RPC reports 111 targeted changed rows', Number(rpcResult?.changed_rows || 0) === EXPECTED_CHANGED_ROWS, rpcResult?.changed_rows ?? 'missing');
    add('RPC reports no identity changes', Number(rpcResult?.missing_rows || 0) === 0 && Number(rpcResult?.extra_rows || 0) === 0, `missing=${rpcResult?.missing_rows ?? '?'} extra=${rpcResult?.extra_rows ?? '?'}`);
    add('RPC reports no tombstone changes', Number(rpcResult?.tombstone_changes || 0) === 0, rpcResult?.tombstone_changes ?? 'missing');
    add('RPC reports FirstSeen complete', Number(rpcResult?.learning_state_rows_with_first_seen || 0) === EXPECTED_CHANGED_ROWS, rpcResult?.learning_state_rows_with_first_seen ?? 'missing');

    let retryIdempotent = null;
    if (retryRequested) {
      retryIdempotent = headSignature(beforeHead) === headSignature(afterHead)
        && rpcResult?.idempotent === true
        && rpcResult?.updated === false;
      add('Same v2 promotion retry is idempotent', retryIdempotent, retryIdempotent ? 'head unchanged; RPC idempotent=true' : 'head changed or RPC idempotency proof failed');
    } else if (beforeHead?.candidate_key === TARGET_CANDIDATE) {
      retryIdempotent = headSignature(beforeHead) === headSignature(afterHead)
        && rpcResult?.idempotent === true
        && rpcResult?.updated === false;
      add('Already-promoted v2 target remains unchanged', retryIdempotent, retryIdempotent ? 'unchanged' : 'unexpected change');
    } else {
      add('First v1 → v2 transition updated the Head exactly once', beforeHead?.candidate_key === PARENT_CANDIDATE && rpcResult?.updated === true && rpcResult?.idempotent === false, `before=${beforeHead?.candidate_key || 'missing'} updated=${String(rpcResult?.updated)} idempotent=${String(rpcResult?.idempotent)}`);
    }

    return { checks, blocking, retryIdempotent };
  }

  async function execute(retryRequested) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryRequested
      ? 'Retrying the exact same v2 Head promotion to prove idempotency…'
      : 'Promoting the exact verified Authority v2 Candidate. This changes only the Cloud authority pointer…', '');
    try {
      const helper = api();
      await helper.ensureSession();
      const device = await helper.getDevice();
      const beforeHead = await fetchHead(helper);
      const beforeCandidate = await fetchCandidate(helper);
      precheck(beforeHead, beforeCandidate, retryRequested);

      const rpcResult = await callRpc(helper, device.deviceKey);
      const afterHead = await fetchHead(helper);
      const afterCandidate = await fetchCandidate(helper);
      const validation = validate(beforeHead, beforeCandidate, rpcResult, afterHead, afterCandidate, retryRequested);
      const pass = validation.blocking.length === 0;

      state.report = {
        format: 'WLP_CANONICAL_AUTHORITY_V2_PROMOTION_REPORT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: retryRequested ? 'retry-same-authority-v2-promotion' : 'explicit-authority-v1-to-v2-promotion',
        parent: { candidateKey: PARENT_CANDIDATE, headVersion: PARENT_HEAD_VERSION, manifestHash: PARENT_MANIFEST },
        target: { candidateKey: TARGET_CANDIDATE, headVersion: 2, revisionTicketHash: TARGET_TICKET, repairPlanHash: REPAIR_PLAN_HASH, manifestHash: TARGET_MANIFEST, migrationVersion: TARGET_MIGRATION_VERSION, canonicalRows: EXPECTED_ROWS },
        rpcResult: clone(rpcResult),
        before: { head: clone(beforeHead), candidate: clone(beforeCandidate) },
        after: { head: clone(afterHead), candidate: clone(afterCandidate) },
        summary: {
          headState: afterHead?.candidate_key === TARGET_CANDIDATE ? 'V2_ACTIVE' : 'UNEXPECTED',
          headVersion: Number(afterHead?.head_version || 0),
          previousCandidateKey: afterHead?.previous_candidate_key || null,
          canonicalRows: Number(afterHead?.canonical_row_count || 0),
          changedLearningStateRows: Number(rpcResult?.changed_rows || 0),
          blockingIssues: validation.blocking.length,
          retryRequested: Boolean(retryRequested),
          retryIdempotent: retryRequested ? Boolean(validation.retryIdempotent) : (beforeHead?.candidate_key === TARGET_CANDIDATE ? Boolean(validation.retryIdempotent) : null),
          pass
        },
        checks: validation.checks,
        issues: {
          blocking: validation.blocking,
          warnings: [
            'Authority Head now points to the verified v2 FirstSeen-repair candidate. Candidate payload rows remain immutable audit evidence.',
            'The installed local wlp-cloud-v1 Canonical mirror is still the verified v1 snapshot until a separate mirror revision/apply step. This promotion does not rewrite IndexedDB.',
            'Progress, Review, Study, Editor, and legacy localStorage remain untouched. No Cloud → live WLP cutover occurs here.',
            'No explicit tombstones exist in current real data; tombstone behavior remains unexercised.'
          ]
        },
        invariants: {
          promotionViaNarrowServerRpcOnly: true,
          directClientHeadWritesRemainLocked: true,
          candidatePayloadRowsNotRewrittenByPromotion: true,
          exactParentRequiredForFirstTransition: true,
          sameTargetRetryIdempotent: retryRequested ? Boolean(validation.retryIdempotent) : null,
          noCanonicalMirrorWrites: true,
          noIndexedDbWrites: true,
          noLegacyLocalStorageWrites: true,
          noCloudToLiveWlpApply: true,
          noLiveWlpWrites: true,
          noAbsenceBasedDeletion: true
        }
      };
      render(state.report);
      setStatus(
        `Authority v2 Promotion ${pass ? 'PASS' : 'CHECK'} · Head ${state.report.summary.headState} v${state.report.summary.headVersion} · ${state.report.summary.canonicalRows.toLocaleString()} rows · ${state.report.summary.changedLearningStateRows} targeted state changes · ${state.report.summary.blockingIssues} blocker(s)${retryRequested ? ` · retry ${state.report.summary.retryIdempotent ? 'PASS' : 'FAIL'}` : ''}.`,
        pass ? 'success' : 'error'
      );
    } catch (error) {
      console.error('WLP Authority v2 Promotion:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value) {
    state.busy = value;
    const run = $('promote-first-seen-authority-v2');
    const retry = $('retry-first-seen-authority-v2-promotion');
    if (run) run.disabled = value;
    if (retry) retry.disabled = value || !state.report?.summary?.pass;
  }

  function setStatus(message, kind = '') {
    const el = $('first-seen-authority-v2-promotion-status');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('success', 'error');
    if (kind) el.classList.add(kind);
  }

  function render(report) {
    $('first-seen-authority-v2-promotion-panel')?.classList.remove('hidden');
    const s = report.summary || {};
    $('first-seen-authority-v2-promotion-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('first-seen-authority-v2-promotion-state').textContent = s.headState || '—';
    $('first-seen-authority-v2-promotion-version').textContent = String(s.headVersion || 0);
    $('first-seen-authority-v2-promotion-rows').textContent = Number(s.canonicalRows || 0).toLocaleString();
    $('first-seen-authority-v2-promotion-changed').textContent = Number(s.changedLearningStateRows || 0).toLocaleString();
    $('first-seen-authority-v2-promotion-blocking').textContent = Number(s.blockingIssues || 0).toLocaleString();
    $('first-seen-authority-v2-promotion-idempotent').textContent = s.retryRequested ? (s.retryIdempotent ? 'PASS' : 'FAIL') : '—';
    $('first-seen-authority-v2-promotion-key').textContent = report.target?.candidateKey || '';
    $('first-seen-authority-v2-promotion-manifest').textContent = report.target?.manifestHash || '';
    const body = $('first-seen-authority-v2-promotion-proof-body');
    if (body) {
      body.innerHTML = '';
      (report.checks || []).forEach(check => {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td'); td1.textContent = check.name;
        const td2 = document.createElement('td'); td2.textContent = check.pass ? 'PASS' : 'FAIL';
        const td3 = document.createElement('td'); td3.textContent = check.evidence;
        tr.append(td1, td2, td3); body.appendChild(tr);
      });
    }
    const notes = $('first-seen-authority-v2-promotion-notes');
    if (notes) {
      notes.innerHTML = '';
      [...(report.issues?.blocking || []).map(x => `BLOCKING · ${x}`), ...(report.issues?.warnings || [])].forEach(note => {
        const li = document.createElement('li'); li.textContent = note; notes.appendChild(li);
      });
    }
    const retry = $('retry-first-seen-authority-v2-promotion');
    const exp = $('export-first-seen-authority-v2-promotion');
    if (retry) retry.disabled = !s.pass;
    if (exp) exp.disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-authority-v2-promotion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function init() {
    $('promote-first-seen-authority-v2')?.addEventListener('click', () => execute(false));
    $('retry-first-seen-authority-v2-promotion')?.addEventListener('click', () => execute(true));
    $('export-first-seen-authority-v2-promotion')?.addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
