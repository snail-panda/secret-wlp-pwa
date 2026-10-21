/* WLP G4-1 · first-browser Canonical Mirror install candidate · SOURCE ONLY V1.
 * NOT DEPLOY-READY: the production AutoSync/Official Reader still contain
 * pinned Authority/Projection gates. The Account UI does not enable this by default.
 * No existing wlp-cloud-v1 database is opened for writing, reset, or replaced.
 */
(() => {
  'use strict';
  const DB='wlp-cloud-v1', VERSION=1, SHADOW='wlp-cloud-shadow-v0';
  const TABLES=Object.freeze(['card_classification','card_content','card_learning_metadata','cards','learner_profile','learner_route_state','learning_alternative_situations','learning_alternatives','learning_events','learning_sessions','learning_situations','learning_state','study_build_cards','study_builds','study_context_cards','study_contexts','user_preferences']);
  const META='sync_meta', OUTBOX='sync_outbox';
  const SHA=/^[0-9a-f]{64}$/i;
  const fail=m=>{throw Error(m);};
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
  const canon=v=>JSON.stringify(stable(v));
  const identity=(table,key)=>`${table}\u0000${key}`;
  const req=r=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error||Error('IndexedDB read failure'));});
  const done=tx=>new Promise((yes,no)=>{tx.oncomplete=()=>yes();tx.onabort=()=>no(tx.error||Error('IndexedDB transaction aborted'));tx.onerror=()=>no(tx.error||Error('IndexedDB transaction failed'));});
  const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const present=(v)=>typeof v==='string'&&v.trim().length>0;
  function primary(table,p){
    if(table==='study_context_cards')return `${p.context_id}|${p.ordinal}`;
    if(table==='study_build_cards')return `${p.build_id}|${p.ordinal}`;
    if(table==='learning_alternative_situations')return String(p.link_id||`${p.alternative_id}|${p.situation_id}`);
    if(table==='learner_profile'||table==='learner_route_state')return 'account';
    const keys={cards:'card_id',card_content:'card_id',card_classification:'card_id',card_learning_metadata:'card_id',learning_situations:'situation_id',learning_alternatives:'alternative_id',learning_sessions:'session_id',learning_events:'event_id',learning_state:'card_id',study_contexts:'context_id',study_builds:'build_id',user_preferences:'section'};
    return String(p[keys[table]]??'');
  }
  // Pure, conservative. The dynamic Cloud Snapshot is required, but not sufficient:
  // semantic consistency of the full New reader and other writers is a later gate.
  function plan(snapshot,deviceKey){
    if(snapshot?.installData!==true||!present(snapshot.ownerId)||!present(snapshot.projectOrigin)||!Array.isArray(snapshot.rows)||!snapshot.rows.length)
      fail('A freshly verified Cloud snapshot is required');
    if(!present(deviceKey)||!snapshot.summary||snapshot.summary.activeCanonicalOverrides!==0)
      fail('Account device identity missing or Cloud Local Edit migration is required');
    const a=snapshot.authority||{},headVersion=Number(a.head_version),cursor=Number(snapshot.cursor);
    if(!present(a.candidate_key)||!Number.isSafeInteger(headVersion)||headVersion<1||
       !SHA.test(a.snapshot_manifest_hash||'')||!SHA.test(snapshot.verifiedManifest||'')||
       !Number.isSafeInteger(cursor)||cursor<0)fail('Unverified Authority or Cursor');
    for(const k of ['namespace_uuid','migration_version','card_mapping_hash','core_library_hash','cutover_ticket_hash'])
      if(!present(a[k]))fail(`Missing Authority metadata ${k}`);
    const set=new Set(),rows=[];
    for(const r of snapshot.rows){
      if(!present(r.tableName)||!present(r.rowKey)||!SHA.test(r.payloadHash||''))fail('Invalid row identity or payload hash');
      const key=identity(r.tableName,r.rowKey);
      if(set.has(key))fail('Duplicate effective Canonical record');set.add(key);
      if(r.tableName==='card_local_overrides'){
        if(!r.tombstone)fail('Active Cloud Local Edit cannot be silently discarded');
        continue; // retained in Cloud; old Mirror schema does not store override tombstones
      }
      if(!TABLES.includes(r.tableName))fail(`Unsupported Canonical table ${r.tableName}`);
      if(!r.tombstone){
        if(!r.payload||typeof r.payload!=='object'||primary(r.tableName,r.payload)!==r.rowKey)
          fail(`Canonical payload primary key differs for ${r.tableName}`);
      }
      rows.push({tableName:r.tableName,rowKey:r.rowKey,payloadHash:r.payloadHash,tombstone:!!r.tombstone,payload:r.payload??null});
    }
    rows.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    return {rows,count:rows.length,manifestRows:rows.map(({tableName,rowKey,payloadHash,tombstone})=>({tableName,rowKey,payloadHash,tombstone})),
      ownerId:snapshot.ownerId,projectOrigin:snapshot.projectOrigin,deviceKey,cursor,authority:a,
      ignoredTombstoneOverrides:snapshot.rows.length-rows.length};
  }
  async function existingNames(){
    if(typeof indexedDB.databases!=='function')fail('Safe IndexedDB database discovery is unavailable');
    return new Set((await indexedDB.databases()).map(x=>x.name));
  }
  async function shadowDeviceAndAuth(snapshot){
    if(!(await existingNames()).has(SHADOW))fail('Saved Account database absent');
    const db=await new Promise((yes,no)=>{const r=indexedDB.open(SHADOW);r.onupgradeneeded=()=>{r.transaction.abort();no(Error('Account database must already exist'));};r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error||Error('Cannot open Account database'));});
    let device,session,config;
    try{
      if(!db.objectStoreNames.contains('meta'))fail('Account database schema incomplete');
      const tx=db.transaction('meta','readonly'),end=done(tx),s=tx.objectStore('meta');
      [device,session,config]=await Promise.all([req(s.get('shadow_device')),req(s.get('supabase_session')),req(s.get('supabase_config'))]);await end;
    }finally{db.close();}
    const key=String(localStorage.getItem('wlp:device-id:v1')||'').trim(),shadowKey=String(device?.deviceKey||'').trim();
    if(key&&shadowKey&&key!==shadowKey)fail('Browser and Account device IDs disagree');
    const deviceKey=key||shadowKey;
    if(!deviceKey)fail('A registered local device is required before install; no ID is generated here');
    if(session?.userId!==snapshot.ownerId||!session.accessToken||Number(session.expiresAt)<=Date.now()+60000||
       new URL(config?.url||'https://invalid.invalid').origin!==snapshot.projectOrigin)
      fail('Account session/project changed or token expired');
    const u=new URL(config.url);
    if(u.protocol!=='https:'||u.pathname.replaceAll('/','')||u.search||u.hash)fail('Unsafe saved project URL');
    const url=`${u.origin}/rest/v1/wlp_devices?select=device_key,retired_at&owner_id=eq.${encodeURIComponent(snapshot.ownerId)}&device_key=eq.${encodeURIComponent(deviceKey)}&limit=2`;
    const response=await fetch(url,{method:'GET',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`},cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response.ok)fail(`Device registration read failed HTTP ${response.status}`);
    const devices=await response.json();
    if(!Array.isArray(devices)||devices.length!==1||devices[0].device_key!==deviceKey||devices[0].retired_at)
      fail('This device is not currently registered for this WLP Account');
    return deviceKey;
  }
  function sameBoundary(gate,snapshot){
    const r=gate?.remote;
    return gate?.verdict?.code==='FIRST_BROWSER_CANDIDATE'&&r?.userId===snapshot.ownerId&&r?.projectOrigin===snapshot.projectOrigin&&
      r?.cursor===snapshot.cursor&&r?.authority?.candidateKey===snapshot.authority?.candidate_key&&
      r?.authority?.headVersion===snapshot.authority?.head_version&&
      r?.authority?.snapshotManifestHash===snapshot.authority?.snapshot_manifest_hash;
  }
  async function atomicCreate(p,manifest){
    if((await existingNames()).has(DB))fail('Canonical Mirror already exists. First install never replaces it');
    const stamp=new Date().toISOString(),a=p.authority;
    const meta={key:'authority_mirror',dbSchemaVersion:1,userId:p.ownerId,deviceKey:p.deviceKey,
      candidateKey:a.candidate_key,headVersion:a.head_version,snapshotManifestHash:a.snapshot_manifest_hash,
      canonicalRowCount:a.canonical_row_count,namespaceUuid:a.namespace_uuid,migrationVersion:a.migration_version,
      cardMappingHash:a.card_mapping_hash,coreLibraryHash:a.core_library_hash,cutoverTicketHash:a.cutover_ticket_hash,
      installedAt:stamp,installSource:'g4-first-browser-source-only-v1',lastSyncCursor:p.cursor,
      materializedSyncCursor:p.cursor,lastSuccessfulSyncAt:stamp,materializedManifestHash:manifest,
      materializedCanonicalRowCount:p.count,syncOverlayApplied:true,materializedAt:stamp,
      normalStudyEnabled:false,normalAutoSyncEnabled:false};
    const cursor={key:'sync_cursor',lastSyncCursor:p.cursor,lastSuccessfulSyncAt:stamp,
      candidateKey:a.candidate_key,headVersion:a.head_version,snapshotManifestHash:a.snapshot_manifest_hash,
      materializedManifestHash:manifest,materializedCanonicalRowCount:p.count};
    let created=false,upError=null;
    const db=await new Promise((yes,no)=>{
      const r=indexedDB.open(DB,VERSION);
      r.onupgradeneeded=()=>{
        created=true;
        try{
          const d=r.result;
          for(const table of TABLES)d.createObjectStore(table,{keyPath:'rowKey'});
          const m=d.createObjectStore(META,{keyPath:'key'});
          d.createObjectStore(OUTBOX,{keyPath:'mutationId'});
          // All data and all metadata are written during ONE IndexedDB schema upgrade
          // transaction; an exception/quota error aborts the whole install.
          for(const row of p.rows)r.transaction.objectStore(row.tableName).put({rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:row.tombstone,payload:row.payload});
          m.put(meta);m.put(cursor);
        }catch(e){upError=e;try{r.transaction.abort();}catch(_){}}
      };
      r.onsuccess=()=>{if(!created){r.result.close();no(Error('Canonical Mirror appeared during install; never overwrite'));return;}yes(r.result);};
      r.onerror=()=>no(upError||r.error||Error('Atomic Canonical Mirror creation aborted'));
      r.onblocked=()=>no(Error('Another tab blocks Canonical Mirror creation'));
    });
    return {db,meta};
  }
  async function readback(db){
    const rows=[];
    for(const store of TABLES){
      const tx=db.transaction(store,'readonly'),end=done(tx),items=await req(tx.objectStore(store).getAll());await end;
      for(const r of items){
        if(r.payload==null){if(!r.tombstone)fail(`Active readback payload missing in ${store}`);}
        else if(await hash(canon(r.payload))!==r.payloadHash||primary(store,r.payload)!==r.rowKey)
          fail(`Installed Mirror payload or identity readback failed in ${store}`);
        rows.push({tableName:store,rowKey:r.rowKey,payloadHash:r.payloadHash,tombstone:!!r.tombstone});
      }
    }
    rows.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    const tx=db.transaction([META,OUTBOX],'readonly'),end=done(tx),m=tx.objectStore(META);
    const [head,cursor,outbox]=await Promise.all([req(m.get('authority_mirror')),req(m.get('sync_cursor')),req(tx.objectStore(OUTBOX).count())]);await end;
    return {rows,head,cursor,outbox,manifest:await hash(canon(rows))};
  }
  let busy=false;
  async function installFresh(){
    if(window.WLPStage7G4ReleasePolicy?.gate('library-install')!==true)
      fail('Normal Stage 7 Library setup has not been release-approved');
    if(busy)fail('Install already running');busy=true;
    let db=null;
    try{
      if((await existingNames()).has(DB))fail('Existing Canonical Mirror preserved. Do not repeat first install');
      if(!window.WLPG4VerifiedSnapshot?.prepareFirstInstall||!window.WLPG4LibraryBoundary?.inspect)fail('Snapshot or boundary safety dependency missing');
      const snapshot=await window.WLPG4VerifiedSnapshot.prepareFirstInstall();
      const deviceKey=await shadowDeviceAndAuth(snapshot);
      const p=plan(snapshot,deviceKey),manifest=await hash(canon(p.manifestRows));
      if(p.count===0)fail('No supported Mirror records');
      // Verify the account, authority, pending, and local-state safety boundary
      // *again* immediately before opening the brand-new database.
      const latest=await window.WLPG4LibraryBoundary.inspect();
      if(!sameBoundary(latest,snapshot))fail('Account, Local Library or Cloud boundary moved before install');
      const created=await atomicCreate(p,manifest);db=created.db;
      const proof=await readback(db);
      if(proof.rows.length!==p.count||proof.manifest!==manifest||proof.outbox!==0||
         proof.head?.userId!==p.ownerId||proof.head?.deviceKey!==p.deviceKey||
         proof.cursor?.lastSyncCursor!==p.cursor)
        fail('Post-install readback failed; do not activate this library. Do not clear it');
      return Object.freeze({status:'INSTALLED_SOURCE_ONLY',mirrorRows:p.count,cursor:p.cursor,
        outbox:proof.outbox,accountBound:true,readbackManifest:manifest,
        officialReaderEnabled:false,normalAutoSyncEnabled:false});
    }finally{db?.close();busy=false;}
  }
  window.WLPG4FirstBrowserInstall=Object.freeze({installFresh});
  if(typeof module==='object'&&module.exports)module.exports={plan,sameBoundary,primary,atomicCreate,readback};
})();
