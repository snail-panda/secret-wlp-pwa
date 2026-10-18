/* WLP Stage7 / G4: existing-account boundary for normal UI.
 * Reuses the preexisting E7a / G4 Shadow meta schema. No new DB schema,
 * no automatic sign-in/refresh or new-browser install, no sync/write to WLP.
 * The ONLY mutation is an explicitly user-requested sign-in updating the
 * preexisting 'supabase_session' row after exact owner checks.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WLPStage7Account = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const SHADOW='wlp-cloud-shadow-v0', MIRROR='wlp-cloud-v1', OFFICIAL='wlp-official-shadow-p1-v1';
  const fail = msg => { throw Error('WLP account HOLD: ' + msg); };
  const isPublishable = str => /^sb_publishable_[\w-]+$/.test(String(str || ''));
  function cleanOrigin(raw) {
    let u; try { u=new URL(String(raw || '').trim()); } catch (_) { fail('Invalid existing Supabase URL'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port ||
        u.pathname.replace(/\/+$/,'') || !u.hostname.endsWith('.supabase.co'))
      fail('Existing Cloud project origin is invalid');
    return u.origin;
  }
  function make({ indexedDB, fetchImpl, cryptoImpl } = {}) {
    if (!indexedDB || typeof indexedDB.databases !== 'function') fail('Safe IndexedDB discovery unavailable');
    const loadDb = async (name) => {
      const names=await indexedDB.databases();
      if (!names.some(e=>e.name===name)) return null;
      return new Promise((resolve,reject)=>{
        const q=indexedDB.open(name);
        q.onupgradeneeded=()=>{try{q.transaction.abort();}catch(_){}reject(Error('Unexpected DB upgrade; no data changed'));};
        q.onsuccess=()=>resolve(q.result);
        q.onerror=()=>reject(q.error||Error('Could not read existing DB'));
        q.onblocked=()=>reject(Error('Existing DB blocked'));
      });
    };
    function request(r) {return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error||Error('IndexedDB read failed'));});}
    function read(db,store,key) {
      if(!db)return Promise.resolve(null);
      if(!db.objectStoreNames.contains(store))fail('Established '+store+' schema missing');
      return request(db.transaction(store,'readonly').objectStore(store).get(key));
    }
    function count(db,store) {
      if(!db)return Promise.resolve(null);
      if(!db.objectStoreNames.contains(store))fail('Established '+store+' schema missing');
      return request(db.transaction(store,'readonly').objectStore(store).count());
    }
    async function inspect() {
      const dbs=await Promise.all([loadDb(SHADOW),loadDb(MIRROR),loadDb(OFFICIAL)]);
      try {
        const [config,session,mirror,outbox,officialRaw]=await Promise.all([
          read(dbs[0],'meta','supabase_config'),read(dbs[0],'meta','supabase_session'),
          read(dbs[1],'sync_meta','authority_mirror'),count(dbs[1],'sync_outbox'),read(dbs[2],'meta','active')
        ]);
        return {config,session,mirror,outbox,official:officialRaw?.value||null};
      } finally {dbs.forEach(db=>db?.close());}
    }
    async function ownerKey(url,userId) {
      if (!cryptoImpl?.subtle?.digest) fail('WebCrypto unavailable for Library ownership check');
      const b=new TextEncoder().encode('wlp-shadow-p1b|'+url+'|'+userId);
      const d=await cryptoImpl.subtle.digest('SHA-256',b);
      return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    async function ownerGuard(state, id, origin) {
      if (!id) fail('Cloud Auth did not verify a User ID');
      if (state.session?.userId && state.session.userId!==id) fail('A different saved Cloud account is present');
      if (state.mirror?.userId && state.mirror.userId!==id) fail('Local Canonical Mirror belongs to a different account');
      if (state.official?.accountKey && state.official.accountKey!==await ownerKey(origin,id))
        fail('Local Official Library belongs to a different account');
    }
    function configOf(state) {
      if (!state.config?.url || !state.config?.publishableKey) fail('Cloud project not configured on this browser; no project settings were changed');
      const url=cleanOrigin(state.config.url);
      if (!isPublishable(state.config.publishableKey)) fail('Existing publishable key is invalid');
      return {url,key:state.config.publishableKey};
    }
    async function readStatus() {
      const state=await inspect();
      return Object.freeze({configured:!!state.config?.url&&!!state.config?.publishableKey,
        signedIn:!!state.session?.userId, email:String(state.session?.email||''),
        expiresAt:Number(state.session?.expiresAt||0), mirrorPresent:!!state.mirror,
        outboxCount:state.outbox, locallyStored:true, cloudVerified:false});
    }
    async function signIn(email,password) {
      if(typeof fetchImpl!=='function')fail('Network unavailable');
      const before=await inspect(); const cfg=configOf(before);
      const mail=String(email||'').trim();
      if(!mail || !password)fail('Email and password required');
      const response=await fetchImpl(cfg.url+'/auth/v1/token?grant_type=password',{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',apikey:cfg.key},
        body:JSON.stringify({email:mail,password})});
      let data;try{data=await response.json();}catch(_){data={};}
      if(!response.ok)fail('Sign-in failed ('+response.status+')');
      if(!data?.user?.id || !data?.access_token || !data?.refresh_token || !Number.isFinite(Number(data.expires_in)))
        fail('Incomplete Supabase Auth response');
      // Verify live user identity before making any local mutation.
      const who=await fetchImpl(cfg.url+'/auth/v1/user', {method:'GET',cache:'no-store',
        headers:{apikey:cfg.key,Authorization:'Bearer '+data.access_token}});
      if(!who.ok)fail('Cloud account verification failed ('+who.status+')');
      let live;try{live=await who.json();}catch(_){live={};}
      if(!live?.id || live.id!==data.user.id)fail('Cloud User ID mismatch');
      await ownerGuard(before,live.id,cfg.url);
      const after=await inspect();
      if(after.config?.url!==before.config?.url || after.config?.publishableKey!==before.config?.publishableKey ||
         (after.session?.refreshToken||null)!==(before.session?.refreshToken||null) ||
         (after.mirror?.userId||null)!==(before.mirror?.userId||null) ||
         (after.official?.accountKey||null)!==(before.official?.accountKey||null) ||
         after.outbox!==before.outbox)fail('Account/Library state changed during sign-in; nothing stored');
      await ownerGuard(after,live.id,cfg.url);
      const db=await loadDb(SHADOW);if(!db)fail('Account storage absent');
      try {
        if(!db.objectStoreNames.contains('meta'))fail('Account meta schema missing');
        await new Promise((resolve,reject)=>{
          const tx=db.transaction('meta','readwrite'),store=tx.objectStore('meta');
          const r=store.get('supabase_session');
          r.onsuccess=()=>{
            if((r.result?.refreshToken||null)!==(before.session?.refreshToken||null)) {tx.abort();return;}
            store.put({key:'supabase_session',userId:live.id,email:live.email||mail,
              accessToken:data.access_token,refreshToken:data.refresh_token,
              expiresAt:Date.now()+Math.max(60,Number(data.expires_in))*1000,
              savedAt:new Date().toISOString()});
          };
          tx.oncomplete=resolve;
          tx.onabort=()=>reject(Error('Account state changed during save; nothing committed'));
          tx.onerror=()=>reject(tx.error||Error('Account save failed'));
        });
      } finally {db.close();}
      return Object.freeze({saved:true,userId:live.id,cloudVerifiedAtSignIn:true,
        libraryInstalled:false,syncStarted:false});
    }
    return Object.freeze({readStatus,signIn});
  }
  return Object.freeze({make});
});
