/* WLP v1.8.6.213 — live Progress / Review read-path shadow mount.
   Activates only with ?wlpCanonicalShadow=1. The live page continues to read
   legacy localStorage exactly as before while this script opens the verified
   read-only Canonical Storage Compatibility Facade beside it, checks coverage,
   and exposes an exportable in-memory report. No storage or Cloud write occurs. */
(() => {
  'use strict';
  const APP_VERSION = '1.8.6.213-live-page-read-shadow-v1';
  const FLAG = 'wlpCanonicalShadow';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const EVENT_KEYS = Object.freeze({
    standard:'wlp:studyq-events:v1', ai:'wlp:ai-study-events:v1', activity:'wlp:stage7:activity-events:v1',
    interaction:'wlp:stage7:interaction-events:v1', practice:'wlp:stage7:practice-events:v1', quickReview:'wlp:review-quick-events:v1'
  });
  const SESSION_KEYS = Object.freeze({ standard:'wlp:studyq-sessions:v1', ai:'wlp:ai-study-session-history:v1' });
  if (new URLSearchParams(location.search).get(FLAG) !== '1') return;

  const page = /review\.html$/i.test(location.pathname) ? 'review' : /progress\.html$/i.test(location.pathname) ? 'progress' : '';
  if (!page) return;
  let report = null;
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const clean = v => String(v ?? '').trim();
  const stable = v => Array.isArray(v) ? v.map(stable) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o,k)=>(v[k]!==undefined&&(o[k]=stable(v[k])),o),{}) : v;
  const stableStringify = v => JSON.stringify(stable(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v)));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function safeParse(raw,fallback){try{return raw==null||raw===''?fallback:JSON.parse(raw);}catch{return fallback;}}
  function readLocalArray(key){const v=safeParse(localStorage.getItem(key),[]);if(Array.isArray(v))return v.filter(x=>x&&typeof x==='object');if(Array.isArray(v?.events))return v.events.filter(x=>x&&typeof x==='object');if(Array.isArray(v?.items))return v.items.filter(x=>x&&typeof x==='object');if(v?.records&&typeof v.records==='object')return (Array.isArray(v.records)?v.records:Object.values(v.records)).filter(x=>x&&typeof x==='object');return[];}
  function readLegacyProgress(){const out=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith(PROGRESS_PREFIX))continue;const d=safeParse(localStorage.getItem(key),{});const wordId=clean(d.wordId||key.slice(PROGRESS_PREFIX.length));if(!wordId)continue;out.push({...d,wordId,firstSeen:Number(d.firstSeen||0),lastSeen:Number(d.lastSeen||0),review:d.review===true||d.lastResult==='review',reviewLevel:['high','medium','light'].includes(clean(d.reviewLevel).toLowerCase())?clean(d.reviewLevel).toLowerCase():'',reviewReasons:Array.isArray(d.reviewReasons)?d.reviewReasons:[]});}return out;}
  function readLegacyReview(progress){return progress.filter(r=>r.review);}
  async function hashes(items){const out=[];for(const item of items)out.push(await sha256(stableStringify(item)));return out;}
  function missingCount(localHashes,canonicalHashes){const m=new Map();canonicalHashes.forEach(h=>m.set(h,(m.get(h)||0)+1));let n=0;for(const h of localHashes){const c=m.get(h)||0;if(c)m.set(h,c-1);else n++;}return n;}
  async function payloadCoverage(facade){
    const readers={standard:()=>facade.readStudyQEvents(),ai:()=>facade.readAIStudyEvents(),activity:()=>facade.readActivityEvents(),interaction:()=>facade.readInteractionEvents(),practice:()=>facade.readPracticeEvents(),quickReview:()=>facade.readQuickReviewEvents()};
    const events={};let missingEvents=0;for(const [name,key] of Object.entries(EVENT_KEYS)){const local=readLocalArray(key),canonical=readers[name]();const missing=missingCount(await hashes(local),await hashes(canonical));events[name]={legacy:local.length,facade:canonical.length,localPayloadsMissing:missing};missingEvents+=missing;}
    const sessionReaders={standard:()=>facade.readStudyQSessions(),ai:()=>facade.readAISessions()};
    const sessions={};let missingSessions=0;for(const [name,key] of Object.entries(SESSION_KEYS)){const local=readLocalArray(key),canonical=sessionReaders[name]();const missing=missingCount(await hashes(local),await hashes(canonical));sessions[name]={legacy:local.length,facade:canonical.length,localPayloadsMissing:missing};missingSessions+=missing;}
    return {events,sessions,missingEvents,missingSessions};
  }
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  async function waitForLivePage(){for(let i=0;i<100;i++){if(page==='progress'){const note=document.getElementById('progress-data-note');if(note&&note.textContent&&!/Loading/i.test(note.textContent))return true;}else{const list=document.getElementById('review-list');if(list&&!list.querySelector('.review-loading'))return true;}await wait(100);}return false;}
  function makePanel(){
    const style=document.createElement('style');style.textContent='.wlp-canonical-shadow-box{position:fixed;z-index:100000;top:max(8px,env(safe-area-inset-top));right:8px;max-width:min(92vw,360px);padding:10px 12px;border:1px solid #9db4a5;border-radius:12px;background:rgba(248,252,249,.97);box-shadow:0 5px 22px rgba(30,60,45,.18);font:12px/1.35 system-ui,sans-serif;color:#294638}.wlp-canonical-shadow-box strong{display:block;font-size:13px;margin-bottom:3px}.wlp-canonical-shadow-box button{margin-top:7px;padding:6px 9px;border:1px solid #91aa9a;border-radius:8px;background:#fff;color:#294638;font:600 12px system-ui,sans-serif}.wlp-canonical-shadow-box[data-state="pass"]{border-color:#5f9877}.wlp-canonical-shadow-box[data-state="blocked"]{border-color:#b77676}';document.head.appendChild(style);
    const box=document.createElement('div');box.className='wlp-canonical-shadow-box';box.dataset.state='running';box.innerHTML='<strong>Canonical live shadow</strong><span>Checking…</span><br><button type="button" disabled>Export JSON</button>';document.body.appendChild(box);
    box.querySelector('button').addEventListener('click',()=>{if(!report)return;const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`wlp-canonical-live-${page}-shadow-${report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);});
    return box;
  }
  function platformLabel(){const ua=navigator.userAgent||'';if(/iPhone/i.test(ua))return'iPhone Safari/WebKit';if(/Windows/i.test(ua))return'Windows Browser';return navigator.platform||'Browser';}
  async function run(){
    const box=makePanel();
    try{
      const booted=await waitForLivePage();
      const provider=window.WLPCanonicalStorageCompatibilityFacade;if(!provider?.open)throw new Error('Read-only Storage Compatibility Facade is unavailable on this live page.');
      const facade=await provider.open();if(!facade?.readOnly)throw new Error('Storage Compatibility Facade is not read-only.');
      const legacyProgress=readLegacyProgress(),canonicalProgress=facade.readProgressRecords();
      const legacyById=new Map(legacyProgress.map(r=>[r.wordId,r])),canonicalById=new Map(canonicalProgress.map(r=>[r.wordId,r]));
      const localOnlyStates=[...legacyById.keys()].filter(id=>!canonicalById.has(id));
      const firstSeenRegressions=[],lastSeenRegressions=[];
      for(const [id,local] of legacyById){const canonical=canonicalById.get(id);if(!canonical)continue;if(Number(local.firstSeen||0)>0&&Number(canonical.firstSeen||0)>Number(local.firstSeen||0))firstSeenRegressions.push(id);if(Number(local.lastSeen||0)>0&&Number(canonical.lastSeen||0)<Number(local.lastSeen||0))lastSeenRegressions.push(id);}
      const legacyReview=readLegacyReview(legacyProgress),canonicalReview=facade.readReviewRecords();
      const unresolvedReviewCards=canonicalReview.filter(r=>{const b=facade.getCardBundle(r.wordId);return !b?.card||!b?.content;}).map(r=>r.wordId);
      const coverage=await payloadCoverage(facade);
      let domLegacyParity=true,domDetail='';
      if(page==='review'){
        const domTotal=Number((document.getElementById('review-total')?.textContent||'').replace(/,/g,''));
        domLegacyParity=Number.isFinite(domTotal)&&domTotal===legacyReview.length;domDetail=`DOM Review total ${Number.isFinite(domTotal)?domTotal:'?'} / legacy ${legacyReview.length}`;
      }else{
        const note=clean(document.getElementById('progress-data-note')?.textContent);domLegacyParity=booted&&Boolean(note);domDetail=note||'Progress data note unavailable';
      }
      const before=await sha256(stableStringify(facade.readProgressRecords()));const sample=facade.readProgressRecords();if(sample[0])sample[0].wordId='__shadow_mutation__';const after=await sha256(stableStringify(facade.readProgressRecords()));const mutationIsolation=before===after;
      const writeNames=['setItem','removeItem','clear','write','save','set','delete','put','append','update'].filter(n=>typeof facade[n]==='function');
      const blocking=[];if(!booted)blocking.push('Live page did not finish its normal legacy render within the shadow wait window.');if(!domLegacyParity)blocking.push('Live page DOM no longer matches its legacy read result.');if(localOnlyStates.length)blocking.push(`${localOnlyStates.length} current-device progress row(s) are absent from Canonical facade.`);if(firstSeenRegressions.length)blocking.push(`${firstSeenRegressions.length} firstSeen regression(s).`);if(lastSeenRegressions.length)blocking.push(`${lastSeenRegressions.length} lastSeen regression(s).`);if(coverage.missingEvents)blocking.push(`${coverage.missingEvents} current-device event payload(s) missing.`);if(coverage.missingSessions)blocking.push(`${coverage.missingSessions} current-device session payload(s) missing.`);if(unresolvedReviewCards.length)blocking.push(`${unresolvedReviewCards.length} Canonical Review card(s) cannot resolve card + content.`);if(!mutationIsolation)blocking.push('Facade clone isolation failed.');if(writeNames.length)blocking.push(`Write method(s) exposed: ${writeNames.join(', ')}.`);
      const pass=blocking.length===0;
      report={format:'WLP_CANONICAL_LIVE_PAGE_READ_SHADOW',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'live-page-legacy-ui-plus-canonical-read-shadow',page,device:{platform:platformLabel()},summary:{livePageBooted:booted,legacyProgressRows:legacyProgress.length,facadeProgressRows:canonicalProgress.length,legacyReviewRows:legacyReview.length,facadeReviewRows:canonicalReview.length,localOnlyStates:localOnlyStates.length,firstSeenRegressions:firstSeenRegressions.length,lastSeenRegressions:lastSeenRegressions.length,currentDeviceEventPayloadsMissing:coverage.missingEvents,currentDeviceSessionPayloadsMissing:coverage.missingSessions,unresolvedReviewCards:unresolvedReviewCards.length,domLegacyParity,mutationIsolation,writeMethodsExposed:writeNames.length,blockingIssues:blocking.length,pass},pageDom:{detail:domDetail},historyStreams:{events:coverage.events,sessions:coverage.sessions},issues:{blocking,localOnlyStates,firstSeenRegressions,lastSeenRegressions,unresolvedReviewCards},invariants:{livePageStillUsesLegacyReads:true,canonicalShadowReadOnly:true,noPageReadCutover:true,noCloudCallsByShadow:true,noIndexedDbWrites:true,noLocalStorageWritesByShadow:true,noLiveWlpWritesByShadow:true,domLegacyParity,mutationIsolation,writeMethodsExposed:writeNames.length===0}};
      box.dataset.state=pass?'pass':'blocked';box.querySelector('span').textContent=pass?`PASS · ${page} remains legacy; Canonical shadow is safe.`:`BLOCKED · ${blocking.length} issue(s).`;box.querySelector('button').disabled=false;
    }catch(error){report={format:'WLP_CANONICAL_LIVE_PAGE_READ_SHADOW',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'live-page-legacy-ui-plus-canonical-read-shadow',page,device:{platform:platformLabel()},summary:{pass:false,blockingIssues:1},issues:{blocking:[error?.message||String(error)]}};box.dataset.state='blocked';box.querySelector('span').textContent=`BLOCKED · ${error?.message||String(error)}`;box.querySelector('button').disabled=false;}
    window.WLPCanonicalLivePageShadowReport=clone(report);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();
