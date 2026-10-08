/* WLP P1-A · independent device-local Official read projection · diagnostic/test only.
   This module MUST NOT read/write canonical Cloud configuration, live WLP outbox,
   legacy Local Edits, live Cloud Mirror, Master TSV, Review or Study data. */
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
  const state={inspected:null,active:null,busy:false,lastReport:null};
  const countLabel=(x)=>Number(x||0).toLocaleString('en-US');
  const assert=(yes,message)=>{if(!yes)throw new Error(message);};
  const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB request failed'));});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed'));});
  const show=(id,text)=>{$(id).textContent=String(text);};
  const status=text=>show('status',text);
  const setBusy=busy=>{state.busy=busy;$('check').disabled=busy;$('snapshot').disabled=busy;$('lookup').disabled=busy;$('install').disabled=busy||!state.inspected;};
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
        store.put({key:ACTIVE,value:{generation,count:6660,cursor:614,fileHash:inspected.fileHash,libraryManifestHash:EXPECTED.libraryManifestHash,sourceCanonicalManifestHash:EXPECTED.sourceCanonicalManifestHash,authorityKey:EXPECTED.candidateKey,installedAt:new Date().toISOString()}});
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
      if(prev?.fileHash===inspected.fileHash){status('READY · this exact projection is already active. No write performed.');return;}
      assert(!prev||prev.authorityKey===EXPECTED.candidateKey,'Different account/Authority active. Refusing to replace it');
      assert(!prev||prev.cursor<=EXPECTED.cursor,'Active local cursor is newer. Import refused');
      assert(!prev||prev.libraryManifestHash===EXPECTED.libraryManifestHash,'Different projection manifest already active. Refusing to replace it');
      const generation=crypto.randomUUID();
      const cards=inspected.data.officialCards;
      for(let i=0;i<cards.length;i+=150){
        const tx=db.transaction(TABLE,'readwrite'),store=tx.objectStore(TABLE);
        for(const e of cards.slice(i,i+150))store.put({generation,cardId:e.cardId,wordId:e.card.word_id,entry:e});
        await done(tx);
        if((i/150)%5===0||i+150>=cards.length)status(`STAGING · ${countLabel(Math.min(cards.length,i+150))} / ${countLabel(cards.length)} Official cards · live WLP unchanged.`);
      }
      status('VERIFYING · readback of all 6,660 cards before activation…');
      const readback=await scanGeneration(db,generation,cards);
      assert(readback===6660,'Projection is incomplete');
      await activate(db,prev,generation,inspected);
      state.lastReport={status:'PASS',generation,cursor:614,officialCount:6660,fileHash:inspected.fileHash,readback};
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
    const record={format:'WLP_P1A_SHADOW_LOCAL_PROJECTION_AUDIT',version:1,createdAt:new Date().toISOString(),active:state.active,lastResult:state.lastReport,legacyLocalCompatibility:localCompatSummary(),constraints:{manualImportOnly:true,readSourceCutover:false,noCloudWrite:true,noLiveLocalChange:true,retainedWID4120:true,accountIsolationUnverified:true}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='p1a-audit.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
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
  $('install').addEventListener('click',async()=>{
    if(state.busy||!state.inspected)return;setBusy(true);
    try{await install();}catch(e){state.lastReport={status:'BLOCKED',error:e.message};status(`BLOCKED · ${e.message}. Active projection (if any) was not replaced.`);}finally{setBusy(false);}
  });
  $('check').addEventListener('click',async()=>{if(state.busy)return;setBusy(true);try{await refresh();status('READY · checked isolated projection only.');}catch(e){status(`CHECK · ${e.message}`);}finally{setBusy(false);}});
  $('lookup').addEventListener('click',async()=>{if(state.busy)return;setBusy(true);try{await lookupWid();}catch(e){status(`CHECK · ${e.message}`);}finally{setBusy(false);}});
  $('audit').addEventListener('click',exportAudit);
  refresh().catch(e=>status(`CHECK · isolated DB: ${e.message}`));
})();
