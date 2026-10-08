/* WLP P1-C3 · read-only authenticated ownership check and in-memory HOLD review.
   No IndexedDB writes, no localStorage writes, no Cloud mutation, no cutover.
   The current Supabase identity is verified by /auth/v1/user, NOT assumed from
   a locally stored userId. Legacy edits and Canonical values are never exported. */
(() => {
  'use strict';
  const DB='wlp-cloud-shadow-v0';
  const HEX64=/^[a-f0-9]{64}$/i;
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

  async function accountKey(url,remoteUserId){
    assert(typeof url==='string'&&url.length&&typeof remoteUserId==='string'&&remoteUserId.length,'Cloud identity missing');
    const bytes=new TextEncoder().encode(`wlp-shadow-p1b|${url.replace(/\/+$/,'')}|${remoteUserId}`);
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  function assertOwnership(meta,session,remoteUser,computedKey){
    assert(meta&&meta.source==='cloud'&&HEX64.test(String(meta.accountKey||'')),'No Cloud-account-bound local projection');
    assert(typeof session?.userId==='string'&&session.userId.length>0,'Local Cloud session has no account ID');
    assert(typeof remoteUser?.id==='string'&&remoteUser.id.length>0,'Server has not confirmed an authenticated account');
    assert(remoteUser.id===session.userId,'Local session and authenticated server account differ — BLOCKED');
    assert(HEX64.test(String(computedKey||''))&&computedKey===meta.accountKey,'Authenticated account does not own the installed Local Projection — BLOCKED');
    return {status:'PASS',accountMatch:true,generation:meta.generation,cursor:meta.cursor};
  }

  function heldComparisons(master,byWid,overrides,policy){
    assert(master instanceof Map&&byWid instanceof Map,'Canonical comparison is not ready');
    assert(policy?.status==='REVIEW REQUIRED'&&Array.isArray(policy.held),'Expected P1-C2 HOLD policy');
    return policy.held.map(item=>{
      const wid=item.wid,field=item.field,base=master.get(wid),canonical=byWid.get(wid),legacy=overrides[String(wid)];
      assert(base&&canonical?.effectiveContent&&legacy&&own(legacy,field),`Incomplete HOLD data WID${wid} ${field}`);
      const names={'Word':'word','IPA':'ipa','Part of Speech':'part_of_speech','Definition':'definition','Synonym(s)':'synonyms','Example Sentence':'example_sentence','Note(s)':'notes','Category':'category','Source':'source'};
      assert(own(names,field),'Unknown HOLD field');
      const officialValue=canonical.effectiveContent[names[field]],localValue=legacy[field];
      assert(typeof officialValue==='string'&&typeof localValue==='string','HOLD field is not text');
      assert(officialValue!==localValue,`HOLD field unexpectedly matches WID${wid} ${field}`);
      return {wid,field,canonical:officialValue,local:localValue,master:String(base[field]??''),classification:item.classification};
    });
  }

  // Read only from the pre-existing Cloud session DB; never initialize a new one.
  async function readSession(){
    assert(typeof indexedDB.databases==='function','Safe Cloud session DB discovery is unavailable');
    const dbs=await indexedDB.databases();
    assert(dbs.some(d=>d.name===DB),'Cloud session DB is missing; sign in from the WLP Cloud page first');
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB);request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('Cloud session DB was not initialized'));};
      request.onsuccess=()=>{if(!request.result.objectStoreNames.contains('meta')){request.result.close();reject(new Error('Cloud session store is missing'));}else resolve(request.result);};
      request.onerror=()=>reject(request.error||new Error('Could not open Cloud session storage'));
      request.onblocked=()=>reject(new Error('Cloud session DB blocked'));
    });
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('meta','readonly'),store=tx.objectStore('meta');
        let config=null,session=null;
        const c=store.get('supabase_config'),s=store.get('supabase_session');
        c.onsuccess=()=>{config=c.result||null;};s.onsuccess=()=>{session=s.result||null;};
        tx.oncomplete=()=>resolve({config,session});
        tx.onabort=()=>reject(tx.error||new Error('Cloud session read aborted'));
        tx.onerror=()=>reject(tx.error||new Error('Cloud session read failed'));
      });
    }finally{db.close();}
  }

  async function verifyLiveAccount(meta){
    const {config,session}=await readSession();
    assert(config?.url&&config?.publishableKey&&session?.accessToken&&session?.userId,'Cloud sign-in is missing or incomplete. Open Cloud Shadow and sign in, then retry.');
    const url=new URL(String(config.url));
    assert(url.protocol==='https:'&&url.username===''&&url.password===''&&url.search===''&&url.hash===''&&url.pathname.replace(/\//g,'')==='','Unsafe Cloud endpoint configuration');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    let response;
    try{
      response=await fetch(`${url.origin}/auth/v1/user`,{
        method:'GET',headers:{apikey:String(config.publishableKey),Authorization:`Bearer ${session.accessToken}`},
        mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal
      });
    }finally{clearTimeout(timeout);}
    assert(response.ok,`Authenticated account check failed (HTTP ${response.status}). Re-open WLP Cloud and sign in, then retry.`);
    const remote=await response.json();
    const computed=await accountKey(url.origin,String(remote?.id||''));
    const check=assertOwnership(meta,session,remote,computed);
    // Deny a session switch while the remote account was being checked.
    const after=await readSession();
    assert(after.config?.url===config.url&&after.session?.userId===session.userId&&after.session?.accessToken===session.accessToken,'Cloud account/session changed during verification. Retry.');
    return check;
  }
  const api=Object.freeze({accountKey,assertOwnership,heldComparisons,readSession,verifyLiveAccount});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.WLPP1C3Review=api;
})();
