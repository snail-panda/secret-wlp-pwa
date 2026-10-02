/* WLP v1.8.6.259 — Review Canonical read authority preflight.
   Query-gated by ?wlpCanonicalReviewRead=1; normal Review remains unchanged.
   This read-only preflight treats the installed Canonical materialized mirror as authority,
   verifies the exact post-v256 sync state directly from IndexedDB, renders Review through
   the Canonical Storage Compatibility Facade, and classifies the known legacy divergence
   without treating stale localStorage membership as authority. No write occurs. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.259-review-canonical-read-authority-preflight-v1';
  const FLAG='wlpCanonicalReviewRead';
  const PROGRESS_PREFIX='fc:wordid:';
  const STUDYQ_EVENT_KEY='wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY='wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY='wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY='wlp:stage7:interaction-events:v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const EXPECTED={
    candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425,
    materializedSyncCursor:20,materializedRows:21437,materializedManifestHash:'d807c9c222f48a9749d7a46a64cbe1ea953ef0df43a260e1cd701a6f30025d8e',
    reviewCounts:{total:24,high:9,medium:11,light:2,unassigned:2},
    canonicalOnly:['2884','3817','5396','5397','5398','5553','5909','6390','6792'],legacyOnly:['2876']
  };
  const requested=new URLSearchParams(location.search).get(FLAG)==='1';
  const state={active:false,facade:null,report:null,prepareError:'',observer:null,auditTimer:null,mirror:null,readCounts:{review:0,progress:0,standard:0,standardSessions:0,ai:0,interaction:0}};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').trim();
  const sameArray=(a,b)=>JSON.stringify([...(a||[])].sort((x,y)=>String(x).localeCompare(String(y),undefined,{numeric:true})))===JSON.stringify([...(b||[])].sort((x,y)=>String(x).localeCompare(String(y),undefined,{numeric:true})));
  function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});}
  async function readMirrorStatus(){
    if(!('indexedDB' in window))throw new Error('IndexedDB is unavailable.');
    let db=null;
    try{
      db=await new Promise((resolve,reject)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{if(upgrading){r.result.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const candidate=r.result;const missing=[META_STORE,OUTBOX_STORE].filter(s=>!candidate.objectStoreNames.contains(s));if(missing.length){candidate.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(candidate);};r.onerror=()=>reject(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});
      const tx=db.transaction([META_STORE,OUTBOX_STORE],'readonly'),metaStore=tx.objectStore(META_STORE),outboxStore=tx.objectStore(OUTBOX_STORE);
      const [meta,cursor,outbox]=await Promise.all([req(metaStore.get(META_KEY)),req(metaStore.get(CURSOR_KEY)),req(outboxStore.getAll())]);await txDone(tx);
      const syncCursor=Math.max(Number(meta?.materializedSyncCursor||0),Number(meta?.lastSyncCursor||0),Number(cursor?.lastSyncCursor||0));
      return{meta:clone(meta||{}),cursor:clone(cursor||{}),syncCursor,materializedManifestHash:String(meta?.materializedManifestHash||cursor?.materializedManifestHash||''),materializedRows:Number(meta?.materializedCanonicalRowCount||cursor?.materializedCanonicalRowCount||0),outboxRows:Array.isArray(outbox)?outbox.length:0};
    }finally{try{db?.close();}catch(_){}}
  }
  function makePanel(){
    if(!requested||document.getElementById('wlp-review-read-audit-box'))return;
    const box=document.createElement('section');box.id='wlp-review-read-audit-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(430px,calc(100vw - 16px));max-height:56vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Review Read · authority preflight</strong><div id="wlp-review-read-audit-status" style="margin-top:4px">Preparing Canonical Review…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-review-read-audit-export" type="button" disabled>Export JSON</button><a href="./review.html" style="align-self:center">Return to normal Review</a></div><div id="wlp-review-read-audit-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);box.querySelector('button').style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';
    document.getElementById('wlp-review-read-audit-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){
    const el=document.getElementById('wlp-review-read-audit-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}
    const d=document.getElementById('wlp-review-read-audit-detail');if(d)d.textContent=detail;
    const exp=document.getElementById('wlp-review-read-audit-export');if(exp)exp.disabled=!state.report;
  }
  async function waitForStorageFacade(){for(let i=0;i<80;i++){const provider=window.WLPCanonicalStorageCompatibilityFacade;if(provider?.open)return provider;await new Promise(r=>setTimeout(r,25));}return null;}
  function normalizeRecord(record){
    const wordId=clean(record?.wordId);const review=record?.review===true||record?.lastResult==='review';const rawLevel=clean(record?.reviewLevel).toLowerCase();const reviewLevel=['high','medium','light'].includes(rawLevel)?rawLevel:'';const reviewReasons=Array.isArray(record?.reviewReasons)?record.reviewReasons.map(x=>clean(x).toLowerCase()).filter(Boolean).sort():[];
    return{wordId,review,reviewLevel,reviewReasons,firstSeen:Number(record?.firstSeen||0),known:record?.known===true,studied:record?.studied===true||record?.known===true};
  }
  function readLegacyReview(){
    const out=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith(PROGRESS_PREFIX))continue;try{const raw=JSON.parse(localStorage.getItem(key)||'{}'),record=normalizeRecord({...raw,wordId:raw.wordId||key.slice(PROGRESS_PREFIX.length)});if(record.wordId&&record.review)out.push(record);}catch(_){}}
    return out.sort((a,b)=>a.wordId.localeCompare(b.wordId,undefined,{numeric:true}));
  }
  function legacyProgress(wordId){try{return normalizeRecord({...JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`)||'{}'),wordId});}catch{return normalizeRecord({wordId});}}
  function canonicalReview(){return (state.facade?.readReviewRecords?.()||[]).map(normalizeRecord).filter(x=>x.wordId&&x.review).sort((a,b)=>a.wordId.localeCompare(b.wordId,undefined,{numeric:true}));}
  function canonicalProgress(wordId){return normalizeRecord(state.facade?.readProgressRecord?.(wordId)||{wordId});}
  function counts(records){const out={total:records.length,high:0,medium:0,light:0,unassigned:0};for(const r of records){if(r.reviewLevel)out[r.reviewLevel]++;else out.unassigned++;}return out;}
  function domCounts(){const n=id=>Number(clean(document.getElementById(id)?.textContent).replace(/,/g,''));return{total:n('review-total'),high:n('review-high'),medium:n('review-medium'),light:n('review-light'),unassigned:n('review-unassigned')};}
  function sameReasons(a,b){return JSON.stringify(a||[])===JSON.stringify(b||[]);}
  function sameCounts(a,b){return Object.keys(EXPECTED.reviewCounts).every(k=>Number(a?.[k])===Number(b?.[k]));}
  function visibleSuggestionCount(){return [...document.querySelectorAll('[data-review-suggestion]')].filter(el=>el.offsetParent!==null).length;}
  function scheduleAudit(){if(!state.active||state.report)return;clearTimeout(state.auditTimer);state.auditTimer=setTimeout(runAudit,120);}
  function observe(){if(state.observer)return;const root=document.getElementById('review-list');if(!root)return;state.observer=new MutationObserver(scheduleAudit);state.observer.observe(root,{childList:true,subtree:true});scheduleAudit();}
  async function runAudit(){
    if(!state.active||state.report)return;const list=document.getElementById('review-list');if(!list||list.querySelector('.review-loading')){scheduleAudit();return;}
    const canonical=canonicalReview(),legacy=readLegacyReview(),cMap=new Map(canonical.map(r=>[r.wordId,r])),lMap=new Map(legacy.map(r=>[r.wordId,r]));
    const canonicalOnly=[...cMap.keys()].filter(id=>!lMap.has(id)),legacyOnly=[...lMap.keys()].filter(id=>!cMap.has(id)),attentionMismatches=[],reasonMismatches=[];
    for(const [id,c] of cMap){const l=lMap.get(id);if(!l)continue;if(c.reviewLevel!==l.reviewLevel)attentionMismatches.push({wordId:id,legacy:l.reviewLevel,canonical:c.reviewLevel});if(!sameReasons(c.reviewReasons,l.reviewReasons))reasonMismatches.push({wordId:id,legacy:l.reviewReasons,canonical:c.reviewReasons});}
    const canonicalCounts=counts(canonical),legacyCounts=counts(legacy),dom=domCounts(),domMatchesCanonical=Object.keys(canonicalCounts).every(k=>Number.isFinite(dom[k])&&dom[k]===canonicalCounts[k]);
    const unresolved=canonical.filter(r=>{const bundle=state.facade?.getCardBundle?.(r.wordId);return !bundle?.card||!bundle?.content;}).map(r=>r.wordId);
    const missingFirstSeen=canonical.filter(r=>!(Number(r.firstSeen)>0)).map(r=>r.wordId);
    const c2876=canonicalProgress('2876'),l2876=legacyProgress('2876'),knownLegacyDivergence2876=c2876.review===false&&c2876.studied===true&&l2876.review===true;
    const knownMembershipDivergence=sameArray(canonicalOnly,EXPECTED.canonicalOnly)&&sameArray(legacyOnly,EXPECTED.legacyOnly)&&attentionMismatches.length===0&&reasonMismatches.length===0&&knownLegacyDivergence2876;
    const mirror=state.mirror||{},mirrorCurrent=mirror.syncCursor===EXPECTED.materializedSyncCursor&&mirror.materializedRows===EXPECTED.materializedRows&&mirror.materializedManifestHash===EXPECTED.materializedManifestHash&&mirror.outboxRows===0;
    const blocking=[];
    if(!mirrorCurrent)blocking.push(`Materialized mirror is not the exact post-v256 state (cursor ${mirror.syncCursor||0}, rows ${mirror.materializedRows||0}).`);
    if(!sameCounts(canonicalCounts,EXPECTED.reviewCounts))blocking.push(`Canonical Review counts changed unexpectedly (${canonicalCounts.total} total).`);
    if(!domMatchesCanonical)blocking.push('Rendered Review summary does not match Canonical Review counts.');
    if(unresolved.length)blocking.push(`${unresolved.length} Canonical Review row(s) cannot resolve card + content.`);
    if(missingFirstSeen.length)blocking.push(`${missingFirstSeen.length} Canonical Review row(s) are missing explicit firstSeen.`);
    if(!knownMembershipDivergence)blocking.push('Legacy/Canonical divergence no longer matches the already-classified post-cutover difference.');
    const pass=blocking.length===0,warnings=[];
    warnings.push(`Legacy localStorage is a stale per-device projection here: Canonical-only ${canonicalOnly.length}, legacy-only ${legacyOnly.length}. This divergence is diagnostic, not authority.`);
    warnings.push('WID2876 is intentionally Canonical Studied while this device still has a legacy Review row from before the Study write cutover.');
    warnings.push('Suggested Attention Apply/Keep remain locked on this read-only route. Normal review.html is unchanged without ?wlpCanonicalReviewRead=1.');
    state.report={format:'WLP_CANONICAL_REVIEW_READ_AUTHORITY_PREFLIGHT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-canonical-authority-read-preflight-with-direct-materialized-mirror-check',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:mirror.meta?.candidateKey||state.facade?.meta?.candidateKey||null,headVersion:mirror.meta?.headVersion??state.facade?.meta?.headVersion??null,snapshotManifestHash:mirror.meta?.snapshotManifestHash||state.facade?.meta?.snapshotManifestHash||null,materializedSyncCursor:mirror.syncCursor,materializedManifestHash:mirror.materializedManifestHash||null,materializedRows:mirror.materializedRows},summary:{canonicalReviewRows:canonical.length,legacyReviewRows:legacy.length,canonicalOnly:canonicalOnly.length,legacyOnly:legacyOnly.length,attentionMismatches:attentionMismatches.length,learningNeedsMismatches:reasonMismatches.length,knownMembershipDivergence,knownLegacyDivergence2876,visibleSuggestedAttention:visibleSuggestionCount(),pendingOutboxRows:mirror.outboxRows,overlayMutationsApplied:Number(state.facade?.overlayMutationsApplied||0),domMatchesCanonical,unresolvedCanonicalRows:unresolved.length,missingFirstSeenRows:missingFirstSeen.length,mirrorCurrent,blockingIssues:blocking.length,nextPhaseEligible:pass,pass},counts:{canonical:canonicalCounts,legacy:legacyCounts,dom},mismatches:{canonicalOnly,legacyOnly,attention:attentionMismatches,learningNeeds:reasonMismatches},spotCheck2876:{canonical:c2876,legacy:l2876},mirror:{syncCursor:mirror.syncCursor,materializedRows:mirror.materializedRows,materializedManifestHash:mirror.materializedManifestHash,outboxRows:mirror.outboxRows},readCounts:clone(state.readCounts),checks:[['Direct IndexedDB mirror is exact post-v256 state',mirrorCurrent,`cursor ${mirror.syncCursor} · ${mirror.materializedRows} rows`],['Canonical Review counts are stable',sameCounts(canonicalCounts,EXPECTED.reviewCounts),`${canonicalCounts.total} · H${canonicalCounts.high}/M${canonicalCounts.medium}/L${canonicalCounts.light}/U${canonicalCounts.unassigned}`],['Review DOM matches Canonical authority',domMatchesCanonical,`${dom.total} rendered`],['All Canonical Review rows resolve card + content',unresolved.length===0,unresolved.length?unresolved.join(', '):'24/24'],['All Canonical Review rows retain explicit firstSeen',missingFirstSeen.length===0,missingFirstSeen.length?missingFirstSeen.join(', '):'24/24'],['Legacy divergence matches known post-cutover state',knownMembershipDivergence,`canonical-only ${canonicalOnly.length} · legacy-only ${legacyOnly.length}`],['WID2876 stale legacy Review is explained by Canonical Studied transition',knownLegacyDivergence2876,`Canonical ${c2876.studied?'Studied':'not Studied'} / legacy ${l2876.review?'Review':'not Review'}`]].map(([name,ok,evidence])=>({name,pass:Boolean(ok),evidence:String(evidence)})),issues:{blocking,warnings},invariants:{normalReviewRouteUnchanged:true,reviewRenderedFromCanonicalFacade:true,canonicalIsAuthorityForPreflight:true,legacyUsedForDiagnosticsOnly:true,noCloudWrites:true,noIndexedDbWrites:true,noLocalStorageWritesByAudit:true,suggestionWritesLocked:true}};
    setStatus(pass?'PASS · Canonical Review authority is ready for the next cutover step.':`BLOCKED · ${blocking.length} authority preflight issue(s).`,pass,`Canonical ${canonical.length} · Legacy ${legacy.length} · DOM ${dom.total} · cursor ${mirror.syncCursor}. Export JSON.`);
  }
  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const provider=await waitForStorageFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade is unavailable.');
      const [facade,mirror]=await Promise.all([provider.open(),readMirrorStatus()]),meta=facade.meta||{};
      if(String(meta.candidateKey||'')!==EXPECTED.candidateKey||Number(meta.headVersion||0)!==EXPECTED.headVersion||String(meta.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta.canonicalRowCount||0)!==EXPECTED.canonicalRows)throw new Error('Review authority preflight requires the exact ACTIVE Authority-v3 bootstrap anchor.');
      state.facade=facade;state.mirror=mirror;state.active=true;state.prepareError='';setStatus('READY · Rendering Review from Canonical authority…',null,`Direct mirror cursor ${mirror.syncCursor}; no write controls are active.`);observe();return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;state.report={format:'WLP_CANONICAL_REVIEW_READ_AUTHORITY_PREFLIGHT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[state.prepareError]}};setStatus(`BLOCKED · ${state.prepareError}`,false,'Normal Review remains available without the query flag.');return false;}
  }
  function readReviewRecords(){state.readCounts.review++;return state.facade?state.facade.readReviewRecords():[];}
  function readProgressRecord(wordId){state.readCounts.progress++;return state.facade?state.facade.readProgressRecord(wordId):{};}
  function readAIEvents(){state.readCounts.ai++;return state.facade?state.facade.readAIStudyEvents():[];}
  function readInteractionEvents(){state.readCounts.interaction++;return state.facade?state.facade.readInteractionEvents():[];}
  function readArray(key){if(!state.facade)return null;if(key===STUDYQ_EVENT_KEY){state.readCounts.standard++;return state.facade.readStudyQEvents();}if(key===STUDYQ_SESSION_KEY){state.readCounts.standardSessions++;return state.facade.readStudyQSessions();}if(key===AI_STUDY_EVENT_KEY){state.readCounts.ai++;return state.facade.readAIStudyEvents();}if(key===INTERACTION_EVENTS_KEY){state.readCounts.interaction++;return state.facade.readInteractionEvents();}if(String(key||'').startsWith(PROGRESS_PREFIX)){state.readCounts.progress++;return state.facade.readProgressRecord(String(key).slice(PROGRESS_PREFIX.length));}return null;}
  async function blockedWrite(){const message='v259 is a read-only Review authority preflight. Suggested Attention writes are locked on this route.';setStatus(`BLOCKED · ${message}`,false,'Return to normal Review; no storage write occurred.');return{pass:false,error:message};}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-review-read-authority-preflight-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  window.WLPCanonicalReviewWriteCandidate=Object.freeze({version:5,requested,isActive:()=>state.active,prepare,readReviewRecords,readProgressRecord,readArray,readAIEvents,readInteractionEvents,applySuggestion:blockedWrite,keepSuggestion:blockedWrite,getReport:()=>clone(state.report)});
  if(requested)makePanel();
})();
