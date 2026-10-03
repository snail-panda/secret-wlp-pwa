/* WLP v1.8.6.300 — AI Practice completed-session Canonical transport canary.
   Query-gated only: ?wlpCanonicalAISession=1.
   Stages one real completed AI Practice session that is missing from Canonical learning_sessions.
   The session's referenced interpreted AI events must already exist in the local Canonical mirror.
   Legacy AI Study History localStorage remains byte-identical. Foreground sync performs the actual transport. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.300-ai-practice-completed-session-canary-v1';
  const FLAG = 'wlpCanonicalAISession';
  const AI_SESSION_KEY = 'wlp:ai-study-session-history:v1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const META_STORE = 'sync_meta', OUTBOX_STORE = 'sync_outbox', SESSION_STORE = 'learning_sessions', EVENT_STORE = 'learning_events';
  const META_KEY = 'authority_mirror', CURSOR_KEY = 'sync_cursor';
  const NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE = Object.freeze({
    candidateKey: 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion: 3,
    manifestHash: '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  });
  const state = { busy:false, staged:null, report:null, panel:null, button:null, status:null, detail:null, exportButton:null, legacyRaw:null };

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify = value => JSON.stringify(stableValue(value));
  const utf8 = value => new TextEncoder().encode(String(value ?? ''));
  async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',utf8(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(value){const hex=String(value||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(hex))throw new Error('Invalid UUID namespace.');return new Uint8Array(hex.match(/../g).map(pair=>parseInt(pair,16)));}
  function bytesToUuid(bytes){const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  function isoTime(value){if(value===null||value===undefined||value==='')return null;const raw=Number(value),date=Number.isFinite(raw)&&String(value).trim()!==''?new Date(raw>0&&raw<100000000000?raw*1000:raw):new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}

  if(new URLSearchParams(location.search).get(FLAG)!=='1')return;

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-ai-session-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100005;right:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:50vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical AI Practice · completed-session canary</strong><div id="wlp-ai-session-status" style="margin-top:4px"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-ai-session-stage" type="button">Stage latest completed AI session</button><button id="wlp-ai-session-export" type="button" disabled>Export JSON</button></div><div id="wlp-ai-session-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.button=panel.querySelector('#wlp-ai-session-stage');state.status=panel.querySelector('#wlp-ai-session-status');state.detail=panel.querySelector('#wlp-ai-session-detail');state.exportButton=panel.querySelector('#wlp-ai-session-export');
    for(const button of panel.querySelectorAll('button'))button.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';
    state.button.addEventListener('click',stageLatest);state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;state.exportButton.disabled=!state.report;}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-ai-session-${String(state.report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[META_STORE,OUTBOX_STORE,SESSION_STORE,EVENT_STORE],missing=required.filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getMeta(db,key){return getRow(db,META_STORE,key);}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function localSessions(){try{const value=JSON.parse(localStorage.getItem(AI_SESSION_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function sessionTime(session){return Date.parse(session?.endedAt||session?.updatedAt||session?.startedAt||0)||0;}
  function validCompletedSession(session){const completed=Number(session?.completed||0),total=Number(session?.total||0),turns=Array.isArray(session?.turns)?session.turns:[];return Boolean(clean(session?.sessionId)&&clean(session?.startedAt)&&clean(session?.endedAt)&&Number.isInteger(completed)&&completed>=1&&Number.isInteger(total)&&total>=completed&&turns.length===completed&&turns.every(turn=>clean(turn?.eventId)));}
  async function findLatestUnsynced(db){
    const candidates=localSessions().filter(validCompletedSession).sort((a,b)=>sessionTime(b)-sessionTime(a));
    for(const session of candidates){const sourceSessionId=clean(session.sessionId),canonicalSessionId=await uuidV5(`session|ai:${sourceSessionId}`);if(!await getRow(db,SESSION_STORE,canonicalSessionId))return{session:clone(session),sourceSessionId,canonicalSessionId};}
    return null;
  }
  async function verifyReferencedEvents(db,session){
    const refs=[];
    for(const turn of session.turns||[]){const sourceEventId=clean(turn?.eventId),canonicalEventId=await uuidV5(`event|ai:${sourceEventId}`),row=await getRow(db,EVENT_STORE,canonicalEventId),payload=row?.payload||{};refs.push({sourceEventId,canonicalEventId,present:Boolean(row&&clean(payload.source_stream)==='ai'&&clean(payload.source_event_id)===sourceEventId)});}
    return refs;
  }
  function canonicalSessionPayload(session,sourceSessionId,canonicalSessionId,deviceKey){
    const startedAt=isoTime(session.startedAt),endedAt=isoTime(session.endedAt);
    return {session_id:canonicalSessionId,source_session_id:sourceSessionId,session_type:'ai',source_mode:clean(session.practiceType)||null,device_id:deviceKey||null,started_at:startedAt,ended_at:endedAt,status:'completed',summary:session.insights??null,payload:clone(session),schema_version:Number(session.schemaVersion||session.version)||1,created_at:startedAt,updated_at:endedAt||startedAt};
  }

  async function stageLatest(){
    if(state.busy)return;
    if(state.staged?.recovered){state.busy=true;state.button.disabled=true;setStatus('RETRYING · Existing completed AI session outbox is being retried…',null,`${state.staged.sourceSessionId} · no new mutation will be staged`);window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'ai-session-canary-retry',tableName:'learning_sessions',mutationKind:'insert',mutationCount:1,actionId:state.staged.actionId,sessionId:state.staged.sourceSessionId,sessionType:'ai'}}));state.busy=false;return;}
    if(state.staged)return;state.busy=true;state.button.disabled=true;setStatus('CHECKING · Looking for one completed unsynced AI Practice session…');let db=null;
    try{
      db=await openDb();const [meta,cursorMeta,outbox]=await Promise.all([getMeta(db,META_KEY),getMeta(db,CURSOR_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('AI session canary requires ACTIVE Authority v3.');
      if(outbox.length!==0)throw new Error(`sync_outbox must be empty before this canary; found ${outbox.length}.`);
      const candidate=await findLatestUnsynced(db);
      if(!candidate){state.report={format:'WLP_CANONICAL_AI_SESSION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{candidateFound:false,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['No completed local AI Practice session is currently missing from Canonical learning_sessions.']}};setStatus('READY · No unsynced completed AI session found.',true,'Finish one AI Practice session if another transport canary is needed.');return;}
      const {session,sourceSessionId,canonicalSessionId}=candidate,refs=await verifyReferencedEvents(db,session),missing=refs.filter(item=>!item.present);
      if(missing.length)throw new Error(`Completed AI session references ${missing.length} AI event(s) not present in the local Canonical mirror.`);
      const payload=canonicalSessionPayload(session,sourceSessionId,canonicalSessionId,meta.deviceKey||null);
      if(!payload.started_at||!payload.ended_at)throw new Error('Latest completed AI session is missing required timestamps.');
      const intent={kind:'ai-practice-session-only-canary',sourceSessionId,canonicalSessionId,endedAt:payload.ended_at,eventIds:refs.map(item=>item.sourceEventId),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'ai-session-insert-v1'};
      const actionId=await uuidV5(`sync-action|ai-session|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_sessions|${actionId}`);
      const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalAISessionTransportCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName:'learning_sessions',rowKey:canonicalSessionId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};
      mutation.mutationHash=await sha256(stableStringify(mutation));state.legacyRaw=localStorage.getItem(AI_SESSION_KEY);await addOutbox(db,mutation);
      state.staged={actionId,mutationId,canonicalSessionId,sourceSessionId,cursorBefore:Math.max(Number(meta.materializedSyncCursor??meta.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0))};
      state.report={format:'WLP_CANONICAL_AI_SESSION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'real-completed-ai-session-to-canonical-outbox',summary:{candidateFound:true,staged:true,sourceSessionId,completed:Number(session.completed||0),turnEventRefs:refs.length,cursorBefore:state.staged.cursorBefore,outboxBefore:0,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,sessionId:canonicalSessionId,sourceSessionId,eventRefs:refs},issues:{blocking:[],warnings:['This canary transports one real completed AI Practice session that is missing from Canonical learning_sessions.','Every referenced turn event was verified in the local Canonical mirror before staging.','Legacy AI Study History localStorage is intentionally left byte-identical.']},invariants:{oneSessionOnlyMutation:true,noLearningEventMutation:true,referencedAIEventsAlreadyCanonical:true,noLegacyLocalStorageWrite:true}};
      setStatus('PENDING · Completed AI session staged.',true,`${sourceSessionId} · ${refs.length} Canonical event ref(s) · waiting for foreground auto-sync`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'ai-session-canary',tableName:'learning_sessions',mutationKind:'insert',mutationCount:1,actionId,sessionId:sourceSessionId,sessionType:'ai'}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_AI_SESSION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message],warnings:['No direct Cloud write is performed by this canary. A staged outbox row is retained if foreground sync later fails.']}};setStatus(`BLOCKED · ${message}`,false,'Do not stage another Canonical write until this is understood.');}
    finally{try{db?.close();}catch(_){}state.busy=false;if(!state.staged)state.button.disabled=false;}
  }

  async function restorePendingCanary(){let db=null;try{db=await openDb();const [meta,cursorMeta,outbox]=await Promise.all([getMeta(db,META_KEY),getMeta(db,CURSOR_KEY),getOutbox(db)]);if(outbox.length!==1)return false;const mutation=outbox[0];if(mutation?.canonicalAISessionTransportCanary!==true||mutation?.transportEligible!==true||mutation?.tableName!=='learning_sessions'||mutation?.mutationKind!=='insert')return false;const sourceSessionId=clean(mutation?.payload?.source_session_id),canonicalSessionId=clean(mutation?.rowKey),actionId=clean(mutation?.actionId),mutationId=clean(mutation?.mutationId);if(!sourceSessionId||!canonicalSessionId||!actionId||!mutationId)return false;state.legacyRaw=localStorage.getItem(AI_SESSION_KEY);state.staged={actionId,mutationId,canonicalSessionId,sourceSessionId,cursorBefore:Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0)),recovered:true};state.report={format:'WLP_CANONICAL_AI_SESSION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'recover-existing-completed-ai-session-outbox',summary:{candidateFound:true,staged:true,recoveredPendingOutbox:true,sourceSessionId,cursorBefore:state.staged.cursorBefore,outboxBefore:1,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,sessionId:canonicalSessionId,sourceSessionId},issues:{blocking:[],warnings:['Recovered the already-staged completed AI Practice session mutation. Retry reuses the same actionId/mutationId and does not stage a second write.']},invariants:{oneSessionOnlyMutation:true,noLearningEventMutation:true,noLegacyLocalStorageWrite:true,noDuplicateStageOnRetry:true}};state.button.disabled=false;state.button.textContent='Retry staged AI session';setStatus('PENDING · Existing completed AI session outbox recovered.',true,`${sourceSessionId} · retry will reuse the same staged mutation`);return true;}catch(_){return false;}finally{try{db?.close();}catch(_){}}}

  async function onSyncComplete(event){const detail=event?.detail||{};if(!state.staged||clean(detail.actionId)!==state.staged.actionId)return;if(detail.pass!==true){state.button.disabled=false;state.button.textContent='Retry staged AI session';state.staged.recovered=true;setStatus(`CHECK · ${clean(detail.error)||'Foreground sync did not complete.'}`,false,'The same staged outbox row is retained. Retry will not create another mutation.');return;}let db=null;try{db=await openDb();const [row,outbox,meta,cursorMeta]=await Promise.all([getRow(db,SESSION_STORE,state.staged.canonicalSessionId),getOutbox(db),getMeta(db,META_KEY),getMeta(db,CURSOR_KEY)]);const legacyUnchanged=localStorage.getItem(AI_SESSION_KEY)===state.legacyRaw,sessionPresent=Boolean(row&&clean(row?.payload?.source_session_id)===state.staged.sourceSessionId&&clean(row?.payload?.session_type)==='ai'&&clean(row?.payload?.status)==='completed'),outboxClear=outbox.length===0,cursorAfter=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0)),pass=sessionPresent&&outboxClear&&legacyUnchanged&&cursorAfter>state.staged.cursorBefore;const blocking=[];if(!sessionPresent)blocking.push('Canonical AI session is missing after foreground sync.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!legacyUnchanged)blocking.push('Legacy AI Study History localStorage changed during the canary.');if(!(cursorAfter>state.staged.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.staged.cursorBefore}.`);state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,staged:false,foregroundSynced:Boolean(detail.pass),cursorAfter,outboxAfter:outbox.length,sessionPresent,legacyLocalStorageUntouched:legacyUnchanged,blockingIssues:blocking.length,pass},checks:[['Canonical learning_sessions contains the completed AI session',sessionPresent,state.staged.canonicalSessionId],['Foreground source outbox cleared after acknowledged commit',outboxClear,`outbox ${outbox.length}`],['Legacy AI Study History stayed byte-identical',legacyUnchanged,legacyUnchanged?'unchanged':'changed'],['Canonical cursor advanced after atomic local commit',cursorAfter>state.staged.cursorBefore,`${state.staged.cursorBefore} → ${cursorAfter}`]].map(([name,ok,evidence])=>({name,pass:Boolean(ok),evidence:String(evidence)})),issues:{...(state.report.issues||{}),blocking}};setStatus(pass?'PASS · Completed AI session reached Canonical.':'CHECK · Completed AI session did not fully converge.',pass,`${state.staged.sourceSessionId} · cursor ${state.staged.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}`);}catch(error){setStatus(`CHECK · ${error?.message||String(error)}`,false,'Foreground sync reported success, but post-sync verification failed.');}finally{try{db?.close();}catch(_){}}}

  async function init(){makePanel();window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);const recovered=await restorePendingCanary();if(!recovered)setStatus('READY · Completed AI session canary is read-only until you press Stage.',true,'Stages one local-only completed AI session; referenced turn events must already be Canonical.');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
