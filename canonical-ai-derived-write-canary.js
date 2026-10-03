/* WLP v1.8.6.312 — AI Practice legacy route/profile write-suppression canary.
   Query-gated only: ?wlpAIDerivedWriteCanary=1.
   While active, ai-study-data.js still derives route/profile in memory from the AI event log,
   but does not rewrite the durable legacy localStorage route/profile snapshots.
   Canonical AI event/session writes and foreground sync remain unchanged.
   This canary verifies one interpreted AI turn can complete, reach Canonical storage, and feed
   the normal Canonical-event-derived production read while both legacy snapshots remain byte-identical.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.312-ai-derived-write-suppression-canary-v1';
  const FLAG = 'wlpAIDerivedWriteCanary';
  const AI_EVENT_KEY = 'wlp:ai-study-events:v1';
  const AI_ROUTE_KEY = 'wlp:ai-route-state:v1';
  const AI_PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1, OUTBOX_STORE = 'sync_outbox';
  const state = {
    armed:false, baselineReady:false, verifying:false, interpretedEventId:'',
    routeRaw:null, profileRaw:null, localEventsBefore:0, canonicalEventsBefore:0,
    panel:null, status:null, detail:null
  };

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const active = () => new URLSearchParams(location.search).get(FLAG) === '1';
  const asArray = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  function safeParse(raw, fallback){try{const value=JSON.parse(raw);return value==null?clone(fallback):value;}catch(_){return clone(fallback);}}
  function eventId(event){return clean(event?.eventId || event?.event_id || event?.id);}
  function canonicalize(value){if(Array.isArray(value))return value.map(canonicalize);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));}
  const canonicalJson = value => JSON.stringify(canonicalize(value));
  const req = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});

  function makePanel(){
    if(state.panel || !active()) return;
    const panel=document.createElement('section');panel.id='wlp-ai-derived-write-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100008;right:8px;top:max(8px,env(safe-area-inset-top));width:min(470px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">AI Practice · legacy route/profile write-suppression canary</strong><div id="wlp-ai-derived-write-status" style="margin-top:4px">Preparing…</div><div id="wlp-ai-derived-write-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-ai-derived-write-status');state.detail=panel.querySelector('#wlp-ai-derived-write-detail');
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function localEvents(){return asArray(safeParse(localStorage.getItem(AI_EVENT_KEY)||'[]',[]));}
  async function canonicalEvents(){
    const provider=window.WLPCanonicalStorageCompatibilityFacade;
    if(!provider?.open||provider.readOnly!==true)throw new Error('Read-only Canonical Storage Compatibility Facade is unavailable.');
    const facade=await provider.open();
    if(!facade?.readOnly||typeof facade.readAIStudyEvents!=='function')throw new Error('Canonical AI event reader is unavailable.');
    return asArray(facade.readAIStudyEvents());
  }
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}if(!db.objectStoreNames.contains(OUTBOX_STORE)){db.close();reject(new Error('sync_outbox store is unavailable.'));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function outboxCount(){const db=await openDb();try{const tx=db.transaction(OUTBOX_STORE,'readonly'),rows=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(rows)?rows.length:0;}finally{db.close();}}

  async function arm(){
    if(!active()||state.baselineReady)return;
    try{
      if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
      const reader=window.WLPCanonicalAIDerivedReadCanary,data=window.WLPAIStudyData;
      if(!reader?.isActive?.()||typeof reader.ensureReady!=='function')throw new Error('Canonical-event derived production reader is unavailable.');
      if(!data||typeof data.readAIEvents!=='function')throw new Error('AI Study data layer is unavailable.');
      const ready=await reader.ensureReady();if(ready!==true)throw new Error('Canonical-event derived production reader is not ready.');
      const canonical=await canonicalEvents();
      state.routeRaw=localStorage.getItem(AI_ROUTE_KEY);
      state.profileRaw=localStorage.getItem(AI_PROFILE_KEY);
      state.localEventsBefore=data.readAIEvents().length;
      state.canonicalEventsBefore=canonical.length;
      state.baselineReady=true;state.armed=true;
      show('READY · Legacy route/profile write suppression is armed.',true,`Canonical AI events ${state.canonicalEventsBefore} · local AI events ${state.localEventsBefore}\nComplete exactly one AI Practice experience. Local route/profile snapshots must remain byte-identical.`);
    }catch(error){show(`CHECK · ${error?.message||String(error)}`,false,'Do not run the canary turn until this is understood.');}
  }

  async function verify(trigger='sync-complete'){
    if(!active()||!state.baselineReady||!state.interpretedEventId||state.verifying)return;
    state.verifying=true;
    try{
      const routeUnchanged=localStorage.getItem(AI_ROUTE_KEY)===state.routeRaw;
      const profileUnchanged=localStorage.getItem(AI_PROFILE_KEY)===state.profileRaw;
      const local=localEvents();
      const localEventPresent=local.some(event=>eventId(event)===state.interpretedEventId);
      const reader=window.WLPCanonicalAIDerivedReadCanary,data=window.WLPAIStudyData;
      if(typeof reader?.prepare==='function')await reader.prepare('legacy-derived-write-canary-verify');
      const canonical=await canonicalEvents();
      const canonicalEventPresent=canonical.some(event=>eventId(event)===state.interpretedEventId);
      const productionRoute=data?.readRouteState?.();
      const productionProfile=data?.readLearnerProfile?.();
      const derivedRoute=reader?.getRouteState?.();
      const derivedProfile=reader?.getLearnerProfile?.();
      const routeExact=Boolean(productionRoute&&derivedRoute)&&canonicalJson(productionRoute)===canonicalJson(derivedRoute);
      const profileExact=Boolean(productionProfile&&derivedProfile)&&canonicalJson(productionProfile)===canonicalJson(derivedProfile);
      const outbox=await outboxCount();
      const pass=routeUnchanged&&profileUnchanged&&localEventPresent&&canonicalEventPresent&&routeExact&&profileExact&&outbox===0&&canonical.length>=state.canonicalEventsBefore+1;
      const detail=`event ${state.interpretedEventId}\nlocal AI events ${state.localEventsBefore} → ${local.length} · Canonical AI events ${state.canonicalEventsBefore} → ${canonical.length}\nlegacy route bytes unchanged ${routeUnchanged?'yes':'NO'} · legacy profile bytes unchanged ${profileUnchanged?'yes':'NO'}\nproduction route exact ${routeExact?'yes':'NO'} · production profile exact ${profileExact?'yes':'NO'} · outbox ${outbox}\ntrigger ${trigger}`;
      if(pass)show('PASS · AI turn succeeded without legacy route/profile writes.',true,detail);
      else show('CHECK · Write-suppression canary has not reached a clean PASS.',false,detail);
    }catch(error){show(`CHECK · ${error?.message||String(error)}`,false,'The legacy snapshots are still being checked; do not start another canary turn.');}
    finally{state.verifying=false;}
  }

  function onInterpreted(event){
    if(!active()||!state.baselineReady)return;
    const id=eventId(event?.detail?.event);if(!id)return;
    state.interpretedEventId=id;
    const routeUnchanged=localStorage.getItem(AI_ROUTE_KEY)===state.routeRaw;
    const profileUnchanged=localStorage.getItem(AI_PROFILE_KEY)===state.profileRaw;
    show(routeUnchanged&&profileUnchanged?'PENDING · AI event committed; legacy snapshots stayed unchanged.':'CHECK · A legacy derived snapshot changed during the turn.',routeUnchanged&&profileUnchanged,`event ${id}\nroute bytes unchanged ${routeUnchanged?'yes':'NO'} · profile bytes unchanged ${profileUnchanged?'yes':'NO'}\nWaiting for Canonical foreground sync.`);
  }
  function onSyncComplete(event){if(!active()||event?.detail?.pass!==true||event?.detail?.deferred===true)return;setTimeout(()=>{void verify('foreground-sync-complete');},450);}

  window.addEventListener('wlp-ai-practice-interpreted',onInterpreted);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalAIDerivedWriteCanary=Object.freeze({version:1,appVersion:APP_VERSION,isActive:active,verify:()=>verify('manual'),getState:()=>clone({armed:state.armed,baselineReady:state.baselineReady,interpretedEventId:state.interpretedEventId,localEventsBefore:state.localEventsBefore,canonicalEventsBefore:state.canonicalEventsBefore})});
  if(active()){makePanel();setTimeout(()=>{void arm();},0);}
})();
