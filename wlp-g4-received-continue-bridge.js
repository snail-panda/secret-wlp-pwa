/* WLP G4-1 — reuse E7b durable receiver -> Continue bridge.
 * Source integration, no auto-start, no transport, no legacy writes.
 * Entry point is explicitly approved by the owning G4 Study Hub bootstrap.
 * The trusted received frame ALWAYS comes from the existing durable Inbox,
 * never directly from a caller-supplied network body.
 */
(function(root,factory){const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4ReceivedContinueBridge=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const fail=msg=>{throw Error('G4 received Continue HOLD: '+msg);};
const check=(ok,msg)=>{if(!ok)fail(msg);};
const ACCOUNT_KEYS=['accountId','deviceKey','candidateKey','headVersion','generation'];
function sameLease(a,b){return a?.verified===true&&b?.verified===true&&
 ACCOUNT_KEYS.every(k=>String(a[k])===String(b[k]));}
function existingDb(indexedDB){return new Promise((resolve,reject)=>{
 let missing=false;const r=indexedDB.open('wlp-study-context-sync-v1',1);
 r.onupgradeneeded=()=>{missing=true;try{r.transaction.abort();}catch(_){}};
 r.onerror=()=>reject(r.error||Error('Journal IndexedDB cannot be opened'));
 r.onblocked=()=>reject(Error('Journal IndexedDB blocked'));
 r.onsuccess=()=>{
  const db=r.result;
  if(missing){db.close();reject(Error('Local Journal not installed'));return;}
  if(!['heads','outbox','meta'].every(n=>db.objectStoreNames.contains(n))){
   db.close();reject(Error('Local Journal stores are incomplete'));return;
  }
  resolve(db);
 };
});}
async function inventory({indexedDB,identityNow,storage}){
 const id=identityNow();check(id?.verified===true,'Verified account is unavailable');
 const db=await existingDb(indexedDB);
 let rows;
 try{rows=await new Promise((resolve,reject)=>{
  const tx=db.transaction(['heads','outbox','meta','revisions'],'readonly');
  const result={};let seen=0;
  for(const name of ['heads','outbox','meta','revisions']){
   const r=tx.objectStore(name).getAll();
   r.onsuccess=()=>{result[name]=r.result||[];seen++;};
   r.onerror=()=>{try{tx.abort();}catch(_){}};
  }
  tx.oncomplete=()=>seen===4?resolve(result):reject(Error('Incomplete local inventory'));
  tx.onabort=()=>reject(tx.error||Error('Local inventory transaction failed'));
  tx.onerror=()=>{};
 });}finally{db.close();}
 check(sameLease(id,identityNow()),'Account changed during pending inventory');
 const own=r=>r?.accountId===id.accountId && r?.candidateKey===id.candidateKey;
 const relevant=[];
 for(const h of rows.heads){if(own(h)&&h.hasPending===true)relevant.push(h);}
 for(const o of rows.outbox){
  if(own(o)&&!['acked','confirmed','applied'].includes(o.status))relevant.push(o);
 }
 for(const m of rows.meta){
  if(!own(m))continue;
  if((m.kind==='e7b-remote-staged-revision-v1'&&m.status!=='acked')||
    (m.kind==='e7b-remote-prepared-revise-action-v1'&&(!m.ackedAt||!m.overlayRebasedAt)))relevant.push(m);
 }
 const ctx=[...new Set(relevant.map(r=>String(r.contextId||'').trim()).filter(Boolean))];
 const sess=[...new Set(relevant.map(r=>String(r.sessionId||'').trim()).filter(Boolean))];
 // The original G4 writer saved the actual paired Head, enrollment and
 // ACKed Outbox. These are stronger provenance than untrusted localStorage.
 // Permit a RETURN to origin ONLY when the original projection still matches
 // this trusted immutable record, no unsent work exists, and its ACK is real.
 const original=key=>{try{const a=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(a)?a:[];}catch(_){return [];}};
 const contexts=original('wlp:study-contexts:v1'),sessions=original('wlp:studyq-sessions:v1');
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
 const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
 const ownsFull=r=>r&&r.accountId===id.accountId&&r.deviceKey===id.deviceKey&&
  r.candidateKey===id.candidateKey&&Number(r.headVersion)===Number(id.headVersion);
 const originOwned=[];
 for(const binding of rows.meta){
  if(!String(binding?.key||'').startsWith('e7b:enrolled:')||!ownsFull(binding)||
     binding.accountBoundAtStart!==true||binding.transportEligible!==true)continue;
  const cid=binding.contextId,sid=binding.sessionId;
  if(ctx.includes(cid)||sess.includes(sid))continue;
  const matches=rows.heads.filter(h=>ownsFull(h)&&h.contextId===cid&&h.sessionId===sid);
  if(matches.length!==1)continue;
  const head=matches[0];
  if(head.hasPending!==false||!Number.isSafeInteger(head.serverRevision)||head.serverRevision<1||
     !head.serverToken||!head.pairHash)continue;
  const outs=rows.outbox.filter(o=>ownsFull(o)&&o.contextId===cid);
  if(!outs.length||outs.some(o=>o.sessionId!==sid||o.status!=='acked'))continue;
  const revs=rows.revisions.filter(r=>ownsFull(r)&&r.contextId===cid);
  if(revs.length!==outs.length||!revs.some(r=>r.pairHash===head.pairHash&&r.ackedAt))continue;
  const cs=contexts.filter(c=>c?.contextId===cid),ss=sessions.filter(s=>s?.sessionId===sid);
  if(cs.length!==1||ss.length!==1||!equal(ss[0],head.session)||
     cs[0]?.sessionRef?.sessionId!==sid||cs[0]?.status!==head.context?.status||
     !equal(cs[0]?.progress,head.context?.progress)||
     !equal(cs[0]?.source?.wordIds,head.context?.source?.wordIds))continue;
  originOwned.push({contextId:cid,sessionId:sid,serverRevision:head.serverRevision,
    serverToken:head.serverToken});
 }
 check(sameLease(id,identityNow()),'Owner changed during original Journal proof');
 return Object.freeze({contextIds:ctx,sessionIds:sess,originOwned});
}
function make({root,indexedDB,storage,localLease,transport,modules}={}){
 check(root&&indexedDB?.open&&storage?.getItem&&storage?.setItem,'Existing WLP browser required');
 check(localLease?.localOnly===true&&typeof localLease.identityNow==='function'&&
       typeof localLease.verifyIdentity==='function','Account-bound G4 local lease missing');
 check(typeof transport?.listCommittedReceiverFrames==='function',
  'Existing E7b atomic receiver adapter missing');
 const m=modules||{
  runtime:root.WLPE7bContinueRuntime,
  stage:root.WLPE7bRemoteRevisionJournalDEV,
  wire:root.WLPE7bPairedWireDEV
 };
 check(typeof m.runtime?.initialize==='function'&&typeof m.stage?.make==='function'&&
  typeof m.wire?.validateBodies==='function','Proven E7b Continue modules missing');
 let initialized=false,trustedOverlay=null;
 const identityNow=()=>{
  const id=localLease.identityNow();
  check(id?.verified===true&&id.accountId===localLease.accountId&&
   id.deviceKey===localLease.deviceKey&&id.candidateKey===localLease.candidateKey&&
   Number(id.headVersion)===Number(localLease.headVersion),'Writer/Receiver account mismatch');
  return id;
 };
 const remoteStage=m.stage.make({indexedDB,storage,identityNow,approvedStage:true});
 async function initialize({approved=false}={}){
  check(approved===true,'Continue enrollment requires reviewed build approval');
  check(!initialized,'Continue bridge already initialized in this tab');
  check(!root.WLPE7bContinueTrustedBinding,'Another Continue owner is already bound');
  const first=identityNow(),proved=await localLease.verifyIdentity();
  check(sameLease(first,proved)&&sameLease(first,identityNow()),
   'Continue owner changed during authenticated proof');
  const binding=Object.freeze({
   getVerifiedIdentitySync:identityNow,
   listCommittedReceiverFrames:async()=>transport.listCommittedReceiverFrames({approved:true}),
   listLocalPendingIds:async()=>inventory({indexedDB,identityNow,storage}),
   capturePairedRevisionDurably:(pair,owner)=>remoteStage.capturePairedRevisionDurably(pair,owner),
   validatePairedBodies:(ctx,sess)=>m.wire.validateBodies(ctx,sess),
   onOverlayReady:(overlay)=>{trustedOverlay=overlay;}
  });
  root.WLPE7bContinueTrustedBinding=binding;
  let outcome;
  try{outcome=await m.runtime.initialize();}
  catch(err){delete root.WLPE7bContinueTrustedBinding;throw err;}
  if(outcome?.offline===true){
   // A brand-new mirror may have no Journal stores yet. Do not advertise
   // a receiver as ready, and do not stop its independent local-only Writer.
   m.runtime.reset?.();delete root.WLPE7bContinueTrustedBinding;
   return Object.freeze({ready:false,deferred:true,reason:outcome.reason||'Inbox not initialized'});
  }
  if(outcome?.ready!==true){
   m.runtime.reset?.();delete root.WLPE7bContinueTrustedBinding;
   fail(String(outcome?.reason||'receiver overlay not ready'));
  }
  // Attach the previously proven remote REVISE/ACK writer to the SAME
  // overlay instance just published by E7b Continue. This never sends RPC.
  try{
   check(trustedOverlay&&typeof transport.bindReceivedOverlay==='function',
    'Remote ACK transport cannot bind trusted received overlay');
   transport.bindReceivedOverlay({overlay:trustedOverlay,approved:true});
  }catch(error){
   m.runtime.reset?.();delete root.WLPE7bContinueTrustedBinding;
   trustedOverlay=null;throw error;
  }
  initialized=true;
  return Object.freeze({ready:true,accepted:outcome.accepted||[],
    preserved:outcome.preserved||[],blocked:outcome.blocked||[],
    overlay:m.runtime,transportEnabled:false});
 }
 // Confirm the ORIGINAL E7b remote revision is durably present in the
 // existing IDB Journal before Study Hub advances to another card. This is
 // not a Cloud ACK and does not make a staged revision transport-eligible.
 async function stageRemoteRevision({contextId,localRevision}={}){
  check(initialized,'Verified received Continue was not enrolled');
  check(typeof contextId==='string'&&contextId.trim()&&Number.isSafeInteger(localRevision)&&localRevision>0,
   'Invalid remote revision for durable staging');
  const before=identityNow();
  const proof=await localLease.verifyIdentity();
  check(sameLease(before,proof)&&sameLease(before,identityNow()),
   'Receiver owner changed before durable staging');
  const saved=await remoteStage.stagePending(contextId,localRevision);
  check(saved && (saved.status==='staged'||saved.status==='already-staged') &&
   saved.localRevision===localRevision && typeof saved.actionId==='string' && saved.actionId,
   'Remote revision was not durably staged');
  check(sameLease(before,identityNow()),'Receiver owner changed after durable staging');
  return Object.freeze({durable:true,actionId:saved.actionId,localRevision});
 }
 return Object.freeze({initialize,stageRemoteRevision,status:()=>({initialized}),
  inspectLocalPending:()=>inventory({indexedDB,identityNow,storage})});
}
return Object.freeze({make,inventory,sameLease});
});
