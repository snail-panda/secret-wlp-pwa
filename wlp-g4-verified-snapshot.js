/* WLP G4-1 verified, dynamic Cloud Canonical snapshot — SOURCE ONLY V1.
 * Explicitly invoked from the isolated Account candidate page.
 * All IDB operations readonly; only GET requests; never install/merge/sync.
 * Canonical reconstruction follows canonical-account-backup.js materializeRecords.
 */
(() => {
  'use strict';
  const SHADOW='wlp-cloud-shadow-v0';
  const HEAD='wlp_canonical_authority_heads';
  const BASE='wlp_canonical_authority_candidate_records';
  const CHANGES='wlp_sync_changes_v1';
  const MAX_ROWS=200000, PAGE=1000, MAX_PAGES=250;
  const shaPattern=/^[0-9a-f]{64}$/i;
  const fail=m=>{throw new Error(m);};
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
  const stringify=v=>JSON.stringify(stable(v));
  async function sha(v){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v)));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
  const str=v=>String(v??'').trim();
  const identity=(t,k)=>`${t}\u0000${k}`;
  const cleanOrigin=v=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname.replaceAll('/',''))fail('Untrusted Cloud URL');return u.origin;};
  function matchingHead(a,b){return str(a?.candidate_key)===str(b?.candidate_key)&&num(a?.head_version)===num(b?.head_version)&&str(a?.snapshot_manifest_hash)===str(b?.snapshot_manifest_hash)&&num(a?.canonical_row_count)===num(b?.canonical_row_count);}
  async function shadowCredentials(){
    if(typeof indexedDB.databases!=='function')fail('Cannot safely discover IndexedDB databases');
    if(!(await indexedDB.databases()).some(x=>x.name===SHADOW))fail('Account storage absent; first sign in');
    const db=await new Promise((ok,no)=>{const r=indexedDB.open(SHADOW);r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){};no(Error('Unexpected Shadow schema initialization'));};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||Error('Shadow DB read failed'));r.onblocked=()=>no(Error('Shadow DB blocked'));});
    try{
      if(!db.objectStoreNames.contains('meta'))fail('Missing Shadow metadata store');
      const read=k=>new Promise((ok,no)=>{const tx=db.transaction('meta','readonly'),r=tx.objectStore('meta').get(k);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error||Error('Account metadata read failed'));});
      const [config,session]=await Promise.all([read('supabase_config'),read('supabase_session')]);
      if(!config?.url||!config?.publishableKey||!session?.userId||!session?.accessToken)fail('Valid saved account session is required');
      if(num(session.expiresAt)===null||num(session.expiresAt)<=Date.now()+60000)fail('Access token is expired or near expiry; refresh via established Account flow');
      return {config,session};
    }finally{db.close();}
  }
  async function fetchJson(url,headers,extra={}){
    const r=await fetch(url,{method:'GET',headers:{...headers,...(extra.headers||{})},cache:'no-store',credentials:'omit',redirect:'error'});
    if(!r.ok)fail(`Canonical read HTTP ${r.status}; no local changes`);
    const data=await r.json();return {data,response:r};
  }
  function tableUrl(root,table,columns,owner,extra=''){
    return `${root}/rest/v1/${table}?select=${encodeURIComponent(columns)}&owner_id=eq.${encodeURIComponent(owner)}${extra?`&${extra}`:''}`;
  }
  async function paged(root,table,columns,owner,headers,extra='',expected=null){
    const url=tableUrl(root,table,columns,owner,extra);let result=[],total=null;
    for(let page=0;page<MAX_PAGES;page++){
      const start=page*PAGE,end=start+PAGE-1;
      const {data,response}=await fetchJson(url,headers,{headers:{Range:`${start}-${end}`,Prefer:'count=exact'}});
      if(!Array.isArray(data)||data.length>PAGE)fail(`Invalid paged response for ${table}`);
      const part=response.headers.get('content-range')||'';
      const match=/^(\d+)-(\d+)\/(\d+)$|^\*\/(\d+)$/.exec(part);
      if(!match)fail(`Exact page range/count unavailable for ${table}`);
      const count=Number(match[3]??match[4]);
      if(!Number.isSafeInteger(count)||count>MAX_ROWS)fail(`Invalid or excessive ${table} rows`);
      if(data.length){
        if(match[1]==='*'||Number(match[1])!==start||Number(match[2])!==start+data.length-1)
          fail(`Server returned an unexpected page range for ${table}`);
      }else if(!part.startsWith('*/'))fail(`Server returned nonempty range for empty ${table} page`);
      if(total!==null&&total!==count)fail(`${table} changed during paged read`);
      total=count;result.push(...data);
      if(result.length>count||result.length>MAX_ROWS)fail(`${table} returned duplicate/overflow page`);
      if(result.length===count){if(expected!==null&&expected!==result.length)fail(`${table} count mismatch with Authority`);return result;}
      if(!data.length)fail(`${table} returned an empty page before count was complete`);
    }
    fail(`${table} exceeded safe pagination budget`);
  }
  async function fingerprintPayload(row,label,allowSparse=false){
    if(row.payload==null){if(!row.tombstone&&!allowSparse)fail(`Missing active payload for ${label}`);return;}
    if(!shaPattern.test(str(row.payload_hash)))fail(`Missing/invalid payload hash for ${label}`);
    if(await sha(stringify(row.payload))!==str(row.payload_hash))fail(`Payload mismatch for ${label}`);
  }
  function orderedManifest(records){return records.map(r=>({tableName:r.tableName,rowKey:r.rowKey,payloadHash:r.payloadHash,tombstone:r.tombstone}));}
  async function reconstruct(base,changes,maxCursor,expectedHash,includeRows=false){
    const map=new Map(),baseSeen=new Set();
    for(const row of base){
      const tableName=str(row.table_name),rowKey=str(row.row_key),key=identity(tableName,rowKey);
      if(!tableName||!rowKey||baseSeen.has(key))fail('Duplicate or incomplete Authority record identity');
      baseSeen.add(key);
      await fingerprintPayload(row,`Authority ${tableName}/${rowKey}`);
      map.set(key,{tableName,rowKey,payloadHash:str(row.payload_hash),payload:row.payload,tombstone:!!row.tombstone});
    }
    const sort=(a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey);
    const baseManifest=await sha(stringify(orderedManifest([...map.values()].sort(sort))));
    if(baseManifest!==str(expectedHash))fail('ACTIVE Authority base Manifest differs from server Head');
    let last=0;
    for(const row of changes){
      const seq=num(row.change_seq),tableName=str(row.table_name),rowKey=str(row.row_key);
      if(seq===null||seq<=last||seq>maxCursor)fail('Change feed is unordered, duplicated, or beyond fixed cursor');
      if(!tableName||!rowKey)fail('Change record identity missing');
      last=seq;
      const key=identity(tableName,rowKey),prior=map.get(key)||null,tombstone=!!row.tombstone;
      await fingerprintPayload(row,`Change ${seq} ${tableName}/${rowKey}`,true);
      let payload=row.payload;
      if(!tombstone&&payload==null){
        if(!prior?.payload||!str(row.payload_hash)||str(prior.payloadHash)!==str(row.payload_hash))fail(`Unrecoverable sparse change ${tableName}/${rowKey}`);
        payload=prior.payload;
      }
      map.set(key,{tableName,rowKey,payloadHash:str(row.payload_hash),payload,tombstone});
    }
    if(last!==maxCursor)fail('Change feed did not reach fixed high-water cursor');
    const rows=[...map.values()].sort(sort),tableCounts={};
    const active={};const cards=new Map(),content=new Map();
    const activeIds=new Set(),officialWids=new Set();
    let unsupported=0;
    for(const row of rows){
      const c=tableCounts[row.tableName]||(tableCounts[row.tableName]={total:0,active:0,tombstones:0});c.total++;
      if(row.tombstone){c.tombstones++;continue;}
      c.active++;
      if(row.payload==null)fail('Effective active record has no payload');
      if(row.tableName==='cards'){cards.set(row.rowKey,row.payload);if(str(row.payload.card_id)!==row.rowKey)fail('Card identity mismatch');}
      if(row.tableName==='card_content'){content.set(row.rowKey,row.payload);if(str(row.payload.card_id)!==row.rowKey)fail('Card content identity mismatch');}
      if(row.tableName==='card_local_overrides')unsupported++;
    }
    for(const [id,card] of cards){
      const status=str(card.status),kind=str(card.origin_kind),isOfficial=status==='active'&&kind==='official',isDraft=status==='draft'&&kind==='personal';
      if(!isOfficial&&!isDraft)fail(`Unsupported Canonical card state for ${id}`);
      if(!content.has(id))fail(`Card has no active content ${id}`);
      const payload=content.get(id);if(!str(payload.word))fail(`Card content lacks Word ${id}`);
      if(isOfficial){const wid=num(card.word_id);if(wid===null||wid<=0||officialWids.has(wid))fail('Invalid/duplicated official WordID');officialWids.add(wid);}
      activeIds.add(id);
    }
    for(const id of content.keys())if(!cards.has(id))fail(`Orphan active card content ${id}`);
    const manifest=await sha(stringify(orderedManifest(rows)));
    // Unlike immutable Cloud history, the v400 materialized Mirror explicitly
    // excludes card_local_overrides; v400 projects them into localStorage.
    // Keep the full ledger manifest AND independently compute the exact
    // materialized submanifest. Never compare the former with the latter.
    const materializedRows=rows.filter(r=>r.tableName!=='card_local_overrides');
    const materializedManifest=await sha(stringify(orderedManifest(materializedRows)));
    return {baseManifest,manifest,materializedManifest,materializedRowCount:materializedRows.length,
      rowCount:rows.length,overlayChanges:changes.length,tableCounts,
      officialCards:officialWids.size,draftCards:cards.size-officialWids.size,activeCanonicalOverrides:unsupported,
      ...(includeRows?{effectiveRows:rows}: {})};
  }
  async function runVerified(installMaterial=false){
    const boundary=window.WLPG4LibraryBoundary;
    if(!boundary?.inspect)fail('WLP Local Library safety gate is unavailable');
    const start=await boundary.inspect();
    if(str(start.verdict?.code).startsWith('HOLD_')||!start.remote?.identityVerified||!start.remote?.authorityVerified)
      fail(`Local/Account safety gate blocked verification: ${start.verdict?.code||'unknown'}`);
    const {config,session}=await shadowCredentials(),root=cleanOrigin(config.url),owner=str(session.userId);
    if(root!==start.remote.projectOrigin||owner!==start.remote.userId)fail('Account or Cloud project differs from safety gate');
    const headers={apikey:str(config.publishableKey),Authorization:`Bearer ${session.accessToken}`};
    const headUrl=tableUrl(root,HEAD,'candidate_key,head_version,snapshot_manifest_hash,canonical_row_count,namespace_uuid,migration_version,card_mapping_hash,core_library_hash,cutover_ticket_hash',owner,'limit=2');
    const changeExtra=h=>`candidate_key=eq.${encodeURIComponent(h.candidate_key)}&head_version=eq.${h.head_version}&order=change_seq.desc&limit=1`;
    const readHead=async()=>{const {data}=await fetchJson(headUrl,headers);if(!Array.isArray(data)||data.length!==1)fail('No unique ACTIVE Cloud Authority');return data[0];};
    const readCursor=async(h)=>{const {data}=await fetchJson(tableUrl(root,CHANGES,'change_seq',owner,changeExtra(h)),headers);if(!Array.isArray(data)||data.length>1)fail('Invalid Cursor response');return data.length?num(data[0].change_seq):0;};
    const head=await readHead(),highWater=await readCursor(head);
    if(!matchingHead(head,{candidate_key:start.remote.authority.candidateKey,head_version:start.remote.authority.headVersion,snapshot_manifest_hash:start.remote.authority.snapshotManifestHash,canonical_row_count:start.remote.authority.rowCount})||highWater!==start.remote.cursor)fail('Cloud boundary changed since initial safety gate');
    if(highWater===null)fail('Invalid server change cursor');
    const key=encodeURIComponent(str(head.candidate_key)),version=Number(head.head_version);
    const base=await paged(root,BASE,'table_name,row_key,payload_hash,payload,tombstone',owner,headers,`candidate_key=eq.${key}&order=table_name.asc,row_key.asc`,Number(head.canonical_row_count));
    const changes=highWater?await paged(root,CHANGES,'change_seq,table_name,row_key,operation,payload_hash,payload,tombstone',owner,headers,`candidate_key=eq.${key}&head_version=eq.${version}&change_seq=lte.${highWater}&order=change_seq.asc`):[];
    const complete=await reconstruct(base,changes,highWater,head.snapshot_manifest_hash,installMaterial);
    const {effectiveRows,...summary}=complete;
    const after=await readHead(),endCursor=await readCursor(after);
    if(!matchingHead(head,after)||endCursor!==highWater)fail('Cloud Authority/Cursor moved during full Snapshot; result rejected');
    const localAfter=await boundary.inspect();
    if(str(localAfter.verdict?.code).startsWith('HOLD_')||localAfter.remote?.userId!==owner||localAfter.remote?.projectOrigin!==root||
      localAfter.remote?.cursor!==highWater||localAfter.remote?.authority?.snapshotManifestHash!==str(head.snapshot_manifest_hash)||
      JSON.stringify(localAfter.local)!==JSON.stringify(start.local)||
      localAfter.verdict?.code!==start.verdict?.code)fail('Local or Cloud boundary changed; result rejected');
    if(installMaterial){
      if(start.verdict.code!=='FIRST_BROWSER_CANDIDATE'||summary.activeCanonicalOverrides!==0)
        fail('Fresh-install candidate only: existing local state or active Cloud Local Edits require migration');
      const required=['namespace_uuid','migration_version','card_mapping_hash','core_library_hash','cutover_ticket_hash'];
      if(required.some(k=>!str(head[k])))fail('Authority metadata needed for Canonical Mirror install is incomplete');
      if(!Array.isArray(effectiveRows)||!effectiveRows.length)fail('Empty verified install records');
      // All row payloads remain private to the guarded install caller; never rendered/exported.
      return {installData:true,ownerId:owner,projectOrigin:root,authority:{...head},cursor:highWater,rows:effectiveRows,
        verifiedManifest:summary.manifest,summary};
    }
    // No snapshot contents, tokens, raw account identifier or email leave the report function.
    return Object.freeze({format:'WLP_G4_VERIFIED_CANONICAL_SNAPSHOT_READ_ONLY',version:1,
      verified:true,accountMatch:true,headVersion:version,candidateKey:str(head.candidate_key),
      snapshotManifestHash:str(head.snapshot_manifest_hash),cursor:highWater,...summary,
      firstBrowserCandidate:start.verdict.code==='FIRST_BROWSER_CANDIDATE',
      verdict:start.verdict.code,
      installEligible:false,
      requiresMigration:summary.activeCanonicalOverrides>0||start.verdict.code!=='FIRST_BROWSER_CANDIDATE'});
  }
  // Existing E7a Mirror: independent Cloud replay at the MIRROR cursor plus
  // complete current Cloud replay. Read-only; never claims an ancestor from
  // the cursor alone. Exact local row hashes + effective manifest must match
  // the independently reconstructed historical Cloud state.
  const EXISTING_MIRROR_STORES=Object.freeze([
    'card_classification','card_content','card_learning_metadata','cards',
    'learner_profile','learner_route_state','learning_alternative_situations',
    'learning_alternatives','learning_events','learning_sessions',
    'learning_situations','learning_state','study_build_cards','study_builds',
    'study_context_cards','study_contexts','user_preferences'
  ]);
  async function readExistingMirror(){
    if(typeof indexedDB.databases!=='function'||
      !(await indexedDB.databases()).some(x=>x.name==='wlp-cloud-v1'))fail('Existing Mirror missing; no database created');
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open('wlp-cloud-v1');
      r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){}reject(Error('Unexpected Mirror creation/upgrade'))};
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error||Error('Mirror read failed'));
      r.onblocked=()=>reject(Error('Mirror database blocked'));
    });
    try{
      const stores=[...EXISTING_MIRROR_STORES,'sync_meta','sync_outbox'];
      if(stores.some(x=>!db.objectStoreNames.contains(x)))fail('Existing Mirror schema incomplete');
      // All requests join ONE read-only transaction to get a consistent local view.
      const tx=db.transaction(stores,'readonly');
      const get=q=>new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error('Mirror transaction read failed'))});
      const requests=[get(tx.objectStore('sync_meta').get('authority_mirror')),
        get(tx.objectStore('sync_meta').get('sync_cursor')),
        get(tx.objectStore('sync_outbox').count()),
        get(tx.objectStore('sync_outbox').getAll()),
        ...EXISTING_MIRROR_STORES.map(n=>get(tx.objectStore(n).getAll()))];
      const [meta,cursorMeta,outboxCount,outboxRows,...contents]=await Promise.all(requests);
      if(!meta||!cursorMeta||!Number.isSafeInteger(outboxCount)||!Array.isArray(outboxRows)||outboxRows.length!==outboxCount)fail('Existing Mirror metadata/Outbox incomplete');
      const rows=[];
      for(let i=0;i<EXISTING_MIRROR_STORES.length;i++)for(const rec of contents[i]){
        if(!rec||typeof rec.rowKey!=='string'||!rec.rowKey||!shaPattern.test(str(rec.payloadHash))||
           typeof rec.tombstone!=='boolean')fail('Unverified local Mirror record');
        if(rec.tombstone){if(rec.payload!==null)fail('Local tombstone payload is not explicit');}
        else if(!rec.payload||typeof rec.payload!=='object'||Array.isArray(rec.payload))fail('Local row payload missing');
        if(!rec.tombstone && await sha(stringify(rec.payload))!==rec.payloadHash)
          fail('Local Mirror row payload hash mismatch');
        rows.push({tableName:EXISTING_MIRROR_STORES[i],rowKey:rec.rowKey,
          payloadHash:rec.payloadHash,tombstone:rec.tombstone,payload:rec.payload});
      }
      const sort=(a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey);
      rows.sort(sort);
      for(let i=1;i<rows.length;i++)if(identity(rows[i].tableName,rows[i].rowKey)===identity(rows[i-1].tableName,rows[i-1].rowKey))fail('Duplicate local Mirror key');
      const manifest=await sha(stringify(orderedManifest(rows)));
      if(manifest!==str(meta.materializedManifestHash)||rows.length!==num(meta.materializedCanonicalRowCount))
        fail('Mirror content does not match committed materialized manifest');
      const cursor=num(meta.materializedSyncCursor);
      if(cursor===null||cursor!==num(cursorMeta.lastSyncCursor))fail('Mirror Cursor metadata is inconsistent');
      return {meta,cursor,outboxCount,outboxRows,outboxFingerprint:await sha(stringify(outboxRows)),rows,manifest};
    }finally{db.close();}
  }
  function localProjectionRawFingerprint(){
    // Probe raw bytes, not the legacy UI's silently parsed/filtered projection.
    const drafts=localStorage.getItem('wlp:local-additions:v1');
    const edits=localStorage.getItem('wlp:local-overrides:v1');
    return JSON.stringify([drafts,edits]);
  }
  async function collectExistingEvidenceReadOnly(){
    const boundary=window.WLPG4LibraryBoundary;
    if(!boundary?.inspect)fail('Account/Library boundary unavailable');
    const first=await boundary.inspect();
    if(!['EXISTING_ACCOUNT_LIBRARY','EXISTING_SYNC_NEEDED','EXISTING_PENDING'].includes(first.verdict?.code)||
       !first.local?.mirrorPresent||!first.local.mirrorValid||first.local.mirrorAuthorityDifferent||
       first.local.ownerMismatch||first.local.deviceMismatch||
       !first.remote?.identityVerified||!first.remote?.authorityVerified)
      fail('Existing E7a Library has no approved verified read-only boundary');
    if(first.local.journalPresent)fail('Existing Journal has not been inventoried; preserve its unacknowledged content');
    const {config,session}=await shadowCredentials(),origin=cleanOrigin(config.url),owner=str(session.userId);
    if(origin!==first.remote.projectOrigin||owner!==first.remote.userId)fail('Cloud owner/project mismatch');
    const localProjectionAtStart=await sha(localProjectionRawFingerprint());
    const mirror=await readExistingMirror(),localCursor=mirror.cursor;
    if(localCursor!==first.local.mirrorCursor||mirror.outboxCount!==first.local.pendingOutbox||
       str(mirror.meta.userId)!==owner||
       str(mirror.meta.candidateKey)!==str(first.remote.authority.candidateKey)||
       num(mirror.meta.headVersion)!==num(first.remote.authority.headVersion)||
       str(mirror.meta.snapshotManifestHash)!==str(first.remote.authority.snapshotManifestHash))
       fail('Mirror owner, Authority, Outbox or Cursor diverged from Cloud boundary');
    const headers={apikey:str(config.publishableKey),Authorization:`Bearer ${session.accessToken}`};
    const hExtra='limit=2';
    const hUrl=tableUrl(origin,HEAD,'candidate_key,head_version,snapshot_manifest_hash,canonical_row_count',owner,hExtra);
    const readHead=async()=>{const r=await fetchJson(hUrl,headers);if(!Array.isArray(r.data)||r.data.length!==1)fail('Cloud Authority is not unique');return r.data[0]};
    const cursorUrl=h=>tableUrl(origin,CHANGES,'change_seq',owner,
      `candidate_key=eq.${encodeURIComponent(h.candidate_key)}&head_version=eq.${h.head_version}&order=change_seq.desc&limit=1`);
    const readCursor=async h=>{const r=await fetchJson(cursorUrl(h),headers);if(!Array.isArray(r.data)||r.data.length>1)fail('Cloud Cursor response invalid');return r.data.length?num(r.data[0].change_seq):0;};
    const head=await readHead(),highWater=await readCursor(head);
    if(highWater===null||localCursor>highWater||highWater!==first.remote.cursor||
      !matchingHead(head,{candidate_key:first.remote.authority.candidateKey,head_version:first.remote.authority.headVersion,
        snapshot_manifest_hash:first.remote.authority.snapshotManifestHash,canonical_row_count:first.remote.authority.rowCount}))
      fail('Cloud Head/Cursor do not match verified boundary');
    const key=encodeURIComponent(str(head.candidate_key)),ver=num(head.head_version);
    const base=await paged(origin,BASE,'table_name,row_key,payload_hash,payload,tombstone',owner,headers,
      `candidate_key=eq.${key}&order=table_name.asc,row_key.asc`,num(head.canonical_row_count));
    const changes=highWater?await paged(origin,CHANGES,
      'change_seq,table_name,row_key,operation,payload_hash,payload,tombstone',owner,headers,
      `candidate_key=eq.${key}&head_version=eq.${ver}&change_seq=lte.${highWater}&order=change_seq.asc`):[];
    const historical=await reconstruct(base,changes.filter(x=>num(x.change_seq)<=localCursor),
      localCursor,head.snapshot_manifest_hash,true);
    const current=await reconstruct(base,changes,highWater,head.snapshot_manifest_hash,true);
    // Overlay ledger is independently checked against legacy localStorage by
    // WLPStage7LocalProjectionEvidence, never silently included in Mirror.
    const legacyProofApi=window.WLPStage7LocalProjectionEvidence;
    if(!legacyProofApi?.review)fail('Per-record local projection evidence module missing');
    const legacyProjection=await legacyProofApi.review({ownerVerified:true,baseVerified:true,cloudVerified:true,localMirrorVerified:true,
      baseRows:historical.effectiveRows,cloudRows:current.effectiveRows,
      storage:localStorage,expectedDraftCount:first.local.localDraftCount,
      expectedEditCount:first.local.localEditCount});
    if(historical.materializedManifest!==mirror.manifest||historical.materializedRowCount!==mirror.rows.length)
      fail('HOLD_NO_VERIFIED_COMMON_BASE: local Mirror differs from Cloud history at recorded Cursor');
    // Pending v400 actions are separate from immutable materialized Mirror.
    // Independently validate persisted action/hash/preconditions against the
    // proven base and current Cloud; NEVER send or acknowledge from this reader.
    const reviewer=window.WLPStage7OutboxEvidence;
    if(!reviewer?.review)fail('Trusted Outbox reviewer not loaded');
    const outboxReview=await reviewer.review({rows:mirror.outboxRows,
      baseRows:historical.effectiveRows,cloudRows:current.effectiveRows,
      ownerId:owner,deviceKey:str(mirror.meta.deviceKey),authority:{
       candidateKey:str(head.candidate_key),headVersion:num(head.head_version),
       snapshotManifestHash:str(head.snapshot_manifest_hash)}});
    const endHead=await readHead(),endCursor=await readCursor(endHead);
    if(!matchingHead(head,endHead)||endCursor!==highWater)
      fail('Cloud changed during historical/current Snapshot; discard comparison');
    // Double fingerprint prevents unnoticed local edits racing the Cloud read.
    const localAgain=await readExistingMirror();
    if(localAgain.manifest!==mirror.manifest||localAgain.cursor!==localCursor||
       localAgain.outboxCount!==mirror.outboxCount||localAgain.outboxFingerprint!==mirror.outboxFingerprint||str(localAgain.meta.userId)!==owner)
      fail('Local Mirror changed during collection; discard comparison');
    if(await sha(localProjectionRawFingerprint())!==localProjectionAtStart)
      fail('Legacy Draft/Local Edit projection changed while Cloud history was being verified');
    const final=await boundary.inspect();
    if(final.remote?.userId!==owner||final.remote?.projectOrigin!==origin||
      final.remote.cursor!==highWater||final.local.mirrorCursor!==localCursor||
      final.local.pendingOutbox!==mirror.outboxCount||
      JSON.stringify(final.local)!==JSON.stringify(first.local))
      fail('Account or Local inventory changed during collection');
    const asPlannerRow=r=>({table_name:r.tableName,row_key:r.rowKey,tombstone:r.tombstone,payload:r.payload});
    // IMPORTANT: this is an independent historical proof only when the complete
    // current Mirror exactly matches the independently replayed Cursor state.
    // Local edits kept outside Mirror remain visible through inventory counts.
    return {baseRows:historical.effectiveRows.filter(r=>r.tableName!=='card_local_overrides').map(asPlannerRow),
      localRows:mirror.rows.map(asPlannerRow),
      cloudRows:current.effectiveRows.filter(r=>r.tableName!=='card_local_overrides').map(asPlannerRow),outboxReview,legacyProjection,
      evidence:{ownerVerified:true,commonAncestorVerified:true,localSnapshotVerified:true,
        cloudSnapshotVerified:true,localComplete:true,cloudComplete:true,baseComplete:true,
        ownerId:owner,baseManifestHash:historical.materializedManifest,baseCursor:localCursor,
        localCursor,cloudCursor:highWater,outboxCount:mirror.outboxCount,
        localEditCount:first.local.localEditCount,localDraftCount:first.local.localDraftCount,
        pendingJournalCount:0,unknownLegacyData:!!(first.local.additionalLocalKeyCount||
          first.local.additionalSessionKeyCount||first.local.additionalDbCount)},
      // Metadata only; raw record values must never be rendered/exported by UI.
      proof:{authorityHash:str(head.snapshot_manifest_hash),historicalManifest:historical.manifest,
        currentManifest:current.manifest,localManifest:mirror.manifest,
        historicalMaterializedManifest:historical.materializedManifest,
        currentMaterializedManifest:current.materializedManifest,
        historicalOverlayRows:historical.tableCounts.card_local_overrides?.total||0,
        currentOverlayRows:current.tableCounts.card_local_overrides?.total||0,
        localRows:mirror.rows.length,cloudRows:current.rowCount,cursorBefore:localCursor,cursorAfter:highWater,
        outboxFingerprint:mirror.outboxFingerprint}};
  }
  const verify=()=>runVerified(false);
  const prepareFirstInstall=()=>runVerified(true);
  window.WLPG4VerifiedSnapshot=Object.freeze({verify,prepareFirstInstall,collectExistingEvidenceReadOnly});
  if(typeof module==='object'&&module.exports)module.exports={reconstruct,matchingHead,stable,stringify,paged};
})();
