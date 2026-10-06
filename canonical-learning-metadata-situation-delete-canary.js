/* WLP v1.8.6.363 — Query-gated real Situation child delete/tombstone Canonical canary.
   Query only: ?wlpLearningMetadataSituationDeleteCanary=1 on editor-local-edit.html?wid=5578
   One normal local Save may remove exactly Situation 3. The canary stages one atomic
   two-mutation action: card_learning_metadata lineage + learning_situations tombstone. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.363-learning-metadata-situation-delete-canary-v1';
  const FLAG='wlpLearningMetadataSituationDeleteCanary';
  const TARGET_WID='5578';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata',SITUATION_STORE='learning_situations',ALTERNATIVE_STORE='learning_alternatives',LINK_STORE='learning_alternative_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,report:null,armed:false,busy:false,before:null,active:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const active=()=>params().get(FLAG)==='1';
  const targetWid=()=>clean(params().get('wid'));
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});}
  const cursorValue=(meta,cursor)=>Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursor?.lastSyncCursor||0));

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-situation-delete-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100020;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(840px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation child delete/tombstone canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');
  }
  function show(text,ok=null,detail='',force=false){if(!active()&&!force)return;makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function readSnapshot(db){
    const stores=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE],tx=db.transaction(stores,'readonly'),done=txDone(tx);
    const m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),c=tx.objectStore(CARD_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE),a=tx.objectStore(ALTERNATIVE_STORE),l=tx.objectStore(LINK_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(c.getAll()),req(md.getAll()),req(s.getAll()),req(a.getAll()),req(l.getAll())]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],cards:values[3]||[],metadataRows:values[4]||[],situationRows:values[5]||[],alternativeRows:values[6]||[],linkRows:values[7]||[]};
  }
  async function readVerify(db,parentKey,situationKey){
    const tx=db.transaction([META_STORE,OUTBOX_STORE,METADATA_STORE,SITUATION_STORE],'readonly'),done=txDone(tx),m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(md.get(parentKey)),req(s.get(situationKey))]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],parent:values[3]||null,situation:values[4]||null};
  }
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await done;}

  function localRecord(){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);}
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function situationLineageAdvancedOnce(before,after){return clean(after?.situationId)===clean(before?.situationId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  const situations=r=>Array.isArray(r?.content?.situations)?r.content.situations:[];
  const activeSituations=r=>situations(r).filter(x=>!clean(x?.deletedAt)&&clean(x?.anchor));
  const alternatives=r=>Array.isArray(r?.content?.alternativeExpressions)?r.content.alternativeExpressions:[];
  function situationContent(s){return{situationId:clean(s?.situationId),status:clean(s?.status)||'provisional',title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed)};}
  function parentPayloadFromLocal(basePayload,record,cardId){const c=record?.content||{};return{...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};}
  function situationPayloadFromLocal(basePayload,situation,cardId){return{...clone(basePayload),card_id:cardId,source_situation_id:clean(situation.situationId)||null,status:clean(situation.status)||null,revision:Math.max(1,Number(situation.revision)||1),version_id:clean(situation.versionId)||null,parent_version_id:clean(situation.parentVersionId)||null,created_at:clean(situation.createdAt)||null,updated_at:clean(situation.updatedAt)||null,created_by_device:clean(situation.createdByDevice)||clean(basePayload?.created_by_device)||null,updated_by_device:clean(situation.updatedByDevice)||null,deleted_at:clean(situation.deletedAt)||null,title:clean(situation.title),anchor:clean(situation.anchor),communicative_need:clean(situation.communicativeNeed),source_history:Array.isArray(situation.history)?clone(situation.history):[]};}

  function resolveCanonical(snap,local){
    if(!snap.meta||clean(snap.meta.candidateKey)!==BASE.candidateKey||Number(snap.meta.headVersion||0)!==BASE.headVersion||clean(snap.meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation-delete canary requires ACTIVE Authority v3.');
    const cardWrap=snap.cards.find(w=>clean(payload(w).legacy_key)===`wid:${TARGET_WID}`);if(!cardWrap)throw new Error(`Canonical WID${TARGET_WID} card is missing.`);const cardId=clean(cardWrap.rowKey||payload(cardWrap).card_id);if(!cardId)throw new Error('Canonical card identity is missing.');
    const parent=snap.metadataRows.find(w=>clean(payload(w).card_id)===cardId&&!clean(payload(w).deleted_at));if(!parent)throw new Error('Canonical Learning Metadata parent is missing.');
    const localActive=activeSituations(local);if(localActive.length!==3)throw new Error(`WID5578 must have exactly three active Situations before delete; found ${localActive.length}.`);
    const targetLocal=localActive[2],sourceSituationId=clean(targetLocal.situationId);if(!sourceSituationId)throw new Error('Situation 3 source identity is missing.');
    const target=snap.situationRows.find(w=>clean(payload(w).card_id)===cardId&&clean(payload(w).source_situation_id)===sourceSituationId&&!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at));if(!target)throw new Error('Canonical Situation 3 row is missing.');
    const situationCanonicalId=clean(payload(target).situation_id||target.rowKey);if(!situationCanonicalId)throw new Error('Canonical Situation 3 identity is missing.');
    const activeRefs=snap.linkRows.filter(w=>!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)&&clean(payload(w).situation_id)===situationCanonicalId);if(activeRefs.length)throw new Error(`Situation 3 is still referenced by ${activeRefs.length} active Alternative link(s).`);
    const parentRowKey=clean(parent.rowKey||payload(parent).card_id),situationRowKey=clean(target.rowKey||payload(target).situation_id);if(!parentRowKey||!situationRowKey)throw new Error('Canonical row identity is incomplete.');
    return{cardId,parent,target,targetLocal,sourceSituationId,parentRowKey,situationRowKey};
  }

  async function prepare(){
    if(!active())return;if(targetWid()!==TARGET_WID){show(`BLOCKED · Open WID${TARGET_WID} for this canary.`,false,'No data was changed.',true);return;}let db=null;
    try{db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before READY; found ${snap.outbox.length}.`);const local=localRecord(),canonical=resolveCanonical(snap,local),parentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent))),situationHash=clean(canonical.target.payloadHash)||await sha256(stableStringify(payload(canonical.target))),cursor=cursorValue(snap.meta,snap.cursor);
      state.before={cursor,cardId:canonical.cardId,parentHash,situationHash,parentRowKey:canonical.parentRowKey,situationRowKey:canonical.situationRowKey,sourceSituationId:canonical.sourceSituationId,local:clone(local),target:clone(canonical.targetLocal),alternatives:clone(alternatives(local))};state.armed=true;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_DELETE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{threeActiveSituations:true,targetSituation3Unreferenced:true,noDataChangedBeforeSave:true}};
      show(`READY · WID${TARGET_WID} Situation 3 delete is armed.`,true,`cursor ${cursor} · outbox 0\nTarget: Situation 3 only\nPress Remove on Situation 3, then Save Changes once.\nDo not change Situations 1/2, Alternatives, Sense, Memory, Entry Type, or any other field.`);
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_SITUATION_DELETE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-ready',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical write was staged.',true);}finally{try{db?.close();}catch(_){}}
  }

  async function onLocalChanged(){
    if(!active()||!state.armed||state.busy)return;state.busy=true;let db=null;
    try{
      const before=state.before,after=localRecord();
      if(stableStringify(parentSemantic(before.local))!==stableStringify(parentSemantic(after)))throw new Error('Parent semantic fields changed; delete only Situation 3.');
      if(stableStringify(before.alternatives)!==stableStringify(alternatives(after)))throw new Error('Alternative data changed; delete only Situation 3.');
      const beforeSituations=situations(before.local),afterSituations=situations(after),oldTarget=beforeSituations.find(x=>clean(x.situationId)===before.sourceSituationId),newTarget=afterSituations.find(x=>clean(x.situationId)===before.sourceSituationId);if(!oldTarget||!newTarget)throw new Error('Situation 3 identity disappeared instead of becoming a tombstone.');
      if(!clean(newTarget.deletedAt))throw new Error('Remove exactly Situation 3, then Save Changes once.');
      if(stableStringify(situationContent(oldTarget))!==stableStringify(situationContent(newTarget)))throw new Error('Situation 3 content changed; only deletion is allowed.');
      const otherBefore=beforeSituations.filter(x=>clean(x.situationId)!==before.sourceSituationId),otherAfter=afterSituations.filter(x=>clean(x.situationId)!==before.sourceSituationId);if(stableStringify(otherBefore)!==stableStringify(otherAfter))throw new Error('A non-target Situation changed.');
      if(activeSituations(after).length!==2)throw new Error('Exactly one active Situation must be removed.');
      if(!parentLineageAdvancedOnce(before.local,after))throw new Error('Local parent lineage did not advance exactly once.');
      if(!situationLineageAdvancedOnce(oldTarget,newTarget))throw new Error('Situation 3 lineage did not advance exactly once.');
      state.armed=false;

      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${snap.outbox.length}.`);const canonical=resolveCanonical(snap,before.local),cursorBefore=cursorValue(snap.meta,snap.cursor),currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent))),currentSituationHash=clean(canonical.target.payloadHash)||await sha256(stableStringify(payload(canonical.target)));
      if(currentParentHash!==before.parentHash||currentSituationHash!==before.situationHash)throw new Error('Canonical parent/Situation changed after READY; stale delete was blocked.');
      const nextParentPayload=parentPayloadFromLocal(payload(canonical.parent),after,before.cardId),nextSituationPayload=situationPayloadFromLocal(payload(canonical.target),newTarget,before.cardId),nextParentHash=await sha256(stableStringify(nextParentPayload)),nextSituationHash=await sha256(stableStringify(nextSituationPayload));
      if(nextParentHash===currentParentHash||nextSituationHash===currentSituationHash)throw new Error('Parent/Situation lineage payload did not advance.');
      const actionId=crypto.randomUUID(),createdAt=new Date().toISOString(),baseAuthority={candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash};
      const common={schemaVersion:1,baseAuthority,deviceKey:snap.meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationDeleteCanary:true,transportEligible:true,status:'pending'};
      const parentMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:before.parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
      const situationMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_situations',rowKey:before.situationRowKey,precondition:{payloadHash:currentSituationHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history','deleted_at'],payload:nextSituationPayload,payloadHash:nextSituationHash};
      for(const m of [parentMutation,situationMutation])m.mutationHash=await sha256(stableStringify(m));
      await addOutboxRows(db,[parentMutation,situationMutation]);state.active={actionId,cursorBefore,parentRowKey:before.parentRowKey,situationRowKey:before.situationRowKey,parentHash:nextParentHash,situationHash:nextSituationHash};
      show(`PENDING · WID${TARGET_WID} Situation 3 tombstone staged atomically.`,true,`cursor ${cursorBefore} · outbox 0 → 2\nparent lineage + Situation 3 tombstone\nNo other child write staged.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-delete-canary',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:2,companionTable:'card_learning_metadata'}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_SITUATION_DELETE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical tombstone write was staged.',true);}finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verifyForeground(detail){
    if(!active()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The two-row outbox action is retained for retry. Do not make another Learning Metadata edit.',true);return;}let db=null;
    try{db=await openDb();const snap=await readVerify(db,state.active.parentRowKey,state.active.situationRowKey),cursorAfter=cursorValue(snap.meta,snap.cursor),parentOk=clean(snap.parent?.payloadHash)===state.active.parentHash,situationOk=clean(snap.situation?.payloadHash)===state.active.situationHash&&Boolean(snap.situation?.tombstone),pass=snap.outbox.length===0&&parentOk&&situationOk&&cursorAfter>=state.active.cursorBefore+2;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_DELETE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:snap.outbox.length,blockingIssues:pass?0:1,pass},invariants:{realEditorSave:true,twoRowsSameAction:true,parentPayloadMatch:parentOk,situationTombstoneMatch:situationOk}};
      show(pass?`PASS · WID${TARGET_WID} Situation 3 tombstone reached Canonical.`:'CHECK · Situation delete transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${snap.outbox.length}\nparent ${parentOk?'yes':'no'} · Situation 3 tombstone ${situationOk?'yes':'no'}`,!pass);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataSituationDeleteCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
