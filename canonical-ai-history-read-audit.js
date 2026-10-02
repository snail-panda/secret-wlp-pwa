/* WLP v1.8.6.295 — AI Practice Canonical history read-only audit.
   Diagnostic only: compares current-device AI Practice localStorage with the verified
   Canonical Storage Compatibility Facade for AI events, completed session history,
   learner route state, and learner profile. It does not write localStorage, IndexedDB,
   Cloud, sync_outbox, or production AI Practice state.
   Enable only with ?wlpAIHistoryAudit=1. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.295-ai-practice-canonical-history-read-audit-v1';
  const FLAG = 'wlpAIHistoryAudit';
  const AI_EVENT_KEY = 'wlp:ai-study-events:v1';
  const AI_SESSION_KEY = 'wlp:ai-study-session-history:v1';
  const AI_ROUTE_KEY = 'wlp:ai-route-state:v1';
  const AI_PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const state = { busy: false, report: null, panel: null, status: null, detail: null, exportButton: null };

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const asArray = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function safeParse(raw, fallback) { try { const parsed = JSON.parse(raw); return parsed == null ? clone(fallback) : parsed; } catch (_) { return clone(fallback); } }
  function readArray(key) { return asArray(safeParse(localStorage.getItem(key) || '', [])); }
  function readObject(key) { return asObject(safeParse(localStorage.getItem(key) || '', {})); }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableValue(value[key]); });
      return out;
    }
    return value;
  }
  const stableStringify = value => JSON.stringify(stableValue(value));

  function auditActive() { return new URLSearchParams(location.search).get(FLAG) === '1'; }
  function eventId(item) { return clean(item?.eventId ?? item?.event_id ?? item?.id); }
  function sessionId(item) { return clean(item?.sessionId ?? item?.session_id ?? item?.id); }
  function eventSessionId(item) { return clean(item?.sessionId ?? item?.session_id); }
  function updatedAt(item) { return clean(item?.updatedAt ?? item?.updated_at); }

  function indexBy(items, getId) {
    const map = new Map();
    const duplicates = [];
    const missingIdentity = [];
    items.forEach((item, index) => {
      const id = getId(item);
      if (!id) { missingIdentity.push(index); return; }
      if (map.has(id)) duplicates.push(id);
      else map.set(id, item);
    });
    return { map, duplicates: [...new Set(duplicates)], missingIdentity };
  }

  function compareIdentity(localItems, canonicalItems, getId) {
    const localIndex = indexBy(localItems, getId);
    const canonicalIndex = indexBy(canonicalItems, getId);
    const localIds = [...localIndex.map.keys()];
    const canonicalIds = [...canonicalIndex.map.keys()];
    const localOnly = localIds.filter(id => !canonicalIndex.map.has(id));
    const canonicalOnly = canonicalIds.filter(id => !localIndex.map.has(id));
    const shared = localIds.filter(id => canonicalIndex.map.has(id));
    const payloadMismatches = shared.filter(id => stableStringify(localIndex.map.get(id)) !== stableStringify(canonicalIndex.map.get(id)));
    return {
      localCount: localItems.length,
      canonicalCount: canonicalItems.length,
      sharedCount: shared.length,
      localOnlyCount: localOnly.length,
      canonicalOnlyCount: canonicalOnly.length,
      sharedPayloadMismatchCount: payloadMismatches.length,
      localOnlyIds: localOnly,
      canonicalOnlyIds: canonicalOnly,
      sharedPayloadMismatchIds: payloadMismatches,
      localDuplicateIds: localIndex.duplicates,
      canonicalDuplicateIds: canonicalIndex.duplicates,
      localMissingIdentityIndexes: localIndex.missingIdentity,
      canonicalMissingIdentityIndexes: canonicalIndex.missingIdentity
    };
  }

  function turnEventCoverage(sessions, events) {
    const eventIds = new Set(events.map(eventId).filter(Boolean));
    let refs = 0;
    let missing = 0;
    const missingRefs = [];
    sessions.forEach(session => {
      asArray(session?.turns).forEach(turn => {
        const id = eventId(turn);
        if (!id) return;
        refs += 1;
        if (!eventIds.has(id)) {
          missing += 1;
          missingRefs.push({ sessionId: sessionId(session), eventId: id, wordId: clean(turn?.wordId) || null });
        }
      });
    });
    return { references: refs, missing, missingRefs };
  }

  function eventSessionCoverage(events, sessions) {
    const sessionIds = new Set(sessions.map(sessionId).filter(Boolean));
    const refs = events.map(event => ({ eventId: eventId(event), sessionId: eventSessionId(event), wordId: clean(event?.wordId) || null })).filter(item => item.sessionId);
    const missingRefs = refs.filter(item => !sessionIds.has(item.sessionId));
    return { references: refs.length, missing: missingRefs.length, missingRefs };
  }

  function profileSummary(value) {
    const root = asObject(value);
    return {
      updatedAt: updatedAt(root) || null,
      productionTendencies: asArray(root.productionTendencies).length,
      reusableConstructions: asArray(root.reusableConstructions).length,
      styleTendencies: asArray(root.styleTendencies).length
    };
  }

  function routeSummary(value) {
    const root = asObject(value);
    const records = asObject(root.records);
    return { updatedAt: updatedAt(root) || null, records: Object.keys(records).length };
  }

  function makePanel() {
    if (state.panel || !auditActive()) return;
    const panel = document.createElement('section');
    panel.id = 'wlp-ai-history-read-audit';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'position:fixed;z-index:100004;right:8px;top:max(8px,env(safe-area-inset-top));width:min(430px,calc(100vw - 16px));max-height:56vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML = '<strong style="display:block;font-size:13px">AI Practice · Canonical history read audit</strong><div id="wlp-ai-history-read-audit-status" style="margin-top:4px">Waiting…</div><div id="wlp-ai-history-read-audit-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-ai-history-read-audit-run" type="button">Run audit</button><button id="wlp-ai-history-read-audit-export" type="button" disabled>Export JSON</button></div>';
    document.body.appendChild(panel);
    state.panel = panel;
    state.status = panel.querySelector('#wlp-ai-history-read-audit-status');
    state.detail = panel.querySelector('#wlp-ai-history-read-audit-detail');
    state.exportButton = panel.querySelector('#wlp-ai-history-read-audit-export');
    panel.querySelectorAll('button').forEach(button => { button.style.cssText = 'font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22'; });
    panel.querySelector('#wlp-ai-history-read-audit-run').addEventListener('click', () => { void runAudit(); });
    state.exportButton.addEventListener('click', exportReport);
  }

  function setStatus(text, ok = null, detail = '') {
    makePanel();
    if (!state.status) return;
    state.status.textContent = text;
    state.status.style.fontWeight = ok == null ? '500' : '700';
    state.status.style.color = ok === true ? '#18794e' : ok === false ? '#b42318' : '#1c2d22';
    state.detail.textContent = detail;
    state.exportButton.disabled = !state.report;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-ai-canonical-history-read-audit-${String(state.report.generatedAt || new Date().toISOString()).replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function openFacade() {
    const provider = window.WLPCanonicalStorageCompatibilityFacade;
    if (!provider?.open || provider.readOnly !== true) throw new Error('Read-only Canonical Storage Compatibility Facade is unavailable.');
    const facade = await provider.open();
    if (!facade?.readOnly || typeof facade.readAIStudyEvents !== 'function' || typeof facade.readAISessions !== 'function' || typeof facade.readAIRouteState !== 'function' || typeof facade.readAILearnerProfile !== 'function') {
      throw new Error('Canonical AI readers are unavailable.');
    }
    return facade;
  }

  async function runAudit() {
    if (!auditActive() || state.busy) return state.report;
    state.busy = true;
    setStatus('Reading local AI Practice data and Canonical AI streams…');
    try {
      const facade = await openFacade();
      const localEvents = readArray(AI_EVENT_KEY);
      const localSessions = readArray(AI_SESSION_KEY);
      const localRoute = readObject(AI_ROUTE_KEY);
      const localProfile = readObject(AI_PROFILE_KEY);
      const canonicalEvents = asArray(facade.readAIStudyEvents());
      const canonicalSessions = asArray(facade.readAISessions());
      const canonicalRoute = asObject(facade.readAIRouteState());
      const canonicalProfile = asObject(facade.readAILearnerProfile());

      const events = compareIdentity(localEvents, canonicalEvents, eventId);
      const sessions = compareIdentity(localSessions, canonicalSessions, sessionId);
      const localTurnCoverage = turnEventCoverage(localSessions, localEvents);
      const canonicalTurnCoverage = turnEventCoverage(canonicalSessions, canonicalEvents);
      const localEventSessionCoverage = eventSessionCoverage(localEvents, localSessions);
      const canonicalEventSessionCoverage = eventSessionCoverage(canonicalEvents, canonicalSessions);
      const routeExactMatch = stableStringify(localRoute) === stableStringify(canonicalRoute);
      const profileExactMatch = stableStringify(localProfile) === stableStringify(canonicalProfile);

      const structuralIssues = [];
      if (events.localDuplicateIds.length) structuralIssues.push(`${events.localDuplicateIds.length} duplicate local AI event id(s).`);
      if (events.canonicalDuplicateIds.length) structuralIssues.push(`${events.canonicalDuplicateIds.length} duplicate Canonical AI event id(s).`);
      if (events.localMissingIdentityIndexes.length) structuralIssues.push(`${events.localMissingIdentityIndexes.length} local AI event(s) without eventId.`);
      if (events.canonicalMissingIdentityIndexes.length) structuralIssues.push(`${events.canonicalMissingIdentityIndexes.length} Canonical AI event(s) without eventId.`);
      if (sessions.localDuplicateIds.length) structuralIssues.push(`${sessions.localDuplicateIds.length} duplicate local AI session id(s).`);
      if (sessions.canonicalDuplicateIds.length) structuralIssues.push(`${sessions.canonicalDuplicateIds.length} duplicate Canonical AI session id(s).`);
      if (sessions.localMissingIdentityIndexes.length) structuralIssues.push(`${sessions.localMissingIdentityIndexes.length} local AI session(s) without sessionId.`);
      if (sessions.canonicalMissingIdentityIndexes.length) structuralIssues.push(`${sessions.canonicalMissingIdentityIndexes.length} Canonical AI session(s) without sessionId.`);

      state.report = {
        format: 'WLP_CANONICAL_AI_PRACTICE_HISTORY_READ_AUDIT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-local-vs-canonical-ai-history-authority-audit',
        authority: {
          source: clean(facade.source),
          candidateKey: clean(facade.meta?.candidateKey),
          headVersion: Number(facade.meta?.headVersion || 0),
          snapshotManifestHash: clean(facade.meta?.snapshotManifestHash),
          pendingOutboxRows: Number(facade.pendingOutboxRows || 0)
        },
        summary: {
          blockingIssues: structuralIssues.length,
          auditPass: structuralIssues.length === 0,
          localAIEvents: localEvents.length,
          canonicalAIEvents: canonicalEvents.length,
          sharedAIEvents: events.sharedCount,
          localOnlyAIEvents: events.localOnlyCount,
          canonicalOnlyAIEvents: events.canonicalOnlyCount,
          sharedAIEventPayloadMismatches: events.sharedPayloadMismatchCount,
          localAISessions: localSessions.length,
          canonicalAISessions: canonicalSessions.length,
          sharedAISessions: sessions.sharedCount,
          localOnlyAISessions: sessions.localOnlyCount,
          canonicalOnlyAISessions: sessions.canonicalOnlyCount,
          sharedAISessionPayloadMismatches: sessions.sharedPayloadMismatchCount,
          routeExactMatch,
          profileExactMatch,
          localSessionTurnEventRefs: localTurnCoverage.references,
          localSessionTurnMissingEvents: localTurnCoverage.missing,
          canonicalSessionTurnEventRefs: canonicalTurnCoverage.references,
          canonicalSessionTurnMissingEvents: canonicalTurnCoverage.missing
        },
        comparisons: {
          events,
          sessions,
          route: { exactMatch: routeExactMatch, local: routeSummary(localRoute), canonical: routeSummary(canonicalRoute) },
          profile: { exactMatch: profileExactMatch, local: profileSummary(localProfile), canonical: profileSummary(canonicalProfile) },
          localTurnCoverage,
          canonicalTurnCoverage,
          localEventSessionCoverage,
          canonicalEventSessionCoverage
        },
        issues: { blocking: structuralIssues },
        interpretation: {
          localOnlyEventsAndSessionsAreExpectedBeforeAICutover: true,
          divergenceDoesNotWriteOrRepairAnything: true,
          nextDecision: 'Use this report to size the AI Practice event/session migration gap before adding any Canonical AI write or read cutover.'
        }
      };

      const s = state.report.summary;
      const detail = [
        `Events · local ${s.localAIEvents} · Canonical ${s.canonicalAIEvents} · shared ${s.sharedAIEvents} · local-only ${s.localOnlyAIEvents} · Canonical-only ${s.canonicalOnlyAIEvents}`,
        `Sessions · local ${s.localAISessions} · Canonical ${s.canonicalAISessions} · shared ${s.sharedAISessions} · local-only ${s.localOnlyAISessions} · Canonical-only ${s.canonicalOnlyAISessions}`,
        `Route exact match: ${s.routeExactMatch ? 'yes' : 'no'} · Profile exact match: ${s.profileExactMatch ? 'yes' : 'no'}`,
        `Local session turn→event gaps: ${s.localSessionTurnMissingEvents} · Canonical session turn→event gaps: ${s.canonicalSessionTurnMissingEvents}`
      ].join('\n');
      setStatus(s.auditPass ? 'PASS · Read-only AI authority gap measured.' : 'CHECK · AI history structure needs inspection.', s.auditPass, detail);
      return clone(state.report);
    } catch (error) {
      state.report = {
        format: 'WLP_CANONICAL_AI_PRACTICE_HISTORY_READ_AUDIT', version: 1, appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(), mode: 'read-only-local-vs-canonical-ai-history-authority-audit',
        summary: { blockingIssues: 1, auditPass: false }, issues: { blocking: [error?.message || String(error)] }
      };
      setStatus(`CHECK · ${error?.message || String(error)}`, false, 'No AI Practice data was changed.');
      return clone(state.report);
    } finally {
      state.busy = false;
    }
  }

  window.WLPCanonicalAIHistoryReadAudit = Object.freeze({ version: 1, appVersion: APP_VERSION, flag: FLAG, runAudit, getReport: () => clone(state.report) });
  if (auditActive()) {
    const start = () => { makePanel(); setTimeout(() => { void runAudit(); }, 0); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
})();
