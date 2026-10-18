/* G4-1 — Scoped WLP Shadow JWT freshness for the PROTECTED first-browser
 * Account -> Journal path. This does not replace the v400 canonical sync.
 * Uses cross-tab Web Locks and an IDB compare-and-swap; never changes owner,
 * Authority, existing Library, Journal, Canonical Outbox or tokens on import.
 * SOURCE OFF until the full normal Study / Cloud release is approved.
 */
(function(root,factory){const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4SharedAuthFreshnessSOURCEOFF=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const SHADOW='wlp-cloud-shadow-v0', MIRROR='wlp-cloud-v1';
const fail=reason=>{throw Error('G4 account freshness HOLD: '+reason);};
const check=(p,s)=>{if(!p)fail(s);};
const clean=x=>String(x??'').trim();
function validUrl(value){
 let url;try{url=new URL(clean(value));}catch(_){fail('missing Supabase project URL');}
 check(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
  !url.pathname.replace(/\/+$/,'')&&url.port==='', 'invalid Supabase project URL');
 return url.origin;
}
async function exists(indexedDB,name){
 check(typeof indexedDB?.databases==='function','safe IndexedDB enumeration unavailable');
 const list=await indexedDB.databases();
 check(Array.isArray(list),'invalid database inventory');
 return list.some(d=>d?.name===name);
}
async function openExisting(indexedDB,name,store){
 check(await exists(indexedDB,name),'missing existing '+name);
 return new Promise((resolve,reject)=>{
  let created=false;const request=indexedDB.open(name);
  request.onupgradeneeded=()=>{created=true;try{request.transaction.abort();}catch(_){}};
  request.onerror=()=>reject(request.error||Error('existing database unavailable'));
  request.onblocked=()=>reject(Error('existing database blocked'));
  request.onsuccess=()=>{
   const db=request.result;
   if(created||!db.objectStoreNames.contains(store)){
    db.close();reject(Error('existing database store missing'));return;
   }
   resolve(db);
  };
 });
}
async function read(indexedDB,name,store,key){
 const db=await openExisting(indexedDB,name,store);
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readonly');let value;
  const request=tx.objectStore(store).get(key);
  request.onsuccess=()=>{value=request.result||null;};
  request.onerror=()=>{try{tx.abort();}catch(_){}};
  tx.oncomplete=()=>resolve(value);
  tx.onabort=()=>reject(tx.error||Error('metadata read aborted'));
  tx.onerror=()=>{};
 });}finally{db.close();}
}
async function state(indexedDB){
 const [config,session,mirror,device]=await Promise.all([
  read(indexedDB,SHADOW,'meta','supabase_config'),
  read(indexedDB,SHADOW,'meta','supabase_session'),
  read(indexedDB,MIRROR,'sync_meta','authority_mirror'),
  read(indexedDB,SHADOW,'meta','shadow_device')]);
 check(config?.publishableKey&&session?.refreshToken&&session?.accessToken&&session?.userId,
  'existing WLP account session missing');
 check(mirror?.userId===session.userId&&mirror?.deviceKey&&mirror?.candidateKey&&
  Number.isSafeInteger(Number(mirror.headVersion))&&Number(mirror.headVersion)>=1,
  'local account/Authority binding missing or changed');
 if(device?.deviceKey)check(device.deviceKey===mirror.deviceKey,'local device binding differs');
 return {origin:validUrl(config.url),key:clean(config.publishableKey),session,mirror};
}
function sameAccount(a,b){return a.origin===b.origin&&a.key===b.key&&
 a.session.userId===b.session.userId&&a.mirror.userId===b.mirror.userId&&
 a.mirror.deviceKey===b.mirror.deviceKey&&a.mirror.candidateKey===b.mirror.candidateKey&&
 Number(a.mirror.headVersion)===Number(b.mirror.headVersion);}
