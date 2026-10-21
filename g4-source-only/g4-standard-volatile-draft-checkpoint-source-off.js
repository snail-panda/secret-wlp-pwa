/* G4-1 V9: LOCAL-ONLY, account-bound, in-card draft checkpoint.
 * Separate IDB. Not a Journal Action, not ACKed, not a compatibility projection.
 * The draft is NOT automatically replayed into a Practice Session. Explicit
 * later recovery needs Journal/Context verification and user confirmation.
 * No TTL, Cloud transport, background retry, auto-install or HTML loader.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.WLPG4VolatileDraftCheckpointSourceOFF=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const DB='wlp-g4-standard-draft-v1';
const fail=m=>{throw Error('G4 DRAFT HOLD: '+m);};
const must=(x,m)=>{if(!x)fail(m);};
const clone=x=>JSON.parse(JSON.stringify(x));
const fields=['accountId','deviceKey','candidateKey','headVersion','generation'];
const same=(a,b)=>a?.verified===true&&b?.verified===true&&fields.every(k=>a[k]===b[k]);
const valid=x=>x?.verified===true&&['accountId','deviceKey','candidateKey','generation'].every(k=>typeof x[k]==='string'&&x[k].length>0)&&Number.isSafeInteger(x.headVersion)&&x.headVersion>=1;
function open(indexedDB,create){return new Promise(async(resolve,reject)=>{
 try{
  if(!create){must(typeof indexedDB.databases==='function','DB enumeration required for read-only');
   const dbs=await indexedDB.databases();if(!dbs.some(d=>d.name===DB))return resolve(null);}
  const r=indexedDB.open(DB,1);let upgraded=false;
  r.onupgradeneeded=()=>{
   upgraded=true;
   if(!create){try{r.transaction.abort();}catch(_){};return;}
   for(const name of ['drafts','leases']) if(!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name,{keyPath:'key'});
  };
  r.onsuccess=()=>{
   const db=r.result;
   if((!create&&upgraded)||!['drafts','leases'].every(s=>db.objectStoreNames.contains(s)))
    {db.close();return reject(Error('unexpected draft DB schema'));}
   resolve(db);
  };
  r.onerror=()=>reject(r.error||Error('draft IDB open failed'));
  r.onblocked=()=>reject(Error('draft DB blocked'));
 }catch(e){reject(e);}
});}
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error||Error('draft IDB request failed'));});
function make({indexedDB,identityNow,sessionToken,clock=()=>new Date().toISOString()}={}){
 must(indexedDB?.open&&typeof identityNow==='function'&&typeof sessionToken==='string'&&sessionToken.length>=16,
  'explicit trusted IDB, identity and per-tab token required');
 const inFlight=new Map();
 function identity(){const id=clone(identityNow());must(valid(id),'verified generation absent');return id;}
 function keys(id,d){
  must(['contextId','sessionId','wordId','eventId'].every(k=>typeof d?.[k]==='string'&&d[k].length>0), 'exact draft identifiers required');
  must(/^\d+$/.test(d.wordId),'WID must be numeric');
  const sessionKey=[id.accountId,id.deviceKey,id.candidateKey,d.contextId,d.sessionId].join('|');
  return {leaseKey:sessionKey, key:sessionKey+'|'+d.wordId+'|'+d.eventId};
 }
 function payload(d){
  must(typeof d.responseText==='string'&&d.responseText.length<=800,'response text invalid');
  must(['','got-it','almost','not-yet','no-idea'].includes(d.selfRating||''),'self-rating invalid');
  must(Number.isSafeInteger(d.hintCount)&&d.hintCount>=0&&d.hintCount<=20,'hint count invalid');
  return {contextId:d.contextId,sessionId:d.sessionId,wordId:d.wordId,eventId:d.eventId,
   responseText:d.responseText,selfRating:d.selfRating||'',hintCount:d.hintCount,
   targetShown:d.targetShown===true};
 }
 function runWrite(d,mode,receipt){
  const before=identity(),k=keys(before,d),data=mode==='stage'?payload(d):null;
  if(mode==='clear')must(receipt?.status==='pending'&&receipt?.durable===true&&receipt?.projected===true&&
   typeof receipt.actionId==='string'&&receipt.actionId.length>0,'verified original Journal receipt required');
  const prior=inFlight.get(k.leaseKey)||Promise.resolve();
  const current=prior.catch(()=>{}).then(async()=>{
   must(same(before,identity()),'Owner changed before draft transaction');
   const db=await open(indexedDB,true);
   try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(['leases','drafts'],'readwrite');
    const leaseStore=tx.objectStore('leases'),draftStore=tx.objectStore('drafts');
    let problem=null,result=null;
    const a=leaseStore.get(k.leaseKey),b=draftStore.get(k.key);
    let done=0,lease=null,record=null;
    function end(){if(++done!==2)return;
     try{
      must(same(before,identity()),'Owner changed during draft transaction');
      must(!lease||lease.token===sessionToken,'another tab owns the current Session draft; explicit reconciliation required');
      must(!lease||same(lease.identity,before),'lease verified generation changed; manual reconciliation required');
      must(!record||same(record.identity,before),'draft verified generation changed; manual reconciliation required');
      must(!record||record.sessionToken===sessionToken,'draft belongs to another tab');
      if(!lease)leaseStore.put({key:k.leaseKey,token:sessionToken,identity:before,createdAt:clock()});
      if(mode==='stage'){
       const next={...data,key:k.key,sessionToken,identity:before,revision:(record?.revision||0)+1,
        updatedAt:clock(),draftOnly:true};
       draftStore.put(next);result={saved:true,draftOnly:true,revision:next.revision};
      }else{
       // Never erase a different event's draft or any other Session.
       if(record)draftStore.delete(k.key);
       result={cleared:true,draftOnly:true};
      }
     }catch(e){problem=e;try{tx.abort();}catch(_){}}
    }
    a.onsuccess=()=>{lease=a.result||null;end();};b.onsuccess=()=>{record=b.result||null;end();};
    a.onerror=b.onerror=()=>{problem=Error('draft IDB read failed');try{tx.abort();}catch(_){}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem||tx.error||Error('draft transaction aborted'));
    tx.onerror=()=>{};
   });}finally{db.close();}
  });
  inFlight.set(k.leaseKey,current);
  current.finally(()=>{if(inFlight.get(k.leaseKey)===current)inFlight.delete(k.leaseKey);}).catch(()=>{});
  return current;
 }
  // Stage11 FIX4: explicit, proven Resume handoff. Called ONLY from the binder
  // after fresh remote identity verification, exact Journal Head/Revision/Outbox
  // read-back and restored original WLP Session/Context. No draft or Journal
  // Action is created here. Reject any uncommitted draft for this Session.
  async function adoptVerifiedResumeLease({contextId,sessionId}={}) {
    const before=identity();
    must(typeof contextId==='string'&&!!contextId&&typeof sessionId==='string'&&!!sessionId,
      'verified Resume exact identifiers required');
    const k=[before.accountId,before.deviceKey,before.candidateKey,contextId,sessionId].join('|');
    const db=await open(indexedDB,false);
    if(!db)return {adopted:false,unused:true};
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(['leases','drafts'],'readwrite');
      const ls=tx.objectStore('leases'),ds=tx.objectStore('drafts');
      const q=ls.get(k),p=ds.getAll();
      let count=0,lease=null,drafts=null,problem=null,result=null;
      function finish(){if(++count!==2)return;
        try{
          must(same(before,identity()),'Owner changed during Resume lease transaction');
          must(Array.isArray(drafts),'draft store could not be inspected');
          must(!drafts.some(d=>typeof d.key==='string'&&d.key.startsWith(k+'|')),
            'uncommitted prior draft exists; explicit reconciliation required');
          must(!lease||same(lease.identity,before),'previous lease identity or generation changed');
          if(lease&&lease.token!==sessionToken){
            ls.put({...lease,token:sessionToken,identity:before,
              resumeHandoffAt:clock(),resumeHandoffVerified:true});
            result={adopted:true,draftFree:true};
          }else result={adopted:false,draftFree:true};
        }catch(e){problem=e;try{tx.abort();}catch(_){}}
      }
      q.onsuccess=()=>{lease=q.result||null;finish();};
      p.onsuccess=()=>{drafts=p.result;finish();};
      q.onerror=p.onerror=()=>{problem=Error('Resume lease read failed');try{tx.abort();}catch(_){}};
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(problem||tx.error||Error('Resume lease handoff aborted'));
    });}finally{db.close();}
  }
 async function readOnly(d){
  const before=identity(),k=keys(before,d);
  const db=await open(indexedDB,false);if(!db)return null;
  try{
   const tx=db.transaction(['leases','drafts'],'readonly');
   const [lease,record]=await Promise.all([req(tx.objectStore('leases').get(k.leaseKey)),req(tx.objectStore('drafts').get(k.key))]);
   must(same(before,identity()),'Owner changed during read-only draft inspection');
   must(!record||lease?.token===record.sessionToken,'draft ownership inconsistent');
   must(!record||same(record.identity,before),'draft from another account/Authority');
   // Read-only inspection does not grant the ability to apply a draft.
   return record?Object.freeze({found:true,readOnly:true,draftOnly:true,contextId:record.contextId,
     sessionId:record.sessionId,wordId:record.wordId,eventId:record.eventId,responseText:record.responseText,
     selfRating:record.selfRating,hintCount:record.hintCount,updatedAt:record.updatedAt}):null;
  }finally{db.close();}
 }
 return Object.freeze({stageDraft:d=>runWrite(d,'stage'),clearCommittedDraft:(d,receipt)=>runWrite(d,'clear',receipt),
  readDraft:readOnly,adoptVerifiedResumeLease,dbName:DB});
}
return Object.freeze({make});
});
