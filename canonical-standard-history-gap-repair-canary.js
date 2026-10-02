/* WLP v1.8.6.293 — Standard Practice Canonical history gap repair canary.
   When the read-only history audit finds exactly one local-only completed Standard session,
   this opt-in canary exposes a button inside the existing audit panel. Clicking it replays
   that existing local session through the proven v290 completed-session default writer.
   No automatic repair is performed. Enable with ?wlpStandardHistoryReadAudit=1. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.293-standard-history-gap-repair-canary-v1';
  const FLAG='wlpStandardHistoryReadAudit';
  const LOCAL_SESSION_KEY='wlp:studyq-sessions:v1';
  const state={busy:false,button:null,detail:null,lastSessionId:''};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const enabled=()=>new URLSearchParams(location.search).get(FLAG)==='1';
  function localSessions(){try{const rows=JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY)||'[]');return Array.isArray(rows)?rows.filter(x=>x&&typeof x==='object'):[];}catch(_){return[];}}

  function ensureUi(){
    const panel=document.querySelector('#wlp-standard-history-read-audit');
    if(!panel)return false;
    if(state.button&&state.button.isConnected)return true;
    const exportButton=panel.querySelector('#wlp-standard-history-read-export');
    if(!exportButton)return false;
    const button=document.createElement('button');
    button.type='button';
    button.id='wlp-standard-history-gap-repair-stage';
    button.textContent='Stage local-only session';
    button.style.cssText='margin-top:8px;margin-left:8px;padding:7px 10px;border:1px solid #b9c8be;border-radius:9px;background:#fff;font:inherit';
    const detail=document.createElement('div');
    detail.id='wlp-standard-history-gap-repair-detail';
    detail.style.cssText='margin-top:6px;font-size:12px;opacity:.84;white-space:pre-wrap';
    exportButton.insertAdjacentElement('afterend',button);
    button.insertAdjacentElement('afterend',detail);
    button.addEventListener('click',stageGap);
    state.button=button;state.detail=detail;
    return true;
  }

  function setUi(report){
    if(!ensureUi())return;
    const ids=Array.isArray(report?.identity?.localOnlySessionIds)?report.identity.localOnlySessionIds.map(clean).filter(Boolean):[];
    if(!ids.length){state.button.hidden=true;state.detail.textContent='History gap repair: no local-only Standard session remains.';return;}
    state.button.hidden=false;
    if(ids.length!==1){state.button.disabled=true;state.detail.textContent=`History gap repair stopped: expected exactly 1 local-only session, found ${ids.length}.`;return;}
    const sessionId=ids[0],detail=(Array.isArray(report?.identity?.localOnlySessionDetails)?report.identity.localOnlySessionDetails:[]).find(x=>clean(x?.sessionId)===sessionId);
    state.lastSessionId=sessionId;
    state.button.disabled=state.busy;
    state.button.textContent=state.busy?'Staging local-only session…':'Stage local-only session';
    const wid=(Array.isArray(detail?.wordIds)?detail.wordIds.map(clean).filter(Boolean):[]).join(', ')||'unknown';
    const deck=(Array.isArray(detail?.decks)?detail.decks.filter(v=>v!==null&&v!==undefined).join(', '):'')||'unknown';
    state.detail.textContent=`Repair candidate · ${sessionId}\nWID ${wid} · WLP ${deck} · ${clean(detail?.status)||'unknown'} · explicit click only`;
  }

  async function refresh(){
    if(!enabled())return;
    const audit=window.WLPCanonicalStandardHistoryReadAudit;
    if(!audit)return;
    let report=audit.getReport?.();
    if(!report)report=await audit.run?.('history-gap-repair-preflight');
    if(report)setUi(report);
  }

  function stageGap(){
    if(state.busy)return;
    const audit=window.WLPCanonicalStandardHistoryReadAudit,writer=window.WLPCanonicalStandardSessionWrite;
    const report=audit?.getReport?.();
    const ids=Array.isArray(report?.identity?.localOnlySessionIds)?report.identity.localOnlySessionIds.map(clean).filter(Boolean):[];
    if(ids.length!==1){setUi(report);return;}
    if(!writer){state.detail.textContent='CHECK · Canonical Standard session writer is unavailable.';return;}
    const sessionId=ids[0],session=localSessions().find(x=>clean(x?.sessionId)===sessionId);
    if(!session||clean(session?.status)!=='completed'||!clean(session?.completedAt)||!Array.isArray(session?.experiences)||!session.experiences.length){state.detail.textContent='CHECK · The local-only session is not a complete replayable Standard session.';return;}
    state.busy=true;setUi(report);
    window.dispatchEvent(new CustomEvent('wlp-standard-practice-session-completed',{detail:{session:clone(session),source:'canonical-standard-history-gap-repair-canary',appVersion:APP_VERSION}}));
    state.detail.textContent=`PENDING · ${sessionId}\nReplayed through the proven completed-session Canonical writer; waiting for foreground sync.`;
    setTimeout(()=>{state.busy=false;void refresh();},1200);
  }

  if(!enabled())return;
  window.WLPCanonicalStandardHistoryGapRepairCanary=Object.freeze({version:1,appVersion:APP_VERSION,refresh,stage:stageGap});
  window.addEventListener('wlp-canonical-auto-sync-complete',()=>setTimeout(()=>{state.busy=false;void refresh();},420));
  setTimeout(()=>{void refresh();},900);
})();
