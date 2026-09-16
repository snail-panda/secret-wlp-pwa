(() => {
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260915-s7-editor-local-edits-v1-4';
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
    if(raw.startsWith('flashcards/wlp/batch.html?')&&!raw.includes('..')&&!/^\w+:/.test(raw)) return {href:`./${raw}`,label:'Back to Card',kind:'study'};
    return {href:'./editor-local-edits.html',label:'Back to Manage Local Edits',kind:'manage'};
  };
  function syncEditNavigation(masterRow) {
    const ctx=safeReturnContext();
    const back=$('local-edit-back'), label=$('local-edit-back-label'), cancel=$('local-edit-cancel');
    const primary=$('local-edit-success-primary'), secondary=$('local-edit-success-secondary'), home=$('local-edit-home');
    if(back){back.href=ctx.href;back.setAttribute('aria-label',ctx.label);} if(label)label.textContent=ctx.label;
    if(cancel){cancel.href=ctx.href;cancel.setAttribute('aria-label',`Cancel and ${ctx.label.toLowerCase()}`);}
    if(primary){primary.href=ctx.href;primary.textContent=ctx.kind==='study'?'Back to Card':'Back to Manage Local Edits';}
    if(secondary){
      if(ctx.kind==='study'){secondary.href='./editor-local-edits.html';secondary.textContent='Manage Local Edits';}
      else {secondary.href=batchHref(masterRow);secondary.textContent='View Card';}
    }
    if(home)home.href='./index.html';
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
    list.querySelectorAll('[data-revert-local-edit]').forEach(btn=>btn.addEventListener('click',()=>{
      if(!isAdmin())return; const wid=String(btn.dataset.revertLocalEdit||''); const current=readOverrides(); if(!current[wid])return;
      const word=String(current[wid].Word||`WID${wid}`).trim();
      if(!confirm(`Revert “${word}” (WID${wid}) to the canonical Master version?\n\nThis removes only the browser-local edit.`))return;
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
    const pill=$('local-edit-wid-pill'); if(pill)pill.textContent=`WID${wid}`;
    const revert=$('local-edit-revert'); if(revert)revert.hidden=!existing;
    syncEditNavigation(masterRow);
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!isAdmin())return;
      const fd=new FormData(form), word=String(fd.get('Word')||'').trim(); if(!word){$('local-edit-word')?.focus();return;}
      const latest=readOverrides(), next={updatedAt:new Date().toISOString()}; FIELDS.forEach(field=>{next[field]=String(fd.get(field)||'').trim();}); latest[wid]=next; writeOverrides(latest);
      if(revert)revert.hidden=false; const success=$('local-edit-success'); if(success)success.hidden=false; syncEditNavigation(masterRow);
    });
    revert?.addEventListener('click',()=>{
      if(!isAdmin())return; const latest=readOverrides(); if(!latest[wid])return;
      const word=String(latest[wid].Word||masterRow.Word||`WID${wid}`).trim();
      if(!confirm(`Revert “${word}” (WID${wid}) to the canonical Master version?\n\nThis removes only the browser-local edit.`))return;
      delete latest[wid]; writeOverrides(latest); location.href=safeReturnContext().href;
    });
  }

  renderManage(); fillEditForm();
  window.addEventListener('pageshow',renderManage); window.addEventListener('focus',renderManage);
})();
