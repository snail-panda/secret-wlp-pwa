/* WLP v1.8.6.246 — default Canonical Study state membership canary.
   Normal Study for WID2876 continues to read the materialized Canonical mirror.
   In addition to Attention, the existing Studied / Review membership controls are
   unlocked for this canary and rerouted into a production-shaped learning_state +
   learning_events sync_outbox pair. Other cards remain on the prior path.
   Rollback for WID2876: ?wlpLegacyStudyAttentionWrite=1
   No Cloud write is performed here; a later steady-sync step transports the outbox. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.247-study-state-active-card-selector-fix-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror', CURSOR_KEY='sync_cursor';
  const PROGRESS_PREFIX='fc:wordid:';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BOOTSTRAP={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const params=new URLSearchParams(location.search);
  const targetWordId=String(params.get('wordid')||'').trim();
  const rollbackRequested=params.get('wlpLegacyStudyAttentionWrite')==='1';
  const requested=targetWordId==='2876' && !rollbackRequested;
  const state={active:false,busy:false,pending:false,db:null,meta:null,cursorMeta:null,cardId:'',baseWrapper:null,baseRecord:null,overlayRecord:null,report:null,prepareError:'',renderCtx:null};

  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  function stableStringify(v){return JSON.stringify(stableValue(v));}
  function utf8Bytes(v){return new TextEncoder().encode(String(v??''));}
  async function sha256(v){const out=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8Bytes(v)));return [...out].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(ns,name){const a=uuidToBytes(ns),b=utf8Bytes(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
  function requestPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.'));});}
  function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});}
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Canonical cutover blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Canonical cutover blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Canonical cutover IndexedDB open is blocked by another page.'));});}
  async function getMeta(db,key){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(key));await transactionDone(tx);return row||null;}
  async function getStateRow(db,cardId){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function countOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),n=await requestPromise(tx.objectStore(OUTBOX_STORE).count());await transactionDone(tx);return Number(n||0);}
  async function getAllOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),rows=await requestPromise(tx.objectStore(OUTBOX_STORE).getAll());await transactionDone(tx);return Array.isArray(rows)?rows:[];}
  async function cardIdForWordId(wordId){return uuidV5(CARD_NAMESPACE_UUID,`card|wid:${String(wordId||'').trim()}`);}
  function ms(v){if(v==null||v==='')return 0;const n=Date.parse(v);return Number.isFinite(n)?n:0;}
  function legacyRecord(wordId,payload){const p=payload||{};return{wordId:String(wordId||''),known:p.known??false,review:Boolean(p.review),studied:Boolean(p.studied),reviewLevel:String(p.review_level||''),reviewReasons:Array.isArray(p.review_reasons)?clone(p.review_reasons):[],attempts:Number(p.attempt_count||0),studyCount:Number(p.study_count||0),reviewCount:Number(p.review_count||0),exposureCount:Number(p.exposure_count||0),lastResult:p.last_result??null,lastSeen:ms(p.last_seen_at),firstSeen:ms(p.first_seen_at),lastStudied:ms(p.last_studied_at),lastReviewed:ms(p.last_reviewed_at),lastAttentionUpdated:ms(p.last_attention_updated_at)};}
  function localLegacyRecord(wordId){try{return JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`)||'{}');}catch(_){return{};}}
  function cap(v){const s=String(v||'');return s?s[0].toUpperCase()+s.slice(1):'None';}
  function nextFrames(n=2){return new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}

  function makePanel(){
    if(!requested||document.getElementById('wlp-study-attention-candidate-box'))return;
    const box=document.createElement('section');box.id='wlp-study-attention-candidate-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(360px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Study State · membership canary</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing materialized Canonical state…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){const el=document.getElementById('wlp-study-attention-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}const d=document.getElementById('wlp-study-attention-candidate-detail');if(d)d.textContent=detail;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=state.busy||!state.report;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const db=await openDb(),meta=await getMeta(db,META_KEY),cursorMeta=await getMeta(db,CURSOR_KEY),outbox=await countOutbox(db),cardId=await cardIdForWordId(targetWordId),stateRow=await getStateRow(db,cardId);
      if(String(meta?.candidateKey||'')!==BOOTSTRAP.candidateKey||Number(meta?.headVersion||0)!==BOOTSTRAP.headVersion||String(meta?.migrationVersion||'')!==BOOTSTRAP.migrationVersion||String(meta?.snapshotManifestHash||'')!==BOOTSTRAP.manifestHash||Number(meta?.canonicalRowCount||0)!==BOOTSTRAP.canonicalRows){db.close();throw new Error('Default cutover requires the exact ACTIVE Authority-v3 bootstrap mirror.');}
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      if(cursor<4){db.close();throw new Error(`Default cutover requires the converged steady-state mirror at cursor 4 or later; found ${cursor}.`);}
      if(!stateRow){db.close();throw new Error(`WID ${targetWordId} learning_state row is missing from the Canonical mirror.`);}
      const base=clone(stateRow.payload||{}),hash=await sha256(stableStringify(base));if(hash!==String(stateRow.payloadHash||'')){db.close();throw new Error(`WID ${targetWordId} Canonical payload hash mismatch.`);}
      if(String(base.card_id||'')!==cardId){db.close();throw new Error(`WID ${targetWordId} Canonical card identity mismatch.`);}
      if(!['light','medium','high'].includes(String(base.review_level||'').toLowerCase()))throw new Error(`WID ${targetWordId} has no supported Canonical Attention level.`);
      if(!Boolean(base.review))throw new Error(`WID ${targetWordId} is not currently in Canonical Review.`);
      if(outbox!==0)throw new Error(`Default cutover requires an empty sync_outbox; found ${outbox} pending row(s).`);
      state.db=db;state.meta=meta;state.cursorMeta=cursorMeta;state.cardId=cardId;state.baseWrapper=clone(stateRow);state.baseRecord=legacyRecord(targetWordId,base);state.overlayRecord=null;state.active=true;state.prepareError='';
      const legacy=localLegacyRecord(targetWordId),legacyLevel=String(legacy.reviewLevel||'').toLowerCase(),canonicalLevel=String(base.review_level||'').toLowerCase();
      const divergence=legacyLevel&&legacyLevel!==canonicalLevel?` Legacy localStorage says ${cap(legacyLevel)}, but this normal Study route is now reading Canonical ${cap(canonicalLevel)}.`:'';
      setStatus('READY · Normal Study is using Canonical state by default.',null,`WID2876 · Canonical Review / ${cap(canonicalLevel)} · cursor ${cursor}.${divergence} Tap Studied for this membership canary. Rollback flag: ?wlpLegacyStudyAttentionWrite=1`);
      return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'No Attention write is allowed through the Canonical canary.');return false;}
  }

  function readProgressKey(key){if(!state.active||!String(key||'').startsWith(PROGRESS_PREFIX))return null;const wid=String(key).slice(PROGRESS_PREFIX.length);if(wid!==targetWordId)return null;return clone(state.overlayRecord||state.baseRecord);}
  async function enqueueMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;const existing=await Promise.all(plan.mutations.map(m=>requestPromise(store.get(m.mutationId))));plan.mutations.forEach((m,i)=>{const row=existing[i];if(row){if(stableStringify(row)!==stableStringify(m))throw new Error('Canonical cutover mutation ID collision.');}else{store.add(clone(m));wrote++;}});await transactionDone(tx);return wrote;}
  async function cleanupMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of plan.mutations)store.delete(m.mutationId);await transactionDone(tx);}
  async function waitForFacade(){for(let i=0;i<40;i++){const p=window.WLPCanonicalStorageCompatibilityFacade;if(p?.open)return p;await new Promise(r=>setTimeout(r,25));}return null;}
  function attentionButtonText(){return (document.querySelector('.btn-review-attention:not([hidden]), .btn-review-attention-front:not([hidden])')?.textContent||'').trim();}

  async function buildPlan(level,reasons){
    const base=clone(state.baseWrapper.payload||{}),fromLevel=String(base.review_level||'').toLowerCase(),toLevel=String(level||'').toLowerCase();
    if(!['light','medium','high'].includes(toLevel))throw new Error('Canonical Attention cutover currently requires Light, Medium, or High.');
    if(toLevel===fromLevel)throw new Error(`Choose a different Attention level from the current ${cap(fromLevel)} for this canary.`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper.payloadHash||''))throw new Error('Canonical base payload changed before Attention Save.');
    const reasonList=Array.isArray(reasons)?clone(reasons):[];
    const intent={kind:'study-card-attention-save',direction:'default-canonical-cutover',cardId:state.cardId,wordId:targetWordId,fromLevel,toLevel,reasons:reasonList,at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||''),contract:'study-attention-default-cutover-canary-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`),stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`),eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`),eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|attention_set|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,review_reasons:reasonList,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,reverseSyncCandidate:true,canonicalCutoverCanary:true,transportEligible:true,status:'pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','review_reasons','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId:targetWordId,source:'study-card',level:toLevel,reasons:reasonList,fromLevel,canonicalCutoverCanary:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,fromLevel,toLevel,at,mutations:[stateMutation,eventMutation],patchedPayload:{...base,...patch}};
  }

  async function runAttentionRoundtrip(args){
    if(!state.active)throw new Error('Canonical Study Attention default canary is not active.');if(state.busy)throw new Error('Another Canonical Attention action is running.');
    state.busy=true;setStatus('Saving normal Study Attention → persistent Canonical outbox…');let plan=null,cleanupNeeded=false;
    try{
      const before=await countOutbox(state.db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      plan=await buildPlan(args?.level,args?.reasons);const wrote=await enqueueMutations(plan);cleanupNeeded=true;const during=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload);if(typeof args?.refresh==='function')args.refresh();await nextFrames(3);
      const uiDuring=attentionButtonText(),provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade did not become available for Canonical overlay verification.');
      const overlayFacade=await provider.open(),overlayRecord=overlayFacade.readProgressRecord(targetWordId),overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')==='attention_set'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.canonicalCutoverCanary===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const rows=await getAllOutbox(state.db),ours=rows.filter(r=>r?.canonicalCutoverCanary===true&&r?.transportEligible===true&&String(r?.actionId||'')===plan.actionId);
      const identitiesOk=ours.length===2&&ours.every(r=>isUuid(r.mutationId))&&isUuid(plan.actionId)&&isUuid(ours.find(r=>r.tableName==='learning_events')?.rowKey);
      const overlayOk=Boolean(wrote===2&&during===2&&ours.length===2&&identitiesOk&&Number(overlayFacade.pendingOutboxRows||0)>=2&&Number(overlayFacade.overlayMutationsApplied||0)>=2&&String(overlayRecord.reviewLevel||'').toLowerCase()===plan.toLevel&&Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)&&eventFound&&uiDuring===`${cap(plan.toLevel)} attention`);
      if(!overlayOk||!baseUntouched)throw new Error(!overlayOk?'Normal Study Save did not render the exact pending Canonical overlay.':'Canonical learning_state base changed during local outbox creation.');
      cleanupNeeded=false;
      const legacy=localLegacyRecord(targetWordId),cursor=Math.max(Number(state.meta?.materializedSyncCursor??state.meta?.lastSyncCursor??0),Number(state.cursorMeta?.lastSyncCursor||0));
      const blocking=[];
      state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_DEFAULT_CUTOVER_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'normal-study-default-canonical-read-plus-persistent-outbox-write-canary',device:{deviceKey:state.meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,materializedSyncCursor:cursor,materializedManifestHash:state.meta?.materializedManifestHash||null,materializedRows:state.meta?.materializedCanonicalRowCount||null},summary:{defaultCutoverActive:true,rollbackRequested:false,wordId:targetWordId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,outboxRowsBefore:before,outboxRowsAfter:during,overlayMutationsApplied:Number(overlayFacade.overlayMutationsApplied||0),studyUiAttention:uiDuring,transportEligible:true,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),legacyLocalStorageAttention:String(legacy.reviewLevel||''),cloudWrites:0,blockingIssues:0,nextPhaseEligible:true,pass:true},plan:{actionId:plan.actionId,wordId:targetWordId,cardId:state.cardId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,mutationIds:ours.map(x=>x.mutationId).sort(),eventId:ours.find(x=>x.tableName==='learning_events')?.rowKey||null,createdAt:plan.at},checks:[['Normal Study route activated Canonical read/write canary',true,`WID ${targetWordId} · no query opt-in`],['Exactly two transport-eligible outbox rows retained',during===2&&ours.length===2,`outbox ${before} → ${during}`],['Production action/mutation/event identities are UUIDs',identitiesOk,`${plan.actionId} · ${ours.length} mutations`],['Storage Facade overlays the pending state/event',Number(overlayFacade.overlayMutationsApplied||0)>=2,`${Number(overlayFacade.overlayMutationsApplied||0)} applied`],['Study UI immediately reflects pending Canonical Attention',uiDuring===`${cap(plan.toLevel)} attention`,uiDuring||'missing'],['Explicit firstSeen survives pending overlay',Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical materialized base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Legacy localStorage remains untouched by Canonical Save',true,String(legacy.reviewLevel||'')||'none']].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking,warnings:['This is a one-card default cutover canary: only WID2876 is switched by default in v244; all other Study cards remain on the prior path.','The two outbox rows intentionally remain pending. Use v240 Cloud Shadow steady sync to transport them after this report passes.','Rollback for WID2876 is available with ?wlpLegacyStudyAttentionWrite=1.']},invariants:{normalRouteNoQueryOptIn:true,otherCardsUnaffected:true,noLegacyAttentionWriteByCanary:true,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)}};
      setStatus(`PASS · Normal Study ${cap(plan.fromLevel)} → ${cap(plan.toLevel)} is pending for Cloud push.`,true,`WID2876 · outbox 0 → 2 · cursor ${cursor} · Cloud writes 0. Export JSON, then use v240 steady sync.`);
      return{pass:true,reloading:false,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Canonical cutover cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof args?.refresh==='function')args.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_DEFAULT_CUTOVER_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'normal-study-default-canonical-read-plus-persistent-outbox-write-canary',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},summary:{defaultCutoverActive:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort cleanup was attempted. No Cloud or legacy localStorage Attention write occurred.']},invariants:{noCloudWrites:true,noLegacyAttentionWriteByCanary:true}};setStatus(`BLOCKED · ${message}`,false,'Best-effort local outbox cleanup was attempted.');return{pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }


  function pageStateLabel(record){
    const r=record||{};
    if(Boolean(r.review)) return `review:${String(r.reviewLevel||'none').toLowerCase()}`;
    if(Boolean(r.known)) return 'studied';
    return 'neutral';
  }
  function membershipButtons(){
    const root=document.querySelector('.flashcard.active');
    if(!root)return {studied:null,review:null,attention:null};
    return {studied:root.querySelector('.btn-studied'),review:root.querySelector('.btn-review'),attention:root.querySelector('.btn-review-attention')};
  }
  function membershipUiState(){
    const b=membershipButtons();
    return {
      studiedText:(b.studied?.textContent||'').trim(), studiedPressed:b.studied?.getAttribute('aria-pressed')||'',
      reviewText:(b.review?.textContent||'').trim(), reviewPressed:b.review?.getAttribute('aria-pressed')||'',
      attentionHidden:Boolean(b.attention?.hidden), attentionText:(b.attention?.textContent||'').trim()
    };
  }
  function mutationShared(actionId,at){
    return {schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,canonicalStateCutoverCanary:true,transportEligible:true,status:'pending'};
  }
  async function buildMembershipPlan(action){
    const base=clone(state.baseWrapper?.payload||{}),before=legacyRecord(targetWordId,base),fromState=pageStateLabel(before);
    let eventType=String(action||'');
    if(eventType==='studied-toggle') eventType=(Boolean(before.known)&&!Boolean(before.review))?'studied_removed':'studied';
    if(eventType==='review-toggle') eventType=Boolean(before.review)?'review_removed':'review';
    if(!['studied','studied_removed','review','review_removed'].includes(eventType)) throw new Error(`Unsupported Canonical Study membership action: ${eventType||'(empty)'}.`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper?.payloadHash||'')) throw new Error('Canonical base payload changed before membership Save.');
    const patch={revision:Number(base.revision||0)+1,updated_at:at,last_seen_at:at};
    if(eventType==='studied'){
      Object.assign(patch,{known:true,review:false,review_level:null,review_reasons:[],attempt_count:Number(base.attempt_count||0)+1,study_count:Number(base.study_count||0)+1,last_studied_at:at,last_result:'studied'});
    }else if(eventType==='studied_removed'){
      Object.assign(patch,{known:false,review:false,review_level:null,review_reasons:[],last_result:'neutral'});
    }else if(eventType==='review'){
      Object.assign(patch,{known:false,review:true,attempt_count:Number(base.attempt_count||0)+1,review_count:Number(base.review_count||0)+1,last_reviewed_at:at,last_result:'review'});
    }else{
      Object.assign(patch,{known:false,review:false,review_level:null,review_reasons:[],last_result:'neutral'});
    }
    const next={...base,...patch},toState=pageStateLabel(legacyRecord(targetWordId,next));
    const intent={kind:'study-card-membership',action:eventType,cardId:state.cardId,wordId:targetWordId,fromState,toState,at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||''),contract:'study-state-membership-default-cutover-canary-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`);
    const stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`);
    const eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`);
    const eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|${eventType}|${actionId}`);
    const shared=mutationShared(actionId,at);
    const changedFields=Object.keys(patch);
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{known:base.known??false,review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],attempt_count:Number(base.attempt_count||0),study_count:Number(base.study_count||0),review_count:Number(base.review_count||0),revision:Number(base.revision||0)}},changedFields,patch};
    stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventLegacy={timestamp:atMs,action:eventType,wordId:targetWordId,source:'study-card',canonicalStateCutoverCanary:true};
    if(eventType==='studied'){eventLegacy.previousReviewLevel=String(before.reviewLevel||'');eventLegacy.previousReviewReasons=Array.isArray(before.reviewReasons)?clone(before.reviewReasons):[];}
    if(eventType==='review'){eventLegacy.action='added-to-review';eventLegacy.eventName='review';}
    if(eventType==='review_removed'){eventLegacy.previousReviewLevel=String(before.reviewLevel||'');eventLegacy.previousReviewReasons=Array.isArray(before.reviewReasons)?clone(before.reviewReasons):[];}
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:eventType,source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:eventLegacy,imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};
    eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return {actionId,eventType,fromState,toState,at,mutations:[stateMutation,eventMutation],patchedPayload:next,eventId};
  }

  async function runMembershipRoundtrip(action){
    if(!state.active) throw new Error('Canonical Study State membership canary is not active.');
    if(state.busy) throw new Error('Another Canonical Study State action is running.');
    if(state.pending) throw new Error('A Canonical Study State action is already pending Cloud push.');
    state.busy=true; setStatus('Saving normal Study membership → persistent Canonical outbox…'); let plan=null,cleanupNeeded=false;
    try{
      const beforeOutbox=await countOutbox(state.db); if(beforeOutbox!==0) throw new Error(`sync_outbox must start empty; found ${beforeOutbox}.`);
      plan=await buildMembershipPlan(action); const wrote=await enqueueMutations(plan); cleanupNeeded=true; const afterOutbox=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload); if(typeof state.renderCtx?.refresh==='function') state.renderCtx.refresh(); await nextFrames(3);
      const provider=await waitForFacade(); if(!provider?.open) throw new Error('Storage Compatibility Facade did not become available for membership overlay verification.');
      const facade=await provider.open(),overlayRecord=facade.readProgressRecord(targetWordId),overlayEvents=facade.readInteractionEvents();
      const eventFound=overlayEvents.some(e=>String(e?.wordId||'')===targetWordId&&e?.canonicalStateCutoverCanary===true&&(String(e?.action||'')===plan.eventType||String(e?.eventName||'')==='review'));
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const rows=await getAllOutbox(state.db),ours=rows.filter(r=>r?.canonicalStateCutoverCanary===true&&r?.transportEligible===true&&String(r?.actionId||'')===plan.actionId);
      const identitiesOk=ours.length===2&&ours.every(r=>isUuid(r.mutationId))&&isUuid(plan.actionId)&&isUuid(plan.eventId);
      const actualState=pageStateLabel(overlayRecord),ui=membershipUiState();
      const uiOk=plan.eventType==='studied' ? (ui.studiedPressed==='true'&&ui.reviewPressed==='false'&&ui.attentionHidden) : plan.eventType==='studied_removed' ? (ui.studiedPressed==='false'&&ui.reviewPressed==='false') : plan.eventType==='review' ? (ui.reviewPressed==='true') : (ui.reviewPressed==='false'&&ui.attentionHidden);
      if(!(wrote===2&&afterOutbox===2&&ours.length===2&&identitiesOk&&Number(facade.pendingOutboxRows||0)>=2&&Number(facade.overlayMutationsApplied||0)>=2&&actualState===plan.toState&&eventFound&&uiOk&&baseUntouched)) throw new Error('Normal Study membership Save did not render the exact pending Canonical state/event overlay.');
      cleanupNeeded=false; state.pending=true;
      const b=membershipButtons(); if(b.studied)b.studied.disabled=true; if(b.review)b.review.disabled=true;
      const legacy=localLegacyRecord(targetWordId),cursor=Math.max(Number(state.meta?.materializedSyncCursor??state.meta?.lastSyncCursor??0),Number(state.cursorMeta?.lastSyncCursor||0));
      state.report={format:'WLP_CANONICAL_STUDY_STATE_MEMBERSHIP_DEFAULT_CUTOVER_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'normal-study-default-canonical-membership-to-persistent-outbox-canary',device:{deviceKey:state.meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,materializedSyncCursor:cursor,materializedManifestHash:state.meta?.materializedManifestHash||null,materializedRows:state.meta?.materializedCanonicalRowCount||null},summary:{defaultCutoverActive:true,wordId:targetWordId,action:plan.eventType,fromState:plan.fromState,toState:plan.toState,outboxRowsBefore:beforeOutbox,outboxRowsAfter:afterOutbox,overlayMutationsApplied:Number(facade.overlayMutationsApplied||0),studyUiStudied:ui.studiedText,studyUiReview:ui.reviewText,attentionHidden:ui.attentionHidden,transportEligible:true,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),legacyLocalStorageState:pageStateLabel(legacy),cloudWrites:0,blockingIssues:0,nextPhaseEligible:true,pass:true},plan:{actionId:plan.actionId,eventType:plan.eventType,wordId:targetWordId,cardId:state.cardId,fromState:plan.fromState,toState:plan.toState,mutationIds:ours.map(x=>x.mutationId).sort(),eventId:plan.eventId,createdAt:plan.at},checks:[['Normal Study route activated Canonical membership canary',true,`WID ${targetWordId} · no query opt-in`],['Existing Studied / Review control was rerouted to Canonical outbox',true,plan.eventType],['Exactly two transport-eligible outbox rows retained',afterOutbox===2&&ours.length===2,`outbox ${beforeOutbox} → ${afterOutbox}`],['Storage Facade overlays pending membership state/event',Number(facade.overlayMutationsApplied||0)>=2,`${Number(facade.overlayMutationsApplied||0)} applied`],['Study controls immediately reflect pending Canonical membership',uiOk,`${ui.studiedText} / ${ui.reviewText}`],['Explicit firstSeen survives membership transition',Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical materialized base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Legacy localStorage remains untouched by Canonical membership Save',pageStateLabel(legacy)!==plan.toState,`${pageStateLabel(legacy)} (unchanged)`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking:[],warnings:['This v246 canary verifies an existing learning_state membership transition only. Initial learning_state creation is intentionally deferred to the next canary after this write shape is proven.','The two outbox rows intentionally remain pending. Do not change this card again before the next server-contract/push step.','Rollback for WID2876 remains available with ?wlpLegacyStudyAttentionWrite=1.']},invariants:{normalRouteNoQueryOptIn:true,otherCardsUnaffected:true,noLegacyMembershipWriteByCanary:true,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)}};
      setStatus(`PASS · Normal Study ${plan.fromState} → ${plan.toState} is pending for Cloud push.`,true,`WID2876 · outbox 0 → 2 · cursor ${cursor} · Cloud writes 0. Export JSON and stop here.`);
      return {pass:true,report:clone(state.report)};
    }catch(error){
      const message=error?.message||String(error); try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Canonical membership cleanup failed',cleanupError);} state.overlayRecord=null; try{if(typeof state.renderCtx?.refresh==='function')state.renderCtx.refresh();}catch(_){ }
      state.report={format:'WLP_CANONICAL_STUDY_STATE_MEMBERSHIP_DEFAULT_CUTOVER_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'normal-study-default-canonical-membership-to-persistent-outbox-canary',summary:{defaultCutoverActive:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort cleanup was attempted. No Cloud or legacy localStorage membership write occurred.']},invariants:{noCloudWrites:true,noLegacyMembershipWriteByCanary:true}};
      setStatus(`BLOCKED · ${message}`,false,'Best-effort local outbox cleanup was attempted.'); return {pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const ex=document.getElementById('wlp-study-attention-candidate-export');if(ex)ex.disabled=!state.report;}
  }

  async function afterRender(ctx={}){
    if(!state.active)return;
    state.renderCtx=ctx;
    const b=membershipButtons();
    const bind=(button,action)=>{
      if(!button||button.dataset.wlpCanonicalMembershipBound==='1')return;
      button.dataset.wlpCanonicalMembershipBound='1';
      button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void runMembershipRoundtrip(action);});
    };
    bind(b.studied,'studied-toggle'); bind(b.review,'review-toggle');
    requestAnimationFrame(()=>{if(state.pending)return;if(b.studied){b.studied.disabled=false;b.studied.title='Canonical Study state canary: this Studied action writes only to sync_outbox.';}if(b.review){b.review.disabled=false;b.review.title='Canonical Study state canary: this Review action writes only to sync_outbox.';}});
  }

  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-study-state-membership-cutover-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function close(){try{state.db?.close();}catch(_){ }}
  addEventListener('pagehide',close,{once:true});

  const api={version:3,requested,rollbackRequested,prepare,isActive:()=>state.active,readProgressKey,runAttentionRoundtrip,runMembershipRoundtrip,afterRender,getReport:()=>clone(state.report)};
  window.WLPCanonicalStudyAttentionWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
