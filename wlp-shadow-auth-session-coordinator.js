/* WLP G4 integration candidate — single cross-tab Supabase refresh coordination.
 * SOURCE ONLY until reviewed deployment. Import has NO effects: no indexedDB,
 * network, localStorage, listeners or Service Worker operation.
 * Shares the EXACT Web Lock / CAS protocol with G4's proven freshness adapter.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPShadowAuthSessionCoordinatorSOURCEOFF=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const DB='wlp-cloud-shadow-v0',STORE='meta',SESSION='supabase_session',CONFIG='supabase_config';
const LOCK='wlp:g4:shadow-auth-refresh:v1';
const fail=s=>{throw Error('WLP SHARED AUTH HOLD: '+s);};
const check=(v,s)=>{if(!v)fail(s);};
function urlFor(raw){let u;try{u=new URL(String(raw||''));}catch(_){fail('Supabase project URL missing');}
 check(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
  !u.pathname.replace(/\/+$/,'')&&!u.port,'invalid Supabase project URL');return u.origin;}
function openExisting(indexedDB){return new Promise((resolve,reject)=>{
 const rq=indexedDB.open(DB);let upgraded=false;
 rq.onupgradeneeded=()=>{upgraded=true;try{rq.transaction.abort();}catch(_){}};
 rq.onerror=()=>reject(rq.error||Error('Shadow IDB missing'));
 rq.onblocked=()=>reject(Error('Shadow IDB blocked'));
 rq.onsuccess=()=>{const db=rq.result;if(upgraded||!db.objectStoreNames.contains(STORE)){
  db.close();reject(Error('Shadow IDB schema unavailable'));return;}resolve(db);};
});}
async function get(indexedDB,key){const db=await openExisting(indexedDB);try{return await new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE,'readonly');let value=null;const q=tx.objectStore(STORE).get(key);
 q.onsuccess=()=>{value=q.result||null;};q.onerror=()=>{try{tx.abort();}catch(_){}};
 tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('auth read aborted'));
 });}finally{db.close();}}
async function snapshot(indexedDB){const [session,config]=await Promise.all([get(indexedDB,SESSION),get(indexedDB,CONFIG)]);
 check(session?.userId&&session.accessToken&&session.refreshToken,'signed-in account session missing');
 check(config?.publishableKey,'Supabase key missing');return {session,config,origin:urlFor(config.url)};
}
function sameOwner(a,b){return a.session.userId===b.session.userId&&a.origin===b.origin&&
 a.config.publishableKey===b.config.publishableKey;}
async function commitCAS(indexedDB,previous,next){const db=await openExisting(indexedDB);try{
 return await new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);let failure;
 const q=store.get(SESSION);
 q.onsuccess=()=>{try{const cur=q.result;
  check(cur?.userId===previous.userId&&cur.accessToken===previous.accessToken&&
   cur.refreshToken===previous.refreshToken,'session rotated concurrently');
  store.put({...cur,...next,key:SESSION,savedAt:new Date().toISOString()});
 }catch(e){failure=e;try{tx.abort();}catch(_){}}};
 q.onerror=()=>{failure=q.error||Error('session CAS read failed');try{tx.abort();}catch(_){}};
 tx.oncomplete=()=>resolve(true);tx.onabort=()=>reject(failure||tx.error||Error('session CAS rejected'));
 });}finally{db.close();}}
function make({indexedDB,fetchImpl,locks,now=()=>Date.now()}={}){
 check(indexedDB?.open&&typeof fetchImpl==='function'&&typeof now==='function','browser dependencies missing');
 let inflight=null;
 async function ensureFresh({minimumMs=60000,force=false}={}){
  check(Number.isInteger(minimumMs)&&minimumMs>=1000&&minimumMs<=180000,'invalid token threshold');
  const before=await snapshot(indexedDB);
  if(!force&&Number(before.session.expiresAt)>now()+minimumMs)
    return Object.freeze({session:before.session,renewed:false});
  check(locks?.request&&typeof locks.request==='function',
    'cross-tab Web Locks unavailable; do not race token rotation');
  return locks.request(LOCK,{mode:'exclusive'},async()=>{
   const latest=await snapshot(indexedDB);
   check(sameOwner(before,latest),'account/project changed during refresh');
   // Another WLP tab already renewed the token. Never re-use the spent refresh token.
   if(latest.session.refreshToken!==before.session.refreshToken){
    check(Number(latest.session.expiresAt)>now()+minimumMs,'concurrent replacement token already expired');
    return Object.freeze({session:latest.session,renewed:false});
   }
   if(!force&&Number(latest.session.expiresAt)>now()+minimumMs)
    return Object.freeze({session:latest.session,renewed:false});
   const res=await fetchImpl(latest.origin+'/auth/v1/token?grant_type=refresh_token',{
    method:'POST',headers:{apikey:latest.config.publishableKey,'Content-Type':'application/json'},
    cache:'no-store',body:JSON.stringify({refresh_token:latest.session.refreshToken})});
   check(res?.ok===true,'Supabase token refresh rejected; local data retained');
   let data;try{data=await res.json();}catch(_){fail('invalid refresh JSON');}
   check(data?.user?.id===latest.session.userId&&data.access_token&&data.refresh_token&&
    Number.isFinite(Number(data.expires_in))&&Number(data.expires_in)>0,
    'refresh changed account or returned incomplete credentials');
   const updated={accessToken:data.access_token,refreshToken:data.refresh_token,
    userId:latest.session.userId,email:data.user?.email||latest.session.email||'',
    expiresAt:now()+Math.max(60,Number(data.expires_in))*1000};
   check(updated.expiresAt>now()+minimumMs,'renewed token lifetime too short');
   const precommit=await snapshot(indexedDB);
   check(sameOwner(latest,precommit),'owner/project changed during HTTP refresh');
   // A separate sign-in must never be overwritten; even a same-user sign-in
   // rotates the token, so require the exact previously read credentials.
   await commitCAS(indexedDB,latest.session,updated);
   const after=await snapshot(indexedDB);
   check(sameOwner(latest,after)&&after.session.accessToken===updated.accessToken&&
    after.session.refreshToken===updated.refreshToken,'renewed token read-back mismatch');
   return Object.freeze({session:after.session,renewed:true});
  });
 }
 function run(options){if(inflight)return inflight;const p=ensureFresh(options);inflight=p;
  void p.finally(()=>{if(inflight===p)inflight=null;}).catch(()=>{});return p;}
 return Object.freeze({ensureFresh:run});
}
return Object.freeze({make,lockName:LOCK});
});
