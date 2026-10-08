/* WLP P1-C2 · Read-only source comparison and field merge policy: live Master TSV + protected Legacy Local Edits
   versus isolated P1-B Canonical Official IndexedDB projection. No live source
   cutover, Cloud request, IndexedDB/localStorage write or SW registration. */
(() => {
  'use strict';
  const DB_NAME='wlp-official-shadow-p1-v1';
  const MASTER_URL='./flashcards/wlp/wlp-flashcard-master.tsv?v=20261008-p1c-shadow-read';
  const OVERRIDE_KEY='wlp:local-overrides:v1';
  const AUTHORITY='v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc';
  const BASELINE_MANIFEST='ce063b04a31a345763332c2fa64a5ae2f94c2c1d8fd75bae180aef6ff5caa5b9';
  const MASTER_SHA256='656674590336e56ddf25a95ed6486a060437537c40caf53d5cce647342bd6bfe';
  const EXPECTED_BASELINE_WIDS=[1,312,1568,4093,4120,5578,6689,6884];
  const FIELDS=Object.freeze([
    ['Word','word'],['IPA','ipa'],['Part of Speech','part_of_speech'],
    ['Definition','definition'],['Synonym(s)','synonyms'],
    ['Example Sentence','example_sentence'],['Note(s)','notes'],
    ['Category','category'],['Source','source']
  ]);
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const normal=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const equal=(a,b)=>String(a??'')===String(b??'');
  const cmpValue=(a,b)=>equal(a,b)?'exact':normal(a)===normal(b)?'line-ending/edge-space':'different';
  // Mirrors the quote/tab/newline parsing and trim behavior in global-search.js.
  function parseTsv(text){
    const table=[];let row=[],field='',quoted=false;
    const source=String(text??'').replace(/^\uFEFF/,'');
    for(let i=0;i<source.length;i++){
      const ch=source[i],next=source[i+1];
      if(ch==='"'){if(quoted&&next==='"'){field+='"';i++;}else quoted=!quoted;continue;}
      if(ch==='\t'&&!quoted){row.push(field);field='';continue;}
      if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);if(row.some(v=>String(v).trim()))table.push(row);row=[];field='';continue;}
      field+=ch;
    }
    assert(!quoted,'Master TSV has an unclosed quoted field');
    row.push(field);if(row.some(v=>String(v).trim()))table.push(row);
    assert(table.length>1,'Master TSV is empty');
    const headers=table[0].map(v=>String(v||'').trim());
    const expected=['Batch #','Guidance #','WordID',...FIELDS.map(x=>x[0])];
    assert(headers.length===expected.length&&expected.every((x,i)=>x===headers[i]),'Unexpected Master TSV headers');
    return table.slice(1).map(cols=>Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]??'').trim()])));
  }
  function parseOverrides(raw){
    assert(typeof raw==='string'&&raw.length,'Legacy Local Edit storage is missing; comparison will not assume zero edits');
    let obj;try{obj=JSON.parse(raw);}catch{throw new Error('Legacy Local Edit storage contains invalid JSON');}
    assert(obj&&typeof obj==='object'&&!Array.isArray(obj),'Legacy Local Edit storage has an unexpected shape');
    for(const [wid,entry] of Object.entries(obj)){
      assert(/^\d+$/.test(wid)&&entry&&typeof entry==='object'&&!Array.isArray(entry),`Invalid Legacy Local Edit at ${wid}`);
    }
    return obj;
  }
  function applyOverride(row,override){
    const next={...row};
    if(override)for(const [label] of FIELDS){if(Object.prototype.hasOwnProperty.call(override,label))next[label]=String(override[label]??'');}
    return next;
  }
  function analyze(rows,entries,overrides,meta){
    assert(meta&&meta.authorityKey===AUTHORITY,'Unexpected active Canonical Authority');
    assert(meta.source==='cloud'&&typeof meta.accountKey==='string'&&/^[0-9a-f]{64}$/i.test(meta.accountKey),'P1-B Cloud-installed account-bound projection required');
    assert(Number.isSafeInteger(meta.cursor)&&meta.cursor>=614,'Installed projection is older than the approved P0 cursor');
    assert(Number.isSafeInteger(meta.count)&&meta.count>=6660&&meta.count===entries.length,'Active projection count does not match its IndexedDB rows');
    assert(/^[0-9a-f]{64}$/i.test(String(meta.libraryManifestHash||'')),'Missing verified projection manifest');
    if(meta.cursor===614)assert(meta.libraryManifestHash===BASELINE_MANIFEST,'Baseline cursor manifest mismatch');
    const master=new Map(),projection=new Map(),issues=[];
    for(const row of rows){const wid=Number(row.WordID);assert(Number.isSafeInteger(wid)&&wid>0&&!master.has(wid),`Duplicate/invalid Static Master WID ${row.WordID}`);master.set(wid,row);}
    for(const item of entries){
      const wid=Number(item?.wordId);const e=item?.entry;
      assert(Number.isSafeInteger(wid)&&wid>0&&!projection.has(wid),`Duplicate/invalid projection WID ${wid}`);
      assert(e?.kind==='official'&&e.card?.status==='active'&&e.card?.word_id===wid&&e.card?.card_id===item.cardId&&e.cardId===item.cardId&&e.effectiveContent?.card_id===item.cardId,`Card identity mismatch at WID${wid}`);
      assert(e.localOverride===null,`Active Canonical Local Override needs separate migration policy (WID${wid})`);
      projection.set(wid,e);
    }
    const staticOnly=[],projectionOnly=[],missingOverrideWids=[],legacyWids=Object.keys(overrides).map(Number).sort((a,b)=>a-b);
    const baselineDiffs=[],effectiveDiffs=[],lineEndingDiffs=[],overrideWids=[];
    let baselineDifferentFields=0,effectiveDifferentFields=0,lineEndingFields=0,compared=0,exactBaselineFields=0,exactEffectiveFields=0;
    for(const [wid,row] of master){
      const e=projection.get(wid);if(!e){staticOnly.push(wid);continue;}
      compared++;
      const override=overrides[String(wid)]||null,effective=applyOverride(row,override);
      if(override)overrideWids.push(wid);
      if(Number(row['Batch #'])!==Number(e.card.legacy_batch)||String(row['Guidance #'])!==String(e.card.legacy_guidance))issues.push(`WID${wid}: batch/guidance identity mismatch`);
      const b=[],l=[],n=[];
      for(const [label,key] of FIELDS){
        const canon=e.effectiveContent[key],base=row[label],live=effective[label];
        const baseline=cmpValue(base,canon),overlaid=cmpValue(live,canon);
        if(baseline==='different'){b.push(label);baselineDifferentFields++;}
        else if(baseline==='line-ending/edge-space'){n.push(label);lineEndingFields++;}
        else exactBaselineFields++;
        if(overlaid==='different'){l.push(label);effectiveDifferentFields++;}
        else if(overlaid==='exact')exactEffectiveFields++;
      }
      if(b.length)baselineDiffs.push({wid,fields:b});
      if(l.length)effectiveDiffs.push({wid,fields:l,hasLegacyOverride:Boolean(override)});
      if(n.length)lineEndingDiffs.push({wid,fields:n});
    }
    for(const wid of projection.keys())if(!master.has(wid))projectionOnly.push(wid);
    for(const wid of legacyWids)if(!master.has(wid))missingOverrideWids.push(wid);
    staticOnly.sort((a,b)=>a-b);projectionOnly.sort((a,b)=>a-b);
    overrideWids.sort((a,b)=>a-b);baselineDiffs.sort((a,b)=>a.wid-b.wid);effectiveDiffs.sort((a,b)=>a.wid-b.wid);
    if(staticOnly.length)issues.push(`${staticOnly.length} Static cards are not in the projection`);
    if(missingOverrideWids.length)issues.push(`Legacy Local Edits without Master cards: ${missingOverrideWids.join(',')}`);
    const initialBaseline=meta.cursor===614;
    if(rows.length!==6658)issues.push(`Unexpected Static Master count ${rows.length} (expected 6,658)`);
    if(meta.masterSha256!==MASTER_SHA256)issues.push('Normalized Static Master SHA-256 differs from deployed P1-C baseline');
    if(meta.cursor!==614)issues.push('Projection is newer than P0 cursor 614; expected content differences must be re-reviewed');
    if(JSON.stringify(legacyWids)!==JSON.stringify(EXPECTED_BASELINE_WIDS))issues.push('Device Legacy Local Edit WID set differs from protected baseline; do not delete any edits');
    const baselineWids=baselineDiffs.map(x=>x.wid);
    const expectedKnown=initialBaseline&&rows.length===6658&&JSON.stringify(baselineWids)===JSON.stringify(EXPECTED_BASELINE_WIDS)&&baselineDifferentFields===10;
    const expectedCloudOnly=initialBaseline&&JSON.stringify(projectionOnly)===JSON.stringify([7111,7112]);
    const cleanStructure=!issues.length&&compared===rows.length&&projectionOnly.length===meta.count-rows.length;
    const condition=cleanStructure&&(!initialBaseline||(expectedKnown&&expectedCloudOnly));
    return {
      status:condition?'PASS':'CHECK',
      statement:condition?'Source coverage verified; differences classified. LIVE CUTOVER NOT AUTHORIZED.':'Source comparison needs review. LIVE CUTOVER NOT AUTHORIZED.',
      active:{generation:meta.generation,cursor:meta.cursor,count:meta.count,authorityKey:meta.authorityKey,libraryManifestHash:meta.libraryManifestHash,source:meta.source,accountBound:true,accountOwnershipReverified:false},
      normalizedStaticMasterSha256:meta.masterSha256||null,
      counts:{staticMaster:rows.length,projectionOfficial:entries.length,compared,projectionOnly:projectionOnly.length,staticOnly:staticOnly.length,legacyOverrideCopies:legacyWids.length,legacyOverrideWithMaster:overrideWids.length,baselineDifferentCards:baselineDiffs.length,baselineDifferentFields,effectiveDifferentCards:effectiveDiffs.length,effectiveDifferentFields,lineEndingOnlyCards:lineEndingDiffs.length,lineEndingOnlyFields:lineEndingFields,exactBaselineFields,exactEffectiveFields},
      expectedBaseline:{checked:initialBaseline,knownDifferenceWidsMatch:expectedKnown,cloudOnlyCanariesMatch:expectedCloudOnly},
      ids:{projectionOnly,staticOnly,legacyOverrideWids:legacyWids,legacyOverrideMissingMaster:missingOverrideWids},
      baselineDifferences:baselineDiffs,effectiveDifferences:effectiveDiffs,
      newlineOnlyDifferences:lineEndingDiffs,
      issues,
      constraints:{shadowOnly:true,readSourceCutover:false,staticSource:'Master TSV',legacyOverlay:'wlp:local-overrides:v1',noCloudCalls:true,noWrites:true,accountOwnershipUnverified:true,draftsExcluded:true,learningMetadataUiNotCompared:true}
    };
  }
  const core={parseTsv,parseOverrides,applyOverride,analyze,cmpValue,FIELDS};
  if(typeof module!=='undefined'&&module.exports)module.exports=core;
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  let state=null,busy=false;
  const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB request error'));});
  const show=(id,value)=>{$(id).textContent=String(value);};
  function setBusy(value){busy=value;$('compare').disabled=value;$('show-card').disabled=value||!state;$('audit').disabled=value||!state;}
  async function openExistingDb(){
    assert(typeof indexedDB.databases==='function','This Chrome version cannot safely check the existing projection DB');
    const dbs=await indexedDB.databases();
    assert(dbs.some(d=>d.name===DB_NAME),'No existing P1-B IndexedDB; P1-C will NOT create one');
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME);
      request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('Projection DB not initialized; no DB created'))};
      request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('meta')||!db.objectStoreNames.contains('official')){db.close();reject(new Error('Existing P1-B DB lacks the expected stores'));return;}resolve(db);};
      request.onerror=()=>reject(request.error||new Error('Could not read existing P1-B DB'));
      request.onblocked=()=>reject(new Error('P1-B DB blocked by another browser tab'));
    });
  }
  async function snapshot(){
    const db=await openExistingDb();
    try{
      const tx=db.transaction('meta','readonly'),stored=await req(tx.objectStore('meta').get('active'));
      const active=stored?.value;
      assert(active?.generation&&active.count,'P1-B active projection missing');
      const official=[];
      await new Promise((resolve,reject)=>{
        const t=db.transaction('official','readonly');
        let failure=null;
        const range=IDBKeyRange.bound([active.generation,''],[active.generation,'\uffff']);
        const cursor=t.objectStore('official').openCursor(range);
        cursor.onsuccess=()=>{const item=cursor.result;if(item){official.push(item.value);item.continue();}};
        cursor.onerror=()=>{failure=cursor.error||new Error('Projection cursor failed');};
        t.oncomplete=()=>resolve();t.onabort=()=>reject(failure||t.error||new Error('Projection read aborted'));
        t.onerror=()=>{failure=t.error||new Error('Projection read error');};
      });
      const checkTx=db.transaction('meta','readonly'),current=await req(checkTx.objectStore('meta').get('active'));
      assert(current?.value?.generation===active.generation,'Another tab switched projection during comparison; retry');
      return{active,official};
    }finally{db.close();}
  }
  const stat=(name,value)=>{const outer=document.createElement('div');outer.className='stat';const b=document.createElement('b');b.textContent=Number(value).toLocaleString('en-US');const label=document.createElement('span');label.textContent=name;outer.append(b,label);return outer;};
  function renderStats(a){
    const c=a.counts,box=$('stats');box.replaceChildren();
    for(const [k,v] of [['Static Master',c.staticMaster],['Local Projection Official',c.projectionOfficial],['WIDs compared',c.compared],['Cloud-only cards',c.projectionOnly],['Legacy Local Edits',c.legacyOverrideCopies],['Canonical vs Master difference cards',c.baselineDifferentCards],['After-Local-Edit difference cards',c.effectiveDifferentCards],['Line-ending-only fields',c.lineEndingOnlyFields]])box.append(stat(k,v));box.hidden=false;
  }
  function renderPolicy(policy){
    const c=policy.summary,box=$('policy-stats');box.replaceChildren();
    for(const [label,n] of [
      ['Protected Local Edits',c.legacyCopies],['Legacy field snapshots',c.fieldSnapshots],
      ['Matches Canonical',c.matchesCanonical],['Canonical advanced',c.canonicalAdvanced],
      ['Fields on HOLD',c.heldFields],['Cards on HOLD',c.heldCards]
    ])box.append(stat(label,n));box.hidden=false;
    show('policy-summary',`${policy.status} · ${policy.statement}\n${c.matchesCanonical} matching fields · ${c.canonicalAdvanced} Canonical-forward fields · ${c.formatReview} formatting reviews\n${c.localUnknownHold} local-origin unknown · ${c.divergentHold} divergent · ${c.missingHold} incomplete.\nNo live cutover. Legacy copies retained. Account ownership NOT reverified.`);
    const wrapper=$('policy-held');wrapper.replaceChildren();
    if(!policy.held.length){
      const note=document.createElement('p');note.className='p1c-note';note.textContent='No individual held fields found. This is still a shadow-only policy and not a cutover approval.';wrapper.append(note);
    }else{
      const table=document.createElement('table');table.className='p1c2-table';
      const th=document.createElement('thead'),heading=document.createElement('tr');
      for(const label of ['WordID','Field','Safe decision']){const cell=document.createElement('th');cell.textContent=label;heading.append(cell);}th.append(heading);table.append(th);
      const body=document.createElement('tbody');
      for(const item of policy.held){const tr=document.createElement('tr');
        for(const value of [`WID${item.wid}`,item.field,window.WLPP1C2Policy.publicLabels[item.classification]||'HOLD']){
          const td=document.createElement('td');td.textContent=value;tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);wrapper.append(table);
    }
    wrapper.hidden=false;
  }
  function clearPolicy(){
    $('policy-stats').hidden=true;$('policy-held').hidden=true;
    $('policy-held').replaceChildren();show('policy-summary','Not evaluated. Run Step 1 again. No data written.');
  }
  function entryFor(wid){return state.byWid.get(wid)||null;}
  function detail(wid){
    const target=$('card');target.replaceChildren();
    const master=state.master.get(wid),canon=entryFor(wid),override=state.overrides[String(wid)]||null;
    const intro=document.createElement('p');intro.className='p1c-note';intro.textContent=`WID${wid} · Static Master: ${master?'present':'not present'} · Canonical: ${canon?'present':'not present'} · protected Legacy Local Edit: ${override?'present':'not present'}.`;
    target.append(intro);
    if(!master||!canon)return;
    const effective=applyOverride(master,override),table=document.createElement('table');table.className='p1c-table';
    const head=document.createElement('thead'),tr=document.createElement('tr');for(const name of ['Field','Master vs Canonical','Local Edit overlay vs Canonical']){const h=document.createElement('th');h.textContent=name;tr.append(h);}head.append(tr);table.append(head);
    const body=document.createElement('tbody');
    for(const [label,key] of FIELDS){
      const baseline=cmpValue(master[label],canon.effectiveContent[key]),after=cmpValue(effective[label],canon.effectiveContent[key]);
      const changed=Boolean(override&&Object.prototype.hasOwnProperty.call(override,label));
      const row=document.createElement('tr');for(const v of [label,baseline,`${after}${changed?' · override applied':''}`]){const cell=document.createElement('td');cell.textContent=v;row.append(cell);}body.append(row);
    }
    table.append(body);const container=document.createElement('div');container.className='p1c-scroll';container.append(table);target.append(container);
    const note=document.createElement('p');note.className='p1c-note';note.textContent='Comparison labels only. Local/Edit values are not exported. A discrepancy may be expected; do not delete or migrate any Local Edit based on this panel.';target.append(note);
  }
  async function compare(){
    assert(!busy,'Comparison already running');state=null;setBusy(true);$('stats').hidden=true;clearPolicy();show('card','Run Step 1 first.');
    try{
      show('summary','READING · existing P1-B IndexedDB, current Static Master TSV and Legacy Local Edits. Read-only…');
      const [local,response]=await Promise.all([snapshot(),fetch(MASTER_URL,{cache:'no-store'})]);
      assert(response.ok,`Master TSV read failed: HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const normalizedBytes=new TextEncoder().encode(text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'));
      const masterSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',normalizedBytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      const raw=localStorage.getItem(OVERRIDE_KEY);
      const masterRows=parseTsv(text),overrides=parseOverrides(raw);
      const result=analyze(masterRows,local.official,overrides,{...local.active,masterSha256});
      const master=new Map(masterRows.map(row=>[Number(row.WordID),row]));
      const byWid=new Map(local.official.map(r=>[Number(r.wordId),r.entry]));
      assert(window.WLPP1C2Policy?.evaluate,'Missing P1-C2 policy engine; do not accept an incomplete deployment');
      const policy=window.WLPP1C2Policy.evaluate(master,byWid,overrides,result);
      const currentRaw=localStorage.getItem(OVERRIDE_KEY);
      assert(currentRaw===raw,'Legacy Local Edits changed during comparison; retry to avoid stale policy results');
      state={result,master,byWid,overrides,policy,localRaw:raw};
      renderStats(result);renderPolicy(policy);
      const c=result.counts;
      show('summary',`${result.status} · ${result.statement}\nCursor ${result.active.cursor} · ${c.compared} shared WIDs · ${c.projectionOnly} Canonical-only · ${c.staticOnly} Static-only\n${c.baselineDifferentCards} Master/Canonical difference cards (${c.baselineDifferentFields} fields) · ${c.lineEndingOnlyFields} line-ending/edge-space-only fields\n${c.legacyOverrideCopies} Legacy Local Edits · ${c.effectiveDifferentCards} Local-effective difference cards (${c.effectiveDifferentFields} fields)\nKnown baseline WID differences: ${result.expectedBaseline.knownDifferenceWidsMatch?'MATCH':'CHECK'} · WID7111/7112: ${result.expectedBaseline.cloudOnlyCanariesMatch?'MATCH':'CHECK'}\nNo live source switched; no data written.`);
      detail(Number($('wid').value)||4120);
      show('status',`${result.status} · Source comparison complete. P1-C2 ${policy.status} (${policy.summary.heldFields} held fields). Read-only; LIVE CUTOVER NOT AUTHORIZED.`);
    }catch(e){state=null;clearPolicy();show('summary',`BLOCKED · ${e?.message||String(e)}. No data written.`);show('status',`BLOCKED · ${e?.message||String(e)}`);}
    finally{setBusy(false);}
  }
  function exportAudit(){
    if(!state?.policy)return;
    if(localStorage.getItem(OVERRIDE_KEY)!==state.localRaw){show('status','STALE · Local Edits changed after comparison. Repeat Step 1 before exporting.');return;}
    const report={format:'WLP_P1C2_SHADOW_MERGE_POLICY_AUDIT',version:1,createdAt:new Date().toISOString(),...state.result,policy:state.policy};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='p1c2-audit.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('compare').addEventListener('click',compare);
  $('show-card').addEventListener('click',()=>{if(state){const wid=Number($('wid').value);if(Number.isSafeInteger(wid)&&wid>0)detail(wid);else show('card','Enter a valid WordID');}});
  $('audit').addEventListener('click',exportAudit);
})();
