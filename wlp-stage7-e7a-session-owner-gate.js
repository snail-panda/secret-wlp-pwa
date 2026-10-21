/* Stage7 / E7a -> G4 new Standard Session owner preflight (SOURCE OFF).
 * No side effects on import. Read-only, does not prepare or enroll a Journal,
 * create a Study Context, install a Mirror, send to Cloud, or switch a Writer.
 * This is a necessary witness for a separately reviewed per-session binding.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7E7aSessionOwnerGate=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const DB='wlp-cloud-v1', EDITS='wlp:local-overrides:v1';
 const MAPPINGS=Object.freeze([['Word','word'],['IPA','ipa'],['Part of Speech','part_of_speech'],
  ['Definition','definition'],['Synonym(s)','synonyms'],['Example Sentence','example_sentence'],
  ['Note(s)','notes'],['Category','category'],['Source','source']]);
 const hex64=/^[a-f0-9]{64}$/i;
 const fail=x=>{throw Error('E7a session owner HOLD: '+x);};
 const clean=x=>String(x??'').trim();
 const same=(a,b,keys)=>keys.every(k=>clean(a?.[k])===clean(b?.[k]));
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
 async function hash(cryptoImpl,x){
  if(!cryptoImpl?.subtle?.digest)fail('crypto-unavailable');
  const bytes=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(String(x)));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
 }
 async function localStorageHash(storage,cryptoImpl){
  if(typeof storage.length!=='number'||typeof storage.key!=='function')fail('storage-inventory-unavailable');
  const pairs=[];for(let i=0;i<storage.length;i++){
   const key=storage.key(i);if(key&&/^(?:wlp(?:[ :_\-]|$)|fc:wordid:)/i.test(key))
    pairs.push([key,storage.getItem(key)]);
  }
  pairs.sort((a,b)=>a[0].localeCompare(b[0]));
  return hash(cryptoImpl,JSON.stringify(pairs));
 }
 function inspectRow(card,content,study,wid){
  if(card?.tombstone||content?.tombstone||!card?.payload||!content?.payload)
   fail('selected-card-absent');
  if(!hex64.test(clean(card.payloadHash))||!hex64.test(clean(content.payloadHash)))
   fail('unhashed-selected-card');
  const c=card.payload,p=content.payload;
  if(card.rowKey!==content.rowKey||clean(c.card_id)!==card.rowKey||
   clean(p.card_id)!==card.rowKey||c.origin_kind!=='official'||c.status!=='active'||
   clean(c.word_id)!==wid||clean(c.legacy_key)!=='wid:'+wid)
   fail('selected-card-identity-mismatch');
  if(clean(study.WordID)!==wid||clean(study['Batch #'])!==clean(c.legacy_batch)||
   clean(study['Guidance #'])!==clean(c.legacy_guidance))
   fail('study-card-index-differs-from-mirror');
  for(const [source,target] of MAPPINGS){
   if(typeof p[target]!=='string'||study[source]!==p[target])
    fail('selected-study-card-differs-from-mirror:'+source);
  }
  return true;
 }
 function decideNewSession({buildApproved=false,route,identity,proof,sessionId,existingSession=false,
   legacyPendingCount,ownerRead,sessionOwner}={}){
  if(buildApproved!==true)return Object.freeze({writer:'legacy-canonical',reason:'source-off'});
  if(route?.mode!=='legacy'||route?.reason!=='existing-e7a-authority')fail('not-existing-e7a-library');
  if(!/^[a-z0-9][a-z0-9-]{15,}$/i.test(clean(sessionId))||existingSession!==false)
   fail('only-newly-allocated-session-may-be-enrolled');
  if(!identity?.verified||!identity.accountId||!identity.deviceKey||!identity.candidateKey||
   !Number.isSafeInteger(identity.headVersion)||identity.headVersion<1)
   fail('live-account-lease-unverified');
  if(proof?.ready!==true||proof.readOnly!==true||proof.cardCount<1||
   !same(identity,proof,['accountId','deviceKey','candidateKey','headVersion'])||
   !hex64.test(clean(proof.materializedManifest))||
   !hex64.test(clean(proof.selectedCardWitnessHash)))fail('verified-card-source-unavailable');
  if(legacyPendingCount!==0||proof.pendingOutbox!==0)fail('unacknowledged-legacy-actions');
  // Unknown or partial Journal ownership is always HOLD, never a legacy fallback.
  if(ownerRead?.writer!=='legacy-canonical'||ownerRead?.reason!=='no-durable-g4-ownership-for-session')
   fail('new-session-journal-ownership-uncertain');
  if(sessionOwner!==null&&sessionOwner!==undefined)fail('session-already-owned');
  return Object.freeze({writer:'g4-journal-candidate',reason:'new-session-preflight-only',
   sessionId:clean(sessionId),accountId:identity.accountId,deviceKey:identity.deviceKey,
   candidateKey:identity.candidateKey,headVersion:identity.headVersion,
   materializedManifest:proof.materializedManifest,cardCount:proof.cardCount,
   selectedCardWitnessHash:proof.selectedCardWitnessHash,
   // No durable ownership has been granted by this pure decision.
   enrollmentCommitted:false,cloudWriteAuthorized:false});
 }
 async function inspectReadOnly({indexedDB,storage,boundary,studyRows,cryptoImpl}={}){
  if(!indexedDB?.open||typeof indexedDB.databases!=='function'||
    !storage?.getItem||!boundary?.inspect||!Array.isArray(studyRows)||!studyRows.length)
   fail('read-only-dependencies-unavailable');
  const start=await boundary.inspect();
  if(start?.verdict?.code!=='EXISTING_ACCOUNT_LIBRARY'||!start.remote?.identityVerified||
   !start.remote?.authorityVerified||!start.local?.mirrorValid||
   start.local.pendingOutbox!==0||start.local.mirrorCursor!==start.remote.cursor)
   fail('existing-e7a-cloud-mirror-not-caught-up');
  const currentDevice=clean(storage.getItem('wlp:device-id:v1'));
  if(!currentDevice)fail('device-identity-missing');
  const rowIds=new Set(),witnesses=[];
  for(const row of studyRows){
   const wid=clean(row?.WordID);if(!/^\d+$/.test(wid)||rowIds.has(wid))fail('duplicate-or-invalid-study-wordid');
   rowIds.add(wid);
  }
  const raw=storage.getItem(EDITS);
  let edits;try{edits=JSON.parse(raw||'{}');}catch(_){fail('local-edits-malformed');}
  if(!edits||Array.isArray(edits)||typeof edits!=='object')fail('local-edits-invalid');
  // Never treat selected local edits as Canonical without immutable overlay proof.
  for(const wid of rowIds)if(Object.prototype.hasOwnProperty.call(edits,wid))fail('selected-local-edit-needs-cloud-overlay-witness');
  const inventoryAtStart=await localStorageHash(storage,cryptoImpl);
  const names=await indexedDB.databases();
  if(!names.some(item=>item.name===DB))fail('existing-canonical-db-missing');
  const db=await new Promise((ok,no)=>{
   const r=indexedDB.open(DB);let created=false;
   r.onupgradeneeded=()=>{created=true;try{r.transaction.abort();}catch(_){}};
   r.onsuccess=()=>created?(r.result.close(),no(Error('unexpected-db-create'))):ok(r.result);
   r.onerror=()=>no(r.error||Error('db-open-failed'));
   r.onblocked=()=>no(Error('db-blocked'));
  });
  let result;
  try{
   for(const store of ['cards','card_content','sync_meta','sync_outbox'])
    if(!db.objectStoreNames.contains(store))fail('canonical-schema-incomplete');
   // Same readonly transaction for selected cards, metadata, cursor and Outbox.
   result=await new Promise((ok,no)=>{
    const tx=db.transaction(['cards','card_content','sync_meta','sync_outbox'],'readonly');
    let value=null,readError=null;
    const metaStore=tx.objectStore('sync_meta');
    const m=metaStore.get('authority_mirror'),c=metaStore.get('sync_cursor');
    const count=tx.objectStore('sync_outbox').count();
    const cardReq=tx.objectStore('cards').getAll();
    const found={};const contents=[];
    m.onsuccess=()=>{found.meta=m.result;};
    c.onsuccess=()=>{found.cursor=c.result;};
    count.onsuccess=()=>{found.outbox=count.result;};
    cardReq.onsuccess=()=>{
     try{
      const all=cardReq.result;
      const matches=[];
      for(const row of studyRows){
       const wid=clean(row.WordID),cards=all.filter(x=>!x?.tombstone&&
        x?.payload?.origin_kind==='official'&&clean(x?.payload?.word_id)===wid);
       if(cards.length!==1)throw Error('selected-wordid-card-not-unique');
       matches.push([row,cards[0]]);
      }
      for(let i=0;i<matches.length;i++){
       const request=tx.objectStore('card_content').get(matches[i][1].rowKey);
       request.onsuccess=()=>{contents[i]=request.result;};
       request.onerror=()=>{readError=request.error||Error('selected-content-read-failed');try{tx.abort();}catch(_){}};
      }
      found.matches=matches;
     }catch(e){readError=e;try{tx.abort();}catch(_){}}
    };
    for(const r of [m,c,count,cardReq])r.onerror=()=>{readError=r.error||Error('selected-row-read-failed');try{tx.abort();}catch(_){}};
    tx.oncomplete=()=>{
     const mirror=found.meta,cursor=found.cursor;
     if(!mirror||!cursor||found.outbox!==0||
      Number(cursor.lastSyncCursor)!==start.remote.cursor||
      clean(mirror.userId)!==clean(start.remote.userId)||
      clean(mirror.deviceKey)!==currentDevice||
      clean(mirror.candidateKey)!==clean(start.remote.authority.candidateKey)||
      Number(mirror.headVersion)!==Number(start.remote.authority.headVersion)||
      clean(mirror.snapshotManifestHash)!==clean(start.remote.authority.snapshotManifestHash)||
      clean(mirror.installSource).startsWith('g4-')||mirror.normalStudyEnabled===false||
      Number(mirror.materializedSyncCursor)!==start.remote.cursor||
      !hex64.test(clean(mirror.materializedManifestHash))||
      !found.matches||contents.length!==found.matches.length||contents.some(x=>!x))
      return no(Error('mirror-changed-or-incomplete-selected-card-snapshot'));
     value={matches:found.matches,contents,meta:mirror,cursor,outbox:found.outbox};
     ok(value);
    };
    tx.onabort=()=>no(readError||tx.error||Error('selected-row-read-aborted'));
    tx.onerror=()=>{readError=tx.error||Error('selected-row-read-failed');};
   });
  }finally{db.close();}
  const {matches,contents,meta}=result;
  for(let i=0;i<matches.length;i++){
   const [row,card]=matches[i],content=contents[i];
   inspectRow(card,content,row,clean(row.WordID));
   if(await hash(cryptoImpl,JSON.stringify(stable(card.payload)))!==card.payloadHash||
      await hash(cryptoImpl,JSON.stringify(stable(content.payload)))!==content.payloadHash)
    fail('selected-canonical-row-hash-mismatch');
   witnesses.push([clean(row.WordID),card.rowKey,card.payloadHash,content.payloadHash]);
  }
  const selectedCardWitnessHash=await hash(cryptoImpl,JSON.stringify(witnesses));
  const finish=await boundary.inspect();
  if(finish?.verdict?.code!=='EXISTING_ACCOUNT_LIBRARY'||
   finish.remote?.cursor!==start.remote.cursor||
   finish.local?.mirrorCursor!==start.local.mirrorCursor||
   finish.local?.pendingOutbox!==0||
   await localStorageHash(storage,cryptoImpl)!==inventoryAtStart||
   clean(finish.remote?.userId)!==clean(meta.userId)||
   clean(finish.remote?.authority?.candidateKey)!==clean(meta.candidateKey)||
   Number(finish.remote?.authority?.headVersion)!==Number(meta.headVersion))
   fail('cloud-or-local-changed-during-proof');
  if(storage.getItem(EDITS)!==raw)fail('local-overrides-changed-during-proof');
  return Object.freeze({ready:true,readOnly:true,cardCount:witnesses.length,
   accountId:clean(start.remote.userId),deviceKey:clean(meta.deviceKey),
   candidateKey:clean(meta.candidateKey),headVersion:Number(meta.headVersion),
   materializedManifest:clean(meta.materializedManifestHash),pendingOutbox:0,
   selectedCardWitnessHash,
   // Does not claim all legacy projections or unrelated localStorage are synchronized.
   newSessionWriterEligible:false,cloudWriteAuthorized:false});
 }
 return Object.freeze({inspectRow,decideNewSession,inspectReadOnly});
});
