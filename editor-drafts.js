(() => {
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isAdmin = () => localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin';
  const readDrafts = () => { try { const v=JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY)||'[]'); return Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[]; } catch { return []; } };
  const writeDrafts = rows => localStorage.setItem(LOCAL_ADDITIONS_KEY, JSON.stringify(rows, null, 2));
  const formatDate = value => { const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); };
  const deckNoForIndex = index => Math.floor(index / 10) + 1;
  const studyHref = (drafts, index) => {
    const row=drafts[index]; if(!row) return './drafts.html';
    const p=new URLSearchParams(); p.set('draft', String(deckNoForIndex(index))); if(row.localId) p.set('localid', String(row.localId));
    return `./flashcards/wlp/batch.html?${p.toString()}`;
  };

  const editReturnContext = () => {
    const raw=String(new URLSearchParams(location.search).get('return')||'').trim();
    if(raw==='editor-drafts.html' || raw==='./editor-drafts.html') return {href:'./editor-drafts.html',label:'Back to Manage Drafts',kind:'manage'};
    if(raw==='editor-learning-metadata.html' || raw==='./editor-learning-metadata.html') return {href:'./editor-learning-metadata.html',label:'Back to Learning Metadata',kind:'metadata'};
    if(raw.startsWith('flashcards/wlp/batch.html?') && !raw.includes('..') && !/^\w+:/.test(raw)) return {href:`./${raw}`,label:'Back to Draft',kind:'study'};
    return {href:'./editor-drafts.html',label:'Back to Manage Drafts',kind:'manage'};
  };

  const syncEditNavigation = (drafts, index) => {
    const ctx=editReturnContext();
    const back=$('draft-edit-back');
    const backLabel=$('draft-edit-back-label');
    const cancel=$('draft-edit-cancel');
    const primary=$('draft-edit-success-primary');
    const secondary=$('draft-edit-success-secondary');
    const home=$('draft-edit-home');
    if(back){ back.href=ctx.href; back.setAttribute('aria-label',ctx.label); }
    if(backLabel) backLabel.textContent=ctx.label;
    if(cancel){ cancel.href=ctx.href; cancel.setAttribute('aria-label',`Cancel and ${ctx.label.toLowerCase()}`); }
    if(primary){
      primary.href=ctx.href;
      primary.textContent=ctx.kind==='study' ? 'Back to Draft' : ctx.kind==='metadata' ? 'Back to Learning Metadata' : 'Back to Manage Drafts';
    }
    if(secondary){
      if(ctx.kind==='study'){ secondary.href='./editor-drafts.html'; secondary.textContent='Manage Drafts'; }
      else { secondary.href=studyHref(drafts,index); secondary.textContent='Study Draft'; }
    }
    if(home) home.href='./index.html';
  };



  function ensureConfirmDialog(){
    let overlay=$('wlp-draft-confirm');
    if(overlay) return overlay;
    overlay=document.createElement('div');
    overlay.id='wlp-draft-confirm';
    overlay.className='wlp-confirm-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`<div class="wlp-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="wlp-draft-confirm-title" aria-describedby="wlp-draft-confirm-message"><h2 id="wlp-draft-confirm-title">Delete draft?</h2><p id="wlp-draft-confirm-message"></p><span id="wlp-draft-confirm-detail" class="wlp-confirm-detail"></span><div class="wlp-confirm-actions"><button type="button" class="wlp-confirm-cancel" id="wlp-draft-confirm-cancel">Cancel</button><button type="button" class="wlp-confirm-do" id="wlp-draft-confirm-do">Delete</button></div></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function openWlpConfirm({title='Delete draft?',message='Delete this Draft from your WLP account? It will disappear from your other signed-in devices after sync. The official Master is not affected.',detail='',confirmLabel='Delete'}={}){
    const overlay=ensureConfirmDialog();
    const titleEl=$('wlp-draft-confirm-title'), messageEl=$('wlp-draft-confirm-message'), detailEl=$('wlp-draft-confirm-detail');
    const cancel=$('wlp-draft-confirm-cancel'), confirm=$('wlp-draft-confirm-do');
    if(titleEl) titleEl.textContent=title;
    if(messageEl) messageEl.textContent=message;
    if(detailEl){ detailEl.textContent=detail; detailEl.hidden=!detail; }
    if(confirm) confirm.textContent=confirmLabel;
    return new Promise(resolve=>{
      let done=false;
      const finish=value=>{
        if(done) return; done=true; overlay.hidden=true;
        cancel?.removeEventListener('click',onCancel); confirm?.removeEventListener('click',onConfirm);
        overlay.removeEventListener('click',onBackdrop); document.removeEventListener('keydown',onKeydown);
        resolve(value);
      };
      const onCancel=()=>finish(false), onConfirm=()=>finish(true);
      const onBackdrop=e=>{ if(e.target===overlay) finish(false); };
      const onKeydown=e=>{ if(e.key==='Escape'){ e.preventDefault(); finish(false); } };
      cancel?.addEventListener('click',onCancel); confirm?.addEventListener('click',onConfirm);
      overlay.addEventListener('click',onBackdrop); document.addEventListener('keydown',onKeydown);
      overlay.hidden=false;
      requestAnimationFrame(()=>cancel?.focus());
    });
  }


  let toastTimer=0;
  function showToast(message){const toast=$('editor-toast');if(!toast)return;toast.textContent=String(message||'');toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},4200);}
  function requestCanonicalDelete(localId,button){const id=String(localId||'').trim();if(!id)return;if(button){button.disabled=true;button.setAttribute('aria-disabled','true');button.dataset.originalLabel=button.textContent||'Delete';button.textContent='Deleting…';}showToast('Deleting Draft from your WLP account…');window.dispatchEvent(new CustomEvent('wlp-draft-core-changed',{detail:{kind:'delete',localId:id}}));}
  function requestCanonicalPromote(localId,button){const id=String(localId||'').trim();if(!id)return;if(button){button.disabled=true;button.setAttribute('aria-disabled','true');button.dataset.originalLabel=button.textContent||'Promote';button.textContent='Promoting…';}showToast('Promoting Draft to the next official WID…');window.dispatchEvent(new CustomEvent('wlp-draft-core-changed',{detail:{kind:'promote',localId:id}}));}

  function syncCountPill(drafts = readDrafts()) {
    const pill=$('editor-count-pill'); if(!pill) return;
    let edits=0; try { const v=JSON.parse(localStorage.getItem('wlp:local-overrides:v1')||'{}'); if(v&&typeof v==='object'&&!Array.isArray(v)) edits=Object.values(v).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).length; } catch {}
    pill.textContent=`${drafts.length} Draft${drafts.length===1?'':'s'} · ${edits} Local Edit${edits===1?'':'s'}`;
  }

  function renderManage() {
    const list=$('draft-manage-list'), empty=$('draft-manage-empty'); if(!list||!empty) return;
    const drafts=readDrafts(); syncCountPill(drafts);
    if(!drafts.length){ list.innerHTML=''; empty.hidden=false; return; }
    empty.hidden=true;
    list.innerHTML=drafts.map((d,i)=>{
      const pos=String(d['Part of Speech']||'').trim();
      const date=formatDate(d.updatedAt||d.createdAt);
      const meta=[`Draft ${String(i+1).padStart(3,'0')}`,pos,date?`Updated ${date}`:''].filter(Boolean).join(' · ');
      const detail=String(d.Definition||d['Example Sentence']||d['Note(s)']||'No definition yet.').trim();
      return `<article class="draft-manage-card" data-local-id="${esc(d.localId)}"><div class="draft-manage-main"><div class="draft-manage-word">${esc(d.Word||'Untitled Draft')}</div><div class="draft-manage-meta">${esc(meta)}</div><div class="draft-manage-detail">${esc(detail)}</div></div><div class="draft-manage-actions"><button class="draft-manage-promote" type="button" data-promote-draft="${esc(d.localId)}">Promote</button><a class="draft-manage-edit" href="./editor-draft-edit.html?id=${encodeURIComponent(String(d.localId||''))}&return=${encodeURIComponent('editor-drafts.html')}">Edit</a><button class="draft-manage-delete" type="button" data-delete-draft="${esc(d.localId)}">Delete</button></div></article>`;
    }).join('');
    list.querySelectorAll('[data-promote-draft]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!isAdmin()) return; const id=String(btn.dataset.promoteDraft||'').trim(),target=drafts.find(d=>String(d.localId||'')===id); if(!target) return;
      const ok=await openWlpConfirm({
        title:'Promote to Official?',
        message:'Assign the next official WordID while keeping this Draft’s existing card_id / UUID. This writes the account Canonical Cloud. The static Master TSV is NOT updated in this canary, so the promoted card may not appear in current Master-based study/search until the Canonical Official Library cutover. There is no Demote action yet.',
        detail:`${target.Word||'Untitled Draft'}`,
        confirmLabel:'Promote'
      });
      if(!ok) return;
      requestCanonicalPromote(id,btn);
    }));
    list.querySelectorAll('[data-delete-draft]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!isAdmin()) return;
      const id=String(btn.dataset.deleteDraft||''); const rows=readDrafts(); const target=rows.find(d=>String(d.localId||'')===id); if(!target) return;
      const ok=await openWlpConfirm({
        title:'Delete draft?',
        message:'Delete this Draft from your WLP account? It will disappear from your other signed-in devices after sync. The official Master is not affected.',
        detail:`${target.Word||'Untitled Draft'}`,
        confirmLabel:'Delete'
      });
      if(!ok) return;
      requestCanonicalDelete(id,btn);
    }));
  }

  function fillEditForm() {
    const form=$('draft-edit-form'); if(!form) return;
    const id=String(new URLSearchParams(location.search).get('id')||'').trim();
    const drafts=readDrafts(); const index=drafts.findIndex(d=>String(d.localId||'')===id); const draft=index>=0?drafts[index]:null;
    const missing=$('draft-edit-missing');
    if(!draft){ form.hidden=true; if(missing) missing.hidden=false; return; }
    if(missing) missing.hidden=true; form.hidden=false;
    FIELDS.forEach(field=>{ const el=form.elements.namedItem(field); if(el) el.value=String(draft[field]||''); });
    window.WLPLearningHooks?.fillForm(form, window.WLPLearningHooks.getForDraft(id));
    const badge=$('draft-edit-badge'); if(badge) badge.textContent=`Draft ${String(index+1).padStart(3,'0')}`;
    const study=$('draft-edit-study'); if(study) study.href=studyHref(drafts,index);
    syncEditNavigation(drafts,index);
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!isAdmin()) return;
      const latest=readDrafts(); const at=latest.findIndex(d=>String(d.localId||'')===id); if(at<0){ location.reload(); return; }
      const fd=new FormData(form); const word=String(fd.get('Word')||'').trim(); if(!word){ $('draft-edit-word')?.focus(); return; }
      const next={...latest[at],updatedAt:new Date().toISOString()}; FIELDS.forEach(field=>{ next[field]=String(fd.get(field)||'').trim(); }); latest[at]=next; writeDrafts(latest);
      if (window.WLPLearningHooks) window.WLPLearningHooks.saveForDraft(id, window.WLPLearningHooks.fromForm(form));
      const success=$('draft-edit-success'), copy=$('draft-edit-success-copy');
      if(copy) copy.textContent='Draft changes saved locally · syncing to your WLP account…';
      if(success) success.hidden=false; if(study) study.href=studyHref(latest,at); syncEditNavigation(latest,at);
      window.dispatchEvent(new CustomEvent('wlp-draft-core-changed',{detail:{kind:'edit',localId:id}}));
    });
    $('draft-edit-delete')?.addEventListener('click',async()=>{
      if(!isAdmin()) return; const latest=readDrafts(); const current=latest.find(d=>String(d.localId||'')===id); if(!current) return;
      const ok=await openWlpConfirm({
        title:'Delete draft?',
        message:'Delete this Draft from your WLP account? It will disappear from your other signed-in devices after sync. The official Master is not affected.',
        detail:`${current.Word||'Untitled Draft'}`,
        confirmLabel:'Delete'
      });
      if(!ok) return;
      requestCanonicalDelete(id,$('draft-edit-delete'));
    });
  }

  window.addEventListener('wlp-draft-promote-complete',event=>{const d=event?.detail||{},id=String(d.localId||''),pass=d.pass===true,wid=String(d.wordId||'');if(pass){showToast(`Promoted to Official · WID${wid}.`);renderManage();return;}showToast(`Draft promotion CHECK: ${String(d.error||'Canonical promotion did not complete.')}`);renderManage();const btn=[...document.querySelectorAll('[data-promote-draft]')].find(x=>String(x.dataset.promoteDraft||'')===id);if(btn){btn.disabled=false;btn.removeAttribute('aria-disabled');btn.textContent=btn.dataset.originalLabel||'Promote';}});

  window.addEventListener('wlp-draft-delete-complete',event=>{const d=event?.detail||{},id=String(d.localId||''),pass=d.pass===true;if(pass){showToast('Draft deleted from your WLP account.');const currentId=String(new URLSearchParams(location.search).get('id')||'');if(document.getElementById('draft-edit-form')&&currentId===id){location.href='./editor-drafts.html';return;}renderManage();return;}showToast(`Draft delete CHECK: ${String(d.error||'Canonical delete did not complete.')}`);renderManage();const editDelete=$('draft-edit-delete');if(editDelete){editDelete.disabled=false;editDelete.removeAttribute('aria-disabled');editDelete.textContent='Delete Draft';}});

  renderManage(); fillEditForm();
  window.addEventListener('pageshow', renderManage);
  window.addEventListener('focus', renderManage);
  window.addEventListener('wlp-drafts-canonical-changed', renderManage);
})();
