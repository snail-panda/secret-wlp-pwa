/* G4-1 candidate-only composition of the EXACT previously tested G3-B writer.
 * No auto-boot, no script injection, no server RPC sender, no cloud ACK.
 * Do not use on E7a / any existing E7b origin. Source gate in study-hub.js stays OFF.
 * This is a factory only. It performs zero I/O until an approved isolated test
 * explicitly calls create(), and never installs the returned contract globally.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.WLPG4LocalStandardBinderSourceOFF=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const fail=msg=>{throw Error('G4 NATIVE BINDER HOLD: '+msg);};
const check=(v,msg)=>{if(!v)fail(msg);};
const clone=x=>JSON.parse(JSON.stringify(x));
const SK='wlp:studyq-sessions:v1', EK='wlp:studyq-events:v1';
function arrayFrom(storage,key){
 const v=JSON.parse(storage.getItem(key)||'[]');
 check(Array.isArray(v),'invalid compatibility collection '+key);return v;
}
function projectOriginal({storage,studyContext},candidate,receipt){
 const {session,context,contextId,sessionId}=candidate;
 check(receipt?.status==='pending'&&!!receipt?.actionId,
  'verified G3 Journal commit receipt missing');
 check(session?.sessionId===sessionId&&context?.contextId===contextId&&
  context?.sessionRef?.sessionId===sessionId,'projection pair mismatch');
 check(typeof studyContext?.updateContext==='function'&&typeof studyContext?.getContext==='function',
  'actual WLP Study Context API required');
 const current=studyContext.getContext(contextId);
 check(current?.contextId===contextId&&current?.sessionRef?.sessionId===sessionId,
  'original WLP Study Context not found or replaced');
 const sessions=arrayFrom(storage,SK);
 const i=sessions.findIndex(s=>s?.sessionId===sessionId);
 if(i>=0)sessions[i]=clone(session);else sessions.push(clone(session));
 storage.setItem(SK,JSON.stringify(sessions.slice(-80)));
 const events=arrayFrom(storage,EK);
 for(const xp of session.experiences||[]){
  const attempt=xp.attempt;
  check(typeof attempt?.eventId==='string'&&!!attempt.eventId,'missing WLP attempt eventId');
  const entry={...clone(attempt),sessionId};
  const j=events.findIndex(e=>e?.eventId===entry.eventId);
  if(j>=0)events[j]=entry;else events.push(entry);
 }
 storage.setItem(EK,JSON.stringify(events.slice(-1200)));
 const written=studyContext.updateContext(contextId,{status:context.status,
   lastMeaningfulAt:context.lastMeaningfulAt, progress:context.progress,sessionRef:context.sessionRef});
 check(written?.contextId===contextId&&written?.sessionRef?.sessionId===sessionId&&
  written?.status===context.status,'Study Context compatibility projection rejected');
 // Independent read-back after every compatibility write. A failure is a HOLD,
 // not permission to write a second Journal Action.
 const saved=arrayFrom(storage,SK).find(s=>s?.sessionId===sessionId);
 check(JSON.stringify(saved)===JSON.stringify(session),'WLP session read-back mismatch');
 const savedContext=studyContext.getContext(contextId);
 // Study Context normalizes the property order of progress on every update.
 // Compare JSON VALUES (including array order), not incidental object key order.
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
 check(savedContext?.sessionRef?.sessionId===sessionId&&savedContext?.status===context.status&&
  JSON.stringify(stable(savedContext?.progress))===JSON.stringify(stable(context.progress)),
  'WLP Context read-back mismatch');
 const savedEvents=arrayFrom(storage,EK);
 for(const xp of session.experiences||[]){
  const attempt=xp.attempt;
  const found=savedEvents.find(e=>e?.eventId===attempt.eventId&&e?.sessionId===sessionId);
  check(found&&JSON.stringify({...found,sessionId:undefined})===
   JSON.stringify({...attempt,sessionId:undefined}),
   'WLP Event read-back mismatch: '+String(attempt.eventId));
 }
 return true;
}
function create({approvedIsolatedUse=false,identitySource,indexedDB,cryptoImpl,
  storage,studyContext,wireApi,journalApi,driverApi,bridgeApi,saveContractApi,resumePreflightApi,draftCheckpointApi}={}){
 check(approvedIsolatedUse===true,'isolated-use approval absent');
 check(identitySource?.verify&&identitySource?.getVerifiedIdentitySync,
  'server-verified identity provider required');
 check(indexedDB?.open&&cryptoImpl?.randomUUID&&storage?.getItem&&storage?.setItem,
  'existing IDB / UUID / compatibility storage required');
 check(wireApi?.validateBodies&&journalApi?.make&&driverApi?.make&&bridgeApi?.make&&
  saveContractApi?.make&&resumePreflightApi?.inspect&&draftCheckpointApi?.make,'the G3-B and G4 source contracts + general Resume preflight must be supplied');
 const identityNow=()=>identitySource.getVerifiedIdentitySync();
 const journal=journalApi.make({indexedDB,identityNow,
   verifyOnline:async()=>({identity:await identitySource.verify()}),approvedCapture:true});
 const driver=driverApi.make({journal,bridgeApi,identityNow,indexedDB,
   dbName:'wlp-study-context-sync-v1',randomUUID:()=>cryptoImpl.randomUUID(),
   projectAfterJournal:(candidate,receipt)=>projectOriginal({storage,studyContext},candidate,receipt),
   afterProjection:async()=>{} // No legacy Recorder dispatch; no Cloud send.
 });
 const verifiedDriver=Object.freeze({...driver,
  resumeExisting:async({context,session}={})=>{
   const contextId=context?.contextId,sessionId=session?.sessionId;
   // Read originals from the actual compatibility stores, never accept a
   // caller-constructed Session as evidence for Journal enrollment.
   const proof=await resumePreflightApi.inspect({indexedDB,cryptoImpl,identityNow,
    verifyFreshOnline:()=>identitySource.verify(),wireApi,contextId,sessionId,
    readOriginal:async(sid,cid)=>({
      context:studyContext.getContext(cid),
      session:arrayFrom(storage,SK).find(x=>x?.sessionId===sid)||null
    })});
   check(proof?.verified===true&&proof?.readOnly===true,
    'read-only general Resume proof absent');
   check(JSON.stringify(proof.contextId)===JSON.stringify(contextId)&&
    JSON.stringify(proof.sessionId)===JSON.stringify(sessionId),
    'verified proof does not match requested Resume pair');
   const receipt=await driver.resumeExisting({context:clone(context),session:clone(session)});
   check(receipt?.bound===true&&receipt.parentHash===proof.parentHash,
    'restored Journal enrollment differs from verified Head');
   // Authorize this CAS lease handoff ONLY after all original + Journal
   // Resume proofs succeed. The old tab token can no longer stage a draft.
   // If any prior uncommitted draft or authority change exists, fail closed.
   check(typeof draft.adoptVerifiedResumeLease==='function',
    'safe partial Resume draft lease handoff absent');
   await draft.adoptVerifiedResumeLease({contextId,sessionId});
   return receipt;
  }
 });
 const draft=draftCheckpointApi.make({indexedDB,identityNow,sessionToken:cryptoImpl.randomUUID()});
 const localDriver=Object.freeze({...verifiedDriver,
  stageDraft:d=>draft.stageDraft(d),
  readDraft:d=>draft.readDraft(d),
  clearCommittedDraft:(d,receipt)=>draft.clearCommittedDraft(d,receipt)});
 const contract=saveContractApi.make({driver:localDriver,identityNow});
 check(contract?.approved===true&&contract?.cloudWrite===false,'untrusted output contract');
  // Stage11 8877 ONLY. D2 login stores a server-verified short-lived JWT in
  // IndexedDB, but this fresh Study Hub tab has no in-memory identity proof.
  // The original G3-B save contract reads identity *before* calling the real
  // Journal's online verification. Refresh it explicitly first, then let the
  // UNMODIFIED save contract / G3-B Journal verify Authority again.
  // Do not bypass verification, reuse stale proof or create an Action here.
  const checkedStartProof=async()=>{
    await identitySource.verify(); // real Supabase /auth/v1/user + active Authority
    return contract.refreshStartProof(); // original journal performs its own proof
  };
  return Object.freeze({
    approved:contract.approved,cloudWrite:contract.cloudWrite,
    get ready(){return contract.ready;},
    refreshStartProof:checkedStartProof,
    prepareStart:(...args)=>contract.prepareStart(...args),
    onContextCreated:(...args)=>contract.onContextCreated(...args),
    supportsSource:(...args)=>contract.supportsSource(...args),
    resumeExisting:(...args)=>contract.resumeExisting(...args),
    commit:(...args)=>contract.commit(...args),
    stageDraft:(...args)=>contract.stageDraft(...args),
    readDraft:(...args)=>contract.readDraft(...args),
    clearCommittedDraft:(...args)=>contract.clearCommittedDraft(...args),
    // Manual recovery of ONE existing durable Action. Never calls commit/captureCandidate.
    // Explicitly re-verifies the real Sandbox Authority and delegates to G3-B's
    // exact Action-ID, Head, owner/generation, hash and conflict guarded path.
    reconcileDurableActionOnce:async ({contextId,sessionId,actionId}={})=>{
      check(typeof contextId==='string'&&!!contextId&&typeof sessionId==='string'&&!!sessionId&&
       typeof actionId==='string'&&!!actionId,'exact existing Action required');
      await identitySource.verify();
      const receipt=await verifiedDriver.reconcileProjectedAction({contextId,sessionId,actionId});
      check(receipt?.status==='pending'&&receipt?.durable===true&&receipt?.projected===true&&
       receipt?.recovered===true&&receipt?.actionId===actionId,'existing Action recovery not verified');
      return Object.freeze({recovered:true,existingActionOnly:true,cloudWrite:false});
    },
    reportHold:(...args)=>contract.reportHold(...args),
    status:()=>contract.status()
  });
}
return Object.freeze({create,projectOriginal});
});
