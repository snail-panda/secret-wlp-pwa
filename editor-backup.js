(() => {
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260916-s7-editor-backup-v1-5-0';
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
  function draftFingerprint(value){const d=normalizeDraft(value);return [d.Word,d.IPA,d['Part of Speech'],d.Definition,d['Synonym(s)'],d['Example Sentence'],d['Note(s)'],d.Category,d.Source].map(v=>String(v||'').trim()).join('\u241F');}
  function importedRowToDraft(row,existing=null){const now=new Date().toISOString();return normalizeDraft({localId:String(row['Local Draft ID']||'').trim()||existing?.localId||makeLocalDraftId(),createdAt:String(row['Created At']||'').trim()||existing?.createdAt||now,updatedAt:String(row['Updated At']||'').trim()||now,Word:row.Word,IPA:row.IPA,'Part of Speech':row['Part of Speech'],Definition:row.Definition,'Synonym(s)':row['Synonym(s)'],'Example Sentence':row['Example Sentence'],'Note(s)':row['Note(s)'],Category:row.Category,Source:row.Source});}
  function planImport(parsed){
    if(!parsed.headers.includes('Word'))throw new Error('This TSV does not contain a Word column.');
    const next=readDrafts().map(d=>({...d})); const idToIndex=new Map(),fingerprintToIndex=new Map();
    next.forEach((d,i)=>{if(d.localId)idToIndex.set(d.localId,i);fingerprintToIndex.set(draftFingerprint(d),i);});
    let added=0,updated=0,unchanged=0,invalid=0,officialSkipped=0;
    parsed.rows.forEach(row=>{const word=String(row.Word||'').trim(),wordId=String(row.WordID||'').trim();if(!word){invalid++;return;}if(wordId){officialSkipped++;return;}const incomingId=String(row['Local Draft ID']||'').trim();if(incomingId&&idToIndex.has(incomingId)){const i=idToIndex.get(incomingId),existing=next[i],incoming=importedRowToDraft(row,existing);if(draftFingerprint(existing)===draftFingerprint(incoming)){unchanged++;return;}incoming.localId=existing.localId;incoming.createdAt=existing.createdAt||incoming.createdAt;incoming.updatedAt=new Date().toISOString();next[i]=incoming;fingerprintToIndex.set(draftFingerprint(incoming),i);updated++;return;}const incoming=importedRowToDraft(row),fp=draftFingerprint(incoming);if(fingerprintToIndex.has(fp)){unchanged++;return;}if(incoming.localId&&idToIndex.has(incoming.localId))incoming.localId=makeLocalDraftId();next.push(incoming);const idx=next.length-1;idToIndex.set(incoming.localId,idx);fingerprintToIndex.set(fp,idx);added++;});
    return{next,added,updated,unchanged,invalid,officialSkipped,sourceRows:parsed.rows.length};
  }
  function importSummary(plan){const lines=[`TSV rows: ${plan.sourceRows}`,`New Drafts: ${plan.added}`,`Updated Drafts: ${plan.updated}`,`Unchanged skipped: ${plan.unchanged}`];if(plan.invalid)lines.push(`Invalid skipped: ${plan.invalid}`);if(plan.officialSkipped)lines.push(`Official WordID rows skipped: ${plan.officialSkipped}`);return lines.join('\n');}
  function showStatus(message,error=false){const el=$('draft-import-status');if(!el)return;el.hidden=false;el.classList.toggle('is-error',error);el.textContent=message;}
  function syncSummary(){const drafts=readDrafts(),overrides=readOverrides(),edits=Object.values(overrides).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).length;const pill=$('editor-count-pill');if(pill)pill.textContent=`${drafts.length} Draft${drafts.length===1?'':'s'} · ${edits} Local Edit${edits===1?'':'s'}`;if($('backup-master-count'))$('backup-master-count').textContent=masterRows.length?String(masterRows.length):'—';if($('backup-draft-count'))$('backup-draft-count').textContent=String(drafts.length);if($('backup-edit-count'))$('backup-edit-count').textContent=String(edits);if($('entire-deck-summary'))$('entire-deck-summary').textContent=masterRows.length?`${masterRows.length+drafts.length} cards total · ${edits} Local Edit${edits===1?'':'s'} applied`:'Master deck is still loading…';if($('new-cards-summary'))$('new-cards-summary').textContent=drafts.length?`${drafts.length} Draft${drafts.length===1?'':'s'} ready to export`:'No local Drafts yet';if($('deck-export-new-only'))$('deck-export-new-only').disabled=!drafts.length;}
  function ensureConfirm(){let overlay=$('wlp-backup-confirm');if(overlay)return overlay;overlay=document.createElement('div');overlay.id='wlp-backup-confirm';overlay.className='wlp-backup-confirm';overlay.hidden=true;overlay.innerHTML=`<div class="wlp-backup-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="wlp-backup-confirm-title" aria-describedby="wlp-backup-confirm-message"><h2 id="wlp-backup-confirm-title">Import Draft changes?</h2><p id="wlp-backup-confirm-message">This updates browser-local Drafts only. The Master TSV will not be changed.</p><span id="wlp-backup-confirm-detail" class="wlp-backup-confirm-detail"></span><div class="wlp-backup-confirm-actions"><button type="button" class="wlp-backup-confirm-cancel" id="wlp-backup-confirm-cancel">Cancel</button><button type="button" class="wlp-backup-confirm-do" id="wlp-backup-confirm-do">Import</button></div></div>`;document.body.appendChild(overlay);return overlay;}
  function askImport(plan){const overlay=ensureConfirm(),detail=$('wlp-backup-confirm-detail'),cancel=$('wlp-backup-confirm-cancel'),confirm=$('wlp-backup-confirm-do');if(detail)detail.textContent=importSummary(plan);return new Promise(resolve=>{let done=false;const finish=v=>{if(done)return;done=true;overlay.hidden=true;cancel?.removeEventListener('click',onCancel);confirm?.removeEventListener('click',onConfirm);overlay.removeEventListener('click',onBackdrop);document.removeEventListener('keydown',onKey);resolve(v);};const onCancel=()=>finish(false),onConfirm=()=>finish(true),onBackdrop=e=>{if(e.target===overlay)finish(false);},onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}};cancel?.addEventListener('click',onCancel);confirm?.addEventListener('click',onConfirm);overlay.addEventListener('click',onBackdrop);document.addEventListener('keydown',onKey);overlay.hidden=false;requestAnimationFrame(()=>cancel?.focus());});}

  $('deck-export-entire')?.addEventListener('click',async()=>{
    if(!isAdmin())return;
    try{if(!masterRows.length)await loadMaster();const overrides=readOverrides(),drafts=readDrafts();const rows=[...masterRows.map(row=>applyOverride(row,overrides)),...drafts.map(localDraftToWlpRow)];downloadTSV(buildTSV(rows,WLP_EXPORT_COLUMNS),`wlp-effective-deck-${dateStamp()}.tsv`);showStatus(`Entire Deck exported: ${rows.length} cards.`);}catch(error){showStatus(error?.message||String(error),true);}
  });
  $('deck-export-new-only')?.addEventListener('click',()=>{if(!isAdmin())return;const drafts=readDrafts();if(!drafts.length){showStatus('There are no local Draft cards to export.',true);return;}downloadTSV(buildTSV(drafts.map(localDraftToPortableRow),WLP_DRAFT_EXPORT_COLUMNS),`wlp-new-cards-${dateStamp()}.tsv`);showStatus(`New Cards Only exported: ${drafts.length} Draft${drafts.length===1?'':'s'}.`);});
  const importButton=$('draft-import-button'),importFile=$('draft-import-file');
  importButton?.addEventListener('click',()=>{if(!isAdmin())return;importFile?.click();});
  importFile?.addEventListener('change',async()=>{const file=importFile.files?.[0];importFile.value='';if(!file)return;try{const parsed=parseTSVText(await file.text()),plan=planImport(parsed);if(!plan.sourceRows){showStatus('This TSV contains no Draft rows to import.',true);return;}const actionable=plan.added+plan.updated;if(!actionable){showStatus(`Nothing needs to be imported.\n${importSummary(plan)}`);return;}if(!(await askImport(plan)))return;writeDrafts(plan.next);syncSummary();showStatus(`Import complete · ${plan.added} added · ${plan.updated} updated · ${plan.unchanged} unchanged skipped`);}catch(error){console.error('Draft import failed:',error);showStatus(`Could not import this Draft TSV. ${error?.message||String(error)}`,true);}});

  async function init(){syncSummary();try{await loadMaster();syncSummary();}catch(error){showStatus(error?.message||String(error),true);const button=$('deck-export-entire');if(button)button.disabled=true;}}
  window.addEventListener('pageshow',()=>{syncSummary();});window.addEventListener('focus',syncSummary);window.addEventListener('storage',event=>{if([LOCAL_ADDITIONS_KEY,LOCAL_OVERRIDES_KEY].includes(event.key))syncSummary();});
  init();
})();
