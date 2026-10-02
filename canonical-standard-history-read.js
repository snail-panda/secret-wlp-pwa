/* WLP v1.8.6.294 — Standard Practice Canonical Recent Sessions read cutover.
   Normal Recent Sessions reads completed Standard history from the materialized Canonical
   learning_sessions + learning_events mirror. Existing local history remains the rollback/
   compatibility layer and supplies only local partial sessions or completed sessions still
   waiting for their Canonical session insert. Explicit rollback: ?wlpLegacyStandardHistoryRead=1.
   No Cloud writes, Service Worker changes, or background sync are introduced here. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.294-standard-history-default-read-v1';
  const ROLLBACK_FLAG='wlpLegacyStandardHistoryRead';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const SESSION_STORE='learning_sessions',EVENT_STORE='learning_events',META_STORE='sync_meta';
  const META_KEY='authority_mirror';
  const LOCAL_SESSION_KEY='wlp:studyq-sessions:v1';
  const PENDING_SESSION_KEY='WLP Canonical Standard Session Pending V1';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,ready:false,fallbackToLegacy:false,failure:'',canonicalSessions:[],canonicalRows:0,corrections:0,correctionsApplied:0,cursor:0,lastRefreshAt:''};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const rollbackActive=()=>new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[SESSION_STORE,EVENT_STORE,META_STORE].filter(name=>!db.objectStoreNames.contains(name));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),rows=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(rows)?rows:[];}
  async function getMeta(db){const tx=db.transaction(META_STORE,'readonly'),row=await req(tx.objectStore(META_STORE).get(META_KEY));await txDone(tx);return row||null;}
  function readLocalSessions(){try{const rows=JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY)||'[]');return Array.isArray(rows)?rows.filter(x=>x&&typeof x==='object'):[];}catch(_){return[];}}
  function pendingSessionIds(){try{const rows=JSON.parse(localStorage.getItem(PENDING_SESSION_KEY)||'[]');return new Set((Array.isArray(rows)?rows:[]).map(x=>clean(x?.sourceSessionId||x?.session?.sessionId)).filter(Boolean));}catch(_){return new Set();}}
  function timeValue(value){const n=new Date(value||0).getTime();return Number.isFinite(n)?n:0;}
  function sessionTime(session){return timeValue(session?.completedAt||session?.endedAt||session?.startedAt);}
  function ratingCounts(experiences=[]){const counts={'got-it':0,almost:0,'not-yet':0,'no-idea':0,unrated:0};for(const experience of experiences){const rating=clean(experience?.attempt?.selfRating);if(Object.prototype.hasOwnProperty.call(counts,rating))counts[rating]++;else counts.unrated++;}return counts;}
  function sessionEnvelope(row){if(!row||row.tombstone)return null;const p=row.payload;if(!p||typeof p!=='object'||clean(p.session_type)!=='standard')return null;const legacy=p.payload&&typeof p.payload==='object'?clone(p.payload):null;if(!legacy)return null;const sourceSessionId=clean(p.source_session_id||legacy.sessionId);if(!sourceSessionId)return null;legacy.sessionId=sourceSessionId;legacy.status=clean(legacy.status||p.status);legacy.sourceMode=clean(legacy.sourceMode||p.source_mode);legacy.startedAt=clean(legacy.startedAt||p.started_at);if(!clean(legacy.completedAt)&&clean(p.ended_at)&&legacy.status==='completed')legacy.completedAt=clean(p.ended_at);if(!clean(legacy.endedAt)&&clean(p.ended_at)&&legacy.status!=='completed')legacy.endedAt=clean(p.ended_at);return{sourceSessionId,legacy};}
  function eventEnvelope(row){if(!row||row.tombstone)return null;const p=row.payload;if(!p||typeof p!=='object'||clean(p.source_stream)!=='standard')return null;return{eventType:clean(p.event_type),occurredAt:clean(p.occurred_at||p.completed_at),payload:p.payload&&typeof p.payload==='object'?clone(p.payload):{}};}
  function applyCorrections(session,events){const legacy=clone(session.legacy),experiences=Array.isArray(legacy.experiences)?legacy.experiences:[];const byOriginal=new Map();for(const event of events){if(event.eventType!=='rating_correction')continue;const original=clean(event.payload?.originalEventId);if(!original)continue;const list=byOriginal.get(original)||[];list.push(event);byOriginal.set(original,list);}let applied=0;for(const experience of experiences){const attempt=experience?.attempt;if(!attempt)continue;const eventId=clean(attempt.eventId),corrections=(byOriginal.get(eventId)||[]).sort((a,b)=>{const da=Number(a.payload?.chainDepth)||0,db=Number(b.payload?.chainDepth)||0;if(da!==db)return da-db;return timeValue(a.occurredAt)-timeValue(b.occurredAt);});if(!corrections.length)continue;const latest=corrections[corrections.length-1],rating=clean(latest.payload?.rating);if(rating){attempt.selfRating=rating;applied++;}}legacy.counts=ratingCounts(experiences);return{legacy,applied};}
  function localCompatibilityOverlay(canonical){const canonicalIds=new Set(canonical.map(x=>clean(x?.sessionId)).filter(Boolean)),pending=pendingSessionIds();return readLocalSessions().filter(session=>{const id=clean(session?.sessionId);if(!id||canonicalIds.has(id))return false;const status=clean(session?.status);return status!=='completed'||pending.has(id);});}
  function currentSessions(){if(rollbackActive()||!state.ready||state.fallbackToLegacy)return readLocalSessions().sort((a,b)=>sessionTime(b)-sessionTime(a));const canonical=clone(state.canonicalSessions),overlay=localCompatibilityOverlay(canonical);return canonical.concat(clone(overlay)).sort((a,b)=>sessionTime(b)-sessionTime(a));}
  function getState(){const sessions=currentSessions(),canonicalIds=new Set(state.canonicalSessions.map(x=>clean(x?.sessionId)).filter(Boolean)),compat=sessions.filter(x=>!canonicalIds.has(clean(x?.sessionId))).length;return{appVersion:APP_VERSION,rollbackActive:rollbackActive(),defaultCanonicalActive:!rollbackActive()&&state.ready&&!state.fallbackToLegacy,ready:state.ready,fallbackToLegacy:state.fallbackToLegacy,failure:state.failure,canonicalRows:state.canonicalRows,corrections:state.corrections,correctionsApplied:state.correctionsApplied,compatibilityOverlayRows:compat,visibleSessionRows:sessions.length,cursor:state.cursor,lastRefreshAt:state.lastRefreshAt};}
  function notify(){window.dispatchEvent(new CustomEvent('wlp-canonical-standard-history-updated',{detail:getState()}));}
  function applyRatingOverlay(sessionId,eventId,rating){const sid=clean(sessionId),eid=clean(eventId),next=clean(rating);if(!sid||!eid||!next)return false;const session=state.canonicalSessions.find(x=>clean(x?.sessionId)===sid);const experience=Array.isArray(session?.experiences)?session.experiences.find(x=>clean(x?.attempt?.eventId)===eid):null;if(!experience)return false;experience.attempt=experience.attempt||{};experience.attempt.selfRating=next;session.counts=ratingCounts(session.experiences);notify();return true;}

  async function refresh(trigger='manual'){
    if(rollbackActive()){state.ready=false;state.fallbackToLegacy=true;state.failure='';notify();return getState();}
    if(state.busy)return getState();state.busy=true;let db=null;
    try{
      db=await openDb();const [meta,sessionRows,eventRows]=await Promise.all([getMeta(db),getAll(db,SESSION_STORE),getAll(db,EVENT_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Standard history Canonical read requires ACTIVE Authority v3.');
      const envelopes=sessionRows.map(sessionEnvelope).filter(Boolean),events=eventRows.map(eventEnvelope).filter(Boolean),corrections=events.filter(x=>x.eventType==='rating_correction');let applied=0;
      const sessions=envelopes.map(session=>{const result=applyCorrections(session,events);applied+=result.applied;return result.legacy;}).filter(session=>clean(session?.sessionId)&&Array.isArray(session?.experiences)&&session.experiences.length).sort((a,b)=>sessionTime(b)-sessionTime(a));
      state.ready=true;state.fallbackToLegacy=false;state.failure='';state.canonicalSessions=sessions;state.canonicalRows=sessions.length;state.corrections=corrections.length;state.correctionsApplied=applied;state.cursor=Number(meta.materializedSyncCursor??meta.lastSyncCursor??0);state.lastRefreshAt=new Date().toISOString();notify();return getState();
    }catch(error){state.ready=false;state.fallbackToLegacy=true;state.failure=error?.message||String(error);console.warn('Canonical Standard history read fell back to local compatibility history:',state.failure);notify();return getState();}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  window.WLPCanonicalStandardHistoryRead=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,refresh,getSessions:()=>clone(currentSessions()),getState,applyRatingOverlay});
  window.addEventListener('wlp-canonical-auto-sync-complete',event=>{if(event?.detail?.pass!==true||event?.detail?.deferred===true)return;setTimeout(()=>{void refresh('foreground-sync-complete');},180);});
  setTimeout(()=>{void refresh('page-load');},0);
})();
