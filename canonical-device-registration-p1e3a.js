/* WLP P1-E3a — opt-in, explicit first-browser Cloud Device link.
   Read-only inspection by default. Registration happens ONLY after an explicit
   button click and after matching authenticated account, Official Projection,
   Canonical Mirror, Shadow device and legacy WLP Device ID. Never issues a
   new device identity; never touches study data, outbox, cursor or cards. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('wlpDeviceLink') !== '1') return;

  const DB_SHADOW = 'wlp-cloud-shadow-v0';
  const DB_MIRROR = 'wlp-cloud-v1';
  const DB_OFFICIAL = 'wlp-official-shadow-p1-v1';
  const $ = id => document.getElementById(id);
  const state = {busy:false, lastStatus:'unknown'};
  const fail = msg => {throw new Error(msg);};

  function openExisting(name, store) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      let created = false;
      request.onupgradeneeded = () => {created = true; try{request.transaction.abort();}catch(_){}};
      request.onsuccess = () => {
        const db = request.result;
        if (created || !db.objectStoreNames.contains(store)) {
          db.close(); reject(new Error(`Existing ${name}/${store} not available; nothing was changed.`));
        } else resolve(db);
      };
      request.onerror = () => reject(new Error(`Cannot open existing ${name}; no data was changed.`));
      request.onblocked = () => reject(new Error(`Existing ${name} is blocked by another tab.`));
    });
  }
  async function getRow(name, store, key) {
    const db = await openExisting(name,store);
    try {
      return await new Promise((resolve,reject) => {
        const request=db.transaction(store,'readonly').objectStore(store).get(key);
        request.onsuccess=()=>resolve(request.result||null);
        request.onerror=()=>reject(new Error(`Cannot read existing ${name}/${store}.`));
      });
    } finally {db.close();}
  }
  async function fingerprint(url, userId) {
    const endpoint = new URL(String(url||''));
    if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname.replace(/\//g,'')) fail('Unrecognized Cloud project endpoint; account link blocked.');
    const bytes = new TextEncoder().encode(`wlp-shadow-p1b|${endpoint.origin}|${userId}`);
    const hash = await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function accountAndDeviceBoundary() {
    const api=window.WLPCloudShadowSupabase;
    if(!api?.ensureSession || !api?.getDevice || !api?.registerDevice || !api?.rest) fail('Existing Cloud Shadow API is not ready. Open Cloud Shadow again.');
    const [shadowDevice, shadowConfig, shadowSession, mirror, officialRow] = await Promise.all([
      getRow(DB_SHADOW,'meta','shadow_device'),
      getRow(DB_SHADOW,'meta','supabase_config'),
      getRow(DB_SHADOW,'meta','supabase_session'),
      getRow(DB_MIRROR,'sync_meta','authority_mirror'),
      getRow(DB_OFFICIAL,'meta','active')
    ]);
    if(!shadowDevice?.deviceKey || !mirror?.deviceKey || !mirror?.userId || !officialRow?.value?.accountKey) fail('Mirror, Official Projection or saved Device identity is missing. No registration.');
    const session=await api.ensureSession();
    const device=await api.getDevice();
    if(!session?.userId || !shadowSession?.userId || !shadowConfig?.url) fail('Supabase account session is incomplete.');
    if(session.userId!==shadowSession.userId || mirror.userId!==session.userId || api.getState?.().userId!==session.userId) fail('Account identity mismatch; registration blocked.');
    const expected=await fingerprint(shadowConfig.url, session.userId);
    if(officialRow.value.source!=='cloud' || expected!==officialRow.value.accountKey || mirror.candidateKey!==officialRow.value.authorityKey) fail('Official/Mirror account or Authority mismatch; registration blocked.');
    const mirrorDevice=String(mirror.deviceKey), shadowKey=String(shadowDevice.deviceKey);
    if(!/^(?:device-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(mirrorDevice)) fail('Mirror Device ID is invalid; registration blocked.');
    if(shadowKey!==mirrorDevice || String(device.deviceKey)!==mirrorDevice) fail('Mirror/Shadow Device ID mismatch; registration blocked.');
    const legacyId=String(localStorage.getItem('wlp:device-id:v1')||'').trim();
    if(legacyId && legacyId!==mirrorDevice) fail('WLP/Canonical Mirror Device ID mismatch; registration blocked.');
    // Refresh tokens through the existing Shadow API; verify actual server identity,
    // not just locally cached claims. This GET does not register a device.
    const response=await fetch(`${String(shadowConfig.url).replace(/\/+$/,'')}/auth/v1/user`,{
      method:'GET',headers:{apikey:shadowConfig.publishableKey,Authorization:`Bearer ${session.accessToken}`},
      credentials:'omit',cache:'no-store',redirect:'error'
    });
    if(!response.ok) fail(`Supabase account verification failed (HTTP ${response.status}); no registration.`);
    const current=await response.json();
    if(String(current?.id||'')!==String(session.userId)) fail('Authenticated Cloud account differs from installed Mirror; no registration.');
    return {api,accountId:session.userId,deviceKey:mirrorDevice,deviceLabel:String(shadowDevice.label||'')};
  }
  async function readCloudRegistration(context) {
    // Select scoped to both owner and identity. Do not copy IDs into the UI.
    const q=`wlp_devices?select=device_key&owner_id=eq.${encodeURIComponent(context.accountId)}&device_key=eq.${encodeURIComponent(context.deviceKey)}&limit=2`;
    const response=await context.api.rest(q);
    if(!Array.isArray(response.data)) fail('Device registration query returned an unexpected result.');
    if(response.data.length>1) fail('Duplicate device registration rows found; no automatic changes.');
    return response.data.length===1 && String(response.data[0].device_key)===context.deviceKey;
  }
  function status(message, kind='') {
    const node=$('p1e3a-status');if(!node)return;
    node.textContent=message;
    node.style.color=kind==='ok'?'#205c43':kind==='error'?'#9a312a':'#345e5b';
  }
  function setBusy(value) {
    state.busy=Boolean(value);
    $('p1e3a-check').disabled=state.busy;
    $('p1e3a-register').disabled=state.busy || state.lastStatus!=='missing';
  }
  async function inspect() {
    setBusy(true);
    state.lastStatus='unknown';
    status('Checking saved account and Device IDs, then Cloud registration. No changes are made…');
    try {
      const context=await accountAndDeviceBoundary();
      const found=await readCloudRegistration(context);
      state.lastStatus=found?'registered':'missing';
      if(found) status('PASS · This browser’s existing Mirror Device ID is registered for the signed-in Cloud account. No action needed.','ok');
      else status('CHECK · Local Device IDs and account match, but no matching Cloud device registration was returned. You may register the existing ID below.');
    } catch(error) {state.lastStatus='blocked';status(`BLOCKED · ${String(error?.message||error)} No device registration was attempted.`,'error');}
    finally{setBusy(false);}
  }
  async function register() {
    // User-initiated only. Recheck the boundary and absence immediately before mutation.
    if(state.busy || state.lastStatus!=='missing')return;
    setBusy(true);status('Rechecking authenticated account and existing device before registering…');
    try {
      const context=await accountAndDeviceBoundary();
      if(await readCloudRegistration(context)) {
        state.lastStatus='registered';status('PASS · Already registered. No Cloud write needed.','ok');return;
      }
      const device=await context.api.registerDevice();
      if(String(device?.deviceKey||'')!==context.deviceKey) fail('Device ID changed during registration; stop and inspect.');
      if(!(await readCloudRegistration(context))) fail('Registration could not be verified from Cloud. Do not attempt Study writes.');
      state.lastStatus='registered';
      status('PASS · Existing Device ID registered and verified for this account. Card data, Outbox, Cursor and Device Label were not changed.','ok');
    } catch(error){state.lastStatus='blocked';status(`CHECK · ${String(error?.message||error)} Study writes must remain stopped.`,'error');}
    finally{setBusy(false);}
  }
  function mount() {
    const main=document.querySelector('main.shadow-page');
    const connection=$('device-key')?.closest('section.panel');
    if(!main || !connection)return;
    const panel=document.createElement('section');panel.className='panel';panel.id='p1e3a-device-link';
    panel.innerHTML=`<div class="panel-head"><div><h2>P1-E3a · Existing Device registration</h2><p>Opt-in first-browser handoff check. Verifies saved Mirror, Official account, Shadow Device ID and Cloud ownership. Does not generate a new Device ID.</p></div></div><p class="status-line" id="p1e3a-status" aria-live="polite">Click Check registration. No Cloud writes occur during the check.</p><div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0"><button type="button" class="action" id="p1e3a-check">Check registration (read only)</button><button type="button" class="action" id="p1e3a-register" disabled>Register this existing Device ID</button></div><p class="muted" style="font-size:.82rem">Registration changes only the account’s Cloud device directory through the EXISTING registerDevice() method, and only after you explicitly click Register. It does not run Study, Sync, Mirror Install or Upload Shadow. The current Device Label remains unchanged.</p>`;
    connection.insertAdjacentElement('afterend',panel);
    $('p1e3a-check').addEventListener('click',()=>{void inspect();});
    $('p1e3a-register').addEventListener('click',()=>{void register();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
