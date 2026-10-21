/* WLP G4-1 · Explicit view-only deck inspector for dynamic Account Canonical Mirror.
 * Does not load/modify a card or create any Standard/Review event.
 * The full Mirror is verified by WLPG4NewMirrorReader BEFORE this API is called.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4VerifiedDeckView=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const fail=s=>{throw new Error('G4 deck view HOLD: '+s);};
  const clean=s=>String(s??'').trim();
  function validateRows(rows){
    if(!Array.isArray(rows)||rows.length<1)fail('no verified cards');
    const ids=new Set();
    for(const row of rows){
      const id=clean(row?.WordID), batch=clean(row?.['Batch #']);
      if(!/^\d+$/.test(id)||Number(id)<1||ids.has(id)||row?.__g4MirrorNewPreview!==true||
        row?.__p1d1Canonical!==true||!clean(row?.__p1d1CardId)||!clean(row?.Word))
        fail('unverified or duplicate card identity');
      if(batch&&!/^\d+$/.test(batch))fail('invalid deck membership');
      ids.add(id);
    }
    return true;
  }
  function renderDeck(deck,rows){
    validateRows(rows);
    const num=Number(deck);
    if(!Number.isSafeInteger(num)||num<1)fail('invalid deck');
    const selected=rows.filter(x=>Number(x['Batch #'])===num);
    if(!selected.length)fail('no verified cards in the selected deck');
    if(typeof document==='undefined')fail('document unavailable');
    document.getElementById('wlp-g4-deck-inspector')?.remove();
    const overlay=document.createElement('div');
    overlay.id='wlp-g4-deck-inspector';
    overlay.setAttribute('role','presentation');
    overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(20,30,24,.55);overflow-y:auto;padding:20px 12px 60px';
    const dialog=document.createElement('section');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label',`Verified read-only WLP deck ${num}`);
    dialog.style.cssText='max-width:700px;margin:10px auto;background:#fff;color:#202b22;border-radius:14px;padding:18px;line-height:1.55';
    const head=document.createElement('div');
    head.style.cssText='display:flex;justify-content:space-between;gap:10px;align-items:flex-start';
    const title=document.createElement('strong');title.textContent=`WLP${String(num).padStart(3,'0')} · ${selected.length} verified cards · VIEW ONLY`;
    const close=document.createElement('button');close.type='button';close.textContent='Close';
    close.setAttribute('aria-label','Close verified deck');
    close.style.cssText='padding:8px 13px;border-radius:9px;border:1px solid #aaa;background:#f7f7f7';
    head.append(title,close);dialog.appendChild(head);
    const note=document.createElement('p');
    note.textContent='From the signed-in account’s verified Local Library. No Study, Continue, Review, Edit, or Sync actions are available in this preview.';
    dialog.appendChild(note);
    for(const row of selected){
      const card=document.createElement('article');
      card.style.cssText='padding:12px 0;border-top:1px solid #e0e4e0';
      const name=document.createElement('h3');name.style.cssText='margin:0 0 6px;font-size:1.06rem';
      name.textContent=`WID${row.WordID} · ${row.Word}`;card.appendChild(name);
      for(const [label,key] of [['IPA','IPA'],['Part of Speech','Part of Speech'],['Definition','Definition'],['Example','Example Sentence'],['Synonyms','Synonym(s)'],['Notes','Note(s)']]){
        const value=clean(row[key]);if(!value)continue;
        const p=document.createElement('p');p.style.cssText='margin:5px 0;overflow-wrap:anywhere';
        const b=document.createElement('strong');b.textContent=label+': ';
        p.append(b,document.createTextNode(value));card.appendChild(p);
      }
      dialog.appendChild(card);
    }
    overlay.appendChild(dialog);
    const onKey=event=>{if(event.key==='Escape')remove();};
    function remove(){document.removeEventListener('keydown',onKey);overlay.remove();}
    close.addEventListener('click',remove);
    overlay.addEventListener('click',event=>{if(event.target===overlay)remove();});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(overlay);close.focus();
    return Object.freeze({count:selected.length,source:'verified-local-mirror',readOnly:true});
  }
  return Object.freeze({validateRows,renderDeck});
});
