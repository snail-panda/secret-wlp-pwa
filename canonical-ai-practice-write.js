/* WLP v1.8.6.298 — AI Practice default Canonical interpreted-event write.
   Interpreted AI Practice turns remain saved in the existing local AI event history for rollback/compat,
   and are also queued into the Canonical sync_outbox as append-only learning_events.
   AI sessions, route state, and learner profile are NOT cut over by this patch.
   Normal success is silent. Explicit rollback: ?wlpLegacyAIPracticeWrite=1.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.298-ai-practice-default-canonical-event-write-v1';
  const ROLLBACK_FLAG = 'wlpLegacyAIPracticeWrite';
  const AUDIT_FLAG = 'wlpAIPracticeWriteAudit';
  const PENDING_KEY = 'WLP Canonical AI Practice Pending V1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const META_STORE = 'sync_meta', OUTBOX_STORE = 'sync_outbox', EVENT_STORE = 'learning_events', CARD_STORE = 'cards';
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

  function rollbackActive(){return new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return new URLSearchParams(location.search).get(AUDIT_FLAG)==='1';}
  function readPending(){try{const value=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-100)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}
  function eventTime(event){return Date.parse(event?.updatedAt||event?.createdAt||event?.timestamp||0)||0;}
  function interpreted(event){return clean(event?.interpretationStatus)==='interpreted'&&event?.interpreterResult&&typeof event.interpreterResult==='object'&&!Array.isArray(event.interpreterResult)&&clean(event?.eventId)&&clean(event?.wordId)&&clean(event?.sessionId)&&clean(event?.createdAt||event?.timestamp);}

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-ai-default-write-audit';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100007;right:8px;top:max(8px,env(safe-area-inset-top));width:min(420px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical AI Practice · default event write</strong><div id="wlp-ai-default-write-status" style="margin-top:4px"></div><div id="wlp-ai-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-ai-default-write-status');state.detail=panel.querySelector('#wlp-ai-default-write-detail');
  }
  function setStatus(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE],missing=required.filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function enqueue(event){
    if(!interpreted(event))return false;
    const sourceEventId=clean(event.eventId),wordId=clean(event.wordId),sessionId=clean(event.sessionId);
    const pending=readPending();
    const next={sourceEventId,event:clone(event),queuedAt:new Date().toISOString()};
    const index=pending.findIndex(item=>clean(item?.sourceEventId)===sourceEventId);
    if(index>=0)pending[index]=next;else pending.push(next);
    const saved=writePending(pending);
    if(saved&&auditActive())setStatus(`QUEUED · WID${wordId} interpreted AI event.`,true,`session ${sessionId} · waiting for Canonical outbox`);
    return saved;
  }

  async function drain(){
    if(state.busy||rollbackActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){setStatus('READY · No pending AI Practice Canonical writes.',true,'Normal interpreted turns are queued automatically.');return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('AI Practice default write requires ACTIVE Authority v3.');
      if(outbox.length){setStatus('WAIT · Another Canonical action is pending.',true,`AI queue ${pending.length} · outbox ${outbox.length}`);return;}

      while(pending.length){
        const item=pending[0],event=clone(item.event||{}),sourceEventId=clean(item.sourceEventId||event.eventId),wordId=clean(event.wordId),sessionId=clean(event.sessionId);
        if(!sourceEventId||!wordId||!sessionId||!interpreted(event)){pending.shift();writePending(pending);continue;}
        const canonicalEventId=await uuidV5(`event|ai:${sourceEventId}`),existing=await getRow(db,EVENT_STORE,canonicalEventId);
        if(existing){pending.shift();writePending(pending);continue;}
        const cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);
        if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
        const occurredAt=new Date(eventTime(event)||Date.now()).toISOString();
        const intent={kind:'ai-practice-default-event',sourceEventId,canonicalEventId,cardId,wordId,sessionId,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'ai-event-only-v1'};
        const actionId=await uuidV5(`sync-action|ai-event|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`);
        const eventPayload={event_id:canonicalEventId,source_event_id:sourceEventId,card_id:cardId,session_id:null,event_type:'event',source_stream:'ai',occurred_at:occurredAt,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:Number(event.schemaVersion||event.version)||1,payload:event,imported_at:null,supersedes_event_id:null};
        const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalAIPracticeDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:canonicalEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
        await addOutbox(db,mutation);pending.shift();writePending(pending);
        state.report={format:'WLP_CANONICAL_AI_PRACTICE_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{wordId,sourceEventId,sessionId,eventType:'event',pendingAfter:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:canonicalEventId}};
        setStatus(`PENDING · WID${wordId} AI event staged.`,true,`queue ${pending.length} · foreground sync will auto-push`);
        window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'ai-default-write',sourceStream:'ai',actionId,wordId,eventType:'event',mutationCount:1}}));
        return;
      }
      setStatus('READY · AI Practice Canonical queue is clear.',true,'No write needed.');
    }catch(error){
      const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_AI_PRACTICE_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message]}};setStatus(`CHECK · ${message}`,false,'Pending AI Practice data is retained locally; do not create another Canonical write until this is understood.',true);
    }finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  function onInterpreted(event){if(rollbackActive())return;const aiEvent=event?.detail?.event;if(!aiEvent||!enqueue(aiEvent)){setStatus('CHECK · Interpreted AI Practice event could not be queued.',false,'The local AI Practice event remains saved.',true);return;}void drain();}
  function onSyncComplete(){setTimeout(()=>{void drain();},120);}

  window.addEventListener('wlp-ai-practice-interpreted',onInterpreted);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalAIPracticeWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length});
  if(auditActive())setStatus(rollbackActive()?'ROLLBACK · AI Practice Canonical default write disabled.':'READY · Interpreted AI Practice events use Canonical outbox.',true,`pending ${readPending().length}`);
  if(!rollbackActive())setTimeout(()=>{void drain();},0);
})();
