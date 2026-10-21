/* WLP G4-1 — Account → previously verified G3/G4 Standard Journal composer.
 * SOURCE OFF. Neither importing this module nor constructing it installs a
 * writer, changes Study Hub mode, enrolls a Session, creates IDB or sends RPCs.
 * A trusted caller must explicitly approve a local-only composition, and the
 * established G3/G4 modules remain untouched. Production activation requires
 * a separate source/read/write ownership decision and Cloud transport.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WLPG4AccountLocalWriterBridgeSOURCEOFF=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const required=(test,message)=>{if(!test)throw Error('G4 ACCOUNT WRITER HOLD: '+message);};
const failClosedPending=(storage)=>{
  // Neither queue is ever cleared/drained here. Malformed records are HOLDs,
  // not treated as empty; do not corrupt existing Standard pending writes.
  const names=['WLP Canonical Standard Practice Pending V1','WLP Canonical Standard Session Pending V1'];
  for(const key of names){
    const raw=storage.getItem(key);
    if(raw===null)continue;
    let entries;try{entries=JSON.parse(raw);}catch(_){throw Error('Invalid existing Standard pending queue: '+key);}
    required(Array.isArray(entries),'Invalid Standard pending queue: '+key);
    required(entries.length===0,'Legacy Standard pending writes remain: '+key);
  }
};
const readExistingOutbox=async(indexedDB)=>{
  required(typeof indexedDB?.databases==='function','Safe IndexedDB enumeration unavailable');
  const names=await indexedDB.databases();
  if(!names.some(x=>x.name==='wlp-cloud-v1'))return 0;
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('wlp-cloud-v1');let upgraded=false;
    request.onupgradeneeded=()=>{upgraded=true;try{request.transaction.abort();}catch(_){}};
    request.onsuccess=()=>upgraded?(request.result.close(),reject(Error('Unexpected Canonical DB creation'))):resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Canonical DB cannot be read'));
    request.onblocked=()=>reject(Error('Canonical DB locked'));
  });
  try{
    required(db.objectStoreNames.contains('sync_outbox'),'Canonical Outbox store missing');
    return await new Promise((resolve,reject)=>{
      const req=db.transaction('sync_outbox','readonly').objectStore('sync_outbox').count();
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('Canonical Outbox count unavailable'));
    });
  }finally{db.close();}
};
function moduleBindings(root){return {
  identityApi:root.WLPE7bAuthenticatedIdentityDEV,
  leaseApi:root.WLPG4AccountStableIdentitySOURCEOFF,
  refreshApi:root.WLPG4SharedAuthFreshnessSOURCEOFF,
  binderApi:root.WLPG4LocalStandardBinderSourceOFF,
  wireApi:root.WLPE7bPairedWireDEV,
  journalApi:root.WLPE7bNewSessionJournalDEV,
  driverApi:root.WLPG4GeneralResumeAuthJournalDriverSOURCEOFF,
  bridgeApi:root.WLPG3E7bAuthStudyHubBridge,
  saveContractApi:root.WLPG4StandardSaveContract,
  resumePreflightApi:root.WLPG4GeneralResumeReadOnlyPreflight,
  draftCheckpointApi:root.WLPG4VolatileDraftCheckpointSourceOFF
};}
function make({root,storage,indexedDB,cryptoImpl,fetchImpl,studyContext,modules}={}){
  required(root&&indexedDB?.open&&cryptoImpl?.subtle&&cryptoImpl?.randomUUID&&
    typeof fetchImpl==='function'&&storage?.getItem&&studyContext?.getContext&&studyContext?.updateContext,
    'Current WLP browser and actual Study Context required');
  const m=modules||moduleBindings(root);
  const requiredFunctions={identityApi:'make',binderApi:'create',wireApi:'validateBodies',
    leaseApi:'make',refreshApi:'make',journalApi:'make',driverApi:'make',bridgeApi:'make',saveContractApi:'make',
    resumePreflightApi:'inspect',draftCheckpointApi:'make'};
  for(const [key,method] of Object.entries(requiredFunctions)){
    required(typeof m[key]?.[method]==='function','Missing existing G3/G4 module: '+key+'.'+method);
  }
  let prepared=false,preparing=false;
  // This explicit action does NOT enable Study Hub, start a Session or perform
  // any local writer mutation. It verifies the ACTUAL signed-in WLP account.
  async function prepareLocalOnly({approved=false}={}){
    required(approved===true,'Explicit local-only composer approval required');
    required(!prepared&&!preparing,'A writer is already prepared or preparing for this tab');
    preparing=true;
    try {
    // Legacy pending is retained, not erased or adopted by this writer.
    failClosedPending(storage);
    const existing=await readExistingOutbox(indexedDB);
    required(existing===0,'Existing Canonical Outbox contains '+existing+' pending mutation(s)');
    // One authenticated ownership proof path: renew the EXISTING Shadow session
    // under a cross-tab lock before using the unchanged E7b JWT verifier.
    // No token is exposed to the Journal, Study Hub, or cloud composer.
    const freshness=m.refreshApi.make({indexedDB,fetchImpl,locks:root.navigator?.locks});
    const guardedIdentityApi={make:(opts)=>{
      const existing=m.identityApi.make(opts);
      required(typeof existing?.verify==='function'&&typeof existing.getVerifiedIdentitySync==='function',
        'Existing JWT verifier unavailable');
      return Object.freeze({
        verify:async()=>{await freshness.ensureFresh();return existing.verify();},
        getVerifiedIdentitySync:()=>existing.getVerifiedIdentitySync(),
        invalidate:()=>existing.invalidate?.()
      });
    }};
    const identitySource=m.leaseApi.make({identityApi:guardedIdentityApi,indexedDB,fetchImpl,cryptoImpl});
    const first=await identitySource.verify(); // /auth/v1/user + active Authority
    required(first?.verified===true&&first?.accountId&&first?.candidateKey&&first?.deviceKey&&
      Number.isSafeInteger(first.headVersion),'Server verified WLP Owner/Authority unavailable');
    failClosedPending(storage);
    required(await readExistingOutbox(indexedDB)===0,'Canonical pending changed during proof');
    const driver=m.binderApi.create({approvedIsolatedUse:true,identitySource,indexedDB,cryptoImpl,
      storage,studyContext,wireApi:m.wireApi,journalApi:m.journalApi,driverApi:m.driverApi,
      bridgeApi:m.bridgeApi,saveContractApi:m.saveContractApi,resumePreflightApi:m.resumePreflightApi,
      draftCheckpointApi:m.draftCheckpointApi});
    required(driver?.approved===true&&driver.cloudWrite===false&&
      typeof driver.refreshStartProof==='function'&&typeof driver.commit==='function',
      'Verified existing local-only Journal contract unavailable');
    // NO auto start, no assignment to window.WLPG4VerifiedStandardCommit.
    prepared=true;
    return Object.freeze({driver,accountId:first.accountId,deviceKey:first.deviceKey,
      candidateKey:first.candidateKey,headVersion:first.headVersion,localOnly:true,
      studyHubEnabled:false,cloudSyncEnabled:false,
      // Exactly the same trusted lease instance used by the proven Journal.
      // These callbacks expose no token or Supabase configuration.
      verifyIdentity:()=>identitySource.verify(),
      identityNow:()=>identitySource.getVerifiedIdentitySync()});
    } finally { preparing=false; }
  }
  return Object.freeze({prepareLocalOnly,status:()=>Object.freeze({sourceOff:true,prepared})});
}
return Object.freeze({make,readExistingOutbox});
});
