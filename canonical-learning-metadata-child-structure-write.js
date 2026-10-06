/* WLP v1.8.6.374 — Learning Metadata proven child-structure production write + save safety gate.
   Production default on editor-local-edit.html?wid=... .
   Read-only diagnostic panel: ?wlpLearningMetadataResidualAudit=1
   Explicit rollback/compatibility: ?wlpLegacyLearningMetadataChildStructureWrite=1

   Productionized shapes are deliberately limited to child mutations already proven by the
   Canonical cutover canaries:
   - one existing Alternative expression OR note revision;
   - one existing Alternative one-link -> one-link Situation switch;
   - one existing unlinked Situation tombstone/delete.

   The capture-phase save gate blocks unproven Learning Metadata structural shapes before the
   local Learning Metadata store is changed. Parent-only and one existing-Situation content edits
   remain owned by their existing production-default writers. Diagnostic/canary query modes retain
   their historical behavior and are not intercepted by this module. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.374-learning-metadata-child-structure-production-v1';
  const DIAG_FLAG='wlpLearningMetadataResidualAudit';
  const ROLLBACK_FLAG='wlpLegacyLearningMetadataChildStructureWrite';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata',SITUATION_STORE='learning_situations',ALTERNATIVE_STORE='learning_alternatives',LINK_STORE='learning_alternative_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const CANARY_FLAGS=[
    'wlpLearningMetadataAlternativeEditCanary','wlpLearningMetadataAlternativeLinkCanary',
    'wlpLearningMetadataSituationDeleteCanary','wlpLearningMetadataSituationRestoreCanary',
    'wlpLearningMetadataSituationConflictCanary','wlpLearningMetadataChildMergeCanary',
    'wlpLearningMetadataSituationEditCanary','wlpLearningMetadataParentEditCanary'
  ];
  const state={panel:null,status:null,detail:null,report:null,ready:false,busy:false,before:null,pendingPlan:null,active:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const diagnostics=()=>params().get(DIAG_FLAG)==='1';
  const rollback=()=>params().get(ROLLBACK_FLAG)==='1';
  const canaryMode=()=>CANARY_FLAGS.some(flag=>params().has(flag));
  const targetWid=()=>clean(params().get('wid'));
  const productionActive=()=>!rollback()&&!canaryMode()&&/^\d+$/.test(targetWid());
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}

  function makePanel(force=false){
    if(state.panel||(!diagnostics()&&!force))return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-residual-audit';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100025;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(860px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · residual production-path audit</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');
  }
  function show(text,ok=null,detail='',force=false){if(!diagnostics()&&!force)return;makePanel(force);if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function toast(text){const el=document.getElementById('editor-toast');if(!el)return;el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.hidden=true;},6500);}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function readSnapshot(db){
    const stores=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE],tx=db.transaction(stores,'readonly'),done=txDone(tx);
    const m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),c=tx.objectStore(CARD_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE),a=tx.objectStore(ALTERNATIVE_STORE),l=tx.objectStore(LINK_STORE);
    const v=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(c.getAll()),req(md.getAll()),req(s.getAll()),req(a.getAll()),req(l.getAll())]);await done;
    return{meta:v[0]||null,cursor:v[1]||null,outbox:Array.isArray(v[2])?v[2]:[],cards:v[3]||[],metadataRows:v[4]||[],situationRows:v[5]||[],alternativeRows:v[6]||[],linkRows:v[7]||[]};
  }
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await txDone(tx);}
  const cursorValue=(meta,cursor)=>Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursor?.lastSyncCursor||0));

  function localRecord(wid=targetWid()){const r=window.WLPLearningHooks?.getRecord?.(`wid:${wid}`);return r?clone(r):null;}
  const situations=r=>Array.isArray(r?.content?.situations)?r.content.situations:[];
  const activeSituations=r=>situations(r).filter(x=>!clean(x?.deletedAt)&&clean(x?.anchor));
  const alternatives=r=>Array.isArray(r?.content?.alternativeExpressions)?r.content.alternativeExpressions:[];
  const activeAlternatives=r=>alternatives(r).filter(x=>!clean(x?.deletedAt)&&clean(x?.expression));
  const linkIds=a=>(Array.isArray(a?.situationIds)?a.situationIds:[]).map(clean).filter(Boolean);
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function situationSemantic(s){return{situationId:clean(s?.situationId),status:clean(s?.status)||'provisional',title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed),deletedAt:clean(s?.deletedAt)};}
  function alternativeSemantic(a){return{alternativeId:clean(a?.alternativeId),status:clean(a?.status)||'provisional',expression:clean(a?.expression),note:clean(a?.note),situationIds:linkIds(a),deletedAt:clean(a?.deletedAt)};}
  function alternativeContentNoLinks(a){const x=alternativeSemantic(a);delete x.situationIds;return x;}
  function sameParentLineage(local,p){return clean(local?.metadataId)===clean(p?.metadata_id)&&Number(local?.revision||0)===Number(p?.revision||0)&&clean(local?.versionId)===clean(p?.version_id)&&clean(local?.parentVersionId)===clean(p?.parent_version_id);}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function childLineageAdvancedOnce(before,after,idField){return clean(after?.[idField])===clean(before?.[idField])&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function changedAlternativeFields(before,after){const out=[];if(clean(before?.expression)!==clean(after?.expression))out.push('expression');if(clean(before?.note)!==clean(after?.note))out.push('notes');return out;}
  function situationEditable(s){return{situationId:clean(s?.situationId),title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed)};}
  function alternativeEditable(a){return{alternativeId:clean(a?.alternativeId),expression:clean(a?.expression),note:clean(a?.note),situationIds:linkIds(a)};}
  function alternativeEditableNoLinks(a){const x=alternativeEditable(a);delete x.situationIds;return x;}

  function formHasContent(v){return Boolean(clean(v?.entryType)||clean(v?.senseHook)||clean(v?.memoryHook)||(v?.situations||[]).some(x=>clean(x?.anchor))||(v?.alternativeExpressions||[]).some(x=>clean(x?.expression)));}
  function classifyFormChange(before,formValue){
    if(!before){return formHasContent(formValue)?{kind:'unsupported',reason:'Creating new Learning Metadata from this editor is not yet a production Canonical write shape.'}:{kind:'unchanged'};}
    const beforeParent=parentSemantic(before),afterParent={entryType:clean(formValue?.entryType),senseHook:clean(formValue?.senseHook),memoryHook:clean(formValue?.memoryHook),deletedAt:''};
    const parentChanged=stableStringify({...beforeParent,deletedAt:''})!==stableStringify(afterParent);
    const bs=activeSituations(before),as=(Array.isArray(formValue?.situations)?formValue.situations:[]).filter(x=>clean(x?.anchor));
    const ba=activeAlternatives(before),aa=(Array.isArray(formValue?.alternativeExpressions)?formValue.alternativeExpressions:[]).filter(x=>clean(x?.expression));
    const bsm=new Map(bs.map(x=>[clean(x.situationId),x])),asm=new Map(as.map(x=>[clean(x.situationId),x]));
    const bam=new Map(ba.map(x=>[clean(x.alternativeId),x])),aam=new Map(aa.map(x=>[clean(x.alternativeId),x]));
    const sAdded=as.filter(x=>!bsm.has(clean(x.situationId))),sRemoved=bs.filter(x=>!asm.has(clean(x.situationId))),sChanged=bs.filter(x=>asm.has(clean(x.situationId))&&stableStringify(situationEditable(x))!==stableStringify(situationEditable(asm.get(clean(x.situationId)))));
    const aAdded=aa.filter(x=>!bam.has(clean(x.alternativeId))),aRemoved=ba.filter(x=>!aam.has(clean(x.alternativeId))),aChanged=ba.filter(x=>aam.has(clean(x.alternativeId))&&stableStringify(alternativeEditable(x))!==stableStringify(alternativeEditable(aam.get(clean(x.alternativeId)))));
    const totalChild=sAdded.length+sRemoved.length+sChanged.length+aAdded.length+aRemoved.length+aChanged.length;
    if(!parentChanged&&!totalChild)return{kind:'unchanged'};
    if(parentChanged&&!totalChild)return{kind:'parent-only'};
    if(parentChanged)return{kind:'unsupported',reason:'A parent-field edit cannot be mixed with a child edit in one Save yet.'};
    if(sAdded.length||aAdded.length)return{kind:'unsupported',reason:'Adding Situation/Alternative children is not yet a production Canonical write shape.'};
    if(aRemoved.length)return{kind:'unsupported',reason:'Removing an Alternative is not yet a production Canonical write shape.'};
    if(sRemoved.length===1&&!sChanged.length&&!aChanged.length){
      const target=sRemoved[0],id=clean(target.situationId),refs=ba.filter(a=>linkIds(a).includes(id));
      if(refs.length)return{kind:'unsupported',reason:'A Situation that is still linked by an Alternative cannot be removed by the production path.'};
      return{kind:'situation-delete',sourceSituationId:id};
    }
    if(sRemoved.length||sChanged.length>1||aChanged.length>1||(sChanged.length&&aChanged.length))return{kind:'unsupported',reason:'This Save changes more than one supported Learning Metadata child shape.'};
    if(sChanged.length===1){
      const old=sChanged[0],next=asm.get(clean(old.situationId));
      if(!next||clean(old.situationId)!==clean(next.situationId))return{kind:'unsupported',reason:'Situation identity changed.'};
      return{kind:'situation-edit',sourceSituationId:clean(old.situationId)};
    }
    if(aChanged.length===1){
      const old=aChanged[0],next=aam.get(clean(old.alternativeId));if(!next)return{kind:'unsupported',reason:'Alternative identity changed.'};
      const oldLinks=linkIds(old),newLinks=linkIds(next),contentChanged=stableStringify(alternativeEditableNoLinks(old))!==stableStringify(alternativeEditableNoLinks(next)),linksChanged=stableStringify(oldLinks)!==stableStringify(newLinks);
      if(contentChanged&&linksChanged)return{kind:'unsupported',reason:'Alternative content and its Situation link cannot change in the same Save yet.'};
      if(contentChanged){const fields=changedAlternativeFields(old,next);if(fields.length!==1)return{kind:'unsupported',reason:'Change exactly one Alternative field (Expression OR Note) per Save.'};return{kind:'alternative-content',sourceAlternativeId:clean(old.alternativeId),changedFields:fields};}
      if(linksChanged){if(oldLinks.length!==1||newLinks.length!==1)return{kind:'unsupported',reason:'The production Alternative link path supports one existing link switching to one existing Situation.'};if(!bsm.has(newLinks[0]))return{kind:'unsupported',reason:'The target Situation for the Alternative link must already exist.'};return{kind:'alternative-link',sourceAlternativeId:clean(old.alternativeId),oldSourceSituationId:oldLinks[0],newSourceSituationId:newLinks[0]};}
    }
    return{kind:'unsupported',reason:'This Learning Metadata change is outside the production-proven Canonical shapes.'};
  }

  function parentPayloadFromLocal(basePayload,record,cardId){const c=record?.content||{};return{...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};}
  function situationPayloadFromLocal(basePayload,situation,cardId){return{...clone(basePayload),card_id:cardId,source_situation_id:clean(situation.situationId)||null,status:clean(situation.status)||null,revision:Math.max(1,Number(situation.revision)||1),version_id:clean(situation.versionId)||null,parent_version_id:clean(situation.parentVersionId)||null,created_at:clean(situation.createdAt)||null,updated_at:clean(situation.updatedAt)||null,created_by_device:clean(situation.createdByDevice)||clean(basePayload?.created_by_device)||null,updated_by_device:clean(situation.updatedByDevice)||null,deleted_at:clean(situation.deletedAt)||null,title:clean(situation.title),anchor:clean(situation.anchor),communicative_need:clean(situation.communicativeNeed),source_history:Array.isArray(situation.history)?clone(situation.history):[]};}
  function alternativePayloadFromLocal(basePayload,alternative,cardId){return{...clone(basePayload),card_id:cardId,source_alternative_id:clean(alternative.alternativeId)||null,status:clean(alternative.status)||null,revision:Math.max(1,Number(alternative.revision)||1),version_id:clean(alternative.versionId)||null,parent_version_id:clean(alternative.parentVersionId)||null,created_at:clean(alternative.createdAt)||null,updated_at:clean(alternative.updatedAt)||null,created_by_device:clean(alternative.createdByDevice)||clean(basePayload?.created_by_device)||null,updated_by_device:clean(alternative.updatedByDevice)||null,deleted_at:clean(alternative.deletedAt)||null,expression:clean(alternative.expression),notes:clean(alternative.note),source_history:Array.isArray(alternative.history)?clone(alternative.history):[]};}

  function resolveCanonical(snap,wid,local){
    if(!snap.meta||clean(snap.meta.candidateKey)!==BASE.candidateKey||Number(snap.meta.headVersion||0)!==BASE.headVersion||clean(snap.meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Production child writer requires ACTIVE Authority v3.');
    const card=snap.cards.find(w=>clean(payload(w).legacy_key)===`wid:${wid}`);if(!card)throw new Error(`Canonical card for WID${wid} is missing.`);const cardId=clean(card.rowKey||payload(card).card_id);if(!cardId)throw new Error('Canonical card identity is missing.');
    const parent=snap.metadataRows.find(w=>clean(payload(w).card_id)===cardId&&!clean(payload(w).deleted_at));if(!parent)throw new Error(`Canonical Learning Metadata parent for WID${wid} is missing.`);const pp=payload(parent);
    if(!sameParentLineage(local,pp)||stableStringify(parentSemantic(local))!==stableStringify({entryType:clean(pp.entry_type),senseHook:clean(pp.sense_hook),memoryHook:clean(pp.memory_hook),deletedAt:clean(pp.deleted_at)}))throw new Error('Local parent is not semantic/lineage exact to Canonical.');
    const canonicalSituations=new Map(),canonicalSituationIdToSource=new Map();
    snap.situationRows.filter(w=>clean(payload(w).card_id)===cardId).forEach(w=>{const p=payload(w),source=clean(p.source_situation_id),canonicalId=clean(p.situation_id||w.rowKey);if(source){canonicalSituations.set(source,w);if(canonicalId)canonicalSituationIdToSource.set(canonicalId,source);}});
    const canonicalAlternatives=new Map(),canonicalAltIdToSource=new Map();
    snap.alternativeRows.filter(w=>clean(payload(w).card_id)===cardId).forEach(w=>{const p=payload(w),source=clean(p.source_alternative_id),canonicalId=clean(p.alternative_id||w.rowKey);if(source){canonicalAlternatives.set(source,w);if(canonicalId)canonicalAltIdToSource.set(canonicalId,source);}});
    const activeLinksByAlt=new Map();
    snap.linkRows.filter(w=>!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)).forEach(w=>{const p=payload(w),sourceAlt=canonicalAltIdToSource.get(clean(p.alternative_id)),sourceSit=canonicalSituationIdToSource.get(clean(p.situation_id));if(!sourceAlt||!sourceSit)return;if(!activeLinksByAlt.has(sourceAlt))activeLinksByAlt.set(sourceAlt,[]);activeLinksByAlt.get(sourceAlt).push({wrapper:w,sourceSituationId:sourceSit});});
    for(const s of situations(local)){const id=clean(s.situationId),w=canonicalSituations.get(id);if(!w)throw new Error(`Canonical Situation ${id||'(missing id)'} is missing.`);const p=payload(w),expected={situationId:id,status:clean(p.status)||'provisional',title:clean(p.title),anchor:clean(p.anchor),communicativeNeed:clean(p.communicative_need),deletedAt:clean(p.deleted_at)};if(stableStringify(situationSemantic(s))!==stableStringify(expected)||Number(s.revision||0)!==Number(p.revision||0)||clean(s.versionId)!==clean(p.version_id)||clean(s.parentVersionId)!==clean(p.parent_version_id))throw new Error(`Local Situation ${id} is not semantic/lineage exact to Canonical.`);}
    for(const a of alternatives(local)){const id=clean(a.alternativeId),w=canonicalAlternatives.get(id);if(!w)throw new Error(`Canonical Alternative ${id||'(missing id)'} is missing.`);const p=payload(w),expected={alternativeId:id,status:clean(p.status)||'provisional',expression:clean(p.expression),note:clean(p.notes),situationIds:(activeLinksByAlt.get(id)||[]).map(x=>x.sourceSituationId),deletedAt:clean(p.deleted_at)};if(stableStringify(alternativeSemantic(a))!==stableStringify(expected)||Number(a.revision||0)!==Number(p.revision||0)||clean(a.versionId)!==clean(p.version_id)||clean(a.parentVersionId)!==clean(p.parent_version_id))throw new Error(`Local Alternative ${id} is not semantic/lineage exact to Canonical.`);}
    return{cardId,parent,parentRowKey:clean(parent.rowKey||cardId),canonicalSituations,canonicalAlternatives,activeLinksByAlt};
  }

  async function prepare(){
    if(!productionActive()){if(diagnostics()&&rollback())show('ROLLBACK · Child-structure production path is disabled.',null,'Explicit rollback was requested.');return;}
    let db=null;state.ready=false;state.before=null;state.pendingPlan=null;
    try{
      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must start empty; found ${snap.outbox.length}.`);const wid=targetWid(),local=localRecord(wid);
      if(!local){state.report={format:'WLP_LEARNING_METADATA_RESIDUAL_PRODUCTION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready-no-metadata',summary:{wordId:wid,cursor:cursorValue(snap.meta,snap.cursor),outbox:0,blockingIssues:0,pass:true},invariants:{existingMetadataProductionPathsGuarded:true,newMetadataCreationBlockedBeforeLocalSave:true}};show(`PASS · WID${wid} has no existing Learning Metadata; unsupported creation is gated.`,true,`cursor ${cursorValue(snap.meta,snap.cursor)} · outbox 0\nNormal card edits remain available. New Learning Metadata creation is blocked before local save until it has a proven Canonical source path.`);return;}
      const canonical=resolveCanonical(snap,wid,local),parentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent)));
      const situationHashes={},alternativeHashes={},linkHashes={};
      for(const [id,w] of canonical.canonicalSituations)situationHashes[id]=clean(w.payloadHash)||await sha256(stableStringify(payload(w)));
      for(const [id,w] of canonical.canonicalAlternatives)alternativeHashes[id]=clean(w.payloadHash)||await sha256(stableStringify(payload(w)));
      for(const [aid,links] of canonical.activeLinksByAlt)for(const x of links){const key=clean(x.wrapper.rowKey||payload(x.wrapper).link_id);if(key)linkHashes[key]=clean(x.wrapper.payloadHash)||await sha256(stableStringify(payload(x.wrapper)));}
      state.before={wid,cursor:cursorValue(snap.meta,snap.cursor),local:clone(local),cardId:canonical.cardId,parentRowKey:canonical.parentRowKey,parentHash,situationHashes,alternativeHashes,linkHashes};state.ready=true;
      state.report={format:'WLP_LEARNING_METADATA_RESIDUAL_PRODUCTION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:wid,cursor:state.before.cursor,outbox:0,blockingIssues:0,pass:true},invariants:{localSemanticLineageExactCanonical:true,normalSaveGateArmed:true,parentWriteDelegated:true,existingSituationWriteDelegated:true,alternativeContentProduction:true,alternativeLinkProduction:true,unlinkedSituationTombstoneProduction:true,unprovenStructuralShapesBlockedBeforeLocalSave:true}};
      show(`PASS · WID${wid} normal Learning Metadata save paths are Canonical-gated.`,true,`cursor ${state.before.cursor} · outbox 0 · local semantic/lineage exact Canonical yes\nProduction: parent fields · existing Situation content · Alternative Expression/Note · one-link switch · unlinked Situation delete\nBlocked before local save: add Situation/Alternative · remove Alternative · linked Situation delete · compound/unproven child shapes.`);
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_RESIDUAL_PRODUCTION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{wordId:targetWid(),blockingIssues:1,pass:false}};show(`CHECK · ${String(e?.message||e)}`,false,'Learning Metadata changes are safety-gated until the page is Canonical-ready. Normal card-field-only edits remain available.',true);}
    finally{try{db?.close();}catch(_){} }
  }

  function moduleReady(name){const r=window[name]?.getReport?.();return r&&r.phase==='ready'&&r.summary?.pass===true;}
  function blockSubmit(event,reason){event.preventDefault();event.stopImmediatePropagation();state.pendingPlan=null;toast(`Learning Metadata save blocked: ${reason}`);show(`BLOCKED · ${reason}`,false,'No Learning Metadata local save or Canonical write was performed.',true);}
  function onSubmitCapture(event){
    const form=event.target;if(!form||form.id!=='local-edit-form'||!productionActive())return;
    const api=window.WLPLearningHooks;if(!api?.fromForm||!api?.getRecord)return blockSubmit(event,'Learning Metadata engine is unavailable.');
    const before=localRecord(),proposed=api.fromForm(form),plan=classifyFormChange(before,proposed);state.pendingPlan=null;
    if(plan.kind==='unchanged')return;
    if(plan.kind==='unsupported')return blockSubmit(event,plan.reason);
    if(plan.kind==='parent-only'){if(!moduleReady('WLPCanonicalLearningMetadataParentWrite'))return blockSubmit(event,'Canonical parent writer is not READY; wait for the page checks to finish, then try again.');return;}
    if(plan.kind==='situation-edit'){if(!moduleReady('WLPCanonicalLearningMetadataSituationWrite'))return blockSubmit(event,'Canonical Situation writer is not READY; wait for the page checks to finish, then try again.');return;}
    if(!state.ready||!state.before||stableStringify(before)!==stableStringify(state.before.local))return blockSubmit(event,'Canonical child baseline changed after page load; reopen this editor before saving the child change.');
    state.pendingPlan={...plan,before:clone(before)};
  }

  async function onLocalChanged(){
    if(!productionActive()||!state.pendingPlan||state.busy)return;const plan=state.pendingPlan;state.pendingPlan=null;state.busy=true;let db=null;
    try{
      const after=localRecord(),before=plan.before;if(!after)throw new Error('Learning Metadata disappeared after Save.');
      if(!parentLineageAdvancedOnce(before,after))throw new Error('Local metadata parent lineage did not advance exactly once for this child structural edit.');
      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${snap.outbox.length}.`);const canonical=resolveCanonical(snap,state.before.wid,before),currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent)));if(currentParentHash!==state.before.parentHash)throw new Error('Canonical parent changed after READY; stale child write was blocked.');
      const baseAuthority={candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash},deviceKey=snap.meta.deviceKey||null,actionId=crypto.randomUUID(),createdAt=new Date().toISOString(),common={schemaVersion:1,baseAuthority,deviceKey,actionId:null,createdAt:null,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataChildStructureProduction:true,transportEligible:true,status:'pending'};common.actionId=actionId;common.createdAt=createdAt;
      const nextParentPayload=parentPayloadFromLocal(payload(canonical.parent),after,state.before.cardId),nextParentHash=await sha256(stableStringify(nextParentPayload));if(nextParentHash===currentParentHash)throw new Error('Parent lineage payload did not advance for child structural edit.');
      const parentMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:state.before.parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
      const rows=[parentMutation],verify={kind:plan.kind,parentRowKey:state.before.parentRowKey,parentHash:nextParentHash};

      if(plan.kind==='alternative-content'){
        const oldAlt=alternatives(before).find(x=>clean(x.alternativeId)===plan.sourceAlternativeId),newAlt=alternatives(after).find(x=>clean(x.alternativeId)===plan.sourceAlternativeId);if(!oldAlt||!newAlt||!childLineageAdvancedOnce(oldAlt,newAlt,'alternativeId'))throw new Error('Alternative lineage did not advance exactly once.');
        const target=canonical.canonicalAlternatives.get(plan.sourceAlternativeId);if(!target)throw new Error('Canonical Alternative target is missing.');const currentHash=clean(target.payloadHash)||await sha256(stableStringify(payload(target)));if(currentHash!==state.before.alternativeHashes[plan.sourceAlternativeId])throw new Error('Canonical Alternative changed after READY.');
        const nextPayload=alternativePayloadFromLocal(payload(target),newAlt,state.before.cardId),nextHash=await sha256(stableStringify(nextPayload));if(nextHash===currentHash)throw new Error('Alternative payload did not change.');
        const m={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternatives',rowKey:clean(target.rowKey||payload(target).alternative_id),precondition:{payloadHash:currentHash},changedFields:[...plan.changedFields,'revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextPayload,payloadHash:nextHash};rows.push(m);Object.assign(verify,{childRowKey:m.rowKey,childHash:nextHash,mutationCount:2,tableName:'learning_alternatives'});
      }else if(plan.kind==='situation-delete'){
        const oldSit=situations(before).find(x=>clean(x.situationId)===plan.sourceSituationId),newSit=situations(after).find(x=>clean(x.situationId)===plan.sourceSituationId);if(!oldSit||!newSit||!clean(newSit.deletedAt)||!childLineageAdvancedOnce(oldSit,newSit,'situationId'))throw new Error('Situation tombstone lineage did not advance exactly once.');
        const target=canonical.canonicalSituations.get(plan.sourceSituationId);if(!target)throw new Error('Canonical Situation target is missing.');const canonicalId=clean(payload(target).situation_id||target.rowKey),refs=snap.linkRows.filter(w=>!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)&&clean(payload(w).situation_id)===canonicalId);if(refs.length)throw new Error('Situation became linked before delete staging; tombstone was blocked.');const currentHash=clean(target.payloadHash)||await sha256(stableStringify(payload(target)));if(currentHash!==state.before.situationHashes[plan.sourceSituationId])throw new Error('Canonical Situation changed after READY.');
        const nextPayload=situationPayloadFromLocal(payload(target),newSit,state.before.cardId),nextHash=await sha256(stableStringify(nextPayload)),m={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_situations',rowKey:clean(target.rowKey||canonicalId),precondition:{payloadHash:currentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history','deleted_at'],payload:nextPayload,payloadHash:nextHash};rows.push(m);Object.assign(verify,{childRowKey:m.rowKey,childHash:nextHash,mutationCount:2,tableName:'learning_situations',expectTombstone:true});
      }else if(plan.kind==='alternative-link'){
        const oldAlt=alternatives(before).find(x=>clean(x.alternativeId)===plan.sourceAlternativeId),newAlt=alternatives(after).find(x=>clean(x.alternativeId)===plan.sourceAlternativeId);if(!oldAlt||!newAlt||!childLineageAdvancedOnce(oldAlt,newAlt,'alternativeId'))throw new Error('Alternative link lineage did not advance exactly once.');
        const target=canonical.canonicalAlternatives.get(plan.sourceAlternativeId),oldSit=canonical.canonicalSituations.get(plan.oldSourceSituationId),newSit=canonical.canonicalSituations.get(plan.newSourceSituationId);if(!target||!oldSit||!newSit)throw new Error('Canonical Alternative/Situation mapping for link switch is incomplete.');const altCanonicalId=clean(payload(target).alternative_id||target.rowKey),oldSitCanonicalId=clean(payload(oldSit).situation_id||oldSit.rowKey),newSitCanonicalId=clean(payload(newSit).situation_id||newSit.rowKey),activeLinks=snap.linkRows.filter(w=>!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)&&clean(payload(w).alternative_id)===altCanonicalId),oldLink=activeLinks.find(w=>clean(payload(w).situation_id)===oldSitCanonicalId);if(!oldLink||activeLinks.length!==1)throw new Error('Alternative must still have exactly the one expected active Canonical link.');
        const currentAltHash=clean(target.payloadHash)||await sha256(stableStringify(payload(target))),oldLinkRowKey=clean(oldLink.rowKey||payload(oldLink).link_id),currentLinkHash=clean(oldLink.payloadHash)||await sha256(stableStringify(payload(oldLink)));if(currentAltHash!==state.before.alternativeHashes[plan.sourceAlternativeId]||currentLinkHash!==state.before.linkHashes[oldLinkRowKey])throw new Error('Canonical Alternative/link changed after READY.');
        const nextAltPayload=alternativePayloadFromLocal(payload(target),newAlt,state.before.cardId),nextAltHash=await sha256(stableStringify(nextAltPayload)),now=createdAt,oldLinkPayload={...clone(payload(oldLink)),link_id:oldLinkRowKey,deleted_at:now};if(Object.prototype.hasOwnProperty.call(oldLinkPayload,'updated_at'))oldLinkPayload.updated_at=now;if(Object.prototype.hasOwnProperty.call(oldLinkPayload,'updated_by_device'))oldLinkPayload.updated_by_device=clean(deviceKey)||oldLinkPayload.updated_by_device||null;
        const newLinkId=crypto.randomUUID(),newLinkPayload={...clone(payload(oldLink)),link_id:newLinkId,alternative_id:altCanonicalId,situation_id:newSitCanonicalId,deleted_at:null};if(Object.prototype.hasOwnProperty.call(newLinkPayload,'source_alternative_id'))newLinkPayload.source_alternative_id=plan.sourceAlternativeId;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'source_situation_id'))newLinkPayload.source_situation_id=plan.newSourceSituationId;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'created_at'))newLinkPayload.created_at=now;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'updated_at'))newLinkPayload.updated_at=now;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'created_by_device'))newLinkPayload.created_by_device=clean(deviceKey)||newLinkPayload.created_by_device||null;if(Object.prototype.hasOwnProperty.call(newLinkPayload,'updated_by_device'))newLinkPayload.updated_by_device=clean(deviceKey)||newLinkPayload.updated_by_device||null;
        const oldLinkNextHash=await sha256(stableStringify(oldLinkPayload)),newLinkHash=await sha256(stableStringify(newLinkPayload));
        const altMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternatives',rowKey:clean(target.rowKey||payload(target).alternative_id),precondition:{payloadHash:currentAltHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextAltPayload,payloadHash:nextAltHash},oldLinkMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternative_situations',rowKey:oldLinkRowKey,precondition:{payloadHash:currentLinkHash},changedFields:['link_id','deleted_at','updated_at','updated_by_device'],payload:oldLinkPayload,payloadHash:oldLinkNextHash},newLinkMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternative_situations',rowKey:newLinkId,precondition:{mustBeMissing:true},changedFields:['link_id','alternative_id','situation_id','created_at','updated_at','created_by_device','updated_by_device','deleted_at'],payload:newLinkPayload,payloadHash:newLinkHash};rows.push(altMutation,oldLinkMutation,newLinkMutation);Object.assign(verify,{childRowKey:altMutation.rowKey,childHash:nextAltHash,oldLinkRowKey,oldLinkHash:oldLinkNextHash,newLinkRowKey:newLinkId,newLinkHash,mutationCount:4,tableName:'learning_alternative_situations'});
      }else throw new Error(`Unsupported staged plan ${plan.kind}.`);

      for(const m of rows)m.mutationHash=await sha256(stableStringify(m));await addOutboxRows(db,rows);state.active={...verify,actionId,cursorBefore:cursorValue(snap.meta,snap.cursor)};state.ready=false;
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-child-structure-production',tableName:verify.tableName,mutationKind:'upsert',actionId,mutationCount:rows.length,companionTable:'card_learning_metadata'}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_RESIDUAL_PRODUCTION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:targetWid(),blockingIssues:1,pass:false}};show(`CHECK · ${String(e?.message||e)}`,false,'The local child save already occurred, but no unsafe Canonical write was staged. Stop editing and reconcile before another Learning Metadata Save.',true);}
    finally{state.busy=false;try{db?.close();}catch(_){} }
  }

  async function verifyForeground(detail){
    if(!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The production child action remains pending for retry. Do not make another Learning Metadata edit.',true);return;}
    let db=null;try{db=await openDb();const snap=await readSnapshot(db),cursorAfter=cursorValue(snap.meta,snap.cursor),parent=snap.metadataRows.find(w=>clean(w.rowKey||payload(w).card_id)===state.active.parentRowKey),child=[...snap.situationRows,...snap.alternativeRows].find(w=>clean(w.rowKey||payload(w).situation_id||payload(w).alternative_id)===state.active.childRowKey),parentOk=clean(parent?.payloadHash)===state.active.parentHash,childOk=clean(child?.payloadHash)===state.active.childHash&&(!state.active.expectTombstone||Boolean(child?.tombstone)),outboxOk=snap.outbox.length===0;let linksOk=true;if(state.active.oldLinkRowKey){const old=snap.linkRows.find(w=>clean(w.rowKey||payload(w).link_id)===state.active.oldLinkRowKey),fresh=snap.linkRows.find(w=>clean(w.rowKey||payload(w).link_id)===state.active.newLinkRowKey);linksOk=clean(old?.payloadHash)===state.active.oldLinkHash&&Boolean(old?.tombstone)&&clean(fresh?.payloadHash)===state.active.newLinkHash&&!Boolean(fresh?.tombstone);}const pass=outboxOk&&parentOk&&childOk&&linksOk&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_RESIDUAL_PRODUCTION_AUDIT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:targetWid(),cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:snap.outbox.length,shape:state.active.kind,blockingIssues:pass?0:1,pass},invariants:{productionDefault:true,parentPayloadMatch:parentOk,childPayloadMatch:childOk,linkPayloadsMatch:linksOk}};show(pass?`PASS · Production child ${state.active.kind} reached Canonical.`:'CHECK · Production child transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${snap.outbox.length}\nparent ${parentOk?'yes':'no'} · child ${childOk?'yes':'no'} · links ${linksOk?'yes':'no'}`,!pass);state.active=null;if(pass)setTimeout(()=>{void prepare();void window.WLPCanonicalLearningMetadataParentWrite?.prepare?.();void window.WLPCanonicalLearningMetadataSituationWrite?.prepare?.();},0);
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){} }
  }

  document.addEventListener('submit',onSubmitCapture,true);
  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataChildStructureWrite=Object.freeze({version:1,prepare,getReport:()=>clone(state.report),classifyFormChange,ownsPendingSave:()=>Boolean(state.pendingPlan&&['alternative-content','alternative-link','situation-delete'].includes(state.pendingPlan.kind)),productionDefault:true,diagnosticFlag:DIAG_FLAG,rollbackFlag:ROLLBACK_FLAG});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
