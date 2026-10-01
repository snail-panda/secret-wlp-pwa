/* WLP v1.8.6.238 — Review v3 entry path for iPhone reverse-sync source test.
   Query-gated by ?wlpCanonicalReviewWrite=1. Normal Review remains legacy.
   On the candidate route, existing Review Apply/Keep suggestion controls are rerouted
   away from legacy localStorage into transport-ineligible sync_outbox mutations.
   Each clicked action is verified through the real Canonical facade + Review DOM and
   then automatically cleaned up. No Cloud, localStorage, or Canonical base row is written. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.238-review-v3-entry-for-reverse-sync-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror';
  const PROGRESS_PREFIX='fc:wordid:';
  const STUDYQ_EVENT_KEY='wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY='wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY='wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY='wlp:stage7:interaction-events:v1';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const ANCHOR_WORD_ID='2876';
  const EXPECTED={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425,anchorFirstSeenMs:1790459055400};
  const requested=new URLSearchParams(location.search).get('wlpCanonicalReviewWrite')==='1';
  const state={active:false,busy:false,facade:null,report:null,prepareError:'',readCounts:{review:0,progress:0,standard:0,standardSessions:0,ai:0,interaction:0}};

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
  async function getStateRow(db,cardId){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function countOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),n=await requestPromise(tx.objectStore(OUTBOX_STORE).count());await transactionDone(tx);return Number(n||0);}
  async function cardIdForWordId(wordId){return uuidV5(CARD_NAMESPACE_UUID,`card|wid:${String(wordId||'').trim()}`);}

  function makePanel(){
    if(!requested||document.getElementById('wlp-review-write-candidate-box'))return;
    const box=document.createElement('section');box.id='wlp-review-write-candidate-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(360px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Review live-control candidate</strong><div id="wlp-review-write-candidate-status" style="margin-top:4px">Preparing Canonical Review…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-review-write-candidate-export" type="button" disabled>Export JSON</button><a href="./review.html" style="align-self:center">Return to legacy Review</a></div><div id="wlp-review-write-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-review-write-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){
    const el=document.getElementById('wlp-review-write-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}
    const d=document.getElementById('wlp-review-write-candidate-detail');if(d)d.textContent=detail;
  }
  function setButtons(){const exp=document.getElementById('wlp-review-write-candidate-export');if(exp)exp.disabled=state.busy||!state.report;}
  function dispatchRefresh(){window.dispatchEvent(new CustomEvent('wlp-canonical-review-candidate-refresh'));}
  function nextFrames(n=2){return new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}
  function findLevelText(wordId){for(const card of document.querySelectorAll('.review-card')){const meta=card.querySelector('.review-card-meta')?.textContent||'';if(meta.includes(`WID${wordId}`))return (card.querySelector('.review-level-tag')?.textContent||'').trim();}return'';}
  function cap(value){const s=String(value||'');return s?s[0].toUpperCase()+s.slice(1):'';}

  async function waitForStorageFacade(){
    const current=window.WLPCanonicalStorageCompatibilityFacade;if(current?.open)return current;
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    for(let i=0;i<4;i++){const provider=window.WLPCanonicalStorageCompatibilityFacade;if(provider?.open)return provider;await new Promise(resolve=>setTimeout(resolve,0));}
    return null;
  }

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const provider=await waitForStorageFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade v225 is unavailable after page initialization.');
      const facade=await provider.open(),meta=facade.meta||{};
      if(String(meta.candidateKey||'')!==EXPECTED.candidateKey||Number(meta.headVersion||0)!==EXPECTED.headVersion||String(meta.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta.canonicalRowCount||0)!==EXPECTED.canonicalRows)throw new Error('Review candidate requires the exact ACTIVE Authority-v3 mirror.');
      if(Number(facade.pendingOutboxRows||0)!==0)throw new Error(`Review candidate requires an empty sync_outbox; found ${facade.pendingOutboxRows} pending row(s).`);
      const anchor=facade.readProgressRecord(ANCHOR_WORD_ID);if(Number(anchor.firstSeen||0)!==EXPECTED.anchorFirstSeenMs)throw new Error('Authority-v3 FirstSeen anchor check failed.');
      state.facade=facade;state.active=true;state.prepareError='';setStatus('READY · Review is reading ACTIVE Canonical v3.',null,'For the reverse-direction test, open WID2876 conjure up with Study. On the Study card, change Medium → High and Save. Do not use Suggested Attention Apply/Keep for this step.');setButtons();return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'Candidate writes stay locked; no legacy write is allowed on this route.');setButtons();return false;}
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

  async function buildApplyPlan(meta,stateRow,args){
    const wordId=String(args.wordId||'').trim(),fromLevel=String(args.fromLevel||'').toLowerCase(),toLevel=String(args.toLevel||'').toLowerCase();
    const base=clone(stateRow.payload||{}),cardId=await cardIdForWordId(wordId),baseLevel=String(base.review_level||'').toLowerCase();
    if(!wordId||!['high','medium','light'].includes(fromLevel)||!['high','medium','light'].includes(toLevel)||fromLevel===toLevel)throw new Error('Invalid Apply suggestion payload.');
    if(String(base.card_id||'')!==cardId)throw new Error(`WID ${wordId} Canonical card identity mismatch.`);
    if(baseLevel!==fromLevel||base.review!==true)throw new Error(`WID ${wordId} attention changed before Apply (${baseLevel||'none'} ≠ ${fromLevel}).`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));if(basePayloadHash!==String(stateRow.payloadHash||''))throw new Error(`WID ${wordId} base payload hash mismatch.`);
    const intent={candidate:true,kind:'review-real-apply-control',cardId,wordId,fromLevel,toLevel,evidenceThrough:Number(args.evidenceThrough||0),at,basePayloadHash,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:String(meta.candidateKey||'')};
    const actionId=`review-live-control-action:${await sha256(stableStringify(intent))}`,stateMutationId=`review-live-control-mut:${await sha256(`state|${actionId}`)}`,eventMutationId=`review-live-control-mut:${await sha256(`event|${actionId}`)}`,eventId=await uuidV5(CARD_NAMESPACE_UUID,`review-live-control-event|interaction|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:true,candidateOnly:true,transportEligible:false,status:'candidate-pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId,source:'review-suggestion',level:toLevel,reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],fromLevel,suggested:true,suggestionPolicyVersion:String(args.suggestionPolicyVersion||'1.0.0'),evidenceThrough:Number(args.evidenceThrough||0),candidateOnly:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{kind:'apply',actionId,wordId,cardId,fromLevel,toLevel,mutations:[stateMutation,eventMutation],at};
  }

  async function buildKeepPlan(meta,stateRow,args){
    const wordId=String(args.wordId||'').trim(),fromLevel=String(args.fromLevel||'').toLowerCase(),toLevel=String(args.toLevel||'').toLowerCase();
    const base=clone(stateRow.payload||{}),cardId=await cardIdForWordId(wordId),baseLevel=String(base.review_level||'').toLowerCase();
    if(!wordId||!['high','medium','light'].includes(fromLevel)||!['high','medium','light'].includes(toLevel)||fromLevel===toLevel)throw new Error('Invalid Keep suggestion payload.');
    if(String(base.card_id||'')!==cardId)throw new Error(`WID ${wordId} Canonical card identity mismatch.`);
    if(baseLevel!==fromLevel||base.review!==true)throw new Error(`WID ${wordId} attention changed before Keep (${baseLevel||'none'} ≠ ${fromLevel}).`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));if(basePayloadHash!==String(stateRow.payloadHash||''))throw new Error(`WID ${wordId} base payload hash mismatch.`);
    const intent={candidate:true,kind:'review-real-keep-control',cardId,wordId,fromLevel,toLevel,evidenceThrough:Number(args.evidenceThrough||0),at,basePayloadHash,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:String(meta.candidateKey||'')};
    const actionId=`review-live-control-action:${await sha256(stableStringify(intent))}`,eventMutationId=`review-live-control-mut:${await sha256(`event|${actionId}`)}`,eventId=await uuidV5(CARD_NAMESPACE_UUID,`review-live-control-event|interaction|${actionId}`);
    const shared={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:true,candidateOnly:true,transportEligible:false,status:'candidate-pending'};
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:cardId,session_id:null,event_type:'attention_suggestion_kept',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:{timestamp:atMs,action:'attention_suggestion_kept',wordId,source:'review-hub',fromLevel,suggestedLevel:toLevel,suggestionPolicyVersion:String(args.suggestionPolicyVersion||'1.0.0'),evidenceThrough:Number(args.evidenceThrough||0),candidateOnly:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{kind:'keep',actionId,wordId,cardId,fromLevel,toLevel,mutations:[eventMutation],at};
  }

  async function enqueueMutations(db,plan){
    const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;
    const existing=await Promise.all(plan.mutations.map(mutation=>requestPromise(store.get(mutation.mutationId))));
    plan.mutations.forEach((mutation,index)=>{const row=existing[index];if(row){if(stableStringify(row)!==stableStringify(mutation))throw new Error('Candidate mutation ID collision.');}else{store.add(clone(mutation));wrote++;}});
    await transactionDone(tx);return{wrote,idempotent:wrote===0};
  }
  async function cleanupMutations(db,plan){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const mutation of plan.mutations)store.delete(mutation.mutationId);await transactionDone(tx);}

  async function runLiveControl(kind,args){
    if(!state.active)throw new Error('Canonical Review candidate is not active.');if(state.busy)throw new Error('Another Canonical Review candidate action is running.');
    state.busy=true;setButtons();setStatus(`Running real ${kind==='apply'?'Apply':'Keep'} control → outbox → facade → DOM → rollback…`);let db=null,plan=null,cleanupNeeded=false;
    try{
      db=await openDb();const meta=await getMeta(db),before=await countOutbox(db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      const wordId=String(args.wordId||'').trim(),cardId=await cardIdForWordId(wordId),stateRow=await getStateRow(db,cardId);if(!stateRow)throw new Error(`WID ${wordId} learning_state row missing.`);
      const baseWrapper=clone(stateRow),baseFacade=await window.WLPCanonicalStorageCompatibilityFacade.open(),baseRecord=baseFacade.readProgressRecord(wordId),baseInteractions=baseFacade.readInteractionEvents();
      plan=kind==='apply'?await buildApplyPlan(meta,stateRow,args):await buildKeepPlan(meta,stateRow,args);
      const write=await enqueueMutations(db,plan);cleanupNeeded=true;const during=await countOutbox(db);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();await nextFrames(3);
      const overlayFacade=state.facade,overlayRecord=overlayFacade.readProgressRecord(wordId),overlayInteractions=overlayFacade.readInteractionEvents(),domDuring=findLevelText(wordId),eventAction=kind==='apply'?'attention_set':'attention_suggestion_kept';
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')===eventAction&&String(e?.wordId||'')===wordId&&e?.candidateOnly===true);
      const expectedRows=kind==='apply'?2:1,expectedLevel=kind==='apply'?plan.toLevel:plan.fromLevel;
      const baseDuring=await getStateRow(db,cardId),baseUntouched=stableStringify(baseDuring)===stableStringify(baseWrapper);
      const overlayOk=Boolean(during===expectedRows&&Number(overlayFacade.pendingOutboxRows||0)===expectedRows&&Number(overlayFacade.overlayMutationsApplied||0)>=expectedRows&&String(overlayRecord.reviewLevel||'')===expectedLevel&&Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0)&&overlayInteractions.length===baseInteractions.length+1&&eventFound&&domDuring===cap(expectedLevel));
      await cleanupMutations(db,plan);cleanupNeeded=false;const after=await countOutbox(db);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();await nextFrames(3);
      const restored=state.facade.readProgressRecord(wordId),restoredInteractions=state.facade.readInteractionEvents(),domAfter=findLevelText(wordId),baseAfter=await getStateRow(db,cardId);
      const cleanupOk=Boolean(after===0&&Number(state.facade.pendingOutboxRows||0)===0&&String(restored.reviewLevel||'')===plan.fromLevel&&Number(restored.firstSeen||0)===Number(baseRecord.firstSeen||0)&&restoredInteractions.length===baseInteractions.length&&domAfter===cap(plan.fromLevel)&&stableStringify(baseAfter)===stableStringify(baseWrapper));
      const blocking=[];if(write.wrote!==expectedRows)blocking.push(`Expected ${expectedRows} outbox write(s), got ${write.wrote}.`);if(!overlayOk)blocking.push(`Real ${cap(kind)} control did not render its Canonical pending overlay exactly.`);if(!baseUntouched)blocking.push('Canonical learning_state base changed during the candidate action.');if(!cleanupOk)blocking.push('Automatic candidate rollback did not restore the base DOM and empty outbox.');
      state.report={format:'WLP_CANONICAL_REVIEW_LIVE_CONTROL_OUTBOX_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-existing-review-control-to-local-outbox-roundtrip',device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion||null,migrationVersion:meta?.migrationVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,canonicalRows:meta?.canonicalRowCount||null},summary:{requested:true,canonicalReviewReadActive:true,existingControlRerouted:true,controlAction:kind,wordId:plan.wordId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,outboxRowsBefore:before,rowsWritten:write.wrote,outboxRowsDuring:during,domOverlayAttention:domDuring,interactionEventDelta:overlayInteractions.length-baseInteractions.length,cleanupVerified:cleanupOk,outboxRowsAfter:after,domRestoredAttention:domAfter,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0),blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,wordId:plan.wordId,cardId:plan.cardId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,mutationIds:plan.mutations.map(x=>x.mutationId),candidateOnly:true,transportEligible:false},reads:{sourceDuring:overlayFacade.source,sourceAfter:state.facade.source,readCounts:clone(state.readCounts),baseReviewRows:baseFacade.readReviewRecords().length,overlayReviewRows:overlayFacade.readReviewRecords().length,interactionBefore:baseInteractions.length,interactionDuring:overlayInteractions.length,interactionAfter:restoredInteractions.length,eventFound},checks:[['Existing Review control routed away from legacy localStorage',true,`${kind} handled by Canonical candidate API`],['Candidate mutation count is exact',write.wrote===expectedRows&&during===expectedRows,`${write.wrote} write(s) · outbox ${during}`],[`Real ${cap(kind)} control is visible through facade + DOM`,overlayOk,`${plan.fromLevel} → ${expectedLevel} · DOM ${domDuring||'missing'}`],['Interaction event is visible only while pending',overlayInteractions.length===baseInteractions.length+1&&eventFound,`Δ ${overlayInteractions.length-baseInteractions.length} · found=${eventFound}`],['Explicit firstSeen is preserved',Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Automatic rollback restores base + empty outbox',cleanupOk,`DOM ${domAfter||'missing'} · outbox ${after}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking,warnings:['This query-gated candidate reroutes the existing Review Apply/Keep controls into transport-ineligible local outbox mutations and automatically removes them after verification.','Normal /review remains on legacy reads and legacy writes.','Cloud mutation transport, acknowledgement, and conflict resolution remain disabled.']},invariants:{normalReviewRouteRemainsLegacy:true,candidateUsesCanonicalFacadeReads:true,existingCandidateControlsUseOutbox:true,noLegacyLocalStorageWritesByCandidate:true,indexedDbWritesRestrictedToSyncOutbox:true,candidateRowsTransportIneligible:true,automaticCleanupComplete:cleanupOk,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0)}};
      setStatus(state.report.summary.pass?`PASS · Real Review ${cap(kind)} control used the Canonical outbox path and rolled back cleanly.`:`CHECK · ${blocking.join(' ')}`,state.report.summary.pass,`${plan.wordId} · ${cap(plan.fromLevel)} → ${cap(expectedLevel)} → ${cap(plan.fromLevel)} · outbox 0 → ${expectedRows} → 0`);setButtons();return{pass:state.report.summary.pass,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);try{if(db&&plan&&cleanupNeeded)await cleanupMutations(db,plan);}catch(cleanupError){console.error('Candidate cleanup failed',cleanupError);}try{state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();}catch(_){ }state.report={format:'WLP_CANONICAL_REVIEW_LIVE_CONTROL_OUTBOX_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-existing-review-control-to-local-outbox-roundtrip',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},summary:{requested:true,canonicalReviewReadActive:state.active,existingControlRerouted:true,controlAction:kind,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort candidate outbox cleanup was attempted after failure.']},invariants:{normalReviewRouteRemainsLegacy:true,noCloudWrites:true,noLegacyLocalStorageWritesByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'No Cloud write occurred; best-effort local outbox cleanup was attempted.');setButtons();return{pass:false,error:message,report:clone(state.report)};
    }finally{if(db)db.close();state.busy=false;setButtons();}
  }

  async function applySuggestion(args){return runLiveControl('apply',args||{});}
  async function keepSuggestion(args){return runLiveControl('keep',args||{});}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-review-live-control-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  const api={version:2,requested,isActive:()=>state.active,prepare,readReviewRecords,readProgressRecord,readArray,readAIEvents,readInteractionEvents,applySuggestion,keepSuggestion,getReport:()=>clone(state.report)};
  window.WLPCanonicalReviewWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
