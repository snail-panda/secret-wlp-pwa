/* G4-1 Stage7. GENERAL partial Standard Resume — READ ONLY PRE-FLIGHT.
 * Not an installer or an enrollment/restoration writer. The verified G3-B 2/4
 * resume implementation is unchanged and not invoked by this module.
 * A successful result is evidence for a *future* writer connection, NOT an
 * authorization to write, resume, project, upload, or mark an Action ACKed.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4GeneralResumeReadOnlyPreflight=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const fail=m=>{throw Error('G4 GENERAL RESUME HOLD: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
const cp=x=>JSON.parse(JSON.stringify(x));
const fields=['accountId','candidateKey','deviceKey','headVersion','generation'];
const validId=x=>x?.verified===true&&typeof x.accountId==='string'&&!!x.accountId&&
 typeof x.deviceKey==='string'&&!!x.deviceKey&&typeof x.candidateKey==='string'&&!!x.candidateKey&&
 typeof x.generation==='string'&&!!x.generation&&Number.isSafeInteger(x.headVersion)&&x.headVersion>=1;
const same=(a,b)=>validId(a)&&validId(b)&&fields.every(k=>a[k]===b[k]);
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
 Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('IDB read failed'));});
const hex=u=>Array.from(new Uint8Array(u),n=>n.toString(16).padStart(2,'0')).join('');
async function digest(cryptoImpl,x){return hex(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(x)))));}
async function readOnlyExisting(indexedDB,name,handler){
 check(typeof indexedDB.databases==='function','database enumeration unavailable; refusing implicit creation');
 const dbs=await indexedDB.databases();
 check(dbs.some(d=>d?.name===name),'Journal DB absent (do not create during Resume)');
 const db=await new Promise((resolve,reject)=>{
  const r=indexedDB.open(name);let upgraded=false;
  r.onupgradeneeded=()=>{upgraded=true;try{r.transaction.abort();}catch(_){}};
  r.onerror=()=>reject(r.error||Error('Journal open failed'));
  r.onblocked=()=>reject(Error('Journal open blocked'));
  r.onsuccess=()=>upgraded?(r.result.close(),reject(Error('DB upgrade forbidden'))):resolve(r.result);
 });
 try{return await handler(db);}finally{db.close();}
}
async function inspect({indexedDB,cryptoImpl,identityNow,verifyFreshOnline,readOriginal,wireApi,
 contextId,sessionId,dbName='wlp-study-context-sync-v1'}={}){
 check(indexedDB?.open&&cryptoImpl?.subtle&&typeof identityNow==='function'&&
  typeof verifyFreshOnline==='function'&&typeof readOriginal==='function'&&
  typeof wireApi?.validateBodies==='function','explicit trusted dependencies required');
 check(typeof contextId==='string'&&contextId.length>0&&typeof sessionId==='string'&&sessionId.length>0,
  'exact existing IDs required');
 check(dbName==='wlp-study-context-sync-v1','unexpected Journal database');
 const before=cp(identityNow());check(validId(before),'unverified initial Owner/Authority');
 const fresh=await verifyFreshOnline();
 check(same(before,fresh)&&same(before,identityNow()),'fresh authenticated proof does not match Owner/Authority');
 const original=await readOriginal(sessionId,contextId);
 check(original?.context?.contextId===contextId&&original?.session?.sessionId===sessionId,
  'original local Session/Context missing');
 const context=cp(original.context),session=cp(original.session);
 check(context.practiceMode==='standard'&&context.sessionRef?.type==='standard'&&
  context.sessionRef?.sessionId===sessionId,'non-standard or mismatched Context');
 check(context.status==='incomplete'&&['incomplete','ended-early'].includes(session.status),
  'only a prior durable incomplete Session may resume');
 check(Array.isArray(session.experiences)&&session.experiences.length>0&&
  session.experienceCount===session.experiences.length&&
  session.experienceCount<session.plannedExperienceCount,
  'partial Session must have committed work and unfinished items');
 wireApi.validateBodies(context,session);
 // Current G3 local Journal stores only one known source order and committed
 // pair; no hidden within-card work is inferred or silently adopted.
 const prefix=before.accountId+'|'+before.deviceKey+'|'+before.candidateKey;
 const headKey=prefix+'|'+contextId;
 const result=await readOnlyExisting(indexedDB,dbName,async db=>{
  for(const name of ['meta','heads','revisions','outbox','conflicts'])
   check(db.objectStoreNames.contains(name),'Journal store missing: '+name);
  const tx=db.transaction(['meta','heads','revisions','outbox','conflicts'],'readonly');
  const m=tx.objectStore('meta'),h=tx.objectStore('heads'),r=tx.objectStore('revisions'),o=tx.objectStore('outbox'),c=tx.objectStore('conflicts');
  const [binding,sessionBinding,head,revisions,outbox,conflicts]=await Promise.all([
   request(m.get('e7b:enrolled:'+contextId)),request(m.get('e7b:session:'+sessionId)),
   request(h.get(headKey)),request(r.getAll()),request(o.getAll()),request(c.getAll())
  ]);
  check(binding?.accountBoundAtStart===true&&binding?.transportEligible===true&&
   binding.contextId===contextId&&binding.sessionId===sessionId&&
   fields.every(k=>binding[k]===before[k]),'durable original enrollment/Owner mismatch');
  check(sessionBinding?.contextId===contextId&&sessionBinding?.accountId===before.accountId&&
   sessionBinding?.deviceKey===before.deviceKey&&sessionBinding?.generation===before.generation,
   'durable Session enrollment mismatch');
  check(JSON.stringify(binding.wordIds)===JSON.stringify(context.source.wordIds.map(String)),
   'enrolled WID source/order changed');
  check(head?.key===headKey&&head.contextId===contextId&&head.sessionId===sessionId&&
   fields.every(k=>head[k]===before[k])&&typeof head.pairHash==='string','Head owner/context invalid');
  const actualHash=await digest(cryptoImpl,{context,session});
  const headHash=await digest(cryptoImpl,{context:head.context,session:head.session});
  check(actualHash===head.pairHash&&headHash===head.pairHash,
   'current WLP projection or Head snapshot diverges from durable Journal');
  check(!conflicts.some(x=>x?.contextId===contextId&&x?.sessionId===sessionId&&
   x?.accountId===before.accountId&&x?.candidateKey===before.candidateKey&&x?.deviceKey===before.deviceKey),
   'unresolved or historical Conflict for this pair; manual review required');
  const matching=revisions.filter(x=>x?.contextId===contextId&&x?.sessionId===sessionId&&
   x?.pairHash===head.pairHash&&x?.g3CandidateFirst===true&&
   fields.every(k=>x[k]===before[k]));
  check(matching.length===1,'expected a unique candidate-first Revision matching Head');
  const revision=matching[0];
  check(revision.key===headKey+'|'+revision.actionId&&
   await digest(cryptoImpl,{context:revision.context,session:revision.session})===actualHash,
   'Revision snapshot/hash mismatch');
  const pending=outbox.filter(x=>x?.actionId===revision.actionId&&x?.pairHash===head.pairHash&&
   x?.contextId===contextId&&x?.sessionId===sessionId&&
   fields.every(k=>x[k]===before[k]));
  // ACKed/compacted outbox requires a separate attested canonical base. Current
  // candidate is local-pending only; refusing a guessed parent is deliberate.
  check(pending.length===1&&pending[0].status==='pending'&&
   typeof pending[0].projectionVerifiedAt==='string'&&!!pending[0].projectionVerifiedAt,
   'current Head lacks projection-verified pending Action (ACK path not yet supported)');
  check(same(before,identityNow()),'Owner changed before completing read-only proof');
  return Object.freeze({verified:true,readOnly:true,contextId,sessionId,actionId:revision.actionId,
   parentHash:head.pairHash,completedCount:session.experienceCount,
   plannedCount:session.plannedExperienceCount,sourceType:context.sourceType});
 });
 check(same(before,identityNow()),'Owner changed after Journal read');
 return result;
}
return Object.freeze({inspect,stable,digest});
});
