/* WLP v1.8.6.290 — Standard Practice completed-session default Canonical write.
   Completed Standard Practice sessions remain saved in existing local history for rollback/compat,
   and are also queued into Canonical learning_sessions as single-row inserts after the final
   Standard event has cleared the Canonical outbox. Explicit rollback: ?wlpLegacyStandardSessionWrite=1.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.290-standard-practice-session-default-write-v1';
  const ROLLBACK_FLAG='wlpLegacyStandardSessionWrite';
  const AUDIT_FLAG='wlpStandardSessionWriteAudit';
  const PENDING_KEY='WLP Canonical Standard Session Pending V1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',SESSION_STORE='learning_sessions';
  const META_KEY='authority_mirror';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,recoveryAttempted:false,report:null,panel:null,status:null,detail:null};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify=value=>JSON.stringify(stableValue(value));
  const utf8=value=>new TextEncoder().encode(String(value??''));
  async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',utf8(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(value){const hex=String(value||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(hex))throw new Error('Invalid UUID namespace.');return new Uint8Array(hex.match(/../g).map(pair=>parseInt(pair,16)));}
  function bytesToUuid(bytes){const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  function isoTime(value){if(value===null||value===undefined||value==='')return null;const raw=Number(value),date=Number.isFinite(raw)&&String(value).trim()!==''?new Date(raw>0&&raw<100000000000?raw*1000:raw):new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}

  function rollbackActive(){return new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return new URLSearchParams(location.search).get(AUDIT_FLAG)==='1';}
  function readPending(){try{const value=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-80)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-standard-session-default-write-audit';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100005;right:8px;top:max(8px,env(safe-area-inset-top));width:min(430px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical Standard Practice · session default write</strong><div id="wlp-standard-session-default-write-status" style="margin-top:4px"></div><div id="wlp-standard-session-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-standard-session-default-write-status');state.detail=panel.querySelector('#wlp-standard-session-default-write-detail');
  }
  function setStatus(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[META_STORE,OUTBOX_STORE,SESSION_STORE],missing=required.filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getMeta(db,key){return getRow(db,META_STORE,key);}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function enqueue(session){
    const sourceSessionId=clean(session?.sessionId),status=clean(session?.status),completedAt=clean(session?.completedAt);
    if(!sourceSessionId||status!=='completed'||!completedAt||!Array.isArray(session?.experiences)||!session.experiences.length)return false;
    const pending=readPending(),next={sourceSessionId,session:clone(session),queuedAt:new Date().toISOString()};
    const index=pending.findIndex(item=>clean(item?.sourceSessionId)===sourceSessionId);
    if(index>=0)pending[index]=next;else pending.push(next);
    return writePending(pending);
  }

  function canonicalSessionPayload(session,sourceSessionId,canonicalSessionId,deviceKey){
    const startedAt=isoTime(session.startedAt),completedAt=isoTime(session.completedAt),updatedAt=isoTime(session.updatedAt||session.completedAt||session.startedAt);
    return{session_id:canonicalSessionId,source_session_id:sourceSessionId,session_type:'standard',source_mode:clean(session.sourceMode)||null,device_id:deviceKey||null,started_at:startedAt,ended_at:completedAt,status:'completed',summary:session.summary??null,payload:clone(session),schema_version:Number(session.schemaVersion||session.version)||1,created_at:startedAt,updated_at:updatedAt||completedAt||startedAt};
  }

  function finalEventPending(){
    try{return Number(window.WLPCanonicalStandardPracticeWrite?.pendingCount?.()||0)>0;}catch(_){return false;}
  }

  async function drain(){
    if(state.busy||rollbackActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){setStatus('READY · No pending Standard session Canonical writes.',true,'Completed Standard sessions are queued automatically.');return;}
      if(finalEventPending()){setStatus('WAIT · Final Standard event is still queued.',true,`session queue ${pending.length} · session insert will follow the event commit`);return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getMeta(db,META_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Standard session default write requires ACTIVE Authority v3.');
      if(outbox.length){
        const own=outbox.length===1&&outbox[0]?.canonicalStandardSessionDefaultWrite===true&&outbox[0]?.tableName==='learning_sessions'&&outbox[0]?.mutationKind==='insert';
        if(own&&!state.recoveryAttempted){
          state.recoveryAttempted=true;
          const mutation=outbox[0];
          setStatus('RETRYING · Existing Standard session outbox retained from an earlier attempt.',null,`${clean(mutation?.payload?.source_session_id)||'session'} · same actionId/mutationId`);
          window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'standard-session-default-retry',tableName:'learning_sessions',mutationKind:'insert',mutationCount:1,actionId:clean(mutation.actionId),sessionId:clean(mutation?.payload?.source_session_id)}}));
          return;
        }
        setStatus('WAIT · Another Canonical action is pending.',true,`session queue ${pending.length} · outbox ${outbox.length}`);return;
      }

      while(pending.length){
        const item=pending[0],session=clone(item.session||{}),sourceSessionId=clean(item.sourceSessionId||session.sessionId);
        if(!sourceSessionId||clean(session.status)!=='completed'||!clean(session.completedAt)||!Array.isArray(session.experiences)||!session.experiences.length){pending.shift();writePending(pending);continue;}
        const canonicalSessionId=await uuidV5(`session|standard:${sourceSessionId}`),existing=await getRow(db,SESSION_STORE,canonicalSessionId);
        if(existing){pending.shift();writePending(pending);continue;}
        const payload=canonicalSessionPayload(session,sourceSessionId,canonicalSessionId,meta.deviceKey||null);
        if(!payload.started_at||!payload.ended_at)throw new Error('Completed Standard session is missing required timestamps.');
        const intent={kind:'standard-practice-session-default',sourceSessionId,canonicalSessionId,completedAt:payload.ended_at,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'standard-session-insert-v1'};
        const actionId=await uuidV5(`sync-action|standard-session-default|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_sessions|${actionId}`);
        const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalStandardSessionDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName:'learning_sessions',rowKey:canonicalSessionId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};
        mutation.mutationHash=await sha256(stableStringify(mutation));await addOutbox(db,mutation);
        state.report={format:'WLP_CANONICAL_STANDARD_SESSION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{sourceSessionId,pendingBefore:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,sessionId:canonicalSessionId,sourceSessionId}};
        setStatus('PENDING · Completed Standard session staged.',true,`${sourceSessionId} · foreground sync will auto-push`);
        window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'standard-session-default-write',tableName:'learning_sessions',mutationKind:'insert',mutationCount:1,actionId,sessionId:sourceSessionId}}));
        return;
      }
      setStatus('READY · Standard session Canonical queue is clear.',true,'No write needed.');
    }catch(error){
      const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_STANDARD_SESSION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message]}};setStatus(`CHECK · ${message}`,false,'Pending Standard session data is retained locally; Canonical history was not silently overwritten.',true);
    }finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  function onCompleted(event){
    if(rollbackActive())return;
    const session=event?.detail?.session;
    if(!session||!enqueue(session)){setStatus('CHECK · Completed Standard session could not be queued.',false,'The local Standard Practice session history remains saved.',true);return;}
    void drain();
  }
  function onSyncComplete(event){
    if(event?.detail?.pass!==true||event?.detail?.deferred===true)return;
    state.recoveryAttempted=false;
    setTimeout(()=>{void drain();},160);
  }

  window.addEventListener('wlp-standard-practice-session-completed',onCompleted);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalStandardSessionWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length});
  if(auditActive())setStatus(rollbackActive()?'ROLLBACK · Standard session Canonical default write disabled.':'READY · Completed Standard sessions use Canonical outbox.',true,`pending ${readPending().length}`);
  if(!rollbackActive())setTimeout(()=>{void drain();},0);
})();
