/* WLP G4-1 Account/Local Library Boundary Candidate V1.
 * Explicit READ-ONLY inspection. No install, tokens refresh, sync, SQL, or local writes.
 * Never infer that a fresh account has an empty browser from a missing Mirror alone.
 * The server's ACTIVE Authority is authoritative; no pinned WID/count/cursor/candidate hash.
 */
(() => {
  'use strict';
  const DB = Object.freeze({shadow:'wlp-cloud-shadow-v0',mirror:'wlp-cloud-v1',official:'wlp-official-shadow-p1-v1',journal:'wlp-study-context-sync-v1'});
  const LOCAL_KEYS=['wlp:local-overrides:v1','wlp:local-additions:v1','wlp:device-id:v1'];
  const SHA=/^[0-9a-f]{64}$/i;
  const fail = (msg) => {throw new Error(msg);};
  const int=(v)=>Number.isSafeInteger(Number(v)) && Number(v)>=0 ? Number(v) : null;
  const text=(value)=>String(value??'').trim();
  const req=(r)=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result??null);r.onerror=()=>no(r.error||Error('IndexedDB read failed'));});
  const transact=async(db,store,lookup)=>{
    if(!db?.objectStoreNames.contains(store))fail(`Existing ${db?.name||'DB'} lacks ${store} store; no data changed`);
    return req(lookup(db.transaction(store,'readonly').objectStore(store)));
  };
  function classify(local,remote) {
    // Pure decision function. A blocked verdict is not permission to delete/clear data.
    if(!local?.safe) return {code:'HOLD_LOCAL_UNVERIFIED',reason:'Local storage inventory is incomplete or malformed'};
    if(local.ownerMismatch) return {code:'HOLD_OTHER_ACCOUNT',reason:'Local data belongs to a different WLP Account'};
    if(local.deviceMismatch) return {code:'HOLD_DEVICE_MISMATCH',reason:'Local Mirror device identity differs from this browser'};
    if(!remote?.identityVerified) return {code:'HOLD_AUTH_NOT_VERIFIED',reason:'WLP Cloud login has not been verified by the server'};
    if(!remote.authorityVerified) return {code:'HOLD_AUTHORITY_UNVERIFIED',reason:'Cloud Authority or its record count is not verified'};
    if(local.mirrorPresent) {
      if(!local.mirrorValid) return {code:'HOLD_EXISTING_MIRROR',reason:'Existing Mirror has incomplete metadata; never replace it'};
      if(local.pendingOutbox>0) return {code:'EXISTING_PENDING',reason:'Keep and reconcile existing Outbox before any setup'};
      if(local.mirrorAuthorityDifferent) return {code:'EXISTING_AUTHORITY_CHANGE',reason:'Existing Mirror Authority differs; requires migration or review'};
      const localCursor=int(local.mirror?.materializedSyncCursor);
      if(localCursor===null||localCursor>remote.cursor) return {code:'HOLD_CURSOR_INVALID',reason:'Existing Mirror cursor is invalid or newer than Cloud; inspect without replacement'};
      if(localCursor<remote.cursor) return {code:'EXISTING_SYNC_NEEDED',reason:'Existing Mirror is behind Cloud; use guarded differential sync, not first install'};
      return {code:'EXISTING_ACCOUNT_LIBRARY',reason:'Existing Mirror preserved; first install is forbidden'};
    }
    if(local.officialPresent||local.hasLegacyEdits||local.hasLegacyDrafts||local.journalPresent||local.unknownLegacyData)
      return {code:'EXISTING_LOCAL_DATA',reason:'Browser already holds WLP data; reconcile before a first-library install'};
    return {code:'FIRST_BROWSER_CANDIDATE',reason:'No known existing user data; full snapshot validation still required before install'};
  }
  async function openKnown(name, known){
    if(!known.has(name))return null;
    return new Promise((yes,no)=>{
      const r=indexedDB.open(name);
      r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){};no(Error(`Unexpected database initialization for ${name}`));};
      r.onsuccess=()=>yes(r.result);
      r.onerror=()=>no(r.error||Error(`Cannot inspect existing ${name}`));
      r.onblocked=()=>no(Error(`Database is blocked: ${name}`));
    });
  }
  function legacy(key) {
    const raw=localStorage.getItem(key);
    if(raw==null)return {present:false,entries:0};
    let parsed;try{parsed=JSON.parse(raw);}catch{fail(`${key} is not valid JSON; preserve and inspect it`);}
    if(!parsed || typeof parsed!=='object')fail(`${key} has unexpected format; preserve and inspect it`);
    const count=Array.isArray(parsed)?parsed.length:Object.keys(parsed).length;
    return {present:count>0,entries:count};
  }

  // Categorize *names only*. The category is not proof of ownership, ACK,
  // common base or sync eligibility. Never export names or stored values.
  function classifyAdditionalKey(key){
    if(/^fc:wordid:/i.test(key))return 'perCardProgress';
    if(/^wlp:(?:learning-meta|classification-meta|local-additions|local-overrides)(?:[:\-]|$)/i.test(key))return 'metadataAuthoring';
    if(/^wlp:(?:local-data-backup|local-data-restore|.*rollback)(?:[:\-]|$)/i.test(key)||/rollback/i.test(key))return 'backupRollback';
    if(/^wlp:(?:ui-role|session-admin|review-settings|theme|locale|language|font|preferences)(?:[:\-]|$)/i.test(key))return 'settingsInterface';
    if(/^wlp:(?:study|ai-study|review|quick-review|stage7:(?:activity|practice)|build-history|temporary-study-set|active-card-study-context|progress)(?:[:\-]|$)/i.test(key))return 'studyReviewHistory';
    return 'unclassifiedLocal';
  }
  async function fingerprintInventory(pairs){
    const ordered=pairs.sort((a,b)=>a[0].localeCompare(b[0]));
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered)));
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }

  async function inspectLocal(){
    if(typeof indexedDB.databases!=='function')fail('Browser does not support safe database discovery; stop');
    const known=new Set((await indexedDB.databases()).map(x=>x.name));
    let otherLocalKeys=0;
    const categories={perCardProgress:0,metadataAuthoring:0,backupRollback:0,
      settingsInterface:0,studyReviewHistory:0,unclassifiedLocal:0};
    const inventoryPairs=[];
    if(typeof localStorage.length!=='number' || typeof localStorage.key!=='function')
      fail('Cannot enumerate local WLP keys safely');
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && /^(?:wlp(?:[ :_\-]|$)|fc:wordid:)/i.test(k) && !LOCAL_KEYS.includes(k)){
        otherLocalKeys++;
        categories[classifyAdditionalKey(k)]++;
        inventoryPairs.push(['local:'+k,localStorage.getItem(k)]);
      }
    }
    // A browser can have older `WLP ...` and `fc:wordid:` study keys
    // even when the Canonical Mirror DB is absent. Preserve them all.
    let otherSessionKeys=0;
    if(typeof sessionStorage!=='undefined')for(let i=0;i<sessionStorage.length;i++){
      const k=sessionStorage.key(i);
      if(k&&/^(?:wlp(?:[ :_\-]|$)|fc:wordid:)/i.test(k)){
        otherSessionKeys++;
        inventoryPairs.push(['session:'+k,sessionStorage.getItem(k)]);
      }
    }
    const additionalDatabases=[...known].filter(name=>/^wlp[-:]/i.test(name)&&!Object.values(DB).includes(name));
    const inventoryFingerprint=await fingerprintInventory(inventoryPairs);
    const db={};for(const [k,name] of Object.entries(DB))db[k]=await openKnown(name,known);
    try{
      const [config,session]=db.shadow?await Promise.all([
        transact(db.shadow,'meta',s=>s.get('supabase_config')),
        transact(db.shadow,'meta',s=>s.get('supabase_session'))
      ]):[null,null];
      const [mirror,outbox]=db.mirror?await Promise.all([
        transact(db.mirror,'sync_meta',s=>s.get('authority_mirror')),
        transact(db.mirror,'sync_outbox',s=>s.count())
      ]):[null,null];
      const official=db.official?await transact(db.official,'meta',s=>s.get('active')):null;
      const edits=legacy(LOCAL_KEYS[0]),drafts=legacy(LOCAL_KEYS[1]);
      const deviceId=text(localStorage.getItem(LOCAL_KEYS[2]));
      // A Journal whose schema isn't known is still owned local data: do not scan its content.
      const res={safe:true,shadowPresent:!!db.shadow,config,session,mirrorPresent:!!db.mirror,mirror,
        mirrorValid:!!mirror?.userId&&!!mirror?.deviceKey&&!!mirror?.candidateKey&&int(mirror?.headVersion)>0&&
          SHA.test(text(mirror?.snapshotManifestHash))&&SHA.test(text(mirror?.materializedManifestHash))&&
          int(mirror?.materializedSyncCursor)!==null&&outbox!==null,
        pendingOutbox:outbox,officialPresent:!!db.official,official:official?.value||null,
        journalPresent:!!db.journal,hasLegacyEdits:edits.present,hasLegacyDrafts:drafts.present,
        localEditCount:edits.entries,localDraftCount:drafts.entries,deviceId,ownerMismatch:false,deviceMismatch:false,
        unknownLegacyData:otherLocalKeys>0||otherSessionKeys>0||additionalDatabases.length>0,mirrorAuthorityDifferent:false,
        additionalLocalKeyCount:otherLocalKeys,additionalSessionKeyCount:otherSessionKeys,additionalDbCount:additionalDatabases.length,
        additionalCategories:categories,inventoryFingerprint};
      return res;
    }finally{for(const item of Object.values(db))item?.close();}
  }
  function endpoint(value){
    let url;try{url=new URL(value);}catch{fail('Cloud project URL unavailable');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname.replace(/\//g,''))fail('Unsupported Cloud endpoint');
    return url.origin;
  }
  function key(value){const str=text(value);if(!str||/^\s*(?:sk_|service_role|sb_secret_)/i.test(str))fail('Invalid public Cloud API key');return str;}
  async function get(url,headers) {
    const r=await fetch(url,{method:'GET',headers,cache:'no-store',credentials:'omit',redirect:'error'});
    if(!r.ok)fail(`Cloud read failed HTTP ${r.status}; no local data changed`);
    return r;
  }
  async function getJson(url,headers){const r=await get(url,headers);return r.json();}
  function authorityValid(h){return !!h&&text(h.candidate_key).length>3&&int(h.head_version)>0&&SHA.test(text(h.snapshot_manifest_hash))&&int(h.canonical_row_count)>0;}
  const encode=(s)=>encodeURIComponent(text(s));
  async function readRemote(local){
    const {config,session}=local;
    if(!config?.url||!config?.publishableKey||!session?.userId||!session?.accessToken)
      fail('WLP Account session is missing; sign in first');
    if(int(session.expiresAt)===null||Number(session.expiresAt)<=Date.now()+60000)
      fail('Saved access token is expired or near expiry. Sign in/refresh through the established account flow. This check does not refresh tokens.');
    const root=endpoint(config.url);
    const headers={apikey:key(config.publishableKey),Authorization:`Bearer ${session.accessToken}`};
    const user=await getJson(`${root}/auth/v1/user`,headers);
    if(!user?.id||text(user.id)!==text(session.userId))fail('Cloud account differs from the locally saved account');
    const owner=encode(user.id);
    const headUrl=`${root}/rest/v1/wlp_canonical_authority_heads?select=candidate_key,head_version,snapshot_manifest_hash,canonical_row_count&owner_id=eq.${owner}&limit=2`;
    const headRows=await getJson(headUrl,headers);
    if(!Array.isArray(headRows)||headRows.length!==1||!authorityValid(headRows[0]))fail('Expected one complete ACTIVE Authority Head for this account');
    const head=headRows[0];
    const baseUrl=`${root}/rest/v1/wlp_canonical_authority_candidate_records?select=row_key&owner_id=eq.${owner}&candidate_key=eq.${encode(head.candidate_key)}&limit=1`;
    const countRes=await get(baseUrl,{...headers,Prefer:'count=exact'});
    const range=countRes.headers.get('content-range')||'';
    const baseCount=Number(range.split('/')[1]);
    if(!/^\d+-\d+\/\d+$/.test(range)&&!/^\*\/\d+$/.test(range))fail('Cannot prove exact Authority record count');
    if(!Number.isSafeInteger(baseCount)||baseCount!==Number(head.canonical_row_count))fail('ACTIVE Authority record count mismatch');
    const cursorUrl=`${root}/rest/v1/wlp_sync_changes_v1?select=change_seq&owner_id=eq.${owner}&candidate_key=eq.${encode(head.candidate_key)}&head_version=eq.${head.head_version}&order=change_seq.desc&limit=1`;
    const getCursor=async()=>{const rows=await getJson(cursorUrl,headers);if(!Array.isArray(rows)||rows.length>1)fail('Invalid Cloud cursor response');const cursor=rows.length?int(rows[0].change_seq):0;if(cursor===null)fail('Invalid Cloud cursor');return cursor;};
    const highWater=await getCursor();
    const after=await getJson(headUrl,headers);
    const stableHead=Array.isArray(after)&&after.length===1&&JSON.stringify(after[0])===JSON.stringify(head);
    if(!stableHead || await getCursor()!==highWater)fail('Cloud Authority or Cursor moved during check; retry later');
    return {identityVerified:true,authorityVerified:true,userId:text(user.id),projectOrigin:root,
      authority:{candidateKey:text(head.candidate_key),headVersion:Number(head.head_version),snapshotManifestHash:text(head.snapshot_manifest_hash),rowCount:baseCount},cursor:highWater};
  }
  async function inspect(){
    const local=await inspectLocal();
    // Cloud is never queried before checking local owner identity.
    if(local.mirror?.userId && local.session?.userId && text(local.mirror.userId)!==text(local.session.userId))local.ownerMismatch=true;
    if(local.mirror?.deviceKey && local.deviceId && text(local.mirror.deviceKey)!==local.deviceId)local.deviceMismatch=true;
    if(local.official?.accountKey && local.session?.userId && local.config?.url){
      const raw=`wlp-shadow-p1b|${endpoint(local.config.url)}|${local.session.userId}`;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
      const fingerprint=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(fingerprint!==local.official.accountKey)local.ownerMismatch=true;
    }
    if(local.ownerMismatch||local.deviceMismatch)return {verdict:classify(local,null),local:sanitize(local),remote:null};
    const remote=await readRemote(local);
    if(local.mirror){
      if(text(local.mirror.userId)!==remote.userId)local.ownerMismatch=true;
      if(text(local.mirror.candidateKey)!==remote.authority.candidateKey ||
        Number(local.mirror.headVersion)!==remote.authority.headVersion ||
        text(local.mirror.snapshotManifestHash)!==remote.authority.snapshotManifestHash)local.mirrorAuthorityDifferent=true;
    }
    // A second local inventory catches a tab that created data during the Cloud read.
    const after=await inspectLocal();
    if(local.mirrorPresent!==after.mirrorPresent || local.officialPresent!==after.officialPresent ||
       local.journalPresent!==after.journalPresent || local.pendingOutbox!==after.pendingOutbox ||
       local.localEditCount!==after.localEditCount || local.localDraftCount!==after.localDraftCount ||
       local.unknownLegacyData!==after.unknownLegacyData ||
       local.inventoryFingerprint!==after.inventoryFingerprint ||
       JSON.stringify(local.additionalCategories)!==JSON.stringify(after.additionalCategories) ||
       JSON.stringify(local.mirror)!==JSON.stringify(after.mirror) ||
       text(local.session?.userId)!==text(after.session?.userId))
      fail('Local data changed during Cloud inspection; no setup decision is valid');
    return {verdict:classify(local,remote),local:sanitize(local),remote};
  }
  function sanitize(x){return {mirrorPresent:x.mirrorPresent,mirrorValid:x.mirrorValid,officialPresent:x.officialPresent,journalPresent:x.journalPresent,pendingOutbox:x.pendingOutbox,
    legacyV400Allowed:x.mirrorPresent&&x.mirrorValid&&
      x.mirror?.installSource!=='g4-first-browser-source-only-v1'&&
      x.mirror?.normalAutoSyncEnabled!==false,
    mirrorCursor:int(x.mirror?.materializedSyncCursor),localEditCount:x.localEditCount,localDraftCount:x.localDraftCount,ownerMismatch:x.ownerMismatch,mirrorAuthorityDifferent:x.mirrorAuthorityDifferent,deviceMismatch:x.deviceMismatch,additionalLocalKeyCount:x.additionalLocalKeyCount,additionalSessionKeyCount:x.additionalSessionKeyCount,additionalDbCount:x.additionalDbCount,
    additionalCategories:{...x.additionalCategories}};}
  window.WLPG4LibraryBoundary=Object.freeze({inspect, classify});
  if(typeof module==='object'&&module.exports)module.exports={classify,authorityValid,endpoint,classifyAdditionalKey,fingerprintInventory};
})();
