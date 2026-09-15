(() => {
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260914-stage7-1';
  const PINNED_KEY = 'wlp:stage7:pinned-decks:v1';
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const PAGE_SIZE = 40;
  const $ = id => document.getElementById(id);
  let rows = [];
  let maxBatch = 0;
  let visibleCount = PAGE_SIZE;
  let query = '';

  const readList = key => {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []; }
    catch { return []; }
  };
  const saveList = (key, list) => localStorage.setItem(key, JSON.stringify(list));
  let pinned = readList(PINNED_KEY);
  let recent = readList(RECENT_KEY);

  function parseTSV(text) {
    const table=[]; let row=[], field='', quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i], next=text[i+1];
      if(ch==='"'){ if(quoted&&next==='"'){field+='"';i++;} else quoted=!quoted; continue; }
      if(ch==='\t'&&!quoted){row.push(field);field='';continue;}
      if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);if(row.some(v=>String(v).trim()))table.push(row);row=[];field='';continue;}
      field+=ch;
    }
    row.push(field); if(row.some(v=>String(v).trim()))table.push(row);
    if(!table.length)return[];
    const headers=table[0].map(v=>String(v||'').trim());
    return table.slice(1).map(cols=>Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]??'').trim()])));
  }

  const pad = n => String(n).padStart(3,'0');
  const wordsForDeck = deck => rows.filter(r => Number(r['Batch #'] ?? r.Batch ?? 0) === deck).map(r => r.Word).filter(Boolean);
  const openDeck = deck => {
    recent = [deck, ...recent.filter(n => n !== deck)].slice(0,12);
    saveList(RECENT_KEY, recent);
    location.href = `./flashcards/wlp/batch.html?batch=${pad(deck)}`;
  };

  function deckRow(deck, opts={}) {
    const wrap=document.createElement('div'); wrap.className='deck-row'+(opts.searchHit?' search-hit':'');
    const words=wordsForDeck(deck);
    const a=document.createElement('a'); a.href=`./flashcards/wlp/batch.html?batch=${pad(deck)}`; a.className='deck-main';
    a.addEventListener('click',e=>{e.preventDefault();openDeck(deck);});
    const subtitle = opts.match ? `Match: <strong>${escapeHtml(opts.match)}</strong>` : (words.length ? words.slice(0,3).map(escapeHtml).join(' · ') : 'Open this deck');
    a.innerHTML=`<span class="deck-title">Deck WLP${pad(deck)}</span><span class="deck-sub">${subtitle}</span>`;
    const button=document.createElement('button'); button.type='button'; button.className='pin'+(pinned.includes(deck)?' active':''); button.setAttribute('aria-label',pinned.includes(deck)?'Unpin deck':'Pin deck'); button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9-5.3-3-5.3 3 1.3-5.9-4.5-4L9.5 9 12 3.5Z"/></svg>';
    button.addEventListener('click',()=>{ if(pinned.includes(deck))pinned=pinned.filter(n=>n!==deck); else pinned=[deck,...pinned]; saveList(PINNED_KEY,pinned); render(); });
    wrap.append(a,button); return wrap;
  }

  function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function appendRows(target, items, opts={}){target.innerHTML='';items.forEach(item=>target.appendChild(deckRow(typeof item==='number'?item:item.deck,{...opts,...(typeof item==='object'?item:{})})));}

  function getSearchMatches(q){
    const s=q.trim().toLowerCase(); if(!s)return[];
    const numeric=Number(s.replace(/^wlp|^deck/gi,'').trim());
    const matches=new Map();
    if(Number.isFinite(numeric)&&numeric>=1&&numeric<=maxBatch)matches.set(numeric,{deck:numeric,match:`Deck WLP${pad(numeric)}`});
    for(const r of rows){
      const deck=Number(r['Batch #'] ?? r.Batch ?? 0); if(!deck||matches.has(deck)&&matches.size>60)continue;
      const fields=[r.Word,r.Definition,r.Synonyms,r.Example,r.Note].filter(Boolean);
      const hit=fields.find(v=>String(v).toLowerCase().includes(s));
      if(hit&&!matches.has(deck)){ const word=r.Word||hit; matches.set(deck,{deck,match:word}); if(matches.size>=60)break; }
    }
    return [...matches.values()];
  }

  function render(){
    const p=pinned.filter(n=>n>=1&&n<=maxBatch); const r=recent.filter(n=>n>=1&&n<=maxBatch);
    $('pinned-section').hidden=!p.length; if(p.length)appendRows($('pinned-list'),p);
    $('recent-section').hidden=!r.length; if(r.length)appendRows($('recent-list'),r.slice(0,8));
    $('continue-section').hidden=!r.length;
    if(r.length){$('continue-deck').className='continue-feature';$('continue-deck').innerHTML='';const l=document.createElement('div');l.className='deck-list';l.appendChild(deckRow(r[0]));$('continue-deck').appendChild(l);}

    const all=$('all-list');
    if(query){
      const matches=getSearchMatches(query); $('all-heading').textContent='Search Results'; $('result-meta').textContent=`${matches.length} deck${matches.length===1?'':'s'} found`; appendRows(all,matches,{searchHit:true}); $('load-more').hidden=true; if(!matches.length)all.innerHTML='<p class="empty">No matching deck found.</p>'; return;
    }
    $('all-heading').textContent='All Decks'; const decks=Array.from({length:maxBatch},(_,i)=>i+1); const shown=decks.slice(0,visibleCount); $('result-meta').textContent=`Showing ${shown.length} of ${maxBatch}`; appendRows(all,shown); $('load-more').hidden=shown.length>=maxBatch;
  }

  $('deck-search').addEventListener('input',e=>{query=e.target.value;visibleCount=PAGE_SIZE;render();});
  $('load-more').addEventListener('click',()=>{visibleCount+=PAGE_SIZE;render();});

  fetch(TSV_URL,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}).then(text=>{
    rows=parseTSV(text); maxBatch=rows.reduce((m,r)=>Math.max(m,Number(r['Batch #'] ?? r.Batch ?? 0)||0),0); $('deck-count').textContent=`${maxBatch} decks`; render();
    if(new URLSearchParams(location.search).get('view')==='recent')$('recent-section').scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(err=>{console.error(err);$('deck-count').textContent='Unavailable';$('all-list').innerHTML='<p class="empty">Could not load deck data.</p>';$('result-meta').textContent='Please try again.';});
})();
