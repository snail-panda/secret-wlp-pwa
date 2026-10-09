/* WLP P1-D7 · first-browser Canonical Mirror install from existing
   account-safety snapshot reader. Explicit, guarded, never replaces a mirror. */
(() => {
  'use strict';
  const DB = 'wlp-cloud-v1', VERSION = 1, OFFICIAL_DB = 'wlp-official-shadow-p1-v1';
  const TABLES = Object.freeze(['card_classification','card_content','card_learning_metadata','cards','learner_profile','learner_route_state','learning_alternative_situations','learning_alternatives','learning_events','learning_sessions','learning_situations','learning_state','study_build_cards','study_builds','study_context_cards','study_contexts','user_preferences']);
  const META = 'sync_meta', OUTBOX = 'sync_outbox';
  const $ = id => document.getElementById(id);
  const state = {busy:false,prepared:null,report:null};
  const request = r => new Promise((ok,no) => {r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error('IndexedDB request failed'));});
  const complete = tx => new Promise((ok,no) => {tx.oncomplete=ok;tx.onabort=()=>no(tx.error||new Error('IndexedDB transaction aborted'));tx.onerror=()=>no(tx.error||new Error('IndexedDB transaction failed'));});
  const assert = (pass,message) => {if(!pass)throw new Error(message);};
  const stable = v => Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
  const canonical = v => JSON.stringify(stable(v));
  const id = (t,k) => `${t}\u0000${k}`;
  async function sha(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function message(node,text){$(node).textContent=String(text);}
  function busy(b){state.busy=b;$('p1d7-mirror-preview').disabled=b;$('p1d7-mirror-install').disabled=b||!state.prepared;}
  async function absentMirror(){
    assert(typeof indexedDB.databases==='function','IndexedDB database inventory unavailable; safe first-run bootstrap cannot proceed.');
    const databases=await indexedDB.databases();
    assert(!databases.some(x=>x.name===DB),'A Canonical Mirror database already exists. This installer NEVER replaces or repairs an existing Mirror or Outbox.');
  }
  function openExisting(name){return new Promise((ok,no)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error(`${name} is unavailable`));});}
  async function officialBoundary(){
    const db=await openExisting(OFFICIAL_DB);
    try{assert(db.objectStoreNames.contains('meta'),'Official projection is not installed in this browser.');
      const tx=db.transaction('meta','readonly'),finished=complete(tx);
      const row=await request(tx.objectStore('meta').get('active'));
      await finished;
      const a=row?.value;
      assert(a?.accountKey&&Number.isSafeInteger(Number(a.cursor))&&Number(a.count)>=6660,'A verified account-bound Official projection must be installed first.');
      return a;
    }finally{db.close();}
  }
  function primary(table,p){const keys={cards:'card_id',card_content:'card_id',card_learning_metadata:'card_id',card_classification:'card_id',learning_situations:'situation_id',learning_alternatives:'alternative_id',learning_alternative_situations:'link_id',learning_sessions:'session_id',learning_events:'event_id',learning_state:'card_id',learner_profile:'account',learner_route_state:'account',study_contexts:'context_id',study_context_cards:null,study_builds:'build_id',study_build_cards:null,user_preferences:'section'};
    if(table==='learner_profile'||table==='learner_route_state')return 'account';
    if(table==='study_context_cards')return `${p.context_id}|${p.ordinal}`;
    if(table==='study_build_cards')return `${p.build_id}|${p.ordinal}`;
    if(table==='learning_alternative_situations')return String(p.link_id||`${p.alternative_id}|${p.situation_id}`);
    return String(p[keys[table]]??'');
  }
  async function normalized(snapshot){
    assert(snapshot&&/^[a-f0-9]{64}$/i.test(snapshot.accountKey),'Authenticated account fingerprint is invalid.');
    assert(snapshot.userId&&snapshot.deviceKey,'Canonical account/device identity is missing.');
    const localDevice=localStorage.getItem('wlp:device-id:v1');
    assert(!localDevice||localDevice===snapshot.deviceKey,'WLP and Cloud Shadow device IDs disagree; first-run bootstrap is blocked, no data touched.');
    const authority=snapshot.authority||{};
    assert(authority.headVersion===3&&authority.candidateKey==='v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc'&&authority.snapshotManifestHash==='2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63','Unexpected Canonical Authority.');
    for(const key of ['namespaceUuid','migrationVersion','cardMappingHash','coreLibraryHash','cutoverTicketHash'])assert(String(authority[key]||''),'Authority metadata is incomplete: '+key);
    assert(Number.isSafeInteger(snapshot.cursor)&&snapshot.cursor>=614,'Canonical cursor is invalid.');
    assert(Array.isArray(snapshot.records)&&snapshot.records.length>=Number(authority.canonicalRowCount),'Canonical account records incomplete.');
    const map=new Map(), seen=new Set();let ignoredOverrides=0;
    for(const rec of snapshot.records){
      const tableName=String(rec.tableName||''),rowKey=String(rec.rowKey||''),key=id(tableName,rowKey);
      assert(tableName&&rowKey&&!seen.has(key),'Duplicate or invalid Canonical row identity');seen.add(key);
      if(tableName==='card_local_overrides'){
        assert(rec.tombstone===true,'Active account Local Edit requires explicit migration, not first-run bootstrap.');
        ignoredOverrides++;continue;
      }
      assert(TABLES.includes(tableName),'Unsupported Canonical Mirror table: '+tableName);
      assert(rec.payload&&typeof rec.payload==='object','Missing Canonical payload: '+tableName);
      assert(primary(tableName,rec.payload)===rowKey,'Canonical payload identity mismatch: '+tableName+'/'+rowKey);
      const hash=await sha(canonical(rec.payload));
      assert(hash===rec.payloadHash,'Canonical payload hash mismatch: '+tableName+'/'+rowKey);
      map.set(key,{tableName,rowKey,payloadHash:rec.payloadHash,tombstone:Boolean(rec.tombstone),payload:rec.payload});
    }
    const rows=[...map.values()].sort((a,b)=>id(a.tableName,a.rowKey).localeCompare(id(b.tableName,b.rowKey)));
    const manifest=await sha(canonical(rows.map(r=>({tableName:r.tableName,rowKey:r.rowKey,tombstone:r.tombstone,payloadHash:r.payloadHash}))));
    assert(rows.length>21000,'Canonical Mirror has unexpectedly few rows.');
    return {rows,manifest,ignoredOverrides};
  }
  async function prepare(){
    if(state.busy)return;state.prepared=null;busy(true);
    try{
      message('p1d7-mirror-preview-result','CHECKING · Existing Mirror, Official account binding, then authenticated full Canonical account snapshot. No writes…');
      await absentMirror();
      const official=await officialBoundary();
      const reader=window.WLPCanonicalLibraryShadowReader;
      assert(typeof reader?.readMirrorBootstrap==='function'&&typeof reader.boundary==='function','P1-D7 Cloud account reader is unavailable.');
      const snapshot=await reader.readMirrorBootstrap();
      assert(snapshot.accountKey===official.accountKey,'Official Library and authenticated Cloud belong to different accounts.');
      assert(snapshot.cursor>=Number(official.cursor),'Cloud snapshot is older than the installed Official projection.');
      const verified=await normalized(snapshot);
      const boundary=await reader.boundary();
      assert(boundary.accountKey===snapshot.accountKey&&boundary.cursor===snapshot.cursor&&boundary.authority.candidateKey===snapshot.authority.candidateKey&&boundary.authority.snapshotManifestHash===snapshot.authority.snapshotManifestHash,'Cloud boundary moved during preparation.');
      state.prepared={snapshot,verified};
      message('p1d7-mirror-preview-result',`PASS · Full account snapshot read only · cursor ${snapshot.cursor} · ${verified.rows.length.toLocaleString()} Canonical Mirror rows · learning state + sessions + events + Draft card rows included · Outbox not touched. Account and Authority verified. ${verified.ignoredOverrides} deleted account override row(s) excluded.\nClick Install only for this NEW browser; existing Mirrors are never replaced.`);
    }catch(e){message('p1d7-mirror-preview-result',`BLOCKED · ${String(e.message||e)} · No Mirror write performed.`);}
    finally{busy(false);}
  }
  function openForFirstInstall(){return new Promise((ok,no)=>{
    const r=indexedDB.open(DB,VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      for(const table of TABLES)if(!db.objectStoreNames.contains(table))db.createObjectStore(table,{keyPath:'rowKey'});
      db.createObjectStore(META,{keyPath:'key'});
      db.createObjectStore(OUTBOX,{keyPath:'mutationId'});
    };
    r.onsuccess=()=>ok(r.result);
    r.onerror=()=>no(r.error||new Error('Could not initialize new Canonical Mirror'));
    r.onblocked=()=>no(new Error('Mirror setup blocked by another tab; do not clear any data.'));
  });}
  async function readback(db){
    const items=[];
    for(const name of TABLES){
      const tx=db.transaction(name,'readonly'),finished=complete(tx),rows=await request(tx.objectStore(name).getAll());await finished;
      for(const item of rows){
        assert(await sha(canonical(item.payload))===String(item.payloadHash),'Mirror readback payload hash mismatch: '+name+'/'+item.rowKey);
        assert(primary(name,item.payload)===String(item.rowKey),'Mirror readback primary key mismatch: '+name+'/'+item.rowKey);
        items.push({tableName:name,rowKey:String(item.rowKey),tombstone:Boolean(item.tombstone),payloadHash:String(item.payloadHash)});
      }
    }
    items.sort((a,b)=>id(a.tableName,a.rowKey).localeCompare(id(b.tableName,b.rowKey)));
    const tx=db.transaction([META,OUTBOX],'readonly'),finished=complete(tx),meta=await request(tx.objectStore(META).get('authority_mirror')),cursor=await request(tx.objectStore(META).get('sync_cursor')),pending=await request(tx.objectStore(OUTBOX).count());await finished;
    return {count:items.length,manifest:await sha(canonical(items)),meta,cursor,pending};
  }
  async function install(){
    if(state.busy||!state.prepared)return;
    busy(true);const candidate=state.prepared;state.prepared=null;
    let db=null;
    try{
      await absentMirror();
      const official=await officialBoundary();
      assert(official.accountKey===candidate.snapshot.accountKey,'Official account changed since preview.');
      const boundary=await window.WLPCanonicalLibraryShadowReader.boundary();
      assert(boundary.accountKey===candidate.snapshot.accountKey&&boundary.cursor===candidate.snapshot.cursor&&boundary.authority.candidateKey===candidate.snapshot.authority.candidateKey&&boundary.authority.headVersion===candidate.snapshot.authority.headVersion&&boundary.authority.snapshotManifestHash===candidate.snapshot.authority.snapshotManifestHash,'Cloud changed after preview. Refresh the preview before installing.');
      message('p1d7-mirror-install-result',`INSTALLING · ${candidate.verified.rows.length.toLocaleString()} verified rows in NEW Canonical Mirror. Old Official Projection unchanged…`);
      db=await openForFirstInstall();
      for(const table of [...TABLES,META,OUTBOX])assert(db.objectStoreNames.contains(table),'Canonical Mirror store missing: '+table);
      let tx=db.transaction([...TABLES,META,OUTBOX],'readonly');const scanDone=complete(tx);const existing=await Promise.all([...TABLES.map(t=>request(tx.objectStore(t).count())),request(tx.objectStore(META).count()),request(tx.objectStore(OUTBOX).count())]);await scanDone;
      assert(existing.every(n=>n===0),'Existing Canonical Mirror records or metadata found. Never replace or overwrite.');
      const s=candidate.snapshot,a=s.authority,stamp=new Date().toISOString();
      const meta={key:'authority_mirror',dbSchemaVersion:1,userId:s.userId,deviceKey:s.deviceKey,candidateKey:a.candidateKey,headVersion:a.headVersion,snapshotManifestHash:a.snapshotManifestHash,canonicalRowCount:a.canonicalRowCount,namespaceUuid:a.namespaceUuid,migrationVersion:a.migrationVersion,cardMappingHash:a.cardMappingHash,coreLibraryHash:a.coreLibraryHash,cutoverTicketHash:a.cutoverTicketHash,installedAt:stamp,installSource:'account-snapshot-first-browser-v1',lastSyncCursor:s.cursor,materializedSyncCursor:s.cursor,lastSuccessfulSyncAt:stamp,materializedManifestHash:candidate.verified.manifest,materializedCanonicalRowCount:candidate.verified.rows.length,syncOverlayApplied:true,materializedAt:stamp};
      tx=db.transaction([...TABLES,META],'readwrite');const finished=complete(tx);
      for(const row of candidate.verified.rows)tx.objectStore(row.tableName).put({rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:row.tombstone,payload:row.payload});
      tx.objectStore(META).put(meta);
      tx.objectStore(META).put({key:'sync_cursor',lastSyncCursor:s.cursor,lastSuccessfulSyncAt:stamp,candidateKey:a.candidateKey,headVersion:a.headVersion,snapshotManifestHash:a.snapshotManifestHash,materializedManifestHash:candidate.verified.manifest,materializedCanonicalRowCount:candidate.verified.rows.length});
      await finished;
      const proof=await readback(db);
      assert(proof.count===candidate.verified.rows.length&&proof.manifest===candidate.verified.manifest&&proof.pending===0&&proof.meta?.userId===s.userId&&proof.meta?.deviceKey===s.deviceKey&&proof.cursor?.lastSyncCursor===s.cursor,'Mirror readback fingerprint/account/cursor failed. Do NOT use for writes.');
      state.report={status:'PASS',cursor:s.cursor,rowCount:proof.count,manifest:proof.manifest,outbox:0};
      message('p1d7-mirror-install-result',`INSTALLED AND VERIFIED · complete Canonical sync Mirror ${proof.count.toLocaleString()} rows · cursor ${s.cursor} · Outbox 0 · account bound. Existing Official projection and local edits untouched.\nDo not start study writes yet: account/device registration and first-run normal-screen integration still require follow-up verification.`);
    }catch(e){message('p1d7-mirror-install-result',`BLOCKED · ${String(e.message||e)} · Do not clear storage or retry Install until this is reviewed.`);}
    finally{db?.close();busy(false);}
  }
  $('p1d7-mirror-preview').addEventListener('click',prepare);
  $('p1d7-mirror-install').addEventListener('click',install);
  window.WLPFirstBrowserMirrorP1D7=Object.freeze({getReport:()=>state.report});
})();
