/* WLP v1.8.6.306 — AI Practice Canonical-event derived-state production-read canary.
   Query-gated only: ?wlpAIDerivedReadCanary=1.
   When active, AI Study route/profile reads use an in-memory reconstruction from the
   Canonical AI event stream plus any newer/local-only AI events not yet represented in
   Canonical storage. The durable local route/profile snapshots are not changed.
   No Cloud, IndexedDB, localStorage, sync_outbox, Service Worker, or background writes. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.308-ai-derived-state-production-read-canary-stable-cache-v1';
  const FLAG='wlpAIDerivedReadCanary';
  const AI_ROUTE_KEY='wlp:ai-route-state:v1';
  const AI_PROFILE_KEY='wlp:ai-learner-profile:v1';
  const state={busy:false,ready:false,failure:'',canonicalEvents:[],derived:null,panel:null,status:null,detail:null};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const asArray=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
  const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const active=()=>new URLSearchParams(location.search).get(FLAG)==='1';
  const time=value=>{const n=Date.parse(String(value||''));return Number.isFinite(n)?n:0;};
  function safeParse(raw,fallback){try{const value=JSON.parse(raw);return value==null?clone(fallback):value;}catch(_){return clone(fallback);}}
  function canonicalize(value){
    if(Array.isArray(value))return value.map(canonicalize);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
  }
  function canonicalJson(value){return JSON.stringify(canonicalize(value));}
  function firstDiff(a,b,path='$'){
    if(Object.is(a,b))return '';
    if(Array.isArray(a)||Array.isArray(b)){
      if(!Array.isArray(a)||!Array.isArray(b))return path;
      if(a.length!==b.length)return `${path}.length(${a.length}!=${b.length})`;
      for(let i=0;i<a.length;i++){const hit=firstDiff(a[i],b[i],`${path}[${i}]`);if(hit)return hit;}
      return '';
    }
    const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
    if(ao||bo){
      if(!ao||!bo)return path;
      const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
      for(const key of keys){
        if(!Object.prototype.hasOwnProperty.call(a,key)||!Object.prototype.hasOwnProperty.call(b,key))return `${path}.${key}`;
        const hit=firstDiff(a[key],b[key],`${path}.${key}`);if(hit)return hit;
      }
      return '';
    }
    return `${path}(${JSON.stringify(a)}!=${JSON.stringify(b)})`;
  }
  function rawLocalRouteCount(){return Object.keys(asObject(asObject(safeParse(localStorage.getItem(AI_ROUTE_KEY)||'',{})).records)).length;}
  function rawLocalProfile(){return asObject(safeParse(localStorage.getItem(AI_PROFILE_KEY)||'',{}));}
  function eventId(event){return clean(event?.eventId||event?.event_id||event?.id);}
  function eventStamp(event){return time(event?.updatedAt||event?.createdAt||event?.timestamp);}
  function mergedEvents(){
    const data=window.WLPAIStudyData;
    const local=asArray(data?.readAIEvents?.());
    const byId=new Map();
    for(const event of state.canonicalEvents){const id=eventId(event);if(id)byId.set(id,clone(event));}
    for(const event of local){
      const id=eventId(event);if(!id)continue;
      const existing=byId.get(id);
      if(!existing||eventStamp(event)>=eventStamp(existing))byId.set(id,clone(event));
    }
    return [...byId.values()].sort((a,b)=>time(a?.createdAt||a?.timestamp)-time(b?.createdAt||b?.timestamp)||eventId(a).localeCompare(eventId(b)));
  }
  function rebuild(){
    const data=window.WLPAIStudyData;
    if(!data||typeof data.deriveDerivedState!=='function')throw new Error('AI Study derived-state builder is unavailable.');
    const events=mergedEvents();
    const latest=events.reduce((max,event)=>Math.max(max,eventStamp(event)),0);
    state.derived=data.deriveDerivedState(events,{generatedAt:latest?new Date(latest).toISOString():new Date(0).toISOString()});
    return {events,derived:state.derived};
  }
  function getRouteState(){if(!state.ready||!state.derived)return null;return clone(state.derived.routeState);}
  function getLearnerProfile(){if(!state.ready||!state.derived)return null;return clone(state.derived.learnerProfile);}

  function makePanel(){
    if(state.panel||!active())return;
    const panel=document.createElement('section');panel.id='wlp-ai-derived-read-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100006;right:8px;top:max(8px,env(safe-area-inset-top));width:min(450px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">AI Practice · Canonical-event derived-state read canary</strong><div id="wlp-ai-derived-read-status" style="margin-top:4px">Waiting…</div><div id="wlp-ai-derived-read-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-ai-derived-read-status');state.detail=panel.querySelector('#wlp-ai-derived-read-detail');
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  async function prepare(trigger='page-load'){
    if(!active())return false;if(state.busy)return state.ready;state.busy=true;show('Preparing Canonical-event derived-state read canary…',null,'Read-only. No WLP data will be changed.');
    try{
      if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
      const provider=window.WLPCanonicalStorageCompatibilityFacade,data=window.WLPAIStudyData;
      if(!provider?.open||provider.readOnly!==true)throw new Error('Read-only Canonical Storage Compatibility Facade is unavailable.');
      if(!data||typeof data.deriveDerivedState!=='function'||typeof data.readAIEvents!=='function')throw new Error('AI Study data layer is unavailable.');
      const facade=await provider.open();
      if(!facade?.readOnly||typeof facade.readAIStudyEvents!=='function')throw new Error('Canonical AI event reader is unavailable.');
      state.canonicalEvents=asArray(facade.readAIStudyEvents());
      state.ready=true;state.failure='';
      const {events,derived}=rebuild();
      const productionRoute=data.readRouteState();
      const productionProfile=data.readLearnerProfile();
      const routeCount=Object.keys(asObject(productionRoute?.records)).length;
      const derivedCount=Object.keys(asObject(derived?.routeState?.records)).length;
      const profileCounts=value=>[asArray(value?.productionTendencies).length,asArray(value?.reusableConstructions).length,asArray(value?.styleTendencies).length].join('/');
      const routeStableExact=canonicalJson(productionRoute)===canonicalJson(derived.routeState);
      const profileStableExact=canonicalJson(productionProfile)===canonicalJson(derived.learnerProfile);
      const pass=routeCount===derivedCount&&routeStableExact&&profileStableExact;
      const diff=!routeStableExact?`route first diff ${firstDiff(productionRoute,derived.routeState)}`:!profileStableExact?`profile first diff ${firstDiff(productionProfile,derived.learnerProfile)}`:'';
      show(pass?'READY · Normal AI route/profile reads are using Canonical-event reconstruction.':'CHECK · Production read did not match the reconstructed state.',pass,`Canonical events ${state.canonicalEvents.length} · merged events ${events.length}\nraw local route ${rawLocalRouteCount()} → production route ${routeCount}\nroute stable exact ${routeStableExact?'yes':'no'} · profile stable exact ${profileStableExact?'yes':'no'}\nprofile counts ${profileCounts(productionProfile)} · outbox overlay included by Canonical facade${diff?`\n${diff}`:''}\ntrigger ${trigger}`);
      return pass;
    }catch(error){state.ready=false;state.failure=error?.message||String(error);show(`CHECK · ${state.failure}`,false,'Canary fell back to existing local route/profile reads. No data was changed.');return false;}
    finally{state.busy=false;}
  }

  window.WLPCanonicalAIDerivedReadCanary=Object.freeze({version:1,appVersion:APP_VERSION,isActive:active,isReady:()=>state.ready,prepare,getRouteState,getLearnerProfile,getState:()=>({active:active(),ready:state.ready,failure:state.failure,canonicalEvents:state.canonicalEvents.length,rawLocalRouteRecords:rawLocalRouteCount(),rawLocalProfile:clone(rawLocalProfile())})});
  window.addEventListener('wlp-canonical-outbox-staged',event=>{if(!active()||clean(event?.detail?.sourceStream)!=='ai')return;setTimeout(()=>{void prepare('ai-outbox-staged');},40);});
  window.addEventListener('wlp-canonical-auto-sync-complete',event=>{if(!active()||event?.detail?.pass!==true||event?.detail?.deferred===true)return;setTimeout(()=>{void prepare('foreground-sync-complete');},160);});
  if(active()){makePanel();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{void prepare();},0),{once:true});else setTimeout(()=>{void prepare();},0);}
})();
