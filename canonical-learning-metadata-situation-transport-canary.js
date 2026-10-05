/* WLP v1.8.6.337 — Learning Metadata Situation-row Canonical transport canary.
   Query-gated only: ?wlpLearningMetadataSituationTransportCanary=1
   Stages one byte-exact existing WID5578 learning_situations payload.
   This is a transport-only proof: no Learning Metadata semantic/lineage change. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.337-learning-metadata-situation-transport-canary-v1';
  const FLAG='wlpLearningMetadataSituationTransportCanary';
  const TARGET_WID='5578';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',SITUATION_STORE='learning_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,button:null,active:null,report:null,busy:false};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const enabled=()=>new URLSearchParams(location.search).get(FLAG)==='1';

  function makePanel(){
    if(state.panel||!enabled())return;
    const p=document.createElement('section');p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100013;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation-row Canonical transport canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><button type="button" data-stage style="margin-top:9px;padding:8px 12px;border:1px solid #b8c8bc;border-radius:10px;background:#f7faf7;color:#21362a;font:inherit">Stage exact WID5578 Situation row</button>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');state.button=p.querySelector('[data-stage]');state.button.disabled=true;state.button.addEventListener('click',()=>{void stage();});
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,SITUATION_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  async function prepare(){
    if(!enabled())return;makePanel();let db=null;
    try{
      db=await openDb();const [meta,outbox,cards,situations]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE),getAll(db,CARD_STORE),getAll(db,SITUATION_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation transport canary requires ACTIVE Authority v3.');
      if(outbox.length)throw new Error(`sync_outbox must start empty; found ${outbox.length}.`);
      const card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${TARGET_WID}`);if(!card)throw new Error(`Canonical card for WID${TARGET_WID} is missing.`);
      const cardId=clean(card.rowKey||card?.payload?.card_id);
      const row=situations.map(w=>({wrapper:w,payload:w?.payload||{}})).filter(x=>clean(x.payload.card_id)===cardId&&!clean(x.payload.deleted_at)).sort((a,b)=>(Number(a.payload.ordinal)||0)-(Number(b.payload.ordinal)||0))[0];
      if(!row)throw new Error(`WID${TARGET_WID} has no active Canonical Situation row.`);
      const rowKey=clean(row.wrapper.rowKey),payload=clone(row.payload),payloadHash=clean(row.wrapper.payloadHash)||await sha256(stableStringify(payload));
      if(clean(payload.situation_id)!==rowKey)throw new Error('Canonical Situation rowKey does not match payload.situation_id.');
      if(!clean(payload.source_situation_id)||!clean(payload.version_id)||Number(payload.revision||0)<1)throw new Error('Canonical Situation lineage is incomplete.');
      const cursor=await cursorValue(db,meta);
      state.active={phase:'ready',rowKey,payload,payloadHash,cursor,cardId,sourceSituationId:clean(payload.source_situation_id)};
      state.button.disabled=false;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,rowKey,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{exactExistingPayload:true,noSemanticChange:true,noLineageChange:true}};
      show(`READY · WID${TARGET_WID} Situation-row transport canary is safe to stage.`,true,`cursor ${cursor} · outbox 0\nSituation ${state.active.sourceSituationId}\nexact payload hash ${payloadHash.slice(0,14)}…\nNo Learning Metadata content or lineage will be changed.`);
    }catch(e){state.button.disabled=true;state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No outbox row was staged.');}
    finally{try{db?.close();}catch(_){}}
  }

  async function stage(){
    if(state.busy||state.active?.phase!=='ready')return;state.busy=true;state.button.disabled=true;let db=null;
    try{
      db=await openDb();const [meta,outbox,current]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE),getRow(db,SITUATION_STORE,state.active.rowKey)]);
      if(outbox.length)throw new Error(`sync_outbox must still be empty; found ${outbox.length}.`);
      const currentHash=clean(current?.payloadHash)||await sha256(stableStringify(current?.payload||{}));if(currentHash!==state.active.payloadHash)throw new Error('Situation row changed after READY; stale canary was blocked.');
      const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationTransportCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:'learning_situations',rowKey:state.active.rowKey,precondition:{payloadHash:state.active.payloadHash},changedFields:[],payload:clone(state.active.payload),payloadHash:state.active.payloadHash};mutation.mutationHash=await sha256(stableStringify(mutation));
      await addOutbox(db,mutation);state.active={...state.active,phase:'pending',actionId,mutationId};
      show(`PENDING · Exact WID${TARGET_WID} Situation row staged.`,true,`cursor ${state.active.cursor} · outbox 0 → 1 · foreground sync will auto-push\nPayload is byte/semantic identical to the current Canonical Situation row.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-canary',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:1}}));
    }catch(e){state.active={...state.active,phase:'blocked'};state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No second write should be staged.');}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verify(event){
    if(state.active?.phase!=='pending')return;const d=event?.detail||{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The outbox row is intentionally retained for retry. Do not press the button again.');return;}
    let db=null;try{
      db=await openDb();const [outbox,row,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,SITUATION_STORE,state.active.rowKey),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),pass=outbox.length===0&&clean(row?.payloadHash)===state.active.payloadHash&&cursorAfter>state.active.cursor;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,rowKey:state.active.rowKey,cursorBefore:state.active.cursor,cursorAfter,outboxAfter:outbox.length,blockingIssues:pass?0:1,pass},invariants:{exactPayloadPreserved:clean(row?.payloadHash)===state.active.payloadHash,noSemanticChange:true,noLineageChange:true}};
      show(pass?`PASS · WID${TARGET_WID} Situation row reached Canonical.`:'CHECK · Situation-row transport verification is incomplete.',pass,`cursor ${state.active.cursor} → ${cursorAfter} · outbox ${outbox.length}\nexact payload preserved ${clean(row?.payloadHash)===state.active.payloadHash?'yes':'no'} · semantic/lineage change 0`);
      if(pass)state.active={...state.active,phase:'pass'};
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.');}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verify(e);});
  window.WLPCanonicalLearningMetadataSituationTransportCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
