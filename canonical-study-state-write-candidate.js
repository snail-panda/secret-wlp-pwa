/* WLP v1.8.6.255 — Canonical Studied removal follow-up canary.
   WID6538 must already be synced through v250 as Studied; current device cursor must be 16+.
   Normal Study reads Canonical state; tapping Studied once writes one production-shaped
   learning_state patch + one studied_removed learning_events append to sync_outbox.
   Review and Attention are locked for this canary; all other cards are unchanged.
   Rollback for WID6538: ?wlpLegacyStudyAttentionWrite=1
   No Cloud write is performed here; steady-sync transports the retained outbox pair. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.255-studied-removal-followup-canary-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state', CARD_STORE='cards', EVENT_STORE='learning_events';
  const META_KEY='authority_mirror', CURSOR_KEY='sync_cursor';
  const PROGRESS_PREFIX='fc:wordid:';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BOOTSTRAP={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const params=new URLSearchParams(location.search);
  const targetWordId=String(params.get('wordid')||'').trim();
  const rollbackRequested=params.get('wlpLegacyStudyAttentionWrite')==='1';
  const requested=targetWordId==='6538' && !rollbackRequested;
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
  async function findStudiedCreateEvent(db,cardId){const tx=db.transaction(EVENT_STORE,'readonly'),rows=await requestPromise(tx.objectStore(EVENT_STORE).getAll());await transactionDone(tx);return (Array.isArray(rows)?rows:[]).find(row=>String(row?.payload?.card_id||'')===cardId&&Number(row?.payload?.legacy_word_id||0)===Number(targetWordId)&&String(row?.payload?.event_type||'')==='studied'&&row?.payload?.payload?.canonicalStateCreationCanary===true)||null;}
  async function countOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),n=await requestPromise(tx.objectStore(OUTBOX_STORE).count());await transactionDone(tx);return Number(n||0);}
  async function getAllOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),rows=await requestPromise(tx.objectStore(OUTBOX_STORE).getAll());await transactionDone(tx);return Array.isArray(rows)?rows:[];}
  async function cardIdForWordId(wordId){return uuidV5(CARD_NAMESPACE_UUID,`card|wid:${String(wordId||'').trim()}`);}
  function ms(v){if(v==null||v==='')return 0;const n=Date.parse(v);return Number.isFinite(n)?n:0;}
  function legacyRecord(wordId,payload){const p=payload||{};return{wordId:String(wordId||''),known:p.known??false,review:Boolean(p.review),studied:Boolean(p.studied),reviewLevel:String(p.review_level||''),reviewReasons:Array.isArray(p.review_reasons)?clone(p.review_reasons):[],attempts:Number(p.attempt_count||0),studyCount:Number(p.study_count||0),reviewCount:Number(p.review_count||0),exposureCount:Number(p.exposure_count||0),lastResult:p.last_result??null,lastSeen:ms(p.last_seen_at),firstSeen:ms(p.first_seen_at),lastStudied:ms(p.last_studied_at),lastReviewed:ms(p.last_reviewed_at),lastAttentionUpdated:ms(p.last_attention_updated_at)};}
  function localLegacyRecord(wordId){try{return JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`)||'{}');}catch(_){return{};}}
  function legacyMembershipNeutral(record){const r=record||{};return !Boolean(r.known)&&!Boolean(r.review)&&!String(r.reviewLevel||'')&&(!Array.isArray(r.reviewReasons)||r.reviewReasons.length===0);}
  function pageStateLabel(record){const r=record||{};if(Boolean(r.review))return `review:${String(r.reviewLevel||'none').toLowerCase()}`;if(Boolean(r.known))return 'studied';return 'neutral';}
  function nextFrames(n=2){return new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}

  function makePanel(){
    if(!requested||document.getElementById('wlp-study-attention-candidate-box'))return;
    const box=document.createElement('section');box.id='wlp-study-attention-candidate-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(360px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Study State · Studied removal canary</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing synced Studied state…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){const el=document.getElementById('wlp-study-attention-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}const d=document.getElementById('wlp-study-attention-candidate-detail');if(d)d.textContent=detail;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=state.busy||!state.report;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const db=await openDb(),meta=await getMeta(db,META_KEY),cursorMeta=await getMeta(db,CURSOR_KEY),outbox=await countOutbox(db),cardId=await cardIdForWordId(targetWordId),stateRow=await getStateRow(db,cardId),cardRow=await getCardRow(db,cardId);
      if(String(meta?.candidateKey||'')!==BOOTSTRAP.candidateKey||Number(meta?.headVersion||0)!==BOOTSTRAP.headVersion||String(meta?.migrationVersion||'')!==BOOTSTRAP.migrationVersion||String(meta?.snapshotManifestHash||'')!==BOOTSTRAP.manifestHash||Number(meta?.canonicalRowCount||0)!==BOOTSTRAP.canonicalRows){db.close();throw new Error('Studied removal canary requires the exact ACTIVE Authority-v3 bootstrap mirror.');}
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      if(cursor<16){db.close();throw new Error(`Studied removal canary requires the completed v254 roundtrip at cursor 16 or later; found ${cursor}.`);}
      if(outbox!==0){db.close();throw new Error(`Studied removal canary requires an empty sync_outbox; found ${outbox} pending row(s).`);}
      if(!cardRow||!stateRow){db.close();throw new Error(`WID ${targetWordId} synced card/state rows are required.`);}
      const cardPayload=clone(cardRow.payload||{}),cardHash=await sha256(stableStringify(cardPayload));
      if(cardHash!==String(cardRow.payloadHash||'')||String(cardPayload.word_id||'')!==targetWordId){db.close();throw new Error(`WID ${targetWordId} Canonical card identity/hash mismatch.`);}
      const base=clone(stateRow.payload||{}),hash=await sha256(stableStringify(base)),studiedEvent=await findStudiedCreateEvent(db,cardId);
      if(hash!==String(stateRow.payloadHash||'')||String(base.card_id||'')!==cardId){db.close();throw new Error(`WID ${targetWordId} Canonical learning_state identity/hash mismatch.`);}
      if(!studiedEvent){db.close();throw new Error(`WID ${targetWordId} synced v250 initial Studied event is missing.`);}
      if(!Boolean(base.known)||Boolean(base.review)||base.review_level!=null||!Number.isFinite(Date.parse(base.first_seen_at||''))||Number(base.revision||0)<1){db.close();throw new Error(`WID ${targetWordId} must be the synced Studied state produced by v250.`);}
      const legacy=localLegacyRecord(targetWordId);if(!legacyMembershipNeutral(legacy)){db.close();throw new Error(`WID ${targetWordId} legacy membership/attention is not neutral; Studied removal refuses to mix authorities.`);}
      state.db=db;state.meta=meta;state.cursorMeta=cursorMeta;state.cardId=cardId;state.baseWrapper=clone(stateRow);state.baseRecord=legacyRecord(targetWordId,base);state.overlayRecord=null;state.active=true;state.prepareError='';
      setStatus('READY · Synced Canonical Studied is ready for removal.',null,`WID6538 · cursor ${cursor} · firstSeen ${state.baseRecord.firstSeen||0}. Tap Studied once to remove it. Do not use Review or Set attention.`);
      return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'No Canonical or legacy Study write was performed.');return false;}
  }

  function readProgressKey(key){if(!state.active||!String(key||'').startsWith(PROGRESS_PREFIX))return null;const wid=String(key).slice(PROGRESS_PREFIX.length);if(wid!==targetWordId)return null;return clone(state.overlayRecord||state.baseRecord);}
  async function enqueueMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;const existing=await Promise.all(plan.mutations.map(m=>requestPromise(store.get(m.mutationId))));plan.mutations.forEach((m,i)=>{const row=existing[i];if(row){if(stableStringify(row)!==stableStringify(m))throw new Error('Canonical cutover mutation ID collision.');}else{store.add(clone(m));wrote++;}});await transactionDone(tx);return wrote;}
  async function cleanupMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of plan.mutations)store.delete(m.mutationId);await transactionDone(tx);}
  async function waitForFacade(){for(let i=0;i<40;i++){const p=window.WLPCanonicalStorageCompatibilityFacade;if(p?.open)return p;await new Promise(r=>setTimeout(r,25));}return null;}
  function membershipButtons(){const root=document.querySelector('.flashcard.active');if(!root)return{studied:null,review:null,attention:null};return{studied:root.querySelector('.btn-studied'),review:root.querySelector('.btn-review'),attention:root.querySelector('.btn-review-attention')};}
  function membershipUiState(){const b=membershipButtons();return{studiedText:(b.studied?.textContent||'').trim(),studiedPressed:b.studied?.getAttribute('aria-pressed')||'',reviewText:(b.review?.textContent||'').trim(),reviewPressed:b.review?.getAttribute('aria-pressed')||'',attentionHidden:Boolean(b.attention?.hidden),attentionText:(b.attention?.textContent||'').trim()};}

  function mutationShared(actionId,at){return{schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,canonicalStateCutoverCanary:true,canonicalStudiedRemovalCanary:true,transportEligible:true,status:'pending'};}
  async function buildPlan(action){
    if(String(action||'')!=='studied-toggle')throw new Error('This canary only allows the Studied removal action.');
    const base=clone(state.baseWrapper?.payload||{}),before=legacyRecord(targetWordId,base),fromState=pageStateLabel(before);
    if(fromState!=='studied')throw new Error(`Studied removal expects studied, found ${fromState}.`);
    const eventType='studied_removed',at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper?.payloadHash||''))throw new Error('Canonical base payload changed before Studied removal.');
    const patch={revision:Number(base.revision||0)+1,updated_at:at,last_seen_at:at,known:false,review:false,review_level:null,review_reasons:[],last_result:'neutral'};
    const next={...base,...patch},toState=pageStateLabel(legacyRecord(targetWordId,next));
    if(toState!=='neutral')throw new Error(`Studied removal produced unexpected state ${toState}.`);
    const intent={kind:'study-card-membership',action:eventType,cardId:state.cardId,wordId:targetWordId,fromState,toState,at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||''),contract:'study-studied-removal-followup-canary-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`),stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`),eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`),eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|${eventType}|${actionId}`),shared=mutationShared(actionId,at);
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{known:base.known??false,review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],attempt_count:Number(base.attempt_count||0),study_count:Number(base.study_count||0),review_count:Number(base.review_count||0),revision:Number(base.revision||0)}},changedFields:Object.keys(patch),patch};
    stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:eventType,source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:{timestamp:atMs,action:eventType,wordId:targetWordId,source:'study-card',previousReviewLevel:String(before.reviewLevel||''),previousReviewReasons:Array.isArray(before.reviewReasons)?clone(before.reviewReasons):[],canonicalStateCutoverCanary:true,canonicalStudiedRemovalCanary:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};
    eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,eventType,fromState,toState,at,eventId,mutations:[stateMutation,eventMutation],patchedPayload:next};
  }

  async function runMembershipRoundtrip(action){
    if(!state.active)throw new Error('Canonical Studied removal canary is not active.');if(state.busy)throw new Error('Another Canonical membership action is running.');if(state.pending)throw new Error('Studied removal mutation is already pending.');
    state.busy=true;setStatus('Saving Studied → neutral to persistent Canonical outbox…');let plan=null,cleanupNeeded=false;
    try{
      const before=await countOutbox(state.db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      plan=await buildPlan(action);const wrote=await enqueueMutations(plan);cleanupNeeded=true;const during=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload);if(typeof state.renderCtx?.refresh==='function')state.renderCtx.refresh();await nextFrames(3);
      const provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade did not become available for Canonical overlay verification.');
      const facade=await provider.open(),overlayRecord=facade.readProgressRecord(targetWordId),overlayEvents=facade.readInteractionEvents();
      const eventFound=overlayEvents.some(e=>String(e?.action||'')==='studied_removed'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.canonicalStudiedRemovalCanary===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const rows=await getAllOutbox(state.db),ours=rows.filter(r=>r?.canonicalStudiedRemovalCanary===true&&r?.transportEligible===true&&String(r?.actionId||'')===plan.actionId);
      const identitiesOk=ours.length===2&&ours.every(r=>isUuid(r.mutationId))&&isUuid(plan.actionId)&&isUuid(plan.eventId);
      const firstSeenPreserved=Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),actualState=pageStateLabel(overlayRecord),ui=membershipUiState();
      const uiOk=ui.studiedPressed==='false'&&ui.reviewPressed==='false'&&ui.attentionHidden;
      const legacy=localLegacyRecord(targetWordId),legacyNeutral=legacyMembershipNeutral(legacy);
      const checks=[['Synced v250 Studied state was used as the removal base',pageStateLabel(state.baseRecord)==='studied'&&Number(state.baseWrapper?.payload?.revision||0)>=1,`${pageStateLabel(state.baseRecord)} · revision ${Number(state.baseWrapper?.payload?.revision||0)}`],['Exactly two transport-eligible outbox rows retained',during===2&&ours.length===2,`outbox ${before} → ${during}`],['Production action/mutation/event identities are UUIDs',identitiesOk,`${plan.actionId} · ${ours.length} mutations`],['Storage Facade overlays pending neutral state/studied_removed event',Number(facade.pendingOutboxRows||0)>=2&&Number(facade.overlayMutationsApplied||0)>=2&&actualState==='neutral'&&eventFound,`${Number(facade.overlayMutationsApplied||0)} applied · ${actualState}`],['Study UI immediately reflects Studied removal',uiOk,`${ui.studiedText} / ${ui.reviewText} / attention hidden=${ui.attentionHidden}`],['Explicit firstSeen survives Studied removal',firstSeenPreserved,String(overlayRecord.firstSeen||0)],['Canonical materialized base remains immutable until steady sync',baseUntouched,'learning_state wrapper unchanged'],['Legacy localStorage membership/attention remains neutral',legacyNeutral,`review=${Boolean(legacy.review)} · level=${String(legacy.reviewLevel||'none')}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));
      const blocking=checks.filter(x=>!x.pass).map(x=>x.name),cursor=Math.max(Number(state.meta?.materializedSyncCursor??state.meta?.lastSyncCursor??0),Number(state.cursorMeta?.lastSyncCursor||0));
      state.report={format:'WLP_CANONICAL_STUDY_STUDIED_REMOVAL_FOLLOWUP_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'synced-studied-to-neutral-persistent-outbox-canary',device:{deviceKey:state.meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,materializedSyncCursor:cursor,materializedManifestHash:state.meta?.materializedManifestHash||null,materializedRows:state.meta?.materializedCanonicalRowCount||null},summary:{studiedRemovalCanaryActive:true,wordId:targetWordId,action:plan.eventType,fromState:plan.fromState,toState:plan.toState,outboxRowsBefore:before,outboxRowsAfter:during,overlayMutationsApplied:Number(facade.overlayMutationsApplied||0),studyUiStudied:ui.studiedText,studyUiReview:ui.reviewText,attentionHidden:ui.attentionHidden,transportEligible:true,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved,legacyMembershipNeutral:legacyNeutral,cloudWrites:0,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,eventType:plan.eventType,wordId:targetWordId,cardId:state.cardId,fromState:plan.fromState,toState:plan.toState,mutationIds:ours.map(x=>x.mutationId).sort(),eventId:plan.eventId,createdAt:plan.at},checks,issues:{blocking,warnings:['This v255 canary proves Studied removal from an existing Canonical learning_state. It does not generalize Study state writes to every card yet.','The two outbox rows intentionally remain pending. Do not change WID6538 again before steady sync transports them.','No Supabase SQL change is required from v251; the existing incremental apply contract already supports studied_removed patches.']},invariants:{normalRouteNoQueryOptIn:true,otherCardsUnaffected:true,noLegacyMembershipWriteByCanary:legacyNeutral,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:firstSeenPreserved}};
      if(blocking.length)throw new Error(`Canary report check failed: ${blocking.join('; ')}`);
      cleanupNeeded=false;state.pending=true;setStatus('PASS · Studied → neutral is pending for Cloud push.',true,`WID6538 · outbox 0 → 2 · cursor ${cursor} · firstSeen preserved · Cloud writes 0. Export JSON and stop here.`);if(typeof state.renderCtx?.refresh==='function')state.renderCtx.refresh();await nextFrames(2);afterRender(state.renderCtx||{});
      return{pass:true,reloading:false,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Canonical Studied removal cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof state.renderCtx?.refresh==='function')state.renderCtx.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_STUDY_STUDIED_REMOVAL_FOLLOWUP_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'synced-studied-to-neutral-persistent-outbox-canary',summary:{studiedRemovalCanaryActive:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort outbox cleanup was attempted. No Cloud or legacy localStorage membership write occurred.']},invariants:{noCloudWrites:true,noLegacyMembershipWriteByCanary:true}};setStatus(`BLOCKED · ${message}`,false,'Best-effort local outbox cleanup was attempted.');return{pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }

  async function runAttentionRoundtrip(){throw new Error('v255 locks Attention; only Studied removal is enabled.');}
  async function afterRender(ctx={}){
    if(!state.active||String(ctx?.wordId||'')!==targetWordId)return;state.renderCtx=ctx;
    const bind=(button)=>{if(!button||button.dataset.wlpCanonicalStudiedRemovalBound==='1')return;button.dataset.wlpCanonicalStudiedRemovalBound='1';button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void runMembershipRoundtrip('studied-toggle');});};
    requestAnimationFrame(()=>{
      const b=membershipButtons();if(state.pending){if(b.studied)b.studied.disabled=true;return;}
      bind(b.studied);
      if(b.studied){b.studied.disabled=false;b.studied.title='Canonical Studied removal canary: tap once to remove Studied.';}
      if(b.review){b.review.disabled=true;b.review.title='Canonical Studied removal canary: Review is locked.';}
      if(b.attention){b.attention.disabled=true;b.attention.title='Canonical Studied removal canary: Attention is locked.';}
    });
  }

  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-study-studied-removal-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function close(){try{state.db?.close();}catch(_){ }}
  addEventListener('pagehide',close,{once:true});

  const api={version:7,requested,rollbackRequested,prepare,isActive:()=>state.active,readProgressKey,runAttentionRoundtrip,runMembershipRoundtrip,afterRender,getReport:()=>clone(state.report)};
  window.WLPCanonicalStudyAttentionWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
