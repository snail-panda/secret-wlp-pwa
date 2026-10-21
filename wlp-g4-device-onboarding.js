/* WLP G4-1 · SOURCE ONLY · explicit FIRST browser device enrollment.
 * Reuses existing Supabase wlp_devices RLS account directory. Never changes
 * a registered / existing device identity; no Library / Outbox / Study writes.
 * Not the existing E7a device-link handler (which requires an installed Mirror).
 */
(() => {
  'use strict';
  const DB='wlp-cloud-shadow-v0',KEY='wlp:device-id:v1',DEVICE='shadow_device';
  const UUID=/^(?:device-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fail=m=>{throw Error(`G4 Device HOLD: ${m}`);};
  const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||Error('Account metadata request failed'));});
  const done=tx=>new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error||Error('Account metadata write aborted'));tx.onerror=()=>no(tx.error||Error('Account metadata write failed'));});
  const validOrigin=v=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname.replaceAll('/','')||u.port)fail('Untrusted project URL');return u.origin;};
  function decideIdentity(legacy,shadow){
    const a=String(legacy||'').trim(),b=String(shadow?.deviceKey||'').trim();
    if(a&&!UUID.test(a)||b&&!UUID.test(b))fail('Legacy or saved Device ID is malformed; preserve it');
    if(a&&b&&a!==b)fail('Browser and Shadow device identities disagree; never overwrite');
    return Object.freeze({deviceKey:a||b||null,needsShadow:!b,needsLegacy:!a,newId:!a&&!b});
  }
  async function open(){
    if(typeof indexedDB.databases!=='function'||!(await indexedDB.databases()).some(x=>x.name===DB))fail('Saved Account DB missing');
    return new Promise((ok,no)=>{const r=indexedDB.open(DB);r.onupgradeneeded=()=>{try{r.transaction.abort();}catch{}no(Error('Account DB unexpectedly absent'));};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||Error('Cannot open saved Account DB'));});
  }
  async function account(){
    const db=await open();try{
      if(!db.objectStoreNames.contains('meta'))fail('Account metadata store missing');
      const tx=db.transaction('meta','readonly'),end=done(tx),s=tx.objectStore('meta');
      const [config,session,device]=await Promise.all([req(s.get('supabase_config')),req(s.get('supabase_session')),req(s.get(DEVICE))]);await end;
      if(!config?.publishableKey||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)||!session?.userId||!session.accessToken||
         Number(session.expiresAt||0)<=Date.now()+60000)fail('Current WLP Cloud login is required; no auto refresh in this candidate');
      return {root:validOrigin(config.url),config,session,device};
    }finally{db.close();}
  }
  async function rest(ctx,path,options={}){
    const response=await fetch(`${ctx.root}${path}`,{method:options.method||'GET',
      headers:{apikey:ctx.config.publishableKey,Authorization:`Bearer ${ctx.session.accessToken}`,...(options.headers||{})},
      body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response.ok)fail(`Cloud ${options.method||'GET'} returned HTTP ${response.status}; no other data were changed`);
    if(response.status===204)return null;
    const text=await response.text();try{return text?JSON.parse(text):null;}catch{fail('Cloud returned invalid JSON');}
  }
  async function verifyOwner(ctx){
    const u=await rest(ctx,'/auth/v1/user');
    if(!u?.id||String(u.id)!==String(ctx.session.userId))fail('Cloud identity and saved WLP account disagree');
  }
  async function found(ctx,deviceKey){
    const q=`/rest/v1/wlp_devices?select=device_key,retired_at&owner_id=eq.${encodeURIComponent(ctx.session.userId)}&device_key=eq.${encodeURIComponent(deviceKey)}&limit=2`;
    const rows=await rest(ctx,q);
    if(!Array.isArray(rows)||rows.length>1)fail('Unexpected device registration response');
    if(rows.length&&rows[0]?.retired_at)fail('This Device ID was retired; do not reactivate automatically');
    return rows.length===1&&rows[0].device_key===deviceKey;
  }
  async function requireFirstBrowser(){
    const gate=window.WLPG4LibraryBoundary;
    if(!gate?.inspect)fail('Local Library safety gate unavailable');
    const proof=await gate.inspect();
    if(proof.verdict?.code!=='FIRST_BROWSER_CANDIDATE')fail(`Only a new, empty browser can enroll here (${proof.verdict?.code||'unknown'})`);
    return proof;
  }
  async function inspect(){
    const proof=await requireFirstBrowser(),ctx=await account();
    if(ctx.session.userId!==proof.remote.userId||ctx.root!==proof.remote.projectOrigin)fail('Account or project moved during inspection');
    await verifyOwner(ctx);
    const id=decideIdentity(localStorage.getItem(KEY),ctx.device);
    const registered=Boolean(id.deviceKey)&&await found(ctx,id.deviceKey);
    return {status:id.deviceKey?(registered?'REGISTERED':'NEEDS_REGISTRATION'):'NEEDS_DEVICE_ID',
      registered,hasLocalId:Boolean(id.deviceKey),
      ownerVerified:true,cloudAuthorityVerified:true,readOnly:true};
  }
  async function reserveIdentity(ctx){
    const original=decideIdentity(localStorage.getItem(KEY),ctx.device);
    const candidate=original.deviceKey||crypto.randomUUID();
    if(!UUID.test(candidate))fail('Generated Device ID is invalid');
    const db=await open();let committed=false;
    try{
      const tx=db.transaction('meta','readwrite'),end=done(tx),store=tx.objectStore('meta');
      const prior=await req(store.get(DEVICE));
      if(prior?.deviceKey){
        if(prior.deviceKey!==candidate){tx.abort();fail('Device identity changed in another tab; do not overwrite');}
      }else{
        store.add({key:DEVICE,deviceKey:candidate,label:'WLP Browser',platform:'Browser',source:'g4-first-browser-source-only'});
      }
      await end;committed=true;
    }finally{db.close();}
    if(!committed)fail('Local Device ID not committed');
    const actual=localStorage.getItem(KEY);
    if(actual&&actual!==candidate)fail('Legacy Device ID was changed concurrently; stop');
    if(!actual)localStorage.setItem(KEY,candidate);
    const after=await account();
    if(after.session.userId!==ctx.session.userId||after.root!==ctx.root||after.device?.deviceKey!==candidate||localStorage.getItem(KEY)!==candidate)
      fail('Device identity did not persist consistently; no Cloud registration');
    return candidate;
  }
  let busy=false;
  async function registerExplicit(){
    if(window.WLPStage7G4ReleasePolicy?.gate('library-install')!==true)
      fail('Normal Stage 7 Library setup has not been release-approved');
    if(busy)fail('Registration already running');busy=true;
    try{
      const first=await requireFirstBrowser(),ctx=await account();
      if(ctx.session.userId!==first.remote.userId||ctx.root!==first.remote.projectOrigin)fail('Cloud owner boundary changed');
      await verifyOwner(ctx);
      // No random ID, local identity write or Cloud POST before the user calls this method.
      const chosen=await reserveIdentity(ctx);
      const second=await requireFirstBrowser();
      if(second.remote.userId!==ctx.session.userId||second.remote.projectOrigin!==ctx.root||
         second.remote.authority.candidateKey!==first.remote.authority.candidateKey||
         second.remote.authority.headVersion!==first.remote.authority.headVersion||
         second.remote.authority.snapshotManifestHash!==first.remote.authority.snapshotManifestHash||
         second.remote.cursor!==first.remote.cursor)fail('Cloud Authority or local data changed during device preparation');
      await verifyOwner(ctx);
      if(!await found(ctx,chosen)){
        await rest(ctx,'/rest/v1/wlp_devices?on_conflict=owner_id,device_key',{
          method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
          body:[{owner_id:ctx.session.userId,device_key:chosen,label:'WLP Browser',platform:'Browser',app_version:'G4-source-only',last_seen_at:new Date().toISOString()}]
        });
      }
      if(!await found(ctx,chosen))fail('Registration was not independently confirmed; do not install Library');
      return Object.freeze({status:'DEVICE_REGISTERED',readback:true,libraryInstalled:false,studyEnabled:false});
    }finally{busy=false;}
  }
  const api=Object.freeze({inspect,registerExplicit,decideIdentity});
  if(typeof window!=='undefined')window.WLPG4DeviceOnboarding=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})();
