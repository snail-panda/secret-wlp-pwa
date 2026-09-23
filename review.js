(() => {
  const PROGRESS_PREFIX = 'fc:wordid:';
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY = 'wlp:ai-study-events:v1';
  const INTERACTION_EVENTS_KEY = 'wlp:stage7:interaction-events:v1';
  const EVENT_HISTORY_LIMIT = 5000;
  const SUGGESTION_POLICY_VERSION = '1.0.0';
  const ROLE_KEY = 'wlp:ui-role:v2';
  const SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const PAGE_SIZE = 40;
  const REASONS = [
    ['recall','Recall'],['meaning-hook','Meaning Hook'],['usage','Usage'],['context','Context'],
    ['real-life-use','Real-life use'],['nuance','Nuance'],['collocation','Collocation'],['pattern','Pattern'],
    ['pronunciation','Pronunciation'],['better-example','Better Example'],['more-exposure','More exposure']
  ];
  const reasonLabel = new Map(REASONS);
  const $ = id => document.getElementById(id);
  let rows = [];
  let reviewRecords = [];
  let rowByWordId = new Map();
  let levelFilter = '';
  let reasonFilter = '';
  let visibleLimit = PAGE_SIZE;
  let latestStandardEvidence = new Map();
  let latestAIEvidence = new Map();
  let aiEvidenceByWordId = new Map();
  let interactionEvents = [];

  function reviewReturnTarget(){
    const raw=new URLSearchParams(location.search).get('return');
    if(!raw)return null;
    try{
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin)return null;
      if(!url.pathname.endsWith('/progress.html'))return null;
      return {href:`./progress.html${url.search}${url.hash}`,label:'Back to Progress'};
    }catch{return null;}
  }
  function reviewScrollFromUrl(){
    const raw=new URLSearchParams(location.search).get('scroll');
    if(raw===null||raw==='')return null;
    const value=Number(raw);return Number.isFinite(value)&&value>=0?Math.round(value):null;
  }
  function restoreReviewReturnScroll(scrollY){
    if(!Number.isFinite(scrollY))return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      window.scrollTo({top:Math.max(0,scrollY),behavior:'auto'});
      try{const url=new URL(location.href);url.searchParams.delete('scroll');history.replaceState(history.state,'',url);}catch(_){}
    }));
  }
  function reviewReturnParamsWithScroll(){
    const params=new URLSearchParams(location.search);params.set('scroll',String(Math.max(0,Math.round(window.scrollY||0))));return params;
  }
  function reviewCardReturnHref(){const params=reviewReturnParamsWithScroll();return `../../review.html${params.toString()?`?${params.toString()}`:''}`;}
  function reviewEditorReturnHref(){const params=reviewReturnParamsWithScroll();return `review.html${params.toString()?`?${params.toString()}`:''}`;}
  function prepareReviewOutboundReturn(event){
    const link=event.target?.closest?.('a[href]');if(!link)return;
    try{
      const url=new URL(link.getAttribute('href')||'',location.href);
      if(url.origin!==location.origin)return;
      if(url.pathname.endsWith('/flashcards/wlp/batch.html')){
        url.searchParams.set('from','review');url.searchParams.set('return',reviewCardReturnHref());link.href=url.href;return;
      }
      if(link.classList.contains('review-card-edit')&&url.pathname.endsWith('/editor-local-edit.html')){
        url.searchParams.set('return',reviewEditorReturnHref());link.href=url.href;
      }
    }catch(_){}
  }
  function installReviewOutboundReturnNavigation(){
    document.addEventListener('pointerdown',prepareReviewOutboundReturn,true);
    document.addEventListener('click',prepareReviewOutboundReturn,true);
  }
  function installReviewReturnNavigation(){
    const target=reviewReturnTarget();if(!target)return;
    const top=document.querySelector('.review-back-link');
    const bottom=document.querySelector('.stage7-page-bottom-nav-item[data-stage7-back-source]');
    if(top){top.href=target.href;const label=top.querySelector('span');if(label)label.textContent=target.label;}
    if(bottom)bottom.href=target.href;
    const useHistoryBack=event=>{
      try{
        if(!document.referrer)return;
        const ref=new URL(document.referrer);
        if(ref.origin===location.origin&&ref.pathname.endsWith('/progress.html')){event.preventDefault();history.back();}
      }catch(_){}
    };
    if(top)top.addEventListener('click',useHistoryBack);
    if(bottom)bottom.addEventListener('click',useHistoryBack);
  }

  function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function parseTSV(text){
    const table=[]; let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i],next=text[i+1];
      if(ch==='"'){if(quoted&&next==='"'){field+='"';i++;}else quoted=!quoted;continue;}
      if(ch==='\t'&&!quoted){row.push(field);field='';continue;}
      if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);if(row.some(v=>String(v).trim()))table.push(row);row=[];field='';continue;}
      field+=ch;
    }
    row.push(field); if(row.some(v=>String(v).trim()))table.push(row);
    if(!table.length)return[];
    const headers=table[0].map(v=>String(v||'').trim());
    return table.slice(1).map(cols=>Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]??'').trim()])));
  }
  function readOverrides(){try{const v=JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY)||'{}');return v&&typeof v==='object'?v:{}}catch{return{}}}
  function applyOverrides(masterRows){
    const overrides=readOverrides();
    return masterRows.map(row=>{const wid=String(row.WordID||'').trim();const edit=overrides[wid];return edit&&typeof edit==='object'?{...row,...edit,WordID:row.WordID,'Batch #':row['Batch #']}:{...row};});
  }
  function readReviewRecords(){
    const out=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i); if(!key||!key.startsWith(PROGRESS_PREFIX))continue;
      try{
        const d=JSON.parse(localStorage.getItem(key)||'{}');
        const wid=String(d.wordId||key.slice(PROGRESS_PREFIX.length)).trim();
        const review=d.review===true||d.lastResult==='review'; if(!wid||!review)continue;
        const level=['high','medium','light'].includes(String(d.reviewLevel||'').toLowerCase())?String(d.reviewLevel).toLowerCase():'';
        const reasons=Array.isArray(d.reviewReasons)?d.reviewReasons.map(v=>String(v||'').toLowerCase()).filter(Boolean):[];
        out.push({...d,wordId:wid,review:true,reviewLevel:level,reviewReasons:reasons,lastAttentionUpdated:Number(d.lastAttentionUpdated||0),lastSeen:Number(d.lastSeen||0),reviewCount:Number(d.reviewCount||0)});
      }catch(e){console.warn('Could not read Review record',key,e);}
    }
    const rank={high:0,medium:1,light:2,'':3};
    out.sort((a,b)=>(rank[a.reviewLevel]-rank[b.reviewLevel])||(b.lastAttentionUpdated-a.lastAttentionUpdated)||(b.lastSeen-a.lastSeen)||(b.reviewCount-a.reviewCount));
    return out;
  }
  function readJsonArray(key){
    try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch{return[];}
  }
  function readAIEvents(){
    try{
      const value=JSON.parse(localStorage.getItem(AI_STUDY_EVENT_KEY)||'[]');
      let list=[];
      if(Array.isArray(value))list=value;
      else if(Array.isArray(value?.events))list=value.events;
      else if(Array.isArray(value?.items))list=value.items;
      else if(value?.records&&typeof value.records==='object')list=Array.isArray(value.records)?value.records:Object.values(value.records);
      return list.filter(item=>item&&typeof item==='object');
    }catch{return[];}
  }
  function readInteractionEvents(){return readJsonArray(INTERACTION_EVENTS_KEY);}
  function appendInteractionEvent(event){
    try{
      const list=readInteractionEvents();list.push(event);
      if(list.length>EVENT_HISTORY_LIMIT)list.splice(0,list.length-EVENT_HISTORY_LIMIT);
      localStorage.setItem(INTERACTION_EVENTS_KEY,JSON.stringify(list));interactionEvents=list;return true;
    }catch(e){console.warn('Could not save Review suggestion event',e);return false;}
  }
  function readProgressRecord(wordId){
    try{const value=JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${String(wordId||'').trim()}`)||'{}');return value&&typeof value==='object'?value:{};}catch{return{};}
  }
  function saveProgressRecord(wordId,value){localStorage.setItem(`${PROGRESS_PREFIX}${String(wordId||'').trim()}`,JSON.stringify(value));}
  function timestampFrom(values){
    for(const value of values){
      if(typeof value==='number'&&Number.isFinite(value)&&value>0)return value;
      const parsed=Date.parse(String(value||''));if(parsed)return parsed;
    }
    return 0;
  }
  function standardEventTimestamp(event){
    return timestampFrom([event?.completedAt,event?.startedAt,event?.occurredAt,event?.createdAt,event?.timestamp,event?.updatedAt]);
  }
  function aiEventTimestamp(event){
    return timestampFrom([event?.observedAt,event?.createdAt,event?.timestamp,event?.committedAt,event?.recordedAt,event?.interpretedAt,event?.receivedAt,event?.occurredAt,event?.updatedAt]);
  }
  function validStudyRating(value){return ['got-it','almost','not-yet','no-idea'].includes(String(value||'').trim().toLowerCase());}
  function ratingLabel(value){return ({'got-it':'Got it','almost':'Almost','not-yet':'Not yet','no-idea':'No idea'})[String(value||'').trim().toLowerCase()]||'';}
  function validAttention(value){return ['none','light','medium','high'].includes(String(value||'').trim().toLowerCase());}
  function attentionLabel(value){const key=String(value||'').trim().toLowerCase();return key==='none'?'None':key?key[0].toUpperCase()+key.slice(1):'';}
  function aiWordId(event){return String(event?.wordId||event?.targetWordId||event?.target?.wordId||event?.selectedTarget?.wordId||'').trim();}
  function aiEvidenceTypes(event){
    const values=Array.isArray(event?.evidenceTypes)?event.evidenceTypes:Array.isArray(event?.evidence?.evidenceTypes)?event.evidence.evidenceTypes:Array.isArray(event?.evidenceSummary?.evidenceTypes)?event.evidenceSummary.evidenceTypes:[];
    return values.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  }
  function aiEvidenceLabel(value){
    const labels={'recognition':'Recognition','cue-based-retrieval':'Cue-based retrieval','spontaneous-production':'Spontaneous production','context-transfer':'Context transfer','sense-transfer':'Sense transfer','reverse-reconstruction':'Reverse reconstruction','neighbor-discrimination':'Neighbor discrimination','free-composition':'Free composition','personal-anchor':'Personal anchor','form-control':'Form control','construction-use':'Construction use'};
    const key=String(value||'').trim().toLowerCase();return labels[key]||key.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  function formatEvidenceWhen(timestamp){
    if(!timestamp)return'';
    const d=new Date(timestamp);if(!Number.isFinite(d.getTime()))return'';
    const now=new Date();const day=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
    const diff=Math.round((today-day)/86400000);const time=d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    if(diff===0)return`Today · ${time}`;if(diff===1)return`Yesterday · ${time}`;
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  function standardSessionFallbackEvents(){
    const out=[];
    readJsonArray(STUDYQ_SESSION_KEY).forEach(session=>{
      const t=timestampFrom([session?.completedAt,session?.endedAt,session?.startedAt]);
      (Array.isArray(session?.experiences)?session.experiences:[]).forEach(experience=>{
        const attempt=experience?.attempt||{};const wordId=String(experience?.wordId||attempt?.wordId||'').trim();if(!wordId)return;
        out.push({...attempt,wordId,_reviewEvidenceTimestamp:t});
      });
    });
    return out;
  }
  function buildLatestStandardEvidence(){
    const map=new Map();const events=[...standardSessionFallbackEvents(),...readJsonArray(STUDYQ_EVENT_KEY)];
    events.forEach((event,index)=>{
      const wordId=String(event?.wordId||'').trim();if(!wordId)return;
      const hasSignal=validStudyRating(event?.selfRating)||validAttention(event?.reviewAttention)||Number(event?.hintCount)>0||event?.targetShown===true||String(event?.responseText||'').trim();if(!hasSignal)return;
      const timestamp=Number(event?._reviewEvidenceTimestamp)||standardEventTimestamp(event);const prior=map.get(wordId);
      if(!prior||timestamp>prior.timestamp||(timestamp===prior.timestamp&&index>prior.index))map.set(wordId,{event,timestamp,index});
    });
    return map;
  }
  function buildLatestAIEvidence(){
    const map=new Map();readAIEvents().forEach((event,index)=>{
      const wordId=aiWordId(event);if(!wordId)return;
      const timestamp=aiEventTimestamp(event);const prior=map.get(wordId);
      if(!prior||timestamp>prior.timestamp||(timestamp===prior.timestamp&&index>prior.index))map.set(wordId,{event,timestamp,index});
    });return map;
  }
  function buildAIEvidenceHistory(){
    const map=new Map();readAIEvents().forEach((event,index)=>{
      const wordId=aiWordId(event);if(!wordId)return;
      const timestamp=aiEventTimestamp(event);if(!map.has(wordId))map.set(wordId,[]);
      map.get(wordId).push({event,timestamp,index});
    });
    map.forEach(list=>list.sort((a,b)=>(a.timestamp-b.timestamp)||(a.index-b.index)));
    return map;
  }
  function aiSessionId(event){return String(event?.sessionId||event?.session?.sessionId||'').trim();}
  function aiInterpretation(event){return event?.interpretation||event?.response?.interpretation||event?.result?.response?.interpretation||{};}
  function aiResponseClasses(event){
    const interpretation=aiInterpretation(event);const values=Array.isArray(interpretation?.responseClasses)?interpretation.responseClasses:Array.isArray(event?.responseClasses)?event.responseClasses:[];
    return values.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  }
  function hasAIssue(value){
    if(value===null||value===undefined||value===false)return false;
    const text=String(value).trim().toLowerCase();return !['','none','null','false','no','n/a'].includes(text);
  }
  function aiTargetWasAssisted(event){
    const exp=event?.experience||event?.interpretationContext?.experience||event?.request?.interpretationContext?.experience||{};
    const visibility=String(exp?.targetVisibility||event?.targetVisibility||'').trim().toLowerCase();
    const targetVisible=String(exp?.targetVisible??event?.targetVisible??'').trim().toLowerCase();
    if(exp?.targetVisible===true||event?.targetVisible===true||targetVisible==='true'||targetVisible==='visible'||event?.targetShown===true||event?.targetRevealed===true)return true;
    if(visibility==='visible'||visibility==='partial')return true;
    const assistance=event?.assistance||event?.telemetry?.assistance||{};
    if(assistance?.targetRevealed===true||assistance?.targetShown===true)return true;
    return false;
  }
  function aiSuggestionSignal(event){
    const interpretation=aiInterpretation(event);const classes=aiResponseClasses(event);const types=aiEvidenceTypes(event).map(v=>String(v).toLowerCase());
    const confidence=String(interpretation?.interpretationConfidence||event?.interpretationConfidence||'').toLowerCase();
    const uncertain=classes.includes('stt-uncertain')||classes.includes('uncertain')||confidence==='low';
    const targetProduced=interpretation?.targetProduced===true||interpretation?.targetFamilyReached===true||event?.targetProduced===true||event?.targetFamilyReached===true;
    const formIssue=hasAIssue(interpretation?.formIssue??event?.formIssue);const senseIssue=hasAIssue(interpretation?.senseIssue??event?.senseIssue);
    const failureClasses=new Set(['partial-concept','form-mismatch','sense-mismatch','unrelated']);
    const clearFailure=classes.some(value=>failureClasses.has(value))||formIssue||senseIssue||String(event?.interpretationStatus||'').toLowerCase()==='no-idea';
    const strongTypes=new Set(['spontaneous-production','context-transfer','sense-transfer','reverse-reconstruction','neighbor-discrimination','free-composition','form-control','construction-use']);
    const strongRoute=types.some(value=>strongTypes.has(value));
    const assisted=aiTargetWasAssisted(event);
    return {
      positive:!uncertain&&targetProduced&&!formIssue&&!senseIssue&&!assisted&&strongRoute,
      negative:!uncertain&&clearFailure,
      timestamp:aiEventTimestamp(event),sessionId:aiSessionId(event),types
    };
  }
  function latestSuggestionKeepTimestamp(wordId,fromLevel,toLevel){
    let latest=0;interactionEvents.forEach(event=>{
      if(String(event?.action||'')!=='attention_suggestion_kept')return;
      if(String(event?.wordId||'')!==String(wordId||''))return;
      if(String(event?.fromLevel||'')!==String(fromLevel||'')||String(event?.suggestedLevel||'')!==String(toLevel||''))return;
      latest=Math.max(latest,Number(event?.timestamp)||0);
    });return latest;
  }
  function attentionSuggestion(record){
    const current=String(record?.reviewLevel||'').toLowerCase();if(!['high','medium','light'].includes(current))return null;
    const wordId=String(record?.wordId||'').trim();const history=aiEvidenceByWordId.get(wordId)||[];if(!history.length)return null;
    const authority=Number(record?.lastAttentionUpdated||0);if(!authority)return null;
    const easeTo=current==='high'?'medium':current==='medium'?'light':'';
    const raiseTo=current==='light'?'medium':current==='medium'?'high':'';
    const evaluate=(toLevel,direction)=>{
      if(!toLevel)return null;
      const cutoff=Math.max(authority,latestSuggestionKeepTimestamp(wordId,current,toLevel));
      const signals=history.map(item=>aiSuggestionSignal(item.event)).filter(signal=>signal.timestamp>cutoff);
      if(!signals.length)return null;
      const positives=signals.filter(signal=>signal.positive);const negatives=signals.filter(signal=>signal.negative);
      const evidenceThrough=Math.max(...signals.map(signal=>signal.timestamp));
      if(direction==='ease'){
        const sessions=new Set(positives.map(signal=>signal.sessionId).filter(Boolean));
        if(positives.length<2||sessions.size<2||negatives.length)return null;
        return {wordId,fromLevel:current,toLevel,direction,positiveCount:positives.length,negativeCount:negatives.length,sessionCount:sessions.size,evidenceThrough,cutoff};
      }
      const sessions=new Set(negatives.map(signal=>signal.sessionId).filter(Boolean));
      if(negatives.length<2||sessions.size<2||positives.length)return null;
      return {wordId,fromLevel:current,toLevel,direction,positiveCount:positives.length,negativeCount:negatives.length,sessionCount:sessions.size,evidenceThrough,cutoff};
    };
    return evaluate(easeTo,'ease')||evaluate(raiseTo,'raise');
  }
  function suggestionHtml(record){
    const suggestion=attentionSuggestion(record);if(!suggestion)return'';
    const from=attentionLabel(suggestion.fromLevel),to=attentionLabel(suggestion.toLevel);
    const reason=suggestion.direction==='ease'
      ? `${suggestion.positiveCount} strong AI production / transfer signals across ${suggestion.sessionCount} sessions since ${from} was set.`
      : `${suggestion.negativeCount} clear AI difficulty signals across ${suggestion.sessionCount} sessions since ${from} was set.`;
    return `<div class="review-suggestion" data-review-suggestion="${esc(record.wordId)}"><div class="review-suggestion-copy"><span>Suggested Attention</span><strong>${esc(from)} <b aria-hidden="true">→</b> ${esc(to)}</strong><small>${esc(reason)} Nothing changes unless you apply it.</small></div><div class="review-suggestion-actions"><button type="button" class="review-suggestion-apply" data-suggestion-apply="${esc(record.wordId)}" data-from-level="${esc(suggestion.fromLevel)}" data-to-level="${esc(suggestion.toLevel)}" data-evidence-through="${suggestion.evidenceThrough}">Apply ${esc(to)}</button><button type="button" class="review-suggestion-keep" data-suggestion-keep="${esc(record.wordId)}" data-from-level="${esc(suggestion.fromLevel)}" data-to-level="${esc(suggestion.toLevel)}" data-evidence-through="${suggestion.evidenceThrough}">Keep ${esc(from)}</button></div></div>`;
  }
  function showReviewToast(message){
    const toast=$('home-toast');if(!toast)return;toast.textContent=message;toast.hidden=false;clearTimeout(showReviewToast._timer);showReviewToast._timer=setTimeout(()=>{toast.hidden=true;},2200);
  }
  function sortReviewRecords(){
    const rank={high:0,medium:1,light:2,'':3};reviewRecords.sort((a,b)=>(rank[a.reviewLevel]-rank[b.reviewLevel])||(b.lastAttentionUpdated-a.lastAttentionUpdated)||(b.lastSeen-a.lastSeen)||(b.reviewCount-a.reviewCount));
  }
  function progressAfterSuggestion(latest,toLevel,now){
    const reasons=Array.isArray(latest?.reviewReasons)?latest.reviewReasons:[];
    return {...latest,review:true,known:false,reviewLevel:toLevel,reviewReasons:reasons,lastAttentionUpdated:now};
  }
  function applyAttentionSuggestion(button){
    const wordId=String(button?.dataset?.suggestionApply||'').trim();const fromLevel=String(button?.dataset?.fromLevel||'').trim();const toLevel=String(button?.dataset?.toLevel||'').trim();const evidenceThrough=Number(button?.dataset?.evidenceThrough||0);
    if(!wordId||!['high','medium','light'].includes(toLevel))return;
    const latest=readProgressRecord(wordId);const currentLevel=String(latest?.reviewLevel||'').toLowerCase();
    if(!(latest?.review===true||latest?.lastResult==='review')||currentLevel!==fromLevel){showReviewToast('Attention changed elsewhere. Review refreshed.');reviewRecords=readReviewRecords();render();return;}
    const reasons=Array.isArray(latest.reviewReasons)?latest.reviewReasons:[];const now=Date.now();
    const next=progressAfterSuggestion(latest,toLevel,now);saveProgressRecord(wordId,next);
    appendInteractionEvent({timestamp:now,action:'attention_set',wordId,source:'review-suggestion',level:toLevel,reasons,fromLevel,suggested:true,suggestionPolicyVersion:SUGGESTION_POLICY_VERSION,evidenceThrough});
    const index=reviewRecords.findIndex(record=>record.wordId===wordId);if(index>=0)reviewRecords[index]={...reviewRecords[index],...next,wordId,review:true,reviewLevel:toLevel,lastAttentionUpdated:now};
    sortReviewRecords();render();showReviewToast(`${attentionLabel(toLevel)} attention applied.`);
  }
  function keepAttentionSuggestion(button){
    const wordId=String(button?.dataset?.suggestionKeep||'').trim();const fromLevel=String(button?.dataset?.fromLevel||'').trim();const toLevel=String(button?.dataset?.toLevel||'').trim();const evidenceThrough=Number(button?.dataset?.evidenceThrough||0);if(!wordId)return;
    appendInteractionEvent({timestamp:Date.now(),action:'attention_suggestion_kept',wordId,source:'review-hub',fromLevel,suggestedLevel:toLevel,suggestionPolicyVersion:SUGGESTION_POLICY_VERSION,evidenceThrough});
    renderList();showReviewToast(`${attentionLabel(fromLevel)} attention kept.`);
  }
  function wireSuggestionActions(){
    document.querySelectorAll('[data-suggestion-apply]').forEach(button=>button.addEventListener('click',()=>applyAttentionSuggestion(button)));
    document.querySelectorAll('[data-suggestion-keep]').forEach(button=>button.addEventListener('click',()=>keepAttentionSuggestion(button)));
  }
  function standardEvidenceHtml(wordId){
    const item=latestStandardEvidence.get(String(wordId||''));if(!item)return'';const event=item.event||{};const parts=[];
    const rating=ratingLabel(event.selfRating);if(rating)parts.push(rating);
    const attention=validAttention(event.reviewAttention)?attentionLabel(event.reviewAttention):'';if(attention)parts.push(`Attention ${attention}`);
    const hints=Number(event.hintCount)||0;if(hints)parts.push(`${hints} hint${hints===1?'':'s'}`);
    if(!parts.length&&event.targetShown===true)parts.push('Target revealed');
    if(!parts.length)parts.push('Practice attempt');
    return `<div class="review-evidence-row"><span class="review-evidence-source standard">Standard</span><span class="review-evidence-copy">${esc(parts.join(' · '))}</span>${item.timestamp?`<time>${esc(formatEvidenceWhen(item.timestamp))}</time>`:''}</div>`;
  }
  function aiEvidenceHtml(wordId){
    const item=latestAIEvidence.get(String(wordId||''));if(!item)return'';const event=item.event||{};const types=aiEvidenceTypes(event).slice(0,3);const parts=types.length?types.map(aiEvidenceLabel):['Interpreted evidence'];
    const response=String(event?.authoritativeResponse||event?.learnerResponse?.authoritativeResponse||event?.learnerResponse?.text||'').trim();
    return `<div class="review-evidence-row"><span class="review-evidence-source ai">AI</span><span class="review-evidence-copy">${esc(parts.join(' · '))}${response?`<small>“${esc(response.length>90?response.slice(0,87)+'…':response)}”</small>`:''}</span>${item.timestamp?`<time>${esc(formatEvidenceWhen(item.timestamp))}</time>`:''}</div>`;
  }
  function evidenceBlockHtml(wordId){
    const standard=standardEvidenceHtml(wordId);const ai=aiEvidenceHtml(wordId);if(!standard&&!ai)return'';
    return `<div class="review-card-evidence"><div class="review-evidence-head"><span>Recent evidence</span><small>Context only · does not change Review by itself</small></div>${standard}${ai}</div>`;
  }
  function isAdmin(){return localStorage.getItem(ROLE_KEY)==='admin'||sessionStorage.getItem(SESSION_ADMIN_KEY)==='admin';}
  function countLevel(level){return reviewRecords.filter(r=>level==='unassigned'?!r.reviewLevel:r.reviewLevel===level).length;}
  function levelMatches(r){return !levelFilter||(levelFilter==='unassigned'?!r.reviewLevel:r.reviewLevel===levelFilter);}
  function filtered(){return reviewRecords.filter(r=>levelMatches(r)&&(!reasonFilter||r.reviewReasons.includes(reasonFilter)));}
  function renderSummary(){
    $('review-total').textContent=reviewRecords.length.toLocaleString();
    $('review-high').textContent=countLevel('high').toLocaleString();
    $('review-medium').textContent=countLevel('medium').toLocaleString();
    $('review-light').textContent=countLevel('light').toLocaleString();
    $('review-unassigned').textContent=countLevel('unassigned').toLocaleString();
    document.querySelectorAll('[data-level-filter]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.levelFilter===levelFilter));
  }
  function renderReasons(){
    const base=reviewRecords.filter(levelMatches);
    const counts=new Map(REASONS.map(([key])=>[key,0]));
    base.forEach(r=>r.reviewReasons.forEach(reason=>counts.has(reason)&&counts.set(reason,counts.get(reason)+1)));
    $('review-reason-chips').innerHTML=REASONS.map(([key,label])=>`<button type="button" class="review-reason-chip${reasonFilter===key?' is-active':''}" data-reason-filter="${esc(key)}"><span>${esc(label)}</span><b>${counts.get(key)||0}</b></button>`).join('');
    $('review-reason-chips').querySelectorAll('[data-reason-filter]').forEach(btn=>btn.addEventListener('click',()=>{reasonFilter=reasonFilter===btn.dataset.reasonFilter?'':btn.dataset.reasonFilter;visibleLimit=PAGE_SIZE;render();}));
    $('review-clear-filter').hidden=!(levelFilter||reasonFilter);
  }
  function setStudyLink(matches){
    const link=$('review-study-set');
    const p=new URLSearchParams();p.set('review','1');p.set('from','review');
    if(levelFilter)p.set('reviewlevel',levelFilter);
    if(reasonFilter)p.set('reviewreason',reasonFilter);
    link.href=`./flashcards/wlp/batch.html?${p.toString()}`;
    link.setAttribute('aria-disabled',matches.length?'false':'true');
    link.textContent=matches.length?`Study These${matches.length>10?' · first 10':''}`:'Study These';
  }
  function cardHtml(record){
    const row=rowByWordId.get(record.wordId)||{};
    const word=String(row.Word||`WID ${record.wordId}`).trim();
    const pos=String(row['Part of Speech']||'').trim();
    const deck=Number(row['Batch #']||0); const batch=deck?String(deck).padStart(3,'0'):'';
    const definition=String(row.Definition||'').trim();
    const level=record.reviewLevel||'';
    const levelLabel=level?level[0].toUpperCase()+level.slice(1):'No attention set';
    const tags=record.reviewReasons.map(r=>`<span class="review-reason-tag">${esc(reasonLabel.get(r)||r)}</span>`).join('');
    const needs=tags?`<div class="review-card-needs"><span class="review-card-mini-label">Learning Needs</span><div class="review-card-tags">${tags}</div></div>`:'';
    const evidence=evidenceBlockHtml(record.wordId);const suggestion=suggestionHtml(record);
    const studyHref=batch?`./flashcards/wlp/batch.html?batch=${encodeURIComponent(batch)}&wordid=${encodeURIComponent(record.wordId)}&solo=1&from=review`:'./deck-browser.html';
    const edit=isAdmin()?`<a class="review-card-edit" href="./editor-local-edit.html?wid=${encodeURIComponent(record.wordId)}&return=${encodeURIComponent('review.html')}">Edit</a>`:'';
    return `<article class="review-card"><div class="review-card-main"><div class="review-card-head"><strong class="review-card-word">${esc(word)}</strong><span class="review-card-meta">${esc([`WID${record.wordId}`,pos,batch?`WLP${batch}`:''].filter(Boolean).join(' · '))}</span></div>${definition?`<p class="review-card-definition">${esc(definition)}</p>`:''}<div class="review-card-state"><div class="review-card-attention"><span class="review-card-mini-label">Current Attention</span><span class="review-level-tag ${esc(level)}">${esc(levelLabel)}</span></div>${needs}</div>${evidence}${suggestion}</div><div class="review-card-actions"><a class="review-card-study" href="${studyHref}">Study</a>${edit}</div></article>`;
  }
  function renderList(){
    const matches=filtered();
    const shown=matches.slice(0,visibleLimit);
    const labelParts=[];
    if(levelFilter)labelParts.push(levelFilter==='unassigned'?'No attention set':levelFilter[0].toUpperCase()+levelFilter.slice(1));
    if(reasonFilter)labelParts.push(reasonLabel.get(reasonFilter)||reasonFilter);
    $('review-match-title').textContent=labelParts.length?labelParts.join(' + '):'All Review cards';
    $('review-match-copy').textContent=`${matches.length.toLocaleString()} card${matches.length===1?'':'s'} match this view.`;
    $('review-visible-count').textContent=matches.length?`Showing ${Math.min(shown.length,matches.length)} of ${matches.length}`:'';
    setStudyLink(matches);
    if(!reviewRecords.length){$('review-list').innerHTML='<div class="review-empty"><strong>No cards are in Review right now.</strong><br><br><a href="./deck-browser.html">Browse Study decks</a> and tap Review whenever a word deserves more attention.</div>';}
    else if(!matches.length){$('review-list').innerHTML='<div class="review-empty"><strong>No Review cards match this filter.</strong><br><br>Try another attention level or learning need.</div>';}
    else{$('review-list').innerHTML=shown.map(cardHtml).join('');}
    wireSuggestionActions();
    $('review-load-more').hidden=shown.length>=matches.length;
  }
  function render(){renderSummary();renderReasons();renderList();}
  const requestedReviewScrollY=reviewScrollFromUrl();
  installReviewReturnNavigation();
  installReviewOutboundReturnNavigation();
  document.querySelectorAll('[data-level-filter]').forEach(btn=>btn.addEventListener('click',()=>{levelFilter=btn.dataset.levelFilter||'';visibleLimit=PAGE_SIZE;render();}));
  $('review-clear-filter').addEventListener('click',()=>{levelFilter='';reasonFilter='';visibleLimit=PAGE_SIZE;render();});
  $('review-load-more').addEventListener('click',()=>{visibleLimit+=PAGE_SIZE;renderList();});
  new MutationObserver(()=>renderList()).observe($('role-label'),{childList:true,subtree:true});
  (async()=>{
    try{
      const res=await fetch(MASTER_URL,{cache:'no-cache'});if(!res.ok)throw new Error(`Master TSV ${res.status}`);
      rows=applyOverrides(parseTSV(await res.text()));
      rowByWordId=new Map(rows.map(row=>[String(row.WordID||'').trim(),row]).filter(([wid])=>wid));
      reviewRecords=readReviewRecords();
      latestStandardEvidence=buildLatestStandardEvidence();
      latestAIEvidence=buildLatestAIEvidence();
      aiEvidenceByWordId=buildAIEvidenceHistory();
      interactionEvents=readInteractionEvents();
      render();
      restoreReviewReturnScroll(requestedReviewScrollY);
    }catch(e){console.error(e);$('review-list').innerHTML='<div class="review-empty"><strong>Review data could not be loaded.</strong><br><br>Reload the page when the Master TSV is available.</div>';}
  })();

  function runEvidenceSelfTest(){
    const results=[];const check=(name,ok)=>results.push({name,ok:Boolean(ok)});
    check('standard rating label',ratingLabel('almost')==='Almost');
    check('attention label',attentionLabel('medium')==='Medium');
    check('ai evidence label',aiEvidenceLabel('context-transfer')==='Context transfer');
    check('standard occurrence timestamp wins over later edit',standardEventTimestamp({startedAt:'2026-09-20T10:00:00Z',updatedAt:'2026-09-22T10:00:00Z'})===Date.parse('2026-09-20T10:00:00Z'));
    const priorStd=latestStandardEvidence,priorAI=latestAIEvidence,priorHistory=aiEvidenceByWordId,priorInteractions=interactionEvents;
    try{
      latestStandardEvidence=new Map([['1',{timestamp:1,event:{selfRating:'got-it',reviewAttention:'medium',hintCount:0}}]]);
      latestAIEvidence=new Map([['1',{timestamp:2,event:{wordId:'1',evidenceTypes:['cue-based-retrieval','context-transfer'],authoritativeResponse:'example'}}]]);
      check('standard and attention stay separate',standardEvidenceHtml('1').includes('Got it · Attention Medium'));
      check('ai stays evidence vocabulary',aiEvidenceHtml('1').includes('Cue-based retrieval · Context transfer'));
      check('evidence block contains both sources',evidenceBlockHtml('1').includes('Standard')&&evidenceBlockHtml('1').includes('AI'));
      check('no evidence stays compact',evidenceBlockHtml('999')==='');
      const base=Date.parse('2026-09-20T10:00:00Z');
      const good=(session,offset,type='context-transfer',extra={})=>({wordId:'1',sessionId:session,observedAt:base+offset,evidenceTypes:[type],interpretation:{targetProduced:true,targetFamilyReached:true,formIssue:null,senseIssue:null,interpretationConfidence:'high',responseClasses:['exact-target']},experience:{targetVisible:false,targetVisibility:'hidden'},...extra});
      aiEvidenceByWordId=new Map([['1',[{event:good('s1',1000),timestamp:base+1000,index:0},{event:good('s2',2000,'free-composition'),timestamp:base+2000,index:1}]]]);interactionEvents=[];
      let suggestion=attentionSuggestion({wordId:'1',reviewLevel:'high',lastAttentionUpdated:base});
      check('two strong sessions ease one step',suggestion?.toLevel==='medium'&&suggestion?.direction==='ease');
      check('never skips a level',suggestion?.fromLevel==='high'&&suggestion?.toLevel==='medium');
      suggestion=attentionSuggestion({wordId:'1',reviewLevel:'light',lastAttentionUpdated:base});
      check('light never suggests leaving Review',suggestion===null);
      aiEvidenceByWordId=new Map([['1',[{event:good('s1',1000,'context-transfer',{experience:{targetVisible:true,targetVisibility:'visible'}}),timestamp:base+1000,index:0},{event:good('s2',2000,'free-composition'),timestamp:base+2000,index:1}]]]);
      check('target-assisted success cannot ease',attentionSuggestion({wordId:'1',reviewLevel:'high',lastAttentionUpdated:base})===null);
      const bad=(session,offset,klass='sense-mismatch')=>({wordId:'1',sessionId:session,observedAt:base+offset,evidenceTypes:['cue-based-retrieval'],interpretation:{targetProduced:false,targetFamilyReached:false,formIssue:null,senseIssue:klass==='sense-mismatch'?'wrong sense':null,interpretationConfidence:'high',responseClasses:[klass]},experience:{targetVisible:false,targetVisibility:'hidden'}});
      aiEvidenceByWordId=new Map([['1',[{event:bad('s1',1000),timestamp:base+1000,index:0},{event:bad('s2',2000,'form-mismatch'),timestamp:base+2000,index:1}]]]);
      suggestion=attentionSuggestion({wordId:'1',reviewLevel:'light',lastAttentionUpdated:base});
      check('two clear difficulty sessions raise one step',suggestion?.toLevel==='medium'&&suggestion?.direction==='raise');
      aiEvidenceByWordId=new Map([['1',[{event:good('s1',1000),timestamp:base+1000,index:0},{event:good('s2',2000,'free-composition'),timestamp:base+2000,index:1},{event:bad('s3',3000),timestamp:base+3000,index:2}]]]);
      check('mixed evidence makes no suggestion',attentionSuggestion({wordId:'1',reviewLevel:'high',lastAttentionUpdated:base})===null);
      aiEvidenceByWordId=new Map([['1',[{event:good('s1',1000),timestamp:base+1000,index:0},{event:good('s2',2000,'free-composition'),timestamp:base+2000,index:1}]]]);interactionEvents=[{timestamp:base+3000,action:'attention_suggestion_kept',wordId:'1',fromLevel:'high',suggestedLevel:'medium'}];
      check('keep current suppresses same evidence',attentionSuggestion({wordId:'1',reviewLevel:'high',lastAttentionUpdated:base})===null);
      aiEvidenceByWordId.get('1').push({event:good('s3',4000,'construction-use'),timestamp:base+4000,index:2},{event:good('s4',5000,'sense-transfer'),timestamp:base+5000,index:3});
      check('new evidence after keep can suggest again',attentionSuggestion({wordId:'1',reviewLevel:'high',lastAttentionUpdated:base})?.toLevel==='medium');
      const stt={wordId:'1',sessionId:'s5',observedAt:base+6000,evidenceTypes:['free-composition'],interpretation:{targetProduced:false,formIssue:'maybe',senseIssue:null,interpretationConfidence:'low',responseClasses:['stt-uncertain']},experience:{targetVisible:false}};
      check('stt uncertainty is not negative evidence',aiSuggestionSignal(stt).negative===false);
      const preserved=progressAfterSuggestion({wordId:'1',studyCount:7,reviewCount:4,attempts:11,exposureCount:15,reviewReasons:['usage'],known:false,review:true,reviewLevel:'high'},'medium',base+7000);
      check('apply preserves counters',preserved.studyCount===7&&preserved.reviewCount===4&&preserved.attempts===11&&preserved.exposureCount===15);
      check('apply preserves learning needs',Array.isArray(preserved.reviewReasons)&&preserved.reviewReasons[0]==='usage');
      check('apply changes only current attention semantics',preserved.review===true&&preserved.known===false&&preserved.reviewLevel==='medium'&&preserved.lastAttentionUpdated===base+7000);
    }finally{latestStandardEvidence=priorStd;latestAIEvidence=priorAI;aiEvidenceByWordId=priorHistory;interactionEvents=priorInteractions;}
    return {passed:results.every(item=>item.ok),passedCount:results.filter(item=>item.ok).length,total:results.length,results};
  }
  window.WLPReviewStage7={version:'1.2.2',suggestionPolicyVersion:SUGGESTION_POLICY_VERSION,runEvidenceSelfTest};
})();
