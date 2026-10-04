/* WLP v1.8.6.333 — Learning Metadata real parent-field edit Canonical write canary.
   Query only: ?wlpLearningMetadataParentEditCanary=1 on editor-local-edit.html?wid=...
   Arms only when the local Learning Metadata v2 record is exactly aligned with the
   current Canonical parent row and all child metadata is unchanged. The next real
   editor save may change Entry Type, Sense Hook, and/or Memory Hook only; Situation
   and Alternative changes are blocked from Canonical staging in this canary.
   The local editor remains authoritative for the save itself. This canary only stages
   the resulting parent-row revision into the proven Canonical foreground transport. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.333-learning-metadata-parent-edit-canary-v1';
  const FLAG='wlpLearningMetadataParentEditCanary';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata',SITUATION_STORE='learning_situations',ALTERNATIVE_STORE='learning_alternatives',LINK_STORE='learning_alternative_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,report:null,armed:false,busy:false,active:null,before:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const active=()=>params().get(FLAG)==='1';
  const targetWid=()=>clean(params().get('wid'));

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-parent-edit-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100012;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · real parent-field Canonical write canary</strong><div id="wlp-lm-parent-edit-status" style="margin-top:4px">Preparing…</div><div id="wlp-lm-parent-edit-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-lm-parent-edit-status');state.detail=p.querySelector('#wlp-lm-parent-edit-detail');
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function short(v,n=92){const s=clean(v);return s.length>n?`${s.slice(0,n-1)}…`:s||'—';}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}

  function parentPayloadFromLocal(basePayload,record,cardId){
    const c=record?.content&&typeof record.content==='object'?record.content:{};
    return {...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};
  }
  function parentSemantic(record){const c=record?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(record?.deletedAt)};}
  function childrenSignature(record){const c=record?.content||{};return stableStringify({situations:Array.isArray(c.situations)?c.situations:[],alternativeExpressions:Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]});}
  function changedParentFields(before,after){const b=parentSemantic(before),a=parentSemantic(after),out=[];if(b.entryType!==a.entryType)out.push('entry_type');if(b.senseHook!==a.senseHook)out.push('sense_hook');if(b.memoryHook!==a.memoryHook)out.push('memory_hook');return out;}
  function localRecord(wid){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${wid}`);if(!r)throw new Error(`Local Learning Metadata WID${wid} is missing.`);return clone(r);}
  async function resolveTarget(db,wid){
    const cards=await getAll(db,CARD_STORE),card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${wid}`);if(!card)throw new Error(`Canonical card for WID${wid} is missing.`);
    const cardId=clean(card.rowKey||card?.payload?.card_id),metadata=await getRow(db,METADATA_STORE,cardId);if(!metadata||!metadata.payload)throw new Error(`Canonical Learning Metadata for WID${wid} is missing.`);
    return{cardId,metadata};
  }
  async function verifyChildrenStillCanonical(db,cardId,record){
    const [situations,alternatives,links]=await Promise.all([getAll(db,SITUATION_STORE),getAll(db,ALTERNATIVE_STORE),getAll(db,LINK_STORE)]);
    const sourceSituationByCanonical=new Map();
    const canonicalSituations=situations.map(payload).filter(p=>clean(p.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>{if(clean(s.situation_id))sourceSituationByCanonical.set(clean(s.situation_id),clean(s.source_situation_id));return{situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]};});
    const linksByAlternative=new Map();links.map(payload).forEach(p=>{const aid=clean(p.alternative_id),sid=clean(p.situation_id);if(!aid||!sid||clean(p.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const canonicalAlternatives=alternatives.map(payload).filter(p=>clean(p.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]}));
    const local=record?.content||{};return stableStringify({situations:Array.isArray(local.situations)?local.situations:[],alternativeExpressions:Array.isArray(local.alternativeExpressions)?local.alternativeExpressions:[]})===stableStringify({situations:canonicalSituations,alternativeExpressions:canonicalAlternatives});
  }

  async function prepare(){
    if(!active())return;makePanel();const wid=targetWid();let db=null;
    try{
      if(!/^\d+$/.test(wid))throw new Error('Open this canary on editor-local-edit with a numeric ?wid=.');
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]),cursor=await cursorValue(db,meta),target=await resolveTarget(db,wid);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Parent-edit canary requires ACTIVE Authority v3.');
      if(outbox.length)throw new Error(`sync_outbox must start empty; found ${outbox.length}.`);
      const local=localRecord(wid),localPayload=parentPayloadFromLocal(target.metadata.payload,local,target.cardId),localHash=await sha256(stableStringify(localPayload)),canonicalHash=clean(target.metadata.payloadHash)||await sha256(stableStringify(target.metadata.payload));
      if(localHash!==canonicalHash)throw new Error(`WID${wid} local parent row is not exactly aligned with Canonical; do not edit yet.`);
      if(!(await verifyChildrenStillCanonical(db,target.cardId,local)))throw new Error(`WID${wid} Situation/Alternative state is not exactly aligned with Canonical.`);
      state.before={wid,cardId:target.cardId,cursor,payloadHash:canonicalHash,canonicalPayload:clone(target.metadata.payload),local:clone(local),childrenSignature:childrenSignature(local)};state.armed=true;
      state.report={format:'WLP_LEARNING_METADATA_PARENT_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:wid,cardId:target.cardId,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{localParentExactCanonical:true,childrenExactCanonical:true,realEditorSaveRequired:true,parentFieldsOnly:true}};
      show(`READY · WID${wid} is armed for one real parent-field edit.`,true,`cursor ${cursor} · outbox 0 · local parent = Canonical yes · children = Canonical yes\nEntry Type: ${short(local.content?.entryType)}\nSense: ${short(local.content?.senseHook)}\nMemory: ${short(local.content?.memoryHook)}\nChange only Entry Type / Sense Hook / Memory Hook, then press the normal Save button once.`);
    }catch(e){state.armed=false;state.report={format:'WLP_LEARNING_METADATA_PARENT_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical write was staged.');}
    finally{try{db?.close();}catch(_){}}
  }

  async function onLocalChanged(){
    if(!active()||!state.armed||state.busy||!state.before)return;state.busy=true;let db=null;
    try{
      await new Promise(r=>setTimeout(r,0));const before=state.before,after=localRecord(before.wid),changed=changedParentFields(before.local,after);
      if(!changed.length){state.busy=false;return;}
      state.armed=false;
      if(childrenSignature(after)!==before.childrenSignature)throw new Error('Situation/Alternative content changed; v333 will not stage a partial parent-only Canonical write.');
      if(clean(after.metadataId)!==clean(before.local.metadataId)||Number(after.revision)!==Number(before.local.revision)+1||clean(after.parentVersionId)!==clean(before.local.versionId)||!clean(after.versionId)||clean(after.versionId)===clean(before.local.versionId))throw new Error('Local Learning Metadata did not advance parent lineage exactly once.');
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);if(outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${outbox.length}.`);
      const cursorBefore=await cursorValue(db,meta),target=await resolveTarget(db,before.wid),currentHash=clean(target.metadata.payloadHash)||await sha256(stableStringify(target.metadata.payload));if(currentHash!==before.payloadHash)throw new Error('Canonical parent row changed after READY; stale write was blocked before staging.');
      if(!(await verifyChildrenStillCanonical(db,before.cardId,after)))throw new Error('Situation/Alternative state no longer matches Canonical; parent-only staging is blocked.');
      const nextPayload=parentPayloadFromLocal(target.metadata.payload,after,before.cardId),nextHash=await sha256(stableStringify(nextPayload));if(nextHash===currentHash)throw new Error('Parent edit produced no Canonical payload change.');
      const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataParentEditCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:before.cardId,precondition:{payloadHash:currentHash},changedFields:changed,payload:nextPayload,payloadHash:nextHash};mutation.mutationHash=await sha256(stableStringify(mutation));
      await addOutbox(db,mutation);state.active={actionId,mutationId,wid:before.wid,cardId:before.cardId,cursorBefore,payloadHash:nextHash,changedFields:changed};
      show(`PENDING · Real WID${before.wid} parent edit staged.`,true,`cursor ${cursorBefore} · outbox 0 → 1 · changed ${changed.join(', ')}\nForeground Sync will auto-push this real editor revision.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-parent-edit-canary',tableName:'card_learning_metadata',mutationKind:'upsert',actionId,mutationCount:1}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_PARENT_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:state.before?.wid||'',blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical write was staged.');}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verifyForeground(detail){
    if(!active()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The outbox row is intentionally retained for retry. Do not make another Learning Metadata edit.');return;}
    let db=null;try{db=await openDb();const [outbox,row,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,METADATA_STORE,state.active.cardId),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),pass=outbox.length===0&&clean(row?.payloadHash)===state.active.payloadHash&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_PARENT_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:state.active.wid,cardId:state.active.cardId,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:outbox.length,changedFields:clone(state.active.changedFields),blockingIssues:pass?0:1,pass},invariants:{realEditorSave:true,parentFieldsOnly:true,localLineageAdvancedExactlyOnce:true,canonicalPayloadMatchesLocalParent:true,childrenUnchanged:true}};
      show(pass?`PASS · Real WID${state.active.wid} parent edit reached Canonical.`:'CHECK · Parent-edit transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}\nchanged ${state.active.changedFields.join(', ')} · Canonical parent payload matches saved local revision yes`);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.');}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataParentEditCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(active()){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();}
})();
