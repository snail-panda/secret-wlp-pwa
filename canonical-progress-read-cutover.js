/* WLP v1.8.6.221 — query-gated, rollbackable Canonical Progress read cutover candidate audit. */
(() => {
  'use strict';

  const PARAM = 'wlpCanonicalRead';
  if (new URLSearchParams(location.search).get(PARAM) !== '1') return;

  const EXPECTED = Object.freeze({
    candidateKey: 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283',
    headVersion: 2,
    migrationVersion: '3',
    manifestHash: 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3',
    projectionHash: '94e6eaf163fa0c5b74e6575e16b92e961f00db3a7d2fc36cc42ab910a9fee491',
    progressRows: 111,
    reviewRows: 25,
    explicitFirstSeenRows: 111,
    wid2876FirstSeen: 1790459055400
  });

  let report = null;
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const numberFromText = text => Number(String(text || '').replace(/[^0-9.-]/g, '')) || 0;

  function platformLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) return 'iPhone Safari/WebKit';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    return navigator.platform || 'Browser';
  }

  function addPanel() {
    if (document.getElementById('canonical-progress-cutover-panel')) return;
    const panel = document.createElement('section');
    panel.id = 'canonical-progress-cutover-panel';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = [
      'position:fixed','z-index:9999','top:12px','right:12px','width:min(360px,calc(100vw - 24px))',
      'box-sizing:border-box','padding:13px 14px','border:1px solid rgba(127,127,127,.32)',
      'border-radius:14px','background:rgba(255,255,255,.97)','color:#1b1b1b',
      'box-shadow:0 12px 30px rgba(0,0,0,.16)','font:13px/1.38 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div><strong style="display:block;font-size:14px">Canonical Progress read candidate</strong><span id="canonical-progress-cutover-copy" style="display:block;margin-top:3px;opacity:.72">Checking gated read source…</span></div>
        <strong id="canonical-progress-cutover-result" style="font-size:12px">CHECKING</strong>
      </div>
      <div id="canonical-progress-cutover-detail" style="margin-top:9px;font-size:12px;opacity:.78"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button id="canonical-progress-cutover-export" type="button" disabled style="font:inherit;padding:7px 9px;border:1px solid rgba(127,127,127,.4);border-radius:9px;background:transparent;color:inherit">Export JSON</button>
        <a href="./progress" style="padding:7px 9px;border:1px solid rgba(127,127,127,.4);border-radius:9px;color:inherit;text-decoration:none">Rollback to legacy</a>
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
    if (!state?.requested) blocking.push('Canonical read candidate was not requested.');
    if (!active) blocking.push(`Canonical read candidate is not active${state?.failure ? `: ${state.failure}` : '.'}`);
    if (fallback) blocking.push('Progress fell back to legacy localStorage core reads.');
    if (!state?.canonicalSnapshotPrepared) blocking.push('Canonical page snapshot was not prepared atomically before render.');
    if (String(meta.candidateKey || '') !== EXPECTED.candidateKey) blocking.push('Mirror candidate is not the verified Authority v2 candidate.');
    if (Number(meta.headVersion || 0) !== EXPECTED.headVersion) blocking.push('Mirror Head version is not 2.');
    if (String(meta.migrationVersion || '') !== EXPECTED.migrationVersion) blocking.push('Mirror migration version is not 3.');
    if (String(meta.snapshotManifestHash || '') !== EXPECTED.manifestHash) blocking.push('Mirror manifest does not match Authority v2.');
    if (String(state?.projectionHash || '') !== EXPECTED.projectionHash) blocking.push('Compatibility projection hash mismatch.');
    if (Number(state?.loadedCounts?.progressRecords || 0) !== EXPECTED.progressRows) blocking.push(`Rendered Progress rows are ${state?.loadedCounts?.progressRecords ?? 'unknown'}, expected ${EXPECTED.progressRows}.`);
    if (Number(state?.canonicalReviewRows || 0) !== EXPECTED.reviewRows) blocking.push(`Canonical Review row count is ${state?.canonicalReviewRows ?? 'unknown'}, expected ${EXPECTED.reviewRows}.`);
    if (Number(state?.explicitFirstSeenRows || 0) !== EXPECTED.explicitFirstSeenRows) blocking.push('Explicit firstSeen coverage is incomplete.');
    if (state?.spotCheck2876?.match !== true || Number(state?.spotCheck2876?.firstSeen || 0) !== EXPECTED.wid2876FirstSeen) blocking.push('WID 2876 firstSeen repair is not present in the live cutover candidate.');
    if (Number(state?.legacyCoreReadCalls || 0) !== 0) blocking.push(`${state?.legacyCoreReadCalls} legacy core read call(s) occurred during the candidate render.`);
    if (!allCanonicalReadersUsed) blocking.push('Not all eight Progress core readers consumed the prepared Canonical snapshot.');
    if (Array.isArray(state?.writeMethodsExposed) && state.writeMethodsExposed.length) blocking.push(`Facade write method(s) exposed: ${state.writeMethodsExposed.join(', ')}.`);
    if (!note.includes('canonical progress candidate')) blocking.push('Progress UI does not identify the Canonical candidate read source.');
    if (!domCanonicalParity) blocking.push('Rendered Progress overview metrics do not match the Canonical-backed in-page state.');
    if (Number(stateStats.review || 0) !== EXPECTED.reviewRows) blocking.push(`Canonical-backed Progress Review total is ${stateStats.review ?? 'unknown'}, expected ${EXPECTED.reviewRows}.`);

    return {
      format: 'WLP_CANONICAL_PROGRESS_READ_CUTOVER_CANDIDATE',
      version: 1,
      appVersion: '1.8.6.221-progress-read-cutover-candidate-v1',
      generatedAt: new Date().toISOString(),
      mode: 'query-gated-rollbackable-progress-canonical-read-candidate',
      device: { platform: platformLabel() },
      authority: {
        candidateKey: meta.candidateKey || null,
        headVersion: meta.headVersion ?? null,
        migrationVersion: meta.migrationVersion || null,
        snapshotManifestHash: meta.snapshotManifestHash || null,
        projectionHash: state?.projectionHash || null
      },
      summary: {
        requested: state?.requested === true,
        canonicalReadActive: active,
        fallbackToLegacy: fallback,
        canonicalSnapshotPrepared: state?.canonicalSnapshotPrepared === true,
        progressRows: Number(state?.loadedCounts?.progressRecords || 0),
        reviewRows: Number(state?.canonicalReviewRows || 0),
        practiceEvents: Number(state?.loadedCounts?.practiceEvents || 0),
        activityEvents: Number(state?.loadedCounts?.activityEvents || 0),
        interactionEvents: Number(state?.loadedCounts?.interactionEvents || 0),
        standardSessions: Number(state?.loadedCounts?.studyQSessions || 0),
        aiEvents: Number(state?.loadedCounts?.aiStudyEvents || 0),
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
        path: '/progress',
        instruction: 'Remove ?wlpCanonicalRead=1 (or use the Rollback to legacy link) to return immediately to legacy localStorage core reads. No data migration is required.'
      },
      issues: { blocking },
      invariants: {
        queryGatedCandidateOnly: true,
        defaultProgressRouteRemainsLegacy: true,
        canonicalSourceReadOnly: true,
        noReviewReadCutover: true,
        noLearningWriteCutover: true,
        localUiPreferencesRemainLegacyLocalStorage: true,
        rollbackRequiresNoDataMigration: true,
        activeAuthorityV2MirrorRequired: true
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
      ? 'Progress is reading Canonical Authority v2 through the read-only facade.'
      : 'The candidate did not qualify; legacy remains the safe rollback path.';
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
    a.download = `wlp-canonical-progress-read-cutover-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
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
