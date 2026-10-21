/* WLP G4-1 account identity lease adapter — SOURCE OFF.
 * Preserves the E7b JWT + Authority online check; gives the UNMODIFIED G3/G4
 * Journal a generation stable across legitimate access-token rotations.
 * No token refresh, no network at import, no new account, no writes to IDB.
 * MUST NOT be treated as offline authentication or Cloud transport.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WLPG4AccountStableIdentitySOURCEOFF=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const fail=s=>{throw Error('G4 account identity HOLD: '+s);};
const fields=['accountId','deviceKey','candidateKey','headVersion'];
const clean=x=>String(x??'').trim();
function normalizeOrigin(v){
  let u;try{u=new URL(clean(v));}catch{fail('Project origin unavailable');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
     u.pathname.replace(/\/+$/,'')||u.port)fail('Untrusted Supabase project origin');
  return u.origin;
}
function currentTuple(i){
  if(i?.verified!==true||fields.some(k=>!i[k]&&i[k]!==0)||
     !Number.isSafeInteger(Number(i.headVersion))||Number(i.headVersion)<1)
    fail('Authenticated owner/device/Authority is incomplete');
  return fields.map(k=>k==='headVersion'?String(Number(i[k])):clean(i[k]));
}
async function stableGeneration({identity,origin,cryptoImpl}){
  const tuple=currentTuple(identity);
  if(!cryptoImpl?.subtle?.digest)fail('WebCrypto unavailable');
  const bytes=new TextEncoder().encode(JSON.stringify(['g4-account-device-authority-lease-v1',normalizeOrigin(origin),...tuple]));
  const d=await cryptoImpl.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return 'g4-account-lease-v1-'+hex;
}
function readExistingMeta(indexedDB, dbName, storeName, key){
  return new Promise((resolve,reject)=>{
    if(!indexedDB?.open||typeof indexedDB.databases!=='function'){
      reject(Error('IndexedDB safe enumeration unavailable'));return;
    }
    indexedDB.databases().then(list=>{
      if(!Array.isArray(list)||!list.some(x=>x.name===dbName))fail('Account database is absent; no implicit creation');
      const q=indexedDB.open(dbName);let upgrading=false;
      q.onupgradeneeded=()=>{upgrading=true;try{q.transaction.abort();}catch(_){}};
      q.onerror=()=>reject(q.error||Error('Account DB read failed'));
      q.onblocked=()=>reject(Error('Account DB blocked'));
      q.onsuccess=()=>{
        const db=q.result;
        if(upgrading||!db.objectStoreNames.contains(storeName)){
          db.close();reject(Error('Account DB is not an established schema'));return;
        }
        try{
          const tx=db.transaction(storeName,'readonly');
          const r=tx.objectStore(storeName).get(key);let result;
          r.onsuccess=()=>{result=r.result||null;};
          tx.oncomplete=()=>{db.close();resolve(result);};
          tx.onabort=()=>{db.close();reject(tx.error||Error('Account metadata aborted'));};
          tx.onerror=()=>{};
        }catch(e){db.close();reject(e);}
      };
    }).catch(reject);
  });
}
function make({identityApi,indexedDB,fetchImpl,cryptoImpl,readBinding}={}){
  if(typeof identityApi?.make!=='function'||!indexedDB?.open||typeof fetchImpl!=='function'||!cryptoImpl?.subtle)
    fail('Existing E7b identity module and real browser dependencies required');
  const base=identityApi.make({indexedDB,fetchImpl,cryptoImpl});
  if(typeof base?.verify!=='function'||typeof base?.getVerifiedIdentitySync!=='function')
    fail('Existing verified JWT proof contract missing');
  const bindingReader=readBinding|| (async()=>{
    const [config,session,mirror]=await Promise.all([
      readExistingMeta(indexedDB,'wlp-cloud-shadow-v0','meta','supabase_config'),
      readExistingMeta(indexedDB,'wlp-cloud-shadow-v0','meta','supabase_session'),
      readExistingMeta(indexedDB,'wlp-cloud-v1','sync_meta','authority_mirror')]);
    if(!config?.url||!session?.userId||!mirror?.userId)fail('Missing saved account/Authority binding');
    return {origin:config.url,userId:session.userId,mirrorUserId:mirror.userId,
      deviceKey:mirror.deviceKey,candidateKey:mirror.candidateKey,headVersion:mirror.headVersion};
  });
  let verified=null,verifying=false;
  function checkBinding(binding,id){
    if(!binding||clean(binding.userId)!==clean(id.accountId)||
      clean(binding.mirrorUserId)!==clean(id.accountId)||
      clean(binding.deviceKey)!==clean(id.deviceKey)||
      clean(binding.candidateKey)!==clean(id.candidateKey)||
      Number(binding.headVersion)!==Number(id.headVersion))fail('Saved WLP owner/Authority changed');
    return normalizeOrigin(binding.origin);
  }
  async function verify(){
    if(verifying)fail('Concurrent account proof refused');verifying=true;
    try{
      // This call verifies the CURRENT JWT at /auth/v1/user and the current
      // Canonical Authority; never invent a verified identity from local values.
      const original=await base.verify();
      const before=await bindingReader();
      const origin=checkBinding(before,original);
      const generation=await stableGeneration({identity:original,origin,cryptoImpl});
      const after=await bindingReader();
      if(checkBinding(after,original)!==origin)fail('Supabase project changed during proof');
      const still=base.getVerifiedIdentitySync();
      if(currentTuple(original).join('|')!==currentTuple(still).join('|')||original.generation!==still.generation)
        fail('JWT proof changed during identity binding');
      const candidate=Object.freeze({...original,generation});
      // A switched account or Authority must NEVER be reinterpreted as the
      // previous Journal lease. Clear on any mismatch, not on a token rotation.
      if(verified&&candidate.generation!==verified.generation){verified=null;fail('Journal owner lease changed; do not adopt previous Session');}
      verified=candidate;
      return candidate;
    }catch(error){verified=null;throw error;}finally{verifying=false;}
  }
  function getVerifiedIdentitySync(){
    if(!verified)fail('No prior online proof for this owner lease');
    const baseNow=base.getVerifiedIdentitySync();
    if(fields.some(k=>String(baseNow[k])!==String(verified[k])))fail('Verified account/Authority changed');
    return verified;
  }
  function invalidate(){verified=null;base.invalidate?.();}
  return Object.freeze({verify,getVerifiedIdentitySync,invalidate,
    status:()=>({verified:!!verified,sourceOff:true,refreshHandledByExistingWLP:true})});
}
return Object.freeze({make,stableGeneration,normalizeOrigin});
});
