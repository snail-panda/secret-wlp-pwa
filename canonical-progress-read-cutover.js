/* WLP Stage 7 v1.8.6.237 — default Canonical Progress read audit across supported Authority v2/v3 mirrors; forced-legacy rollback remains available. */
(() => {
  'use strict';

  const AUDIT_PARAM = 'wlpCanonicalDefaultAudit';
  const FORCE_LEGACY_PARAM = 'wlpLegacyProgressRead';
  const params = new URLSearchParams(location.search);
  if (params.get(AUDIT_PARAM) !== '1') return;

  const AUTHORITY_SPECS = Object.freeze({
    'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283': Object.freeze({ label:'v2', headVersion:2, migrationVersion:'3', manifestHash:'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3', canonicalRows:21424, projectionHash:'94e6eaf163fa0c5b74e6575e16b92e961f00db3a7d2fc36cc42ab910a9fee491' }),
    'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc': Object.freeze({ label:'v3', headVersion:3, migrationVersion:'3', manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63', canonicalRows:21425, projectionHash:null })
  });
  const EXPECTED = Object.freeze({ progressRows:111, reviewRows:25, explicitFirstSeenRows:111, wid2876FirstSeen:1790459055400, v3InteractionEvents:333 });
  const authoritySpec = meta => AUTHORITY_SPECS[String(meta?.candidateKey || '')] || null;

  let report = null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  function platformLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone Safari/WebKit';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    return navigator.platform || 'Browser';
  }

  function numberFromText(value) {
    const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function addPanel() {
    if (document.getElementById('canonical-progress-cutover-panel')) return;
    const panel = document.createElement('section');
    panel.id = 'canonical-progress-cutover-panel';
    panel.style.cssText = 'position:fixed;right:12px;top:78px;z-index:9999;width:min(360px,calc(100vw - 24px));padding:12px 13px;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:var(--panel,#fff);color:inherit;box-shadow:0 8px 30px rgba(0,0,0,.14);font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><strong style="display:block;font-size:14px">Canonical Progress default read</strong><span id="canonical-progress-cutover-copy" style="display:block;margin-top:3px;opacity:.72">Checking default read source…</span></div>
        <strong id="canonical-progress-cutover-result" style="font-size:12px">CHECKING</strong>
      </div>
      <div id="canonical-progress-cutover-detail" style="margin-top:9px;font-size:12px;opacity:.78"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button id="canonical-progress-cutover-export" type="button" disabled style="font:inherit;padding:7px 9px;border:1px solid rgba(127,127,127,.4);border-radius:9px;background:transparent;color:inherit">Export JSON</button>
        <a href="./progress?${FORCE_LEGACY_PARAM}=1" style="padding:7px 9px;border:1px solid rgba(127,127,127,.4);border-radius:9px;color:inherit;text-decoration:none">Force legacy rollback</a>
      </div>`;
    document.body.appendChild(panel);
    document.getElementById('canonical-progress-cutover-export').addEventListener('click', exportReport);
  }

  async function waitForRender() {
    for (let i = 0; i < 150; i++) {
      const getter = window.WLPProgressStage7?.getReadSourceState;
      if (typeof getter === 'function') {
        const state = getter();
        if (state?.rendered) return state;
      }
      await sleep(100);
    }
    return typeof window.WLPProgressStage7?.getReadSourceState === 'function' ? window.WLPProgressStage7.getReadSourceState() : null;
  }

  function buildReport(state) {
    const blocking = [];
    const meta = state?.facadeMeta || {};
    const active = state?.active === true;
    const fallback = state?.fallbackToLegacy === true;
    const coreReadCounts = state?.coreReadCounts || {};
    const canonicalReaderNames = Object.keys(coreReadCounts);
    const allCanonicalReadersUsed = canonicalReaderNames.length === 8 && canonicalReaderNames.every(name => Number(coreReadCounts[name] || 0) > 0);
    const note = String(document.getElementById('progress-data-note')?.textContent || '');
    const domStats = {
      touched: numberFromText(document.getElementById('stat-touched')?.textContent),
      review: numberFromText(document.getElementById('stat-review')?.textContent),
      recent: numberFromText(document.getElementById('stat-recent')?.textContent),
      unseen: numberFromText(document.getElementById('stat-unseen')?.textContent)
    };
    const stateStats = state?.stats || {};
    const domCanonicalParity = ['touched','review','recent','unseen'].every(key => Number(domStats[key]) === Number(stateStats[key] || 0));

    if (!state) blocking.push('Progress read-source state is unavailable.');
    if (state?.defaultCanonical !== true) blocking.push('Progress does not report Canonical as the default read policy.');
    if (state?.forcedLegacy === true) blocking.push('Default-route audit unexpectedly entered forced-legacy mode.');
    if (!state?.requested) blocking.push('Canonical default read was not requested by the page policy.');
    if (!active) blocking.push(`Canonical default read is not active${state?.failure ? `: ${state.failure}` : '.'}`);
    if (fallback) blocking.push('Progress fell back to legacy localStorage core reads.');
    if (!state?.canonicalSnapshotPrepared) blocking.push('Canonical page snapshot was not prepared atomically before render.');
    const expectedAuthority = authoritySpec(meta);
    if (!expectedAuthority) blocking.push('Mirror candidate is not a supported verified Authority v2/v3 candidate.');
    if (expectedAuthority && Number(meta.headVersion || 0) !== expectedAuthority.headVersion) blocking.push(`Mirror Head version is not ${expectedAuthority.headVersion}.`);
    if (expectedAuthority && String(meta.migrationVersion || '') !== expectedAuthority.migrationVersion) blocking.push(`Mirror migration version is not ${expectedAuthority.migrationVersion}.`);
    if (expectedAuthority && String(meta.snapshotManifestHash || '') !== expectedAuthority.manifestHash) blocking.push(`Mirror manifest does not match Authority ${expectedAuthority.label}.`);
    if (!/^[0-9a-f]{64}$/i.test(String(state?.projectionHash || ''))) blocking.push('Compatibility projection hash is missing or malformed.');
    if (expectedAuthority?.projectionHash && String(state?.projectionHash || '') !== expectedAuthority.projectionHash) blocking.push('Compatibility projection hash mismatch for the verified v2 baseline.');
    if (Number(state?.loadedCounts?.progressRecords || 0) !== EXPECTED.progressRows) blocking.push(`Rendered Progress rows are ${state?.loadedCounts?.progressRecords ?? 'unknown'}, expected ${EXPECTED.progressRows}.`);
    if (Number(state?.canonicalReviewRows || 0) !== EXPECTED.reviewRows) blocking.push(`Canonical Review row count is ${state?.canonicalReviewRows ?? 'unknown'}, expected ${EXPECTED.reviewRows}.`);
    if (Number(state?.explicitFirstSeenRows || 0) !== EXPECTED.explicitFirstSeenRows) blocking.push('Explicit firstSeen coverage is incomplete.');
    if (state?.spotCheck2876?.match !== true || Number(state?.spotCheck2876?.firstSeen || 0) !== EXPECTED.wid2876FirstSeen) blocking.push('WID 2876 firstSeen repair is not present in the default cutover.');
    if (expectedAuthority?.label === 'v3' && String(state?.spotCheck2876?.reviewLevel || '') !== 'medium') blocking.push('WID 2876 Review Attention is not Medium in the v3 Progress read.');
    if (expectedAuthority?.label === 'v3' && Number(state?.loadedCounts?.interactionEvents || 0) !== EXPECTED.v3InteractionEvents) blocking.push(`v3 interaction-event count is ${state?.loadedCounts?.interactionEvents ?? 'unknown'}, expected ${EXPECTED.v3InteractionEvents}.`);
    if (Number(state?.legacyCoreReadCalls || 0) !== 0) blocking.push(`${state?.legacyCoreReadCalls} legacy core read call(s) occurred during the default render.`);
    if (!allCanonicalReadersUsed) blocking.push('Not all eight Progress core readers consumed the prepared Canonical snapshot.');
    if (Array.isArray(state?.writeMethodsExposed) && state.writeMethodsExposed.length) blocking.push(`Facade write method(s) exposed: ${state.writeMethodsExposed.join(', ')}.`);
    if (!note.includes('canonical progress') || note.includes('candidate')) blocking.push('Progress UI does not identify the default Canonical read source.');
    if (!domCanonicalParity) blocking.push('Rendered Progress overview metrics do not match the Canonical-backed in-page state.');
    if (Number(stateStats.review || 0) !== EXPECTED.reviewRows) blocking.push(`Canonical-backed Progress Review total is ${stateStats.review ?? 'unknown'}, expected ${EXPECTED.reviewRows}.`);

    return {
      format: 'WLP_CANONICAL_PROGRESS_DEFAULT_READ_CUTOVER',
      version: 1,
      appVersion: '1.8.6.237-progress-default-read-authority-v3-v1',
      generatedAt: new Date().toISOString(),
      mode: 'default-canonical-progress-read-with-forced-legacy-rollback',
      device: { platform: platformLabel() },
      authority: {
        candidateKey: meta.candidateKey || null,
        headVersion: meta.headVersion ?? null,
        migrationVersion: meta.migrationVersion || null,
        snapshotManifestHash: meta.snapshotManifestHash || null,
        projectionHash: state?.projectionHash || null
      },
      summary: {
        defaultCanonicalPolicy: state?.defaultCanonical === true,
        canonicalReadActive: active,
        fallbackToLegacy: fallback,
        forcedLegacy: state?.forcedLegacy === true,
        canonicalSnapshotPrepared: state?.canonicalSnapshotPrepared === true,
        progressRows: Number(state?.loadedCounts?.progressRecords || 0),
        reviewRows: Number(state?.canonicalReviewRows || 0),
        explicitFirstSeenRows: Number(state?.explicitFirstSeenRows || 0),
        legacyCoreReadCalls: Number(state?.legacyCoreReadCalls || 0),
        allCanonicalReadersUsed,
        domCanonicalParity,
        writeMethodsExposed: Array.isArray(state?.writeMethodsExposed) ? state.writeMethodsExposed.length : 0,
        blockingIssues: blocking.length,
        pass: blocking.length === 0
      },
      readSourceState: clone(state || {}),
      pageDom: { dataNote: note, overviewStats: domStats },
      spotCheck2876: clone(state?.spotCheck2876 || null),
      rollback: {
        path: `/progress?${FORCE_LEGACY_PARAM}=1`,
        instruction: `Add ?${FORCE_LEGACY_PARAM}=1 (or use the Force legacy rollback link) to bypass Canonical reads immediately. No data migration is required.`
      },
      issues: { blocking },
      invariants: {
        defaultProgressRouteUsesCanonical: true,
        automaticLegacyFallbackRetained: true,
        explicitForcedLegacyRollbackRetained: true,
        canonicalSourceReadOnly: true,
        noReviewReadCutover: true,
        noLearningWriteCutover: true,
        localUiPreferencesRemainLegacyLocalStorage: true,
        rollbackRequiresNoDataMigration: true,
        supportedActiveAuthorityMirrorRequired: true
      }
    };
  }

  function renderReport(value) {
    report = value;
    window.WLPCanonicalProgressReadCutoverReport = clone(value);
    const result = document.getElementById('canonical-progress-cutover-result');
    const copy = document.getElementById('canonical-progress-cutover-copy');
    const detail = document.getElementById('canonical-progress-cutover-detail');
    const exportButton = document.getElementById('canonical-progress-cutover-export');
    if (!result || !copy || !detail || !exportButton) return;
    result.textContent = value.summary.pass ? 'PASS' : (value.summary.fallbackToLegacy ? 'FALLBACK' : 'BLOCKED');
    result.style.color = value.summary.pass ? '#18794e' : '#b42318';
    copy.textContent = value.summary.pass
      ? `Default Progress route is reading Canonical Authority ${authoritySpec(value.authority)?.label || value.authority?.headVersion || '?'} through the read-only facade.`
      : 'Default Canonical Progress read did not qualify; legacy fallback remains available.';
    detail.textContent = value.summary.pass
      ? `${value.summary.progressRows} Progress rows · ${value.summary.reviewRows} Review · legacy core reads ${value.summary.legacyCoreReadCalls} · blockers 0`
      : `${value.summary.blockingIssues} blocker(s) · ${value.issues.blocking[0] || 'See exported report.'}`;
    exportButton.disabled = false;
  }

  function exportReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-progress-default-read-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function run() {
    addPanel();
    const state = await waitForRender();
    renderReport(buildReport(state));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();
