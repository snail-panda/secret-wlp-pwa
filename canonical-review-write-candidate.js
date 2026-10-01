/* WLP v1.8.6.258 — Review Canonical read cutover audit.
   Query-gated by ?wlpCanonicalReviewRead=1; normal Review remains unchanged.
   The audit route renders Review through the ACTIVE Canonical v3 Storage Compatibility
   Facade, compares the resulting Review membership/attention semantics with the current
   legacy localStorage projection, and exports a read-only cutover report. No storage or
   Cloud write occurs. Suggested Attention Apply/Keep are locked on this audit route. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.258-review-canonical-read-audit-v1';
  const FLAG='wlpCanonicalReviewRead';
  const PROGRESS_PREFIX='fc:wordid:';
  const STUDYQ_EVENT_KEY='wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY='wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY='wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY='wlp:stage7:interaction-events:v1';
  const EXPECTED={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,migrationVersion:'3',manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',canonicalRows:21425};
  const requested=new URLSearchParams(location.search).get(FLAG)==='1';
  const state={active:false,busy:false,facade:null,report:null,prepareError:'',observer:null,auditTimer:null,readCounts:{review:0,progress:0,standard:0,standardSessions:0,ai:0,interaction:0}};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').trim();
  function makePanel(){
    if(!requested||document.getElementById('wlp-review-read-audit-box'))return;
    const box=document.createElement('section');box.id='wlp-review-read-audit-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(390px,calc(100vw - 16px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Review Read · cutover audit</strong><div id="wlp-review-read-audit-status" style="margin-top:4px">Preparing Canonical Review…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-review-read-audit-export" type="button" disabled>Export JSON</button><a href="./review.html" style="align-self:center">Return to normal Review</a></div><div id="wlp-review-read-audit-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelector('button').style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';
    document.getElementById('wlp-review-read-audit-export')?.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){
    const el=document.getElementById('wlp-review-read-audit-status');if(el){el.textContent=text;el.style.fontWeight=ok===null?'500':'700';el.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';}
    const d=document.getElementById('wlp-review-read-audit-detail');if(d)d.textContent=detail;
    const exp=document.getElementById('wlp-review-read-audit-export');if(exp)exp.disabled=!state.report;
  }
  async function waitForStorageFacade(){for(let i=0;i<80;i++){const provider=window.WLPCanonicalStorageCompatibilityFacade;if(provider?.open)return provider;await new Promise(r=>setTimeout(r,25));}return null;}
  function normalizeRecord(record){
    const wordId=clean(record?.wordId);const review=record?.review===true||record?.lastResult==='review';
    const rawLevel=clean(record?.reviewLevel).toLowerCase();const reviewLevel=['high','medium','light'].includes(rawLevel)?rawLevel:'';
    const reviewReasons=Array.isArray(record?.reviewReasons)?record.reviewReasons.map(x=>clean(x).toLowerCase()).filter(Boolean).sort():[];
    return{wordId,review,reviewLevel,reviewReasons};
  }
  function readLegacyReview(){
    const out=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key||!key.startsWith(PROGRESS_PREFIX))continue;
      try{const raw=JSON.parse(localStorage.getItem(key)||'{}'),record=normalizeRecord({...raw,wordId:raw.wordId||key.slice(PROGRESS_PREFIX.length)});if(record.wordId&&record.review)out.push(record);}catch(_){ }
    }
    return out.sort((a,b)=>a.wordId.localeCompare(b.wordId,undefined,{numeric:true}));
  }
  function canonicalReview(){return (state.facade?.readReviewRecords?.()||[]).map(normalizeRecord).filter(x=>x.wordId&&x.review).sort((a,b)=>a.wordId.localeCompare(b.wordId,undefined,{numeric:true}));}
  function counts(records){const out={total:records.length,high:0,medium:0,light:0,unassigned:0};for(const r of records){if(r.reviewLevel)out[r.reviewLevel]++;else out.unassigned++;}return out;}
  function domCounts(){const n=id=>Number(clean(document.getElementById(id)?.textContent).replace(/,/g,''));return{total:n('review-total'),high:n('review-high'),medium:n('review-medium'),light:n('review-light'),unassigned:n('review-unassigned')};}
  function sameReasons(a,b){return JSON.stringify(a||[])===JSON.stringify(b||[]);}
  function visibleSuggestionCount(){return [...document.querySelectorAll('[data-review-suggestion]')].filter(el=>el.offsetParent!==null).length;}
  function scheduleAudit(){if(!state.active||state.report)return;clearTimeout(state.auditTimer);state.auditTimer=setTimeout(runAudit,120);}
  function observe(){if(state.observer)return;const root=document.getElementById('review-list');if(!root)return;state.observer=new MutationObserver(scheduleAudit);state.observer.observe(root,{childList:true,subtree:true});scheduleAudit();}
  async function runAudit(){
    if(!state.active||state.report)return;
    const list=document.getElementById('review-list');if(!list||list.querySelector('.review-loading')){scheduleAudit();return;}
    const canonical=canonicalReview(),legacy=readLegacyReview(),cMap=new Map(canonical.map(r=>[r.wordId,r])),lMap=new Map(legacy.map(r=>[r.wordId,r]));
    const canonicalOnly=[...cMap.keys()].filter(id=>!lMap.has(id)),legacyOnly=[...lMap.keys()].filter(id=>!cMap.has(id)),attentionMismatches=[],reasonMismatches=[];
    for(const [id,c] of cMap){const l=lMap.get(id);if(!l)continue;if(c.reviewLevel!==l.reviewLevel)attentionMismatches.push({wordId:id,legacy:l.reviewLevel,canonical:c.reviewLevel});if(!sameReasons(c.reviewReasons,l.reviewReasons))reasonMismatches.push({wordId:id,legacy:l.reviewReasons,canonical:c.reviewReasons});}
    const canonicalCounts=counts(canonical),legacyCounts=counts(legacy),dom=domCounts();
    const domMatchesCanonical=Object.keys(canonicalCounts).every(k=>Number.isFinite(dom[k])&&dom[k]===canonicalCounts[k]);
    const blocking=[];
    if(canonicalOnly.length||legacyOnly.length)blocking.push(`Review membership differs: canonical-only ${canonicalOnly.length}, legacy-only ${legacyOnly.length}.`);
    if(attentionMismatches.length)blocking.push(`${attentionMismatches.length} Review Attention level mismatch(es).`);
    if(reasonMismatches.length)blocking.push(`${reasonMismatches.length} Learning Needs mismatch(es).`);
    if(!domMatchesCanonical)blocking.push('Rendered Review summary does not match Canonical Review counts.');
    const meta=state.facade?.meta||{},pass=blocking.length===0;
    state.report={format:'WLP_CANONICAL_REVIEW_READ_CUTOVER_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'query-gated-live-review-render-from-canonical-facade',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:meta.candidateKey||null,headVersion:meta.headVersion??null,snapshotManifestHash:meta.snapshotManifestHash||null,materializedSyncCursor:Math.max(Number(meta.lastSyncCursor||0),Number(meta.materializedSyncCursor||0)),materializedManifestHash:meta.materializedManifestHash||null,materializedRows:meta.materializedCanonicalRowCount??null},summary:{canonicalReviewRows:canonical.length,legacyReviewRows:legacy.length,canonicalOnly:canonicalOnly.length,legacyOnly:legacyOnly.length,attentionMismatches:attentionMismatches.length,learningNeedsMismatches:reasonMismatches.length,visibleSuggestedAttention:visibleSuggestionCount(),pendingOutboxRows:Number(state.facade?.pendingOutboxRows||0),overlayMutationsApplied:Number(state.facade?.overlayMutationsApplied||0),domMatchesCanonical,blockingIssues:blocking.length,nextPhaseEligible:pass,pass},counts:{canonical:canonicalCounts,legacy:legacyCounts,dom},mismatches:{canonicalOnly,legacyOnly,attention:attentionMismatches,learningNeeds:reasonMismatches},readCounts:clone(state.readCounts),issues:{blocking,warnings:['This is a read-only cutover audit. Normal review.html remains unchanged without ?wlpCanonicalReviewRead=1.','Suggested Attention Apply/Keep are intentionally locked on this audit route; no Review write is exercised here.']},invariants:{normalReviewRouteUnchanged:true,reviewRenderedFromCanonicalFacade:true,noCloudWrites:true,noIndexedDbWrites:true,noLocalStorageWritesByAudit:true,suggestionWritesLocked:true}};
    setStatus(pass?'PASS · Canonical Review render matches the current Review projection.':`BLOCKED · ${blocking.length} Review read issue(s).`,pass,`Canonical ${canonical.length} · Legacy ${legacy.length} · DOM ${dom.total}. Export JSON.`);
  }
  async function prepare(){
    if(!requested)return false;if(state.active)return true;makePanel();
    try{
      const provider=await waitForStorageFacade();if(!provider?.open)throw new Error('Storage Compatibility Facade is unavailable.');
      const facade=await provider.open(),meta=facade.meta||{};
      if(String(meta.candidateKey||'')!==EXPECTED.candidateKey||Number(meta.headVersion||0)!==EXPECTED.headVersion||String(meta.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta.snapshotManifestHash||'')!==EXPECTED.manifestHash||Number(meta.canonicalRowCount||0)!==EXPECTED.canonicalRows)throw new Error('Review read audit requires the exact ACTIVE Authority-v3 mirror.');
      state.facade=facade;state.active=true;state.prepareError='';setStatus('READY · Rendering Review from Canonical facade…',null,'No write controls are active on this audit route.');observe();return true;
    }catch(error){state.prepareError=error?.message||String(error);state.active=false;state.report={format:'WLP_CANONICAL_REVIEW_READ_CUTOVER_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,nextPhaseEligible:false,pass:false},issues:{blocking:[state.prepareError]}};setStatus(`BLOCKED · ${state.prepareError}`,false,'Normal Review remains available without the query flag.');return false;}
  }
  function readReviewRecords(){state.readCounts.review++;return state.facade?state.facade.readReviewRecords():[];}
  function readProgressRecord(wordId){state.readCounts.progress++;return state.facade?state.facade.readProgressRecord(wordId):{};}
  function readAIEvents(){state.readCounts.ai++;return state.facade?state.facade.readAIStudyEvents():[];}
  function readInteractionEvents(){state.readCounts.interaction++;return state.facade?state.facade.readInteractionEvents():[];}
  function readArray(key){
    if(!state.facade)return null;
    if(key===STUDYQ_EVENT_KEY){state.readCounts.standard++;return state.facade.readStudyQEvents();}
    if(key===STUDYQ_SESSION_KEY){state.readCounts.standardSessions++;return state.facade.readStudyQSessions();}
    if(key===AI_STUDY_EVENT_KEY){state.readCounts.ai++;return state.facade.readAIStudyEvents();}
    if(key===INTERACTION_EVENTS_KEY){state.readCounts.interaction++;return state.facade.readInteractionEvents();}
    if(String(key||'').startsWith(PROGRESS_PREFIX)){state.readCounts.progress++;return state.facade.readProgressRecord(String(key).slice(PROGRESS_PREFIX.length));}
    return null;
  }
  async function blockedWrite(){const message='v258 is a read-only Review cutover audit. Suggested Attention writes are locked on this route.';setStatus(`BLOCKED · ${message}`,false,'Return to normal Review; no storage write occurred.');return{pass:false,error:message};}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-review-read-audit-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  window.WLPCanonicalReviewWriteCandidate=Object.freeze({version:4,requested,isActive:()=>state.active,prepare,readReviewRecords,readProgressRecord,readArray,readAIEvents,readInteractionEvents,applySuggestion:blockedWrite,keepSuggestion:blockedWrite,getReport:()=>clone(state.report)});
  if(requested)makePanel();
})();
