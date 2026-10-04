/* WLP v1.8.6.334 — Learning Metadata incoming-newer receiver materialization canary.
   Query only: ?wlpLearningMetadataReceiverMaterialize=1
   Targeted real-device proof for WID5578 after the v333 PC parent-field edit.
   Safety gate requires exactly one incoming-newer record (wid:5578), a one-step
   parent lineage advance, senseHook-only semantic change, and byte-stable children.
   Applies Canonical -> local Learning Metadata only. No IndexedDB/outbox/Cloud writes. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.334-learning-metadata-incoming-newer-receiver-materialize-canary-v1';
  const FLAG = 'wlpLearningMetadataReceiverMaterialize';
  const TARGET_KEY = 'wid:5578';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const STORES = ['cards','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','sync_meta'];
  const META_KEY = 'authority_mirror';
  const CURSOR_KEY = 'cloud_shadow_steady_sync_v1';
  const ROLLBACK_KEY = 'wlp:learning-meta:canonical-receiver-materialize-rollback:v1';
  const BASE = Object.freeze({
    candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion:3,
    manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  });
  const state = { panel:null,status:null,detail:null,applyButton:null,rollbackButton:null,plan:null,canonical:null,beforeRaw:null,priorMergeRollbackRaw:null,cursor:0 };

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
    panel.id='wlp-learning-metadata-receiver-materialize-canary';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100012;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    panel.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · incoming-newer receiver materialization canary</strong><div id="wlp-learning-metadata-receiver-materialize-status" style="margin-top:4px">Checking Canonical → local safety gate…</div><div id="wlp-learning-metadata-receiver-materialize-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button id="wlp-learning-metadata-receiver-materialize-apply" type="button" disabled>Apply Canonical WID5578 revision locally</button><button id="wlp-learning-metadata-receiver-materialize-rollback" type="button" hidden>Rollback this receiver materialization</button></div>';
    document.body.appendChild(panel);
    const apply=panel.querySelector('#wlp-learning-metadata-receiver-materialize-apply'),rollback=panel.querySelector('#wlp-learning-metadata-receiver-materialize-rollback');
    [apply,rollback].forEach(button=>button.style.cssText='font:inherit;padding:6px 9px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22');
    apply.addEventListener('click',applyMaterialization);rollback.addEventListener('click',rollbackMaterialization);
    state.panel=panel;state.status=panel.querySelector('#wlp-learning-metadata-receiver-materialize-status');state.detail=panel.querySelector('#wlp-learning-metadata-receiver-materialize-detail');state.applyButton=apply;state.rollbackButton=rollback;
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

  async function prepare(){
    if(!active())return;makePanel();
    try{
      const api=window.WLPLearningHooks;if(!api?.comparePortableSnapshot||!api?.applyPortableMerge||!api?.allRecords||!api?.STORAGE_KEY)throw new Error('Learning Metadata v2 merge engine is unavailable.');
      const db=await openDb();
      const [meta,cursorMeta,cards,metadata,situations,alternatives,links]=await Promise.all([getRow(db,'sync_meta',META_KEY),getRow(db,'sync_meta',CURSOR_KEY),getAll(db,'cards'),getAll(db,'card_learning_metadata'),getAll(db,'learning_situations'),getAll(db,'learning_alternatives'),getAll(db,'learning_alternative_situations')]);
      if(clean(meta?.candidateKey)!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||clean(meta?.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Receiver materialization requires ACTIVE Authority v3.');
      const canonical=buildCanonicalPortable(cards,metadata,situations,alternatives,links),before=currentRecords(),beforeKeys=Object.keys(before).sort(),canonicalKeys=Object.keys(canonical.records).sort(),localOnly=beforeKeys.filter(key=>!canonical.records[key]);
      const plan=api.comparePortableSnapshot(canonical),items=Array.isArray(plan.items)?plan.items:[],counts=plan.counts||{},incomingNewer=items.filter(item=>item.kind==='incoming-newer'),same=items.filter(item=>item.kind==='same'),target=incomingNewer[0]||null;
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      db.close();
      const targetLocal=target?.local||null,targetIncoming=target?.incoming||null,changedFields=target?changedParentFields(targetLocal,targetIncoming):[];
      const childExact=Boolean(target)&&stableStringify(childShape(targetLocal))===stableStringify(childShape(targetIncoming));
      const oneStep=Boolean(target)&&clean(targetLocal?.metadataId)===clean(targetIncoming?.metadataId)&&Number(targetIncoming?.revision||0)===Number(targetLocal?.revision||0)+1&&clean(targetIncoming?.parentVersionId)===clean(targetLocal?.versionId);
      const safe=beforeKeys.length===canonicalKeys.length&&localOnly.length===0&&Number(counts.new||0)===0&&Number(counts.localNewer||0)===0&&Number(counts.conflict||0)===0&&incomingNewer.length===1&&same.length===canonicalKeys.length-1&&target?.incomingKey===TARGET_KEY&&target?.localKey===TARGET_KEY&&oneStep&&childExact&&changedFields.length===1&&changedFields[0]==='senseHook';
      state.plan=plan;state.canonical=canonical;state.beforeRaw=localStorage.getItem(api.STORAGE_KEY);state.priorMergeRollbackRaw=api.MERGE_ROLLBACK_KEY?localStorage.getItem(api.MERGE_ROLLBACK_KEY):null;state.cursor=cursor;
      const detail=`local ${beforeKeys.length} / Canonical ${canonicalKeys.length} · same ${same.length} · incoming-newer ${incomingNewer.length}\nnew ${counts.new||0} · local-newer ${counts.localNewer||0} · conflicts ${counts.conflict||0} · local-only ${localOnly.length}\ntarget ${target?.incomingKey||'none'} · changed parent fields ${changedFields.join(', ')||'none'}\none-step lineage ${oneStep?'yes':'no'} · children exact ${childExact?'yes':'no'} · cursor ${cursor}\nno data changed yet`;
      if(!safe){show('BLOCKED · Receiver materialization safety gate did not match the expected WID5578 revision.',false,detail);state.applyButton.disabled=true;return;}
      show('READY · Canonical WID5578 is one safe revision ahead of local.',null,detail);state.applyButton.disabled=false;
    }catch(error){show(`BLOCKED · ${error?.message||String(error)}`,false,'No Learning Metadata was changed.');if(state.applyButton)state.applyButton.disabled=true;}
  }

  async function applyMaterialization(){
    const api=window.WLPLearningHooks;if(!state.plan||!state.canonical||!api?.applyPortableMerge)return;
    state.applyButton.disabled=true;show('APPLYING · Materializing the Canonical WID5578 revision locally…',null,'Canonical/IndexedDB/Cloud data will not be changed.');
    try{
      const before=currentRecords(),beforeSignatures={};Object.entries(before).forEach(([key,value])=>{beforeSignatures[key]=stableStringify(value);});
      const result=api.applyPortableMerge(state.plan,{});restorePriorMergeRollback(api);
      const after=currentRecords(),changedKeys=Object.keys(beforeSignatures).filter(key=>!after[key]||stableStringify(after[key])!==beforeSignatures[key]);
      const addedKeys=Object.keys(after).filter(key=>!before[key]);
      const verify=verifyAgainstCanonical(state.canonical);
      if(Number(result?.changed||0)!==1||Number(result?.updated||0)!==1||Number(result?.added||0)!==0||Number(result?.conflictIncoming||0)!==0||changedKeys.length!==1||changedKeys[0]!==TARGET_KEY||addedKeys.length||!verify.exact){
        if(state.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,state.beforeRaw);
        restorePriorMergeRollback(api);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
        throw new Error(`Post-write verification failed; local Learning Metadata was restored. changed=${changedKeys.join(',')||'none'} semanticMismatch=${verify.semanticMismatch.join(',')||'none'} lineageMismatch=${verify.lineageMismatch.join(',')||'none'}`);
      }
      localStorage.setItem(ROLLBACK_KEY,JSON.stringify({savedAt:new Date().toISOString(),appVersion:APP_VERSION,beforeRaw:state.beforeRaw,targetKey:TARGET_KEY,cursor:state.cursor},null,2));
      show('PASS · Canonical WID5578 revision was safely materialized on this device.',true,`changed locally ${TARGET_KEY} only · incoming-newer applied 1\nafter local ${verify.localKeys.length} / Canonical ${verify.canonicalKeys.length} · semantic exact ${verify.canonicalKeys.length}/${verify.canonicalKeys.length} · lineage exact ${verify.canonicalKeys.length}/${verify.canonicalKeys.length}\nIndexedDB 0 writes · outbox 0 writes · Cloud 0 writes · cursor ${state.cursor}`);
      state.rollbackButton.hidden=false;
    }catch(error){show(`BLOCKED · ${error?.message||String(error)}`,false,'No partial receiver materialization is being kept.');state.applyButton.disabled=true;}
  }

  function rollbackMaterialization(){
    const api=window.WLPLearningHooks;if(!api?.STORAGE_KEY)return;
    try{
      const saved=JSON.parse(localStorage.getItem(ROLLBACK_KEY)||'null');if(!saved||saved.targetKey!==TARGET_KEY||!Object.prototype.hasOwnProperty.call(saved,'beforeRaw'))throw new Error('No v334 receiver materialization rollback is available.');
      if(saved.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,saved.beforeRaw);
      localStorage.removeItem(ROLLBACK_KEY);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));
      show('ROLLED BACK · v334 receiver materialization was reverted.',null,'WID5578 local Learning Metadata was restored to the pre-v334 state.');state.rollbackButton.hidden=true;
    }catch(error){show(`ROLLBACK BLOCKED · ${error?.message||String(error)}`,false,'No additional change was made.');}
  }

  if(active()){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(prepare,0),{once:true});else setTimeout(prepare,0);}
})();
