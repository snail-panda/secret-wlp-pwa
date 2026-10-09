/* WLP P1-B · P1-A preserved + explicit, authenticated Cloud-to-shadow read-only preview and guarded install.
   P1-B may call the existing authenticated, read-only Canonical Library builder.
   It does NOT write Canonical card data, change live WLP Outbox, Local Edits,
   Cloud Mirror, Master TSV, Review or Study data. */
(() => {
  'use strict';
  const DB_NAME='wlp-official-shadow-p1-v1', DB_VERSION=1;
  const TABLE='official', META='meta', ACTIVE='active';
  const FORMAT='WLP_CANONICAL_LIBRARY_EXPORT';
  const EXPECTED=Object.freeze({
    candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion:3,
    snapshotManifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',
    cursor:614,
    sourceCanonicalManifestHash:'7c41d762d6551ee8fac90a90255d8c01352e0c12e03eb0e477fd17e297964d7b',
    libraryManifestHash:'ce063b04a31a345763332c2fa64a5ae2f94c2c1d8fd75bae180aef6ff5caa5b9',
    fileSha256:'f14e761c9d5ca5150fdcbe2ab23938b2130393437eea6af13b771848320f4ed1'
  });
  const $=id=>document.getElementById(id);
  const state={inspected:null,cloudCandidate:null,active:null,busy:false,lastReport:null};
  const countLabel=(x)=>Number(x||0).toLocaleString('en-US');
  const assert=(yes,message)=>{if(!yes)throw new Error(message);};
  const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB request failed'));});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed'));});
  const show=(id,text)=>{$(id).textContent=String(text);};
  const status=text=>show('status',text);
  const setBusy=busy=>{state.busy=busy;$('check').disabled=busy;$('snapshot').disabled=busy;$('lookup').disabled=busy;$('install').disabled=busy||!state.inspected;$('cloud-check').disabled=busy;$('cloud-install').disabled=busy||!state.cloudCandidate;};
  function openDb(){return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(TABLE)){
        const store=db.createObjectStore(TABLE,{keyPath:['generation','cardId']});
        store.createIndex('generationWid',['generation','wordId'],{unique:true});
      }
      if(!db.objectStoreNames.contains(META))db.createObjectStore(META,{keyPath:'key'});
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error||new Error('Could not open isolated projection DB'));
    r.onblocked=()=>reject(new Error('Isolated projection DB blocked by another tab'));
  });}
  async function getActive(db){const tx=db.transaction(META,'readonly'),data=await req(tx.objectStore(META).get(ACTIVE));return data?.value||null;}
  function checkEntry(entry,kind,seenIds,seenWids){
    assert(entry&&typeof entry==='object'&&entry.kind===kind,`${kind} entry shape invalid`);
    const id=String(entry.cardId||'');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),`Invalid Card ID ${id}`);
    assert(entry.card?.card_id===id&&entry.baseContent?.card_id===id&&entry.effectiveContent?.card_id===id,`Card/content ID mismatch ${id}`);
    assert(!seenIds.has(id),`Duplicate Card ID ${id}`);seenIds.add(id);
    assert(entry.localOverride===null,`Active Canonical Local Override requires separate P1 design (${id})`);
    assert(entry.card.status===(kind==='official'?'active':'draft'),`Unexpected status ${id}`);
    assert(entry.card.origin_kind===(kind==='official'?'official':'personal'),`Unexpected origin kind ${id}`);
    if(kind==='official'){
      const wid=Number(entry.card.word_id);
      assert(Number.isSafeInteger(wid)&&wid>0&&!seenWids.has(wid),`Duplicate/invalid WordID ${wid}`);
      assert(entry.card.legacy_key===`wid:${wid}`,`Legacy key mismatch ${wid}`);
      seenWids.add(wid);
    }
    for(const item of [entry.classification,entry.learningMetadata,...(entry.situations||[]),...(entry.alternatives||[])]){
      if(item)assert(item.card_id===id,`Attached metadata identity mismatch ${id}`);
    }
    assert(Array.isArray(entry.situations)&&Array.isArray(entry.alternatives),`Learning metadata children invalid ${id}`);
    assert(typeof entry.effectiveContent.word==='string'&&entry.effectiveContent.word.length>0,`Missing Word ${id}`);
  }
  function inspect(data){
    assert(data?.format===FORMAT&&data.version===1,'Not a version 1 Canonical Library export');
    assert(data.authority?.candidateKey===EXPECTED.candidateKey&&data.authority?.headVersion===EXPECTED.headVersion&&data.authority?.snapshotManifestHash===EXPECTED.snapshotManifestHash,'Unexpected Canonical Authority');
    assert(data.highWaterChangeSeq===EXPECTED.cursor,'P1-A accepts ONLY the verified post-Restore cursor 614 export');
    assert(data.sourceCanonicalManifestHash===EXPECTED.sourceCanonicalManifestHash&&data.libraryManifestHash===EXPECTED.libraryManifestHash,'Post-Restore Canonical manifest does not match the approved P0 baseline');
    assert(data.summary?.officialCardCount===6660&&data.summary?.draftCardCount===8&&data.summary?.activeCardCount===6668,'Unexpected card counts');
    assert(data.summary?.learningMetadataCount===18&&data.summary?.classificationCount===6658,'Unexpected metadata counts');
    assert(data.summary?.activeCanonicalLocalEditCount===0,'An active Canonical override requires a new projection policy');
    assert(Array.isArray(data.officialCards)&&data.officialCards.length===6660,'Missing Official cards');
    assert(Array.isArray(data.draftCards)&&data.draftCards.length===8,'Missing Drafts');
    const ids=new Set(),wids=new Set();
    for(const e of data.officialCards)checkEntry(e,'official',ids,wids);
    for(const e of data.draftCards)checkEntry(e,'draft',ids,wids);
    assert(wids.has(7111)&&wids.has(7112),'Promoted Official canary IDs missing');
    const w4120=data.officialCards.find(x=>x.card.word_id===4120);
    assert(w4120&&/voca_0123/.test(String(w4120.effectiveContent.source||'')),'WID4120 merged Source is missing');
    assert(String(w4120.effectiveContent.notes||'').length>100,'WID4120 merged Notes are missing');
    assert(data.officialCards.every(e=>e.baseContent&&e.effectiveContent),'Official content incomplete');
    return {count:wids.size,wordIds:wids,notes4120:String(w4120.effectiveContent.notes||'').length,source4120:String(w4120.effectiveContent.source||''),synonyms4120:String(w4120.effectiveContent.synonyms||'')};
  }
  // The exact P0 baseline remains immutable, but later Cloud snapshots are allowed
  // if they are authenticated, fully materialized at one verified server boundary,
  // and belong to the same Authority and local account binding.
  function inspectCloudLibrary(data){
    assert(data?.format===FORMAT&&data.version===1,'Not a Canonical Library export');
    assert(data.authority?.candidateKey===EXPECTED.candidateKey&&data.authority?.headVersion===EXPECTED.headVersion&&data.authority?.snapshotManifestHash===EXPECTED.snapshotManifestHash,'Different Authority; refusing Cloud projection');
    const cursor=Number(data.highWaterChangeSeq);
    assert(Number.isSafeInteger(cursor)&&cursor>=EXPECTED.cursor,'Cloud cursor is older than approved P0 baseline');
    assert(/^[a-f0-9]{64}$/i.test(String(data.sourceCanonicalManifestHash||''))&&/^[a-f0-9]{64}$/i.test(String(data.libraryManifestHash||'')),'Missing verified Cloud manifests');
    const official=data.officialCards||[],drafts=data.draftCards||[],ids=new Set(),wids=new Set();
    assert(Array.isArray(official)&&official.length>=6660,'Canonical Official count dropped below 6,660; manual reconciliation required');
    assert(Array.isArray(drafts)&&data.summary?.officialCardCount===official.length&&data.summary?.draftCardCount===drafts.length&&data.summary?.activeCardCount===official.length+drafts.length,'Cloud counts do not match entries');
    assert(Number(data.summary?.activeCanonicalLocalEditCount)===0,'Active Canonical overrides need separate merge support; blocked');
    for(const e of official)checkEntry(e,'official',ids,wids);
    for(const e of drafts)checkEntry(e,'draft',ids,wids);
    assert(wids.has(7111)&&wids.has(7112),'Promoted Official canary WIDs absent');
    const w4120=official.find(x=>x.card.word_id===4120);
    assert(w4120&&/voca_0123/.test(String(w4120.effectiveContent.source||''))&&String(w4120.effectiveContent.notes||'').length>100,'WID4120 merged data missing');
    if(cursor===EXPECTED.cursor)assert(data.libraryManifestHash===EXPECTED.libraryManifestHash&&data.sourceCanonicalManifestHash===EXPECTED.sourceCanonicalManifestHash,'Cursor 614 manifest mismatch with approved P0');
    return {count:official.length,cursor,checks:{wid4120:true},wids};
  }
  function openExistingOutbox(){return new Promise((resolve,reject)=>{
    const r=indexedDB.open('wlp-cloud-v1',1);let newlyCreated=false;
    r.onupgradeneeded=()=>{newlyCreated=true;try{r.transaction.abort();}catch(_){}};
    r.onsuccess=()=>{
      if(newlyCreated){r.result.close();reject(new Error('Canonical mirror not initialized; cannot check pending Outbox'));return;}
      if(!r.result.objectStoreNames.contains('sync_outbox')){r.result.close();reject(new Error('Canonical Outbox store is absent'));return;}
      resolve(r.result);
    };
    r.onerror=()=>reject(new Error('Cannot open existing Canonical Outbox safely'));
    r.onblocked=()=>reject(new Error('Canonical Outbox is blocked by another tab'));
  });}
  // A first-time browser has no Canonical Mirror yet. That is safe for a
  // READ-ONLY Official snapshot install, but NOT permission to write study state.
  // Never create a live mirror just to inspect it. An existing mirror must have
  // a valid Outbox store and exactly zero pending rows.
  async function inspectLiveOutbox(){
    assert(typeof indexedDB.databases==='function','Cannot verify whether a live Canonical Mirror exists');
    const databases=await indexedDB.databases();
    if(!databases.some(row=>row.name==='wlp-cloud-v1'))return{mirrorPresent:false,count:0};
    let db;
    try{
      db=await openExistingOutbox();
      return{mirrorPresent:true,count:await req(db.transaction('sync_outbox','readonly').objectStore('sync_outbox').count())};
    }finally{db?.close();}
  }
  function assertAccountBinding(active,accountKey){
    assert(/^[a-f0-9]{64}$/i.test(accountKey||''),'Authenticated account fingerprint missing');
    if(!active)return;
    assert(active.authorityKey===EXPECTED.candidateKey,'Different Authority installed locally');
    if(active.accountKey)assert(active.accountKey===accountKey,'Different Cloud account than existing local projection; blocked');
    else assert(active.cursor===614&&active.fileHash===EXPECTED.fileSha256&&active.libraryManifestHash===EXPECTED.libraryManifestHash,'Unbound local projection is not the verified P1-A baseline; blocked');
  }
  async function inspectCloud(){
    const reader=window.WLPCanonicalLibraryShadowReader;
    assert(reader?.read&&reader?.boundary,'Verified read-only Canonical Library bridge not available');
    const {library,accountKey}=await reader.read();
    const checked=inspectCloudLibrary(library);
    let db;let before=null;
    try{db=await openDb();before=await getActive(db);}finally{db?.close();}
    assertAccountBinding(before,accountKey);
    assert(!before||before.cursor<=checked.cursor,`Cloud cursor ${checked.cursor} is behind local cursor ${before.cursor}`);
    const live=await inspectLiveOutbox();
    assert(live.count===0,`Pending live Canonical Outbox has ${live.count} change(s). Sync these safely before installing a Cloud shadow generation`);
    const old=new Map();
    if(before){
      db=await openDb();
      try{
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(TABLE,'readonly'),range=IDBKeyRange.bound([before.generation,''],[before.generation,'\uffff']);
          tx.objectStore(TABLE).openCursor(range).onsuccess=e=>{const c=e.target.result;if(c){old.set(c.value.cardId,c.value.entry);c.continue();}};
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Cannot compare local projection'));tx.onerror=()=>reject(tx.error||new Error('Cannot scan local projection'));
        });
        assert(old.size===before.count,'Current local projection count is inconsistent; blocked');
      }finally{db.close();}
    }
    const newIds=new Set(library.officialCards.map(x=>x.cardId));
    const removed=[...old.keys()].filter(x=>!newIds.has(x));
    assert(removed.length===0,`${removed.length} Official card(s) removed remotely; tombstone/conflict handling not implemented. Blocked`);
    let added=0,changed=0,unchanged=0;
    for(const e of library.officialCards){const prior=old.get(e.cardId);if(!prior)added++;else if(JSON.stringify(prior)===JSON.stringify(e))unchanged++;else changed++;}
    const fingerprint=await sha(new TextEncoder().encode(JSON.stringify({cursor:checked.cursor,libraryManifestHash:library.libraryManifestHash,sourceCanonicalManifestHash:library.sourceCanonicalManifestHash,accountKey})));
    return{data:library,accountKey,checks:checked,baseGeneration:before?.generation||null,beforeCursor:before?.cursor??null,delta:{added,changed,unchanged,removed:0},fileHash:fingerprint,source:'cloud',liveMirrorPresent:live.mirrorPresent};
  }
  async function inspectFile(file){
    assert(file&&file.size>0&&file.size<100*1024*1024,'Choose a Canonical Library JSON under 100 MB');
    const bytes=await file.arrayBuffer();
    const fileHash=await sha(bytes);
    assert(fileHash===EXPECTED.fileSha256,'P1-A accepts only the exact audited 16:19 JSON bytes (SHA-256 mismatch). No data written.');
    let data;
    try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch(e){throw new Error(`Invalid UTF-8 / JSON: ${e.message}`);}
    const checks=inspect(data);
    return{data,checks,fileHash,filename:file.name,exportedAt:data.exportedAt};
  }
  function localCompatSummary(){
    try{const local=JSON.parse(localStorage.getItem('wlp:local-overrides:v1')||'{}');return{count:local&&typeof local==='object'&&!Array.isArray(local)?Object.keys(local).length:0,wid4120Present:!!local?.['4120']};}
    catch(_){return{count:null,wid4120Present:null};}
  }
  async function refresh(){
    let db;
    try{
      db=await openDb();state.active=await getActive(db);
      const a=state.active,legacy=localCompatSummary();
      show('installed',a?`INSTALLED · ${countLabel(a.count)} Official cards · cursor ${a.cursor}\nGeneration: ${a.generation}\nP0 manifest: ${a.libraryManifestHash}\nFile SHA-256: ${a.fileHash}\nInstalled: ${a.installedAt}\nLegacy Local Edits remain separate: ${legacy.count??'unknown'} (WID4120: ${legacy.wid4120Present===null?'unknown':legacy.wid4120Present?'present':'not found'})`:'EMPTY · no active P1 projection. No WLP data has been changed.');
    }finally{db?.close();}
  }
  async function scanGeneration(db,generation,expected){
    return new Promise((resolve,reject)=>{
      let count=0,failed=null;
      const range=IDBKeyRange.bound([generation,''],[generation,'\uffff']);
      const tx=db.transaction(TABLE,'readonly');
      const source=new Map(expected.map(e=>[e.cardId,e]));
      const r=tx.objectStore(TABLE).openCursor(range);
      r.onsuccess=()=>{
        const cursor=r.result;if(!cursor)return;
        const row=cursor.value,ref=source.get(row.cardId);
        if(!ref||row.wordId!==ref.card.word_id||JSON.stringify(row.entry)!==JSON.stringify(ref)){
          failed=new Error(`Readback mismatch: ${row.cardId}`);tx.abort();return;
        }
        count++;cursor.continue();
      };
      r.onerror=()=>{failed=r.error||new Error('Projection scan failed');};
      tx.oncomplete=()=>count===expected.length?resolve(count):reject(new Error(`Readback count ${count} != ${expected.length}`));
      tx.onabort=()=>reject(failed||tx.error||new Error('Readback scan aborted'));
      tx.onerror=()=>{if(!failed)failed=tx.error||new Error('Readback transaction error');};
    });
  }
  async function activate(db,prev,generation,inspected){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(META,'readwrite'),store=tx.objectStore(META);
      let failed=null;
      const r=store.get(ACTIVE);
      r.onsuccess=()=>{
        const current=r.result?.value||null;
        if((current?.generation||null)!==(prev?.generation||null)){
          failed=new Error('Another tab updated the active projection; nothing was activated');tx.abort();return;
        }
        store.put({key:ACTIVE,value:{generation,count:inspected.data.officialCards.length,cursor:inspected.checks?.cursor??614,fileHash:inspected.fileHash,libraryManifestHash:inspected.data.libraryManifestHash,sourceCanonicalManifestHash:inspected.data.sourceCanonicalManifestHash,authorityKey:EXPECTED.candidateKey,accountKey:inspected.accountKey||prev?.accountKey||null,source:inspected.source||'manual-p1a',installedAt:new Date().toISOString()}});
      };
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(failed||tx.error||new Error('Activation failed'));
      tx.onerror=()=>{if(!failed)failed=tx.error||new Error('Activation transaction failed');};
    });
  }
  async function install(){
    const inspected=state.inspected;assert(inspected,'Inspect an approved JSON before installing');
    let db;
    try{
      db=await openDb();const prev=await getActive(db);
      if(inspected.source==='cloud'){
        assertAccountBinding(prev,inspected.accountKey);
        assert((prev?.generation||null)===inspected.baseGeneration,'Active generation changed after preview; recheck Cloud first');
        const live=await inspectLiveOutbox();
        assert(live.count===0,'New pending Outbox changes found; abort installation');
        assert(live.mirrorPresent===inspected.liveMirrorPresent,'Canonical Mirror availability changed during preview; check Cloud again');
        const bound=await window.WLPCanonicalLibraryShadowReader.boundary();
        assert(bound.accountKey===inspected.accountKey&&bound.cursor===inspected.checks.cursor&&bound.authority.candidateKey===EXPECTED.candidateKey&&bound.authority.headVersion===EXPECTED.headVersion&&bound.authority.snapshotManifestHash===EXPECTED.snapshotManifestHash,'Cloud boundary moved since preview; recheck Cloud first');
      }
      if(prev?.fileHash===inspected.fileHash&&(!inspected.accountKey||prev.accountKey===inspected.accountKey)){status('READY · this exact projection is already active. No write performed.');return;}
      assert(!prev||prev.authorityKey===EXPECTED.candidateKey,'Different account/Authority active. Refusing to replace it');
      if(inspected.source!=='cloud')assert(!prev||prev.cursor<=EXPECTED.cursor,'Active local cursor is newer. Import refused');
      if(inspected.source!=='cloud')assert(!prev||prev.libraryManifestHash===EXPECTED.libraryManifestHash,'Different projection manifest already active. Refusing to replace it');
      const generation=crypto.randomUUID();
      const cards=inspected.data.officialCards;
      for(let i=0;i<cards.length;i+=150){
        const tx=db.transaction(TABLE,'readwrite'),store=tx.objectStore(TABLE);
        for(const e of cards.slice(i,i+150))store.put({generation,cardId:e.cardId,wordId:e.card.word_id,entry:e});
        await done(tx);
        if((i/150)%5===0||i+150>=cards.length)status(`STAGING · ${countLabel(Math.min(cards.length,i+150))} / ${countLabel(cards.length)} Official cards · live WLP unchanged.`);
      }
      status(`VERIFYING · readback of all ${countLabel(cards.length)} Official cards before activation…`);
      const readback=await scanGeneration(db,generation,cards);
      assert(readback===cards.length,'Projection is incomplete');
      if(inspected.source==='cloud'){
        const boundary=await window.WLPCanonicalLibraryShadowReader.boundary();
        assert(boundary.accountKey===inspected.accountKey&&boundary.cursor===inspected.checks.cursor&&boundary.authority.candidateKey===EXPECTED.candidateKey&&boundary.authority.headVersion===EXPECTED.headVersion&&boundary.authority.snapshotManifestHash===EXPECTED.snapshotManifestHash,'Cloud changed during staging; old active projection retained');
        const live=await inspectLiveOutbox();
        assert(live.count===0,'Outbox became pending during staging; old projection retained');
        assert(live.mirrorPresent===inspected.liveMirrorPresent,'Canonical Mirror availability changed during staging; old projection retained');
      }
      await activate(db,prev,generation,inspected);
      state.lastReport={status:'PASS',mode:inspected.source==='cloud'?'cloud-to-shadow':'manual-import',generation,cursor:inspected.checks?.cursor??614,officialCount:cards.length,fileHash:inspected.fileHash,delta:inspected.delta||null,readback};
      status(`PASS · ${countLabel(readback)} / ${countLabel(cards.length)} Official cards verified and activated in isolated IndexedDB. No live read-source cutover. Old generations retained.`);
    }finally{db?.close();await refresh();}
  }
  async function lookupWid(){
    const wid=Number($('wid').value);assert(Number.isInteger(wid)&&wid>0,'Enter a valid WordID');
    let db;
    try{
      db=await openDb();const a=await getActive(db);assert(a,'No installed P1 projection');
      const tx=db.transaction(TABLE,'readonly'),found=await req(tx.objectStore(TABLE).index('generationWid').get([a.generation,wid]));
      assert(found,`WID${wid} not in current local projection`);
      const e=found.entry,c=e.effectiveContent;
      show('card',JSON.stringify({wordId:wid,cardId:e.cardId,word:c.word,partOfSpeech:c.part_of_speech,definition:c.definition,synonyms:c.synonyms,notes:c.notes,source:c.source,learningMetadata:e.learningMetadata,situations:e.situations,source:'ISOLATED LOCAL IndexedDB',cloudRequest:false,legacyLocalEditApplied:false},null,2));
      state.lastReport={status:'PASS',mode:'offline-read',wordId:wid,cursor:a.cursor,cardId:e.cardId};
      status(`PASS · WID${wid} loaded from isolated Local IndexedDB (no network). Live WLP untouched.`);
    }finally{db?.close();}
  }
  function exportAudit(){
    const record={format:'WLP_P1B_SHADOW_LOCAL_PROJECTION_AUDIT',version:1,createdAt:new Date().toISOString(),active:state.active,lastResult:state.lastReport,legacyLocalCompatibility:localCompatSummary(),constraints:{explicitCloudCheckOnly:true,noBackgroundSync:true,readSourceCutover:false,noCanonicalWrites:true,noLiveLocalChange:true,retainedWID4120:true,accountBindingLocalGuardOnly:true}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='p1b-audit.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('snapshot').addEventListener('change',async()=>{
    state.inspected=null;setBusy(true);
    try{
      const file=$('snapshot').files[0];if(!file){show('preview','No file chosen');return;}
      status('INSPECTING · parsing and checking the fixed Canonical export, no writes…');
      const inspected=await inspectFile(file);state.inspected=inspected;
      show('preview',`PASS · P0 post-Restore export\nName: ${inspected.filename}\nCursor: 614 · Authority v3\nOfficial: 6,660 · Draft: 8 (Drafts NOT installed into Official projection)\nWID7111/7112 preserved · WID4120 enriched Source/Notes verified\nSHA-256: ${inspected.fileHash}\nClick Install only if you want an isolated device-local copy.`);
      status('PASS · Input inspected. No data written yet.');
    }catch(e){show('preview',`BLOCKED · ${e.message}`);status(`BLOCKED · ${e.message}`);}
    finally{setBusy(false);}
  });
  $('cloud-check').addEventListener('click',async()=>{
    if(state.busy)return;state.cloudCandidate=null;setBusy(true);
    try{
      show('cloud-preview','CHECKING · authenticated read-only Canonical Library snapshot…');
      const candidate=await inspectCloud();
      state.cloudCandidate=candidate;
      const d=candidate.delta;
      show('cloud-preview',`PASS · Cloud boundary verified · cursor ${candidate.checks.cursor} · ${countLabel(candidate.checks.count)} Official\nChanges relative to installed local projection: ${d.added} added · ${d.changed} changed · ${d.unchanged} unchanged · ${d.removed} removed\nPending Outbox: 0 · ${candidate.liveMirrorPresent?'existing Canonical Mirror checked':'NEW BROWSER: no live Canonical Mirror (Official copy only; study writes unavailable)'} · authenticated account verified · old generation retained\nClick Install VERIFIED Cloud snapshot only to store Official cards in this browser. Live WLP remains unchanged.`);
      status('PASS · Cloud checked, no data written. Explicit Install is now available.');
    }catch(e){show('cloud-preview',`BLOCKED · ${e.message}`);status(`BLOCKED · ${e.message}`);}
    finally{setBusy(false);}
  });
  $('cloud-install').addEventListener('click',async()=>{
    if(state.busy||!state.cloudCandidate)return;
    setBusy(true);
    try{await installCloudCandidate();}catch(e){state.lastReport={status:'BLOCKED',mode:'cloud-to-shadow',error:e.message};status(`BLOCKED · ${e.message}. Active projection was not replaced.`);}
    finally{setBusy(false);}
  });
  async function installCloudCandidate(){
    const candidate=state.cloudCandidate;assert(candidate,'Check Cloud first');
    const previous=state.inspected;
    state.inspected=candidate;
    try{await install();state.cloudCandidate=null;show('cloud-preview',`INSTALLED · verified Cloud cursor ${candidate.checks.cursor} in isolated IndexedDB. Existing WLP untouched.`);}finally{state.inspected=previous;}
  }
  $('install').addEventListener('click',async()=>{
    if(state.busy||!state.inspected)return;setBusy(true);
    try{await install();}catch(e){state.lastReport={status:'BLOCKED',error:e.message};status(`BLOCKED · ${e.message}. Active projection (if any) was not replaced.`);}finally{setBusy(false);}
  });
  $('check').addEventListener('click',async()=>{if(state.busy)return;setBusy(true);try{await refresh();status('READY · checked isolated projection only.');}catch(e){status(`CHECK · ${e.message}`);}finally{setBusy(false);}});
  $('lookup').addEventListener('click',async()=>{if(state.busy)return;setBusy(true);try{await lookupWid();}catch(e){status(`CHECK · ${e.message}`);}finally{setBusy(false);}});
  $('audit').addEventListener('click',exportAudit);
  refresh().catch(e=>status(`CHECK · isolated DB: ${e.message}`));
})();
