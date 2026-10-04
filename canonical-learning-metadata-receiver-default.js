/* WLP v1.8.6.336 — Learning Metadata production-default Canonical receiver.
   Production default on Manage Learning Metadata: safely materializes Canonical-only
   parent-only records and Canonical descendant parent revisions into local Learning
   Metadata v2 when there are no local-only/local-newer/conflict records.
   Child Situation/Alternative differences are intentionally NOT auto-materialized yet.
   Diagnostic panel: ?wlpLearningMetadataReceiverAudit=1
   Emergency rollback-to-legacy behavior: ?wlpLegacyLearningMetadataReceiver=1
   Local materialization only: no IndexedDB/outbox/Cloud writes. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.336-learning-metadata-production-default-receiver-v1';
  const DIAG_FLAG='wlpLearningMetadataReceiverAudit';
  const LEGACY_FLAG='wlpLegacyLearningMetadataReceiver';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const STORES=['cards','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','sync_meta'];
  const META_KEY='authority_mirror';
  const CURSOR_KEY='cloud_shadow_steady_sync_v1';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const ALLOWED_PARENT_FIELDS=new Set(['entryType','senseHook','memoryHook']);
  const state={panel:null,status:null,detail:null,running:false,rerun:false,report:null,priorMergeRollbackRaw:null};

  const clean=value=>String(value??'').replace(/\r\n?/g,'\n').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify=value=>JSON.stringify(stableValue(value));
  const requestPromise=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.'));});
  const transactionDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  const payload=wrapper=>wrapper&&typeof wrapper==='object'&&wrapper.payload&&typeof wrapper.payload==='object'?wrapper.payload:{};
  const params=()=>new URLSearchParams(location.search);
  const diagnostics=()=>params().get(DIAG_FLAG)==='1';
  const legacy=()=>params().get(LEGACY_FLAG)==='1';

  function makePanel(){
    if(state.panel||!diagnostics())return;
    const panel=document.createElement('section');panel.id='wlp-learning-metadata-production-receiver-audit';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100012;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    panel.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · production-default Canonical receiver audit</strong><div id="wlp-learning-metadata-production-receiver-status" style="margin-top:4px">Checking Canonical → local state…</div><div id="wlp-learning-metadata-production-receiver-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-learning-metadata-production-receiver-status');state.detail=panel.querySelector('#wlp-learning-metadata-production-receiver-detail');
  }
  function show(text,ok=null,detail=''){if(!diagnostics())return;makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;try{req.transaction.abort();}catch(_){}};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=STORES.filter(name=>!db.objectStoreNames.contains(name));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),rows=await requestPromise(tx.objectStore(store).getAll());await transactionDone(tx);return Array.isArray(rows)?rows:[];}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),row=await requestPromise(tx.objectStore(store).get(key));await transactionDone(tx);return row||null;}
  function buildCanonicalPortable(cards,metadataRows,situationRows,alternativeRows,linkRows){
    const cardKeyById=new Map(cards.map(w=>{const p=payload(w);return[clean(p.card_id),clean(p.legacy_key)];}).filter(([id,key])=>id&&key));
    const situationsByCard=new Map(),alternativesByCard=new Map(),sourceSituationByCanonical=new Map(),linksByAlternative=new Map();
    situationRows.forEach(w=>{const p=payload(w),cardId=clean(p.card_id);if(!cardId)return;if(!situationsByCard.has(cardId))situationsByCard.set(cardId,[]);situationsByCard.get(cardId).push(p);if(clean(p.situation_id))sourceSituationByCanonical.set(clean(p.situation_id),clean(p.source_situation_id));});
    alternativeRows.forEach(w=>{const p=payload(w),cardId=clean(p.card_id);if(!cardId)return;if(!alternativesByCard.has(cardId))alternativesByCard.set(cardId,[]);alternativesByCard.get(cardId).push(p);});
    linkRows.forEach(w=>{const p=payload(w),aid=clean(p.alternative_id),sid=clean(p.situation_id);if(!aid||!sid||clean(p.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const records={};
    metadataRows.forEach(w=>{
      const p=payload(w),cardId=clean(p.card_id),entryKey=cardKeyById.get(cardId)||'';if(!entryKey)return;
      const parsed=entryKey.startsWith('wid:')?{entryKind:'master',wordId:entryKey.slice(4),localDraftId:''}:entryKey.startsWith('draft:')?{entryKind:'draft',wordId:'',localDraftId:entryKey.slice(6)}:{entryKind:'local',wordId:'',localDraftId:''};
      const situations=(situationsByCard.get(cardId)||[]).slice().sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>({
        situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]
      }));
      const alternatives=(alternativesByCard.get(cardId)||[]).slice().sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({
        alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]
      }));
      records[entryKey]={metadataId:clean(p.metadata_id),entryKey,entryKind:parsed.entryKind,wordId:parsed.wordId,localDraftId:parsed.localDraftId,status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),createdAt:clean(p.created_at),updatedAt:clean(p.updated_at),createdByDevice:clean(p.created_by_device),updatedByDevice:clean(p.updated_by_device),deletedAt:clean(p.deleted_at),content:{senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),entryType:clean(p.entry_type),situations,alternativeExpressions:alternatives},history:Array.isArray(p.source_history)?clone(p.source_history):[]};
    });
    return {format:'WLP_LEARNING_METADATA_V2_ARCH',schemaVersion:2,architecture:'entry-type+situation-need+alternatives-v1',exportedAt:new Date().toISOString(),sourceDeviceId:'canonical-authority-v3',records};
  }

  function parentSemantic(record){const c=record?.content||{};return{status:clean(record?.status)||'provisional',deletedAt:clean(record?.deletedAt),entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook)};}
  function childShape(record){const c=record?.content||{};return{situations:Array.isArray(c.situations)?c.situations:[],alternativeExpressions:Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]};}
  function semanticShape(record){return{...parentSemantic(record),...childShape(record)};}
  function lineageShape(record){const c=record?.content||{};return{metadataId:clean(record?.metadataId),status:clean(record?.status)||'provisional',revision:Math.max(1,Number(record?.revision)||1),versionId:clean(record?.versionId),parentVersionId:clean(record?.parentVersionId),situations:(Array.isArray(c.situations)?c.situations:[]).map(s=>({situationId:clean(s.situationId),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.versionId),parentVersionId:clean(s.parentVersionId)})).sort((a,b)=>a.situationId.localeCompare(b.situationId)),alternatives:(Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]).map(a=>({alternativeId:clean(a.alternativeId),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.versionId),parentVersionId:clean(a.parentVersionId)})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId))};}
  function currentRecords(){return window.WLPLearningHooks?.allRecords?.({includeDeleted:true})||{};}
  function verifyAgainstCanonical(canonical){
    const local=currentRecords(),localKeys=Object.keys(local).sort(),canonicalKeys=Object.keys(canonical.records).sort(),semanticMismatch=[],lineageMismatch=[];
    canonicalKeys.forEach(key=>{if(!local[key]||stableStringify(semanticShape(local[key]))!==stableStringify(semanticShape(canonical.records[key])))semanticMismatch.push(key);if(!local[key]||stableStringify(lineageShape(local[key]))!==stableStringify(lineageShape(canonical.records[key])))lineageMismatch.push(key);});
    const localOnly=localKeys.filter(key=>!canonical.records[key]);
    return{local,localKeys,canonicalKeys,semanticMismatch,lineageMismatch,localOnly,exact:localKeys.length===canonicalKeys.length&&localOnly.length===0&&semanticMismatch.length===0&&lineageMismatch.length===0};
  }
  function changedParentFields(local,incoming){
    const a=parentSemantic(local),b=parentSemantic(incoming),fields=[];
    ['status','deletedAt','entryType','senseHook','memoryHook'].forEach(key=>{if(a[key]!==b[key])fields.push(key);});
    return fields;
  }
  function restorePriorMergeRollback(api){if(!api?.MERGE_ROLLBACK_KEY)return;if(state.priorMergeRollbackRaw===null)localStorage.removeItem(api.MERGE_ROLLBACK_KEY);else localStorage.setItem(api.MERGE_ROLLBACK_KEY,state.priorMergeRollbackRaw);}

  function safeIncomingItem(item){
    if(item?.kind!=='incoming-newer'||!item.local||!item.incoming)return false;
    if(stableStringify(childShape(item.local))!==stableStringify(childShape(item.incoming)))return false;
    const fields=changedParentFields(item.local,item.incoming);
    return fields.every(field=>ALLOWED_PARENT_FIELDS.has(field));
  }
  function safeNewItem(item){
    if(item?.kind!=='new'||!item.incoming)return false;
    const children=childShape(item.incoming);
    return (children.situations?.length||0)===0&&(children.alternativeExpressions?.length||0)===0;
  }

  async function run(trigger='page-load'){
    if(legacy()){
      state.report={format:'WLP_LEARNING_METADATA_PRODUCTION_RECEIVER',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'legacy-rollback',summary:{productionDefaultActive:false,pass:true}};
      show('ROLLBACK · Legacy Learning Metadata receiver behavior is active.',null,'Production-default Canonical → local materialization is disabled by query flag.');
      return;
    }
    if(state.running){state.rerun=true;return;}state.running=true;let db=null;
    try{
      const api=window.WLPLearningHooks;if(!api?.comparePortableSnapshot||!api?.applyPortableMerge||!api?.allRecords||!api?.STORAGE_KEY)throw new Error('Learning Metadata v2 merge engine is unavailable.');
      db=await openDb();
      const [meta,cursorMeta,cards,metadata,situations,alternatives,links]=await Promise.all([getRow(db,'sync_meta',META_KEY),getRow(db,'sync_meta',CURSOR_KEY),getAll(db,'cards'),getAll(db,'card_learning_metadata'),getAll(db,'learning_situations'),getAll(db,'learning_alternatives'),getAll(db,'learning_alternative_situations')]);
      if(clean(meta?.candidateKey)!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||clean(meta?.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Production receiver requires ACTIVE Authority v3.');
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      const canonical=buildCanonicalPortable(cards,metadata,situations,alternatives,links),before=currentRecords(),beforeKeys=Object.keys(before).sort(),canonicalKeys=Object.keys(canonical.records).sort(),localOnly=beforeKeys.filter(key=>!canonical.records[key]);
      const plan=api.comparePortableSnapshot(canonical),items=Array.isArray(plan.items)?plan.items:[],counts=plan.counts||{};
      const newItems=items.filter(item=>item.kind==='new'),incoming=items.filter(item=>item.kind==='incoming-newer'),same=items.filter(item=>item.kind==='same'),localNewer=items.filter(item=>item.kind==='local-newer'),conflicts=items.filter(item=>item.kind==='conflict');
      const unsafeIncoming=incoming.filter(item=>!safeIncomingItem(item)),unsafeNew=newItems.filter(item=>!safeNewItem(item));
      const safe=localOnly.length===0&&localNewer.length===0&&conflicts.length===0&&unsafeIncoming.length===0&&unsafeNew.length===0;
      const changeCount=newItems.length+incoming.length;
      const detail=`local ${beforeKeys.length} / Canonical ${canonicalKeys.length} · same ${same.length}\nnew ${newItems.length} · incoming-newer ${incoming.length} · local-newer ${localNewer.length} · conflicts ${conflicts.length} · local-only ${localOnly.length}\nunsafe incoming ${unsafeIncoming.length} · unsafe new ${unsafeNew.length} · cursor ${cursor}\ntrigger ${trigger}`;
      if(!safe){
        state.report={format:'WLP_LEARNING_METADATA_PRODUCTION_RECEIVER',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',summary:{cursor,new:newItems.length,incomingNewer:incoming.length,localNewer:localNewer.length,conflicts:conflicts.length,localOnly:localOnly.length,unsafeIncoming:unsafeIncoming.length,unsafeNew:unsafeNew.length,blockingIssues:1,pass:false}};
        show('CHECK · Production receiver found state that requires explicit reconciliation.',false,`${detail}\nno data changed`);return;
      }
      if(changeCount===0){
        const verify=verifyAgainstCanonical(canonical),pass=verify.exact;
        state.report={format:'WLP_LEARNING_METADATA_PRODUCTION_RECEIVER',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'synced',summary:{cursor,local:beforeKeys.length,canonical:canonicalKeys.length,blockingIssues:pass?0:1,pass},invariants:{semanticAndLineageExact:pass,productionDefault:true,noCloudWrite:true}};
        show(pass?'PASS · Learning Metadata is already aligned with Canonical.':'CHECK · Canonical/local verification is not exact.',pass,`${detail}\nsemantic/lineage exact ${pass?'yes':'no'} · no data changed`);return;
      }

      const beforeRaw=localStorage.getItem(api.STORAGE_KEY),beforeSignatures={};Object.entries(before).forEach(([key,value])=>{beforeSignatures[key]=stableStringify(value);});
      state.priorMergeRollbackRaw=api.MERGE_ROLLBACK_KEY?localStorage.getItem(api.MERGE_ROLLBACK_KEY):null;
      const result=api.applyPortableMerge(plan,{});restorePriorMergeRollback(api);
      const after=currentRecords(),changedExisting=Object.keys(beforeSignatures).filter(key=>!after[key]||stableStringify(after[key])!==beforeSignatures[key]),addedKeys=Object.keys(after).filter(key=>!before[key]),verify=verifyAgainstCanonical(canonical);
      const expectedChanged=changeCount,pass=Number(result?.changed||0)===expectedChanged&&Number(result?.added||0)===newItems.length&&Number(result?.updated||0)===incoming.length&&Number(result?.conflictIncoming||0)===0&&changedExisting.length===incoming.length&&addedKeys.length===newItems.length&&verify.exact;
      if(!pass){
        if(beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,beforeRaw);restorePriorMergeRollback(api);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
        throw new Error(`Post-materialization verification failed; local Learning Metadata was restored. changed=${result?.changed??'?'} expected=${expectedChanged}.`);
      }
      state.report={format:'WLP_LEARNING_METADATA_PRODUCTION_RECEIVER',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'pass',summary:{cursor,added:newItems.length,updated:incoming.length,localAfter:verify.localKeys.length,canonicalAfter:verify.canonicalKeys.length,blockingIssues:0,pass:true},invariants:{productionDefault:true,semanticExact:true,lineageExact:true,noIndexedDbWrite:true,noOutboxWrite:true,noCloudWrite:true,childDifferencesNotAutoApplied:true}};
      show(`PASS · Production-default receiver materialized ${changeCount} Canonical Learning Metadata record${changeCount===1?'':'s'}.`,true,`added ${newItems.length} · updated ${incoming.length}\nafter local ${verify.localKeys.length} / Canonical ${verify.canonicalKeys.length} · semantic exact yes · lineage exact yes\nIndexedDB 0 writes · outbox 0 writes · Cloud 0 writes · cursor ${cursor}\ntrigger ${trigger}`);
    }catch(error){
      state.report={format:'WLP_LEARNING_METADATA_PRODUCTION_RECEIVER',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'error',error:String(error?.message||error),summary:{blockingIssues:1,pass:false}};
      show(`CHECK · ${String(error?.message||error)}`,false,'No unsafe partial materialization is being kept.');
    }finally{
      try{db?.close();}catch(_){}state.running=false;if(state.rerun){state.rerun=false;setTimeout(()=>{void run('queued-rerun');},0);}
    }
  }

  window.WLPCanonicalLearningMetadataReceiver=Object.freeze({version:1,run,getReport:()=>clone(state.report),productionDefault:true,diagnosticFlag:DIAG_FLAG,rollbackFlag:LEGACY_FLAG});
  window.addEventListener('wlp-canonical-auto-sync-complete',()=>setTimeout(()=>{void run('foreground-sync-complete');},0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{void run('page-load');},0),{once:true});else setTimeout(()=>{void run('page-load');},0);
})();
