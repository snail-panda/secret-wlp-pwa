/* WLP v1.8.6.391 — Account-owned Draft create + guarded Draft edit Canonical write.
   Scope:
   - Draft create keeps stable UUIDv5 card_id from draft:<localId> and atomic cards + card_content insert;
   - Draft edit updates only card_content with optimistic payload-hash precondition and row_version +1;
   - ownership is account-scoped in Supabase; localStorage remains the compatibility projection/cache;
   - Draft delete is intentionally unchanged until the next stage;
   - no Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.391-draft-edit-canonical-v1';
  const LOCAL_KEY='wlp:local-additions:v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',CONTENT_STORE='card_content',META_KEY='authority_mirror';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const FIELDS=['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const state={busy:false,active:null,report:null};

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

  function readDraft(localId){
    try{const rows=JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]');return(Array.isArray(rows)?rows:[]).find(x=>x&&typeof x==='object'&&clean(x.localId)===clean(localId))||null;}catch(_){return null;}
  }
  function statusCopy(kind,text){
    const id=kind==='edit'?'draft-edit-success-copy':'new-card-success-copy';
    const el=document.getElementById(id);if(el)el.textContent=text;
  }
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,CONTENT_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing Canonical store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutboxMany(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const row of rows)store.add(clone(row));await txDone(tx);}

  function assertAuthority(meta,label){if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error(`${label} requires ACTIVE Authority v3.`);}
  function contentSource(draft){const out={};FIELDS.forEach(field=>{out[field]=String(draft?.[field]??'').trim();});return out;}
  function contentPayload(draft,cardId,meta,sourceHash,{rowVersion=1,migrationSource='draft-canonical-create'}={}){return{card_id:cardId,word:String(draft.Word||''),ipa:String(draft.IPA||''),part_of_speech:String(draft['Part of Speech']||''),definition:String(draft.Definition||''),synonyms:String(draft['Synonym(s)']||''),example_sentence:String(draft['Example Sentence']||''),notes:String(draft['Note(s)']||''),category:String(draft.Category||''),source:String(draft.Source||''),field_meta:{},row_version:Number(rowVersion||1),updated_at:clean(draft.updatedAt)||new Date().toISOString(),updated_by_device:clean(meta.deviceKey)||null,migration_source:migrationSource,source_payload_hash:sourceHash};}
  function sameDraftContent(payload,draft){if(!payload)return false;return String(payload.word||'')===String(draft.Word||'')&&String(payload.ipa||'')===String(draft.IPA||'')&&String(payload.part_of_speech||'')===String(draft['Part of Speech']||'')&&String(payload.definition||'')===String(draft.Definition||'')&&String(payload.synonyms||'')===String(draft['Synonym(s)']||'')&&String(payload.example_sentence||'')===String(draft['Example Sentence']||'')&&String(payload.notes||'')===String(draft['Note(s)']||'')&&String(payload.category||'')===String(draft.Category||'')&&String(payload.source||'')===String(draft.Source||'');}

  async function buildCreate(meta,draft){
    const localId=clean(draft.localId);if(!localId)throw new Error('Draft localId is missing.');
    const cardId=await uuidV5(`card|draft:${localId}`),now=clean(draft.updatedAt)||new Date().toISOString(),createdAt=clean(draft.createdAt)||now,deviceKey=clean(meta.deviceKey);
    const source=contentSource(draft),sourceHash=await sha256(stableStringify(source));
    const cardPayload={card_id:cardId,legacy_key:`draft:${localId}`,word_id:null,status:'draft',origin_kind:'personal',origin_ref:localId,legacy_batch:null,legacy_guidance:null,order_key:`draft:${createdAt}:${localId}`,official_base_hash:null,row_version:1,created_at:createdAt,updated_at:now,created_by_device:deviceKey||null,updated_by_device:deviceKey||null,deleted_at:null};
    const canonicalContent=contentPayload(draft,cardId,meta,sourceHash,{rowVersion:1,migrationSource:'draft-canonical-create'});
    const intent={kind:'draft-card-create',localId,cardId,cardPayloadHash:await sha256(stableStringify(cardPayload)),contentPayloadHash:await sha256(stableStringify(canonicalContent)),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey)};
    const actionId=await uuidV5(`sync-action|draft-card-create|${await sha256(stableStringify(intent))}`);
    const makeMutation=async(tableName,payload)=>{const mutationId=await uuidV5(`sync-mutation|${tableName}|${actionId}`),m={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalDraftCreate:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName,rowKey:cardId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};m.mutationHash=await sha256(stableStringify(m));return m;};
    return{kind:'create',actionId,cardId,localId,mutations:[await makeMutation(CARD_STORE,cardPayload),await makeMutation(CONTENT_STORE,canonicalContent)]};
  }

  async function buildEdit(meta,draft,existingContent){
    const localId=clean(draft.localId);if(!localId)throw new Error('Draft localId is missing.');
    const cardId=await uuidV5(`card|draft:${localId}`),baseHash=clean(existingContent?.payloadHash);if(!baseHash)throw new Error('Draft edit requires the current Canonical card_content payload hash.');
    const currentVersion=Number(existingContent?.payload?.row_version||0);if(!Number.isInteger(currentVersion)||currentVersion<1)throw new Error('Draft edit requires a valid Canonical row_version.');
    const source=contentSource(draft),sourceHash=await sha256(stableStringify(source)),canonicalContent=contentPayload(draft,cardId,meta,sourceHash,{rowVersion:currentVersion+1,migrationSource:'draft-canonical-edit'}),payloadHash=await sha256(stableStringify(canonicalContent));
    const intent={kind:'draft-card-edit',localId,cardId,basePayloadHash:baseHash,nextPayloadHash:payloadHash,nextRowVersion:currentVersion+1,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey)};
    const actionId=await uuidV5(`sync-action|draft-card-edit|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|${CONTENT_STORE}|${actionId}`);
    const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalDraftEdit:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:CONTENT_STORE,rowKey:cardId,precondition:{payloadHash:baseHash},payload:canonicalContent,payloadHash};
    mutation.mutationHash=await sha256(stableStringify(mutation));
    return{kind:'edit',actionId,cardId,localId,baseHash,mutations:[mutation]};
  }

  async function stageCreate(localId){
    if(state.busy)return;state.busy=true;let db=null;
    try{
      const draft=readDraft(localId);if(!draft)throw new Error(`Draft ${clean(localId)||'(missing id)'} is not available locally.`);
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);assertAuthority(meta,'Draft Canonical create');
      if(outbox.length)throw new Error(`Draft Canonical create requires an empty sync_outbox; found ${outbox.length}.`);
      const cardId=await uuidV5(`card|draft:${clean(localId)}`),existingCard=await getRow(db,CARD_STORE,cardId),existingContent=await getRow(db,CONTENT_STORE,cardId);
      if(existingCard||existingContent){
        if(existingCard?.payload?.status==='draft'&&!existingCard?.tombstone&&existingContent?.payload&&!existingContent?.tombstone&&sameDraftContent(existingContent.payload,draft)){
          state.report={format:'WLP_CANONICAL_DRAFT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{kind:'create',localId:clean(localId),cardId,alreadyCanonical:true,blockingIssues:0,pass:true}};
          statusCopy('create','Draft saved to your WLP account.');return;
        }
        throw new Error('Canonical Draft identity already exists with different content; create was not overwritten.');
      }
      const built=await buildCreate(meta,draft);await addOutboxMany(db,built.mutations);state.active={...built};
      statusCopy('create','Draft saved locally · syncing to your WLP account…');
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'draft-card-create',actionId:built.actionId,tableName:'cards',mutationKind:'insert',mutationCount:2,localDraftId:built.localId}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_DRAFT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{kind:'create',localId:clean(localId),blockingIssues:1,pass:false},issues:{blocking:[message]}};statusCopy('create',`Draft saved locally · account sync CHECK: ${message}`);console.error('WLP Draft Canonical create failed:',error);}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function stageEdit(localId){
    if(state.busy)return;state.busy=true;let db=null;
    try{
      const draft=readDraft(localId);if(!draft)throw new Error(`Draft ${clean(localId)||'(missing id)'} is not available locally.`);
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);assertAuthority(meta,'Draft Canonical edit');
      if(outbox.length)throw new Error(`Draft Canonical edit requires an empty sync_outbox; found ${outbox.length}.`);
      const cardId=await uuidV5(`card|draft:${clean(localId)}`),card=await getRow(db,CARD_STORE,cardId),content=await getRow(db,CONTENT_STORE,cardId);
      if(!card||card.tombstone||!content||content.tombstone)throw new Error('Draft edit requires the Canonical Draft core to exist on this device.');
      if(String(card.payload?.status||'')!=='draft'||String(card.payload?.origin_kind||'')!=='personal'||String(card.payload?.origin_ref||'')!==clean(localId)||String(card.payload?.legacy_key||'')!==`draft:${clean(localId)}`)throw new Error('Draft edit Canonical identity does not match this local Draft.');
      if(sameDraftContent(content.payload,draft)){
        state.report={format:'WLP_CANONICAL_DRAFT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{kind:'edit',localId:clean(localId),cardId,alreadyCanonical:true,blockingIssues:0,pass:true}};
        statusCopy('edit','Draft changes saved to your WLP account.');return;
      }
      const built=await buildEdit(meta,draft,content);await addOutboxMany(db,built.mutations);state.active={...built};
      statusCopy('edit','Draft changes saved locally · syncing to your WLP account…');
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'draft-card-edit',actionId:built.actionId,tableName:'card_content',mutationKind:'upsert',mutationCount:1,localDraftId:built.localId}}));
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_DRAFT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{kind:'edit',localId:clean(localId),blockingIssues:1,pass:false},issues:{blocking:[message]}};statusCopy('edit',`Draft changes saved locally · account sync CHECK: ${message}`);console.error('WLP Draft Canonical edit failed:',error);}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function onSyncComplete(event){
    const d=event?.detail||{};if(!state.active||clean(d.actionId)!==state.active.actionId)return;
    const kind=state.active.kind||'create';
    if(d.pass!==true){statusCopy(kind,`${kind==='edit'?'Draft changes saved':'Draft saved'} locally · account sync CHECK: ${clean(d.error)||'Foreground sync did not complete.'}`);return;}
    let db=null;try{
      db=await openDb();const [card,content,outbox]=await Promise.all([getRow(db,CARD_STORE,state.active.cardId),getRow(db,CONTENT_STORE,state.active.cardId),getAll(db,OUTBOX_STORE)]),draft=readDraft(state.active.localId),pass=Boolean(draft&&card&&!card.tombstone&&content&&!content.tombstone&&card.payload?.status==='draft'&&sameDraftContent(content.payload,draft)&&outbox.length===0);
      state.report={format:'WLP_CANONICAL_DRAFT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{kind,localId:state.active.localId,cardId:state.active.cardId,outboxAfter:outbox.length,blockingIssues:pass?0:1,pass}};
      statusCopy(kind,pass?(kind==='edit'?'Draft changes saved to your WLP account.':'Draft saved to your WLP account.'):`${kind==='edit'?'Draft changes saved':'Draft saved'} locally · Canonical verification is incomplete.`);if(pass)state.active=null;
    }catch(error){statusCopy(kind,`${kind==='edit'?'Draft changes saved':'Draft saved'} locally · account verification CHECK: ${error?.message||String(error)}`);}finally{try{db?.close();}catch(_){} }
  }

  window.addEventListener('wlp-draft-core-changed',event=>{const d=event?.detail||{},kind=String(d.kind||''),localId=String(d.localId||'');if(kind==='create')void stageCreate(localId);else if(kind==='edit')void stageEdit(localId);});
  window.addEventListener('wlp-canonical-auto-sync-complete',event=>{void onSyncComplete(event);});
  window.WLPCanonicalDraftWrite=Object.freeze({version:2,appVersion:APP_VERSION,stageCreate,stageEdit,getReport:()=>clone(state.report)});
})();
