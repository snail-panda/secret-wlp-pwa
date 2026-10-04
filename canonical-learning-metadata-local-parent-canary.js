/* WLP v1.8.6.331 — Learning Metadata local-derived parent-row Canonical transport canary.
   Source canary: ?wlpLearningMetadataLocalParentCanary=1
   Receiver audit: ?wlpLearningMetadataLocalParentReceive=1
   Builds the WID5578 parent-row payload from the local Learning Metadata v2 record,
   requires it to hash exactly to the installed Canonical parent row, then stages that
   exact local-derived payload. No Learning Metadata semantics or lineage are changed. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.331-learning-metadata-local-derived-parent-canary-v1';
  const SOURCE_FLAG='wlpLearningMetadataLocalParentCanary';
  const RECEIVER_FLAG='wlpLearningMetadataLocalParentReceive';
  const TARGET_WID='5578';
  const BASE_CURSOR=98;
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,button:null,report:null,busy:false,active:null,prepared:null};

  const clean=v=>String(v??'').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const sourceActive=()=>params().get(SOURCE_FLAG)==='1';
  const receiverActive=()=>params().get(RECEIVER_FLAG)==='1';
  const active=()=>sourceActive()||receiverActive();

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-local-parent-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100011;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(700px,calc(100vw - 20px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML=`<strong style="display:block;font-size:13px">Learning Metadata · ${sourceActive()?'local-derived parent-row transport canary':'local-derived parent-row receiver audit'}</strong><div id="wlp-lm-local-parent-status" style="margin-top:4px">Preparing…</div><div id="wlp-lm-local-parent-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>${sourceActive()?'<div style="margin-top:8px"><button id="wlp-lm-local-parent-stage" type="button" disabled>Stage local-derived WID5578 parent row</button></div>':''}`;
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-lm-local-parent-status');state.detail=p.querySelector('#wlp-lm-local-parent-detail');state.button=p.querySelector('#wlp-lm-local-parent-stage');
    if(state.button){state.button.style.cssText='font:inherit;padding:6px 9px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22';state.button.addEventListener('click',()=>{void stage();});}
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}
  async function resolveTarget(db){
    const cards=await getAll(db,CARD_STORE),card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${TARGET_WID}`);
    if(!card)throw new Error(`Canonical card for WID${TARGET_WID} is missing.`);
    const cardId=clean(card.rowKey||card?.payload?.card_id),metadata=await getRow(db,METADATA_STORE,cardId);
    if(!metadata||!metadata.payload)throw new Error(`Canonical Learning Metadata for WID${TARGET_WID} is missing.`);
    return{cardId,metadata};
  }
  function localRecord(){
    const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');
    const r=api.getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);
  }
  function parentPayloadFromLocal(basePayload,record,cardId){
    const c=record?.content&&typeof record.content==='object'?record.content:{};
    return {...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};
  }
  async function prepare(){
    if(!active())return;makePanel();let db=null;
    try{
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]),cursor=await cursorValue(db,meta),target=await resolveTarget(db);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Learning Metadata local-parent canary requires ACTIVE Authority v3.');
      if(sourceActive()){
        if(outbox.length)throw new Error(`sync_outbox must start empty; found ${outbox.length}.`);
        const local=localRecord(),payload=parentPayloadFromLocal(target.metadata.payload,local,target.cardId),localHash=await sha256(stableStringify(payload)),canonicalHash=clean(target.metadata.payloadHash)||await sha256(stableStringify(target.metadata.payload));
        if(localHash!==canonicalHash)throw new Error('Local-derived WID5578 parent payload is not byte-semantically exact to Canonical; staging is blocked.');
        state.prepared={cardId:target.cardId,payload,payloadHash:localHash,cursorBefore:cursor};
        state.report={format:'WLP_LEARNING_METADATA_LOCAL_PARENT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,cardId:target.cardId,cursor,outbox:0,payloadHash:localHash,blockingIssues:0,pass:true},invariants:{payloadBuiltFromLocalRecord:true,localDerivedEqualsCanonical:true,noLearningMetadataSemanticChange:true,noLocalStorageWrites:true}};
        show(`READY · Local WID${TARGET_WID} maps exactly to its Canonical parent row.`,true,`cursor ${cursor} · outbox 0 · local-derived hash = Canonical hash yes\nNo Learning Metadata content or lineage will be changed.`);state.button.disabled=false;
      }else{
        const pass=cursor>BASE_CURSOR&&outbox.length===0;
        state.report={format:'WLP_LEARNING_METADATA_LOCAL_PARENT_RECEIVER_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{wordId:TARGET_WID,cardId:target.cardId,cursor,outbox:outbox.length,baseCursor:BASE_CURSOR,blockingIssues:pass?0:1,pass},invariants:{readOnly:true,noLocalStorageWrites:true}};
        show(pass?`PASS · Local-derived WID${TARGET_WID} parent row is present on this device.`:`CHECK · Receiver has not advanced beyond cursor ${BASE_CURSOR} yet.`,pass,`cursor ${cursor} · outbox ${outbox.length} · row ${target.cardId}`);
      }
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_LOCAL_PARENT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No data changed.');}
    finally{try{db?.close();}catch(_){}}
  }
  async function stage(){
    if(!sourceActive()||state.busy||!state.prepared)return;state.busy=true;if(state.button)state.button.disabled=true;let db=null;
    try{
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);if(outbox.length)throw new Error(`sync_outbox must be empty; found ${outbox.length}.`);
      const cursorBefore=await cursorValue(db,meta),target=await resolveTarget(db),local=localRecord(),payload=parentPayloadFromLocal(target.metadata.payload,local,target.cardId),payloadHash=await sha256(stableStringify(payload)),canonicalHash=clean(target.metadata.payloadHash)||await sha256(stableStringify(target.metadata.payload));
      if(payloadHash!==canonicalHash)throw new Error('Local-derived payload changed after READY; staging is blocked.');
      const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataLocalParentCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:target.cardId,precondition:{payloadHash},changedFields:[],payload,payloadHash};mutation.mutationHash=await sha256(stableStringify(mutation));
      await addOutbox(db,mutation);state.active={actionId,mutationId,cardId:target.cardId,payloadHash,cursorBefore};
      show(`PENDING · Local-derived WID${TARGET_WID} parent row staged.`,true,`cursor ${cursorBefore} · outbox 0 → 1 · foreground sync will auto-push\nPayload was built from local Learning Metadata v2.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-local-parent-canary',tableName:'card_learning_metadata',mutationKind:'upsert',actionId,mutationCount:1}}));
    }catch(e){show(`BLOCKED · ${String(e?.message||e)}`,false,'The safety gate prevented staging.');if(state.button)state.button.disabled=false;}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }
  async function verifyForeground(detail){
    if(!sourceActive()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The outbox row is intentionally retained for retry.');return;}
    let db=null;try{db=await openDb();const [outbox,row,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,METADATA_STORE,state.active.cardId),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),pass=outbox.length===0&&clean(row?.payloadHash)===state.active.payloadHash&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_LOCAL_PARENT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,cardId:state.active.cardId,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:outbox.length,payloadHash:state.active.payloadHash,blockingIssues:pass?0:1,pass},invariants:{payloadBuiltFromLocalRecord:true,localDerivedEqualsCanonical:true,noLearningMetadataSemanticChange:true,noLocalStorageWrites:true}};
      show(pass?`PASS · Local-derived WID${TARGET_WID} parent row reached Canonical.`:'CHECK · Local-derived parent transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}\nlocal-derived payload preserved yes · semantic/lineage change 0`);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.');}finally{try{db?.close();}catch(_){}}
  }
  window.addEventListener('wlp-canonical-foreground-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataLocalParentCanary=Object.freeze({version:1,prepare,stage,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