async function saveRotated(indexedDB,previous,newSession){
 const db=await openExisting(indexedDB,SHADOW,'meta');
 try{return await new Promise((resolve,reject)=>{
  let failure=null;
  const tx=db.transaction('meta','readwrite');const store=tx.objectStore('meta');
  const req=store.get('supabase_session');
  req.onsuccess=()=>{try{
   const current=req.result;
   check(current?.userId===previous.session.userId&&
    current.accessToken===previous.session.accessToken&&
    current.refreshToken===previous.session.refreshToken,
    'account session changed during token renewal');
   store.put({...current,...newSession,key:'supabase_session',savedAt:new Date().toISOString()});
  }catch(e){failure=e;try{tx.abort();}catch(_){}}};
  req.onerror=()=>{failure=req.error||Error('session CAS read failed');try{tx.abort();}catch(_){}};
  tx.oncomplete=()=>resolve(true);
  tx.onabort=()=>reject(failure||tx.error||Error('session CAS aborted'));
  tx.onerror=()=>{};
 });}finally{db.close();}
}
function make({indexedDB,fetchImpl,locks,now=()=>Date.now(),minimumMs=90000}={}){
 check(indexedDB?.open&&typeof fetchImpl==='function'&&typeof now==='function', 'browser dependencies unavailable');
 check(Number.isSafeInteger(minimumMs)&&minimumMs>=20000&&minimumMs<=180000,
  'invalid token freshness threshold');
 let inFlight=null;
 async function refreshLocked(){
  const previous=await state(indexedDB);
  if(Number(previous.session.expiresAt)>now()+minimumMs)
   return Object.freeze({fresh:true,renewed:false});
  check(locks&&typeof locks.request==='function',
   'cross-tab Web Locks unavailable; leave session unchanged');
  return locks.request('wlp:g4:shadow-auth-refresh:v1',{mode:'exclusive'},async()=>{
   const latest=await state(indexedDB);
   check(sameAccount(previous,latest),'account/Authority changed before refresh');
   if(Number(latest.session.expiresAt)>now()+minimumMs)
    return Object.freeze({fresh:true,renewed:false});
   let response;
   try{response=await fetchImpl(latest.origin+'/auth/v1/token?grant_type=refresh_token',{
    method:'POST',headers:{apikey:latest.key,'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:latest.session.refreshToken}),cache:'no-store'});
   }catch(_){fail('token refresh network unavailable; local data preserved');}
   check(response?.ok===true,'Supabase token renewal rejected; sign in again without clearing data');
   let data;
   try{data=JSON.parse(await response.text());}catch(_){fail('invalid Supabase renewal response');}
   check(data?.user?.id===latest.session.userId&&clean(data.access_token)&&
    clean(data.refresh_token)&&Number.isFinite(Number(data.expires_in))&&Number(data.expires_in)>0,
    'renewal changed user or returned incomplete credentials');
   const updated={accessToken:data.access_token,refreshToken:data.refresh_token,
    userId:latest.session.userId,email:data.user.email||latest.session.email||'',
    expiresAt:now()+Math.max(60,Number(data.expires_in))*1000};
   check(updated.expiresAt>now()+minimumMs,'new Supabase credentials expire too soon');
   const beforeCommit=await state(indexedDB);
   check(sameAccount(latest,beforeCommit),'account/Authority changed during refresh');
   await saveRotated(indexedDB,latest,updated);
   const afterCommit=await state(indexedDB);
   check(sameAccount(latest,afterCommit)&&
    afterCommit.session.accessToken===updated.accessToken&&
    afterCommit.session.refreshToken===updated.refreshToken,
    'new session did not survive read-back');
   return Object.freeze({fresh:true,renewed:true});
  });
 }
 function ensureFresh(){
  if(inFlight)return inFlight;
  const task=refreshLocked();inFlight=task;
  void task.finally(()=>{if(inFlight===task)inFlight=null;}).catch(()=>{});
  return task;
 }
 return Object.freeze({ensureFresh,status:()=>Object.freeze({sourceOff:true,refreshOnly:true})});
}
return Object.freeze({make});
});
