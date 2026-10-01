/* WLP v1.8.6.238 — iPhone-origin reverse-sync Study Attention source candidate.
   Query-gated by ?wlpCanonicalStudyAttentionWrite=1. Normal Study remains legacy.
   Intended after both devices have pulled ACTIVE Authority v3. On iPhone only, the
   existing Study-card Attention Save is rerouted into a production-shaped,
   transport-eligible two-row sync_outbox action. The action survives one real page
   reload and REMAINS pending for the next Cloud push step. No Cloud, localStorage,
   or Canonical base row is written in this step. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.238-iphone-reverse-sync-source-outbox-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror';
  const PROGRESS_PREFIX='fc:wordid:';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const EXPECTED={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const params=new URLSearchParams(location.search);
  const requested=params.get('wlpCanonicalStudyAttentionWrite')==='1';
  const reloadPhase=params.get('wlpReverseSyncReload')==='1';
  const targetWordId=String(params.get('wordid')||'').trim();
  const isIPhone=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  const state={active:false,busy:false,finalizing:false,db:null,meta:null,cardId:'',baseWrapper:null,baseRecord:null,overlayRecord:null,pendingPlan:null,report:null,prepareError:''};

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
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Reverse-sync candidate blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Reverse-sync candidate blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Reverse-sync candidate IndexedDB open is blocked by another page.'));});}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(META_KEY));await transactionDone(tx);return row||null;}
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
    box.innerHTML='<strong style="display:block;font-size:13px">iPhone reverse-sync source candidate</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing ACTIVE v3 card state…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button><a href="../../review.html?wlpCanonicalReviewWrite=1" style="align-self:center">Return to Review candidate</a></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){const el=document.getElementById('wlp-study-attention-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}const d=document.getElementById('wlp-study-attention-candidate-detail');if(d)d.textContent=detail;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=state.busy||!state.report;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      if(!isIPhone)throw new Error('This reverse-sync source step must be run on iPhone.');
      if(targetWordId!=='2876')throw new Error('This exact reverse-sync test requires WID2876 (conjure up).');
      const db=await openDb(),meta=await getMeta(db),outbox=await countOutbox(db),cardId=await cardIdForWordId(targetWordId),stateRow=await getStateRow(db,cardId);
      if(String(meta?.candidateKey||'')!==EXPECTED.candidateKey||Number(meta?.headVersion||0)!==EXPECTED.headVersion||String(meta?.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta?.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta?.canonicalRowCount||0)!==EXPECTED.canonicalRows){db.close();throw new Error('Reverse-sync candidate requires the exact ACTIVE Authority-v3 local mirror.');}
      if(!stateRow){db.close();throw new Error(`WID ${targetWordId} learning_state row is missing from the Canonical mirror.`);}
      const base=clone(stateRow.payload||{}),hash=await sha256(stableStringify(base));if(hash!==String(stateRow.payloadHash||'')){db.close();throw new Error(`WID ${targetWordId} Canonical base payload hash mismatch.`);}
      if(String(base.card_id||'')!==cardId){db.close();throw new Error(`WID ${targetWordId} Canonical card identity mismatch.`);}
      if(String(base.review_level||'').toLowerCase()!=='medium')throw new Error(`Reverse-sync base must be Medium; found ${cap(base.review_level||'none')}.`);
      state.db=db;state.meta=meta;state.cardId=cardId;state.baseWrapper=clone(stateRow);state.baseRecord=legacyRecord(targetWordId,base);state.overlayRecord=null;state.pendingPlan=null;state.active=true;state.prepareError='';

      if(reloadPhase){
        if(outbox!==2)throw new Error(`Reload verification requires exactly 2 pending transport rows; found ${outbox}.`);
        const rows=await getAllOutbox(db),ours=rows.filter(r=>r?.reverseSyncCandidate===true&&r?.persistentReloadTest===true&&r?.transportEligible===true&&String(r?.deviceKey||'')===String(meta?.deviceKey||''));
        if(ours.length!==2)throw new Error(`Reload verification could not identify the exact 2 reverse-sync rows; found ${ours.length}.`);
        const actionIds=[...new Set(ours.map(r=>String(r?.actionId||'')))];if(actionIds.length!==1||!isUuid(actionIds[0]))throw new Error('Reverse-sync rows do not share one production UUID action identity.');
        const stateMutation=ours.find(r=>r?.tableName==='learning_state'&&r?.mutationKind==='patch'&&String(r?.rowKey||'')===cardId),eventMutation=ours.find(r=>r?.tableName==='learning_events'&&r?.mutationKind==='append');
        if(!stateMutation||!eventMutation)throw new Error('Reload verification requires one learning_state patch and one learning_event append.');
        if(!isUuid(stateMutation.mutationId)||!isUuid(eventMutation.mutationId)||!isUuid(eventMutation.rowKey))throw new Error('Reverse-sync mutation/event identities are not production UUIDs.');
        if(String(stateMutation?.precondition?.payloadHash||'')!==String(stateRow.payloadHash||''))throw new Error('Reload verification state precondition no longer matches the Canonical v3 base.');
        const fromLevel=String(stateMutation?.precondition?.fields?.review_level||'').toLowerCase(),toLevel=String(stateMutation?.patch?.review_level||'').toLowerCase();
        if(fromLevel!=='medium'||toLevel!=='high')throw new Error(`Reverse-sync transition must be Medium → High; found ${cap(fromLevel)} → ${cap(toLevel)}.`);
        const overlayPayload={...base,...clone(stateMutation.patch||{})};
        state.overlayRecord=legacyRecord(targetWordId,overlayPayload);state.pendingPlan={actionId:actionIds[0],fromLevel,toLevel,mutations:clone(ours),createdAt:String(stateMutation.createdAt||'')};
        setStatus('RELOADED · Transport-eligible iPhone change survived.',null,'WID2876 · Medium → High · outbox 2. Waiting for the real Study UI to render. These two rows will remain pending for the next Cloud push step.');
        return true;
      }

      if(outbox!==0)throw new Error(`Reverse-sync source requires an empty sync_outbox before Save; found ${outbox} pending row(s).`);
      const legacy=localLegacyRecord(targetWordId),legacyLevel=String(legacy.reviewLevel||'').toLowerCase();
      const divergence=legacyLevel&&legacyLevel!=='medium'?` Legacy localStorage currently says ${cap(legacyLevel)}; it will not be changed.`:'';
      setStatus('READY · iPhone is reading ACTIVE Canonical v3.',null,`WID2876 · Canonical Medium.${divergence} Choose High attention and tap Save. The production-shaped outbox pair will survive one reload and remain pending for Cloud push.`);
      return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'No Study attention write is allowed on this candidate route.');return false;}
  }

  function readProgressKey(key){if(!state.active||!String(key||'').startsWith(PROGRESS_PREFIX))return null;const wid=String(key).slice(PROGRESS_PREFIX.length);if(wid!==targetWordId)return null;return clone(state.overlayRecord||state.baseRecord);}
  async function enqueueMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;const existing=await Promise.all(plan.mutations.map(m=>requestPromise(store.get(m.mutationId))));plan.mutations.forEach((m,i)=>{const row=existing[i];if(row){if(stableStringify(row)!==stableStringify(m))throw new Error('Reverse-sync mutation ID collision.');}else{store.add(clone(m));wrote++;}});await transactionDone(tx);return wrote;}
  async function cleanupMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of plan.mutations)store.delete(m.mutationId);await transactionDone(tx);}
  async function waitForFacade(){for(let i=0;i<30;i++){const p=window.WLPCanonicalStorageCompatibilityFacade;if(p?.open)return p;await new Promise(r=>setTimeout(r,25));}return null;}
  function attentionButtonText(){return (document.querySelector('.btn-review-attention:not([hidden]), .btn-review-attention-front:not([hidden])')?.textContent||'').trim();}

  async function buildPlan(level,reasons){
    const base=clone(state.baseWrapper.payload||{}),fromLevel=String(base.review_level||'').toLowerCase(),toLevel=String(level||'').toLowerCase();
    if(fromLevel!=='medium')throw new Error(`Reverse-sync base must still be Medium; found ${cap(fromLevel)}.`);
    if(toLevel!=='high')throw new Error('For this reverse-direction test, choose High attention before Save.');
    if(!Boolean(base.review))throw new Error(`WID ${targetWordId} is not currently in Canonical Review.`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper.payloadHash||''))throw new Error('Canonical v3 base payload changed before reverse-sync Save.');
    const intent={kind:'study-card-attention-save',direction:'iphone-to-cloud-to-pc',cardId:state.cardId,wordId:targetWordId,fromLevel,toLevel,reasons:Array.isArray(reasons)?clone(reasons):[],at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||''),contract:'reverse-sync-source-v1'};
    const actionId=await uuidV5(CARD_NAMESPACE_UUID,`sync-action|${await sha256(stableStringify(intent))}`),stateMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_state|${actionId}`),eventMutationId=await uuidV5(CARD_NAMESPACE_UUID,`sync-mutation|learning_events|${actionId}`),eventId=await uuidV5(CARD_NAMESPACE_UUID,`sync-event|attention_set|${actionId}`);
    const reasonList=Array.isArray(reasons)?clone(reasons):[];
    const patch={known:false,review:true,review_level:toLevel,review_reasons:reasonList,last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:false,candidateOnly:false,reverseSyncCandidate:true,persistentReloadTest:true,transportEligible:true,status:'pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','review_reasons','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId:targetWordId,source:'study-card',level:toLevel,reasons:reasonList,fromLevel,reverseSyncCandidate:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,fromLevel,toLevel,at,mutations:[stateMutation,eventMutation],patchedPayload:{...base,...patch}};
  }

  async function runAttentionRoundtrip(args){
    if(!state.active)throw new Error('iPhone reverse-sync source candidate is not active.');if(reloadPhase)throw new Error('Reload verification is already in progress.');if(state.busy)throw new Error('Another reverse-sync action is running.');
    state.busy=true;setStatus('Saving iPhone Study Attention → transport-eligible local outbox…');let plan=null,cleanupNeeded=false;
    try{
      const before=await countOutbox(state.db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      plan=await buildPlan(args?.level,args?.reasons);const wrote=await enqueueMutations(plan);cleanupNeeded=true;const during=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload);if(typeof args?.refresh==='function')args.refresh();await nextFrames(3);
      const uiDuring=attentionButtonText(),provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade did not become available for reverse-sync overlay verification.');
      const overlayFacade=await provider.open(),overlayRecord=overlayFacade.readProgressRecord(targetWordId),overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')==='attention_set'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.reverseSyncCandidate===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const productionIds=plan.mutations.every(m=>isUuid(m.mutationId))&&isUuid(plan.actionId)&&isUuid(plan.mutations.find(m=>m.tableName==='learning_events')?.rowKey);
      const overlayOk=Boolean(wrote===2&&during===2&&productionIds&&Number(overlayFacade.pendingOutboxRows||0)===2&&Number(overlayFacade.overlayMutationsApplied||0)>=2&&String(overlayRecord.reviewLevel||'')==='high'&&Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)&&eventFound&&uiDuring==='High attention');
      if(!overlayOk||!baseUntouched)throw new Error(!overlayOk?'iPhone Study Save did not render the exact pending High overlay.':'Canonical v3 learning_state base changed during reverse-sync source creation.');
      cleanupNeeded=false;
      setStatus('PERSISTED · iPhone pending action is ready. Reloading once…',true,'WID2876 · Medium → High · outbox 0 → 2. The next page load must reconstruct High and keep both rows pending for Cloud push.');
      const nextUrl=new URL(location.href);nextUrl.searchParams.set('wlpReverseSyncReload','1');history.replaceState(null,'',nextUrl.toString());
      setTimeout(()=>location.reload(),250);
      return{pass:true,reloading:true};
    }catch(error){const message=error?.message||String(error);try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Reverse-sync cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof args?.refresh==='function')args.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_IPHONE_REVERSE_SYNC_SOURCE_OUTBOX',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'iphone-study-attention-to-persistent-transport-eligible-outbox',device:{platform:isIPhone?'iPhone Safari/WebKit':'Windows Browser'},summary:{requested:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort cleanup was attempted after source creation failure. No Cloud or legacy localStorage write occurred.']},invariants:{noCloudWrites:true,noLegacyAttentionWriteByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'No Cloud write occurred; best-effort local outbox cleanup was attempted.');return{pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }

  async function afterRender(args){
    if(!reloadPhase||!state.active||!state.pendingPlan||state.report||state.finalizing)return;
    state.finalizing=true;setStatus('VERIFYING · iPhone Study UI is rebuilding from persistent pending outbox…');
    const plan=state.pendingPlan;
    try{
      await nextFrames(3);
      const pendingCount=await countOutbox(state.db),uiReloaded=attentionButtonText(),provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade did not become available after reverse-sync reload.');
      const overlayFacade=await provider.open(),overlayRecord=overlayFacade.readProgressRecord(targetWordId),overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')==='attention_set'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.reverseSyncCandidate===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const rows=await getAllOutbox(state.db),ours=rows.filter(r=>r?.reverseSyncCandidate===true&&r?.transportEligible===true&&String(r?.actionId||'')===plan.actionId);
      const identitiesOk=ours.length===2&&ours.every(r=>isUuid(r.mutationId))&&isUuid(plan.actionId)&&isUuid(ours.find(r=>r.tableName==='learning_events')?.rowKey);
      const persistedOk=Boolean(pendingCount===2&&ours.length===2&&identitiesOk&&Number(overlayFacade.pendingOutboxRows||0)===2&&Number(overlayFacade.overlayMutationsApplied||0)>=2&&String(overlayRecord.reviewLevel||'')==='high'&&Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)&&eventFound&&uiReloaded==='High attention');
      const blocking=[];if(!persistedOk)blocking.push('Transport-eligible iPhone outbox pair did not reconstruct exactly after reload.');if(!baseUntouched)blocking.push('Canonical v3 learning_state base changed during reverse-sync source verification.');
      const legacy=localLegacyRecord(targetWordId);
      state.report={format:'WLP_CANONICAL_IPHONE_REVERSE_SYNC_SOURCE_OUTBOX',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'iphone-study-attention-to-persistent-transport-eligible-outbox',device:{deviceKey:state.meta?.deviceKey||null,platform:'iPhone Safari/WebKit'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,migrationVersion:state.meta?.migrationVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,canonicalRows:state.meta?.canonicalRowCount||null},summary:{requested:true,canonicalStudyReadActive:true,existingAttentionSaveRerouted:true,reloadVerification:true,wordId:targetWordId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,outboxRowsOnReload:pendingCount,outboxRowsAfter:pendingCount,overlayMutationsApplied:Number(overlayFacade.overlayMutationsApplied||0),studyUiReloadedAttention:uiReloaded,persistedAcrossReload:persistedOk,pendingRetainedForCloudPush:persistedOk,transportEligible:true,productionUuidIds:identitiesOk,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),legacyLocalStorageAttention:String(legacy.reviewLevel||''),blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,wordId:targetWordId,cardId:state.cardId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,mutationIds:ours.map(x=>x.mutationId).sort(),eventId:ours.find(x=>x.tableName==='learning_events')?.rowKey||null,transportEligible:true,createdAt:plan.createdAt||null},checks:[['Transport-eligible pair survived a real iPhone reload',persistedOk,`outbox ${pendingCount} · UI ${uiReloaded||'missing'}`],['Production action/mutation/event identities are UUIDs',identitiesOk,`${plan.actionId} · ${ours.length} mutations`],['Facade reconstructed both pending mutations',Number(overlayFacade.overlayMutationsApplied||0)>=2,`${Number(overlayFacade.overlayMutationsApplied||0)} applied`],['Study-card attention_set event survived reload',eventFound,'attention_set · source=study-card · reverseSyncCandidate=true'],['Explicit firstSeen survives pending overlay',Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical v3 base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Pending pair intentionally remains for Cloud push',pendingCount===2,'outbox remains 2']].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking,warnings:[`Legacy localStorage for WID ${targetWordId} is intentionally untouched (currently ${cap(legacy.reviewLevel||'none')}).`,'These two transport-eligible outbox rows intentionally remain on the iPhone after PASS. Do not change this card again before the next Cloud push step.','No Cloud write occurs in v238.']},invariants:{normalStudyRouteRemainsLegacy:true,candidateReadsCanonicalV3Base:true,studiedAndReviewMembershipWritesLocked:true,existingAttentionSaveUsesOutbox:true,noLegacyAttentionWriteByCandidate:true,indexedDbWritesRestrictedToSyncOutbox:true,pendingRowsTransportEligible:true,pendingOverlaySurvivesReload:persistedOk,pendingRowsRetained:persistedOk,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)}};
      const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete('wlpReverseSyncReload');history.replaceState(null,'',cleanUrl.toString());
      setStatus(state.report.summary.pass?'PASS · iPhone Medium → High is pending for Cloud push.':`CHECK · ${blocking.join(' ')}`,state.report.summary.pass,`WID2876 · Medium → High · outbox stays 2 · Cloud writes 0`);
    }catch(error){const message=error?.message||String(error);try{if(plan?.mutations)await cleanupMutations(plan);}catch(cleanupError){console.error('Reverse-sync reload cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof args?.refresh==='function')args.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_IPHONE_REVERSE_SYNC_SOURCE_OUTBOX',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'iphone-study-attention-to-persistent-transport-eligible-outbox',device:{deviceKey:state.meta?.deviceKey||null,platform:'iPhone Safari/WebKit'},summary:{requested:true,reloadVerification:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort cleanup removed the exact reverse-sync candidate rows after verification failure. No Cloud write occurred.']},invariants:{noCloudWrites:true,noLegacyAttentionWriteByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'Best-effort cleanup was attempted; do not push anything to Cloud.');
    }finally{state.finalizing=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }

  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-iphone-reverse-source-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function close(){try{state.db?.close();}catch(_){ }}
  addEventListener('pagehide',close,{once:true});

  const api={version:1,requested,prepare,isActive:()=>state.active,readProgressKey,runAttentionRoundtrip,afterRender,getReport:()=>clone(state.report)};
  window.WLPCanonicalStudyAttentionWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
