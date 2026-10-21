/* WLP G4-1 · SOURCE ONLY · dynamic Canonical Mirror -> legacy New card rows.
 * Explicit read-only preview, NOT a default Study source. No uploads, writes,
 * account refresh, service-worker changes or automatic New cutover.
 */
(() => {
  'use strict';
  const DB='wlp-cloud-v1', SHADOW='wlp-cloud-shadow-v0', META='sync_meta', OUTBOX='sync_outbox';
  const TABLES=Object.freeze(['card_classification','card_content','card_learning_metadata','cards','learner_profile','learner_route_state','learning_alternative_situations','learning_alternatives','learning_events','learning_sessions','learning_situations','learning_state','study_build_cards','study_builds','study_context_cards','study_contexts','user_preferences']);
  const FIELDS=Object.freeze({'Word':'word','IPA':'ipa','Part of Speech':'part_of_speech','Definition':'definition','Synonym(s)':'synonyms','Example Sentence':'example_sentence','Note(s)':'notes','Category':'category','Source':'source'});
  const fail=m=>{throw Error(`G4 New Reader HOLD: ${m}`);};
  const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||Error('IndexedDB read failed'));});
  const done=tx=>new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error||Error('Readonly transaction aborted'));tx.onerror=()=>no(tx.error||Error('Readonly transaction failed'));});
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
  const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const identity=(t,k)=>`${t}\u0000${k}`;
  function validateSnapshotBoundary(meta,cursor,outbox,session,shadowDevice,localDevice) {
    if(meta?.installSource!=='g4-first-browser-source-only-v1'||meta.normalStudyEnabled!==false||meta.normalAutoSyncEnabled!==false)
      fail('Reader is restricted to the NEW-browser install candidate; existing E7a Library is untouched');
    if(!meta.userId||session?.userId!==meta.userId)fail('Saved WLP Account does not own this Mirror');
    if(!meta.deviceKey||localDevice&&localDevice!==meta.deviceKey||shadowDevice?.deviceKey!==meta.deviceKey)
      fail('Registered device identity is inconsistent');
    if(!meta.candidateKey||!Number.isSafeInteger(Number(meta.headVersion))||Number(meta.headVersion)<1||
       !/^[0-9a-f]{64}$/i.test(meta.snapshotManifestHash||'')||
       !/^[0-9a-f]{64}$/i.test(meta.materializedManifestHash||''))fail('Missing verified dynamic Authority/Manifest');
    if(!Number.isSafeInteger(Number(meta.materializedSyncCursor))||Number(meta.materializedSyncCursor)<0||
       cursor?.lastSyncCursor!==meta.materializedSyncCursor)fail('Mirror and Cursor metadata disagree');
    if(outbox!==0)fail('Pending Canonical Outbox must be preserved and reconciled before this preview');
    return true;
  }
  async function openKnown(name) {
    if(typeof indexedDB.databases!=='function'||!(await indexedDB.databases()).some(x=>x.name===name))fail(`Missing existing ${name}; do not create it`);
    return new Promise((ok,no)=>{const r=indexedDB.open(name);r.onupgradeneeded=()=>{try{r.transaction.abort();}catch{}no(Error('Unexpected database creation blocked'));};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||Error('Cannot open existing Library'));r.onblocked=()=>no(Error('Database is blocked'));});
  }
  async function shadowIdentity(){let db;try{db=await openKnown(SHADOW);if(!db.objectStoreNames.contains('meta'))fail('Shadow Account metadata missing');const tx=db.transaction('meta','readonly'),end=done(tx),s=tx.objectStore('meta');const [session,device]=await Promise.all([req(s.get('supabase_session')),req(s.get('shadow_device'))]);await end;return {session,device};}finally{db?.close();}}
  async function readAtomic(db){
    for(const t of [...TABLES,META,OUTBOX])if(!db.objectStoreNames.contains(t))fail(`Mirror store ${t} missing`);
    const tx=db.transaction([...TABLES,META,OUTBOX],'readonly'),end=done(tx);
    const batches=TABLES.map(t=>req(tx.objectStore(t).getAll()));
    const head=req(tx.objectStore(META).get('authority_mirror'));
    const cursor=req(tx.objectStore(META).get('sync_cursor'));
    const pending=req(tx.objectStore(OUTBOX).count());
    const [groups,meta,cur,outbox]=await Promise.all([Promise.all(batches),head,cursor,pending]);await end;
    return {groups,meta,cursor:cur,outbox};
  }
  async function buildFromRows({groups,meta,cursor,outbox},session,device,localDevice){
    validateSnapshotBoundary(meta,cursor,outbox,session,device,localDevice);
    if(Number(meta.materializedCanonicalRowCount)<=0)fail('Missing Mirror row count');
    const fingerprints=[],cards=new Map(),contents=new Map();
    for(let i=0;i<TABLES.length;i++){
      const table=TABLES[i];
      for(const row of groups[i]){
        if(typeof row?.rowKey!=='string'||!row.rowKey||!/^[a-f0-9]{64}$/i.test(row.payloadHash||''))fail(`Invalid ${table} wrapper`);
        if(row.payload!==null && (typeof row.payload!=='object'||Array.isArray(row.payload)))fail(`Invalid payload ${table}/${row.rowKey}`);
        if(row.tombstone!==true&&row.payload===null)fail(`Active row without payload ${table}/${row.rowKey}`);
        if(row.payload!==null && await sha(JSON.stringify(stable(row.payload)))!==row.payloadHash)
          fail(`Payload hash mismatch ${table}/${row.rowKey}`);
        fingerprints.push({tableName:table,rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:!!row.tombstone});
        if(!row.tombstone&&table==='cards'){
          if(row.payload.card_id!==row.rowKey)fail('Official card primary key mismatch');
          cards.set(row.rowKey,row.payload);
        }
        if(!row.tombstone&&table==='card_content'){
          if(row.payload.card_id!==row.rowKey)fail('Card content primary key mismatch');
          contents.set(row.rowKey,row.payload);
        }
      }
    }
    fingerprints.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    if(fingerprints.length!==Number(meta.materializedCanonicalRowCount)||
       await sha(JSON.stringify(stable(fingerprints)))!==meta.materializedManifestHash)
      fail('Mirror full-row count/Manifest does not match atomic install');
    const wordIds=new Set(),entries=[];
    for(const [cardId,card] of cards){
      const content=contents.get(cardId);
      if(!content)fail(`Active card ${cardId} has no active content`);
      if(card.status==='draft'&&card.origin_kind==='personal')continue;
      if(card.status!=='active'||card.origin_kind!=='official')fail('Unexpected card state; no implicit source cutover');
      const wid=Number(card.word_id);
      if(!Number.isSafeInteger(wid)||wid<=0||wordIds.has(wid)||card.legacy_key!==`wid:${wid}`)fail('Duplicate or invalid Official WordID');
      wordIds.add(wid);
      const row={'Batch #':card.legacy_batch==null?'':String(card.legacy_batch),
        'Guidance #':card.legacy_guidance==null?'':String(card.legacy_guidance),WordID:String(wid),
        __noteLineBreaks:true,__hasLocalOverride:false,__g4MirrorNewPreview:true,
        __p1d1Canonical:true,__p1d1CardId:cardId,__p1d1OrderKey:String(card.order_key||'')};
      for(const [field,key] of Object.entries(FIELDS)){
        if(typeof content[key]!=='string')fail(`Incomplete Official field ${field} WID${wid}`);
        row[field]=content[key];
      }
      if(!row.Word.trim())fail(`Empty Official Word WID${wid}`);
      entries.push(row);
    }
    for(const id of contents.keys())if(!cards.has(id))fail('Orphan active Card Content');
    if(!entries.length)fail('No Official cards in Canonical Mirror');
    entries.sort((a,b)=>a.__p1d1OrderKey.localeCompare(b.__p1d1OrderKey)||Number(a.WordID)-Number(b.WordID));
    return {rows:entries,info:{count:entries.length,mirrorRows:fingerprints.length,cursor:meta.materializedSyncCursor,
      authorityHead:meta.headVersion,manifest:meta.materializedManifestHash,readOnly:true,normalStudyEnabled:false}};
  }
  async function preview(){
    const localId=String(localStorage.getItem('wlp:device-id:v1')||'').trim();
    for(const key of ['wlp:local-overrides:v1','wlp:local-additions:v1']){
      const raw=localStorage.getItem(key);
      if(raw){let parsed;try{parsed=JSON.parse(raw);}catch{fail(`Malformed local data ${key} must be preserved`);}
        if(parsed && typeof parsed==='object' && Object.keys(parsed).length)fail(`Legacy local changes present in ${key}; do not skip reconciliation`);}
    }
    const {session,device}=await shadowIdentity();let db;
    try{db=await openKnown(DB);const start=await readAtomic(db);const report=await buildFromRows(start,session,device,localId);
      const finish=await readAtomic(db);
      if(finish.meta?.materializedManifestHash!==start.meta?.materializedManifestHash||
         finish.meta?.materializedSyncCursor!==start.meta?.materializedSyncCursor||
         finish.cursor?.lastSyncCursor!==start.cursor?.lastSyncCursor||finish.outbox!==start.outbox)
        fail('Mirror changed during preview; no New cutover');
      return report;
    }finally{db?.close();}
  }
  const api=Object.freeze({preview,validateSnapshotBoundary,buildFromRows});
  if(typeof window!=='undefined')window.WLPG4NewMirrorReader=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})();
