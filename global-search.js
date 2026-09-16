(() => {
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260915-s7-v30';
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const RESULT_LIMIT = 120;
  const $ = id => document.getElementById(id);

  const SEARCH_FIELDS = [
    ['Word', 'Word'],
    ['Definition', 'Definition'],
    ['Synonym(s)', 'Synonyms'],
    ['Example Sentence', 'Example'],
    ['Note(s)', 'Notes']
  ];
  const OVERRIDE_FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];

  let effectiveRows = [];
  let masterCount = 0;
  let draftCount = 0;
  let overrideCount = 0;
  let searchTimer = 0;

  function normalize(value) {
    return String(value ?? '').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
  }
  function isAdminMode() {
    return localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin';
  }
  function pad3(value) { return String(value).padStart(3, '0'); }
  function parseTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i++; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(field);
        if (row.some(v => String(v).trim())) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(v => String(v).trim())) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(v => String(v || '').trim());
    return table.slice(1).map(cols => Object.fromEntries(headers.map((h, i) => [h, String(cols[i] ?? '').trim()])));
  }
  function readObject(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  function readArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function applyOverrides(rows, overrides) {
    return rows.map(row => {
      const wid = String(row.WordID || '').trim();
      const override = wid ? overrides[wid] : null;
      if (!override || typeof override !== 'object') return {...row, __source:'master', __hasOverride:false};
      const next = {...row, __source:'master', __hasOverride:true};
      OVERRIDE_FIELDS.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(override, field)) next[field] = String(override[field] ?? '');
      });
      return next;
    });
  }
  function draftRows(drafts) {
    return drafts
      .filter(draft => draft && typeof draft === 'object' && String(draft.Word || '').trim())
      .map((draft, index) => ({
        'Batch #':'', 'Guidance #':'', WordID:'',
        Word:String(draft.Word || '').trim(),
        IPA:String(draft.IPA || '').trim(),
        'Part of Speech':String(draft['Part of Speech'] || '').trim(),
        Definition:String(draft.Definition || '').trim(),
        'Synonym(s)':String(draft['Synonym(s)'] || '').trim(),
        'Example Sentence':String(draft['Example Sentence'] || '').trim(),
        'Note(s)':String(draft['Note(s)'] || '').trim(),
        Category:String(draft.Category || '').trim(),
        Source:String(draft.Source || '').trim(),
        __source:'draft', __localId:String(draft.localId || '').trim(), __draftIndex:index
      }));
  }
  function scoreRow(row, query) {
    const q = normalize(query);
    if (!q) return null;
    const tokens = q.split(' ').filter(Boolean);
    const values = SEARCH_FIELDS.map(([key,label]) => ({key,label,raw:String(row[key] || ''),norm:normalize(row[key])}));
    const word = values[0].norm;
    let score = 0;
    if (word === q) score = 1200;
    else if (word.startsWith(q)) score = 1010;
    else if (word.includes(q)) score = 900;

    const phraseWeights = {'Synonyms':760,'Definition':690,'Example':620,'Notes':560};
    values.slice(1).forEach(item => { if (item.norm.includes(q)) score = Math.max(score, phraseWeights[item.label] || 500); });

    const allText = values.map(v => v.norm).join(' ');
    const allTokens = tokens.length > 1 && tokens.every(token => allText.includes(token));
    if (!score && allTokens) score = 360;
    if (!score) return null;

    const matching = values.filter(item => item.norm.includes(q));
    let match = matching[0] || null;
    if (!match && allTokens) {
      match = values
        .map(item => ({...item, tokenHits:tokens.filter(token => item.norm.includes(token)).length}))
        .sort((a,b) => b.tokenHits - a.tokenHits)[0];
    }
    if (row.__source === 'master') score += Math.max(0, 50 - Number(row['Batch #'] || 0) / 1000);
    return {row, score, match, query:q, tokens};
  }
  function snippetFor(hit) {
    const row = hit.row;
    const match = hit.match;
    let raw = match?.raw || '';
    if (match?.key === 'Word') raw = String(row.Definition || row['Example Sentence'] || row.Word || '');
    const clean = String(raw).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const lower = normalize(clean);
    const q = hit.query;
    let idx = lower.indexOf(q);
    if (idx < 0 && hit.tokens.length) idx = Math.min(...hit.tokens.map(t => lower.indexOf(t)).filter(i => i >= 0));
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    const radius = 95;
    const start = Math.max(0, idx - radius);
    const end = Math.min(clean.length, Math.max(idx + q.length + radius, 170));
    return `${start ? '…' : ''}${clean.slice(start,end)}${end < clean.length ? '…' : ''}`;
  }
  function appendHighlighted(target, text, query) {
    const raw = String(text || '');
    const q = String(query || '');
    if (!q) { target.textContent = raw; return; }
    const lower = raw.toLocaleLowerCase('en-US');
    const want = q.toLocaleLowerCase('en-US');
    const idx = lower.indexOf(want);
    if (idx < 0) { target.textContent = raw; return; }
    target.append(document.createTextNode(raw.slice(0,idx)));
    const mark = document.createElement('mark');
    mark.textContent = raw.slice(idx, idx + q.length);
    target.append(mark, document.createTextNode(raw.slice(idx + q.length)));
  }
  function resultHref(row) {
    if (row.__source === 'draft') {
      const draftDeck = Math.floor(Number(row.__draftIndex || 0) / 10) + 1;
      const local = row.__localId ? `&localid=${encodeURIComponent(row.__localId)}` : '';
      return `./flashcards/wlp/batch.html?draft=${draftDeck}${local}`;
    }
    const batch = Number(row['Batch #'] || 0);
    const wid = String(row.WordID || '').trim();
    if (!batch) return './deck-browser.html';
    return `./flashcards/wlp/batch.html?batch=${pad3(batch)}${wid ? `&wordid=${encodeURIComponent(wid)}` : ''}`;
  }
  function locationText(row) {
    if (row.__source === 'draft') {
      const index = Number(row.__draftIndex || 0);
      return `Draft ${pad3(Math.floor(index / 10) + 1)} · ${(index % 10) + 1}/10`;
    }
    return `Deck WLP${pad3(Number(row['Batch #'] || 0))}${row.WordID ? ` · WID${row.WordID}` : ''}`;
  }
  function hasExactHeadword(query) {
    const q = normalize(query);
    return Boolean(q) && effectiveRows.some(row => normalize(row.Word) === q);
  }
  function searchReturnPath(query) {
    const next = new URLSearchParams();
    next.set('q', String(query || '').trim());
    if (safeReturn) next.set('return', safeReturn);
    return `global-search.html?${next.toString()}`;
  }
  function addAsDraftHref(query) {
    const next = new URLSearchParams();
    next.set('word', String(query || '').trim());
    next.set('return', searchReturnPath(query));
    return `./editor-new-card.html?${next.toString()}`;
  }
  function appendNoHeadwordNotice(resultsNode, query) {
    if (!query || hasExactHeadword(query)) return;
    const notice = document.createElement('aside');
    notice.className = 'search-headword-gap';
    const copy = document.createElement('div');
    copy.className = 'search-headword-gap-copy';
    const strong = document.createElement('strong');
    strong.textContent = `No headword match for “${query}”`;
    const small = document.createElement('span');
    small.textContent = 'It may still appear in definitions, synonyms, examples, or notes.';
    copy.append(strong, small);
    notice.append(copy);
    if (isAdminMode()) {
      const add = document.createElement('a');
      add.className = 'search-add-draft';
      add.href = addAsDraftHref(query);
      add.innerHTML = '<span aria-hidden="true">＋</span><span>Add as Draft</span>';
      add.setAttribute('aria-label', `Add ${query} as a Draft`);
      notice.append(add);
    }
    resultsNode.append(notice);
  }
  function renderResults(query) {
    const resultsNode = $('search-results');
    const meta = $('search-results-meta');
    const clear = $('global-search-clear');
    const q = String(query || '').trim();
    clear.hidden = !q;
    if (!q) {
      meta.textContent = 'Type something to search.';
      resultsNode.innerHTML = '<div class="search-empty-state"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27V14M16 17C12 11 7 10 4 11c1 6 6 9 12 8M16 14c3-6 8-8 13-7-1 6-5 10-13 10"/></svg><p>Start with a word, phrase, meaning, synonym, or example.</p></div>';
      return;
    }
    if (!effectiveRows.length) {
      meta.textContent = 'The deck is still loading…';
      return;
    }
    const hits = effectiveRows.map(row => scoreRow(row,q)).filter(Boolean).sort((a,b) => b.score - a.score || String(a.row.Word || '').localeCompare(String(b.row.Word || '')));
    meta.textContent = `${hits.length.toLocaleString()} result${hits.length === 1 ? '' : 's'} for “${q}”`;
    resultsNode.innerHTML = '';
    appendNoHeadwordNotice(resultsNode, q);
    if (!hits.length) {
      const empty = document.createElement('div'); empty.className='search-empty-state'; empty.innerHTML='<p>No matching card found.</p>'; resultsNode.append(empty); return;
    }
    hits.slice(0,RESULT_LIMIT).forEach(hit => {
      const row = hit.row;
      const card = document.createElement('article'); card.className='search-result-card';
      const main = document.createElement('div'); main.className='search-result-main';
      const top = document.createElement('div'); top.className='search-result-top';
      const word = document.createElement('h3'); word.className='search-result-word'; word.textContent=row.Word || '(untitled card)';
      const pos = document.createElement('span'); pos.className='search-result-pos'; pos.textContent=[row.IPA,row['Part of Speech']].filter(Boolean).join(' · ');
      top.append(word); if (pos.textContent) top.append(pos);
      const loc = document.createElement('div'); loc.className='search-result-location';
      const location = document.createElement('span'); location.className='location-badge'; location.textContent=locationText(row); loc.append(location);
      if (row.__source === 'draft') { const b=document.createElement('span'); b.className='local-badge'; b.textContent='Local draft'; loc.append(b); }
      else if (row.__hasOverride) { const b=document.createElement('span'); b.className='local-badge'; b.textContent='Local edit'; loc.append(b); }
      const label = document.createElement('div'); label.className='search-match-label';
      const strong = document.createElement('strong'); strong.textContent=`Matched in ${hit.match?.label || 'card'}`; label.append(strong);
      const snip = document.createElement('p'); snip.className='search-result-snippet'; appendHighlighted(snip, snippetFor(hit), q);
      main.append(top,loc,label); if (snip.textContent) main.append(snip);
      const open = document.createElement('a'); open.className='search-open-card'; open.href=resultHref(row); open.setAttribute('aria-label',`Open ${row.Word || 'card'}`); open.title='Open card'; open.innerHTML='<span>Open Card</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
      card.append(main,open); resultsNode.append(card);
    });
    if (hits.length > RESULT_LIMIT) {
      const more=document.createElement('div'); more.className='search-result-more'; more.textContent=`Showing the first ${RESULT_LIMIT} results. Refine your search to narrow it down.`; resultsNode.append(more);
    }
  }
  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderResults($('global-search-input').value), 55);
  }
  async function loadEffectiveDeck() {
    try {
      const response = await fetch(TSV_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const master = parseTSV(await response.text());
      const overrides = readObject(LOCAL_OVERRIDES_KEY);
      const drafts = draftRows(readArray(LOCAL_ADDITIONS_KEY));
      masterCount = master.length; draftCount = drafts.length;
      overrideCount = Object.values(overrides).filter(v => v && typeof v === 'object' && !Array.isArray(v)).length;
      effectiveRows = [...applyOverrides(master,overrides), ...drafts];
      $('search-source-meta').textContent = `${masterCount.toLocaleString()} Master cards · ${draftCount.toLocaleString()} local draft${draftCount === 1 ? '' : 's'} · ${overrideCount.toLocaleString()} local edit${overrideCount === 1 ? '' : 's'}`;
      renderResults($('global-search-input').value);
    } catch (error) {
      console.error('Global Search could not load the Effective Deck:', error);
      $('search-source-meta').textContent = 'Could not load the Effective Deck.';
      $('search-results').innerHTML = '<div class="search-error">Search data could not be loaded. Try reloading this page.</div>';
      $('search-results-meta').textContent = 'Search unavailable';
    }
  }

  // Return path from Study or Deck Browser.
  const params = new URLSearchParams(location.search);
  const returnPath = String(params.get('return') || '').replace(/^\/+/, '');
  const safeReturn = returnPath && !returnPath.includes('..') && /^[A-Za-z0-9_./?&=%#-]+$/.test(returnPath) ? returnPath : '';
  const back = $('search-back-link');
  if (safeReturn) {
    back.href = `./${safeReturn}`;
    const label = back.querySelector('span');
    if (/flashcards\/wlp\/batch\.html/i.test(safeReturn)) label.textContent='Back to Study';
    else if (/deck-browser\.html/i.test(safeReturn)) label.textContent='Back to Decks';
    else label.textContent='Back';
  }

  const input = $('global-search-input');
  const initialQ = params.get('q') || '';
  input.value = initialQ;
  input.addEventListener('input', scheduleSearch);
  $('global-search-clear').addEventListener('click', () => { input.value=''; renderResults(''); input.focus(); history.replaceState(null,'', safeReturn ? `./global-search.html?return=${encodeURIComponent(safeReturn)}` : './global-search.html'); });
  if (initialQ) setTimeout(() => input.setSelectionRange(input.value.length,input.value.length), 0);

  // Shared Stage 7 shell behavior.
  const menu=$('menu-button'), drawer=$('app-drawer'), close=$('drawer-close'), backdrop=$('drawer-backdrop'), toast=$('search-toast');
  const rolePill=$('role-pill'), roleLabel=$('role-label'), roleMenu=$('role-menu'), roleMenuTitle=$('role-menu-title'), roleMenuCopy=$('role-menu-copy'), roleMenuAction=$('role-menu-action'), drawerRoleAction=$('drawer-role-action');
  const drawerAdminOnly=Array.from(document.querySelectorAll('.drawer-admin-only'));
  const adminGate=$('admin-gate'), adminForm=$('admin-form'), adminPassword=$('admin-password'), adminPasswordToggle=$('admin-password-toggle'), rememberAdmin=$('remember-admin'), adminError=$('admin-error');
  const setDrawer=open=>{drawer.classList.toggle('open',open);drawer.setAttribute('aria-hidden',String(!open));menu.setAttribute('aria-expanded',String(open));backdrop.hidden=!open;};
  menu.addEventListener('click',()=>setDrawer(true)); close.addEventListener('click',()=>setDrawer(false)); backdrop.addEventListener('click',()=>setDrawer(false));
  const showToast=text=>{toast.textContent=text;toast.hidden=false;clearTimeout(window.__wlpSearchToastTimer);window.__wlpSearchToastTimer=setTimeout(()=>toast.hidden=true,2200);};
  $('drawer-settings').addEventListener('click',()=>{setDrawer(false);showToast('Settings will move into the Stage 7 app shell.');});
  document.querySelectorAll('.drawer-placeholder').forEach(button=>button.addEventListener('click',()=>{setDrawer(false);showToast(button.dataset.placeholder||'Coming soon.');}));
  const getRole=()=>localStorage.getItem(WLP_UI_ROLE_KEY)==='admin'||sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY)==='admin'?'admin':'guest';
  const clearAdmin=()=>{localStorage.removeItem(WLP_UI_ROLE_KEY);sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);};
  const setAdmin=remember=>{if(remember){localStorage.setItem(WLP_UI_ROLE_KEY,'admin');sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);}else{localStorage.removeItem(WLP_UI_ROLE_KEY);sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY,'admin');}};
  const refreshRoleUI=()=>{const admin=getRole()==='admin';roleLabel.textContent=admin?'Admin':'Guest';rolePill.classList.toggle('is-admin',admin);roleMenuTitle.textContent=admin?'Admin mode':'Guest mode';roleMenuCopy.textContent=admin?'Editing and import/export tools are unlocked.':'Study normally without editing tools.';roleMenuAction.textContent=admin?'Switch to Guest':'Admin Login';const label=drawerRoleAction.querySelector('.drawer-role-label');if(label)label.textContent=admin?'Switch to Guest':'Admin Login';drawerAdminOnly.forEach(item=>item.hidden=!admin);if(input?.value&&effectiveRows.length)renderResults(input.value);};
  const closeRoleMenu=()=>{roleMenu.hidden=true;rolePill.setAttribute('aria-expanded','false');};
  rolePill.addEventListener('click',event=>{event.stopPropagation();const open=roleMenu.hidden;roleMenu.hidden=!open;rolePill.setAttribute('aria-expanded',String(open));}); roleMenu.addEventListener('click',e=>e.stopPropagation()); document.addEventListener('click',closeRoleMenu);
  const setPasswordVisible=visible=>{adminPassword.type=visible?'text':'password';adminPasswordToggle.setAttribute('aria-pressed',String(visible));adminPasswordToggle.setAttribute('aria-label',visible?'Hide password':'Show password');adminPasswordToggle.setAttribute('title',visible?'Hide password':'Show password');};
  adminPasswordToggle.addEventListener('click',()=>{setPasswordVisible(adminPassword.type!=='text');adminPassword.focus({preventScroll:true});});
  const openAdminGate=()=>{closeRoleMenu();setDrawer(false);adminError.hidden=true;adminPassword.value='';setPasswordVisible(false);rememberAdmin.checked=false;adminGate.hidden=false;setTimeout(()=>adminPassword.focus(),0);};
  const closeAdminGate=()=>{adminGate.hidden=true;adminError.hidden=true;adminPassword.value='';setPasswordVisible(false);};
  const roleAction=()=>{if(getRole()==='admin'){clearAdmin();refreshRoleUI();closeRoleMenu();setDrawer(false);showToast('Switched to Guest mode.');}else openAdminGate();};
  roleMenuAction.addEventListener('click',roleAction);drawerRoleAction.addEventListener('click',roleAction);$('admin-close').addEventListener('click',closeAdminGate);$('admin-cancel').addEventListener('click',closeAdminGate);adminGate.addEventListener('click',e=>{if(e.target===adminGate)closeAdminGate();});
  async function sha256Hex(text){const bytes=new TextEncoder().encode(String(text));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  adminForm.addEventListener('submit',async e=>{e.preventDefault();const hash=await sha256Hex(adminPassword.value);if(hash!==WLP_ADMIN_PASSWORD_SHA256){adminError.hidden=false;adminPassword.select();return;}setAdmin(rememberAdmin.checked);refreshRoleUI();closeAdminGate();showToast('Admin mode unlocked.');});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;setDrawer(false);closeRoleMenu();closeAdminGate();});
  refreshRoleUI();

  loadEffectiveDeck();
  setTimeout(()=>input.focus({preventScroll:true}),80);
})();
