/* Word List Garden P1-E7b: durable, account-scoped paired upload lane.
 * DEVELOPMENT / HOLD ONLY. Not loaded by WLP pages. Never auto-starts.
 * No localStorage, no SW, no migrations, no legacy auto-adoption.
 * Requires NEW journal revisions explicitly attested as transport eligible.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bPairedUploaderDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const Wire=typeof module==='object'&&module.exports?require('./wlp-e7b-paired-wire-contract-dev.js'):root.WLPE7bPairedWireDEV;
const DB='wlp-study-context-sync-v1';
const PREFIX='e7b:paired-prepared-action:v1:';
const copy=x=>JSON.parse(JSON.stringify(x));
const check=(ok,reason)=>{if(!ok)throw Error('E7b paired uploader blocked: '+reason);};
function same(a,b){return Wire.sameIdentity(a,b);}
function make({indexedDB,identityNow,rpc,approvedPilot=false}={}){
 check(indexedDB&&typeof indexedDB.open==='function','IndexedDB is required');
 check(typeof identityNow==='function','trusted identity callback required');
 check(rpc&&typeof rpc.canonicalCardRows==='function'&&typeof rpc.submitPrepared==='function','authenticated RPC bridge required');
 function identity(){return Wire.normalizeIdentity(identityNow());}
 function open(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){};};
  r.onerror=()=>reject(r.error||Error('journal open error'));
  r.onblocked=()=>reject(Error('journal upgrade blocked'));
  r.onsuccess=()=>{
   const db=r.result;
   if(!['meta','heads','revisions','outbox'].every(s=>db.objectStoreNames.contains(s))){db.close();reject(Error('existing journal stores missing'));return;}
   resolve(db);
  };
 });}
 // All reads (including the owner enrollment record) must come from one IDB snapshot.
 async function snapshot(){
  const before=identity(),db=await open();
  try{
   const result=await new Promise((resolve,reject)=>{
    const tx=db.transaction(['meta','heads','revisions','outbox'],'readonly');const rows={},names=['meta','heads','revisions','outbox'];
    let completed=0;
    for(const n of names){const r=tx.objectStore(n).getAll();r.onsuccess=()=>{rows[n]=r.result||[];completed++;};r.onerror=()=>{try{tx.abort();}catch(_){};};}
    tx.oncomplete=()=>{if(completed!==4)reject(Error('incomplete journal snapshot'));else resolve(rows);};
    tx.onabort=()=>reject(tx.error||Error('journal snapshot aborted'));tx.onerror=()=>{};
   });
   check(same(before,identity()),'identity changed during journal scan');
   return {identity:before,rows:result};
  }finally{db.close();}
 }
 function belongs(row,id){return row.accountId===id.accountId&&row.deviceKey===id.deviceKey&&
     row.candidateKey===id.candidateKey&&row.headVersion===id.headVersion;}
 function eventAttested(rev,out,head,binding,id){
  check(rev.kind==='standard-session-context-pair','unrecognized journal revision');
  check(belongs(rev,id)&&belongs(out,id)&&belongs(head,id)&&belongs(binding,id),'mixed account/device/Authority provenance');
  check(rev.accountBoundAtStart===true&&rev.transportEligible===true&&out.transportEligible===true&&
   binding.accountBoundAtStart===true,'legacy/owner-unverified journal is LOCAL-ONLY');
  check(rev.actionId===out.actionId&&rev.pairHash===out.pairHash&&
   rev.contextId===out.contextId&&rev.sessionId===out.sessionId&&
   rev.contextId===head.contextId&&rev.sessionId===head.sessionId&&
   rev.contextId===binding.contextId&&rev.sessionId===binding.sessionId,'journal pair/action mismatch');
  check(Array.isArray(binding.wordIds)&&JSON.stringify(binding.wordIds)===JSON.stringify(rev.context?.source?.wordIds),
   'enrollment source card order changed');
  check(rev.session&&rev.context,'saved immutable pair body missing');
  Wire.validateBodies(rev.context,rev.session);
 }
 function orderChain(revisions){
  check(revisions.length>0,'no journal revisions');
  const seenAction=new Set(),seenHash=new Set(),parent=new Map();
  for(const r of revisions){
   check(!seenAction.has(r.actionId)&&!seenHash.has(r.pairHash),'duplicate action or ambiguous pair hash');
   seenAction.add(r.actionId);seenHash.add(r.pairHash);
   const ancestor=r.previousPairHash||'';
   check(!parent.has(ancestor),'multiple children for same parent; manual conflict resolution required');
   parent.set(ancestor,r);
  }
  const ordered=[],visited=new Set();let ancestor='';
  while(parent.has(ancestor)){
   const next=parent.get(ancestor);check(!visited.has(next.actionId),'cycle in journal ancestry');
   visited.add(next.actionId);ordered.push(next);ancestor=next.pairHash;
  }
  check(ordered.length===revisions.length,'missing ancestry or branched revision chain');
  return ordered;
 }
 function choose(snap){
  const {identity:id,rows}=snap;
  const groups=new Map();
  for(const out of rows.outbox){
   if(!belongs(out,id))continue;
   // Existing E7b journals deliberately contain Local-only history. Ignore it,
   // never promote it and never allow it to obstruct a distinct NEW enrolled pair.
   // Once a row claims transportEligible===true, every provenance check below
   // remains mandatory; a malformed eligible row still blocks the send.
   if(out.transportEligible!==true)continue;
   if(!groups.has(out.contextId))groups.set(out.contextId,[]);
   groups.get(out.contextId).push(out);
  }
  for(const ctx of [...groups.keys()].sort()){
   const outs=groups.get(ctx),revs=rows.revisions.filter(r=>r.contextId===ctx&&r.accountId===id.accountId),
    heads=rows.heads.filter(h=>h.contextId===ctx&&h.accountId===id.accountId),
    binds=rows.meta.filter(b=>b.key==='e7b:enrolled:'+ctx);
   check(heads.length===1&&binds.length===1,'missing or duplicate enrollment/head');
   const head=heads[0],binding=binds[0];
   check(revs.length===outs.length,'source revision/outbox count mismatch');
   const revsById=new Map(revs.map(r=>[r.actionId,r]));
   for(const out of outs){const rev=revsById.get(out.actionId);check(!!rev,'outbox without immutable revision');eventAttested(rev,out,head,binding,id);}
   const ordered=orderChain(revs);
   let firstPending=-1;
   for(let i=0;i<ordered.length;i++){
    const out=outs.find(o=>o.actionId===ordered[i].actionId);
    if(!['acked','applied','confirmed'].includes(out.status)){firstPending=i;break;}
   }
   if(firstPending<0)continue;
   for(let j=firstPending+1;j<ordered.length;j++)check(!['acked','applied','confirmed'].includes(outs.find(o=>o.actionId===ordered[j].actionId).status),'out-of-order ACK state');
   const rev=ordered[firstPending],out=outs.find(o=>o.actionId===rev.actionId);
   check(rev.previousPairHash===(firstPending?ordered[firstPending-1].pairHash:null),'pending revision ancestry mismatch');
   const base=Number(head.serverRevision??0),token=head.serverToken??null;
   check(Number.isSafeInteger(base)&&base>=0,'invalid persisted server revision');
   check((base===0&&token===null)||(base>0&&typeof token==='string'&&token.length>0),'inconsistent persisted ACK baseline');
   check(base===firstPending,'server ACK baseline differs from contiguous acknowledged revisions');
   const prepared=rows.meta.filter(m=>m.kind==='e7b-paired-prepared-action-v1'&&m.accountId===id.accountId&&
     m.deviceKey===id.deviceKey&&m.candidateKey===id.candidateKey&&m.contextId===ctx&&!m.ackedAt);
   check(prepared.length<=1,'several live prepared actions for same Context');
   if(prepared.length)check(prepared[0].action.action_id===rev.actionId,'previous prepared action must finish before next revision');
   return {id,rev,out,head,binding,base,token,already:prepared[0]||null};
  }
  return null;
 }
 function preparedKey(actionId){return PREFIX+actionId;}
 async function readPreparedAction(actionId){
  const before=identity(),db=await open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('meta','readonly'),req=tx.objectStore('meta').get(preparedKey(actionId));let saved;
   req.onsuccess=()=>{saved=req.result||null;};req.onerror=()=>{try{tx.abort();}catch(_){};};
   tx.oncomplete=()=>{
    try{check(same(before,identity()),'identity changed while reading prepared action');
     check(saved&&belongs(saved,before)&&saved.kind==='e7b-paired-prepared-action-v1','prepared Action missing or owned by another account');resolve(copy(saved));}catch(e){reject(e);}
   };tx.onabort=()=>reject(tx.error||Error('prepared action read aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
 }
 // Note: candidate validation and card fetching happen BEFORE opening the write tx.
 // The transaction then rechecks journal head/revision/outbox/binding atomically.
 async function prepareOne(){
  check(approvedPilot===true,'pilot approval required');
  const snap=await snapshot(),picked=choose(snap);if(!picked)return null;
  if(picked.already)return readPreparedAction(picked.rev.actionId);
  const before=picked.id;
  const ids=picked.rev.context.source.wordIds;
  const cards=await rpc.canonicalCardRows(ids);
  check(same(before,identity()),'identity changed during canonical card lookup');
  const rev={...picked.rev,baseRevision:picked.base,baseToken:picked.token};
  const action=await Wire.buildAction({identity:before,revision:rev,actionId:picked.rev.actionId,cardRows:cards});
  check(same(before,identity()),'identity changed building immutable action');
  const row={key:preparedKey(action.action_id),kind:'e7b-paired-prepared-action-v1',
   accountId:before.accountId,deviceKey:before.deviceKey,candidateKey:before.candidateKey,headVersion:before.headVersion,
   accountBoundAtStart:true,contextId:picked.rev.contextId,sessionId:picked.rev.sessionId,
   pairHash:picked.rev.pairHash,baseRevision:picked.base,baseToken:picked.token,
   headKey:picked.head.key,revisionKey:picked.rev.key,outboxKey:picked.out.key,
   action:copy(action),preparedAt:new Date().toISOString(),ackedAt:null};
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads','revisions','outbox'],'readwrite');
   const m=tx.objectStore('meta'),h=tx.objectStore('heads'),r=tx.objectStore('revisions'),o=tx.objectStore('outbox');
   const vals={};let count=0;
   const got=(key)=>ev=>{vals[key]=ev.target.result||null;if(++count===5)finishRead();};
   const finishRead=()=>{try{
    check(same(before,identity()),'account changed during preparation');
    const {prepared,head,revised,out,binding}=vals;
    check(!prepared,'action was prepared concurrently; retry without rebuilding');
    check(head&&revised&&out&&binding,'journal modified while preparing');
    eventAttested(revised,out,head,binding,before);
    check(revised.pairHash===picked.rev.pairHash&&revised.previousPairHash===picked.rev.previousPairHash&&
     JSON.stringify(revised.session)===JSON.stringify(picked.rev.session)&&JSON.stringify(revised.context)===JSON.stringify(picked.rev.context),
     'revision changed while preparing');
    check(head.serverRevision===picked.head.serverRevision&&head.serverToken===picked.head.serverToken,
      'ACK baseline changed while preparing');
    check(!['acked','applied','confirmed'].includes(out.status),'revision was ACKed while preparing');
    m.add(row);
   }catch(e){failure=e;try{tx.abort();}catch(_){};}}
   let failure=null;
   m.get(row.key).onsuccess=got('prepared');
   h.get(picked.head.key).onsuccess=got('head');
   r.get(picked.rev.key).onsuccess=got('revised');
   o.get(picked.out.key).onsuccess=got('out');
   m.get(picked.binding.key).onsuccess=got('binding');
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||Error('prepare transaction aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(before,identity()),'account changed after durable preparation');
  return readPreparedAction(action.action_id);
 }
 // Same persisted bytes and same Action ID on every retry. RPC performs fresh
 // server identity/Authority verification; no success is claimed until IDB ACK commits.
 async function flushOne(){
  check(approvedPilot===true,'pilot approval required');
  const before=identity();let prepared=await prepareOne();if(!prepared)return {status:'empty'};
  check(same(before,identity()),'account changed before RPC');
  const ack=await rpc.submitPrepared({action:copy(prepared.action),readPreparedAction});
  check(same(before,identity()),'account changed after RPC');
  check(ack.status==='applied'&&ack.actionId===prepared.action.action_id&&ack.contextId===prepared.action.context_id&&
   ack.sessionId===prepared.action.session_id,'server ACK mismatch');
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads','revisions','outbox'],'readwrite');
   const m=tx.objectStore('meta'),h=tx.objectStore('heads'),r=tx.objectStore('revisions'),o=tx.objectStore('outbox');
   let count=0,vals={},failure=null;
   const got=key=>ev=>{vals[key]=ev.target.result||null;if(++count===4)commit();};
   const commit=()=>{try{
    check(same(before,identity()),'identity changed before ACK commit');
    const p=vals.prepared,head=vals.head,rev=vals.rev,out=vals.out;
    check(p&&head&&rev&&out&&belongs(p,before),'ACK target missing or owner mismatch');
    check(p.kind==='e7b-paired-prepared-action-v1'&&JSON.stringify(p.action)===JSON.stringify(prepared.action),
     'original prepared action changed');
    check(rev.pairHash===p.pairHash&&out.actionId===ack.actionId,'journal revision ACK mismatch');
    if(p.ackedAt){check(p.ack?.serverRevision===ack.serverRevision&&p.ack?.serverToken===ack.serverToken,'duplicate ACK mismatch');return;}
    check(Number(head.serverRevision??0)===p.baseRevision&&(head.serverToken??null)===(p.baseToken??null),'ACK baseline race; preserve pending action');
    check(ack.serverRevision===p.baseRevision+1&&typeof ack.serverToken==='string'&&ack.serverToken.length>0,'invalid ACK revision/token');
    // Do not clear hasPending if a newer local revision was captured meanwhile.
    const latestIsAcked=head.pairHash===rev.pairHash;
    h.put({...head,serverRevision:ack.serverRevision,serverToken:ack.serverToken,hasPending:!latestIsAcked});
    r.put({...rev,serverRevision:ack.serverRevision,serverToken:ack.serverToken,ackedAt:new Date().toISOString()});
    o.put({...out,status:'acked',ackedAt:new Date().toISOString(),serverRevision:ack.serverRevision,serverToken:ack.serverToken});
    m.put({...p,ackedAt:new Date().toISOString(),ack:copy(ack)});
   }catch(e){failure=e;try{tx.abort();}catch(_){};}};
   m.get(prepared.key).onsuccess=got('prepared');
   h.get(prepared.headKey||`${before.accountId}|${before.deviceKey}|${before.candidateKey}|${prepared.contextId}`).onsuccess=got('head');
   r.get(prepared.revisionKey||`${before.accountId}|${before.deviceKey}|${before.candidateKey}|${prepared.contextId}|${ack.actionId}`).onsuccess=got('rev');
   o.get(prepared.outboxKey||`${before.accountId}|${before.deviceKey}|${before.candidateKey}|${ack.actionId}`).onsuccess=got('out');
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||Error('ACK transaction aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(before,identity()),'identity changed after ACK commit');
  return {status:'acked',actionId:ack.actionId,serverRevision:ack.serverRevision,idempotent:ack.idempotent};
 }
 return Object.freeze({prepareOne,flushOne,readPreparedAction,snapshot});
}
return Object.freeze({make,DB,PREFIX});
});
