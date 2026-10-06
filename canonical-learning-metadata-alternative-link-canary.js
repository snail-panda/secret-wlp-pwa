/* WLP v1.8.6.357 — Query-gated real Alternative <-> Situation link-switch Canonical write canary.
   Query only: ?wlpLearningMetadataAlternativeLinkCanary=1 on editor-local-edit.html?wid=5578
   One normal local Save may change exactly Alternative 1's Situation link from Situation 1 to Situation 2.
   Expression, Note, Situation content, parent semantics, Alternative identity/order, add/remove, and all other fields are blocked.
   Because the local Learning Metadata v2 record advances parent + Alternative lineage for this child edit,
   the canary stages one atomic four-mutation action:
     card_learning_metadata + learning_alternatives + old-link tombstone + new active link. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.358-learning-metadata-alternative-link-canary-card-lookup-fix-v1';
  const FLAG='wlpLearningMetadataAlternativeLinkCanary';
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

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-alternative-link-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100016;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(840px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Alternative ↔ Situation link-switch canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
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
  async function readVerify(db,parentKey,alternativeKey,oldLinkKey,newLinkKey){
    const tx=db.transaction([META_STORE,OUTBOX_STORE,METADATA_STORE,ALTERNATIVE_STORE,LINK_STORE],'readonly'),done=txDone(tx),m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),md=tx.objectStore(METADATA_STORE),a=tx.objectStore(ALTERNATIVE_STORE),l=tx.objectStore(LINK_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(md.get(parentKey)),req(a.get(alternativeKey)),req(l.get(oldLinkKey)),req(l.get(newLinkKey))]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],parent:values[3]||null,alternative:values[4]||null,oldLink:values[5]||null,newLink:values[6]||null};
  }
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await done;}
  const cursorValue=(meta,cursor)=>Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursor?.lastSyncCursor||0));

  function localRecord(){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);}
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function alternativeLineageAdvancedOnce(before,after){return clean(after?.alternativeId)===clean(before?.alternativeId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function activeAlternatives(r){return(Array.isArray(r?.content?.alternativeExpressions)?r.content.alternativeExpressions:[]).filter(x=>!clean(x?.deletedAt)&&clean(x?.expression));}
  function situations(r){return Array.isArray(r?.content?.situations)?r.content.situations:[];}
  function altContentWithoutLinks(a){return{alternativeId:clean(a?.alternativeId),status:clean(a?.status)||'provisional',deletedAt:clean(a?.deletedAt),expression:clean(a?.expression),note:clean(a?.note)};}
  const linkIds=a=>(Array.isArray(a?.situationIds)?a.situationIds:[]).map(clean).filter(Boolean);

  function parentPayloadFromLocal(basePayload,record,cardId){const c=record?.content||{};return{...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};}
  function alternativePayloadFromLocal(basePayload,alternative,cardId){return{...clone(basePayload),card_id:cardId,source_alternative_id:clean(alternative.alternativeId)||null,status:clean(alternative.status)||null,revision:Math.max(1,Number(alternative.revision)||1),version_id:clean(alternative.versionId)||null,parent_version_id:clean(alternative.parentVersionId)||null,created_at:clean(alternative.createdAt)||null,updated_at:clean(alternative.updatedAt)||null,created_by_device:clean(alternative.createdByDevice)||clean(basePayload?.created_by_device)||null,updated_by_device:clean(alternative.updatedByDevice)||null,deleted_at:clean(alternative.deletedAt)||null,expression:clean(alternative.expression),notes:clean(alternative.note),source_history:Array.isArray(alternative.history)?clone(alternative.history):[]};}

  function resolveCanonical(snap,local){
    if(!snap.meta||clean(snap.meta.candidateKey)!==BASE.candidateKey||Number(snap.meta.headVersion||0)!==BASE.headVersion||clean(snap.meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Alternative-link canary requires ACTIVE Authority v3.');
    const cardWrap=snap.cards.find(w=>clean(payload(w).legacy_key)===`wid:${TARGET_WID}`);if(!cardWrap)throw new Error(`Canonical WID${TARGET_WID} card is missing.`);const cardId=clean(cardWrap.rowKey||payload(cardWrap).card_id);if(!cardId)throw new Error('Canonical card identity is missing.');
    const parent=snap.metadataRows.find(w=>clean(payload(w).card_id)===cardId&&!clean(payload(w).deleted_at));if(!parent)throw new Error('Canonical Learning Metadata parent is missing.');
    const localAlts=activeAlternatives(local),localSituations=situations(local);if(localAlts.length<1||localSituations.length<2)throw new Error('WID5578 needs Alternative 1 and at least two Situations for this canary.');
    const targetLocalAlt=localAlts[0],sourceAltId=clean(targetLocalAlt.alternativeId);const targetAlt=snap.alternativeRows.find(w=>clean(payload(w).card_id)===cardId&&clean(payload(w).source_alternative_id)===sourceAltId&&!clean(payload(w).deleted_at));if(!targetAlt)throw new Error('Canonical Alternative 1 identity is missing.');
    const sourceSituation1=clean(localSituations[0]?.situationId),sourceSituation2=clean(localSituations[1]?.situationId);if(!sourceSituation1||!sourceSituation2||sourceSituation1===sourceSituation2)throw new Error('Situation 1/2 source identities are invalid.');
    const sit1=snap.situationRows.find(w=>clean(payload(w).card_id)===cardId&&clean(payload(w).source_situation_id)===sourceSituation1&&!clean(payload(w).deleted_at));
    const sit2=snap.situationRows.find(w=>clean(payload(w).card_id)===cardId&&clean(payload(w).source_situation_id)===sourceSituation2&&!clean(payload(w).deleted_at));
    if(!sit1||!sit2)throw new Error('Canonical Situation 1/2 mapping is incomplete.');
    const altCanonicalId=clean(payload(targetAlt).alternative_id||targetAlt.rowKey),sit1CanonicalId=clean(payload(sit1).situation_id||sit1.rowKey),sit2CanonicalId=clean(payload(sit2).situation_id||sit2.rowKey);
    const activeLinks=snap.linkRows.filter(w=>!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)&&clean(payload(w).alternative_id)===altCanonicalId);
    const oldLink=activeLinks.find(w=>clean(payload(w).situation_id)===sit1CanonicalId);
    if(!oldLink||activeLinks.length!==1)throw new Error(`Alternative 1 must have exactly one active Canonical link to Situation 1; found ${activeLinks.length}.`);
    if(linkIds(targetLocalAlt).length!==1||linkIds(targetLocalAlt)[0]!==sourceSituation1)throw new Error('Local Alternative 1 must currently link only to Situation 1.');
    return{cardId,parent,targetAlt,oldLink,targetLocalAlt,sourceAltId,sourceSituation1,sourceSituation2,sit1CanonicalId,sit2CanonicalId,altCanonicalId,parentRowKey:clean(parent.rowKey||payload(parent).card_id),alternativeRowKey:clean(targetAlt.rowKey||payload(targetAlt).alternative_id),oldLinkRowKey:clean(oldLink.rowKey||payload(oldLink).link_id)};
  }

  async function prepare(){
    if(!active())return;if(targetWid()!==TARGET_WID){show(`BLOCKED · Open WID${TARGET_WID} for this canary.`,false,'No data was changed.',true);return;}let db=null;
    try{db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before READY; found ${snap.outbox.length}.`);const local=localRecord(),canonical=resolveCanonical(snap,local),parentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent))),alternativeHash=clean(canonical.targetAlt.payloadHash)||await sha256(stableStringify(payload(canonical.targetAlt))),oldLinkHash=clean(canonical.oldLink.payloadHash)||await sha256(stableStringify(payload(canonical.oldLink))),cursor=cursorValue(snap.meta,snap.cursor);
      state.before={cursor,cardId:canonical.cardId,parentHash,alternativeHash,oldLinkHash,parentRowKey:canonical.parentRowKey,alternativeRowKey:canonical.alternativeRowKey,oldLinkRowKey:canonical.oldLinkRowKey,altCanonicalId:canonical.altCanonicalId,sit1CanonicalId:canonical.sit1CanonicalId,sit2CanonicalId:canonical.sit2CanonicalId,sourceSituation1:canonical.sourceSituation1,sourceSituation2:canonical.sourceSituation2,sourceAltId:canonical.sourceAltId,local:clone(local),target:clone(canonical.targetLocalAlt)};state.armed=true;
      state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_LINK_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{localAlternative1LinksSituation1:true,canonicalOldLinkExact:true,noDataChangedBeforeSave:true}};
      show(`READY · WID${TARGET_WID} Alternative 1 link switch is armed.`,true,`cursor ${cursor} · outbox 0\nAlternative 1 currently: Situation 1\nChange only Alternative 1 → Situation link from Situation 1 to Situation 2, then press Save Changes once.\nDo not change Expression, Note, Situations, or any other field.`);
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_LINK_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-ready',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical write was staged.',true);}finally{try{db?.close();}catch(_){}}
  }

  async function onLocalChanged(){
    if(!active()||!state.armed||state.busy)return;state.busy=true;let db=null;
    try{
      const before=state.before,after=localRecord();
      if(stableStringify(parentSemantic(before.local))!==stableStringify(parentSemantic(after)))throw new Error('Entry Type / Sense Hook / Memory Hook changed; link canary requires parent semantics unchanged.');
      if(stableStringify(situations(before.local))!==stableStringify(situations(after)))throw new Error('Situation content changed; link canary stages no Situation rows.');
      const beforeAlts=activeAlternatives(before.local),afterAlts=activeAlternatives(after);if(beforeAlts.length!==afterAlts.length||beforeAlts.map(x=>clean(x.alternativeId)).join('|')!==afterAlts.map(x=>clean(x.alternativeId)).join('|'))throw new Error('Alternative add/remove/reorder is not allowed.');
      const oldAlt=beforeAlts.find(x=>clean(x.alternativeId)===before.sourceAltId),newAlt=afterAlts.find(x=>clean(x.alternativeId)===before.sourceAltId);if(!oldAlt||!newAlt)throw new Error('Alternative 1 identity changed.');
      if(stableStringify(altContentWithoutLinks(oldAlt))!==stableStringify(altContentWithoutLinks(newAlt)))throw new Error('Alternative Expression/Note/status changed; only the Situation link may change.');
      const oldIds=linkIds(oldAlt),newIds=linkIds(newAlt);if(oldIds.length!==1||oldIds[0]!==before.sourceSituation1||newIds.length!==1||newIds[0]!==before.sourceSituation2)throw new Error('Change exactly Alternative 1 link: Situation 1 → Situation 2.');
      const otherBefore=beforeAlts.filter(x=>clean(x.alternativeId)!==before.sourceAltId),otherAfter=afterAlts.filter(x=>clean(x.alternativeId)!==before.sourceAltId);if(stableStringify(otherBefore)!==stableStringify(otherAfter))throw new Error('A non-target Alternative changed.');
      if(!parentLineageAdvancedOnce(before.local,after))throw new Error('Local parent lineage did not advance exactly once.');
      if(!alternativeLineageAdvancedOnce(oldAlt,newAlt))throw new Error('Alternative 1 lineage did not advance exactly once.');
      state.armed=false;

      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${snap.outbox.length}.`);const canonical=resolveCanonical(snap,before.local),cursorBefore=cursorValue(snap.meta,snap.cursor),currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent))),currentAlternativeHash=clean(canonical.targetAlt.payloadHash)||await sha256(stableStringify(payload(canonical.targetAlt))),currentOldLinkHash=clean(canonical.oldLink.payloadHash)||await sha256(stableStringify(payload(canonical.oldLink)));
      if(currentParentHash!==before.parentHash||currentAlternativeHash!==before.alternativeHash||currentOldLinkHash!==before.oldLinkHash)throw new Error('Canonical parent/Alternative/link changed after READY; stale link edit was blocked.');
      const now=new Date().toISOString(),deviceKey=clean(snap.meta.deviceKey),nextParentPayload=parentPayloadFromLocal(payload(canonical.parent),after,before.cardId),nextAlternativePayload=alternativePayloadFromLocal(payload(canonical.targetAlt),newAlt,before.cardId),oldLinkPayload={...clone(payload(canonical.oldLink)),deleted_at:now};
      if(Object.prototype.hasOwnProperty.call(oldLinkPayload,'updated_at'))oldLinkPayload.updated_at=now;if(Object.prototype.hasOwnProperty.call(oldLinkPayload,'updated_by_device'))oldLinkPayload.updated_by_device=deviceKey||oldLinkPayload.updated_by_device||null;
      const newLinkId=crypto.randomUUID(),newLinkPayload={...clone(payload(canonical.oldLink)),link_id:newLinkId,alternative_id:before.altCanonicalId,situation_id:before.sit2CanonicalId,deleted_at:null};
      if(Object.prototype.hasOwnProperty.call(newLinkPayload,'source_alternative_id'))newLinkPayload.source_alternative_id=before.sourceAltId;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'source_situation_id'))newLinkPayload.source_situation_id=before.sourceSituation2;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'created_at'))newLinkPayload.created_at=now;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'updated_at'))newLinkPayload.updated_at=now;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'created_by_device'))newLinkPayload.created_by_device=deviceKey||newLinkPayload.created_by_device||null;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'updated_by_device'))newLinkPayload.updated_by_device=deviceKey||newLinkPayload.updated_by_device||null;
      const nextParentHash=await sha256(stableStringify(nextParentPayload)),nextAlternativeHash=await sha256(stableStringify(nextAlternativePayload)),oldLinkNextHash=await sha256(stableStringify(oldLinkPayload)),newLinkHash=await sha256(stableStringify(newLinkPayload));
      if(nextParentHash===currentParentHash||nextAlternativeHash===currentAlternativeHash)throw new Error('Parent/Alternative lineage payload did not advance.');
      const actionId=crypto.randomUUID(),createdAt=now,baseAuthority={candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash};
      const common={schemaVersion:1,baseAuthority,deviceKey:snap.meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataAlternativeLinkCanary:true,transportEligible:true,status:'pending'};
      const parentMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:before.parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
      const alternativeMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternatives',rowKey:before.alternativeRowKey,precondition:{payloadHash:currentAlternativeHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextAlternativePayload,payloadHash:nextAlternativeHash};
      const oldLinkMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternative_situations',rowKey:before.oldLinkRowKey,precondition:{payloadHash:currentOldLinkHash},changedFields:['deleted_at','updated_at','updated_by_device'],payload:oldLinkPayload,payloadHash:oldLinkNextHash};
      const newLinkMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternative_situations',rowKey:newLinkId,precondition:{mustBeMissing:true},changedFields:['link_id','alternative_id','situation_id','created_at','updated_at','created_by_device','updated_by_device','deleted_at'],payload:newLinkPayload,payloadHash:newLinkHash};
      for(const m of [parentMutation,alternativeMutation,oldLinkMutation,newLinkMutation])m.mutationHash=await sha256(stableStringify(m));
      await addOutboxRows(db,[parentMutation,alternativeMutation,oldLinkMutation,newLinkMutation]);
      state.active={actionId,cursorBefore,parentRowKey:before.parentRowKey,alternativeRowKey:before.alternativeRowKey,oldLinkRowKey:before.oldLinkRowKey,newLinkRowKey:newLinkId,parentHash:nextParentHash,alternativeHash:nextAlternativeHash,oldLinkHash:oldLinkNextHash,newLinkHash};
      show(`PENDING · WID${TARGET_WID} Alternative 1 link switch staged atomically.`,true,`cursor ${cursorBefore} · outbox 0 → 4\nSituation 1 → Situation 2\nparent + Alternative lineage + old-link tombstone + new active link`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-alternative-link-canary',tableName:'learning_alternative_situations',mutationKind:'upsert',actionId,mutationCount:4,companionTable:'card_learning_metadata'}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_LINK_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical link write was staged.',true);}finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verifyForeground(detail){
    if(!active()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The four-row outbox action is retained for retry. Do not make another Learning Metadata edit.',true);return;}let db=null;
    try{db=await openDb();const snap=await readVerify(db,state.active.parentRowKey,state.active.alternativeRowKey,state.active.oldLinkRowKey,state.active.newLinkRowKey),cursorAfter=cursorValue(snap.meta,snap.cursor),parentOk=clean(snap.parent?.payloadHash)===state.active.parentHash,alternativeOk=clean(snap.alternative?.payloadHash)===state.active.alternativeHash,oldLinkOk=clean(snap.oldLink?.payloadHash)===state.active.oldLinkHash&&Boolean(snap.oldLink?.tombstone),newLinkOk=clean(snap.newLink?.payloadHash)===state.active.newLinkHash&&!Boolean(snap.newLink?.tombstone),pass=snap.outbox.length===0&&parentOk&&alternativeOk&&oldLinkOk&&newLinkOk&&cursorAfter>=state.active.cursorBefore+4;
      state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_LINK_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:snap.outbox.length,blockingIssues:pass?0:1,pass},invariants:{realEditorSave:true,fourRowsSameAction:true,parentPayloadMatch:parentOk,alternativeLineageMatch:alternativeOk,oldLinkTombstoneMatch:oldLinkOk,newLinkActiveMatch:newLinkOk,noSituationContentWrite:true}};
      show(pass?`PASS · WID${TARGET_WID} Alternative ↔ Situation link switch reached Canonical.`:'CHECK · Link-switch transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${snap.outbox.length}\nparent ${parentOk?'yes':'no'} · Alternative ${alternativeOk?'yes':'no'} · old-link tombstone ${oldLinkOk?'yes':'no'} · new-link active ${newLinkOk?'yes':'no'}\nSituation 1 → Situation 2`,!pass);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataAlternativeLinkCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
