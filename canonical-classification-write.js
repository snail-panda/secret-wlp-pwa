/* WLP v1.8.6.382 — Classification existing-row Canonical production write.
   Scope for this first Classification cutover block:
   - normal Save Classification on an existing official WID stages one guarded card_classification upsert;
   - Draft classification and portable bulk import are intentionally NOT staged yet;
   - new WIDs whose card_classification row does not yet exist are intentionally deferred to the next block;
   - no local data is cleared on failure; the local save remains intact. */
(() => {
  'use strict';
  const APP_VERSION='1.8.6.382-classification-existing-row-default-write-v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',CLASS_STORE='card_classification',META_KEY='authority_mirror';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const api=window.WLPClassificationMetadata;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,CLASS_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing Canonical store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  function tags(v){return Array.isArray(v)?v.map(clean).filter(Boolean):[];}
  function sameArray(a,b){const x=tags(a),y=tags(b);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
  function changedFields(current,next){const out=[];if(!sameArray(current.entry_types,next.entry_types))out.push('entry_types');if(!sameArray(current.usage_tags,next.usage_tags))out.push('usage_tags');if(!sameArray(current.topic_tags,next.topic_tags))out.push('topic_tags');if(!sameArray(current.discovery_tags,next.discovery_tags))out.push('discovery_tags');return out;}
  async function stageKey(key){
    if(!api||!/^wid:\d+$/.test(String(key||'')))return {status:'ignored'};
    const wid=String(key).slice(4),record=api.get(key);if(!api.hasClassification(record))return {status:'deferred-empty'};
    const db=await openDb();
    try{
      const [meta,cards,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,CARD_STORE),getAll(db,OUTBOX_STORE)]);
      if(String(meta?.candidateKey||'')!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||String(meta?.snapshotManifestHash||'')!==BASE.manifestHash)throw new Error('Classification Canonical write requires ACTIVE Authority v3.');
      const card=cards.find(x=>String(x?.payload?.legacy_key||'')===`wid:${wid}`);if(!card)throw new Error(`Canonical card for WID${wid} is missing; Classification sync will defer until official card identity exists.`);
      const cardId=String(card.rowKey||card?.payload?.card_id||'');if(!cardId)throw new Error(`Canonical card identity for WID${wid} is invalid.`);
      if(outbox.some(x=>x?.tableName===CLASS_STORE&&String(x?.rowKey||'')===cardId&&String(x?.status||'pending')==='pending'))return {status:'already-pending',wid,cardId};
      const current=await getRow(db,CLASS_STORE,cardId);if(!current?.payload||!current.payloadHash)return {status:'deferred-new-row',wid,cardId};
      const p=current.payload,next={...clone(p),card_id:cardId,entry_types:tags(record.entryTypes),usage_tags:tags(record.usageTags),topic_tags:tags(record.topicTags),discovery_tags:tags(record.discoveryTags),revision:Math.max(1,Number(p.revision)||1)+1,field_meta:(p.field_meta&&typeof p.field_meta==='object'&&!Array.isArray(p.field_meta))?clone(p.field_meta):{},updated_at:clean(record.updatedAt)||new Date().toISOString(),updated_by_device:String(meta.deviceKey||''),deleted_at:null};
      const changed=changedFields(p,next);if(!changed.length)return {status:'noop',wid,cardId};
      const nextHash=await sha256(stableStringify(next)),actionId=crypto.randomUUID(),mutationId=crypto.randomUUID();
      const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalClassificationDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:CLASS_STORE,rowKey:cardId,precondition:{payloadHash:String(current.payloadHash)},changedFields:changed,payload:next,payloadHash:nextHash};
      mutation.mutationHash=await sha256(stableStringify(mutation));await addOutbox(db,mutation);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'classification-default-write',tableName:CLASS_STORE,mutationKind:'upsert',actionId,mutationCount:1,wordId:wid}}));
      return {status:'staged',wid,cardId,actionId,changedFields:changed};
    }finally{db.close();}
  }
  async function onChanged(event){const d=event?.detail||{};if(String(d.source||'')!=='local-save')return;for(const key of (Array.isArray(d.changedKeys)?d.changedKeys:[])){try{await stageKey(key);}catch(error){console.error('WLP Classification Canonical stage failed:',error);}}}
  if(api?.EVENT_NAME)window.addEventListener(api.EVENT_NAME,onChanged);
  window.WLPCanonicalClassificationWrite=Object.freeze({version:1,appVersion:APP_VERSION,stageKey});
})();
