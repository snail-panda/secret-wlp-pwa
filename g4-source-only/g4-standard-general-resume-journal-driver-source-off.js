/* G4-1 Stage 8: generalized partial-Session Resume candidate.
 * This is an UNPROVEN fork of the original G3-B writer, which remains untouched.
 * Initial gate OFF; no auto-install, Cloud sender, token or permission to Deploy.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.WLPG4GeneralResumeAuthJournalDriverSOURCEOFF=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const check=(yes,msg)=>{if(!yes)throw Error('G3 E7b authenticated driver HOLD: '+msg);};
const clone=x=>JSON.parse(JSON.stringify(x));
const sameId=(a,b)=>['accountId','deviceKey','candidateKey','headVersion','generation'].every(k=>a?.[k]===b?.[k]);
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function make({journal,bridgeApi,identityNow,indexedDB,dbName,projectAfterJournal,afterProjection,randomUUID}={}){
 check(journal?.captureCandidate&&journal?.onContextCreated&&journal?.prepareStart,'actual journal API required');
 check(bridgeApi?.make&&indexedDB?.open&&typeof identityNow==='function','bridge and IDB required');
 check(typeof projectAfterJournal==='function'&&typeof afterProjection==='function','projection/notification callbacks required');
 check(typeof randomUUID==='function','stable UUID generator required');
 const startBySession=new Map();
 const pendingCommit=new Set();
 // The G3 outbox becomes Cloud-eligible only AFTER the original Study Hub
 // compatible projection has been written AND read back successfully.
 async function markProjectionVerified(who,candidate){
  check(sameId(who,identityNow()),'identity changed before projection marker');
  const prefix=who.accountId+'|'+who.deviceKey+'|'+who.candidateKey;
  const headK=prefix+'|'+candidate.contextId;
  const outK=prefix+'|'+candidate.actionId;
  const revK=headK+'|'+candidate.actionId;
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   r.onblocked=()=>reject(Error('Journal marker DB blocked'));});
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(['heads','outbox','revisions'],'readwrite');
   const headStore=tx.objectStore('heads'),outStore=tx.objectStore('outbox'),revStore=tx.objectStore('revisions');
   const got={},reqs={head:headStore.get(headK),out:outStore.get(outK),rev:revStore.get(revK)};
   let count=0,failed=null;
   for(const key of Object.keys(reqs)){
    reqs[key].onsuccess=()=>{
     got[key]=reqs[key].result||null;
     if(++count!==3)return;
     try{
      check(sameId(who,identityNow()),'identity changed in projection marker transaction');
      check(got.head?.contextId===candidate.contextId&&got.head?.sessionId===candidate.sessionId&&
       got.head?.pairHash===got.rev?.pairHash&&got.rev?.pairHash===got.out?.pairHash&&
       got.rev?.actionId===candidate.actionId&&got.out?.actionId===candidate.actionId&&
       got.out?.status==='pending'&&got.rev?.g3CandidateFirst===true&&got.out?.g3CandidateFirst===true,
       'Head advanced or Action changed before compatibility projection marked');
      outStore.put({...got.out,projectionVerifiedAt:got.out.projectionVerifiedAt||new Date().toISOString()});
     }catch(e){failed=e;try{tx.abort();}catch(_){}}
    };
    reqs[key].onerror=()=>{failed=reqs[key].error;try{tx.abort();}catch(_){}};
   }
   tx.oncomplete=()=>resolve(true);
   tx.onabort=()=>reject(failed||tx.error||Error('projection verified marker aborted'));
  });}finally{db.close();}
 }
 const bridge=bridgeApi.make({journal,identityNow,
  projectAfterJournal:async(candidate,receipt)=>{
    // Confirm actual durable action and current Head in one read-only transaction.
    const identity=identityNow();
    const prefix=identity.accountId+'|'+identity.deviceKey+'|'+identity.candidateKey;
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{
      const tx=db.transaction(['heads','outbox','revisions'],'readonly');
      const headK=prefix+'|'+candidate.contextId;
      const [head,out,rev]=await Promise.all([
       request(tx.objectStore('heads').get(headK)),
       request(tx.objectStore('outbox').get(prefix+'|'+candidate.actionId)),
       request(tx.objectStore('revisions').get(headK+'|'+candidate.actionId))]);
      check(out?.status==='pending'&&head?.pairHash===out.pairHash&&rev?.pairHash===out.pairHash&&
        rev?.actionId===candidate.actionId&&out.actionId===candidate.actionId,
        'candidate no longer the verified durable Head; reconcile first');
      const s=startBySession.get(candidate.sessionId);
      if(receipt?.recovered===true){
       // An explicitly reverified durable Action may be repaired after a reload,
       // when there is no longer any session enrollment in this tab's memory.
       check(!s||(s.contextId===candidate.contextId&&sameId(s.identity,identity)),
        'another live Session binding owns this Context');
      }else{
       check(s&&s.contextId===candidate.contextId&&sameId(s.identity,identity),
        'candidate owner/context changed');
       s.durablePairHash=head.pairHash; // not trusted as new parent until projection succeeds
      }
      await projectAfterJournal(clone(candidate),clone(receipt));
      await markProjectionVerified(identity,candidate);
    }finally{db.close();}
  },afterProjection:async(candidate,receipt)=>{await afterProjection(clone(candidate),clone(receipt));}});
 async function verifyForNewStarts(){return journal.verifyForNewStarts();}
 function prepareStart(sessionId,sourceInfo){
  check(!startBySession.has(sessionId),'session started twice');
  const ok=journal.prepareStart(sessionId,sourceInfo);
  if(ok) startBySession.set(sessionId,{identity:clone(identityNow()),contextId:null,parentHash:null,enrollment:null,held:false,durablePairHash:null});
  return ok;
 }
 function onContextCreated(context){
  const sid=context?.sessionRef?.sessionId, s=startBySession.get(sid);
  check(s&&!s.enrollment,'unprepared or duplicate Context enrollment');
  s.contextId=context.contextId;
  s.enrollment=Promise.resolve().then(()=>journal.onContextCreated(clone(context))).then(res=>{
   check(res?.enrolled===true,'durable enrollment not verified');return res;
  }).catch(err=>{s.held=true;throw err;});
  return s.enrollment;
 }
 async function commit({context,session,contextId,sessionId}={}){
  const s=startBySession.get(sessionId);
  check(s&&s.contextId===contextId&&s.enrollment,'candidate not enrolled');
  check(!s.held&&!pendingCommit.has(sessionId),'unresolved or concurrent candidate');
  check(sameId(s.identity,identityNow()),'owner/generation changed');
  check(context?.contextId===contextId&&session?.sessionId===sessionId,'candidate identity mismatch');
  pendingCommit.add(sessionId);
  try {
   await s.enrollment; // enrollment may still be running after Study Hub start
   check(!s.held&&sameId(s.identity,identityNow()),'enrollment / identity changed');
   const actionId=randomUUID(),parentPairHash=s.parentHash;
   // No automatic retry with a new ID after ambiguous errors. Manual reconciliation required.
   const receipt=await bridge.commit({context:clone(context),session:clone(session),contextId,sessionId,
      parentPairHash,actionId,expectedIdentity:clone(s.identity)});
   if(receipt?.status==='pending'&&receipt.durable&&receipt.projected&&s.durablePairHash){
      s.parentHash=s.durablePairHash;s.durablePairHash=null;
      return {status:'pending',durable:true,projected:true,actionId};
   }
   // unchanged / duplicates / conflicts / projection failures are NOT success in this pilot
   s.held=true;
   return {...receipt,projected:false,durable:receipt?.durable===true};
  }catch(e){s.held=true;throw e;}
  finally{pendingCommit.delete(sessionId);}
 }
 // Reconcile an ALREADY-DURABLE action, never create/re-send an action.
 // Exact Action ID is required, including across reload. Does not import or
 // force-adopt Cloud Heads and cannot repair an unresolved Conflict.
 async function reconcileProjectedAction({contextId,sessionId,actionId}={}){
  check(typeof actionId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(actionId),
   'explicit existing v4 Action ID required');
  check(typeof contextId==='string'&&!!contextId&&typeof sessionId==='string'&&!!sessionId,
   'exact Context and Session required');
  const who=clone(identityNow());
  check(who.verified===true,'verified account required for local repair');
  const prefix=who.accountId+'|'+who.deviceKey+'|'+who.candidateKey;
  const headKey=prefix+'|'+contextId,actionKey=prefix+'|'+actionId;
  const conflictKey=prefix+'|g3-conflict|'+actionId;
  // No upgrade, no implicit IndexedDB creation, no writes.
  check(typeof indexedDB.databases==='function','DB enumeration is required');
  check((await indexedDB.databases()).some(d=>d.name===dbName),'Journal DB does not exist');
  const db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open(dbName);let upgraded=false;
   r.onupgradeneeded=()=>{upgraded=true;try{r.transaction.abort();}catch(_){}};
   r.onsuccess=()=>upgraded?(r.result.close(),reject(Error('DB upgrade forbidden'))):resolve(r.result);
   r.onerror=()=>reject(r.error||Error('DB read failed'));
   r.onblocked=()=>reject(Error('DB blocked'));
  });
  let candidate;
  try{
   for(const n of ['meta','heads','revisions','outbox','conflicts'])
    check(db.objectStoreNames.contains(n),'missing real Journal store: '+n);
   const tx=db.transaction(['meta','heads','revisions','outbox','conflicts'],'readonly');
   const [binding,head,revision,outbox,conflict]=await Promise.all([
    request(tx.objectStore('meta').get('e7b:enrolled:'+contextId)),
    request(tx.objectStore('heads').get(headKey)),
    request(tx.objectStore('revisions').get(headKey+'|'+actionId)),
    request(tx.objectStore('outbox').get(actionKey)),
    request(tx.objectStore('conflicts').get(conflictKey))]);
   check(!conflict,'Action is already an unresolved Conflict; cannot repair');
   check(binding?.accountBoundAtStart===true&&binding?.transportEligible===true&&
    binding.accountId===who.accountId&&binding.deviceKey===who.deviceKey&&
    binding.candidateKey===who.candidateKey&&binding.headVersion===who.headVersion&&
    binding.sessionId===sessionId&&binding.contextId===contextId,'enrollment/owner mismatch');
   check(head?.contextId===contextId&&head?.sessionId===sessionId&&
    revision?.contextId===contextId&&revision?.sessionId===sessionId&&
    outbox?.contextId===contextId&&outbox?.sessionId===sessionId,
    'exact Head/Revision/Outbox not found');
   check(outbox?.status==='pending'&&outbox?.actionId===actionId&&
    revision?.actionId===actionId&&head?.pairHash===revision?.pairHash&&
    revision?.pairHash===outbox?.pairHash,'Action is no longer current Pending Head');
   check(['accountId','deviceKey','candidateKey','headVersion'].every(k=>
     head[k]===who[k]&&revision[k]===who[k]&&outbox[k]===who[k]),
     'Journal row owner changed');
   const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
   const source=JSON.stringify(stable({context:revision.context,session:revision.session}));
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
   const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
   check(hash===head.pairHash,'stored Action hash invalid');
   check(sameId(who,identityNow()),'Owner changed after read-only reconciliation proof');
   candidate={context:clone(revision.context),session:clone(revision.session),
    contextId,sessionId,actionId};
  }finally{db.close();}
  // The existing projection callback independently RECHECKS Head/Outbox/Revision
  // before writing to legacy WLP. No new Journal action or Cloud send.
  return bridge.reconcile({...candidate,expectedIdentity:who});
 }
 // G4 source-only fork: Resume ONLY a preflight-verified pending partial pair.
 // Never re-enroll, never adopt a Head automatically after a mismatch.
 async function resumeExisting({context,session}={}){
  const identity=identityNow();
  check(context?.contextId&&session?.sessionId,'resume identifiers missing');
  const sid=session.sessionId,cid=context.contextId;
  check(!startBySession.has(sid),'session already bound in this tab');
  check(context.practiceMode==='standard'&&context.sessionRef?.sessionId===sid,'resume context ownership mismatch');
  // G4 extension: a verifiably captured partial Session, not merely G3's 2/4.
  // The caller MUST first run the independent G4 read-only resume preflight
  // with a freshly server-verified identity and original WLP read-back.
  check(['ended-early','incomplete'].includes(session.status)&&context.status==='incomplete'&&
   Number.isSafeInteger(session.experienceCount)&&session.experienceCount>0&&
   Number.isSafeInteger(session.plannedExperienceCount)&&session.experienceCount<session.plannedExperienceCount&&
   session.experiences?.length===session.experienceCount&&
   context.progress?.completedCount===session.experienceCount&&
   context.progress?.totalCount>=session.plannedExperienceCount&&
   context.source?.wordIds?.length>=session.plannedExperienceCount,
   'not a verified incomplete Standard Session');
  // This is intentionally read-only. Opening a new tab cannot project a change.
  check(typeof indexedDB.databases==='function','DB enumeration required to prevent implicit DB creation');
  const found=await indexedDB.databases();
  check(found.some(x=>x.name===dbName),'existing Journal database not found');
  const db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open(dbName);let upgraded=false;
   r.onupgradeneeded=()=>{upgraded=true;try{r.transaction.abort();}catch(_){}};
   r.onsuccess=()=>upgraded?(r.result.close(),reject(Error('resume DB upgrade prohibited'))):resolve(r.result);
   r.onerror=()=>reject(r.error||Error('resume IDB open failed'));
   r.onblocked=()=>reject(Error('resume IDB blocked'));
  });
  let result;
  try{
   const whoKey=identity.accountId+'|'+identity.deviceKey+'|'+identity.candidateKey;
   const headK=whoKey+'|'+cid;
   for(const store of ['heads','outbox','revisions','conflicts'])
    check(db.objectStoreNames.contains(store),'missing Journal store '+store);
   const tx=db.transaction(['heads','outbox','revisions','conflicts'],'readonly');
   const [head,revisions,outbox,conflicts]=await Promise.all([
    request(tx.objectStore('heads').get(headK)),
    request(tx.objectStore('revisions').getAll()),
    request(tx.objectStore('outbox').getAll()),
    request(tx.objectStore('conflicts').getAll())
   ]);
   check(head?.contextId===cid&&head?.sessionId===sid&&head?.deviceKey===identity.deviceKey&&
     head?.accountId===identity.accountId&&head?.candidateKey===identity.candidateKey,'head owner/context/session mismatch');
   // Re-compute the canonical pair Hash; compare with both the Head and local projection.
   const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object')?
    Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
   const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value)))))]
    .map(x=>x.toString(16).padStart(2,'0')).join('');
   const localHash=await hash({context,session});
   check(head.pairHash===localHash&&head.pairHash===await hash({context:head.context,session:head.session}),
    'local WLP projection differs from verified Journal Head');
   check(revisions.some(r=>r.actionId&&r.contextId===cid&&r.sessionId===sid&&r.pairHash===head.pairHash&&r.g3CandidateFirst===true&&
      outbox.some(o=>o.actionId===r.actionId&&o.contextId===cid&&o.sessionId===sid&&o.pairHash===r.pairHash&&o.status==='pending'&&!!o.projectionVerifiedAt)),
    'head has no projection-verified pending candidate-first revision/outbox pair');
   check(!conflicts.some(c=>c.contextId===cid&&c.sessionId===sid),'unresolved conflict for this Session');
   check(sameId(identity,identityNow()),'identity changed during resume verification');
   result={bound:true,sessionId:sid,contextId:cid,parentHash:head.pairHash};
  }finally{db.close();}
  // The real G1 Journal keeps 'enrolled' in per-tab memory. A verified Head
  // alone does NOT authorize captureCandidate() in a freshly opened tab.
  // Restore only the SAME prior durable enrollment using G1's read-only API,
  // after the projected pair has matched our verified immutable Head hash.
  check(typeof journal.restorePreviouslyEnrolled==='function',
   'existing Journal guarded enrollment restore API missing');
  const restored=await journal.restorePreviouslyEnrolled({contextId:cid,sessionId:sid,
   readOriginal:async (requestedSessionId,requestedContextId)=>{
    check(requestedSessionId===sid&&requestedContextId===cid,'Journal requested another original pair');
    return {context:clone(context),session:clone(session)};
   }});
  check(restored?.restored===true&&restored?.contextId===cid,
   'prior durable G1 enrollment was not restored');
  check(sameId(identity,identityNow()),'identity changed during enrollment restoration');
  // State is attached only AFTER Head, Outbox, original pair AND G1 enrollment
  // all verify. Failure cannot accidentally arm Study Hub writes.
  startBySession.set(sid,{identity:clone(identity),contextId:cid,parentHash:result.parentHash,
   enrollment:Promise.resolve({enrolled:true,resumed:true}),held:false,durablePairHash:null,fromResume:true});
  return result;
 }
 return Object.freeze({approved:true,verifyForNewStarts,prepareStart,onContextCreated,resumeExisting,commit,reconcileProjectedAction});
}
return Object.freeze({make});
});
