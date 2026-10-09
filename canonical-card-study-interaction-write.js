/* WLP v1.8.6.322 — Card Study interaction default Canonical write.
   Selected normal Card Study interaction events remain in the existing local interaction
   history for rollback/compatibility and are also queued into Canonical learning_events.
   Supported actions: flip, audio_play, record_start, record_save, google_search,
   jp_search, image_search, external_reference, youglish.
   Normal success is silent. Audit only: ?wlpInteractionWriteAudit=1.
   Explicit rollback: ?wlpLegacyInteractionWrite=1.
   Manual interaction canary and receiver-audit pages suppress this default writer.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.322-card-study-interaction-default-canonical-write-v1';
  const ROLLBACK_FLAG='wlpLegacyInteractionWrite';
  const AUDIT_FLAG='wlpInteractionWriteAudit';
  const MANUAL_CANARY_FLAG='wlpInteractionCanary';
  const RECEIVER_AUDIT_FLAG='wlpInteractionReceiveAudit';
  const PENDING_KEY='WLP Canonical Card Study Interaction Pending V1';
  const INTERACTION_KEY='wlp:stage7:interaction-events:v1';
  const ACTIONS=new Set(['flip','audio_play','record_start','record_save','google_search','jp_search','image_search','external_reference','youglish']);
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events',CARD_STORE='cards';
  const META_KEY='authority_mirror',CURSOR_KEY='cloud_shadow_steady_sync_v1';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,active:null,report:null,panel:null,status:null,detail:null,passedActions:[],passedCount:0};

  const clean=v=>String(v??'').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const utf8=v=>new TextEncoder().encode(String(v??''));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',utf8(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const h=new Uint8Array(await crypto.subtle.digest('SHA-1',all)),o=h.slice(0,16);o[6]=(o[6]&15)|80;o[8]=(o[8]&63)|128;return bytesToUuid(o);}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});

  function params(){return new URLSearchParams(location.search);}
  function rollbackActive(){return params().get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return params().get(AUDIT_FLAG)==='1';}
  function manualCanaryActive(){return params().has(MANUAL_CANARY_FLAG);}
  function receiverAuditActive(){return params().has(RECEIVER_AUDIT_FLAG);}
  function writerActive(){const q=params();const trial=q.get('wlpProjectionTrial')==='1';const approved=trial&&q.get('wlpProjectionEvents')==='1'&&window.WLPP1D3EventPilot?.isActive?.()===true;return(!trial||approved)&&!rollbackActive()&&!manualCanaryActive()&&!receiverAuditActive();} // P1-D3: only verified, explicitly opted-in trial events may use existing writers
  function validInteraction(e){return e&&typeof e==='object'&&ACTIONS.has(clean(e.action))&&clean(e.wordId)&&Number(e.timestamp)>0&&['source-deck','review-deck','study-set','solo'].includes(clean(e.source));}
  function eventIdentity(e){return`${Number(e.timestamp)}|${clean(e.wordId)}|${clean(e.source)}|${clean(e.deck)}|${clean(e.action)}`;}
  function readPending(){try{const v=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return(Array.isArray(v)?v:[]).filter(x=>x&&typeof x==='object'&&validInteraction(x.event));}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-500)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}
  function localEventPresent(identity){try{const v=JSON.parse(localStorage.getItem(INTERACTION_KEY)||'[]');return(Array.isArray(v)?v:[]).some(e=>validInteraction(e)&&eventIdentity(e)===identity);}catch(_){return false;}}

  function makePanel(){if(state.panel)return;const p=document.createElement('section');p.id='wlp-interaction-default-write-audit';p.setAttribute('aria-live','polite');p.style.cssText='position:fixed;z-index:100009;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(650px,calc(100vw - 20px));max-height:42vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';p.innerHTML='<strong style="display:block;font-size:13px">Card Study · interaction production-default write audit</strong><div id="wlp-interaction-default-write-status" style="margin-top:4px"></div><div id="wlp-interaction-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-interaction-default-write-status');state.detail=p.querySelector('#wlp-interaction-default-write-detail');}
  function show(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function passedDetail(base=''){const actions=[...new Set(state.passedActions)];return[base,`verified this page ${state.passedCount}: ${actions.length?actions.join(', '):'none'}`].filter(Boolean).join(' · ');}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,m){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(m));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  async function idsFor(e){const sourceEventId=await uuidV5(`interaction|${clean(e.action)}|${eventIdentity(e)}`),canonicalEventId=await uuidV5(`event|interaction:${sourceEventId}`);return{sourceEventId,canonicalEventId};}
  function enqueue(e){if(!validInteraction(e)||!writerActive())return false;const pending=readPending(),identity=eventIdentity(e),next={identity,event:clone(e),queuedAt:new Date().toISOString()};const i=pending.findIndex(x=>clean(x.identity)===identity);if(i>=0)pending[i]=next;else pending.push(next);const ok=writePending(pending);if(ok)show(`QUEUED · WID${clean(e.wordId)} ${clean(e.action)}.`,true,passedDetail(`pending ${pending.length}`));return ok;}

  async function drain(){
    if(state.busy||!writerActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){if(state.report?.summary?.pass===true)return;show('READY · Production-default interaction write is active.',true,passedDetail('No pending interaction'));return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Interaction default write requires ACTIVE Authority v3.');
      if(outbox.length){show('WAIT · Another Canonical action is pending.',true,passedDetail(`interaction queue ${pending.length} · outbox ${outbox.length}`));return;}
      while(pending.length){
        const item=pending[0],event=clone(item.event||{});if(!validInteraction(event)){pending.shift();writePending(pending);continue;}
        const wordId=clean(event.wordId),action=clean(event.action),identity=eventIdentity(event),ids=await idsFor(event),existing=await getRow(db,EVENT_STORE,ids.canonicalEventId);
        if(existing){pending.shift();writePending(pending);continue;}
        const cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
        const occurredAt=new Date(Number(event.timestamp)).toISOString(),intent={kind:'card-study-interaction-default-event',action,sourceEventId:ids.sourceEventId,canonicalEventId:ids.canonicalEventId,cardId,wordId,timestamp:Number(event.timestamp),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'interaction-card-study-v1'},actionId=await uuidV5(`sync-action|interaction-${action}|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`),eventPayload={event_id:ids.canonicalEventId,source_event_id:ids.sourceEventId,card_id:cardId,session_id:null,event_type:'event',source_stream:'interaction',occurred_at:occurredAt,completed_at:occurredAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:event,imported_at:null,supersedes_event_id:null},mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalCardStudyInteractionDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:ids.canonicalEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
        const cursorBefore=await cursorValue(db,meta);await addOutbox(db,mutation);pending.shift();writePending(pending);state.active={actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId,wordId,action,identity,cursorBefore};state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{defaultCutoverActive:true,wordId,action,cursorBefore,pendingAfter:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId}};show(`PENDING · WID${wordId} ${action} staged automatically.`,true,passedDetail(`cursor ${cursorBefore} · foreground sync will auto-push`));window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'card-study-interaction-default-write',sourceStream:'interaction',actionId,wordId,eventType:'event',interactionAction:action,mutationCount:1}}));return;
      }
      show('READY · Interaction Canonical queue is clear.',true,passedDetail('No write needed.'));
    }catch(error){const m=error?.message||String(error);state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[m]}};show(`CHECK · ${m}`,false,passedDetail('The local interaction remains saved; pending Canonical work is retained for retry.'),true);}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function onSyncComplete(ev){
    const d=ev?.detail||{};
    if(state.active&&clean(d.actionId)===state.active.actionId){
      if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,passedDetail('The staged outbox row is retained for retry.'),true);return;}
      let db=null;try{db=await openDb();const [row,outbox,meta]=await Promise.all([getRow(db,EVENT_STORE,state.active.eventId),getAll(db,OUTBOX_STORE),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),eventPresent=Boolean(row&&clean(row?.payload?.source_event_id)===state.active.sourceEventId&&clean(row?.payload?.source_stream)==='interaction'&&clean(row?.payload?.payload?.action)===state.active.action),outboxClear=outbox.length===0,localPresent=localEventPresent(state.active.identity),pass=eventPresent&&outboxClear&&localPresent&&cursorAfter>state.active.cursorBefore,blocking=[];if(!eventPresent)blocking.push('Canonical interaction is missing after foreground sync.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!localPresent)blocking.push('Original local interaction event is no longer present.');if(!(cursorAfter>state.active.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.active.cursorBefore}.`);if(pass){state.passedCount+=1;state.passedActions.push(state.active.action);}state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,cursorAfter,outboxAfter:outbox.length,eventPresent,legacyLocalEventPreserved:localPresent,verifiedThisPage:state.passedCount,verifiedActions:[...new Set(state.passedActions)],blockingIssues:blocking.length,pass},issues:{blocking,warnings:['Selected normal Study Card interaction writes are now Canonical by default while legacy interaction history remains for rollback/compatibility.']}};show(pass?`PASS · Production-default WID${state.active.wordId} ${state.active.action} reached Canonical.`:`CHECK · ${blocking.join(' ')}`,pass,passedDetail(`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}`));state.active=null;}catch(error){show(`CHECK · ${error?.message||String(error)}`,false,passedDetail('Foreground sync completed but local verification could not finish.'),true);}finally{try{db?.close();}catch(_){}};
    }
    setTimeout(()=>{void drain();},120);
  }

  function onInteraction(ev){if(!writerActive())return;const event=ev?.detail?.event;if(!validInteraction(event))return;if(!enqueue(event)){show('CHECK · Interaction pending queue could not be saved.',false,'The local interaction event remains saved.',true);return;}void drain();}

  window.addEventListener('wlp-card-study-interaction-recorded',onInteraction);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalCardStudyInteractionWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,auditFlag:AUDIT_FLAG,actions:Object.freeze([...ACTIONS]),drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length,isActive:writerActive});
  if(auditActive())show(rollbackActive()?'ROLLBACK · Production-default interaction write is disabled.':manualCanaryActive()?'DIAGNOSTIC · Manual interaction canary owns writes on this page.':receiverAuditActive()?'DIAGNOSTIC · Receiver audit is read-only; default interaction write is suppressed on this page.':'READY · Production-default interaction write is active.',true,passedDetail(`pending ${readPending().length} · audit query does not activate the write`));
  if(writerActive())setTimeout(()=>{void drain();},0);
})();
