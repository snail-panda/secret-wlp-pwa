/* WLP v1.8.6.302 — AI Study History Canonical read cutover.
   Normal AI Study History reads completed AI sessions from the materialized Canonical
   learning_sessions mirror. Existing local AI Study History remains the rollback/
   compatibility layer and supplies only a completed session still waiting in the AI
   session pending queue or sync_outbox. Explicit rollback: ?wlpLegacyAIHistoryRead=1.
   AI route/profile authority is not changed here. No Cloud writes, Service Worker
   changes, or background sync are introduced here. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.302-ai-history-default-read-v1';
  const ROLLBACK_FLAG='wlpLegacyAIHistoryRead';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const SESSION_STORE='learning_sessions',OUTBOX_STORE='sync_outbox',META_STORE='sync_meta';
  const META_KEY='authority_mirror';
  const LOCAL_SESSION_KEY='wlp:ai-study-session-history:v1';
  const PENDING_SESSION_KEY='WLP Canonical AI Session Pending V1';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,ready:false,fallbackToLegacy:false,failure:'',canonicalSessions:[],canonicalRows:0,compatibilityOverlayRows:0,cursor:0,lastRefreshAt:''};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const rollbackActive=()=>new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[SESSION_STORE,OUTBOX_STORE,META_STORE].filter(name=>!db.objectStoreNames.contains(name));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),rows=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(rows)?rows:[];}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await req(tx.objectStore(META_STORE).get(META_KEY));await txDone(tx);return row||null;}
  function readLocalSessions(){try{const rows=JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY)||'[]');return Array.isArray(rows)?rows.filter(x=>x&&typeof x==='object'):[];}catch(_){return[];}}
  function pendingQueueIds(){try{const rows=JSON.parse(localStorage.getItem(PENDING_SESSION_KEY)||'[]');return new Set((Array.isArray(rows)?rows:[]).map(x=>clean(x?.sourceSessionId||x?.session?.sessionId)).filter(Boolean));}catch(_){return new Set();}}
  function outboxSessionIds(rows){const ids=new Set();for(const row of rows||[]){if(clean(row?.tableName)!=='learning_sessions')continue;const payload=row?.payload;if(!payload||typeof payload!=='object'||clean(payload.session_type)!=='ai')continue;const id=clean(payload.source_session_id||payload?.payload?.sessionId);if(id)ids.add(id);}return ids;}
  function timeValue(value){const n=new Date(value||0).getTime();return Number.isFinite(n)?n:0;}
  function sessionTime(session){return timeValue(session?.endedAt||session?.completedAt||session?.startedAt);}
  function sessionEnvelope(row){if(!row||row.tombstone)return null;const p=row.payload;if(!p||typeof p!=='object'||clean(p.session_type)!=='ai')return null;const legacy=p.payload&&typeof p.payload==='object'?clone(p.payload):null;if(!legacy)return null;const sourceSessionId=clean(p.source_session_id||legacy.sessionId);if(!sourceSessionId)return null;legacy.sessionId=sourceSessionId;legacy.status=clean(legacy.status||p.status||'completed');legacy.startedAt=clean(legacy.startedAt||p.started_at);legacy.endedAt=clean(legacy.endedAt||p.ended_at);return{sourceSessionId,legacy};}
  function localCompatibilityOverlay(canonical,pendingIds){const canonicalIds=new Set(canonical.map(x=>clean(x?.sessionId)).filter(Boolean));return readLocalSessions().filter(session=>{const id=clean(session?.sessionId);return Boolean(id&&!canonicalIds.has(id)&&pendingIds.has(id));});}
  function currentSessions(){if(rollbackActive()||!state.ready||state.fallbackToLegacy)return readLocalSessions().sort((a,b)=>sessionTime(b)-sessionTime(a));const canonical=clone(state.canonicalSessions),overlay=localCompatibilityOverlay(canonical,state.pendingSessionIds||new Set());return canonical.concat(clone(overlay)).sort((a,b)=>sessionTime(b)-sessionTime(a));}
  function getState(){const sessions=currentSessions();return{appVersion:APP_VERSION,rollbackActive:rollbackActive(),defaultCanonicalActive:!rollbackActive()&&state.ready&&!state.fallbackToLegacy,ready:state.ready,fallbackToLegacy:state.fallbackToLegacy,failure:state.failure,canonicalRows:state.canonicalRows,compatibilityOverlayRows:Math.max(0,sessions.length-state.canonicalSessions.length),visibleSessionRows:sessions.length,cursor:state.cursor,lastRefreshAt:state.lastRefreshAt};}
  function notify(){window.dispatchEvent(new CustomEvent('wlp-canonical-ai-history-updated',{detail:getState()}));}

  async function refresh(trigger='manual'){
    if(rollbackActive()){state.ready=false;state.fallbackToLegacy=true;state.failure='';notify();return getState();}
    if(state.busy)return getState();state.busy=true;let db=null;
    try{
      db=await openDb();const [meta,sessionRows,outboxRows]=await Promise.all([getMeta(db),getAll(db,SESSION_STORE),getAll(db,OUTBOX_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('AI Study History Canonical read requires ACTIVE Authority v3.');
      const byId=new Map();for(const item of sessionRows.map(sessionEnvelope).filter(Boolean)){const id=clean(item.sourceSessionId);if(!byId.has(id))byId.set(id,item.legacy);}
      const sessions=[...byId.values()].filter(session=>clean(session?.sessionId)&&Number(session?.completed||0)>0).sort((a,b)=>sessionTime(b)-sessionTime(a));
      const pendingIds=pendingQueueIds();for(const id of outboxSessionIds(outboxRows))pendingIds.add(id);
      state.ready=true;state.fallbackToLegacy=false;state.failure='';state.canonicalSessions=sessions;state.canonicalRows=sessions.length;state.pendingSessionIds=pendingIds;state.cursor=Number(meta.materializedSyncCursor??meta.lastSyncCursor??0);state.lastRefreshAt=new Date().toISOString();notify();return getState();
    }catch(error){state.ready=false;state.fallbackToLegacy=true;state.failure=error?.message||String(error);console.warn('Canonical AI Study History read fell back to local compatibility history:',state.failure);notify();return getState();}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  window.WLPCanonicalAIHistoryRead=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,refresh,getSessions:()=>clone(currentSessions()),getState});
  window.addEventListener('wlp-ai-practice-session-completed',()=>{setTimeout(()=>{void refresh('ai-session-completed');},40);});
  window.addEventListener('wlp-canonical-outbox-staged',event=>{if(clean(event?.detail?.sessionType)!=='ai')return;setTimeout(()=>{void refresh('ai-session-staged');},60);});
  window.addEventListener('wlp-canonical-auto-sync-complete',event=>{if(event?.detail?.pass!==true||event?.detail?.deferred===true)return;setTimeout(()=>{void refresh('foreground-sync-complete');},180);});
  setTimeout(()=>{void refresh('page-load');},0);
})();
