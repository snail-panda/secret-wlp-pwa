/* WLP v1.8.6.393 — Account-owned Local Edit Canonical write.
   Scope:
   - Local Edit is a reversible account-owned overlay; official cards/card_content remain untouched;
   - create/update/resurrection uses one guarded card_local_overrides upsert;
   - Revert emits one guarded tombstone and removes the localStorage projection only after Canonical ACK;
   - source writes wait behind any already-pending Canonical action so Learning Metadata saves can complete first;
   - localStorage remains the compatibility projection/cache while Supabase owns the accepted overlay state;
   - no Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.393-local-edit-canonical-v1';
  const LOCAL_KEY='wlp:local-overrides:v1';
  const PENDING_KEY='WLP Canonical Local Edit Pending V1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',CONTENT_STORE='card_content',META_KEY='authority_mirror';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_DB_VERSION=1,SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const REMOTE_TABLE='wlp_card_local_overrides_v1';
  const LOGICAL_TABLE='card_local_overrides';
  const FIELDS=['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const state={busy:false,active:null,preflightWords:new Set(),report:null};

  const clean=v=>String(v??'').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const utf8=v=>new TextEncoder().encode(String(v??''));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',utf8(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const h=new Uint8Array(await crypto.subtle.digest('SHA-1',all)),o=h.slice(0,16);o[6]=(o[6]&15)|80;o[8]=(o[8]&63)|128;return bytesToUuid(o);}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});

  function readOverrides(){try{const v=JSON.parse(localStorage.getItem(LOCAL_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(_){return{};}}
  function writeOverrides(v){localStorage.setItem(LOCAL_KEY,JSON.stringify(v,null,2));window.dispatchEvent(new CustomEvent('wlp-local-edits-canonical-changed',{detail:{source:'canonical-local-edit-write'}}));}
  function removeLocalOverride(wid){const key=clean(wid),all=readOverrides();if(!all[key])return false;delete all[key];writeOverrides(all);return true;}
  function readPending(){try{const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');return p&&typeof p==='object'&&!Array.isArray(p)&&/^\d+$/.test(clean(p.wid))&&['upsert','revert'].includes(clean(p.kind))?p:null;}catch(_){return null;}}
  function writePending(p){if(!p)localStorage.removeItem(PENDING_KEY);else localStorage.setItem(PENDING_KEY,JSON.stringify(p));}

  function show(message,error=false){
    const success=document.getElementById('local-edit-success');
    const copy=document.getElementById('local-edit-success-copy')||success?.querySelector('span');
    if(success){success.hidden=false;if(copy)copy.textContent=message;}
    let toast=document.getElementById('wlp-local-edit-canonical-status');
    if(!toast){toast=document.createElement('div');toast.id='wlp-local-edit-canonical-status';toast.style.cssText='position:fixed;z-index:100002;left:50%;bottom:max(82px,calc(env(safe-area-inset-bottom) + 72px));transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:11px 14px;border-radius:14px;background:#143f30;color:#fff;font:600 14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);display:none';document.body.appendChild(toast);}
    toast.textContent=message;toast.style.background=error?'#8f2f27':'#143f30';toast.style.display='block';clearTimeout(show._timer);show._timer=setTimeout(()=>{toast.style.display='none';},4200);
  }

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,CONTENT_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing Canonical store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  function assertAuthority(meta){if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Local Edit Canonical write requires ACTIVE Authority v3.');}

  function openShadowDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(SHADOW_DB,SHADOW_DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('Supabase Shadow configuration database is not installed.'));return;}if(!db.objectStoreNames.contains(SHADOW_META)){db.close();rej(new Error('Supabase Shadow metadata store is missing.'));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open Supabase Shadow metadata.'));});}
  async function shadowGet(key){const db=await openShadowDb();try{const tx=db.transaction(SHADOW_META,'readonly'),v=await req(tx.objectStore(SHADOW_META).get(key));await txDone(tx);return v||null;}finally{db.close();}}
  async function shadowPut(value){const db=await openShadowDb();try{const tx=db.transaction(SHADOW_META,'readwrite');tx.objectStore(SHADOW_META).put(value);await txDone(tx);}finally{db.close();}}
  async function authRequest(config,path,body){const headers={'Content-Type':'application/json',apikey:config.publishableKey};const response=await fetch(`${config.url}${path}`,{method:'POST',headers,body:JSON.stringify(body)}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`Supabase Auth request failed (${response.status}).`);return data;}
  async function cloudContext(){
    const config=await shadowGet(CONFIG_KEY),saved=await shadowGet(SESSION_KEY);if(!config?.url||!config?.publishableKey)throw new Error('Supabase configuration is missing.');if(!saved?.accessToken||!saved?.refreshToken||!saved?.userId)throw new Error('Saved Supabase session is missing.');let session=saved;
    if(Number(session.expiresAt||0)<=Date.now()+60000){const data=await authRequest(config,'/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refreshToken}),expiresIn=Math.max(60,Number(data.expires_in||3600));session={key:SESSION_KEY,accessToken:data.access_token,refreshToken:data.refresh_token,userId:data.user?.id||session.userId,email:data.user?.email||session.email||'',expiresAt:Date.now()+expiresIn*1000,savedAt:new Date().toISOString()};if(!session.userId)throw new Error('Supabase refresh did not return a user ID.');await shadowPut(session);}
    async function rest(path){const headers={apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`};const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/rest/v1/${path}`,{headers}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||`Supabase Data API request failed (${response.status}).`);return data;}
    return{rest};
  }
  async function remoteOverride(cardId){const a=await cloudContext(),rows=await a.rest(`${REMOTE_TABLE}?select=${encodeURIComponent('card_id,payload,payload_hash,revision,updated_at,deleted_at')}&card_id=eq.${encodeURIComponent(cardId)}&limit=1`);return Array.isArray(rows)&&rows.length?rows[0]:null;}

  function localContent(edit){return{word:String(edit?.Word||''),ipa:String(edit?.IPA||''),part_of_speech:String(edit?.['Part of Speech']||''),definition:String(edit?.Definition||''),synonyms:String(edit?.['Synonym(s)']||''),example_sentence:String(edit?.['Example Sentence']||''),notes:String(edit?.['Note(s)']||''),category:String(edit?.Category||''),source:String(edit?.Source||''),note_line_breaks:Boolean(edit?.__noteLineBreaks)};}
  function samePayloadContent(payload,edit){const c=localContent(edit),p=payload||{};return Object.keys(c).every(k=>String(p[k]??'')===String(c[k]??''));}
  function changedFields(remote,next){const keys=['word','ipa','part_of_speech','definition','synonyms','example_sentence','notes','category','source','note_line_breaks','base_official_content_hash','revision','updated_at','updated_by_device','deleted_at'];if(!remote)return keys;return keys.filter(k=>JSON.stringify(remote[k]??null)!==JSON.stringify(next[k]??null));}
  async function buildMutation(meta,wid,kind,edit,card,content,remote){
    const cardId=String(card.rowKey||card.payload?.card_id||''),now=new Date().toISOString(),deviceKey=clean(meta.deviceKey),baseHash=String(content.payloadHash||'');if(!cardId||!baseHash)throw new Error('Local Edit requires Canonical official card/content hashes.');
    let payload,precondition,revert=false;
    if(kind==='revert'){
      if(!remote||clean(remote.deleted_at)||clean(remote.payload?.deleted_at))return{status:'already-reverted',cardId};
      const current=clone(remote.payload||{});payload={...current,revision:Math.max(1,Number(current.revision)||1)+1,updated_at:now,updated_by_device:deviceKey,deleted_at:now};precondition={payloadHash:String(remote.payload_hash||'')};revert=true;
    }else{
      if(!edit)throw new Error(`Local Edit WID${wid} is not available locally.`);
      const current=remote?.payload||null,revision=current?Math.max(1,Number(current.revision)||1)+1:1;
      payload={card_id:cardId,legacy_word_id:Number(wid),...localContent(edit),base_official_content_hash:baseHash,revision,updated_at:clean(edit.updatedAt)||now,updated_by_device:deviceKey,deleted_at:null};
      if(remote&&!clean(remote.deleted_at)&&!clean(current?.deleted_at)&&samePayloadContent(current,edit)&&String(current.base_official_content_hash||'')===baseHash)return{status:'already-canonical',cardId};
      precondition=remote?{payloadHash:String(remote.payload_hash||'')}:{mustBeMissing:true};
    }
    const payloadHash=await sha256(stableStringify(payload)),intent={kind:`local-edit-${kind}`,wid:String(wid),cardId,basePayloadHash:precondition.payloadHash||'',payloadHash,revision:Number(payload.revision||0),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey)},actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:now,diagnosticOnly:false,candidateOnly:false,canonicalLocalEditWrite:true,canonicalLocalEditRevert:revert,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:LOGICAL_TABLE,rowKey:cardId,precondition,changedFields:changedFields(remote?.payload||null,payload),payload,payloadHash};mutation.mutationHash=await sha256(stableStringify(mutation));return{status:'ready',kind,actionId,mutationId,cardId,payload,mutation};
  }

  function enqueue(kind,wid,returnHref=''){const item={kind:clean(kind),wid:clean(wid),returnHref:clean(returnHref),queuedAt:new Date().toISOString()};writePending(item);setTimeout(()=>{void drain();},0);}

  async function drain(){
    if(state.busy||state.active)return;const pending=readPending();if(!pending)return;state.busy=true;let db=null;
    try{
      const wid=clean(pending.wid),kind=clean(pending.kind),edit=readOverrides()[wid]||null;db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);assertAuthority(meta);
      if(outbox.length){show(`Local Edit WID${wid} saved locally · waiting for ${outbox.length} pending Canonical row${outbox.length===1?'':'s'} to clear.`);return;}
      const cardId=await uuidV5(`card|wid:${wid}`);let card=await getRow(db,CARD_STORE,cardId),content=await getRow(db,CONTENT_STORE,cardId);
      if((!card||card.tombstone||!content||content.tombstone)&&!state.preflightWords.has(wid)&&window.WLPCanonicalForegroundSync?.runSync){state.preflightWords.add(wid);const pulled=await window.WLPCanonicalForegroundSync.runSync({trigger:'local-edit-official-core-preflight',receiverOnly:true});state.preflightWords.delete(wid);if(pulled===null){setTimeout(()=>{void drain();},320);return;}card=await getRow(db,CARD_STORE,cardId);content=await getRow(db,CONTENT_STORE,cardId);if((!card||card.tombstone||!content||content.tombstone)&&Number(pulled?.summary?.pendingRemoteChangeRows||0)>0){setTimeout(()=>{void drain();},320);return;}}
      if(!card||card.tombstone||!content||content.tombstone)throw new Error(`Canonical official core for WID${wid} is not materialized on this device.`);
      if(String(card.payload?.legacy_key||'')!==`wid:${wid}`||String(card.payload?.status||'')!=='active'||String(card.payload?.origin_kind||'')!=='official')throw new Error(`WID${wid} is not one active official Canonical card.`);
      const remote=await remoteOverride(cardId),built=await buildMutation(meta,wid,kind,edit,card,content,remote);
      if(built.status==='already-canonical'){writePending(null);show(`Local Edit WID${wid} is already saved to your WLP account.`);window.dispatchEvent(new CustomEvent('wlp-local-edit-canonical-complete',{detail:{pass:true,kind:'upsert',wid,alreadyCanonical:true}}));return;}
      if(built.status==='already-reverted'){removeLocalOverride(wid);writePending(null);show(`Local Edit WID${wid} is already reverted in your WLP account.`);window.dispatchEvent(new CustomEvent('wlp-local-edit-canonical-complete',{detail:{pass:true,kind:'revert',wid,alreadyCanonical:true,returnHref:pending.returnHref||''}}));if(pending.returnHref)location.href=pending.returnHref;return;}
      await addOutbox(db,built.mutation);state.active={...built,wid,returnHref:pending.returnHref||''};show(kind==='revert'?`Reverting WID${wid} Local Edit in your WLP account…`:`Local Edit WID${wid} saved locally · syncing to your WLP account…`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:kind==='revert'?'local-edit-revert':'local-edit-upsert',actionId:built.actionId,wordId:wid,tableName:LOGICAL_TABLE,mutationKind:'upsert',mutationCount:1}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_LOCAL_EDIT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message]}};show(`Local Edit account sync CHECK: ${message}`,true);window.dispatchEvent(new CustomEvent('wlp-local-edit-canonical-complete',{detail:{pass:false,kind:pending.kind,wid:pending.wid,error:message}}));}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function onSyncComplete(event){const d=event?.detail||{};if(!state.active){if(readPending())setTimeout(()=>{void drain();},120);return;}if(clean(d.actionId)!==state.active.actionId){if(d.pass===true)setTimeout(()=>{void drain();},120);return;}const active=state.active;
    if(d.pass!==true){show(`Local Edit WID${active.wid} account sync CHECK: ${clean(d.error)||'Foreground sync did not complete.'}`,true);return;}
    writePending(null);state.active=null;
    if(active.kind==='revert'){removeLocalOverride(active.wid);show(`Local Edit WID${active.wid} reverted to the canonical Master in your WLP account.`);window.dispatchEvent(new CustomEvent('wlp-local-edit-canonical-complete',{detail:{pass:true,kind:'revert',wid:active.wid,returnHref:active.returnHref||''}}));if(active.returnHref)setTimeout(()=>{location.href=active.returnHref;},80);}
    else{show(`Local Edit WID${active.wid} saved to your WLP account.`);window.dispatchEvent(new CustomEvent('wlp-local-edit-canonical-complete',{detail:{pass:true,kind:'upsert',wid:active.wid}}));}
    setTimeout(()=>{void drain();},120);
  }

  window.addEventListener('wlp-local-edit-core-changed',event=>{const d=event?.detail||{},kind=clean(d.kind),wid=clean(d.wid);if(!/^\d+$/.test(wid)||!['upsert','revert'].includes(kind))return;enqueue(kind,wid,clean(d.returnHref));});
  window.addEventListener('wlp-canonical-auto-sync-complete',event=>{void onSyncComplete(event);});
  window.WLPCanonicalLocalEditWrite=Object.freeze({version:1,appVersion:APP_VERSION,drain,getReport:()=>clone(state.report),pending:()=>clone(readPending())});
  if(readPending())setTimeout(()=>{void drain();},80);
})();
