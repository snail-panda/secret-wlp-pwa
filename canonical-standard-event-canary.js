/* WLP v1.8.6.284 — completed Standard Practice event-only Canonical transport canary.
   Query-gated by ?wlpCanonicalStandardEvent=1. Normal Study Hub behavior is unchanged.
   The canary selects the newest completed local Standard Practice event that is not yet
   materialized in Canonical learning_events, stages exactly one production-shaped append,
   and hands it to the foreground sync path. It does not alter legacy localStorage. */
(() => {
  'use strict';

  const FLAG = 'wlpCanonicalStandardEvent';
  if (new URLSearchParams(location.search).get(FLAG) !== '1') return;

  const APP_VERSION = '1.8.6.284-standard-event-only-transport-canary-v1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const META_STORE = 'sync_meta', OUTBOX_STORE = 'sync_outbox', EVENT_STORE = 'learning_events', CARD_STORE = 'cards';
  const META_KEY = 'authority_mirror', CURSOR_KEY = 'sync_cursor';
  const STANDARD_EVENT_KEY = 'wlp:studyq-events:v1';
  const NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE = {
    candidateKey: 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion: 3,
    manifestHash: '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  };
  const state = { busy:false, report:null, staged:null, legacyRaw:null, panel:null, status:null, detail:null, button:null, exportButton:null };

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify = value => JSON.stringify(stableValue(value));
  const utf8 = value => new TextEncoder().encode(String(value ?? ''));
  async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',utf8(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(value){const hex=String(value||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(hex))throw new Error('Invalid UUID namespace.');return new Uint8Array(hex.match(/../g).map(pair=>parseInt(pair,16)));}
  function bytesToUuid(bytes){const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-standard-event-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100002;right:8px;top:max(8px,env(safe-area-inset-top));width:min(420px,calc(100vw - 16px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical Standard Practice · event-only canary</strong><div id="wlp-standard-event-status" style="margin-top:4px">Checking…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-standard-event-stage" type="button">Stage latest completed event</button><button id="wlp-standard-event-export" type="button" disabled>Export JSON</button></div><div id="wlp-standard-event-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-standard-event-status');state.detail=panel.querySelector('#wlp-standard-event-detail');state.button=panel.querySelector('#wlp-standard-event-stage');state.exportButton=panel.querySelector('#wlp-standard-event-export');
    for(const button of [state.button,state.exportButton])button.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';
    state.button.addEventListener('click',stageLatest);state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;state.exportButton.disabled=!state.report;state.button.disabled=state.busy||Boolean(state.staged);}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-standard-event-canary-${String(state.report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE].filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getMeta(db,key){const tx=db.transaction(META_STORE,'readonly'),value=await req(tx.objectStore(META_STORE).get(key));await txDone(tx);return value||null;}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),value=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function localEvents(){try{const value=JSON.parse(localStorage.getItem(STANDARD_EVENT_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function eventTime(event){return Date.parse(event?.completedAt||event?.completed_at||event?.updatedAt||event?.startedAt||0)||0;}
  async function findLatestUnsynced(db){
    const candidates=localEvents().filter(event=>clean(event.eventId??event.event_id??event.id)&&clean(event.wordId)&&clean(event.completedAt??event.completed_at)).sort((a,b)=>eventTime(b)-eventTime(a));
    for(const event of candidates){const sourceEventId=clean(event.eventId??event.event_id??event.id),canonicalEventId=await uuidV5(`event|standard:${sourceEventId}`);if(!await getRow(db,EVENT_STORE,canonicalEventId))return{event:clone(event),sourceEventId,canonicalEventId};}
    return null;
  }

  async function stageLatest(){
    if(state.busy||state.staged)return;state.busy=true;setStatus('CHECKING · Looking for one completed unsynced Standard Practice event…');let db=null;
    try{
      db=await openDb();const [meta,cursorMeta,outbox]=await Promise.all([getMeta(db,META_KEY),getMeta(db,CURSOR_KEY),getOutbox(db)]);
      if(!meta||String(meta.candidateKey||'')!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||String(meta.snapshotManifestHash||'')!==BASE.manifestHash)throw new Error('Standard event canary requires ACTIVE Authority v3.');
      if(outbox.length!==0)throw new Error(`sync_outbox must be empty before this canary; found ${outbox.length}.`);
      const candidate=await findLatestUnsynced(db);if(!candidate){state.report={format:'WLP_CANONICAL_STANDARD_EVENT_ONLY_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{candidateFound:false,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['No completed local Standard Practice event is currently missing from Canonical learning_events. Complete one Standard Practice experience, then press the canary button again.']}};setStatus('READY · No unsynced completed Standard event found.',true,'Complete one Standard Practice experience if you want to run this transport canary.');return;}
      const {event,sourceEventId,canonicalEventId}=candidate,wordId=clean(event.wordId),cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);
      if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
      const occurredAt=new Date(eventTime(event)||Date.now()).toISOString(),completedAt=clean(event.completedAt??event.completed_at)||occurredAt;
      const eventType=clean(event.eventType??event.type??event.action??event.routeAction??event.result)||'event';
      if(eventType!=='event')throw new Error(`Latest unsynced Standard event has unsupported event type ${eventType}; this canary only migrates normal Standard attempt events.`);
      const intent={kind:'standard-practice-event-only-canary',sourceEventId,canonicalEventId,cardId,wordId,completedAt,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'standard-event-only-v1'};
      const actionId=await uuidV5(`sync-action|standard-event|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`);
      const eventPayload={event_id:canonicalEventId,source_event_id:sourceEventId,card_id:cardId,session_id:null,event_type:'event',source_stream:'standard',occurred_at:occurredAt,completed_at:completedAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:Number(event.schemaVersion||event.version)||1,payload:clone(event),imported_at:null,supersedes_event_id:null};
      const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalStandardEventTransportCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:canonicalEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
      state.legacyRaw=localStorage.getItem(STANDARD_EVENT_KEY);await addOutbox(db,mutation);state.staged={actionId,mutationId,eventId:canonicalEventId,sourceEventId,wordId,cursorBefore:Math.max(Number(meta.materializedSyncCursor??meta.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0))};
      state.report={format:'WLP_CANONICAL_STANDARD_EVENT_ONLY_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'real-completed-standard-event-to-canonical-outbox',summary:{candidateFound:true,staged:true,wordId,sourceEventId,eventType:'event',cursorBefore:state.staged.cursorBefore,outboxBefore:0,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:canonicalEventId,sourceEventId,wordId},issues:{blocking:[],warnings:['This canary migrates one real completed local Standard Practice event that was not yet present in Canonical learning_events.','Legacy Standard Practice localStorage is intentionally left byte-identical. Foreground sync should auto-push this one event.']},invariants:{oneEventOnlyMutation:true,noLearningStateMutation:true,noLegacyLocalStorageWrite:true}};
      setStatus(`PENDING · WID${wordId} completed Standard event staged.`,true,`source event ${sourceEventId} · waiting for foreground auto-sync`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'standard-canary',sourceStream:'standard',actionId,wordId,eventType:'event',mutationCount:1}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_STANDARD_EVENT_ONLY_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message],warnings:['No Cloud write is performed directly by this canary. If staging failed before the outbox insert, no Canonical data changed.']}};setStatus(`BLOCKED · ${message}`,false,'Do not stage another Canonical write until this is understood.');}
    finally{try{db?.close();}catch(_){}state.busy=false;if(!state.staged)state.button.disabled=false;}
  }

  async function onSyncComplete(event){
    const detail=event?.detail||{};if(!state.staged||clean(detail.actionId)!==state.staged.actionId)return;
    if(detail.pass!==true){setStatus(`CHECK · ${clean(detail.error)||'Foreground sync did not complete.'}`,false,'The staged outbox row is intentionally retained on failure.');return;}
    let db=null;try{db=await openDb();const [row,outbox,meta,cursorMeta]=await Promise.all([getRow(db,EVENT_STORE,state.staged.eventId),getOutbox(db),getMeta(db,META_KEY),getMeta(db,CURSOR_KEY)]);const legacyUnchanged=localStorage.getItem(STANDARD_EVENT_KEY)===state.legacyRaw,eventPresent=Boolean(row&&clean(row?.payload?.source_event_id)===state.staged.sourceEventId&&clean(row?.payload?.source_stream)==='standard'),outboxClear=outbox.length===0,cursorAfter=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0)),pass=eventPresent&&outboxClear&&legacyUnchanged&&cursorAfter>state.staged.cursorBefore;const blocking=[];if(!eventPresent)blocking.push('Canonical Standard event is missing after foreground sync.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!legacyUnchanged)blocking.push('Legacy Standard Practice localStorage changed during the canary.');if(!(cursorAfter>state.staged.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.staged.cursorBefore}.`);state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,staged:false,foregroundSynced:Boolean(detail.pass),cursorAfter,outboxAfter:outbox.length,eventPresent,legacyLocalStorageUntouched:legacyUnchanged,blockingIssues:blocking.length,pass},checks:[['Canonical learning_events contains the migrated Standard event',eventPresent,state.staged.eventId],['Foreground source outbox cleared after acknowledged commit',outboxClear,`outbox ${outbox.length}`],['Legacy Standard Practice localStorage stayed byte-identical',legacyUnchanged,legacyUnchanged?'unchanged':'changed'],['Canonical cursor advanced',cursorAfter>state.staged.cursorBefore,`${state.staged.cursorBefore} → ${cursorAfter}`]].map(([name,ok,evidence])=>({name,pass:Boolean(ok),evidence:String(evidence)})),issues:{blocking,warnings:['This proves one real completed Standard Practice event can travel through the production mutation ledger/change feed without rewriting legacy localStorage.','Standard Practice default writes are not cut over yet; this is transport canary only.']}};setStatus(pass?`PASS · WID${state.staged.wordId} Standard event reached Canonical.`:`BLOCKED · ${blocking.join(' ')}`,pass,`cursor ${state.staged.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}`);}
    catch(error){setStatus(`CHECK · ${error?.message||String(error)}`,false,'Foreground sync reported completion, but local verification could not finish.');}
    finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  makePanel();setStatus('READY · Canary is query-gated. No write has been staged.',true,'Press the button to migrate one existing completed Standard Practice event that is missing from Canonical.');
})();
