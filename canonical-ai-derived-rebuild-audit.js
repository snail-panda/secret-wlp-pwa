/* WLP v1.8.6.304 — Canonical AI-event derived-state reconstruction audit.
   Diagnostic only. Rebuilds AI route/profile in memory from Canonical AI events by calling
   the same pure derivation path used by normal AI Study, then compares that reconstruction
   with the already-audited safe local+Canonical route union and selected profile semantics.
   It does not write localStorage, IndexedDB, sync_outbox, Cloud, or production AI state.
   Enable only with ?wlpAIDerivedRebuildAudit=1. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.304-ai-derived-state-rebuild-audit-v1';
  const FLAG = 'wlpAIDerivedRebuildAudit';
  const AI_ROUTE_KEY = 'wlp:ai-route-state:v1';
  const AI_PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const state = { busy:false, report:null, panel:null, status:null, detail:null, exportButton:null };

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const asArray = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function safeParse(raw, fallback) { try { const parsed=JSON.parse(raw); return parsed == null ? clone(fallback) : parsed; } catch (_) { return clone(fallback); } }
  function readObject(key) { return asObject(safeParse(localStorage.getItem(key) || '', {})); }
  function stableValue(value) { if(Array.isArray(value)) return value.map(stableValue); if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;} return value; }
  const stableStringify = value => JSON.stringify(stableValue(value));
  async function sha256(text) { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text))); return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''); }
  function parseTime(value) { const time=Date.parse(String(value || '')); return Number.isFinite(time) ? time : null; }
  function latestIso(values) { const times=values.map(parseTime).filter(value=>value!==null); return times.length ? new Date(Math.max(...times)).toISOString() : ''; }
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

  function routeUnion(localRoute, canonicalRoute) {
    const localRecords=asObject(localRoute.records), canonicalRecords=asObject(canonicalRoute.records);
    const keys=[...new Set([...Object.keys(localRecords),...Object.keys(canonicalRecords)])].sort();
    const mismatches=[]; const merged={};
    keys.forEach(key => {
      const local=localRecords[key], canonical=canonicalRecords[key];
      if(local===undefined){merged[key]=clone(canonical);return;}
      if(canonical===undefined){merged[key]=clone(local);return;}
      if(stableStringify(stripRouteVolatileIds(local))!==stableStringify(stripRouteVolatileIds(canonical))){mismatches.push(key);return;}
      const lt=parseTime(local?.updatedAt) ?? parseTime(localRoute?.updatedAt) ?? 0;
      const ct=parseTime(canonical?.updatedAt) ?? parseTime(canonicalRoute?.updatedAt) ?? 0;
      merged[key]=clone(lt>ct?local:canonical);
    });
    return { keys, mismatches, records:merged, updatedAt:latestIso([localRoute?.updatedAt,canonicalRoute?.updatedAt,...Object.values(merged).map(item=>item?.updatedAt)]) };
  }

  function selectedProfile(localProfile, canonicalProfile) {
    const l=clone(localProfile), c=clone(canonicalProfile); delete l.updatedAt; delete c.updatedAt;
    const semanticExact=stableStringify(l)===stableStringify(c);
    if(!semanticExact)return{semanticExact:false,selected:null,source:null};
    const lt=parseTime(localProfile?.updatedAt) ?? -Infinity, ct=parseTime(canonicalProfile?.updatedAt) ?? -Infinity;
    return{semanticExact:true,selected:clone(lt>ct?localProfile:canonicalProfile),source:lt>ct?'local':'canonical'};
  }

  function compareDerivedRoute(derivedRoute, expectedUnion) {
    const derived=asObject(derivedRoute.records), expected=asObject(expectedUnion.records);
    const derivedKeys=Object.keys(derived).sort(), expectedKeys=Object.keys(expected).sort();
    const missing=expectedKeys.filter(key=>!(key in derived));
    const unexpected=derivedKeys.filter(key=>!(key in expected));
    const semanticMismatches=expectedKeys.filter(key => key in derived && stableStringify(stripRouteVolatileIds(derived[key]))!==stableStringify(stripRouteVolatileIds(expected[key])));
    return { derivedKeys, expectedKeys, missing, unexpected, semanticMismatches, exactKeyCoverage:missing.length===0&&unexpected.length===0, semanticExact:missing.length===0&&unexpected.length===0&&semanticMismatches.length===0 };
  }

  function profileSemantic(value) { const out=clone(asObject(value)); delete out.updatedAt; return out; }

  function makePanel() {
    if(state.panel||!auditActive())return;
    const panel=document.createElement('section'); panel.id='wlp-ai-derived-rebuild-audit'; panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100005;right:8px;top:max(8px,env(safe-area-inset-top));width:min(450px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">AI Practice · Canonical-event derived-state rebuild audit</strong><div id="wlp-ai-derived-rebuild-status" style="margin-top:4px">Waiting…</div><div id="wlp-ai-derived-rebuild-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-ai-derived-rebuild-run" type="button">Run audit</button><button id="wlp-ai-derived-rebuild-export" type="button" disabled>Export JSON</button></div>';
    document.body.appendChild(panel); state.panel=panel; state.status=panel.querySelector('#wlp-ai-derived-rebuild-status'); state.detail=panel.querySelector('#wlp-ai-derived-rebuild-detail'); state.exportButton=panel.querySelector('#wlp-ai-derived-rebuild-export');
    panel.querySelectorAll('button').forEach(button=>{button.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22';});
    panel.querySelector('#wlp-ai-derived-rebuild-run').addEventListener('click',()=>{void runAudit();}); state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-ai-derived-rebuild-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}

  async function runAudit() {
    if(state.busy)return; state.busy=true; makePanel(); setStatus('Running read-only Canonical-event reconstruction…',null,'No WLP or Cloud data will be changed.');
    try {
      const provider=window.WLPCanonicalStorageCompatibilityFacade, data=window.WLPAIStudyData;
      if(!provider?.open||provider.readOnly!==true)throw new Error('Read-only Canonical Storage Compatibility Facade is unavailable.');
      if(!data||typeof data.deriveDerivedState!=='function')throw new Error('AI Study pure derived-state builder is unavailable.');
      const facade=await provider.open();
      if(!facade?.readOnly||typeof facade.readAIStudyEvents!=='function'||typeof facade.readAIRouteState!=='function'||typeof facade.readAILearnerProfile!=='function')throw new Error('Canonical AI readers are unavailable.');
      const localRoute=readObject(AI_ROUTE_KEY), localProfile=readObject(AI_PROFILE_KEY);
      const canonicalEvents=asArray(facade.readAIStudyEvents()), canonicalRoute=asObject(facade.readAIRouteState()), canonicalProfile=asObject(facade.readAILearnerProfile());
      const union=routeUnion(localRoute,canonicalRoute), selected=selectedProfile(localProfile,canonicalProfile);
      const generatedAt=latestIso(canonicalEvents.flatMap(event=>[event?.updatedAt,event?.createdAt,event?.timestamp]));
      const derived=data.deriveDerivedState(canonicalEvents,{generatedAt:generatedAt||new Date(0).toISOString()});
      const routeCompare=compareDerivedRoute(derived.routeState,union);
      const profileDerivedSemantic=profileSemantic(derived.learnerProfile), profileExpectedSemantic=profileSemantic(selected.selected||{});
      const profileSemanticExact=selected.semanticExact&&stableStringify(profileDerivedSemantic)===stableStringify(profileExpectedSemantic);
      const blocking=[];
      if(union.mismatches.length)blocking.push(`Existing route union has semantic mismatch(es): ${union.mismatches.join(', ')}`);
      if(!selected.semanticExact)blocking.push('Existing learner profile differs semantically between local and Canonical state.');
      if(!routeCompare.exactKeyCoverage)blocking.push(`Canonical-event route key coverage differs: missing ${routeCompare.missing.join(', ')||'none'}; unexpected ${routeCompare.unexpected.join(', ')||'none'}.`);
      if(routeCompare.semanticMismatches.length)blocking.push(`Canonical-event route reconstruction differs semantically for: ${routeCompare.semanticMismatches.join(', ')}.`);
      if(!profileSemanticExact)blocking.push('Canonical-event learner profile reconstruction differs semantically from the selected safe profile state.');
      const meta=facade.meta||{};
      state.report={format:'WLP_CANONICAL_AI_DERIVED_STATE_REBUILD_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-rebuild-route-profile-from-canonical-ai-events',authority:{source:facade.source||'wlp-cloud-v1',candidateKey:meta.candidateKey||null,headVersion:Number(meta.headVersion||0)||null,snapshotManifestHash:meta.snapshotManifestHash||null,pendingOutboxRows:Number(facade.pendingOverlay?.pendingRows||0),readerCursor:Number(meta.lastSyncCursor||meta.materializedSyncCursor||0)},summary:{blockingIssues:blocking.length,auditPass:blocking.length===0,nextPhaseEligible:blocking.length===0,canonicalAIEvents:canonicalEvents.length,expectedUnionRouteRecords:union.keys.length,derivedRouteRecords:Object.keys(asObject(derived.routeState?.records)).length,routeKeyCoverageExact:routeCompare.exactKeyCoverage,routeSemanticMismatches:routeCompare.semanticMismatches.length,profileSemanticExact,profileSelectedSource:selected.source,canonicalEventsCanRebuildDerivedState:blocking.length===0},route:{expectedUnionKeys:union.keys,derivedKeys:routeCompare.derivedKeys,missingKeys:routeCompare.missing,unexpectedKeys:routeCompare.unexpected,semanticMismatchKeys:routeCompare.semanticMismatches,existingUnionMismatchKeys:union.mismatches,derivedPayloadHash:await sha256(stableStringify(stripRouteVolatileIds(derived.routeState))),expectedUnionPayloadHash:await sha256(stableStringify(stripRouteVolatileIds({schemaVersion:Number(localRoute?.schemaVersion||canonicalRoute?.schemaVersion||1),updatedAt:derived.routeState?.updatedAt||'',records:union.records})))},profile:{existingLocalCanonicalSemanticExact:selected.semanticExact,selectedSource:selected.source,derivedSemanticExact:profileSemanticExact,derivedSemanticHash:await sha256(stableStringify(profileDerivedSemantic)),expectedSemanticHash:await sha256(stableStringify(profileExpectedSemantic)),derivedCounts:{productionTendencies:asArray(derived.learnerProfile?.productionTendencies).length,reusableConstructions:asArray(derived.learnerProfile?.reusableConstructions).length,styleTendencies:asArray(derived.learnerProfile?.styleTendencies).length}},issues:{blocking},invariants:{readOnly:true,noLocalStorageWrites:true,noIndexedDBWrites:true,noCloudWrites:true,noOutboxWrites:true,usesProductionAIDerivationLogic:true,canonicalEventsRemainAppendOnlyAuthority:true,noSingletonLastWriteWins:true},interpretation:{nextDecision:blocking.length===0?'Canonical AI events can serve as the durable authority for derived route/profile state; prefer event-derived reconstruction over introducing independent mutable singleton transport.':'Do not cut over route/profile reads or writes until the reconstruction mismatch is understood.'}};
      const pass=state.report.summary.auditPass;
      setStatus(pass?'PASS · Canonical AI events reconstruct route/profile safely.':'CHECK · Canonical-event reconstruction differs from current derived state.',pass,`events ${canonicalEvents.length} → route ${state.report.summary.derivedRouteRecords}/${state.report.summary.expectedUnionRouteRecords}\nroute semantic mismatches ${state.report.summary.routeSemanticMismatches} · profile semantic exact ${profileSemanticExact?'yes':'no'}\noutbox ${state.report.authority.pendingOutboxRows}`);
      state.exportButton.disabled=false;
    } catch(error) {
      const message=error?.message||String(error); state.report={format:'WLP_CANONICAL_AI_DERIVED_STATE_REBUILD_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,auditPass:false,nextPhaseEligible:false},issues:{blocking:[message]},invariants:{readOnly:true,noLocalStorageWrites:true,noIndexedDBWrites:true,noCloudWrites:true,noOutboxWrites:true}}; setStatus(`CHECK · ${message}`,false,'No data was changed.'); state.exportButton.disabled=false;
    } finally { state.busy=false; }
  }

  window.WLPCanonicalAIDerivedRebuildAudit=Object.freeze({version:1,appVersion:APP_VERSION,run:runAudit,getReport:()=>clone(state.report)});
  if(auditActive()){makePanel();setTimeout(()=>{void runAudit();},0);}
})();
