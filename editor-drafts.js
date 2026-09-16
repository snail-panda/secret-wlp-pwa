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
      return `<article class="draft-manage-card" data-local-id="${esc(d.localId)}"><div class="draft-manage-main"><div class="draft-manage-word">${esc(d.Word||'Untitled Draft')}</div><div class="draft-manage-meta">${esc(meta)}</div><div class="draft-manage-detail">${esc(detail)}</div></div><div class="draft-manage-actions"><a class="draft-manage-edit" href="./editor-draft-edit.html?id=${encodeURIComponent(String(d.localId||''))}">Edit</a><button class="draft-manage-delete" type="button" data-delete-draft="${esc(d.localId)}">Delete</button></div></article>`;
    }).join('');
    list.querySelectorAll('[data-delete-draft]').forEach(btn=>btn.addEventListener('click',()=>{
      if(!isAdmin()) return;
      const id=String(btn.dataset.deleteDraft||''); const rows=readDrafts(); const target=rows.find(d=>String(d.localId||'')===id); if(!target) return;
      if(!confirm(`Delete local draft “${target.Word||'Untitled Draft'}”?\n\nThis removes only the browser-local Draft. The Master TSV is not affected.`)) return;
      writeDrafts(rows.filter(d=>String(d.localId||'')!==id)); renderManage();
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
    const badge=$('draft-edit-badge'); if(badge) badge.textContent=`Draft ${String(index+1).padStart(3,'0')}`;
    const study=$('draft-edit-study'); if(study) study.href=studyHref(drafts,index);
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!isAdmin()) return;
      const latest=readDrafts(); const at=latest.findIndex(d=>String(d.localId||'')===id); if(at<0){ location.reload(); return; }
      const fd=new FormData(form); const word=String(fd.get('Word')||'').trim(); if(!word){ $('draft-edit-word')?.focus(); return; }
      const next={...latest[at],updatedAt:new Date().toISOString()}; FIELDS.forEach(field=>{ next[field]=String(fd.get(field)||'').trim(); }); latest[at]=next; writeDrafts(latest);
      const success=$('draft-edit-success'); if(success) success.hidden=false; if(study) study.href=studyHref(latest,at);
    });
    $('draft-edit-delete')?.addEventListener('click',()=>{
      if(!isAdmin()) return; const latest=readDrafts(); const current=latest.find(d=>String(d.localId||'')===id); if(!current) return;
      if(!confirm(`Delete local draft “${current.Word||'Untitled Draft'}”?\n\nThis removes only the browser-local Draft. The Master TSV is not affected.`)) return;
      writeDrafts(latest.filter(d=>String(d.localId||'')!==id)); location.href='./editor-drafts.html';
    });
  }

  renderManage(); fillEditForm();
  window.addEventListener('pageshow', renderManage);
  window.addEventListener('focus', renderManage);
})();
