/* E7b G3 Study Hub-to-Journal candidate-first integration contract.
   No automatic Study Hub listener. NO production writes or Cloud transport.
   Callable explicitly by the isolated browser fixture.
*/
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG3E7bAuthStudyHubBridge=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const valid=(x,msg)=>{if(!x)throw Error('G3 bridge HOLD: '+msg)};
 const clone=x=>JSON.parse(JSON.stringify(x));
 function make({journal,identityNow,projectAfterJournal,afterProjection}={}){
  valid(journal&&typeof journal.captureCandidate==='function','real candidate Journal required');
  valid(typeof identityNow==='function','identity callback required');
  valid(typeof projectAfterJournal==='function','explicit compatibility projection required');
  valid(typeof afterProjection==='function','explicit post-durable notification required');
  const queues=new Map();
  function commit({context,session,contextId,sessionId,parentPairHash,actionId,expectedIdentity}={}){
   valid(contextId&&sessionId&&actionId,'immutable identifiers missing');
   valid(context?.contextId===contextId&&session?.sessionId===sessionId,'candidate mismatch');
   valid(expectedIdentity?.accountId&&expectedIdentity?.deviceKey&&expectedIdentity?.candidateKey,'expected owner missing');
   const key=expectedIdentity.accountId+'|'+expectedIdentity.deviceKey+'|'+contextId;
   // Snapshot immediately: live Study Hub objects may change while IDB awaits.
   const frozen=clone({context,session,contextId,sessionId,parentPairHash,actionId});
   const prev=queues.get(key)||Promise.resolve();
   const job=prev.catch(()=>{}).then(async()=>{
    const now=identityNow();
    for(const f of ['accountId','deviceKey','candidateKey','headVersion','generation'])
     valid(now?.[f]===expectedIdentity[f],'owner/authority changed before commit: '+f);
    // Atomic and idempotent, stores pending or conflict before any projection.
    const result=await journal.captureCandidate(frozen);
    valid(result&&['pending','conflict','unchanged'].includes(result.status),'unexpected Journal result');
    if(result.status==='conflict')return {status:'conflict',durable:true,projected:false,actionId};
    if(result.status==='unchanged')return {status:'unchanged',durable:true,projected:false,actionId};
    if(result.duplicate)return {status:'reconcile-required',duplicate:true,durable:true,projected:false,actionId};
    // Session may only appear in compatibility projection after Journal commit.
    try{await projectAfterJournal(clone(frozen),clone(result));}
    catch(e){return {status:'projection-hold',durable:true,projected:false,actionId,reason:String(e?.message||e)};}
    try{await afterProjection(clone(frozen),clone(result));}
    catch(e){return {status:'notification-hold',durable:true,projected:true,actionId,reason:String(e?.message||e)};}
    return {status:'pending',durable:true,projected:true,actionId};
   });
   queues.set(key,job);void job.finally(()=>{if(queues.get(key)===job)queues.delete(key);}).catch(()=>{});
   return job;
  }
  // Re-apply compatibility projection for an ALREADY-DURABLE CURRENT Action.
  // No call to captureCandidate: this path CANNOT append a new Journal Action.
  // The caller-supplied projectAfterJournal verifier MUST match Head+Revision+Outbox.
  function reconcile({context,session,contextId,sessionId,actionId,expectedIdentity}={}){
   valid(contextId&&sessionId&&actionId,'reconciliation Action identifiers missing');
   valid(context?.contextId===contextId&&session?.sessionId===sessionId,'reconciliation pair mismatch');
   valid(expectedIdentity?.accountId&&expectedIdentity?.deviceKey&&expectedIdentity?.candidateKey,
    'reconciliation owner missing');
   const key=expectedIdentity.accountId+'|'+expectedIdentity.deviceKey+'|'+contextId;
   const snapshot=clone({context,session,contextId,sessionId,actionId});
   const prev=queues.get(key)||Promise.resolve();
   const job=prev.catch(()=>{}).then(async()=>{
    const now=identityNow();
    for(const f of ['accountId','deviceKey','candidateKey','headVersion','generation'])
     valid(now?.[f]===expectedIdentity[f],'identity changed during recovery: '+f);
    const receipt={actionId,status:'pending',durable:true,recovered:true};
    // projectAfterJournal MUST verify the Action is the current Head and its
    // pending Outbox and immutable Revision match. If not, no projection occurs.
    try {await projectAfterJournal(clone(snapshot),clone(receipt));}
    catch(e){return {status:'projection-hold',durable:true,projected:false,
     actionId,reason:String(e?.message||e)};}
    try {await afterProjection(clone(snapshot),clone(receipt));}
    catch(e){return {status:'notification-hold',durable:true,projected:true,
     actionId,reason:String(e?.message||e)};}
    return {status:'pending',durable:true,projected:true,recovered:true,actionId};
   });
   queues.set(key,job);void job.finally(()=>{if(queues.get(key)===job)queues.delete(key);}).catch(()=>{});
   return job;
  }
  return Object.freeze({commit,reconcile});
 }
 return Object.freeze({make});
});
