/* WLP E7b / DEV HOLD — actual read-only Cloud Shadow + Canonical mirror JWT proof.
 * Not an authentication system. Reads existing state, verifies Supabase /auth/v1/user
 * and active Authority server-side. NO enablement, credentials UI, writes or migration.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bAuthenticatedIdentityDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const clean=x=>String(x??'').trim();
const check=(ok,msg)=>{if(!ok)throw Error('E7b auth proof blocked: '+msg);};
function readRow(idb,name,store,key){return new Promise((resolve,reject)=>{
 const q=idb.open(name,1);let created=false;
 q.onupgradeneeded=()=>{created=true;try{q.transaction.abort();}catch(_){}};
 q.onerror=()=>reject(q.error||Error('existing database unavailable'));
 q.onblocked=()=>reject(Error('existing database blocked'));
 q.onsuccess=()=>{
  const db=q.result;
  if(created||!db.objectStoreNames.contains(store)){db.close();reject(Error('existing store not present'));return;}
  const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);let value=null;
  r.onsuccess=()=>{value=r.result||null;};r.onerror=()=>{try{tx.abort();}catch(_){}};
  tx.oncomplete=()=>{db.close();resolve(value);};
  tx.onabort=()=>{db.close();reject(tx.error||Error('existing metadata read failed'));};
 };
});}
function normalizeUrl(value){const u=new URL(clean(value));
 check(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.pathname.replace(/\/+$/,'') , 'invalid Supabase HTTPS project URL');
 return u.origin;
}
function make({indexedDB,fetchImpl,cryptoImpl=root.crypto,now=()=>Date.now(),ttlMs=90000}={}){
 check(indexedDB?.open&&typeof fetchImpl==='function'&&cryptoImpl?.subtle,'IndexedDB, fetch and WebCrypto required');
 check(Number.isSafeInteger(ttlMs)&&ttlMs>0&&ttlMs<=120000,'invalid proof lifetime');
 let proof=null,epoch=0;
 async function sandboxBinding(){
  // Isolated Windows Chrome localhost ONLY. Never use a partial Canonical Mirror
  // or an unrelated Cloud Shadow login as an E7b account proof.
  if(root?.location?.origin!=='http://127.0.0.1:8877')return null;
  const a=await readRow(indexedDB,'wlp-e7b-sandbox-auth-v1','bindings','active');
  check(a?.scope==='e7b-sandbox-phase-d2-capture-only-v1'&&
    a?.url==='https://hnadijqwozygmrpcjqlr.supabase.co'&&
    a?.email==='wlp-e7b-test-a@example.com'&&
    a?.deviceKey==='wlp-e7b-03b-device-a'&&
    a?.candidateKey==='e7b-sandbox-phase03b-a-v1'&&a?.headVersion===1&&
    /^sb_publishable_[A-Za-z0-9._-]+$/.test(a?.publishableKey||'')&&a?.token&&a?.accountId,
    'verified phase D2 sandbox account binding missing or invalid');
  check(Number(a.expiresAt)>now()+15000,'phase D2 sandbox JWT expired; authenticate again');
  return {url:a.url,key:a.publishableKey,token:a.token,accountId:a.accountId,
    deviceKey:a.deviceKey,candidateKey:a.candidateKey,headVersion:a.headVersion,expiresAt:a.expiresAt};
 }
 async function metadata(){
  const sandbox=await sandboxBinding();if(sandbox)return sandbox;
  const [config,session,device,mirror]=await Promise.all([
   readRow(indexedDB,'wlp-cloud-shadow-v0','meta','supabase_config'),
   readRow(indexedDB,'wlp-cloud-shadow-v0','meta','supabase_session'),
   readRow(indexedDB,'wlp-cloud-shadow-v0','meta','shadow_device'),
   readRow(indexedDB,'wlp-cloud-v1','sync_meta','authority_mirror')]);
  check(config?.publishableKey&&session?.accessToken&&session?.userId&&mirror?.userId&&
    mirror?.candidateKey&&mirror?.deviceKey&&Number.isSafeInteger(Number(mirror.headVersion)),
    'existing signed-in metadata or Canonical Authority mirror missing');
  check(session.userId===mirror.userId&&(!device?.deviceKey||device.deviceKey===mirror.deviceKey),
    'local sign-in, device and Canonical Mirror disagree');
  check(Number(session.expiresAt)>now()+15000,'access token expired; refresh in existing Cloud Shadow sign-in first');
  const url=normalizeUrl(config.url),token=clean(session.accessToken);
  return {url,key:clean(config.publishableKey),token,accountId:clean(session.userId),
   deviceKey:clean(mirror.deviceKey),candidateKey:clean(mirror.candidateKey),
   headVersion:Number(mirror.headVersion),expiresAt:Number(session.expiresAt)};
 }
 function same(a,b){return !!a&&!!b&&['url','key','token','accountId','deviceKey','candidateKey','headVersion','expiresAt'].every(k=>a[k]===b[k]);}
 async function readJson(snapshot,path){
  const r=await fetchImpl(snapshot.url+path,{method:'GET',headers:{apikey:snapshot.key,Authorization:'Bearer '+snapshot.token},cache:'no-store'});
  check(r&&r.ok===true,'Supabase server verification rejected');
  const raw=await r.text();let value;
  try{value=JSON.parse(raw);}catch(_){throw Error('invalid Supabase verification JSON');}
  return value;
 }
 async function verify(){
  const mine=++epoch;proof=null; // any concurrent session/Authority transition fails closed
  const before=await metadata();
  const user=await readJson(before,'/auth/v1/user');
  check(user?.id===before.accountId,'Supabase /auth/v1/user account mismatch');
  const heads=await readJson(before,'/rest/v1/wlp_canonical_authority_heads?select=candidate_key,head_version&order=promoted_at.desc&limit=2');
  check(Array.isArray(heads)&&heads.length===1&&heads[0].candidate_key===before.candidateKey&&
    Number(heads[0].head_version)===before.headVersion, 'active Cloud Authority differs from Canonical Mirror');
  const after=await metadata();
  check(mine===epoch&&same(before,after),'identity or generation changed during server verification');
  const bytes=new TextEncoder().encode([before.accountId,before.deviceKey,before.candidateKey,before.headVersion,before.token].join('|'));
  const digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
  check(mine===epoch,'verification invalidated during digest');
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const identity=Object.freeze({verified:true,accountId:before.accountId,deviceKey:before.deviceKey,
    candidateKey:before.candidateKey,headVersion:before.headVersion,generation:'e7b-jwt-proof-'+hash});
  proof={identity,validUntil:Math.min(now()+ttlMs,before.expiresAt-15000)};
  return identity;
 }
 function getVerifiedIdentitySync(){
  // A previously verified device must be able to SAVE REMOTE CONTINUE LOCALLY
  // while offline or after JWT expiry. The separate RPC adapter still verifies
  // a CURRENT JWT against the server before any upload/pull.
  check(proof,'no previously server-verified account generation');
  return proof.identity;
 }
 function invalidate(){epoch++;proof=null;}
 return Object.freeze({verify,getVerifiedIdentitySync,invalidate,status:()=>({verified:!!proof,serverFresh:!!proof&&now()<proof.validUntil})});
}
return Object.freeze({make});
});
