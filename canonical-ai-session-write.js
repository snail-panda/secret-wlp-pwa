/* WLP v1.8.6.301 — AI Practice default Canonical completed-session write.
   Completed AI Practice sessions remain saved in the existing local AI Study History for rollback/compat,
   and are also queued into the Canonical sync_outbox after all referenced AI turn events are Canonical.
   AI event default write remains owned by canonical-ai-practice-write.js.
   Route state, learner profile, and AI History read authority are NOT cut over by this patch.
   Normal success is silent. Explicit rollback: ?wlpLegacyAISessionWrite=1.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.301-ai-practice-default-canonical-session-write-v1';
  const ROLLBACK_FLAG = 'wlpLegacyAISessionWrite';
  const AUDIT_FLAG = 'wlpAISessionWriteAudit';
  const PENDING_KEY = 'WLP Canonical AI Session Pending V1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const META_STORE = 'sync_meta', OUTBOX_STORE = 'sync_outbox', SESSION_STORE = 'learning_sessions', EVENT_STORE = 'learning_events';
  const META_KEY = 'authority_mirror';
  const NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE = Object.freeze({
    candidateKey: 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion: 3,
    manifestHash: '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  });
  const state = { busy:false, report:null, panel:null, status:null, detail:null };

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

  function rollbackActive(){return new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return new URLSearchParams(location.search).get(AUDIT_FLAG)==='1';}
  function readPending(){try{const value=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-50)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}
  function validCompletedSession(session){const completed=Number(session?.completed||0),total=Number(session?.total||0),turns=Array.isArray(session?.turns)?session.turns:[];return Boolean(clean(session?.sessionId)&&clean(session?.startedAt)&&clean(session?.endedAt)&&Number.isInteger(completed)&&completed>=1&&Number.isInteger(total)&&total>=completed&&turns.length===completed&&turns.every(turn=>clean(turn?.eventId)));}

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-ai-session-default-write-audit';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100008;right:8px;top:max(8px,env(safe-area-inset-top));width:min(430px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical AI Practice · default session write</strong><div id="wlp-ai-session-default-write-status" style="margin-top:4px"></div><div id="wlp-ai-session-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-ai-session-default-write-status');state.detail=panel.querySelector('#wlp-ai-session-default-write-detail');
  }
  function setStatus(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[META_STORE,OUTBOX_STORE,SESSION_STORE,EVENT_STORE],missing=required.filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function enqueue(session){
    if(!validCompletedSession(session))return false;
    const sourceSessionId=clean(session.sessionId),pending=readPending(),next={sourceSessionId,session:clone(session),queuedAt:new Date().toISOString()};
    const index=pending.findIndex(item=>clean(item?.sourceSessionId)===sourceSessionId);
    if(index>=0)pending[index]=next;else pending.push(next);
    const saved=writePending(pending);
    if(saved&&auditActive())setStatus('QUEUED · Completed AI session.',true,`${sourceSessionId} · waiting for Canonical event references`);
    return saved;
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

  async function drain(){
    if(state.busy||rollbackActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){setStatus('READY · No pending AI Practice Canonical session writes.',true,'Completed AI sessions are queued automatically after local history is saved.');return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('AI Practice default session write requires ACTIVE Authority v3.');
      if(outbox.length){setStatus('WAIT · Another Canonical action is pending.',true,`AI session queue ${pending.length} · outbox ${outbox.length}`);return;}

      while(pending.length){
        const item=pending[0],session=clone(item.session||{}),sourceSessionId=clean(item.sourceSessionId||session.sessionId);
        if(!sourceSessionId||!validCompletedSession(session)){pending.shift();writePending(pending);continue;}
        const canonicalSessionId=await uuidV5(`session|ai:${sourceSessionId}`),existing=await getRow(db,SESSION_STORE,canonicalSessionId);
        if(existing){pending.shift();writePending(pending);continue;}
        const refs=await verifyReferencedEvents(db,session),missing=refs.filter(item=>!item.present);
        if(missing.length){setStatus('WAIT · Referenced AI event write is still pending.',true,`${sourceSessionId} · ${missing.length}/${refs.length} event ref(s) not Canonical yet`);return;}
        const payload=canonicalSessionPayload(session,sourceSessionId,canonicalSessionId,meta.deviceKey||null);
        if(!payload.started_at||!payload.ended_at)throw new Error('Completed AI session is missing required timestamps.');
        const intent={kind:'ai-practice-default-session',sourceSessionId,canonicalSessionId,endedAt:payload.ended_at,eventIds:refs.map(item=>item.sourceEventId),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'ai-session-insert-v1'};
        const actionId=await uuidV5(`sync-action|ai-session|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_sessions|${actionId}`);
        const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalAIPracticeSessionDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName:'learning_sessions',rowKey:canonicalSessionId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};
        mutation.mutationHash=await sha256(stableStringify(mutation));await addOutbox(db,mutation);pending.shift();writePending(pending);
        state.report={format:'WLP_CANONICAL_AI_PRACTICE_SESSION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{sourceSessionId,completed:Number(session.completed||0),turnEventRefs:refs.length,pendingAfter:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,sessionId:canonicalSessionId,eventRefs:refs}};
        setStatus('PENDING · Completed AI session staged.',true,`${sourceSessionId} · ${refs.length} Canonical event ref(s) · foreground sync will auto-push`);
        window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'ai-session-default-write',tableName:'learning_sessions',mutationKind:'insert',mutationCount:1,actionId,sessionId:sourceSessionId,sessionType:'ai'}}));
        return;
      }
      setStatus('READY · AI Practice Canonical session queue is clear.',true,'No write needed.');
    }catch(error){
      const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_AI_PRACTICE_SESSION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message]}};setStatus(`CHECK · ${message}`,false,'Pending completed AI session data is retained locally; do not create another Canonical session write until this is understood.',true);
    }finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  function onSessionCompleted(event){if(rollbackActive())return;const session=event?.detail?.session;if(!session||!enqueue(session)){setStatus('CHECK · Completed AI session could not be queued.',false,'The local AI Study History record remains saved.',true);return;}void drain();}
  function onSyncComplete(){setTimeout(()=>{void drain();},260);}

  window.addEventListener('wlp-ai-practice-session-completed',onSessionCompleted);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalAIPracticeSessionWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length});
  if(auditActive())setStatus(rollbackActive()?'ROLLBACK · AI Practice Canonical default session write disabled.':'READY · Completed AI Practice sessions use Canonical outbox.',true,`pending ${readPending().length}`);
  if(!rollbackActive())setTimeout(()=>{void drain();},320);
})();
