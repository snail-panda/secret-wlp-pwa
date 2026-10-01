/* WLP v1.8.6.257 — Review Apply → persistent Canonical outbox canary.
   Query-gated by ?wlpCanonicalReviewWrite=1; normal Review remains unchanged.
   The candidate route reads Review from the ACTIVE Canonical v3 facade and reroutes
   the existing Suggested Attention Apply control into the same production-shaped,
   transport-eligible learning_state + learning_events contract already proven by Study.
   The two outbox rows intentionally remain pending for manual Cloud Shadow steady sync.
   Keep is locked on the candidate route in this step; its event-only sync contract is separate. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.257-review-apply-persistent-outbox-canary-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror';
  const PROGRESS_PREFIX='fc:wordid:';
  const STUDYQ_EVENT_KEY='wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY='wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY='wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY='wlp:stage7:interaction-events:v1';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const EXPECTED={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const requested=new URLSearchParams(location.search).get('wlpCanonicalReviewWrite')==='1';
  const state={active:false,busy:false,facade:null,report:null,prepareError:'',readCounts:{review:0,progress:0,standard:0,standardSessions:0,ai:0,interaction:0},observer:null};

  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  function stableStringify(v){return JSON.stringify(stableValue(v));}
  function utf8Bytes(v){return new TextEncoder().encode(String(v??''));}
  async function sha256(v){const out=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8Bytes(v)));return [...out].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(ns,name){const a=uuidToBytes(ns),b=utf8Bytes(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  function uuidLike(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
  function requestPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.'));});}
  function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});}
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Review canary blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Review canary blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Review canary IndexedDB open is blocked by another page.'));});}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(META_KEY));await transactionDone(tx);return row||null;}
  async function getStateRow(db,cardId){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),rows=await requestPromise(tx.objectStore(OUTBOX_STORE).getAll());await transactionDone(tx);return Array.isArray(rows)?rows:[];}
  async function cardIdForWordId(wordId){return uuidV5(CARD_NAMESPACE_UUID,`card|wid:${String(wordId||'').trim()}`);}

  function makePanel(){
    if(!requested||document.getElementById('wlp-review-write-candidate-box'))return;
    const box=document.createElement('section');box.id='wlp-review-write-candidate-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(370px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Review Apply · persistent canary</strong><div id="wlp-review-write-candidate-status" style="margin-top:4px">Preparing Canonical Review…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-review-write-candidate-export" type="button" disabled>Export JSON</button><a href="./review.html" style="align-self:center">Return to normal Review</a></div><div id="wlp-review-write-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
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
  function nextFrames(n=3){return new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}
  function findLevelText(wordId){for(const card of document.querySelectorAll('.review-card')){const meta=card.querySelector('.review-card-meta')?.textContent||'';if(meta.includes(`WID${wordId}`))return (card.querySelector('.review-level-tag')?.textContent||'').trim();}return'';}
  function cap(value){const s=String(value||'');return s?s[0].toUpperCase()+s.slice(1):'';}
  function visibleApplyCount(){return [...document.querySelectorAll('[data-suggestion-apply]')].filter(button=>button.offsetParent!==null).length;}
  function updateReadyHint(){
    if(!state.active||state.report||state.busy)return;
    const count=visibleApplyCount();
    setStatus('READY · Canonical Review read is active for this canary.',true,`Visible Suggested Attention Apply controls: ${count}. Click one Apply button only. Keep is locked in v257. Outbox must stay empty until that click.`);
  }
  function observeControls(){
    if(!requested||state.observer)return;const root=document.getElementById('review-list');if(!root)return;
    state.observer=new MutationObserver(()=>requestAnimationFrame(updateReadyHint));state.observer.observe(root,{childList:true,subtree:true});requestAnimationFrame(updateReadyHint);
  }

  async function waitForStorageFacade(){for(let i=0;i<80;i++){const provider=window.WLPCanonicalStorageCompatibilityFacade;if(provider?.open)return provider;await new Promise(resolve=>setTimeout(resolve,25));}return null;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const provider=await waitForStorageFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade is unavailable.');
      const facade=await provider.open(),meta=facade.meta||{};
      if(String(meta.candidateKey||'')!==EXPECTED.candidateKey||Number(meta.headVersion||0)!==EXPECTED.headVersion||String(meta.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta.canonicalRowCount||0)!==EXPECTED.canonicalRows)throw new Error('Review canary requires the exact ACTIVE Authority-v3 mirror.');
      if(Number(facade.pendingOutboxRows||0)!==0)throw new Error(`Review canary requires an empty sync_outbox; found ${facade.pendingOutboxRows} pending row(s).`);
      state.facade=facade;state.active=true;state.prepareError='';observeControls();updateReadyHint();setButtons();return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'Candidate writes stay locked; normal Review is available without the query flag.');setButtons();return false;}
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
    const intent={kind:'review-suggested-attention-apply',cardId,wordId,fromLevel,toLevel,evidenceThrough:Number(args.evidenceThrough||0),at,basePayloadHash,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:String(meta.candidateKey||''),contract:'review-apply-persistent-canary-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`),stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`),eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`),eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|attention_set|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,canonicalReviewApplyCanary:true,transportEligible:true,status:'pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:Object.keys(patch),patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const reasons=Array.isArray(base.review_reasons)?clone(base.review_reasons):[];
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId,source:'review-suggestion',level:toLevel,reasons,fromLevel,suggested:true,suggestionPolicyVersion:String(args.suggestionPolicyVersion||'1.0.0'),evidenceThrough:Number(args.evidenceThrough||0),canonicalReviewApplyCanary:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,eventId,wordId,cardId,fromLevel,toLevel,basePayloadHash,baseWrapper:clone(stateRow),at,mutations:[stateMutation,eventMutation]};
  }

  async function enqueueMutations(db,plan){
    const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;
    const existing=await Promise.all(plan.mutations.map(mutation=>requestPromise(store.get(mutation.mutationId))));
    plan.mutations.forEach((mutation,index)=>{const row=existing[index];if(row){if(stableStringify(row)!==stableStringify(mutation))throw new Error('Review canary mutation ID collision.');}else{store.add(clone(mutation));wrote++;}});
    await transactionDone(tx);return wrote;
  }
  async function cleanupMutations(db,plan){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const mutation of plan.mutations)store.delete(mutation.mutationId);await transactionDone(tx);}

  async function applySuggestion(args){
    if(!state.active)throw new Error('Canonical Review canary is not active.');if(state.busy)throw new Error('Another Canonical Review action is running.');
    state.busy=true;setButtons();setStatus('Writing Review Apply → persistent Canonical outbox…');let db=null,plan=null,wrote=false;
    try{
      db=await openDb();const meta=await getMeta(db),beforeRows=await getOutbox(db);if(beforeRows.length!==0)throw new Error(`One Canonical action must be synced before another write; sync_outbox currently has ${beforeRows.length} row(s).`);
      const wordId=String(args.wordId||'').trim(),cardId=await cardIdForWordId(wordId),stateRow=await getStateRow(db,cardId);if(!stateRow)throw new Error(`WID ${wordId} Canonical learning_state row is missing.`);
      const baseFacade=await window.WLPCanonicalStorageCompatibilityFacade.open(),baseRecord=baseFacade.readProgressRecord(wordId),baseInteractions=baseFacade.readInteractionEvents(),legacyProgressBefore=localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`),legacyInteractionsBefore=localStorage.getItem(INTERACTION_EVENTS_KEY);
      plan=await buildApplyPlan(meta,stateRow,args);const added=await enqueueMutations(db,plan);wrote=added>0;
      const duringRows=await getOutbox(db),ours=duringRows.filter(row=>String(row?.actionId||'')===plan.actionId);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();await nextFrames(4);
      const overlayRecord=state.facade.readProgressRecord(wordId),overlayInteractions=state.facade.readInteractionEvents(),domDuring=findLevelText(wordId),baseDuring=await getStateRow(db,cardId),baseUntouched=stableStringify(baseDuring)===stableStringify(plan.baseWrapper),eventFound=overlayInteractions.some(event=>String(event?.action||'')==='attention_set'&&String(event?.wordId||'')===wordId&&event?.canonicalReviewApplyCanary===true),legacyUntouched=localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`)===legacyProgressBefore&&localStorage.getItem(INTERACTION_EVENTS_KEY)===legacyInteractionsBefore;
      const identitiesOk=uuidLike(plan.actionId)&&plan.mutations.every(m=>uuidLike(m.mutationId))&&uuidLike(plan.eventId),transportOk=ours.length===2&&ours.every(row=>row?.transportEligible===true&&row?.diagnosticOnly===false),domOk=!domDuring||domDuring===cap(plan.toLevel),overlayOk=String(overlayRecord.reviewLevel||'')===plan.toLevel&&Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0)&&overlayInteractions.length===baseInteractions.length+1&&eventFound&&domOk;
      const blocking=[];if(added!==2||duringRows.length!==2||ours.length!==2)blocking.push(`Expected exactly two persistent outbox rows; wrote ${added}, outbox ${duringRows.length}, action rows ${ours.length}.`);if(!transportOk)blocking.push('Review Apply outbox rows are not production transport eligible.');if(!identitiesOk)blocking.push('Review Apply action/mutation/event identity is not production UUID shape.');if(!overlayOk)blocking.push('Review Apply pending overlay did not converge through facade + Review DOM.');if(!baseUntouched)blocking.push('Canonical learning_state base changed before steady sync.');if(!legacyUntouched)blocking.push('Legacy localStorage changed during Review Apply canary.');
      if(blocking.length){if(wrote)await cleanupMutations(db,plan);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();throw new Error(blocking.join(' '));}
      const cursor=Math.max(Number(meta?.lastSyncCursor||0),Number(meta?.materializedSyncCursor||0));
      state.report={format:'WLP_CANONICAL_REVIEW_APPLY_PERSISTENT_OUTBOX_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-review-suggestion-apply-to-production-persistent-outbox',device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,materializedSyncCursor:cursor,materializedManifestHash:meta?.materializedManifestHash||null,materializedRows:meta?.materializedCanonicalRowCount||null},summary:{requested:true,canonicalReviewReadActive:true,existingApplyControlRerouted:true,wordId:plan.wordId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,outboxRowsBefore:beforeRows.length,outboxRowsAfter:duringRows.length,overlayMutationsApplied:Number(state.facade.overlayMutationsApplied||0),domOverlayAttention:domDuring,interactionEventDelta:overlayInteractions.length-baseInteractions.length,transportEligible:transportOk,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0),legacyLocalStorageUntouched:legacyUntouched,cloudWrites:0,blockingIssues:0,nextPhaseEligible:true,pass:true},plan:{actionId:plan.actionId,eventType:'attention_set',wordId:plan.wordId,cardId:plan.cardId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,mutationIds:ours.map(row=>row.mutationId).sort(),eventId:plan.eventId,createdAt:plan.at},checks:[['Existing Review Apply control routed away from legacy localStorage',true,'Apply handled by Canonical Review candidate API'],['Exactly two transport-eligible outbox rows retained',duringRows.length===2&&ours.length===2,`outbox ${beforeRows.length} → ${duringRows.length}`],['Production action/mutation/event identities are UUIDs',identitiesOk,`${plan.actionId} · 2 mutations`],['Storage Facade overlays pending Review Attention state/event',overlayOk,`${plan.fromLevel} → ${plan.toLevel} · DOM ${domDuring||'reordered out of visible page'}`],['Explicit firstSeen is preserved',Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical materialized base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Legacy localStorage remains byte-identical',legacyUntouched,'progress + interaction event keys unchanged']].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking:[],warnings:['v257 is query-gated. Normal /review remains unchanged while this first persistent Review Apply write is proven.','The two outbox rows intentionally remain pending. Run Cloud Shadow steady sync only after this report passes.','Keep is intentionally locked on the candidate route in v257; its event-only Canonical transport contract is a separate next step.']},invariants:{normalReviewRouteUnchanged:true,candidateUsesCanonicalFacadeReads:true,existingApplyUsesPersistentOutbox:true,noLegacyLocalStorageWritesByCandidate:legacyUntouched,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(baseRecord.firstSeen||0)}};
      setStatus(`PASS · WID ${plan.wordId} Review Apply is pending Cloud push.`,true,`${cap(plan.fromLevel)} → ${cap(plan.toLevel)} · outbox 0 → 2. Export JSON, then use Cloud Shadow steady sync.`);setButtons();return{pass:true,pending:true,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);if(db&&plan&&wrote){try{await cleanupMutations(db,plan);state.facade=await window.WLPCanonicalStorageCompatibilityFacade.open();dispatchRefresh();}catch(cleanupError){console.error('Review canary cleanup failed',cleanupError);}}state.report={format:'WLP_CANONICAL_REVIEW_APPLY_PERSISTENT_OUTBOX_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-review-suggestion-apply-to-production-persistent-outbox',summary:{requested:true,canonicalReviewReadActive:state.active,existingApplyControlRerouted:true,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort cleanup was attempted if this canary had inserted pending rows before the failure.']},invariants:{normalReviewRouteUnchanged:true,noCloudWrites:true,noLegacyLocalStorageWritesByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'No Cloud write occurred. If the canary inserted rows before failing local verification, best-effort cleanup was attempted.');setButtons();return{pass:false,error:message,report:clone(state.report)};
    }finally{if(db)db.close();state.busy=false;setButtons();}
  }

  async function keepSuggestion(){
    const message='v257 persistent canary covers Apply only. Keep is locked on this query-gated route until the event-only Canonical transport contract is added.';
    setStatus(`BLOCKED · ${message}`,false,'Return to normal Review if you need Keep before the next Review write phase.');
    return{pass:false,error:message};
  }
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-review-apply-persistent-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  const api={version:3,requested,isActive:()=>state.active,prepare,readReviewRecords,readProgressRecord,readArray,readAIEvents,readInteractionEvents,applySuggestion,keepSuggestion,getReport:()=>clone(state.report)};
  window.WLPCanonicalReviewWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
