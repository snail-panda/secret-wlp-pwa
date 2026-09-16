(() => {
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260916-s7-editor-backup-v1-5-1';
  const WLP_EXPORT_COLUMNS = ['Batch #','Guidance #','WordID','Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const WLP_DRAFT_EXPORT_COLUMNS = [...WLP_EXPORT_COLUMNS,'Local Draft ID','Created At','Updated At'];
  const LOCAL_OVERRIDE_FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const $ = id => document.getElementById(id);
  const isAdmin = () => localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin';
  let masterRows = [];

  function makeLocalDraftId(){
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`;
    return `local-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  }
  function normalizeDraft(value){
    const d=value&&typeof value==='object'?value:{}; const now=new Date().toISOString();
    return {localId:String(d.localId||makeLocalDraftId()),createdAt:String(d.createdAt||now),updatedAt:String(d.updatedAt||d.createdAt||now),Word:String(d.Word||'').trim(),IPA:String(d.IPA||'').trim(),'Part of Speech':String(d['Part of Speech']||'').trim(),Definition:String(d.Definition||'').trim(),'Synonym(s)':String(d['Synonym(s)']||'').trim(),'Example Sentence':String(d['Example Sentence']||'').trim(),'Note(s)':String(d['Note(s)']||'').trim(),Category:String(d.Category||'').trim(),Source:String(d.Source||'').trim()};
  }
  function readDrafts(){try{const v=JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY)||'[]');return Array.isArray(v)?v.map(normalizeDraft).filter(d=>d.Word):[];}catch{return[];}}
  function writeDrafts(value){localStorage.setItem(LOCAL_ADDITIONS_KEY,JSON.stringify(value,null,2));}
  function readOverrides(){try{const v=JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return{};}}
  function parseTSVText(text){
    const txt=String(text??'').replace(/^\uFEFF/,''); const table=[]; let row=[],field='',quoted=false;
    for(let i=0;i<txt.length;i++){const ch=txt[i],next=txt[i+1]; if(ch==='"'){if(quoted&&next==='"'){field+='"';i++;}else quoted=!quoted;continue;} if(ch==='\t'&&!quoted){row.push(field);field='';continue;} if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);if(row.some(v=>String(v).trim()!==''))table.push(row);row=[];field='';continue;} field+=ch;}
    row.push(field); if(row.some(v=>String(v).trim()!==''))table.push(row); if(!table.length)return{headers:[],rows:[]};
    const headers=table[0].map(v=>String(v||'').trim()); const rows=table.slice(1).map(cols=>Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]??'').trim()]))); return{headers,rows};
  }
  async function loadMaster(){const r=await fetch(TSV_URL,{cache:'no-store'});if(!r.ok)throw new Error(`Could not load Master TSV (${r.status}).`);masterRows=parseTSVText(await r.text()).rows;return masterRows;}
  function localDraftToWlpRow(d){return {'Batch #':'','Guidance #':'',WordID:'',Word:d.Word||'',IPA:d.IPA||'','Part of Speech':d['Part of Speech']||'',Definition:d.Definition||'','Synonym(s)':d['Synonym(s)']||'','Example Sentence':d['Example Sentence']||'','Note(s)':d['Note(s)']||'',Category:d.Category||'',Source:d.Source||''};}
  function localDraftToPortableRow(d){return {...localDraftToWlpRow(d),'Local Draft ID':d.localId||'','Created At':d.createdAt||'','Updated At':d.updatedAt||''};}
  function applyOverride(row,overrides){const wid=String(row.WordID||'').trim(),edit=wid?overrides[wid]:null;if(!edit||typeof edit!=='object')return{...row};const next={...row};LOCAL_OVERRIDE_FIELDS.forEach(f=>{if(Object.prototype.hasOwnProperty.call(edit,f))next[f]=String(edit[f]??'');});return next;}
  function tsvEscape(value){const t=String(value??'');return /[\t\n\r"]/.test(t)?`"${t.replaceAll('"','""')}"`:t;}
  function buildTSV(rows,columns){return [columns.join('\t'),...rows.map(row=>columns.map(c=>tsvEscape(row[c]??'')).join('\t'))].join('\n')+'\n';}
  function dateStamp(){const n=new Date();return [n.getFullYear(),String(n.getMonth()+1).padStart(2,'0'),String(n.getDate()).padStart(2,'0')].join('-');}
  function downloadTSV(text,name){const blob=new Blob(['\uFEFF',text],{type:'text/tab-separated-values;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  const DRAFT_COMPARE_FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  function draftFingerprint(value){const d=normalizeDraft(value);return DRAFT_COMPARE_FIELDS.map(f=>String(d[f]||'').trim()).join('\u241F');}
  function importedRowToDraft(row,existing=null){
    const now=new Date().toISOString();
    return normalizeDraft({
      localId:String(row['Local Draft ID']||'').trim()||existing?.localId||makeLocalDraftId(),
      createdAt:String(row['Created At']||'').trim()||existing?.createdAt||now,
      updatedAt:String(row['Updated At']||'').trim()||now,
      Word:row.Word,IPA:row.IPA,'Part of Speech':row['Part of Speech'],Definition:row.Definition,'Synonym(s)':row['Synonym(s)'],'Example Sentence':row['Example Sentence'],'Note(s)':row['Note(s)'],Category:row.Category,Source:row.Source
    });
  }
  function parseDraftDate(value){const raw=String(value||'').trim();if(!raw)return null;const ms=Date.parse(raw);return Number.isFinite(ms)?ms:null;}
  function timestampRelation(existing,incoming){
    const current=parseDraftDate(existing?.updatedAt),next=parseDraftDate(incoming?.updatedAt);
    if(current===null||next===null)return 'unknown';
    if(next<current)return 'older';
    if(next>current)return 'newer';
    return 'same';
  }
  function changedDraftFields(existing,incoming){return DRAFT_COMPARE_FIELDS.filter(f=>String(existing?.[f]??'').trim()!==String(incoming?.[f]??'').trim());}
  function planImport(parsed){
    if(!parsed.headers.includes('Word'))throw new Error('This TSV does not contain a Word column.');
    const next=readDrafts().map(d=>({...d}));
    const idToIndex=new Map(),fingerprintToIndex=new Map();
    next.forEach((d,i)=>{if(d.localId)idToIndex.set(d.localId,i);fingerprintToIndex.set(draftFingerprint(d),i);});
    let added=0,updated=0,unchanged=0,invalid=0,officialSkipped=0;
    const changes=[];
    parsed.rows.forEach((row,rowIndex)=>{
      const word=String(row.Word||'').trim(),wordId=String(row.WordID||'').trim();
      if(!word){invalid++;return;}
      if(wordId){officialSkipped++;return;}
      const incomingId=String(row['Local Draft ID']||'').trim();
      if(incomingId&&idToIndex.has(incomingId)){
        const i=idToIndex.get(incomingId),existing=next[i],incoming=importedRowToDraft(row,existing);
        incoming.localId=existing.localId;
        incoming.createdAt=existing.createdAt||incoming.createdAt;
        const oldFp=draftFingerprint(existing),newFp=draftFingerprint(incoming);
        if(oldFp===newFp){unchanged++;return;}
        const fields=changedDraftFields(existing,incoming),relation=timestampRelation(existing,incoming);
        fingerprintToIndex.delete(oldFp);
        next[i]=incoming;
        fingerprintToIndex.set(newFp,i);
        changes.push({action:'update',rowIndex,word:incoming.Word,localId:incoming.localId,existing:{...existing},incoming:{...incoming},changedFields:fields,timeRelation:relation});
        updated++;
        return;
      }
      const incoming=importedRowToDraft(row),fp=draftFingerprint(incoming);
      if(fingerprintToIndex.has(fp)){unchanged++;return;}
      next.push(incoming);
      const idx=next.length-1;
      idToIndex.set(incoming.localId,idx);
      fingerprintToIndex.set(fp,idx);
      changes.push({action:'add',rowIndex,word:incoming.Word,localId:incoming.localId,existing:null,incoming:{...incoming},changedFields:DRAFT_COMPARE_FIELDS.filter(f=>String(incoming[f]||'').trim()),timeRelation:'new'});
      added++;
    });
    const older=changes.filter(c=>c.action==='update'&&c.timeRelation==='older').length;
    const sameTimestampChanged=changes.filter(c=>c.action==='update'&&c.timeRelation==='same').length;
    return{next,added,updated,unchanged,invalid,officialSkipped,sourceRows:parsed.rows.length,changes,older,sameTimestampChanged};
  }
  function importSummary(plan){
    const lines=[`TSV rows: ${plan.sourceRows}`,`New Drafts: ${plan.added}`,`Updated Drafts: ${plan.updated}`,`Unchanged skipped: ${plan.unchanged}`];
    if(plan.older)lines.push(`Older incoming warnings: ${plan.older}`);
    if(plan.sameTimestampChanged)lines.push(`Same timestamp / different content: ${plan.sameTimestampChanged}`);
    if(plan.invalid)lines.push(`Invalid skipped: ${plan.invalid}`);
    if(plan.officialSkipped)lines.push(`Official WordID rows skipped: ${plan.officialSkipped}`);
    return lines.join('\n');
  }
  function formatDraftTime(value){
    const raw=String(value||'').trim();if(!raw)return 'Unknown';const ms=Date.parse(raw);if(!Number.isFinite(ms))return raw;
    try{return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(ms));}catch{return raw;}
  }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function diffParts(currentValue,incomingValue){
    const a=String(currentValue??''),b=String(incomingValue??'');
    let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
    let aEnd=a.length,bEnd=b.length;while(aEnd>start&&bEnd>start&&a[aEnd-1]===b[bEnd-1]){aEnd--;bEnd--;}
    return{prefix:a.slice(0,start),current:a.slice(start,aEnd),incoming:b.slice(start,bEnd),suffix:a.slice(aEnd)};
  }
  function diffLineHtml(currentValue,incomingValue,mode){
    const p=diffParts(currentValue,incomingValue),changed=mode==='current'?p.current:p.incoming;
    return `${escapeHtml(p.prefix)}${changed?`<mark class="${mode==='current'?'import-diff-current':'import-diff-incoming'}">${escapeHtml(changed)}</mark>`:''}${escapeHtml(p.suffix)}`||'<span class="import-empty">Empty</span>';
  }
  function showStatus(message,error=false){const el=$('draft-import-status');if(!el)return;el.hidden=false;el.classList.toggle('is-error',error);el.textContent=message;}
  function syncSummary(){const drafts=readDrafts(),overrides=readOverrides(),edits=Object.values(overrides).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).length;const pill=$('editor-count-pill');if(pill)pill.textContent=`${drafts.length} Draft${drafts.length===1?'':'s'} · ${edits} Local Edit${edits===1?'':'s'}`;if($('backup-master-count'))$('backup-master-count').textContent=masterRows.length?String(masterRows.length):'—';if($('backup-draft-count'))$('backup-draft-count').textContent=String(drafts.length);if($('backup-edit-count'))$('backup-edit-count').textContent=String(edits);if($('entire-deck-summary'))$('entire-deck-summary').textContent=masterRows.length?`${masterRows.length+drafts.length} cards total · ${edits} Local Edit${edits===1?'':'s'} applied`:'Master deck is still loading…';if($('new-cards-summary'))$('new-cards-summary').textContent=drafts.length?`${drafts.length} Draft${drafts.length===1?'':'s'} ready to export`:'No local Drafts yet';if($('deck-export-new-only'))$('deck-export-new-only').disabled=!drafts.length;}
  function ensureConfirm(){let overlay=$('wlp-backup-confirm');if(overlay)return overlay;overlay=document.createElement('div');overlay.id='wlp-backup-confirm';overlay.className='wlp-backup-confirm';overlay.hidden=true;overlay.innerHTML=`<div class="wlp-backup-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="wlp-backup-confirm-title" aria-describedby="wlp-backup-confirm-message"><h2 id="wlp-backup-confirm-title">Import Draft changes?</h2><p id="wlp-backup-confirm-message">This updates browser-local Drafts only. The Master TSV will not be changed.</p><span id="wlp-backup-confirm-detail" class="wlp-backup-confirm-detail"></span><div class="wlp-backup-confirm-actions"><button type="button" class="wlp-backup-confirm-cancel" id="wlp-backup-confirm-cancel">Cancel</button><button type="button" class="wlp-backup-confirm-do" id="wlp-backup-confirm-do">Import</button></div></div>`;document.body.appendChild(overlay);return overlay;}
  function askImport(plan){const overlay=ensureConfirm(),detail=$('wlp-backup-confirm-detail'),cancel=$('wlp-backup-confirm-cancel'),confirm=$('wlp-backup-confirm-do');if(detail)detail.textContent=importSummary(plan);return new Promise(resolve=>{let done=false;const finish=v=>{if(done)return;done=true;overlay.hidden=true;cancel?.removeEventListener('click',onCancel);confirm?.removeEventListener('click',onConfirm);overlay.removeEventListener('click',onBackdrop);document.removeEventListener('keydown',onKey);resolve(v);};const onCancel=()=>finish(false),onConfirm=()=>finish(true),onBackdrop=e=>{if(e.target===overlay)finish(false);},onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}};cancel?.addEventListener('click',onCancel);confirm?.addEventListener('click',onConfirm);overlay.addEventListener('click',onBackdrop);document.addEventListener('keydown',onKey);overlay.hidden=false;requestAnimationFrame(()=>cancel?.focus());});}
  function relationLabel(change){
    if(change.action==='add')return{label:'New Draft',cls:'is-new'};
    if(change.timeRelation==='older')return{label:'Incoming older',cls:'is-warning'};
    if(change.timeRelation==='same')return{label:'Same time · content differs',cls:'is-warning'};
    if(change.timeRelation==='newer')return{label:'Incoming newer',cls:'is-newer'};
    return{label:'Update',cls:''};
  }
  function renderChangeDetails(change){
    if(change.action==='add'){
      const fields=change.changedFields.map(field=>`<div class="import-field-diff"><strong>${escapeHtml(field)}</strong><div class="import-new-value">${escapeHtml(change.incoming[field])||'<span class="import-empty">Empty</span>'}</div></div>`).join('');
      return `<div class="import-time-grid"><span><small>Incoming Updated</small><strong>${escapeHtml(formatDraftTime(change.incoming.updatedAt))}</strong></span></div>${fields}`;
    }
    const fields=change.changedFields.map(field=>`<div class="import-field-diff"><strong>${escapeHtml(field)}</strong><div class="import-diff-row"><span>Current</span><p>${diffLineHtml(change.existing[field],change.incoming[field],'current')}</p></div><div class="import-diff-row is-incoming"><span>Incoming</span><p>${diffLineHtml(change.existing[field],change.incoming[field],'incoming')}</p></div></div>`).join('');
    return `<div class="import-time-grid"><span><small>Current Updated</small><strong>${escapeHtml(formatDraftTime(change.existing.updatedAt))}</strong></span><span><small>Incoming Updated</small><strong>${escapeHtml(formatDraftTime(change.incoming.updatedAt))}</strong></span></div>${fields}`;
  }
  function renderImportPreview(plan,fileName=''){
    const wrap=$('draft-import-preview');if(!wrap)return;
    wrap.hidden=false;
    const name=$('draft-import-file-name');if(name)name.textContent=fileName||'Selected Draft TSV';
    const add=$('import-preview-add');if(add)add.textContent=String(plan.added);
    const update=$('import-preview-update');if(update)update.textContent=String(plan.updated);
    const skip=$('import-preview-skip');if(skip)skip.textContent=String(plan.unchanged+plan.invalid+plan.officialSkipped);
    const warning=$('draft-import-warning');
    if(warning){
      const warningParts=[];
      if(plan.older)warningParts.push(`${plan.older} incoming Draft${plan.older===1?' is':'s are'} older than the copy on this device.`);
      if(plan.sameTimestampChanged)warningParts.push(`${plan.sameTimestampChanged} Draft${plan.sameTimestampChanged===1?' has':'s have'} the same Updated At time but different content.`);
      warning.hidden=!warningParts.length;
      warning.textContent=warningParts.join(' ');
    }
    const list=$('draft-import-change-list');
    if(list){
      list.innerHTML=plan.changes.map((change,index)=>{const relation=relationLabel(change),fields=change.action==='update'?change.changedFields.join(', '):'New local Draft';return `<details class="import-change-card ${relation.cls}" data-import-change="${index}"><summary><span class="import-change-title"><strong>${escapeHtml(change.word||'(Untitled Draft)')}</strong><small>${escapeHtml(fields)}</small></span><span class="import-change-badge ${relation.cls}">${escapeHtml(relation.label)}</span></summary><div class="import-change-body">${renderChangeDetails(change)}</div></details>`;}).join('')||'<p class="import-no-changes">No Draft content changes need review.</p>';
    }
    const review=$('draft-import-review-changes'),details=$('draft-import-change-details');
    if(details)details.hidden=true;
    if(review){review.textContent=`Review Changes${plan.changes.length?` · ${plan.changes.length}`:''}`;review.disabled=!plan.changes.length;review.setAttribute('aria-expanded','false');}
    const go=$('draft-import-continue');if(go)go.disabled=!(plan.added+plan.updated);
  }
  function clearImportPreview(){const wrap=$('draft-import-preview');if(wrap)wrap.hidden=true;const details=$('draft-import-change-details');if(details)details.hidden=true;pendingImportPlan=null;pendingImportFileName='';}
  let pendingImportPlan=null,pendingImportFileName='';
  $('deck-export-entire')?.addEventListener('click',async()=>{
    if(!isAdmin())return;
    try{if(!masterRows.length)await loadMaster();const overrides=readOverrides(),drafts=readDrafts();const rows=[...masterRows.map(row=>applyOverride(row,overrides)),...drafts.map(localDraftToWlpRow)];downloadTSV(buildTSV(rows,WLP_EXPORT_COLUMNS),`wlp-effective-deck-${dateStamp()}.tsv`);showStatus(`Entire Deck · Prepared for download · ${rows.length} cards.`);}catch(error){showStatus(error?.message||String(error),true);}
  });
  $('deck-export-new-only')?.addEventListener('click',()=>{if(!isAdmin())return;const drafts=readDrafts();if(!drafts.length){showStatus('There are no local Draft cards to export.',true);return;}downloadTSV(buildTSV(drafts.map(localDraftToPortableRow),WLP_DRAFT_EXPORT_COLUMNS),`wlp-new-cards-${dateStamp()}.tsv`);showStatus(`New Cards Only · Prepared for download · ${drafts.length} Draft${drafts.length===1?'':'s'}.`);});
  const importButton=$('draft-import-button'),importFile=$('draft-import-file');
  importButton?.addEventListener('click',()=>{if(!isAdmin())return;importFile?.click();});
  importFile?.addEventListener('change',async()=>{
    const file=importFile.files?.[0];importFile.value='';if(!file)return;
    try{
      const parsed=parseTSVText(await file.text()),plan=planImport(parsed);
      if(!plan.sourceRows){clearImportPreview();showStatus('This TSV contains no Draft rows to import.',true);return;}
      pendingImportPlan=plan;pendingImportFileName=file.name||'Selected Draft TSV';
      renderImportPreview(plan,pendingImportFileName);
      showStatus(`Import preview ready · ${plan.added} new · ${plan.updated} update${plan.updated===1?'':'s'} · ${plan.unchanged} unchanged skipped`);
    }catch(error){console.error('Draft import preview failed:',error);clearImportPreview();showStatus(`Could not read this Draft TSV. ${error?.message||String(error)}`,true);}
  });
  $('draft-import-review-changes')?.addEventListener('click',()=>{
    if(!pendingImportPlan)return;const panel=$('draft-import-change-details'),button=$('draft-import-review-changes');if(!panel||!button)return;
    const open=panel.hidden;panel.hidden=!open;button.setAttribute('aria-expanded',String(open));button.textContent=open?'Hide Changes':`Review Changes · ${pendingImportPlan.changes.length}`;
    if(open)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  $('draft-import-clear')?.addEventListener('click',()=>{clearImportPreview();showStatus('Import preview cleared.');});
  $('draft-import-continue')?.addEventListener('click',async()=>{
    const plan=pendingImportPlan;if(!plan)return;const actionable=plan.added+plan.updated;if(!actionable){showStatus(`Nothing needs to be imported.\n${importSummary(plan)}`);return;}
    if(!(await askImport(plan)))return;
    writeDrafts(plan.next);syncSummary();showStatus(`Import complete · ${plan.added} added · ${plan.updated} updated · ${plan.unchanged} unchanged skipped`);clearImportPreview();
  });

  async function init(){syncSummary();try{await loadMaster();syncSummary();}catch(error){showStatus(error?.message||String(error),true);const button=$('deck-export-entire');if(button)button.disabled=true;}}
  window.addEventListener('pageshow',()=>{syncSummary();});window.addEventListener('focus',syncSummary);window.addEventListener('storage',event=>{if([LOCAL_ADDITIONS_KEY,LOCAL_OVERRIDES_KEY].includes(event.key))syncSummary();});
  init();
})();
