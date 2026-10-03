/* WLP v1.8.6.303 — AI Practice route/profile Canonical reconciliation audit.
   Diagnostic only. Compares current-device AI route/profile localStorage with the verified
   Canonical Storage Compatibility Facade and simulates only the already-approved safe merge
   rules: route-state semantic union (ignoring generated connection/exemplar IDs) and profile
   later-timestamp selection when semantic content is otherwise identical.
   It does not write localStorage, IndexedDB, sync_outbox, Cloud, or production AI state.
   Enable only with ?wlpAIStateAudit=1. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.303-ai-derived-state-reconciliation-audit-v1';
  const FLAG = 'wlpAIStateAudit';
  const AI_EVENT_KEY = 'wlp:ai-study-events:v1';
  const AI_ROUTE_KEY = 'wlp:ai-route-state:v1';
  const AI_PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const state = { busy:false, report:null, panel:null, status:null, detail:null, exportButton:null };

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const asArray = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function safeParse(raw, fallback) { try { const parsed=JSON.parse(raw); return parsed == null ? clone(fallback) : parsed; } catch (_) { return clone(fallback); } }
  function readArray(key) { return asArray(safeParse(localStorage.getItem(key) || '', [])); }
  function readObject(key) { return asObject(safeParse(localStorage.getItem(key) || '', {})); }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out={}; Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key]=stableValue(value[key]); }); return out;
    }
    return value;
  }
  const stableStringify = value => JSON.stringify(stableValue(value));
  async function sha256(text) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function parseTime(value) { const time=Date.parse(String(value || '')); return Number.isFinite(time) ? time : null; }
  function latestIso(values) { const times=values.map(parseTime).filter(value=>value !== null); return times.length ? new Date(Math.max(...times)).toISOString() : ''; }
  function eventId(item) { return clean(item?.eventId ?? item?.event_id ?? item?.id); }
  function eventWordId(item) { return clean(item?.wordId ?? item?.word_id); }
  function auditActive() { return new URLSearchParams(location.search).get(FLAG) === '1'; }

  function stripRouteVolatileIds(value) {
    if (Array.isArray(value)) return value.map(stripRouteVolatileIds);
    if (value && typeof value === 'object') {
      const out={};
      Object.keys(value).sort().forEach(key => {
        if (key === 'connectionId' || key === 'exemplarId') return;
        out[key]=stripRouteVolatileIds(value[key]);
      });
      return out;
    }
    return value;
  }

  function routeRecordComparison(localRoute, canonicalRoute) {
    const localRecords=asObject(localRoute.records), canonicalRecords=asObject(canonicalRoute.records);
    const localKeys=Object.keys(localRecords).sort(), canonicalKeys=Object.keys(canonicalRecords).sort();
    const localSet=new Set(localKeys), canonicalSet=new Set(canonicalKeys);
    const localOnly=localKeys.filter(key=>!canonicalSet.has(key));
    const canonicalOnly=canonicalKeys.filter(key=>!localSet.has(key));
    const shared=localKeys.filter(key=>canonicalSet.has(key));
    const semanticMismatches=[];
    const generatedIdOnlyDifferences=[];
    const exactMatches=[];
    const mergedRecords={};

    [...new Set([...localKeys,...canonicalKeys])].sort().forEach(key => {
      const local=localRecords[key], canonical=canonicalRecords[key];
      if (local === undefined) { mergedRecords[key]=clone(canonical); return; }
      if (canonical === undefined) { mergedRecords[key]=clone(local); return; }
      const exact=stableStringify(local) === stableStringify(canonical);
      const semantic=stableStringify(stripRouteVolatileIds(local)) === stableStringify(stripRouteVolatileIds(canonical));
      if (!semantic) { semanticMismatches.push(key); return; }
      if (exact) exactMatches.push(key); else generatedIdOnlyDifferences.push(key);
      const localTime=parseTime(local?.updatedAt) ?? parseTime(localRoute?.updatedAt) ?? 0;
      const canonicalTime=parseTime(canonical?.updatedAt) ?? parseTime(canonicalRoute?.updatedAt) ?? 0;
      mergedRecords[key]=clone(localTime > canonicalTime ? local : canonical);
    });

    const mergedUpdatedAt=latestIso([localRoute?.updatedAt,canonicalRoute?.updatedAt,...Object.values(mergedRecords).map(item=>item?.updatedAt)]);
    const merged={schemaVersion:Number(localRoute?.schemaVersion || canonicalRoute?.schemaVersion || 1),updatedAt:mergedUpdatedAt,records:mergedRecords};
    return {
      localRecordCount:localKeys.length, canonicalRecordCount:canonicalKeys.length, sharedRecordCount:shared.length,
      localOnlyRecordKeys:localOnly, canonicalOnlyRecordKeys:canonicalOnly,
      exactSharedRecordKeys:exactMatches, generatedIdOnlyDifferenceKeys:generatedIdOnlyDifferences,
      semanticMismatchKeys:semanticMismatches,
      semanticUnionSafe:semanticMismatches.length === 0,
      mergedRecordCount:Object.keys(mergedRecords).length, mergedUpdatedAt, merged
    };
  }

  function profileComparison(localProfile, canonicalProfile) {
    const localSemantic=clone(localProfile), canonicalSemantic=clone(canonicalProfile);
    delete localSemantic.updatedAt; delete canonicalSemantic.updatedAt;
    const semanticExact=stableStringify(localSemantic) === stableStringify(canonicalSemantic);
    const localTime=parseTime(localProfile?.updatedAt), canonicalTime=parseTime(canonicalProfile?.updatedAt);
    const selectedSource=semanticExact ? ((localTime ?? -Infinity) > (canonicalTime ?? -Infinity) ? 'local' : 'canonical') : null;
    const selected=selectedSource === 'local' ? clone(localProfile) : selectedSource === 'canonical' ? clone(canonicalProfile) : null;
    return {
      semanticExact,
      localUpdatedAt:clean(localProfile?.updatedAt) || null,
      canonicalUpdatedAt:clean(canonicalProfile?.updatedAt) || null,
      selectedSource,
      selectedUpdatedAt:selected ? clean(selected.updatedAt) || null : null,
      localCounts:{productionTendencies:asArray(localProfile?.productionTendencies).length,reusableConstructions:asArray(localProfile?.reusableConstructions).length,styleTendencies:asArray(localProfile?.styleTendencies).length},
      canonicalCounts:{productionTendencies:asArray(canonicalProfile?.productionTendencies).length,reusableConstructions:asArray(canonicalProfile?.reusableConstructions).length,styleTendencies:asArray(canonicalProfile?.styleTendencies).length},
      safeLaterTimestampSelection:semanticExact,
      selected
    };
  }

  function eventComparison(localEvents, canonicalEvents) {
    const localMap=new Map(localEvents.map(item=>[eventId(item),item]).filter(([id])=>id));
    const canonicalMap=new Map(canonicalEvents.map(item=>[eventId(item),item]).filter(([id])=>id));
    const localIds=[...localMap.keys()], canonicalIds=[...canonicalMap.keys()];
    return {
      localCount:localEvents.length, canonicalCount:canonicalEvents.length,
      localOnlyIds:localIds.filter(id=>!canonicalMap.has(id)), canonicalOnlyIds:canonicalIds.filter(id=>!localMap.has(id)),
      localOnlyWordIds:[...new Set(localIds.filter(id=>!canonicalMap.has(id)).map(id=>eventWordId(localMap.get(id))).filter(Boolean))],
      canonicalOnlyWordIds:[...new Set(canonicalIds.filter(id=>!localMap.has(id)).map(id=>eventWordId(canonicalMap.get(id))).filter(Boolean))]
    };
  }

  function makePanel() {
    if (state.panel || !auditActive()) return;
    const panel=document.createElement('section');
    panel.id='wlp-ai-state-audit'; panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100004;right:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">AI Practice · route/profile reconciliation audit</strong><div id="wlp-ai-state-audit-status" style="margin-top:4px">Waiting…</div><div id="wlp-ai-state-audit-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-ai-state-audit-run" type="button">Run audit</button><button id="wlp-ai-state-audit-export" type="button" disabled>Export JSON</button></div>';
    document.body.appendChild(panel); state.panel=panel; state.status=panel.querySelector('#wlp-ai-state-audit-status'); state.detail=panel.querySelector('#wlp-ai-state-audit-detail'); state.exportButton=panel.querySelector('#wlp-ai-state-audit-export');
    panel.querySelectorAll('button').forEach(button=>{button.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22';});
    panel.querySelector('#wlp-ai-state-audit-run').addEventListener('click',()=>{void runAudit();}); state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail='') { makePanel(); if(!state.status)return; state.status.textContent=text; state.status.style.fontWeight=ok==null?'500':'700'; state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22'; state.detail.textContent=detail; state.exportButton.disabled=!state.report; }
  function exportReport() { if(!state.report)return; const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=`wlp-ai-state-reconciliation-audit-${String(state.report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); }

  async function openFacade() {
    const provider=window.WLPCanonicalStorageCompatibilityFacade;
    if(!provider?.open || provider.readOnly !== true) throw new Error('Read-only Canonical Storage Compatibility Facade is unavailable.');
    const facade=await provider.open();
    if(!facade?.readOnly || typeof facade.readAIRouteState!=='function' || typeof facade.readAILearnerProfile!=='function' || typeof facade.readAIStudyEvents!=='function') throw new Error('Canonical AI route/profile readers are unavailable.');
    return facade;
  }

  async function runAudit() {
    if(!auditActive() || state.busy) return state.report;
    state.busy=true; setStatus('Comparing local and Canonical AI route/profile state…');
    try {
      const facade=await openFacade();
      const localRoute=readObject(AI_ROUTE_KEY), localProfile=readObject(AI_PROFILE_KEY), localEvents=readArray(AI_EVENT_KEY);
      const canonicalRoute=asObject(facade.readAIRouteState()), canonicalProfile=asObject(facade.readAILearnerProfile()), canonicalEvents=asArray(facade.readAIStudyEvents());
      const route=routeRecordComparison(localRoute,canonicalRoute), profile=profileComparison(localProfile,canonicalProfile), events=eventComparison(localEvents,canonicalEvents);
      const blocking=[];
      if(Number(facade.pendingOutboxRows||0)!==0) blocking.push(`Pending Canonical outbox is not empty (${Number(facade.pendingOutboxRows||0)} row(s)).`);
      if(!route.semanticUnionSafe) blocking.push(`Route state has ${route.semanticMismatchKeys.length} shared record(s) with semantic divergence.`);
      if(!profile.safeLaterTimestampSelection) blocking.push('Learner profile differs semantically; timestamp-only selection is not safe.');
      if(!Object.keys(localRoute).length || !Object.keys(canonicalRoute).length) blocking.push('Local or Canonical route state is missing.');
      if(!Object.keys(localProfile).length || !Object.keys(canonicalProfile).length) blocking.push('Local or Canonical learner profile is missing.');
      const mergedRouteHash=route.semanticUnionSafe ? await sha256(stableStringify(route.merged)) : null;
      const selectedProfileHash=profile.selected ? await sha256(stableStringify(profile.selected)) : null;
      state.report={
        format:'WLP_CANONICAL_AI_DERIVED_STATE_RECONCILIATION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-route-profile-semantic-reconciliation-audit',
        authority:{source:clean(facade.source),candidateKey:clean(facade.meta?.candidateKey),headVersion:Number(facade.meta?.headVersion||0),snapshotManifestHash:clean(facade.meta?.snapshotManifestHash),pendingOutboxRows:Number(facade.pendingOutboxRows||0),readerCursor:Number(facade.meta?.lastSyncCursor||0)},
        summary:{blockingIssues:blocking.length,auditPass:blocking.length===0,nextPhaseEligible:blocking.length===0,localRouteRecords:route.localRecordCount,canonicalRouteRecords:route.canonicalRecordCount,mergedRouteRecords:route.mergedRecordCount,localOnlyRouteRecords:route.localOnlyRecordKeys.length,canonicalOnlyRouteRecords:route.canonicalOnlyRecordKeys.length,sharedRouteSemanticMismatches:route.semanticMismatchKeys.length,profileSemanticExact:profile.semanticExact,profileSelectedSource:profile.selectedSource,localAIEvents:events.localCount,canonicalAIEvents:events.canonicalCount,localOnlyAIEvents:events.localOnlyIds.length,canonicalOnlyAIEvents:events.canonicalOnlyIds.length},
        route:{localUpdatedAt:clean(localRoute.updatedAt)||null,canonicalUpdatedAt:clean(canonicalRoute.updatedAt)||null,localOnlyRecordKeys:route.localOnlyRecordKeys,canonicalOnlyRecordKeys:route.canonicalOnlyRecordKeys,generatedIdOnlyDifferenceKeys:route.generatedIdOnlyDifferenceKeys,semanticMismatchKeys:route.semanticMismatchKeys,semanticUnionSafe:route.semanticUnionSafe,mergedRecordCount:route.mergedRecordCount,mergedUpdatedAt:route.mergedUpdatedAt,mergedPayloadHash:mergedRouteHash},
        profile:{semanticExact:profile.semanticExact,localUpdatedAt:profile.localUpdatedAt,canonicalUpdatedAt:profile.canonicalUpdatedAt,selectedSource:profile.selectedSource,selectedUpdatedAt:profile.selectedUpdatedAt,localCounts:profile.localCounts,canonicalCounts:profile.canonicalCounts,safeLaterTimestampSelection:profile.safeLaterTimestampSelection,selectedPayloadHash:selectedProfileHash},
        events,
        issues:{blocking},
        invariants:{readOnly:true,noLocalStorageWrites:true,noIndexedDBWrites:true,noCloudWrites:true,noOutboxWrites:true,noWholeAccountLastWriteWins:true,routeMergeRule:'semantic-union-ignore-generated-connection-and-exemplar-ids',profileMergeRule:'later-timestamp-only-when-semantic-content-identical'},
        interpretation:{routeAndProfileRemainLegacyWriteAuthority:true,canonicalRouteAndProfileRemainReadOnlyComparisonTargets:true,nextDecision:blocking.length?'Do not stage route/profile writes; inspect semantic divergence first.':'Use this evidence to design a guarded Canonical route/profile transport canary; do not replace either singleton wholesale without base-hash conflict protection.'}
      };
      const ok=blocking.length===0;
      setStatus(ok?'PASS · Route/profile reconciliation is safe to stage next.':'CHECK · Route/profile reconciliation needs inspection.',ok,`route ${route.localRecordCount} local / ${route.canonicalRecordCount} Canonical → union ${route.mergedRecordCount}\nroute semantic mismatches ${route.semanticMismatchKeys.length} · profile semantic exact ${profile.semanticExact?'yes':'no'}\nevents ${events.localCount} local / ${events.canonicalCount} Canonical · outbox ${Number(facade.pendingOutboxRows||0)}`);
      return state.report;
    } catch(error) {
      state.report={format:'WLP_CANONICAL_AI_DERIVED_STATE_RECONCILIATION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-route-profile-semantic-reconciliation-audit',summary:{blockingIssues:1,auditPass:false,nextPhaseEligible:false},issues:{blocking:[String(error?.message||error)]}};
      setStatus('BLOCKED · AI route/profile audit failed.',false,String(error?.message||error)); return state.report;
    } finally { state.busy=false; if(state.exportButton)state.exportButton.disabled=!state.report; }
  }

  function init() { if(!auditActive())return; makePanel(); setTimeout(()=>{void runAudit();},120); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
  window.WLPCanonicalAIDerivedStateAudit=Object.freeze({version:1,active:auditActive,run:runAudit,getReport:()=>clone(state.report)});
})();
