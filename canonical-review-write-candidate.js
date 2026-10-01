/* WLP v1.8.6.226 — Review Canonical Read + Local Write Candidate Round-trip v1.
   Query-gated by ?wlpCanonicalReviewWrite=1. Normal Review remains legacy.
   The candidate opens the real read-only Canonical Storage Facade, renders Review
   from Authority-v2 + pending outbox overlay, and exposes one controlled local write
   round-trip for WID 2876 (High -> Medium). The pair is transport-ineligible and is
   removed before PASS. No Cloud, localStorage, or Canonical base row is written. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.226-review-canonical-write-candidate-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror';
  const PROGRESS_PREFIX='fc:wordid:';
  const STUDYQ_EVENT_KEY='wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY='wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY='wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY='wlp:stage7:interaction-events:v1';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const TARGET_WORD_ID='2876';
  const TARGET_CARD_ID='ea2f787b-41fe-5446-bbff-49c0c6ed73e2';
  const EXPECTED={candidateKey:'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283',headVersion:2,migrationVersion:'3',manifestHash:'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3',canonicalRows:21424,firstSeenMs:1790459055400,firstSeenIso:'2026-09-26T21:44:15.400Z'};
  const requested=new URLSearchParams(location.search).get('wlpCanonicalReviewWrite')==='1';
  const state={active:false,busy:false,facade:null,report:null,prepareError:'',baseInteractionCount:0,readCounts:{review:0,progress:0,standard:0,standardSessions:0,ai:0,interaction:0}};

  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  function stableStringify(v){return JSON.stringify(stableValue(v));}
  function utf8Bytes(v){return new TextEncoder().encode(String(v??''));}
  async function sha256(v){const out=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8Bytes(v)));return [...out].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(ns,name){const a=uuidToBytes(ns),b=utf8Bytes(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  function requestPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.'));});}
  function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});}
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Review candidate blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Review candidate blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Review candidate IndexedDB open is blocked by another page.'));});}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(META_KEY));await transactionDone(tx);return row||null;}
  async function getStateRow(db){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(TARGET_CARD_ID));await transactionDone(tx);return row||null;}
  async function countOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),n=await requestPromise(tx.objectStore(OUTBOX_STORE).count());await transactionDone(tx);return Number(n||0);}
  function plusTwoSecondsIso(base){const values=[base?.updated_at,base?.last_attention_updated_at,base?.last_seen_at,base?.last_reviewed_at].map(v=>Date.parse(String(v||''))).filter(Number.isFinite);const t=values.length?Math.max(...values):Date.parse(EXPECTED.firstSeenIso);return new Date(t+2000).toISOString();}

  function makePanel(){
    if(!requested||document.getElementById('wlp-review-write-candidate-box'))return;
    const box=document.createElement('section');box.id='wlp-review-write-candidate-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(360px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Review write candidate</strong><div id="wlp-review-write-candidate-status" style="margin-top:4px">Preparing Canonical Review…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-review-write-candidate-run" type="button" disabled>Run High → Medium round-trip</button><button id="wlp-review-write-candidate-export" type="button" disabled>Export JSON</button><a href="./review.html" style="align-self:center">Return to legacy Review</a></div><div id="wlp-review-write-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-review-write-candidate-run')?.addEventListener('click',runRoundtrip);
    document.getElementById('wlp-review-write-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){
    const el=document.getElementById('wlp-review-write-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}
    const d=document.getElementById('wlp-review-write-candidate-detail');if(d)d.textContent=detail;
  }
  function setButtons(){const run=document.getElementById('wlp-review-write-candidate-run'),exp=document.getElementById('wlp-review-write-candidate-export');if(run)run.disabled=!state.active||state.busy;if(exp)exp.disabled=state.busy||!state.report;}
  function dispatchRefresh(){window.dispatchEvent(new CustomEvent('wlp-canonical-review-candidate-refresh'));}
  function nextFrames(n=2){return new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}
  function findLevelText(wordId){for(const card of document.querySelectorAll('.review-card')){const meta=card.querySelector('.review-card-meta')?.textContent||'';if(meta.includes(`WID${wordId}`))return (card.querySelector('.review-level-tag')?.textContent||'').trim();}return'';}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;
    makePanel();
    try{
      const provider=window.WLPCanonicalStorageCompatibilityFacade;if(!provider?.open)throw new Error('Storage Compatibility Facade v225 is unavailable.');
      const facade=await provider.open();
      const meta=facade.meta||{};
      if(String(meta.candidateKey||'')!==EXPECTED.candidateKey||Number(meta.headVersion||0)!==EXPECTED.headVersion||String(meta.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta.canonicalRowCount||0)!==EXPECTED.canonicalRows)throw new Error('Review candidate requires the exact ACTIVE Authority-v2 mirror.');
      if(Number(facade.pendingOutboxRows||0)!==0)throw new Error(`Review candidate requires an empty sync_outbox; found ${facade.pendingOutboxRows} pending row(s).`);
      const target=facade.readProgressRecord(TARGET_WORD_ID);if(String(target.reviewLevel||'')!=='high'||Number(target.firstSeen||0)!==EXPECTED.firstSeenMs)throw new Error('WID 2876 base state is not the verified High-attention Authority-v2 state.');
      state.facade=facade;state.baseInteractionCount=facade.readInteractionEvents().length;state.active=true;state.prepareError='';setStatus('READY · Review is reading Canonical v2.','',`25 Canonical Review rows · outbox 0 · legacy attention writes locked`);setButtons();return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'Review falls back to its legacy read path; no write occurred.');setButtons();return false;}
  }

  function readReviewRecords(){state.readCounts.review++;return state.facade?state.facade.readReviewRecords():[];}
  function readProgressRecord(wordId){state.readCounts.progress++;return state.facade?state.facade.readProgressRecord(wordId):{};}
  function readAIEvents(){state.readCounts.ai++;return state.facade?state.facade.readAIStudyEvents():[];}
  function readInteractionEvents(){state.readCounts.interaction++;return state.facade?state.facade.readInteractionEvents():[];}
  function readArray(key){
    if(!state.facade)return null;
    if(key===STUDYQ_EVENT_KEY){state.readCounts.standard++;return state.facade.readStudyQEvents();}
    if(key===STUDYQ_SESSION_KEY){state.readCounts.standardSessions++;return state.facade.readStudyQSessions();}
    if(key===AI_STUDY_EVENT_KEY){state.readCounts.ai++;return state.facade.readAIStudyEvents();}
    if(key===INTERACTION_EVENTS_KEY){state.readCounts.interaction++;return state.facade.readInteractionEvents();}
    if(String(key||'').startsWith(PROGRESS_PREFIX)){state.readCounts.progress++;return state.facade.readProgressRecord(String(key).slice(PROGRESS_PREFIX.length));}
    return null;
  }

  async function buildPlan(meta,stateRow){
    const base=clone(stateRow.payload||{}),fromLevel=String(base.review_level||'').toLowerCase();if(fromLevel!=='high')throw new Error(`WID 2876 expected High, got ${fromLevel||'(empty)'}.`);
    const toLevel='medium',at=plusTwoSecondsIso(base),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));if(basePayloadHash!==String(stateRow.payloadHash||''))throw new Error('WID 2876 base payload hash mismatch.');
    const intent={candidate:true,kind:'review-live-write-roundtrip',cardId:TARGET_CARD_ID,wordId:TARGET_WORD_ID,fromLevel,toLevel,at,basePayloadHash,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:String(meta.candidateKey||'')};
    const actionId=`review-candidate-action:${await sha256(stableStringify(intent))}`,stateMutationId=`review-candidate-mut:${await sha256(`state|${actionId}`)}`,eventMutationId=`review-candidate-mut:${await sha256(`event|${actionId}`)}`,eventId=await uuidV5(CARD_NAMESPACE_UUID,`review-candidate-event|interaction|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:true,candidateOnly:true,transportEligible:false,status:'candidate-pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:TARGET_CARD_ID,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:TARGET_CARD_ID,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(TARGET_WORD_ID),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId:TARGET_WORD_ID,source:'review-canonical-write-candidate',level:toLevel,reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],fromLevel,suggested:true,suggestionPolicyVersion:'1.0.0',evidenceThrough:0,candidateOnly:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,stateMutation,eventMutation,fromLevel,toLevel,at};
  }
  async function enqueuePair(db,plan){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);const [a,b]=await Promise.all([requestPromise(store.get(plan.stateMutation.mutationId)),requestPromise(store.get(plan.eventMutation.mutationId))]);let wrote=0;if(a||b){if(!a||!b)throw new Error('Candidate outbox pair is partially present.');if(stableStringify(a)!==stableStringify(plan.stateMutation)||stableStringify(b)!==stableStringify(plan.eventMutation))throw new Error('Candidate mutation ID collision.');}else{store.add(clone(plan.stateMutation));store.add(clone(plan.eventMutation));wrote=2;}await transactionDone(tx);return{wrote,idempotent:wrote===0};}
  async function cleanupPair(db,plan){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);store.delete(plan.stateMutation.mutationId);store.delete(plan.eventMutation.mutationId);await transactionDone(tx);}

  async function runRoundtrip(){
    if(!state.active||state.busy)return;state.busy=true;setButtons();setStatus('Running controlled Review write → overlay → DOM → rollback round-trip…');let db=null,plan=null,cleanupNeeded=false;
    try{
      db=await openDb();const meta=await getMeta(db),before=await countOutbox(db),stateRow=await getStateRow(db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);if(!stateRow)throw new Error('WID 2876 learning_state row missing.');
      const baseWrapper=clone(stateRow),baseFacade=await window.WLPCanonicalStorageCompatibilityFacade.open(),baseRecord=baseFacade.readProgressRecord(TARGET_WORD_ID),baseInteractions=baseFacade.readInteractionEvents().length;
      plan=await buildPlan(meta,stateRow);const write=await enqueuePair(db,plan);cleanupNeeded=true;const during=await countOutbox(db);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();await nextFrames();
      const overlayFacade=state.facade,overlayRecord=overlayFacade.readProgressRecord(TARGET_WORD_ID),overlayInteractions=overlayFacade.readInteractionEvents(),overlayReviewRows=overlayFacade.readReviewRecords().length,domOverlay=findLevelText(TARGET_WORD_ID),eventFound=overlayInteractions.some(e=>String(e?.source||'')==='review-canonical-write-candidate'&&String(e?.wordId||'')===TARGET_WORD_ID&&String(e?.level||'')==='medium');
      const baseDuring=await getStateRow(db),baseUntouched=stableStringify(baseDuring)===stableStringify(baseWrapper),overlayOk=Boolean(during===2&&overlayFacade.pendingOutboxRows===2&&overlayFacade.overlayMutationsApplied===2&&overlayRecord.reviewLevel==='medium'&&Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs&&overlayInteractions.length===baseInteractions+1&&eventFound&&domOverlay==='Medium');
      await cleanupPair(db,plan);cleanupNeeded=false;const after=await countOutbox(db);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();await nextFrames();const restored=state.facade.readProgressRecord(TARGET_WORD_ID),domRestored=findLevelText(TARGET_WORD_ID),baseAfter=await getStateRow(db),cleanupOk=Boolean(after===0&&state.facade.pendingOutboxRows===0&&restored.reviewLevel==='high'&&Number(restored.firstSeen)===EXPECTED.firstSeenMs&&domRestored==='High'&&stableStringify(baseAfter)===stableStringify(baseWrapper));
      const blocking=[];if(write.wrote!==2)blocking.push('Controlled candidate pair was not written as exactly two outbox rows.');if(!overlayOk)blocking.push('Review page did not render the Canonical pending overlay exactly.');if(!baseUntouched)blocking.push('Canonical learning_state base changed during the candidate write.');if(!cleanupOk)blocking.push('Candidate rollback did not restore High attention and empty outbox.');
      state.report={format:'WLP_CANONICAL_REVIEW_WRITE_CANDIDATE_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-review-canonical-read-local-outbox-write-roundtrip',device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion||null,migrationVersion:meta?.migrationVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,canonicalRows:meta?.canonicalRowCount||null},summary:{requested:true,canonicalReviewReadActive:true,legacyAttentionWritesLocked:true,outboxRowsBefore:before,rowsWritten:write.wrote,outboxRowsDuring:during,overlayMutationsApplied:overlayFacade.overlayMutationsApplied,domOverlayAttention:domOverlay,cleanupVerified:cleanupOk,outboxRowsAfter:after,domRestoredAttention:domRestored,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,wordId:TARGET_WORD_ID,cardId:TARGET_CARD_ID,fromLevel:plan.fromLevel,toLevel:plan.toLevel,stateMutationId:plan.stateMutation.mutationId,eventMutationId:plan.eventMutation.mutationId,candidateOnly:true,transportEligible:false},reads:{sourceDuring:overlayFacade.source,sourceAfter:state.facade.source,readCounts:clone(state.readCounts),baseReviewRows:baseFacade.readReviewRecords().length,overlayReviewRows,interactionDelta:overlayInteractions.length-baseInteractions,eventFound},checks:[['Review candidate starts on exact Authority-v2 base',String(meta?.candidateKey||'')===EXPECTED.candidateKey&&before===0,`${meta?.candidateKey||'—'} · outbox ${before}`],['Controlled local user write persisted as one atomic pair',write.wrote===2&&during===2,`${write.wrote} write(s) · ${during} row(s)`],['Real Review read path overlays High → Medium',overlayRecord.reviewLevel==='medium'&&domOverlay==='Medium',`Facade ${overlayRecord.reviewLevel} · DOM ${domOverlay||'missing'}`],['Interaction event is visible through the Review facade',overlayInteractions.length===baseInteractions+1&&eventFound,`Δ ${overlayInteractions.length-baseInteractions} · found=${eventFound}`],['Explicit firstSeen is preserved',Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs,String(overlayRecord.firstSeen)],['Canonical base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Rollback restores High + empty outbox',cleanupOk,`DOM ${domRestored||'missing'} · outbox ${after}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking,warnings:['This is a query-gated controlled Review-page write candidate. The two rows are candidate-only, transport-ineligible, and removed before PASS.','Normal /review remains on legacy reads and legacy writes in v226.','Existing Apply/Keep suggestion controls are intentionally locked while the candidate route is active so they cannot write legacy localStorage beside the Canonical candidate.','Cloud mutation transport, acknowledgement, and conflict resolution are still disabled.']},invariants:{normalReviewRouteRemainsLegacy:true,candidateUsesCanonicalFacadeReads:true,legacyAttentionWritesLocked:true,indexedDbWritesRestrictedToSyncOutbox:true,candidateRowsTransportIneligible:true,cleanupComplete:cleanupOk,noCloudWrites:true,noLocalStorageWritesByCandidate:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs}};
      setStatus(state.report.summary.pass?'PASS · Review Canonical read + local outbox write + DOM overlay + rollback all matched.':`CHECK · ${blocking.join(' ')}`,state.report.summary.pass,`High → Medium → High · outbox 0 → 2 → 0`);
    }catch(error){const message=error?.message||String(error);try{if(db&&plan&&cleanupNeeded)await cleanupPair(db,plan);}catch(cleanupError){console.error('Candidate cleanup failed',cleanupError);}state.report={format:'WLP_CANONICAL_REVIEW_WRITE_CANDIDATE_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-review-canonical-read-local-outbox-write-roundtrip',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},summary:{requested:true,canonicalReviewReadActive:state.active,legacyAttentionWritesLocked:true,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort candidate outbox cleanup was attempted after failure.']},invariants:{normalReviewRouteRemainsLegacy:true,noCloudWrites:true,noLocalStorageWritesByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'No Cloud write occurred.');console.error(error);
    }finally{if(db)db.close();state.busy=false;setButtons();}
  }
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-review-write-candidate-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  const api={version:1,requested,isActive:()=>state.active,prepare,readReviewRecords,readProgressRecord,readArray,readAIEvents,readInteractionEvents,getReport:()=>clone(state.report)};
  window.WLPCanonicalReviewWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
