/* WLP v1.8.6.252 — Canonical Attention follow-up canary.
   WID6537 must already have the synced v251 Review learning_state created at cursor 12+.
   Normal Study continues to read Canonical state; Set attention → Medium writes one
   production-shaped learning_state patch + learning_events append to sync_outbox.
   Studied / Review membership remain locked for this canary; all other cards are unchanged.
   Rollback for WID6537: ?wlpLegacyStudyAttentionWrite=1
   No Cloud write is performed here; steady-sync transports the retained outbox pair. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.252-attention-followup-canary-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state', CARD_STORE='cards', EVENT_STORE='learning_events';
  const META_KEY='authority_mirror', CURSOR_KEY='sync_cursor';
  const PROGRESS_PREFIX='fc:wordid:';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BOOTSTRAP={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const params=new URLSearchParams(location.search);
  const targetWordId=String(params.get('wordid')||'').trim();
  const rollbackRequested=params.get('wlpLegacyStudyAttentionWrite')==='1';
  const requested=targetWordId==='6537' && !rollbackRequested;
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
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Canonical cutover blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE,CARD_STORE,EVENT_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Canonical cutover blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Canonical cutover IndexedDB open is blocked by another page.'));});}
  async function getMeta(db,key){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(key));await transactionDone(tx);return row||null;}
  async function getStateRow(db,cardId){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function getCardRow(db,cardId){const tx=db.transaction(CARD_STORE,'readonly'),row=await requestPromise(tx.objectStore(CARD_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function findCreationEvent(db,cardId){const tx=db.transaction(EVENT_STORE,'readonly'),rows=await requestPromise(tx.objectStore(EVENT_STORE).getAll());await transactionDone(tx);return (Array.isArray(rows)?rows:[]).find(row=>String(row?.payload?.card_id||'')===cardId&&Number(row?.payload?.legacy_word_id||0)===Number(targetWordId)&&String(row?.payload?.event_type||'')==='review'&&row?.payload?.payload?.canonicalStateCreationCanary===true)||null;}
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
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Study State · Attention follow-up canary</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing synced Review state…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){const el=document.getElementById('wlp-study-attention-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}const d=document.getElementById('wlp-study-attention-candidate-detail');if(d)d.textContent=detail;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=state.busy||!state.report;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const db=await openDb(),meta=await getMeta(db,META_KEY),cursorMeta=await getMeta(db,CURSOR_KEY),outbox=await countOutbox(db),cardId=await cardIdForWordId(targetWordId),stateRow=await getStateRow(db,cardId),cardRow=await getCardRow(db,cardId);
      if(String(meta?.candidateKey||'')!==BOOTSTRAP.candidateKey||Number(meta?.headVersion||0)!==BOOTSTRAP.headVersion||String(meta?.migrationVersion||'')!==BOOTSTRAP.migrationVersion||String(meta?.snapshotManifestHash||'')!==BOOTSTRAP.manifestHash||Number(meta?.canonicalRowCount||0)!==BOOTSTRAP.canonicalRows){db.close();throw new Error('Attention follow-up canary requires the exact ACTIVE Authority-v3 bootstrap mirror.');}
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      if(cursor<12){db.close();throw new Error(`Attention follow-up canary requires the completed v251 roundtrip at cursor 12 or later; found ${cursor}.`);}
      if(outbox!==0){db.close();throw new Error(`Attention follow-up canary requires an empty sync_outbox; found ${outbox} pending row(s).`);}
      if(!cardRow||!stateRow){db.close();throw new Error(`WID ${targetWordId} synced card/state rows are required.`);}
      const cardPayload=clone(cardRow.payload||{}),cardHash=await sha256(stableStringify(cardPayload));
      if(cardHash!==String(cardRow.payloadHash||'')||String(cardPayload.word_id||'')!==targetWordId){db.close();throw new Error(`WID ${targetWordId} Canonical card identity/hash mismatch.`);}
      const base=clone(stateRow.payload||{}),hash=await sha256(stableStringify(base)),creationEvent=await findCreationEvent(db,cardId);
      if(hash!==String(stateRow.payloadHash||'')||String(base.card_id||'')!==cardId){db.close();throw new Error(`WID ${targetWordId} Canonical learning_state identity/hash mismatch.`);}
      if(!creationEvent){db.close();throw new Error(`WID ${targetWordId} synced v251 Review creation event is missing.`);}
      if(Boolean(base.known)||!Boolean(base.review)||String(base.review_level||'')||!Number.isFinite(Date.parse(base.first_seen_at||''))||Number(base.revision||0)<1){db.close();throw new Error(`WID ${targetWordId} must be the synced Review:none state created by v251.`);}
      const legacy=localLegacyRecord(targetWordId),legacyMembershipNeutral=!Boolean(legacy.known)&&!Boolean(legacy.review)&&!String(legacy.reviewLevel||'')&&(!Array.isArray(legacy.reviewReasons)||legacy.reviewReasons.length===0);
      if(!legacyMembershipNeutral){db.close();throw new Error(`WID ${targetWordId} legacy membership is not neutral; Attention follow-up refuses to mix authorities.`);}
      state.db=db;state.meta=meta;state.cursorMeta=cursorMeta;state.cardId=cardId;state.baseWrapper=clone(stateRow);state.baseRecord=legacyRecord(targetWordId,base);state.overlayRecord=null;state.active=true;state.prepareError='';
      setStatus('READY · Synced Canonical Review:none is ready for Attention.',null,`WID6537 · cursor ${cursor} · firstSeen ${state.baseRecord.firstSeen||0}. Open Set attention, choose Medium only, leave reasons unselected, then Save/Done once.`);
      return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'No Canonical or legacy Study write was performed.');return false;}
  }

  function readProgressKey(key){if(!state.active||!String(key||'').startsWith(PROGRESS_PREFIX))return null;const wid=String(key).slice(PROGRESS_PREFIX.length);if(wid!==targetWordId)return null;return clone(state.overlayRecord||state.baseRecord);}
  async function enqueueMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;const existing=await Promise.all(plan.mutations.map(m=>requestPromise(store.get(m.mutationId))));plan.mutations.forEach((m,i)=>{const row=existing[i];if(row){if(stableStringify(row)!==stableStringify(m))throw new Error('Canonical cutover mutation ID collision.');}else{store.add(clone(m));wrote++;}});await transactionDone(tx);return wrote;}
  async function cleanupMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of plan.mutations)store.delete(m.mutationId);await transactionDone(tx);}
  async function waitForFacade(){for(let i=0;i<40;i++){const p=window.WLPCanonicalStorageCompatibilityFacade;if(p?.open)return p;await new Promise(r=>setTimeout(r,25));}return null;}
  function attentionButtonText(){return (document.querySelector('.btn-review-attention:not([hidden]), .btn-review-attention-front:not([hidden])')?.textContent||'').trim();}

  async function buildPlan(level,reasons){
    const base=clone(state.baseWrapper.payload||{}),fromLevel=String(base.review_level||'').toLowerCase(),toLevel=String(level||'').toLowerCase();
    if(fromLevel)throw new Error(`Attention follow-up expects Review:none, found ${cap(fromLevel)}.`);
    if(toLevel!=='medium')throw new Error('For this canary choose Medium attention only.');
    const reasonList=Array.isArray(reasons)?clone(reasons):[];
    if(reasonList.length)throw new Error('For this canary leave Attention reasons unselected.');
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper.payloadHash||''))throw new Error('Canonical base payload changed before Attention Save.');
    const intent={kind:'study-card-attention-followup',direction:'default-canonical-cutover',cardId:state.cardId,wordId:targetWordId,fromLevel,toLevel,reasons:reasonList,at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||''),contract:'study-attention-followup-canary-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`),stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`),eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`),eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|attention_set|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,review_reasons:reasonList,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,canonicalCutoverCanary:true,canonicalAttentionFollowupCanary:true,transportEligible:true,status:'pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','review_reasons','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId:targetWordId,source:'study-card',level:toLevel,reasons:reasonList,fromLevel,canonicalCutoverCanary:true,canonicalAttentionFollowupCanary:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,fromLevel,toLevel,at,eventId,mutations:[stateMutation,eventMutation],patchedPayload:{...base,...patch}};
  }

  async function runAttentionRoundtrip(args){
    if(!state.active)throw new Error('Canonical Attention follow-up canary is not active.');if(state.busy)throw new Error('Another Canonical Attention action is running.');if(state.pending)throw new Error('Attention follow-up mutation is already pending.');
    state.busy=true;setStatus('Saving Review:none → Medium Attention to persistent Canonical outbox…');let plan=null,cleanupNeeded=false;
    try{
      const before=await countOutbox(state.db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      plan=await buildPlan(args?.level,args?.reasons);const wrote=await enqueueMutations(plan);cleanupNeeded=true;const during=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload);if(typeof args?.refresh==='function')args.refresh();await nextFrames(3);
      const uiDuring=attentionButtonText(),provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade did not become available for Canonical overlay verification.');
      const overlayFacade=await provider.open(),overlayRecord=overlayFacade.readProgressRecord(targetWordId),overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')==='attention_set'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.canonicalAttentionFollowupCanary===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const rows=await getAllOutbox(state.db),ours=rows.filter(r=>r?.canonicalAttentionFollowupCanary===true&&r?.transportEligible===true&&String(r?.actionId||'')===plan.actionId);
      const identitiesOk=ours.length===2&&ours.every(r=>isUuid(r.mutationId))&&isUuid(plan.actionId)&&isUuid(plan.eventId);
      const firstSeenPreserved=Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0);
      const overlayOk=Boolean(wrote===2&&during===2&&ours.length===2&&identitiesOk&&Number(overlayFacade.pendingOutboxRows||0)>=2&&Number(overlayFacade.overlayMutationsApplied||0)>=2&&Boolean(overlayRecord.review)&&String(overlayRecord.reviewLevel||'').toLowerCase()==='medium'&&firstSeenPreserved&&eventFound&&uiDuring==='Medium attention');
      if(!overlayOk||!baseUntouched)throw new Error(!overlayOk?'Normal Study Attention Save did not render the exact pending Canonical overlay.':'Canonical learning_state base changed during local outbox creation.');
      const legacy=localLegacyRecord(targetWordId),legacyMembershipNeutral=!Boolean(legacy.known)&&!Boolean(legacy.review)&&!String(legacy.reviewLevel||'')&&(!Array.isArray(legacy.reviewReasons)||legacy.reviewReasons.length===0),cursor=Math.max(Number(state.meta?.materializedSyncCursor??state.meta?.lastSyncCursor??0),Number(state.cursorMeta?.lastSyncCursor||0));
      const checks=[['Synced v251 Review:none state was used as the Attention base',Boolean(state.baseRecord.review)&&!String(state.baseRecord.reviewLevel||''),`review:${state.baseRecord.reviewLevel||'none'} · revision ${Number(state.baseWrapper?.payload?.revision||0)}`],['Exactly two transport-eligible outbox rows retained',during===2&&ours.length===2,`outbox ${before} → ${during}`],['Production action/mutation/event identities are UUIDs',identitiesOk,`${plan.actionId} · ${ours.length} mutations`],['Storage Facade overlays pending Medium Attention state/event',Number(overlayFacade.overlayMutationsApplied||0)>=2&&eventFound,`${Number(overlayFacade.overlayMutationsApplied||0)} applied`],['Study UI immediately reflects pending Canonical Attention',uiDuring==='Medium attention',uiDuring||'missing'],['Explicit firstSeen survives the Attention patch',firstSeenPreserved,String(overlayRecord.firstSeen||0)],['Canonical materialized base remains immutable until steady sync',baseUntouched,'learning_state wrapper unchanged'],['Legacy localStorage membership/attention remains neutral',legacyMembershipNeutral,`review=${Boolean(legacy.review)} · level=${String(legacy.reviewLevel||'none')}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));
      const blocking=checks.filter(x=>!x.pass).map(x=>x.name);
      state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_FOLLOWUP_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'synced-initial-review-to-medium-attention-persistent-outbox-canary',device:{deviceKey:state.meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,materializedSyncCursor:cursor,materializedManifestHash:state.meta?.materializedManifestHash||null,materializedRows:state.meta?.materializedCanonicalRowCount||null},summary:{attentionFollowupCanaryActive:true,wordId:targetWordId,fromLevel:'none',toLevel:'medium',outboxRowsBefore:before,outboxRowsAfter:during,overlayMutationsApplied:Number(overlayFacade.overlayMutationsApplied||0),studyUiAttention:uiDuring,transportEligible:true,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved,legacyMembershipNeutral,cloudWrites:0,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,wordId:targetWordId,cardId:state.cardId,fromLevel:'none',toLevel:'medium',mutationIds:ours.map(x=>x.mutationId).sort(),eventId:plan.eventId,createdAt:plan.at},checks,issues:{blocking,warnings:['This v252 canary proves Attention as a follow-up patch after a newly created Review state; it does not generalize Study state writes to every card yet.','The two outbox rows intentionally remain pending. Do not change WID6537 again before steady sync transports them.','No Supabase SQL change is required from v251; the existing incremental apply contract already supports attention_set patches.']},invariants:{normalRouteNoQueryOptIn:true,otherCardsUnaffected:true,noLegacyAttentionWriteByCanary:legacyMembershipNeutral,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:firstSeenPreserved}};
      if(blocking.length)throw new Error(`Canary report check failed: ${blocking.join('; ')}`);
      cleanupNeeded=false;state.pending=true;setStatus('PASS · Review:none → Medium Attention is pending for Cloud push.',true,`WID6537 · outbox 0 → 2 · cursor ${cursor} · firstSeen preserved · Cloud writes 0. Export JSON and stop here.`);if(typeof args?.refresh==='function')args.refresh();await nextFrames(2);afterRender(state.renderCtx||{});
      return{pass:true,reloading:false,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Canonical Attention cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof args?.refresh==='function')args.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_FOLLOWUP_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'synced-initial-review-to-medium-attention-persistent-outbox-canary',summary:{attentionFollowupCanaryActive:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort outbox cleanup was attempted. No Cloud or legacy localStorage Attention write occurred.']},invariants:{noCloudWrites:true,noLegacyAttentionWriteByCanary:true}};setStatus(`BLOCKED · ${message}`,false,'Best-effort local outbox cleanup was attempted.');return{pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }

  async function runMembershipRoundtrip(){throw new Error('v252 locks Studied/Review membership; only the Attention follow-up is enabled.');}
  async function afterRender(ctx={}){
    if(!state.active||String(ctx?.wordId||'')!==targetWordId)return;state.renderCtx=ctx;
    requestAnimationFrame(()=>{
      const root=document.querySelector('.flashcard.active');if(!root)return;
      root.querySelectorAll('.btn-studied,.btn-studied-front,.btn-review,.btn-review-front').forEach(b=>{b.disabled=true;b.title='Canonical Attention follow-up canary: membership changes are locked.';});
      root.querySelectorAll('.btn-review-attention,.btn-review-attention-front').forEach(b=>{b.disabled=Boolean(state.pending);b.title=state.pending?'Canonical Attention follow-up is pending Cloud sync.':'Canonical Attention follow-up canary: choose Medium only and leave reasons unselected.';});
    });
  }

  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-study-attention-followup-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function close(){try{state.db?.close();}catch(_){ }}
  addEventListener('pagehide',close,{once:true});

  const api={version:6,requested,rollbackRequested,prepare,isActive:()=>state.active,readProgressKey,runAttentionRoundtrip,runMembershipRoundtrip,afterRender,getReport:()=>clone(state.report)};
  window.WLPCanonicalStudyAttentionWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
