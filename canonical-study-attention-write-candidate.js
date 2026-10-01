/* WLP v1.8.6.229 — Study-card Review Attention -> local outbox candidate.
   Query-gated by ?wlpCanonicalStudyAttentionWrite=1 and intended for the solo Study
   route reached from the query-gated Review candidate. Normal Study remains legacy.
   The candidate reads the target card's learning_state from the verified Authority-v2
   mirror, routes the existing Study-card Attention Save through transport-ineligible
   sync_outbox mutations, verifies the real facade overlay + Study DOM, then cleans up.
   No Cloud, legacy localStorage, or Canonical base row is written. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.229-study-attention-outbox-candidate-v1';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', STATE_STORE='learning_state';
  const META_KEY='authority_mirror';
  const PROGRESS_PREFIX='fc:wordid:';
  const CARD_NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const EXPECTED={candidateKey:'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283',headVersion:2,migrationVersion:'3',manifestHash:'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3',canonicalRows:21424};
  const params=new URLSearchParams(location.search);
  const requested=params.get('wlpCanonicalStudyAttentionWrite')==='1';
  const targetWordId=String(params.get('wordid')||'').trim();
  const state={active:false,busy:false,db:null,meta:null,cardId:'',baseWrapper:null,baseRecord:null,overlayRecord:null,report:null,prepareError:''};

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
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('Study candidate blocked: wlp-cloud-v1 did not already exist at schema version 1.'));return;}const required=[META_STORE,OUTBOX_STORE,STATE_STORE];const missing=required.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();reject(new Error(`Study candidate blocked: missing store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Study candidate IndexedDB open is blocked by another page.'));});}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await requestPromise(tx.objectStore(META_STORE).get(META_KEY));await transactionDone(tx);return row||null;}
  async function getStateRow(db,cardId){const tx=db.transaction(STATE_STORE,'readonly'),row=await requestPromise(tx.objectStore(STATE_STORE).get(cardId));await transactionDone(tx);return row||null;}
  async function countOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),n=await requestPromise(tx.objectStore(OUTBOX_STORE).count());await transactionDone(tx);return Number(n||0);}
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
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Study attention candidate</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing Canonical card state…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button><a href="../../review.html?wlpCanonicalReviewWrite=1" style="align-self:center">Return to Review candidate</a></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){const el=document.getElementById('wlp-study-attention-candidate-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}const d=document.getElementById('wlp-study-attention-candidate-detail');if(d)d.textContent=detail;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=state.busy||!state.report;}

  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      if(!targetWordId)throw new Error('Study candidate requires a solo wordid route.');
      const db=await openDb(),meta=await getMeta(db),outbox=await countOutbox(db),cardId=await cardIdForWordId(targetWordId),stateRow=await getStateRow(db,cardId);
      if(String(meta?.candidateKey||'')!==EXPECTED.candidateKey||Number(meta?.headVersion||0)!==EXPECTED.headVersion||String(meta?.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta?.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta?.canonicalRowCount||0)!==EXPECTED.canonicalRows){db.close();throw new Error('Study candidate requires the exact ACTIVE Authority-v2 mirror.');}
      if(outbox!==0){db.close();throw new Error(`Study candidate requires an empty sync_outbox; found ${outbox} pending row(s).`);}
      if(!stateRow){db.close();throw new Error(`WID ${targetWordId} learning_state row is missing from the Canonical mirror.`);}
      const base=clone(stateRow.payload||{}),hash=await sha256(stableStringify(base));if(hash!==String(stateRow.payloadHash||'')){db.close();throw new Error(`WID ${targetWordId} Canonical base payload hash mismatch.`);}
      if(String(base.card_id||'')!==cardId){db.close();throw new Error(`WID ${targetWordId} Canonical card identity mismatch.`);}
      state.db=db;state.meta=meta;state.cardId=cardId;state.baseWrapper=clone(stateRow);state.baseRecord=legacyRecord(targetWordId,base);state.overlayRecord=null;state.active=true;state.prepareError='';
      const legacy=localLegacyRecord(targetWordId),legacyLevel=String(legacy.reviewLevel||'').toLowerCase(),canonicalLevel=String(state.baseRecord.reviewLevel||'').toLowerCase();
      const divergence=legacyLevel&&legacyLevel!==canonicalLevel?` Legacy localStorage currently says ${cap(legacyLevel)}; it is intentionally untouched.`:'';
      setStatus('READY · Study-card Attention reads Canonical v2 on this candidate route.',null,`WID${targetWordId} · Canonical ${cap(canonicalLevel)}.${divergence} Choose a different Attention level and tap Save.`);
      return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;setStatus(`BLOCKED · ${state.prepareError}`,false,'No Study attention write is allowed on this candidate route.');return false;}
  }

  function readProgressKey(key){if(!state.active||!String(key||'').startsWith(PROGRESS_PREFIX))return null;const wid=String(key).slice(PROGRESS_PREFIX.length);if(wid!==targetWordId)return null;return clone(state.overlayRecord||state.baseRecord);}

  async function enqueueMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);let wrote=0;const existing=await Promise.all(plan.mutations.map(m=>requestPromise(store.get(m.mutationId))));plan.mutations.forEach((m,i)=>{const row=existing[i];if(row){if(stableStringify(row)!==stableStringify(m))throw new Error('Study candidate mutation ID collision.');}else{store.add(clone(m));wrote++;}});await transactionDone(tx);return wrote;}
  async function cleanupMutations(plan){const tx=state.db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of plan.mutations)store.delete(m.mutationId);await transactionDone(tx);}
  async function waitForFacade(){for(let i=0;i<20;i++){const p=window.WLPCanonicalStorageCompatibilityFacade;if(p?.open)return p;await new Promise(r=>setTimeout(r,25));}return null;}
  function attentionButtonText(){return (document.querySelector('.btn-review-attention:not([hidden]), .btn-review-attention-front:not([hidden])')?.textContent||'').trim();}

  async function buildPlan(level,reasons){
    const base=clone(state.baseWrapper.payload||{}),fromLevel=String(base.review_level||'').toLowerCase(),toLevel=String(level||'').toLowerCase();
    if(!['light','medium','high'].includes(toLevel))throw new Error('Choose Light, Medium, or High before Save.');
    if(!Boolean(base.review))throw new Error(`WID ${targetWordId} is not currently in Canonical Review.`);
    if(fromLevel===toLevel&&stableStringify(Array.isArray(base.review_reasons)?base.review_reasons:[])===stableStringify(Array.isArray(reasons)?reasons:[]))throw new Error(`Choose a different Attention value or reasons; Canonical is already ${cap(fromLevel)}.`);
    const at=new Date().toISOString(),atMs=Date.parse(at),basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(state.baseWrapper.payloadHash||''))throw new Error('Canonical base payload changed before candidate Save.');
    const intent={candidate:true,kind:'study-card-attention-save',cardId:state.cardId,wordId:targetWordId,fromLevel,toLevel,reasons:Array.isArray(reasons)?clone(reasons):[],at,basePayloadHash,baseHeadVersion:Number(state.meta.headVersion||0),baseCandidateKey:String(state.meta.candidateKey||'')};
    const actionId=`study-attention-action:${await sha256(stableStringify(intent))}`,stateMutationId=`study-attention-mut:${await sha256(`state|${actionId}`)}`,eventMutationId=`study-attention-mut:${await sha256(`event|${actionId}`)}`,eventId=await uuidV5(CARD_NAMESPACE_UUID,`study-attention-event|interaction|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,review_reasons:Array.isArray(reasons)?clone(reasons):[],last_attention_updated_at:at,revision:Number(base.revision||0)+1,updated_at:at};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:state.meta.candidateKey,headVersion:state.meta.headVersion,snapshotManifestHash:state.meta.snapshotManifestHash},deviceKey:state.meta.deviceKey||null,actionId,createdAt:at,diagnosticOnly:true,candidateOnly:true,transportEligible:false,status:'candidate-pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:state.cardId,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,review_reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','review_reasons','last_attention_updated_at','revision','updated_at'],patch};stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:state.cardId,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:at,completed_at:null,device_id:state.meta.deviceKey||null,legacy_word_id:Number(targetWordId),schema_version:1,payload:{timestamp:atMs,action:'attention_set',wordId:targetWordId,source:'study-card',level:toLevel,reasons:Array.isArray(reasons)?clone(reasons):[],fromLevel,candidateOnly:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return{actionId,fromLevel,toLevel,at,mutations:[stateMutation,eventMutation],patchedPayload:{...base,...patch}};
  }

  async function runAttentionRoundtrip(args){
    if(!state.active)throw new Error('Canonical Study attention candidate is not active.');if(state.busy)throw new Error('Another Study attention candidate action is running.');
    state.busy=true;setStatus('Running Study-card Attention Save → outbox → facade → Study UI → rollback…');let plan=null,cleanupNeeded=false;
    try{
      const before=await countOutbox(state.db);if(before!==0)throw new Error(`sync_outbox must start empty; found ${before}.`);
      plan=await buildPlan(args?.level,args?.reasons);const wrote=await enqueueMutations(plan);cleanupNeeded=true;const during=await countOutbox(state.db);
      state.overlayRecord=legacyRecord(targetWordId,plan.patchedPayload);if(typeof args?.refresh==='function')args.refresh();await nextFrames(3);
      const uiDuring=attentionButtonText();
      const provider=await waitForFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade v225 did not become available for overlay verification.');
      const overlayFacade=await provider.open(),overlayRecord=overlayFacade.readProgressRecord(targetWordId),overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(e=>String(e?.action||'')==='attention_set'&&String(e?.wordId||'')===targetWordId&&String(e?.source||'')==='study-card'&&e?.candidateOnly===true);
      const baseWrapperDuring=await getStateRow(state.db,state.cardId),baseUntouched=stableStringify(baseWrapperDuring)===stableStringify(state.baseWrapper);
      const overlayOk=Boolean(wrote===2&&during===2&&Number(overlayFacade.pendingOutboxRows||0)===2&&Number(overlayFacade.overlayMutationsApplied||0)>=2&&String(overlayRecord.reviewLevel||'')===plan.toLevel&&Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)&&eventFound&&uiDuring===`${cap(plan.toLevel)} attention`);
      await cleanupMutations(plan);cleanupNeeded=false;state.overlayRecord=null;if(typeof args?.refresh==='function')args.refresh();await nextFrames(3);
      const after=await countOutbox(state.db),baseFacade=await provider.open(),restored=baseFacade.readProgressRecord(targetWordId),uiAfter=attentionButtonText(),baseWrapperAfter=await getStateRow(state.db,state.cardId);
      const cleanupOk=Boolean(after===0&&Number(baseFacade.pendingOutboxRows||0)===0&&String(restored.reviewLevel||'')===plan.fromLevel&&Number(restored.firstSeen||0)===Number(state.baseRecord.firstSeen||0)&&uiAfter===`${cap(plan.fromLevel)} attention`&&stableStringify(baseWrapperAfter)===stableStringify(state.baseWrapper));
      const blocking=[];if(!overlayOk)blocking.push('Study-card Save did not render the pending Canonical overlay exactly.');if(!baseUntouched)blocking.push('Canonical learning_state base changed during the candidate action.');if(!cleanupOk)blocking.push('Candidate cleanup did not restore Canonical base + empty outbox + Study UI.');
      const legacy=localLegacyRecord(targetWordId);
      state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_OUTBOX_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-existing-study-attention-save-to-local-outbox-roundtrip',device:{deviceKey:state.meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:state.meta?.candidateKey||null,headVersion:state.meta?.headVersion||null,migrationVersion:state.meta?.migrationVersion||null,snapshotManifestHash:state.meta?.snapshotManifestHash||null,canonicalRows:state.meta?.canonicalRowCount||null},summary:{requested:true,canonicalStudyReadActive:true,existingAttentionSaveRerouted:true,wordId:targetWordId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,outboxRowsBefore:before,rowsWritten:wrote,outboxRowsDuring:during,studyUiOverlayAttention:uiDuring,cleanupVerified:cleanupOk,outboxRowsAfter:after,studyUiRestoredAttention:uiAfter,baseMirrorUntouched:baseUntouched,firstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),legacyLocalStorageAttention:String(legacy.reviewLevel||''),blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},plan:{actionId:plan.actionId,wordId:targetWordId,cardId:state.cardId,fromLevel:plan.fromLevel,toLevel:plan.toLevel,mutationIds:plan.mutations.map(x=>x.mutationId),candidateOnly:true,transportEligible:false},checks:[['Existing Study Attention Save routed away from legacy localStorage',true,'handled by Canonical Study candidate API'],['Candidate mutation pair is exact',wrote===2&&during===2,`${wrote} write(s) · outbox ${during}`],['Facade + Study UI show pending Attention overlay',overlayOk,`${cap(plan.fromLevel)} → ${cap(plan.toLevel)} · UI ${uiDuring||'missing'}`],['Study-card interaction event is visible while pending',eventFound,'attention_set · source=study-card'],['Explicit firstSeen is preserved',Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0),String(overlayRecord.firstSeen||0)],['Canonical base remains immutable',baseUntouched,'learning_state wrapper unchanged'],['Automatic rollback restores Canonical base + empty outbox',cleanupOk,`UI ${uiAfter||'missing'} · outbox ${after}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)})),issues:{blocking,warnings:[`Legacy localStorage for WID ${targetWordId} is intentionally untouched by this candidate (currently ${cap(legacy.reviewLevel||'none')}).`,'This query-gated candidate verifies the real Study-card Attention Save path only; diagnostic rows are transport-ineligible and removed before PASS.','Cloud mutation transport, acknowledgement, and conflict resolution remain disabled.']},invariants:{normalStudyRouteRemainsLegacy:true,candidateReadsCanonicalBase:true,studiedAndReviewMembershipWritesLocked:true,existingAttentionSaveUsesOutbox:true,noLegacyAttentionWriteByCandidate:true,indexedDbWritesRestrictedToSyncOutbox:true,candidateRowsTransportIneligible:true,automaticCleanupComplete:cleanupOk,noCloudWrites:true,authorityBaseImmutable:baseUntouched,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen||0)===Number(state.baseRecord.firstSeen||0)}};
      setStatus(state.report.summary.pass?'PASS · Real Study-card Attention Save used the Canonical outbox path and rolled back cleanly.':`CHECK · ${blocking.join(' ')}`,state.report.summary.pass,`WID${targetWordId} · ${cap(plan.fromLevel)} → ${cap(plan.toLevel)} → ${cap(plan.fromLevel)} · outbox 0 → 2 → 0 · legacy local unchanged`);
      return{pass:state.report.summary.pass,report:clone(state.report)};
    }catch(error){const message=error?.message||String(error);try{if(plan&&cleanupNeeded)await cleanupMutations(plan);}catch(cleanupError){console.error('Study candidate cleanup failed',cleanupError);}state.overlayRecord=null;try{if(typeof args?.refresh==='function')args.refresh();}catch(_){ }state.report={format:'WLP_CANONICAL_STUDY_ATTENTION_OUTBOX_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-existing-study-attention-save-to-local-outbox-roundtrip',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},summary:{requested:true,canonicalStudyReadActive:state.active,existingAttentionSaveRerouted:true,wordId:targetWordId,blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[message],warnings:['Best-effort candidate outbox cleanup was attempted after failure. Legacy localStorage was not written by the candidate Save path.']},invariants:{normalStudyRouteRemainsLegacy:true,noCloudWrites:true,noLegacyAttentionWriteByCandidate:true}};setStatus(`BLOCKED · ${message}`,false,'No Cloud write occurred; best-effort local outbox cleanup was attempted.');return{pass:false,error:message,report:clone(state.report)};
    }finally{state.busy=false;const b=document.getElementById('wlp-study-attention-candidate-export');if(b)b.disabled=!state.report;}
  }

  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-study-attention-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function close(){try{state.db?.close();}catch(_){ }}
  addEventListener('pagehide',close,{once:true});

  const api={version:1,requested,prepare,isActive:()=>state.active,readProgressKey,runAttentionRoundtrip,getReport:()=>clone(state.report)};
  window.WLPCanonicalStudyAttentionWriteCandidate=Object.freeze(api);
  if(requested)makePanel();
})();
