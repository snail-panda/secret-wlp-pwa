(() => {
  const PROGRESS_PREFIX = 'fc:wordid:';
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY = 'wlp:ai-study-events:v1';
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
    const evidence=evidenceBlockHtml(record.wordId);
    const studyHref=batch?`./flashcards/wlp/batch.html?batch=${encodeURIComponent(batch)}&wordid=${encodeURIComponent(record.wordId)}&solo=1&from=review`:'./deck-browser.html';
    const edit=isAdmin()?`<a class="review-card-edit" href="./editor-local-edit.html?wid=${encodeURIComponent(record.wordId)}&return=${encodeURIComponent('review.html')}">Edit</a>`:'';
    return `<article class="review-card"><div class="review-card-main"><div class="review-card-head"><strong class="review-card-word">${esc(word)}</strong><span class="review-card-meta">${esc([`WID${record.wordId}`,pos,batch?`WLP${batch}`:''].filter(Boolean).join(' · '))}</span></div>${definition?`<p class="review-card-definition">${esc(definition)}</p>`:''}<div class="review-card-state"><div class="review-card-attention"><span class="review-card-mini-label">Current Attention</span><span class="review-level-tag ${esc(level)}">${esc(levelLabel)}</span></div>${needs}</div>${evidence}</div><div class="review-card-actions"><a class="review-card-study" href="${studyHref}">Study</a>${edit}</div></article>`;
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
    $('review-load-more').hidden=shown.length>=matches.length;
  }
  function render(){renderSummary();renderReasons();renderList();}
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
      render();
    }catch(e){console.error(e);$('review-list').innerHTML='<div class="review-empty"><strong>Review data could not be loaded.</strong><br><br>Reload the page when the Master TSV is available.</div>';}
  })();

  function runEvidenceSelfTest(){
    const results=[];const check=(name,ok)=>results.push({name,ok:Boolean(ok)});
    check('standard rating label',ratingLabel('almost')==='Almost');
    check('attention label',attentionLabel('medium')==='Medium');
    check('ai evidence label',aiEvidenceLabel('context-transfer')==='Context transfer');
    check('standard occurrence timestamp wins over later edit',standardEventTimestamp({startedAt:'2026-09-20T10:00:00Z',updatedAt:'2026-09-22T10:00:00Z'})===Date.parse('2026-09-20T10:00:00Z'));
    const priorStd=latestStandardEvidence,priorAI=latestAIEvidence;
    try{
      latestStandardEvidence=new Map([['1',{timestamp:1,event:{selfRating:'got-it',reviewAttention:'medium',hintCount:0}}]]);
      latestAIEvidence=new Map([['1',{timestamp:2,event:{wordId:'1',evidenceTypes:['cue-based-retrieval','context-transfer'],authoritativeResponse:'example'}}]]);
      check('standard and attention stay separate',standardEvidenceHtml('1').includes('Got it · Attention Medium'));
      check('ai stays evidence vocabulary',aiEvidenceHtml('1').includes('Cue-based retrieval · Context transfer'));
      check('evidence block contains both sources',evidenceBlockHtml('1').includes('Standard')&&evidenceBlockHtml('1').includes('AI'));
      check('no evidence stays compact',evidenceBlockHtml('999')==='');
    }finally{latestStandardEvidence=priorStd;latestAIEvidence=priorAI;}
    return {passed:results.every(item=>item.ok),passedCount:results.filter(item=>item.ok).length,total:results.length,results};
  }
  window.WLPReviewStage7={version:'1.1.0',runEvidenceSelfTest};
})();
