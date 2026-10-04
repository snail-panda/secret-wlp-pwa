/* WLP v1.8.6.329 — Learning Metadata stable-signature insert-only materialization.
   Query only: ?wlpLearningMetadataMaterialize=1
   Materializes only Canonical records missing locally. Existing local records are never overwritten or deleted.
   No IndexedDB, outbox, or Cloud writes are performed. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.329-learning-metadata-stable-signature-insert-only-v1';
  const FLAG = 'wlpLearningMetadataMaterialize';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const STORES = ['cards','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','sync_meta'];
  const META_KEY = 'authority_mirror';
  const CURSOR_KEY = 'cloud_shadow_steady_sync_v1';
  const ROLLBACK_KEY = 'wlp:learning-meta:canonical-materialize-rollback:v1';
  const BASE = Object.freeze({
    candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion:3,
    manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  });
  const state = { panel:null,status:null,detail:null,applyButton:null,rollbackButton:null,report:null,plan:null,canonical:null,beforeRaw:null,priorMergeRollbackRaw:null };

  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify = value => JSON.stringify(stableValue(value));
  const requestPromise = req => new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.'));});
  const transactionDone = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});
  const payload = wrapper => wrapper&&typeof wrapper==='object'&&wrapper.payload&&typeof wrapper.payload==='object'?wrapper.payload:{};
  const active = () => new URLSearchParams(location.search).get(FLAG)==='1';

  function makePanel(){
    if(state.panel||!active())return;
    const panel=document.createElement('section');
    panel.id='wlp-learning-metadata-materialize';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100010;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    panel.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Canonical insert-only materialization</strong><div id="wlp-learning-metadata-materialize-status" style="margin-top:4px">Checking safe insert-only plan…</div><div id="wlp-learning-metadata-materialize-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button id="wlp-learning-metadata-materialize-apply" type="button" disabled>Apply insert-only materialization</button><button id="wlp-learning-metadata-materialize-rollback" type="button" hidden>Rollback this materialization</button></div>';
    document.body.appendChild(panel);
    const apply=panel.querySelector('#wlp-learning-metadata-materialize-apply'),rollback=panel.querySelector('#wlp-learning-metadata-materialize-rollback');
    [apply,rollback].forEach(button=>button.style.cssText='font:inherit;padding:6px 9px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22');
    apply.addEventListener('click',applyMaterialization);rollback.addEventListener('click',rollbackMaterialization);
    state.panel=panel;state.status=panel.querySelector('#wlp-learning-metadata-materialize-status');state.detail=panel.querySelector('#wlp-learning-metadata-materialize-detail');state.applyButton=apply;state.rollbackButton=rollback;
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
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

  function semanticShape(r){const c=r?.content||{};return{deletedAt:clean(r?.deletedAt),entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),situations:(Array.isArray(c.situations)?c.situations:[]).map(s=>({situationId:clean(s.situationId),deletedAt:clean(s.deletedAt),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicativeNeed)})).sort((a,b)=>a.situationId.localeCompare(b.situationId)),alternatives:(Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]).map(a=>({alternativeId:clean(a.alternativeId),deletedAt:clean(a.deletedAt),expression:clean(a.expression),note:clean(a.note),situationIds:(Array.isArray(a.situationIds)?a.situationIds:[]).map(clean).filter(Boolean).sort()})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId))};}
  function lineageShape(r){const c=r?.content||{};return{metadataId:clean(r?.metadataId),status:clean(r?.status)||'provisional',revision:Math.max(1,Number(r?.revision)||1),versionId:clean(r?.versionId),parentVersionId:clean(r?.parentVersionId),situations:(Array.isArray(c.situations)?c.situations:[]).map(s=>({situationId:clean(s.situationId),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.versionId),parentVersionId:clean(s.parentVersionId)})).sort((a,b)=>a.situationId.localeCompare(b.situationId)),alternatives:(Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]).map(a=>({alternativeId:clean(a.alternativeId),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.versionId),parentVersionId:clean(a.parentVersionId)})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId))};}

  function currentRecords(){return window.WLPLearningHooks?.allRecords?.({includeDeleted:true})||{};}
  function verifyAgainstCanonical(canonical){
    const local=currentRecords(),localKeys=Object.keys(local).sort(),canonicalKeys=Object.keys(canonical.records).sort(),semanticMismatch=[],lineageMismatch=[];
    canonicalKeys.forEach(key=>{if(!local[key]||stableStringify(semanticShape(local[key]))!==stableStringify(semanticShape(canonical.records[key])))semanticMismatch.push(key);if(!local[key]||stableStringify(lineageShape(local[key]))!==stableStringify(lineageShape(canonical.records[key])))lineageMismatch.push(key);});
    const localOnly=localKeys.filter(key=>!canonical.records[key]);
    return{local,localKeys,canonicalKeys,semanticMismatch,lineageMismatch,localOnly,exact:localKeys.length===canonicalKeys.length&&localOnly.length===0&&semanticMismatch.length===0&&lineageMismatch.length===0};
  }

  async function prepare(){
    if(!active())return;makePanel();
    try{
      const api=window.WLPLearningHooks;if(!api?.comparePortableSnapshot||!api?.applyPortableMerge||!api?.allRecords||!api?.STORAGE_KEY)throw new Error('Learning Metadata v2 merge engine is unavailable.');
      const db=await openDb();
      const [meta,cursorMeta,cards,metadata,situations,alternatives,links]=await Promise.all([getRow(db,'sync_meta',META_KEY),getRow(db,'sync_meta',CURSOR_KEY),getAll(db,'cards'),getAll(db,'card_learning_metadata'),getAll(db,'learning_situations'),getAll(db,'learning_alternatives'),getAll(db,'learning_alternative_situations')]);
      if(clean(meta?.candidateKey)!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||clean(meta?.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Materialization requires ACTIVE Authority v3.');
      const canonical=buildCanonicalPortable(cards,metadata,situations,alternatives,links),before=currentRecords(),beforeKeys=Object.keys(before).sort(),canonicalKeys=Object.keys(canonical.records).sort(),localOnly=beforeKeys.filter(key=>!canonical.records[key]);
      const plan=api.comparePortableSnapshot(canonical),counts=plan.counts||{},newItems=(plan.items||[]).filter(item=>item.kind==='new'),sameItems=(plan.items||[]).filter(item=>item.kind==='same'),conflictItems=(plan.items||[]).filter(item=>item.kind==='conflict');
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      const conflictDetails=conflictItems.map(item=>{
        const local=item.local||{},incoming=item.incoming||{},localContent=local.content&&typeof local.content==='object'?local.content:{},incomingContent=incoming.content&&typeof incoming.content==='object'?incoming.content:{};
        const localKeys=Object.keys(localContent).sort(),incomingKeys=Object.keys(incomingContent).sort();
        return{incomingKey:item.incomingKey,localKey:item.localKey,reason:item.reason,collision:Boolean(item.collision),metadataIdLocal:clean(local.metadataId),metadataIdCanonical:clean(incoming.metadataId),versionIdLocal:clean(local.versionId),versionIdCanonical:clean(incoming.versionId),parentVersionIdLocal:clean(local.parentVersionId),parentVersionIdCanonical:clean(incoming.parentVersionId),revisionLocal:Number(local.revision||0),revisionCanonical:Number(incoming.revision||0),knownSemanticExact:stableStringify(semanticShape(local))===stableStringify(semanticShape(incoming)),knownLineageExact:stableStringify(lineageShape(local))===stableStringify(lineageShape(incoming)),fullContentExact:stableStringify(localContent)===stableStringify(incomingContent),localOnlyContentKeys:localKeys.filter(key=>!incomingKeys.includes(key)),canonicalOnlyContentKeys:incomingKeys.filter(key=>!localKeys.includes(key))};
      });
      const safe=localOnly.length===0&&Number(counts.new||0)>0&&Number(counts.incomingNewer||0)===0&&Number(counts.localNewer||0)===0&&Number(counts.conflict||0)===0&&Number(counts.same||0)+Number(counts.new||0)===canonicalKeys.length&&beforeKeys.length+Number(counts.new||0)===canonicalKeys.length;
      state.plan=plan;state.canonical=canonical;state.beforeRaw=localStorage.getItem(api.STORAGE_KEY);state.priorMergeRollbackRaw=api.MERGE_ROLLBACK_KEY?localStorage.getItem(api.MERGE_ROLLBACK_KEY):null;
      state.report={format:'WLP_LEARNING_METADATA_CANONICAL_INSERT_ONLY_MATERIALIZATION',version:2,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:safe?'ready':'blocked-detail',authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,materializedSyncCursor:cursor},before:{localRecords:beforeKeys.length,canonicalRecords:canonicalKeys.length,localOnly},plan:{insertKeys:newItems.map(item=>item.incomingKey),insertCount:newItems.length,sameCount:sameItems.length,incomingNewer:Number(counts.incomingNewer||0),localNewer:Number(counts.localNewer||0),conflicts:Number(counts.conflict||0),conflictDetails,overwrites:0,deletes:0},invariants:{insertOnly:safe,noExistingLocalOverwrite:true,noDeletes:true,noIndexedDbWrites:true,noOutboxWrites:true,noCloudWrites:true}};
      db.close();
      const baseDetail=`before local ${beforeKeys.length} / Canonical ${canonicalKeys.length} · same ${sameItems.length}
ready inserts ${newItems.length}: ${newItems.map(item=>item.incomingKey).join(', ')||'none'} · overwrites 0 · deletes 0
incoming-newer ${counts.incomingNewer||0} · local-newer ${counts.localNewer||0} · conflicts ${counts.conflict||0} · local-only ${localOnly.length}
cursor ${cursor} · no data changed`;
      const conflictText=conflictDetails.map(c=>`conflict ${c.incomingKey} · reason: ${c.reason}
metadataId local/canonical ${c.metadataIdLocal||'—'} / ${c.metadataIdCanonical||'—'}
versionId local/canonical ${c.versionIdLocal||'—'} / ${c.versionIdCanonical||'—'} · revision ${c.revisionLocal}/${c.revisionCanonical}
known semantic exact ${c.knownSemanticExact?'yes':'no'} · known lineage exact ${c.knownLineageExact?'yes':'no'} · full content exact ${c.fullContentExact?'yes':'no'}
local-only content keys ${c.localOnlyContentKeys.join(', ')||'none'} · Canonical-only content keys ${c.canonicalOnlyContentKeys.join(', ')||'none'}`).join('\n');
      const detail=conflictText?`${baseDetail}
${conflictText}`:baseDetail;
      if(!safe){show('BLOCKED · Insert-only safety gate found a shared-record conflict.',false,detail);state.applyButton.disabled=true;return;}
      show('READY · Safe insert-only materialization is available.',null,detail);state.applyButton.disabled=false;
    }catch(error){state.report={format:'WLP_LEARNING_METADATA_CANONICAL_INSERT_ONLY_MATERIALIZATION',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',issues:{blocking:[error?.message||String(error)]}};show(`BLOCKED · ${error?.message||String(error)}`,false,'No Learning Metadata was changed.');if(state.applyButton)state.applyButton.disabled=true;}
  }

  function restorePriorMergeRollback(api){if(!api?.MERGE_ROLLBACK_KEY)return;if(state.priorMergeRollbackRaw===null)localStorage.removeItem(api.MERGE_ROLLBACK_KEY);else localStorage.setItem(api.MERGE_ROLLBACK_KEY,state.priorMergeRollbackRaw);}

  async function applyMaterialization(){
    const api=window.WLPLearningHooks;if(!state.plan||!state.canonical||!api?.applyPortableMerge)return;
    state.applyButton.disabled=true;show('APPLYING · Inserting Canonical-only Learning Metadata…',null,'Existing local records will not be overwritten or deleted.');
    try{
      const before=currentRecords(),beforeSignatures={};Object.entries(before).forEach(([key,value])=>{beforeSignatures[key]=stableStringify(value);});
      const result=api.applyPortableMerge(state.plan,{});restorePriorMergeRollback(api);
      const after=currentRecords(),changedExisting=Object.keys(beforeSignatures).filter(key=>!after[key]||stableStringify(after[key])!==beforeSignatures[key]);
      const verify=verifyAgainstCanonical(state.canonical),insertKeys=(state.report?.plan?.insertKeys||[]),inserted=insertKeys.filter(key=>after[key]&&!before[key]);
      if(Number(result?.updated||0)!==0||Number(result?.conflictIncoming||0)!==0||changedExisting.length||inserted.length!==insertKeys.length||!verify.exact){
        if(state.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,state.beforeRaw);
        restorePriorMergeRollback(api);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
        throw new Error(`Post-write verification failed; local Learning Metadata was restored. changedExisting=${changedExisting.join(',')||'none'} semanticMismatch=${verify.semanticMismatch.join(',')||'none'} lineageMismatch=${verify.lineageMismatch.join(',')||'none'}`);
      }
      localStorage.setItem(ROLLBACK_KEY,JSON.stringify({savedAt:new Date().toISOString(),appVersion:APP_VERSION,beforeRaw:state.beforeRaw,insertKeys,afterCount:verify.localKeys.length},null,2));
      state.report={...state.report,generatedAt:new Date().toISOString(),phase:'pass',result:{changed:Number(result?.changed||0),added:Number(result?.added||0),updated:Number(result?.updated||0),insertedKeys:inserted,changedExistingKeys:changedExisting},after:{localRecords:verify.localKeys.length,canonicalRecords:verify.canonicalKeys.length,semanticExact:verify.canonicalKeys.length-verify.semanticMismatch.length,lineageExact:verify.canonicalKeys.length-verify.lineageMismatch.length,localOnly:verify.localOnly,semanticMismatch:verify.semanticMismatch,lineageMismatch:verify.lineageMismatch,exact:verify.exact},invariants:{...state.report.invariants,existingLocalRecordsByteStable:true,rollbackAvailable:true}};
      show(`PASS · Inserted ${inserted.length} Canonical-only Learning Metadata record${inserted.length===1?'':'s'}.`,true,`inserted ${inserted.join(', ')} · existing local records unchanged yes\nafter local ${verify.localKeys.length} / Canonical ${verify.canonicalKeys.length} · semantic exact ${verify.canonicalKeys.length}/${verify.canonicalKeys.length} · lineage exact ${verify.canonicalKeys.length}/${verify.canonicalKeys.length}\nIndexedDB 0 writes · outbox 0 writes · Cloud 0 writes`);
      state.rollbackButton.hidden=false;
    }catch(error){show(`BLOCKED · ${error?.message||String(error)}`,false,'No partial materialization is being kept.');state.applyButton.disabled=true;}
  }

  function rollbackMaterialization(){
    const api=window.WLPLearningHooks;if(!api?.STORAGE_KEY)return;
    try{
      const saved=JSON.parse(localStorage.getItem(ROLLBACK_KEY)||'null');if(!saved||!Object.prototype.hasOwnProperty.call(saved,'beforeRaw'))throw new Error('No v329 materialization rollback is available.');
      if(saved.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,saved.beforeRaw);
      localStorage.removeItem(ROLLBACK_KEY);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
      const count=Object.keys(currentRecords()).length;show('ROLLED BACK · v329 materialization was reverted.',null,`local Learning Metadata restored to ${count} records.`);state.rollbackButton.hidden=true;
    }catch(error){show(`ROLLBACK BLOCKED · ${error?.message||String(error)}`,false,'No additional change was made.');}
  }

  if(active()){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(prepare,0),{once:true});else setTimeout(prepare,0);}
})();
