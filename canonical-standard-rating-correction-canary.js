/* WLP v1.8.6.285 — append-only Standard Practice rating-correction Canonical transport canary.
   Query-gated by ?wlpCanonicalStandardRatingCorrection=1. Normal Study Hub behavior is unchanged.
   The canary compares a locally corrected Standard Practice event with its already-materialized
   immutable Canonical source event, stages exactly one rating_correction append with
   supersedes_event_id, and hands it to foreground sync. It never rewrites the original
   Canonical event and does not alter legacy localStorage. */
(() => {
  'use strict';

  const FLAG='wlpCanonicalStandardRatingCorrection';
  if(new URLSearchParams(location.search).get(FLAG)!=='1')return;

  const APP_VERSION='1.8.6.285-standard-rating-correction-canary-v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events',CARD_STORE='cards';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const STANDARD_EVENT_KEY='wlp:studyq-events:v1';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const RATINGS=new Set(['got-it','almost','not-yet','no-idea']);
  const BASE={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'};
  const state={busy:false,report:null,staged:null,legacyRaw:null,panel:null,status:null,detail:null,button:null,exportButton:null};

  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const clean=value=>String(value??'').trim();
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify=value=>JSON.stringify(stableValue(value));
  const utf8=value=>new TextEncoder().encode(String(value??''));
  async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',utf8(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(value){const hex=String(value||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(hex))throw new Error('Invalid UUID namespace.');return new Uint8Array(hex.match(/../g).map(pair=>parseInt(pair,16)));}
  function bytesToUuid(bytes){const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-standard-rating-correction-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100002;right:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical Standard Practice · rating correction canary</strong><div id="wlp-standard-rating-correction-status" style="margin-top:4px">Checking…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-standard-rating-correction-stage" type="button">Stage latest rating correction</button><button id="wlp-standard-rating-correction-export" type="button" disabled>Export JSON</button></div><div id="wlp-standard-rating-correction-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-standard-rating-correction-status');state.detail=panel.querySelector('#wlp-standard-rating-correction-detail');state.button=panel.querySelector('#wlp-standard-rating-correction-stage');state.exportButton=panel.querySelector('#wlp-standard-rating-correction-export');
    for(const button of [state.button,state.exportButton])button.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';
    state.button.addEventListener('click',stageLatest);state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;state.exportButton.disabled=!state.report;state.button.disabled=state.busy||Boolean(state.staged);}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-standard-rating-correction-${String(state.report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE].filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getMeta(db,key){const tx=db.transaction(META_STORE,'readonly'),value=await req(tx.objectStore(META_STORE).get(key));await txDone(tx);return value||null;}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function localEvents(){try{const value=JSON.parse(localStorage.getItem(STANDARD_EVENT_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function correctionTime(event){return Date.parse(event?.ratingUpdatedAt||0)||0;}
  async function findLatestCorrection(db){
    const candidates=localEvents().filter(event=>clean(event.eventId??event.event_id??event.id)&&clean(event.wordId)&&RATINGS.has(clean(event.selfRating))&&clean(event.ratingUpdatedAt)).sort((a,b)=>correctionTime(b)-correctionTime(a));
    for(const event of candidates){
      const sourceEventId=clean(event.eventId??event.event_id??event.id),wordId=clean(event.wordId),rating=clean(event.selfRating),ratingUpdatedAt=clean(event.ratingUpdatedAt);
      const originalCanonicalEventId=await uuidV5(`event|standard:${sourceEventId}`),original=await getRow(db,EVENT_STORE,originalCanonicalEventId);
      if(!original||clean(original?.payload?.event_type)!=='event'||clean(original?.payload?.source_stream)!=='standard')continue;
      const previousRating=clean(original?.payload?.payload?.selfRating);
      if(!RATINGS.has(previousRating)||previousRating===rating)continue;
      const correctionSourceId=`rating-correction:${sourceEventId}:${ratingUpdatedAt}:${rating}`;
      const correctionEventId=await uuidV5(`event|standard-rating-correction:${correctionSourceId}`);
      if(await getRow(db,EVENT_STORE,correctionEventId))continue;
      return{event:clone(event),sourceEventId,wordId,rating,ratingUpdatedAt,previousRating,originalCanonicalEventId,original:clone(original),correctionSourceId,correctionEventId};
    }
    return null;
  }

  async function stageLatest(){
    if(state.busy||state.staged)return;state.busy=true;setStatus('CHECKING · Looking for one unsynced Standard Practice rating correction…');let db=null;
    try{
      db=await openDb();const [meta,cursorMeta,outbox]=await Promise.all([getMeta(db,META_KEY),getMeta(db,CURSOR_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Standard rating correction canary requires ACTIVE Authority v3.');
      if(outbox.length!==0)throw new Error(`sync_outbox must be empty before this canary; found ${outbox.length}.`);
      const candidate=await findLatestCorrection(db);
      if(!candidate){state.report={format:'WLP_CANONICAL_STANDARD_RATING_CORRECTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{candidateFound:false,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['No local Standard Practice rating correction currently differs from its immutable Canonical source event.']}};setStatus('READY · No unsynced Standard rating correction found.',true,'Change the latest Standard Practice rating only when a correction canary is intentionally required.');return;}
      const {sourceEventId,wordId,rating,ratingUpdatedAt,previousRating,originalCanonicalEventId,original,correctionSourceId,correctionEventId}=candidate;
      const cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);
      if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
      if(clean(original?.payload?.card_id)!==cardId)throw new Error('Superseded Standard event points to a different Canonical card.');
      const occurredAt=new Date(Date.parse(ratingUpdatedAt)||Date.now()).toISOString();
      const intent={kind:'standard-practice-rating-correction-canary',correctionSourceId,correctionEventId,originalCanonicalEventId,sourceEventId,cardId,wordId,previousRating,rating,ratingUpdatedAt,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'standard-rating-correction-v1'};
      const actionId=await uuidV5(`sync-action|standard-rating-correction|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`);
      const eventPayload={event_id:correctionEventId,source_event_id:correctionSourceId,card_id:cardId,session_id:null,event_type:'rating_correction',source_stream:'standard',occurred_at:occurredAt,completed_at:occurredAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:{action:'standard_rating_correction',source:'standard-practice-history',wordId,originalEventId:sourceEventId,originalCanonicalEventId,previousRating,rating,ratingUpdatedAt},imported_at:null,supersedes_event_id:originalCanonicalEventId};
      const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalStandardRatingCorrectionCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:correctionEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
      state.legacyRaw=localStorage.getItem(STANDARD_EVENT_KEY);await addOutbox(db,mutation);state.staged={actionId,mutationId,eventId:correctionEventId,sourceEventId:correctionSourceId,wordId,previousRating,rating,originalCanonicalEventId,originalPayloadHash:clean(original.payloadHash),cursorBefore:Math.max(Number(meta.materializedSyncCursor??meta.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0))};
      state.report={format:'WLP_CANONICAL_STANDARD_RATING_CORRECTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'append-only-standard-rating-correction-to-canonical-outbox',summary:{candidateFound:true,staged:true,wordId,previousRating,rating,eventType:'rating_correction',cursorBefore:state.staged.cursorBefore,outboxBefore:0,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:correctionEventId,sourceEventId:correctionSourceId,originalCanonicalEventId,wordId,previousRating,rating},issues:{blocking:[],warnings:['This canary appends one correction event and must not rewrite the immutable original Standard Practice event.','Legacy Standard Practice localStorage is intentionally left byte-identical during transport.']},invariants:{oneEventOnlyMutation:true,noLearningStateMutation:true,originalCanonicalEventImmutable:true,supersedesOriginalEvent:true,noLegacyLocalStorageWrite:true}};
      setStatus(`PENDING · WID${wordId} rating ${previousRating} → ${rating} staged.`,true,'waiting for foreground auto-sync · original Canonical event remains immutable');
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'standard-rating-correction-canary',sourceStream:'standard',actionId,wordId,eventType:'rating_correction',mutationCount:1}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_STANDARD_RATING_CORRECTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message],warnings:['No Cloud write is performed directly by this canary. If staging failed before the outbox insert, no Canonical data changed.']}};setStatus(`BLOCKED · ${message}`,false,'Do not stage another Canonical write until this is understood.');}
    finally{try{db?.close();}catch(_){}state.busy=false;if(!state.staged)state.button.disabled=false;}
  }

  async function onSyncComplete(event){
    const detail=event?.detail||{};if(!state.staged||clean(detail.actionId)!==state.staged.actionId)return;
    if(detail.pass!==true){setStatus(`CHECK · ${clean(detail.error)||'Foreground sync did not complete.'}`,false,'The staged outbox row is intentionally retained on failure.');return;}
    let db=null;
    try{
      db=await openDb();const [correction,original,outbox,meta,cursorMeta]=await Promise.all([getRow(db,EVENT_STORE,state.staged.eventId),getRow(db,EVENT_STORE,state.staged.originalCanonicalEventId),getOutbox(db),getMeta(db,META_KEY),getMeta(db,CURSOR_KEY)]);
      const legacyUnchanged=localStorage.getItem(STANDARD_EVENT_KEY)===state.legacyRaw;
      const correctionPresent=Boolean(correction&&clean(correction?.payload?.event_type)==='rating_correction'&&clean(correction?.payload?.source_stream)==='standard'&&clean(correction?.payload?.supersedes_event_id)===state.staged.originalCanonicalEventId&&clean(correction?.payload?.payload?.rating)===state.staged.rating);
      const originalUnchanged=Boolean(original&&clean(original.payloadHash)===state.staged.originalPayloadHash&&clean(original?.payload?.payload?.selfRating)===state.staged.previousRating);
      const outboxClear=outbox.length===0,cursorAfter=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      const pass=correctionPresent&&originalUnchanged&&outboxClear&&legacyUnchanged&&cursorAfter>state.staged.cursorBefore;
      const blocking=[];if(!correctionPresent)blocking.push('Canonical rating_correction event is missing after foreground sync.');if(!originalUnchanged)blocking.push('Original Canonical Standard event changed; append-only correction invariant failed.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!legacyUnchanged)blocking.push('Legacy Standard Practice localStorage changed during correction transport.');if(!(cursorAfter>state.staged.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.staged.cursorBefore}.`);
      state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,staged:false,foregroundSynced:Boolean(detail.pass),cursorAfter,outboxAfter:outbox.length,correctionPresent,originalCanonicalEventImmutable:originalUnchanged,legacyLocalStorageUntouched:legacyUnchanged,blockingIssues:blocking.length,pass},checks:[['Canonical learning_events contains the appended rating correction',correctionPresent,state.staged.eventId],['Original Canonical Standard event stayed immutable',originalUnchanged,state.staged.originalCanonicalEventId],['Foreground source outbox cleared after acknowledged commit',outboxClear,`outbox ${outbox.length}`],['Legacy Standard Practice localStorage stayed byte-identical during transport',legacyUnchanged,legacyUnchanged?'unchanged':'changed'],['Canonical cursor advanced',cursorAfter>state.staged.cursorBefore,`${state.staged.cursorBefore} → ${cursorAfter}`]].map(([name,ok,evidence])=>({name,pass:Boolean(ok),evidence:String(evidence)})),issues:{blocking,warnings:['This proves a Standard Practice rating correction can travel as a separate append-only Canonical event linked by supersedes_event_id.','Standard Practice default writes and Canonical effective-history reads are not cut over yet; this is transport canary only.']}};
      setStatus(pass?`PASS · WID${state.staged.wordId} ${state.staged.previousRating} → ${state.staged.rating} correction reached Canonical.`:`BLOCKED · ${blocking.join(' ')}`,pass,`cursor ${state.staged.cursorBefore} → ${cursorAfter} · outbox ${outbox.length} · original event unchanged`);
    }catch(error){setStatus(`CHECK · ${error?.message||String(error)}`,false,'Foreground sync reported completion, but local verification could not finish.');}
    finally{try{db?.close();}catch(_){} }
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  makePanel();setStatus('READY · Rating correction canary is query-gated. No write has been staged.',true,'Press the button to append one local Standard rating correction whose original event is already Canonical.');
})();
