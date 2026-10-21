/* WLP P1-E7b — fresh, online-verified Standard Study journal capture.
 * DEV/HOLD: no script loader, no automatic upload, no legacy migration.
 * Only new contexts started while a verified identity is cached may enter this lane.
 * Learning without proof continues as legacy Local-only; never adopt it afterwards.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bNewSessionJournalDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const Wire=typeof module==='object'&&module.exports?require('./wlp-e7b-paired-wire-contract-dev.js'):root.WLPE7bPairedWireDEV;
const DB='wlp-study-context-sync-v1', ALLOWED=new Set(['deck','range','review-set']);
const copy=o=>JSON.parse(JSON.stringify(o));
const check=(ok,msg)=>{if(!ok)throw Error('E7b new-session capture blocked: '+msg);};
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])]));return v;}
function webCrypto(){if(root?.crypto?.subtle)return root.crypto;if(typeof require==='function')return require('node:crypto').webcrypto;throw Error('WebCrypto is unavailable');}
async function hashPair(value){const d=await webCrypto().subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value))));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function openDb(indexedDB){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);
 r.onupgradeneeded=()=>{
  // First E7b visit: create ONLY the dedicated journal schema, not any user data.
  // An existing schema remains untouched; mismatched partial v1 fails closed.
  for(const name of ['meta','heads','revisions','outbox','conflicts'])
   if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'key'});
 };
 r.onerror=()=>reject(r.error||Error('journal open failed'));r.onblocked=()=>reject(Error('journal open blocked'));
 r.onsuccess=()=>{const db=r.result;if(!['meta','heads','revisions','outbox'].every(x=>db.objectStoreNames.contains(x))){db.close();reject(Error('journal stores missing'));return;}resolve(db);};});}
function txWrite(db,callback){return new Promise((resolve,reject)=>{
 const tx=db.transaction(['meta','heads','revisions','outbox'],'readwrite'),s={};for(const name of ['meta','heads','revisions','outbox'])s[name]=tx.objectStore(name);
 let count=0,expect=0,failed=null,answer=null;
 let commit=()=>null;const reads={};
 // Read phase must be entirely synchronous: do not yield in a live IndexedDB transaction.
 try{callback({s,read:(store,key)=>{expect++;const r=s[store].get(key);r.onsuccess=()=>{count++;reads[store+'|'+key]=r.result||null;if(count===expect){try{answer=commit(reads,s);}catch(e){failed=e;try{tx.abort();}catch(_){}}}};r.onerror=()=>{try{tx.abort();}catch(_){}};},setCommit:fn=>commit=fn});}
 catch(e){failed=e;try{tx.abort();}catch(_){}}
 tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(failed||tx.error||Error('journal write aborted'));tx.onerror=()=>{};
});}
function make({indexedDB,identityNow,verifyOnline,approvedCapture=false,clock=()=>Date.now(),randomUUID=()=>webCrypto().randomUUID()}={}){
 check(indexedDB?.open&&typeof identityNow==='function'&&typeof verifyOnline==='function','trusted storage and identity callbacks required');
 let proof=null;const pending=new Map(),enrolled=new Map();
 const identity=()=>Wire.normalizeIdentity(identityNow());
 const same=(a,b)=>Wire.sameIdentity(a,b);
 function currentProof(){const now=identity();return proof&&proof.issuedAt<=clock()&&clock()-proof.issuedAt<=120000&&same(proof.identity,now)?proof:null;}
 async function verifyForNewStarts(){
  check(approvedCapture===true,'pilot capture disabled');const before=identity();
  // This must check real Supabase /auth/v1/user; callers cannot substitute a mere localStorage flag.
  const server=await verifyOnline();
  check(server?.identity&&same(before,server.identity),'server-confirmed identity or generation mismatch');
  check(same(before,identity()),'account changed during online verification');
  proof=Object.freeze({identity:copy(before),issuedAt:clock()});return {ready:true,accountId:before.accountId};
 }
 // Called synchronously BEFORE the existing Study Context createContext() call.
 // Missing/expired proof does not block ordinary WLP study; returns false.
 function prepareStart(sessionId,sourceInfo){
  const p=currentProof(),sid=String(sessionId||'').trim(),src=sourceInfo?.source||{},ids=src.wordIds;
  if(!approvedCapture||!p||!sid||!ALLOWED.has(sourceInfo?.sourceType)||!Array.isArray(ids)||ids.length===0||ids.length>1000||pending.has(sid))return false;
  if(ids.some(x=>!/^\d+$/.test(String(x)))||new Set(ids.map(String)).size!==ids.length)return false;
  pending.set(sid,Object.freeze({id:copy(p.identity),sessionId:sid,sourceType:sourceInfo.sourceType,wordIds:ids.map(String),time:clock()}));
  return true;
 }
 function abandonStart(sessionId){pending.delete(String(sessionId||''));}
 // Called with *new* context after createContext. Not a historical scan or import.
 async function onContextCreated(context){
  const sid=context?.sessionRef?.sessionId,w=pending.get(sid);pending.delete(sid);
  if(!w)return {enrolled:false,reason:'not-online-bound-at-start'};
  check(same(w.id,identity()),'identity changed after start');
  const created=Date.parse(context?.createdAt||''),at=clock();
  check(context.status==='active'&&context.practiceMode==='standard'&&context.sessionRef?.type==='standard'&&
   context.sourceType===w.sourceType&&context.sessionRef.sessionId===w.sessionId,'new Context does not match start witness');
  check(JSON.stringify(context.source?.wordIds?.map(String))===JSON.stringify(w.wordIds),'new Context source/order changed');
  check(Number.isFinite(created)&&created>=w.time-3000&&created<=at+3000&&at-w.time<=90000,'Context not freshly created after start');
  const key='e7b:enrolled:'+context.contextId,skey='e7b:session:'+sid,who=copy(w.id);
  const db=await openDb(indexedDB);
  try{await txWrite(db,({read,setCommit})=>{
   setCommit((data,s)=>{
    check(same(who,identity()),'identity changed before durable enrollment');
    check(!data['meta|'+key]&&!data['meta|'+skey],'existing/legacy Context or session cannot be enrolled');
    s.meta.add({key,contextId:context.contextId,sessionId:sid,wordIds:w.wordIds,accountId:who.accountId,
     deviceKey:who.deviceKey,candidateKey:who.candidateKey,headVersion:who.headVersion,generation:who.generation,
     accountBoundAtStart:true,transportEligible:true,enrolledAt:new Date(at).toISOString()});
    s.meta.add({key:skey,contextId:context.contextId,accountId:who.accountId,deviceKey:who.deviceKey,generation:who.generation});
    return {enrolled:true,contextId:context.contextId};
   });read('meta',key);read('meta',skey);
  });}finally{db.close();}
  enrolled.set(context.contextId,who);return {enrolled:true,contextId:context.contextId};
 }
 // Restores only a record which THIS journal had durably enrolled at the actual start.
 // Unlike arbitrary localStorage lookup, this cannot claim a legacy Context after login.
 async function restorePreviouslyEnrolled({contextId,sessionId,readOriginal}={}){
  check(approvedCapture===true,'pilot capture disabled');
  check(typeof readOriginal==='function','original WLP reader required');
  const now=identity(),p=currentProof();check(p&&same(p.identity,now),'fresh server verification required for enrollment restoration');
  const db=await openDb(indexedDB);
  let binding,head;
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads'],'readonly');
   tx.objectStore('meta').get('e7b:enrolled:'+contextId).onsuccess=e=>{binding=e.target.result;};
   tx.objectStore('heads').get(now.accountId+'|'+now.deviceKey+'|'+now.candidateKey+'|'+contextId).onsuccess=e=>{head=e.target.result;};
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('restore journal aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(binding?.accountBoundAtStart===true&&binding?.transportEligible===true&&
   binding?.accountId===now.accountId&&binding?.deviceKey===now.deviceKey&&
   binding?.candidateKey===now.candidateKey&&binding?.headVersion===now.headVersion&&
   binding?.contextId===contextId&&binding?.sessionId===sessionId,
   'verified durable start enrollment missing; legacy session stays local-only');
  // The previously persisted head must exist: no claiming a merely witnessed but
  // never captured session from earlier browser state without a journal history.
  check(head?.accountId===now.accountId&&head?.sessionId===sessionId&&
   head?.contextId===contextId&&head?.headVersion===now.headVersion,
   'previously captured paired head missing/mismatched');
  const saved=await readOriginal(sessionId,contextId);
  check(saved?.session?.sessionId===sessionId&&saved?.context?.contextId===contextId,
   'original saved pair missing at restoration');
  Wire.validateBodies(saved.context,saved.session);
  check(JSON.stringify(binding.wordIds)===JSON.stringify(saved.context.source.wordIds.map(String)),
   'restored original source order changed');
  check(same(now,identity()),'identity changed during restoration');
  enrolled.set(contextId,copy(now));return {restored:true,contextId};
 }
 // Reads ORIGINAL already-saved session+context, not event payloads. Caller must give readOriginal().
 async function capturePair({contextId,sessionId,readOriginal}={}){
  check(approvedCapture===true,'pilot capture disabled');
  check(typeof readOriginal==='function','original WLP source reader required');
  const who=enrolled.get(contextId);check(who&&same(who,identity()),'Context not freshly enrolled under current account');
  const original=await readOriginal(sessionId,contextId);
  check(original?.context?.contextId===contextId&&original?.session?.sessionId===sessionId,
   'saved original Session/Context pair missing');
  const context=copy(original.context),session=copy(original.session);
  Wire.validateBodies(context,session);
  const pairHash=await hashPair({context,session}),localHash=await hashPair(context),whoKey=who.accountId+'|'+who.deviceKey+'|'+who.candidateKey;
  const headKey=whoKey+'|'+contextId,bindKey='e7b:enrolled:'+contextId,at=new Date(clock()).toISOString();
  check(same(who,identity()),'identity changed during capture');
  const db=await openDb(indexedDB);
  try{return await txWrite(db,({read,setCommit})=>{
   setCommit((data,s)=>{
    check(same(who,identity()),'account changed before durable capture');
    const b=data['meta|'+bindKey],prev=data['heads|'+headKey];
    check(b&&b.accountBoundAtStart===true&&b.transportEligible===true&&same(who,{...b,verified:true}),
     'durable new-session enrollment is missing/mismatched');
    check(b.sessionId===sessionId&&JSON.stringify(b.wordIds)===JSON.stringify(context.source.wordIds.map(String)),
     'enrollment source or original session changed');
    if(prev){check(prev.accountId===who.accountId&&prev.sessionId===sessionId&&prev.headVersion===who.headVersion&&
     prev.deviceKey===who.deviceKey,'old journal owner/session mismatch');
     if(prev.pairHash===pairHash)return {staged:false,unchanged:true};}
    const actionId=randomUUID(),revKey=headKey+'|'+actionId,outKey=whoKey+'|'+actionId;
    check(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(actionId),'invalid new Action ID');
    s.heads.put({...copy(who),key:headKey,contextId,sessionId,sourceDevice:who.deviceKey,
      context,session,pairHash,localHash,hasPending:true,
      serverRevision:prev?.serverRevision??null,serverToken:prev?.serverToken??null,updatedAt:at});
    s.revisions.add({...copy(who),key:revKey,kind:'standard-session-context-pair',
      accountBoundAtStart:true,transportEligible:true,contextId,sessionId,actionId,pairHash,
      previousPairHash:prev?.pairHash||null,localHash,context,session,recordedAt:at});
    s.outbox.add({...copy(who),key:outKey,accountBoundAtStart:true,transportEligible:true,
      contextId,sessionId,actionId,pairHash,status:'pending',createdAt:at});
    return {staged:true,actionId,contextId,sessionId};
   });read('meta',bindKey);read('heads',headKey);
  });}finally{db.close();}
 }
 // G3 candidate-first capture. Unlike capturePair(), NEVER reads a legacy pair.
 // Writes to the EXISTING E7b Journal schema, reusing original start enrollment.
 // Feature is dormant unless a trusted caller invokes this method explicitly.
 async function captureCandidate({contextId,sessionId,context,session,parentPairHash,actionId}={}){
  check(approvedCapture===true,'candidate capture disabled');
  check(typeof contextId==='string'&&contextId&&typeof sessionId==='string'&&sessionId,'missing candidate identifiers');
  check(context?.contextId===contextId&&session?.sessionId===sessionId,'candidate context/session mismatch');
  check(typeof actionId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(actionId),'immutable v4 Action ID required');
  check(parentPairHash===null||(typeof parentPairHash==='string'&&/^[a-f0-9]{64}$/i.test(parentPairHash)), 'explicit parent hash or null required');
  const who=enrolled.get(contextId);check(who&&same(who,identity()),'candidate requires actual enrolled Context and verified Owner');
  const c=copy(context),ss=copy(session);Wire.validateBodies(c,ss);
  const pairHash=await hashPair({context:c,session:ss}),localHash=await hashPair(c);
  const prefix=who.accountId+'|'+who.deviceKey+'|'+who.candidateKey;
  const headKey=prefix+'|'+contextId,bindKey='e7b:enrolled:'+contextId;
  const revKey=headKey+'|'+actionId,outKey=prefix+'|'+actionId;
  const conflictKey=prefix+'|g3-conflict|'+actionId,at=new Date(clock()).toISOString();
  check(same(who,identity()),'identity changed before candidate transaction');
  const db=await openDb(indexedDB);
  check(db.objectStoreNames.contains('conflicts'),'G3 conflict store is missing');
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads','revisions','outbox','conflicts'],'readwrite');
   const st={};for(const n of ['meta','heads','revisions','outbox','conflicts'])st[n]=tx.objectStore(n);
   const queries={binding:st.meta.get(bindKey),head:st.heads.get(headKey),out:st.outbox.get(outKey),conflict:st.conflicts.get(conflictKey),rev:st.revisions.get(revKey)};
   const reads={},names=Object.keys(queries);let n=0,result=null,failed=null;
   function rejectTx(e){failed=e;try{tx.abort();}catch(_){}}
   for(const name of names){queries[name].onsuccess=()=>{
    reads[name]=queries[name].result||null;
    if(++n!==names.length)return;
    try{
     check(same(who,identity()),'Owner changed in candidate transaction');
     const binding=reads.binding,prev=reads.head;
     check(binding?.accountBoundAtStart===true&&binding.transportEligible===true&&same(who,{...binding,verified:true})&&
      binding.contextId===contextId&&binding.sessionId===sessionId,'verified durable start enrollment missing');
     check(JSON.stringify(binding.wordIds)===JSON.stringify(c.source.wordIds.map(String)),'candidate word order mismatch');
     const already=reads.out||reads.conflict||reads.rev;
     if(already){
      check(already.actionId===actionId&&already.pairHash===pairHash,'Action ID reused for different payload');
      result={status:reads.conflict?'conflict':'pending',duplicate:true,actionId};return;
     }
     if(prev){check(prev.accountId===who.accountId&&prev.sessionId===sessionId&&prev.headVersion===who.headVersion&&
       prev.deviceKey===who.deviceKey,'head owner/session mismatch');}
     const matches=prev?prev.pairHash===parentPairHash:parentPairHash===null;
     if(!matches){
      // The stale candidate is kept durable in conflicts; never overwrite the Head.
      st.conflicts.add({...copy(who),key:conflictKey,actionId,contextId,sessionId,
        pairHash,parentPairHash,observedPairHash:prev?.pairHash||null,context:c,session:ss,
        status:'hold-for-resolution',pendingResolution:true,recordedAt:at});
      result={status:'conflict',duplicate:false,actionId};return;
     }
     if(prev?.pairHash===pairHash){result={status:'unchanged',duplicate:false};return;}
     st.heads.put({...copy(who),key:headKey,contextId,sessionId,sourceDevice:who.deviceKey,
       context:c,session:ss,pairHash,localHash,hasPending:true,
       serverRevision:prev?.serverRevision??null,serverToken:prev?.serverToken??null,updatedAt:at});
     st.revisions.add({...copy(who),key:revKey,kind:'standard-session-context-pair',
       g3CandidateFirst:true,accountBoundAtStart:true,transportEligible:true,contextId,sessionId,actionId,
       pairHash,previousPairHash:prev?.pairHash||null,localHash,context:c,session:ss,recordedAt:at});
     st.outbox.add({...copy(who),key:outKey,g3CandidateFirst:true,projectionVerifiedAt:null,accountBoundAtStart:true,transportEligible:true,
       contextId,sessionId,actionId,pairHash,status:'pending',createdAt:at});
     result={status:'pending',duplicate:false,actionId,pairHash};
    }catch(e){rejectTx(e);}
   };queries[name].onerror=()=>rejectTx(queries[name].error||Error('candidate read failed'));}
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failed||tx.error||Error('candidate transaction aborted'));
   tx.onerror=()=>{};
  });}finally{db.close();}
 }


 return Object.freeze({verifyForNewStarts,prepareStart,abandonStart,onContextCreated,restorePreviouslyEnrolled,capturePair,captureCandidate});
}
return Object.freeze({make});
});
