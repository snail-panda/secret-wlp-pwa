/* WLP Stage7 / existing E7a -> G4: durable selected-card provenance.
 * SOURCE OFF. A receipt is never by itself transport permission. It binds
 * previously verified E7a cards to the *actual* Journal enrollment and is
 * re-verified with a fresh Cloud/Local card proof before every upload.
 * It never opens a missing DB, alters v400 Outbox, or sends network requests.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7E7aPairedWitness=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const DB='wlp-study-context-sync-v1', PREFIX='s7:e7a:card-proof:v1:';
 const SHA=/^[0-9a-f]{64}$/i;
 const fail=why=>{throw Error('E7a paired witness HOLD: '+why);};
 const str=x=>String(x??'').trim();
 const equal=(a,b,keys)=>keys.every(k=>str(a?.[k])===str(b?.[k]));
 const words=x=>Array.isArray(x)&&x.length>0&&x.length<=1000&&x.every(v=>/^\d+$/.test(str(v)))&&new Set(x.map(str)).size===x.length;
 const identityKeys=['accountId','deviceKey','candidateKey','headVersion','generation'];
 const accountKeys=['accountId','deviceKey','candidateKey','headVersion'];
 const sameIds=(a,b)=>equal(a,b,accountKeys);
 const copy=x=>JSON.parse(JSON.stringify(x));
 function receipt({decision,proof,context,identity}={}){
  if(decision?.writer!=='g4-journal-candidate'||decision.enrollmentCommitted!==false||decision.cloudWriteAuthorized!==false)
   fail('new-session-candidate-required');
  if(!identity?.verified||!sameIds(identity,decision)||!sameIds(identity,proof))fail('verified-owner-changed');
  if(!SHA.test(str(decision.materializedManifest))||!SHA.test(str(proof.materializedManifest))||
    decision.materializedManifest!==proof.materializedManifest||!SHA.test(str(proof.selectedCardWitnessHash))||
    decision.selectedCardWitnessHash!==proof.selectedCardWitnessHash)fail('card-fingerprint-changed');
  const ids=context?.source?.wordIds;
  if(context?.practiceMode!=='standard'||context?.status!=='active'||
    context?.sessionRef?.sessionId!==decision.sessionId||!str(context.contextId)||
    !words(ids)||proof.cardCount!==ids.length||decision.cardCount!==ids.length)fail('source-session-or-order-mismatch');
  return Object.freeze({key:PREFIX+context.contextId,kind:'stage7-existing-e7a-card-proof-v1',
    contextId:context.contextId,sessionId:decision.sessionId,wordIds:ids.map(str),
    accountId:identity.accountId,deviceKey:identity.deviceKey,candidateKey:identity.candidateKey,
    headVersion:identity.headVersion,generation:identity.generation,
    source:'existing-e7a-authority',materializedManifest:proof.materializedManifest,
    selectedCardWitnessHash:proof.selectedCardWitnessHash,cardCount:ids.length});
 }
 function verify({record,enrollment,sessionLink,head,identity,proof,context,needHead=false}={}){
  if(record?.kind!=='stage7-existing-e7a-card-proof-v1'||record?.source!=='existing-e7a-authority'||
    record.key!==PREFIX+record.contextId||!identity?.verified||!equal(record,identity,identityKeys))fail('receipt-owner-mismatch');
  if(!SHA.test(str(record.materializedManifest))||!SHA.test(str(record.selectedCardWitnessHash))||
    proof?.ready!==true||proof?.readOnly!==true||!sameIds(record,proof)||
    proof.materializedManifest!==record.materializedManifest||
    proof.selectedCardWitnessHash!==record.selectedCardWitnessHash||proof.pendingOutbox!==0)
    fail('fresh-selected-card-proof-mismatch');
  if(!words(record.wordIds)||record.cardCount!==record.wordIds.length||proof.cardCount!==record.cardCount||
    context?.contextId!==record.contextId||context?.sessionRef?.sessionId!==record.sessionId||
    JSON.stringify(context?.source?.wordIds?.map(str))!==JSON.stringify(record.wordIds))fail('context-card-order-changed');
  if(enrollment?.accountBoundAtStart!==true||enrollment?.transportEligible!==true||
    !equal(record,enrollment,identityKeys)||enrollment.sessionId!==record.sessionId||
    enrollment.contextId!==record.contextId||
    JSON.stringify(enrollment.wordIds)!==JSON.stringify(record.wordIds)||
    sessionLink?.contextId!==record.contextId||sessionLink?.accountId!==identity.accountId||
    sessionLink?.deviceKey!==identity.deviceKey)fail('durable-enrollment-owner-mismatch');
  if(needHead&&(!head||!equal(head,identity,accountKeys)||
     head.contextId!==record.contextId||head.sessionId!==record.sessionId))fail('journal-head-not-bound');
  return Object.freeze({verified:true,contextId:record.contextId,sessionId:record.sessionId,
   wordIds:[...record.wordIds],selectedCardWitnessHash:record.selectedCardWitnessHash});
 }
 async function existingDb(indexedDB){
  if(!indexedDB?.open||typeof indexedDB.databases!=='function')fail('indexeddb-enumeration-unavailable');
  const found=await indexedDB.databases();
  if(!found.some(x=>x.name===DB))fail('journal-database-absent');
  return new Promise((resolve,reject)=>{const r=indexedDB.open(DB);let created=false;
   r.onupgradeneeded=()=>{created=true;try{r.transaction.abort();}catch(_){};};
   r.onsuccess=()=>{if(created){r.result.close();reject(Error('unexpected-journal-creation'));return;}
    if(!['meta','heads','revisions','outbox'].every(s=>r.result.objectStoreNames.contains(s))){r.result.close();reject(Error('incomplete-journal'));return;}resolve(r.result);};
   r.onerror=()=>reject(r.error||Error('journal-open-failed'));
   r.onblocked=()=>reject(Error('journal-locked'));
  });
 }
 function req(store,key){return store.get(key);}
 async function seal({indexedDB,decision,proof,context,identity,inspectFresh}={}){
  if(typeof inspectFresh!=='function')fail('independent-reinspection-missing');
  const before=receipt({decision,proof,context,identity});
  const fresh=await inspectFresh(before.wordIds);
  // The second proof is recomputed after the durable Journal enrollment.
  if(fresh?.ready!==true||fresh?.selectedCardWitnessHash!==before.selectedCardWitnessHash||
     fresh?.materializedManifest!==before.materializedManifest||!sameIds(fresh,before))fail('source-changed-after-enrollment');
  const db=await existingDb(indexedDB);const id=before;
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads'],'readwrite'),meta=tx.objectStore('meta');
   const requests={r:req(meta,id.key),e:req(meta,'e7b:enrolled:'+id.contextId),
     l:req(meta,'e7b:session:'+id.sessionId)};
   let n=0,reads={},answer=null,error=null;
   for(const [k,r] of Object.entries(requests)){
    r.onsuccess=()=>{reads[k]=r.result||null;if(++n===3){try{
      if(reads.r)fail('receipt-already-exists');
      verify({record:id,enrollment:reads.e,sessionLink:reads.l,identity,proof:fresh,context});
      meta.add(copy(id));answer=Object.freeze({sealed:true,sessionId:id.sessionId,contextId:id.contextId});
     }catch(e){error=e;try{tx.abort();}catch(_){}}}};
    r.onerror=()=>{error=r.error;try{tx.abort();}catch(_){}};
   }
   tx.oncomplete=()=>resolve(answer);
   tx.onabort=()=>reject(error||tx.error||Error('receipt-transaction-aborted'));
   tx.onerror=()=>{};
  });}finally{db.close();}
 }
 // Source verifier must reconstruct actual selected TSV rows for the SAVED
 // Journal source, not receive arbitrary caller-provided Word IDs.
 async function verifyPending({indexedDB,identity,inspectFresh,studyRowsForWordIds,legacyOutboxCount}={}){
  if(!identity?.verified||typeof inspectFresh!=='function'||typeof studyRowsForWordIds!=='function'||
      typeof legacyOutboxCount!=='function')fail('trusted-transport-prerequisites-missing');
  if(await legacyOutboxCount()!==0)fail('v400-outbox-pending');
  const db=await existingDb(indexedDB);let all;
  try{all=await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads','revisions','outbox'],'readonly'),a={};let completed=0;
   for(const name of ['meta','heads','revisions','outbox']){
    const r=tx.objectStore(name).getAll();r.onsuccess=()=>{a[name]=r.result||[];completed++;};
    r.onerror=()=>{try{tx.abort();}catch(_){}};
   }
   tx.oncomplete=()=>completed===4?resolve(a):reject(Error('journal-snapshot-incomplete'));
   tx.onabort=()=>reject(tx.error||Error('journal-snapshot-aborted'));
   tx.onerror=()=>{};
  });}finally{db.close();}
  const owns=x=>equal(x,identity,accountKeys);
  const pending=all.outbox.filter(x=>owns(x)&&x.transportEligible===true&&
   !['acked','applied','confirmed'].includes(x.status));
  // An active pending action with unknown provenance must NEVER be silently
  // skipped, even when the previous new-Mirror uploader would accept it.
  const result=[];
  for(const out of pending){
   const enroll=all.meta.find(x=>x.key==='e7b:enrolled:'+out.contextId),
    link=all.meta.find(x=>x.key==='e7b:session:'+out.sessionId),
    record=all.meta.find(x=>x.key===PREFIX+out.contextId),
    head=all.heads.find(x=>x.contextId===out.contextId&&owns(x)),
    revisions=all.revisions.filter(x=>x.actionId===out.actionId&&owns(x));
   if(!record||revisions.length!==1||!head||!revisions[0].context||
      revisions[0].sessionId!==out.sessionId)fail('pending-action-without-e7a-provenance');
   const context=revisions[0].context;
   const rows=studyRowsForWordIds(record.wordIds);
   if(!Array.isArray(rows)||rows.length!==record.wordIds.length||
      rows.some((x,i)=>str(x?.WordID)!==record.wordIds[i]))fail('current-tsv-rows-unavailable');
   const proof=await inspectFresh(record.wordIds,rows);
   result.push(verify({record,enrollment:enroll,sessionLink:link,
     head,identity,proof,context,needHead:true}));
  }
  if(await legacyOutboxCount()!==0)fail('v400-outbox-changed-during-scan');
  return Object.freeze({ready:true,mode:'existing-e7a-authority',pendingCount:result.length,
    verified:result.map(x=>x.sessionId)});
 }
 return Object.freeze({receipt,verify,seal,verifyPending});
});
