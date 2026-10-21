/* WLP E7b — account-scoped paired receiver checkpoint / DEVELOPMENT ONLY.
 * NO auto-run, NO RPC, NO login, NO SW/UI, NO unsupervised Cloud writes.
 * Uses EXISTING journal IndexedDB stores. It never mutates legacy WLP keys.
 * A server pull page can be acknowledged ONLY AFTER ingestPull resolves.
 * Caution: browser-IndexedDB tests pending; NOT READY FOR DEPLOYMENT.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bPairedInboxDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const Wire=typeof module==='object'&&module.exports?require('./wlp-e7b-paired-wire-contract-dev.js'):root.WLPE7bPairedWireDEV;
const DB_NAME='wlp-study-context-sync-v1';
const META_PREFIX='e7b:paired-sql-inbox-dev:v1:';
const clean=v=>String(v??'').trim();
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=reason=>{throw Error('E7b paired inbox blocked: '+reason);};
const assert=(x,reason)=>{if(!x)fail(reason);};
const identKey=id=>encodeURIComponent(id.accountId)+':'+encodeURIComponent(id.deviceKey)+':'+encodeURIComponent(id.candidateKey)+':'+id.headVersion;
const cursorKey=id=>META_PREFIX+'cursor:'+identKey(id);
const frameKey=(id,seq)=>META_PREFIX+'frame:'+identKey(id)+':'+String(seq).padStart(20,'0');
function make({indexedDB,identityNow,canonicalRowsForFrame}){
 assert(indexedDB&&typeof indexedDB.open==='function','indexeddb-required');
 assert(typeof identityNow==='function'&&typeof canonicalRowsForFrame==='function','trusted-identity-and-card-provider-required');
 async function openExisting(){
  return new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB_NAME,1);
   request.onupgradeneeded=()=>{try{request.transaction.abort();}catch(_){}};
   request.onsuccess=()=>{
    const db=request.result;
    for(const store of ['meta','heads','outbox'])if(!db.objectStoreNames.contains(store)){
      db.close();reject(Error('E7b existing Local Journal store absent: '+store));return;
    }
    resolve(db);
   };
   request.onerror=()=>reject(request.error||Error('E7b Local Journal not installed'));
   request.onblocked=()=>reject(Error('E7b IndexedDB open blocked'));
  });
 }
 function current(){return Wire.normalizeIdentity(identityNow());}
 // A fresh receiver does not have a Journal yet: Standard Study normally creates
 // this exact E7b v1 schema when the FIRST local Session is started. For a new
 // browser receiving BEFORE it studies, initialize ONLY the EMPTY Journal schema,
 // and ONLY after the user explicitly pressed Receive once and the verified
 // account/device/Authority lease was checked by the transport.
 // Existing v1 DBs are NEVER upgraded, repaired, replaced, or cleared here.
 async function prepareEmptyJournalForExplicitReceive({approved=false}={}){
  assert(approved===true,'explicit-receive-authorization-required');
  const before=current();
  let created=false;
  const db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB_NAME,1);
   request.onupgradeneeded=(event)=>{
    if(event.oldVersion!==0){try{request.transaction.abort();}catch(_){};return;}
    created=true;
    // Same five stores, same version and keyPaths as E7b New Session Journal.
    for(const name of ['meta','heads','revisions','outbox','conflicts']){
     request.result.createObjectStore(name,{keyPath:'key'});
    }
   };
   request.onerror=()=>reject(request.error||Error('E7b receiver Journal schema initialization failed'));
   request.onblocked=()=>reject(Error('E7b receiver Journal database blocked'));
   request.onsuccess=()=>{
    const ready=request.result;
    if(!['meta','heads','revisions','outbox','conflicts'].every(n=>ready.objectStoreNames.contains(n))){
     ready.close();reject(Error('Existing E7b receiver Journal schema is incomplete; no repair attempted'));return;
    }
    resolve(ready);
   };
  });
  db.close();
  assert(Wire.sameIdentity(before,current()),'identity-changed-during-receiver-schema-preparation');
  return {created,version:1};
 }
 // Exact committed receive and cursor update within ONE IndexedDB transaction.
 // Pending local capture that appears while async canonical checks run is re-read
 // under the same write transaction; it cannot silently be overwritten.
 async function ingestPull({response}){
  const before=current();
  assert(response?.status==='ok'&&Array.isArray(response.frames)&&response.frames.length<=100,'invalid-sql-pull-page');
  const validated=[];
  for(const frame of response.frames){
   const rows=await canonicalRowsForFrame(copy(frame),copy(before));
   assert(Wire.sameIdentity(before,current()),'identity-changed-during-card-verification');
   validated.push(await Wire.validatePullFrame(frame,before,rows));
  }
  assert(Wire.sameIdentity(before,current()),'identity-changed-before-commit');
  const db=await openExisting();
  let report;
  try {
   report=await new Promise((resolve,reject)=>{
    let tx;try{tx=db.transaction(['meta','heads','outbox'],'readwrite');}catch(e){reject(e);return;}
    const meta=tx.objectStore('meta');
    const cr=meta.get(cursorKey(before));const hr=tx.objectStore('heads').getAll();const or=tx.objectStore('outbox').getAll();
    const mr=meta.getAll();
    let count=0, planned=null;
    const process=()=>{
     if(++count!==4)return;
     try{
      assert(Wire.sameIdentity(before,current()),'identity-changed-during-commit');
      const start=Number(cr.result?.seq||0);
      assert(Number.isSafeInteger(start)&&start>=0,'invalid-durable-cursor');
      for(let i=0;i<validated.length;i++)assert(validated[i].seq===start+i+1,'noncontiguous-or-replayed-feed-sequence');
      const heads=hr.result||[],outbox=or.result||[],metadata=mr.result||[];
      const entries=[];let quarantined=0;
      for(const rec of validated){
       const pendingHead=heads.some(h=>h.accountId===before.accountId&&h.candidateKey===before.candidateKey&&
         h.contextId===rec.contextId&&h.hasPending===true);
       const pendingOutbox=outbox.some(o=>o.accountId===before.accountId&&o.candidateKey===before.candidateKey&&
         (o.contextId===rec.contextId||o.sessionId===rec.sessionId)&&
         !['acked','applied','confirmed'].includes(o.status));
       // Remote Continue stages/prepared ACK reconciliation use the same
       // IndexedDB `meta` store; they are NOT in the NEW-session outbox.
       // Never allow a later pull to replace an unsent Safari edit.
       const pendingRemote=metadata.some(m=>m.accountId===before.accountId&&
         m.candidateKey===before.candidateKey&&m.contextId===rec.contextId&&
         ((m.kind==='e7b-remote-staged-revision-v1'&&m.status!=='acked')||
          (m.kind==='e7b-remote-prepared-revise-action-v1'&&(!m.ackedAt||!m.overlayRebasedAt))));
       const state=pendingHead||pendingOutbox||pendingRemote?'quarantined':'committed';
       if(state==='quarantined')quarantined++;
       const row={key:frameKey(before,rec.seq),kind:'e7b-paired-received-dev-v1',
        accountId:before.accountId,deviceKey:before.deviceKey,candidateKey:before.candidateKey,
        headVersion:before.headVersion,seq:rec.seq,contextId:rec.contextId,sessionId:rec.sessionId,
        state,reason:state==='quarantined'?'local-unsent-wins':null,validated:copy(rec)};
       meta.add(row);entries.push(row);
      }
      const end=validated.length?validated[validated.length-1].seq:start;
      meta.put({key:cursorKey(before),kind:'e7b-paired-cursor-dev-v1',accountId:before.accountId,
        deviceKey:before.deviceKey,candidateKey:before.candidateKey,headVersion:before.headVersion,seq:end});
      planned={stored:validated.length,quarantined,pairedSeq:end,entries};
     }catch(e){try{tx.abort();}catch(_){}reject(e);}
    };
    cr.onsuccess=process;hr.onsuccess=process;or.onsuccess=process;mr.onsuccess=process;
    tx.oncomplete=()=>resolve(planned);
    tx.onabort=()=>reject(tx.error||Error('E7b paired IndexedDB transaction aborted'));
    tx.onerror=()=>{};
   });
  }finally{db.close();}
  // If sign-out occurs AFTER transaction commits, the account-scoped durable
  // data stays saved, but nothing is offered to Continue for the new identity.
  assert(Wire.sameIdentity(before,current()),'identity-changed-after-durable-receive');
  return {stored:report.stored,quarantined:report.quarantined,pairedSeq:report.pairedSeq};
 }
 async function listCommittedReceiverFrames(){
  const before=current(),db=await openExisting();let entries;
  try{
   entries=await new Promise((resolve,reject)=>{
    const tx=db.transaction('meta','readonly');const r=tx.objectStore('meta').getAll();
    r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);
    tx.onabort=()=>reject(tx.error||Error('E7b paired read transaction aborted'));
   });
  }finally{db.close();}
  assert(Wire.sameIdentity(before,current()),'identity-changed-while-reading-inbox');
  const prefix=frameKey(before,0).slice(0,-20),latest=new Map();
  for(const row of entries){
   if(!clean(row?.key).startsWith(prefix)||row.kind!=='e7b-paired-received-dev-v1')continue;
   if(row.accountId!==before.accountId||row.deviceKey!==before.deviceKey||
      row.candidateKey!==before.candidateKey||row.headVersion!==before.headVersion)fail('persisted-owner-mismatch');
   const prev=latest.get(row.contextId);
   if(!prev||row.seq>prev.seq)latest.set(row.contextId,row);
  }
  // Trusted metadata below originates from actual persisted receiver records,
  // not from an untrusted server response or a synthetic resume stub.
  return [...latest.values()].filter(row=>row.state==='committed').sort((a,b)=>a.seq-b.seq).map(row=>Wire.toContinueFrame(row.validated,{
   source:'e7b-idb-paired-receiver-commit-v1',durable:true,accountId:row.accountId,
   candidateKey:row.candidateKey,seq:row.seq,contextId:row.contextId,sessionId:row.sessionId}));
 }
 async function readCursor(){
  const before=current(),db=await openExisting();
  try{
   const result=await new Promise((resolve,reject)=>{
    const tx=db.transaction('meta','readonly');const req=tx.objectStore('meta').get(cursorKey(before));
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    tx.onabort=()=>reject(tx.error||Error('cursor-transaction-aborted'));
   });
   assert(Wire.sameIdentity(before,current()),'account-changed-reading-cursor');
   return result?.seq||0;
  }finally{db.close();}
 }
 return Object.freeze({ingestPull,listCommittedReceiverFrames,readCursor,prepareEmptyJournalForExplicitReceive});
}
return Object.freeze({make,DB_NAME,META_PREFIX});
});
