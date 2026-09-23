(() => {
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260916-s7-editor-local-edits-v1-4-6';
  const FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isAdmin = () => localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin';
  const readOverrides = () => { try { const v=JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY)||'{}'); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; } catch { return {}; } };
  const writeOverrides = value => localStorage.setItem(LOCAL_OVERRIDES_KEY, JSON.stringify(value, null, 2));
  const readDraftCount = () => { try { const v=JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY)||'[]'); return Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&String(x.Word||'').trim()).length:0; } catch { return 0; } };
  const formatDate = value => { const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); };

  function parseTSV(text) {
    const table=[]; let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i], next=text[i+1];
      if(ch==='"'){ if(quoted&&next==='"'){field+='"';i++;} else quoted=!quoted; continue; }
      if(ch==='\t'&&!quoted){row.push(field);field='';continue;}
      if((ch==='\n'||ch==='\r')&&!quoted){ if(ch==='\r'&&next==='\n')i++; row.push(field); if(row.some(v=>String(v).trim()))table.push(row); row=[];field='';continue; }
      field+=ch;
    }
    row.push(field); if(row.some(v=>String(v).trim()))table.push(row); if(!table.length)return[];
    const headers=table[0].map(v=>String(v||'').trim());
    return table.slice(1).map(cols=>Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]??'').trim()])));
  }

  async function readMaster() {
    const response=await fetch(TSV_URL,{cache:'no-store'}); if(!response.ok) throw new Error(`TSV ${response.status}`); return parseTSV(await response.text());
  }
  function syncCountPill(overrides=readOverrides()) {
    const pill=$('editor-count-pill'); if(!pill) return;
    const drafts=readDraftCount(); const edits=Object.values(overrides).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).length;
    pill.textContent=`${drafts} Draft${drafts===1?'':'s'} · ${edits} Local Edit${edits===1?'':'s'}`;
  }
  const batchHref = row => {
    const batch=String(row?.['Batch #']||'').trim(), wid=String(row?.WordID||'').trim();
    if(!batch||!wid) return './deck-browser.html';
    const p=new URLSearchParams(); p.set('batch',String(Number(batch)||batch)); p.set('wordid',wid); return `./flashcards/wlp/batch.html?${p.toString()}`;
  };
  const safeReturnContext = () => {
    const raw=String(new URLSearchParams(location.search).get('return')||'').replace(/^\/+/, '').trim();
    if(raw==='editor-local-edits.html'||raw==='./editor-local-edits.html') return {href:'./editor-local-edits.html',label:'Back to Manage Local Edits',kind:'manage'};
    if((raw==='review.html'||raw.startsWith('review.html?'))&&!raw.includes('..')&&!/^\w+:/.test(raw)){
      try{
        const url=new URL(raw,location.href);
        if(url.origin===location.origin&&url.pathname.endsWith('/review.html')) return {href:`./review.html${url.search}${url.hash}`,label:'Back to Review',kind:'review'};
      }catch{}
    }
    if(raw.startsWith('flashcards/wlp/batch.html?')&&!raw.includes('..')&&!/^\w+:/.test(raw)) return {href:`./${raw}`,label:'Back to Card',kind:'study'};
    return {href:'./editor-local-edits.html',label:'Back to Manage Local Edits',kind:'manage'};
  };
  function syncEditNavigation(masterRow) {
    const ctx=safeReturnContext();
    const back=$('local-edit-back'), label=$('local-edit-back-label'), cancel=$('local-edit-cancel');
    const primary=$('local-edit-success-primary'), secondary=$('local-edit-success-secondary'), home=$('local-edit-home');
    if(back){back.href=ctx.href;back.setAttribute('aria-label',ctx.label);} if(label)label.textContent=ctx.label;
    if(cancel){cancel.href=ctx.href;cancel.setAttribute('aria-label',`Cancel and ${ctx.label.toLowerCase()}`);}
    if(primary){primary.href=ctx.href;primary.textContent=ctx.kind==='study'?'Back to Card':ctx.kind==='review'?'Back to Review':'Back to Manage Local Edits';}
    if(secondary){
      if(ctx.kind==='study'){secondary.href='./editor-local-edits.html';secondary.textContent='Manage Local Edits';}
      else {secondary.href=batchHref(masterRow);secondary.textContent='View Card';}
    }
    if(home)home.href='./index.html';
  }

  function ensureConfirmDialog(){
    let overlay=$('wlp-local-confirm');
    if(overlay) return overlay;
    overlay=document.createElement('div');
    overlay.id='wlp-local-confirm';
    overlay.className='wlp-confirm-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`<div class="wlp-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="wlp-confirm-title" aria-describedby="wlp-confirm-message"><h2 id="wlp-confirm-title">Revert local edit?</h2><p id="wlp-confirm-message"></p><span id="wlp-confirm-detail" class="wlp-confirm-detail"></span><div class="wlp-confirm-actions"><button type="button" class="wlp-confirm-cancel" id="wlp-confirm-cancel">Cancel</button><button type="button" class="wlp-confirm-do" id="wlp-confirm-do">Revert</button></div></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function openWlpConfirm({title='Revert local edit?',message='Restore the Master version? This removes only the local edit on this device.',detail='',confirmLabel='Revert'}={}){
    const overlay=ensureConfirmDialog();
    const titleEl=$('wlp-confirm-title'), messageEl=$('wlp-confirm-message'), detailEl=$('wlp-confirm-detail');
    const cancel=$('wlp-confirm-cancel'), confirm=$('wlp-confirm-do');
    if(titleEl) titleEl.textContent=title;
    if(messageEl) messageEl.textContent=message;
    if(detailEl){detailEl.textContent=detail;detailEl.hidden=!detail;}
    if(confirm) confirm.textContent=confirmLabel;
    return new Promise(resolve=>{
      let done=false;
      const finish=value=>{
        if(done)return; done=true; overlay.hidden=true;
        cancel?.removeEventListener('click',onCancel); confirm?.removeEventListener('click',onConfirm);
        overlay.removeEventListener('click',onBackdrop); document.removeEventListener('keydown',onKeydown);
        resolve(value);
      };
      const onCancel=()=>finish(false), onConfirm=()=>finish(true);
      const onBackdrop=e=>{if(e.target===overlay)finish(false);};
      const onKeydown=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}};
      cancel?.addEventListener('click',onCancel); confirm?.addEventListener('click',onConfirm);
      overlay.addEventListener('click',onBackdrop); document.addEventListener('keydown',onKeydown);
      overlay.hidden=false;
      requestAnimationFrame(()=>cancel?.focus());
    });
  }

  function commonDiff(masterValue, localValue){
    const oldText=String(masterValue??''), newText=String(localValue??'');
    if(oldText===newText) return null;
    let prefix=0;
    while(prefix<oldText.length&&prefix<newText.length&&oldText[prefix]===newText[prefix]) prefix++;
    let suffix=0;
    while(suffix<oldText.length-prefix&&suffix<newText.length-prefix&&oldText[oldText.length-1-suffix]===newText[newText.length-1-suffix]) suffix++;
    return {
      prefix:newText.slice(0,prefix),
      oldMid:oldText.slice(prefix,oldText.length-suffix),
      newMid:newText.slice(prefix,newText.length-suffix),
      suffix:suffix?newText.slice(newText.length-suffix):''
    };
  }

  function appendDiffText(target,{prefix,mid,suffix},kind){
    target.textContent='';
    if(prefix) target.append(document.createTextNode(prefix));
    if(mid){
      const mark=document.createElement(kind==='removed'?'span':'mark');
      mark.className=kind==='removed'?'local-edit-diff-removed':'local-edit-diff-added';
      mark.textContent=mid;
      target.append(mark);
    }
    if(suffix) target.append(document.createTextNode(suffix));
  }

  function renderFieldDiff(control,masterValue){
    if(!control)return;
    const label=control.closest('.new-card-field'); if(!label)return;
    let box=label.querySelector('.local-edit-change-preview');
    if(!box){
      box=document.createElement('div');
      box.className='local-edit-change-preview';
      box.hidden=true;
      box.innerHTML=`<div class="local-edit-change-head"><span>Changed from Master</span></div><div class="local-edit-diff-row local-edit-diff-master"><b>Master</b><div class="local-edit-diff-text"></div></div><div class="local-edit-diff-row local-edit-diff-local"><b>Local</b><div class="local-edit-diff-text"></div></div>`;
      label.appendChild(box);
    }
    const current=String(control.value??'').trim(), master=String(masterValue??'').trim();
    const diff=commonDiff(master,current);
    if(!diff){box.hidden=true;return;}
    box.hidden=false;
    const masterRow=box.querySelector('.local-edit-diff-master');
    const localRow=box.querySelector('.local-edit-diff-local');
    const masterText=masterRow?.querySelector('.local-edit-diff-text');
    const localText=localRow?.querySelector('.local-edit-diff-text');
    if(masterText) appendDiffText(masterText,{prefix:diff.prefix,mid:diff.oldMid,suffix:diff.suffix},'removed');
    if(localText) appendDiffText(localText,{prefix:diff.prefix,mid:diff.newMid,suffix:diff.suffix},'added');
    if(masterRow) masterRow.hidden=!diff.oldMid && !!diff.newMid; // pure addition: Local preview is enough
    if(localRow) localRow.hidden=!diff.newMid && !!diff.oldMid;   // pure deletion: Master preview is enough
  }

  function installDiffPreviews(form,masterRow){
    FIELDS.forEach(field=>{
      const control=form.elements.namedItem(field); if(!control)return;
      const update=()=>renderFieldDiff(control,masterRow[field]);
      control.addEventListener('input',update);
      control.addEventListener('change',update);
      update();
    });
  }

  async function renderManage() {
    const list=$('local-edit-manage-list'), empty=$('local-edit-manage-empty'); if(!list||!empty) return;
    const overrides=readOverrides(); syncCountPill(overrides);
    const items=Object.entries(overrides).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v));
    if(!items.length){list.innerHTML='';empty.hidden=false;return;}
    empty.hidden=true;
    let masterMap=new Map();
    try { masterMap=new Map((await readMaster()).map(row=>[String(row.WordID||'').trim(),row])); } catch {}
    items.sort((a,b)=>Number(a[0])-Number(b[0]));
    list.innerHTML=items.map(([wid,edit])=>{
      const master=masterMap.get(String(wid))||{};
      const word=String(edit.Word||master.Word||`WID${wid}`).trim();
      const pos=String(edit['Part of Speech']||master['Part of Speech']||'').trim();
      const date=formatDate(edit.updatedAt);
      const meta=[`WID${wid}`,pos,date?`Updated ${date}`:''].filter(Boolean).join(' · ');
      const detail=String(edit.Definition||edit['Example Sentence']||edit['Note(s)']||master.Definition||'Local changes saved on this browser.').trim();
      return `<article class="draft-manage-card local-edit-card" data-word-id="${esc(wid)}"><div class="draft-manage-main"><div class="draft-manage-word">${esc(word)}</div><div class="draft-manage-meta">${esc(meta)}</div><div class="draft-manage-detail">${esc(detail)}</div><div class="local-edit-master-note"><span class="local-edit-state">Local Edit active</span></div></div><div class="draft-manage-actions"><a class="draft-manage-edit" href="./editor-local-edit.html?wid=${encodeURIComponent(wid)}&return=${encodeURIComponent('editor-local-edits.html')}">Edit</a><button class="draft-manage-delete" type="button" data-revert-local-edit="${esc(wid)}">Revert</button></div></article>`;
    }).join('');
    list.querySelectorAll('[data-revert-local-edit]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!isAdmin())return; const wid=String(btn.dataset.revertLocalEdit||''); const current=readOverrides(); if(!current[wid])return;
      const word=String(current[wid].Word||masterMap.get(wid)?.Word||`WID${wid}`).trim();
      const ok=await openWlpConfirm({detail:`${word} · WID${wid}`});
      if(!ok)return;
      delete current[wid]; writeOverrides(current); renderManage();
    }));
  }

  async function fillEditForm() {
    const form=$('local-edit-form'); if(!form)return;
    const wid=String(new URLSearchParams(location.search).get('wid')||'').trim();
    const missing=$('local-edit-missing');
    let masterRow=null;
    try { masterRow=(await readMaster()).find(row=>String(row.WordID||'').trim()===wid)||null; } catch {}
    if(!masterRow){form.hidden=true;if(missing)missing.hidden=false;return;}
    if(missing)missing.hidden=true; form.hidden=false;
    const overrides=readOverrides(), existing=overrides[wid]&&typeof overrides[wid]==='object'?overrides[wid]:null;
    const effective={...masterRow}; if(existing)FIELDS.forEach(field=>{if(Object.prototype.hasOwnProperty.call(existing,field))effective[field]=String(existing[field]??'');});
    FIELDS.forEach(field=>{const el=form.elements.namedItem(field);if(el)el.value=String(effective[field]||'');});
    window.WLPLearningHooks?.fillForm(form, window.WLPLearningHooks.getForMaster(wid));
    const noteControl=form.elements.namedItem('Note(s)');
    let noteEditedByUser=false;
    noteControl?.addEventListener('input',()=>{noteEditedByUser=true;});
    const pill=$('local-edit-wid-pill'); if(pill)pill.textContent=`WID${wid}`;
    const revert=$('local-edit-revert'); if(revert)revert.hidden=!existing;
    syncEditNavigation(masterRow);
    installDiffPreviews(form,masterRow);
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!isAdmin())return;
      const fd=new FormData(form), word=String(fd.get('Word')||'').trim(); if(!word){$('local-edit-word')?.focus();return;}
      const latest=readOverrides(), previous=latest[wid]&&typeof latest[wid]==='object'?latest[wid]:null, next={updatedAt:new Date().toISOString()}; FIELDS.forEach(field=>{next[field]=String(fd.get(field)||'').trim();}); next.__noteLineBreaks=noteEditedByUser?/[\r\n]/.test(next['Note(s)']||''):Boolean(previous?.__noteLineBreaks);
      const hasCanonicalDiff=FIELDS.some(field=>String(next[field]||'').trim()!==String(masterRow[field]||'').trim());
      if(hasCanonicalDiff) latest[wid]=next; else delete latest[wid];
      writeOverrides(latest);
      if(window.WLPLearningHooks) window.WLPLearningHooks.saveForMaster(wid, window.WLPLearningHooks.fromForm(form));
      if(revert)revert.hidden=!hasCanonicalDiff; const success=$('local-edit-success'); if(success)success.hidden=false; syncEditNavigation(masterRow);
    });
    revert?.addEventListener('click',async()=>{
      if(!isAdmin())return; const latest=readOverrides(); if(!latest[wid])return;
      const word=String(latest[wid].Word||masterRow.Word||`WID${wid}`).trim();
      const ok=await openWlpConfirm({detail:`${word} · WID${wid}`});
      if(!ok)return;
      delete latest[wid]; writeOverrides(latest); location.href=safeReturnContext().href;
    });
  }

  renderManage(); fillEditForm();
  window.addEventListener('pageshow',renderManage); window.addEventListener('focus',renderManage);
})();
