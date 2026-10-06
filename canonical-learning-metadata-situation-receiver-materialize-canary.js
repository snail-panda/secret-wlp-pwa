/* WLP v1.8.6.345 — Query-gated Learning Metadata Situation receiver materialization canary.
   Query only: ?wlpLearningMetadataSituationReceiverMaterialize=1
   Targeted proof for WID5578 after the v343/v344 real Situation edit reached Canonical.
   Safety gate requires exactly one incoming-newer record (wid:5578), unchanged parent semantics,
   exactly one existing Situation child advancing one lineage step, title-only semantic change from
   "Emotional overload" to "Emotional overload test", all other children exact, and no local-only /
   local-newer / conflict records. Applies Canonical -> local Learning Metadata only.
   No IndexedDB, outbox, Cloud, SQL, Service Worker, or Bottom Nav writes. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.345-learning-metadata-situation-receiver-materialize-canary-v1';
  const FLAG='wlpLearningMetadataSituationReceiverMaterialize';
  const TARGET_KEY='wid:5578';
  const EXPECTED_OLD_TITLE='Emotional overload';
  const EXPECTED_NEW_TITLE='Emotional overload test';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const STORES=['cards','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','sync_meta'];
  const META_KEY='authority_mirror',CURSOR_KEY='cloud_shadow_steady_sync_v1';
  const ROLLBACK_KEY='wlp:learning-meta:situation-receiver-materialize-rollback:v1';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,applyButton:null,rollbackButton:null,plan:null,canonical:null,beforeRaw:null,priorMergeRollbackRaw:null,cursor:0,targetSituationId:'',report:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const payload=w=>w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};
  const active=()=>new URLSearchParams(location.search).get(FLAG)==='1';

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-situation-receiver-materialize-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100016;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(820px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation receiver materialization canary</strong><div data-status style="margin-top:4px">Checking Canonical → local Situation safety gate…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button data-apply type="button" disabled>Apply Canonical WID5578 Situation locally</button><button data-rollback type="button" hidden>Rollback this materialization</button></div>';
    document.body.appendChild(p);
    const apply=p.querySelector('[data-apply]'),rollback=p.querySelector('[data-rollback]');
    [apply,rollback].forEach(b=>b.style.cssText='font:inherit;padding:6px 9px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22');
    apply.addEventListener('click',applyMaterialization);rollback.addEventListener('click',rollbackMaterialization);
    state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');state.applyButton=apply;state.rollbackButton=rollback;
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=STORES.filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),rows=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(rows)?rows:[];}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),row=await req(tx.objectStore(store).get(key));await txDone(tx);return row||null;}

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
      const situations=(situationsByCard.get(cardId)||[]).slice().sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>({situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]}));
      const alternatives=(alternativesByCard.get(cardId)||[]).slice().sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]}));
      records[entryKey]={metadataId:clean(p.metadata_id),entryKey,entryKind:parsed.entryKind,wordId:parsed.wordId,localDraftId:parsed.localDraftId,status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),createdAt:clean(p.created_at),updatedAt:clean(p.updated_at),createdByDevice:clean(p.created_by_device),updatedByDevice:clean(p.updated_by_device),deletedAt:clean(p.deleted_at),content:{senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),entryType:clean(p.entry_type),situations,alternativeExpressions:alternatives},history:Array.isArray(p.source_history)?clone(p.source_history):[]};
    });
    return{format:'WLP_LEARNING_METADATA_V2_ARCH',schemaVersion:2,architecture:'entry-type+situation-need+alternatives-v1',exportedAt:new Date().toISOString(),sourceDeviceId:'canonical-authority-v3',records};
  }

  function parentSemantic(r){const c=r?.content||{};return{status:clean(r?.status)||'provisional',deletedAt:clean(r?.deletedAt),entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook)};}
  function situationSemantic(s){return{status:clean(s?.status)||'provisional',deletedAt:clean(s?.deletedAt),title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed)};}
  function situationLineage(s){return{situationId:clean(s?.situationId),status:clean(s?.status)||'provisional',revision:Math.max(1,Number(s?.revision)||1),versionId:clean(s?.versionId),parentVersionId:clean(s?.parentVersionId)};}
  function alternativesShape(r){const c=r?.content||{};return(Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]).map(a=>clone(a));}
  function situations(r){const c=r?.content||{};return Array.isArray(c.situations)?c.situations:[];}
  function semanticShape(r){return{...parentSemantic(r),situations:situations(r),alternativeExpressions:alternativesShape(r)};}
  function lineageShape(r){return{metadataId:clean(r?.metadataId),status:clean(r?.status)||'provisional',revision:Math.max(1,Number(r?.revision)||1),versionId:clean(r?.versionId),parentVersionId:clean(r?.parentVersionId),situations:situations(r).map(s=>situationLineage(s)).sort((a,b)=>a.situationId.localeCompare(b.situationId)),alternatives:alternativesShape(r).map(a=>({alternativeId:clean(a?.alternativeId),status:clean(a?.status)||'provisional',revision:Math.max(1,Number(a?.revision)||1),versionId:clean(a?.versionId),parentVersionId:clean(a?.parentVersionId)})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId))};}
  function currentRecords(){return window.WLPLearningHooks?.allRecords?.({includeDeleted:true})||{};}
  function verifyAgainstCanonical(canonical){const local=currentRecords(),localKeys=Object.keys(local).sort(),canonicalKeys=Object.keys(canonical.records).sort(),semanticMismatch=[],lineageMismatch=[];canonicalKeys.forEach(key=>{if(!local[key]||stableStringify(semanticShape(local[key]))!==stableStringify(semanticShape(canonical.records[key])))semanticMismatch.push(key);if(!local[key]||stableStringify(lineageShape(local[key]))!==stableStringify(lineageShape(canonical.records[key])))lineageMismatch.push(key);});const localOnly=localKeys.filter(key=>!canonical.records[key]);return{local,localKeys,canonicalKeys,semanticMismatch,lineageMismatch,localOnly,exact:localKeys.length===canonicalKeys.length&&localOnly.length===0&&semanticMismatch.length===0&&lineageMismatch.length===0};}
  function changedSituationFields(a,b){const x=situationSemantic(a),y=situationSemantic(b),out=[];['status','deletedAt','title','anchor','communicativeNeed'].forEach(k=>{if(x[k]!==y[k])out.push(k);});return out;}
  function oneStepParent(local,incoming){return clean(local?.metadataId)===clean(incoming?.metadataId)&&Number(incoming?.revision||0)===Number(local?.revision||0)+1&&clean(incoming?.parentVersionId)===clean(local?.versionId)&&clean(incoming?.versionId)&&clean(incoming?.versionId)!==clean(local?.versionId);}
  function oneStepSituation(local,incoming){return clean(local?.situationId)===clean(incoming?.situationId)&&Number(incoming?.revision||0)===Number(local?.revision||0)+1&&clean(incoming?.parentVersionId)===clean(local?.versionId)&&clean(incoming?.versionId)&&clean(incoming?.versionId)!==clean(local?.versionId);}
  function restorePriorMergeRollback(api){if(!api?.MERGE_ROLLBACK_KEY)return;if(state.priorMergeRollbackRaw===null)localStorage.removeItem(api.MERGE_ROLLBACK_KEY);else localStorage.setItem(api.MERGE_ROLLBACK_KEY,state.priorMergeRollbackRaw);}

  async function prepare(){
    if(!active())return;makePanel();let db=null;
    try{
      const api=window.WLPLearningHooks;if(!api?.comparePortableSnapshot||!api?.applyPortableMerge||!api?.allRecords||!api?.STORAGE_KEY)throw new Error('Learning Metadata v2 merge engine is unavailable.');
      db=await openDb();
      const [meta,cursorMeta,cards,metadata,situationRows,alternatives,links]=await Promise.all([getRow(db,'sync_meta',META_KEY),getRow(db,'sync_meta',CURSOR_KEY),getAll(db,'cards'),getAll(db,'card_learning_metadata'),getAll(db,'learning_situations'),getAll(db,'learning_alternatives'),getAll(db,'learning_alternative_situations')]);
      if(clean(meta?.candidateKey)!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||clean(meta?.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation receiver materialization requires ACTIVE Authority v3.');
      const canonical=buildCanonicalPortable(cards,metadata,situationRows,alternatives,links),before=currentRecords(),beforeKeys=Object.keys(before).sort(),canonicalKeys=Object.keys(canonical.records).sort(),localOnly=beforeKeys.filter(k=>!canonical.records[k]);
      const plan=api.comparePortableSnapshot(canonical),items=Array.isArray(plan.items)?plan.items:[],counts=plan.counts||{},incomingNewer=items.filter(i=>i.kind==='incoming-newer'),same=items.filter(i=>i.kind==='same'),target=incomingNewer.find(i=>i.incomingKey===TARGET_KEY)||null;
      const local=target?.local||null,incoming=target?.incoming||null,localSituations=situations(local),incomingSituations=situations(incoming),localById=new Map(localSituations.map(s=>[clean(s.situationId),s])),incomingById=new Map(incomingSituations.map(s=>[clean(s.situationId),s]));
      const idsLocal=[...localById.keys()].sort(),idsIncoming=[...incomingById.keys()].sort(),changedIds=idsIncoming.filter(id=>localById.has(id)&&stableStringify(localById.get(id))!==stableStringify(incomingById.get(id)));
      const changedId=changedIds[0]||'',oldSituation=localById.get(changedId)||null,newSituation=incomingById.get(changedId)||null,changedFields=oldSituation&&newSituation?changedSituationFields(oldSituation,newSituation):[];
      const parentSemanticExact=Boolean(target)&&stableStringify(parentSemantic(local))===stableStringify(parentSemantic(incoming));
      const alternativesExact=Boolean(target)&&stableStringify(alternativesShape(local))===stableStringify(alternativesShape(incoming));
      const situationIdentityExact=stableStringify(idsLocal)===stableStringify(idsIncoming);
      const nonTargetExact=Boolean(target)&&idsIncoming.filter(id=>id!==changedId).every(id=>stableStringify(localById.get(id))===stableStringify(incomingById.get(id)));
      const parentOneStep=Boolean(target)&&oneStepParent(local,incoming),situationOneStep=Boolean(oldSituation&&newSituation)&&oneStepSituation(oldSituation,newSituation);
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      const expectedTitleChange=clean(oldSituation?.title)===EXPECTED_OLD_TITLE&&clean(newSituation?.title)===EXPECTED_NEW_TITLE&&changedFields.length===1&&changedFields[0]==='title';
      const safe=beforeKeys.length===canonicalKeys.length&&localOnly.length===0&&Number(counts.new||0)===0&&Number(counts.localNewer||0)===0&&Number(counts.conflict||0)===0&&incomingNewer.length===1&&same.length===canonicalKeys.length-1&&target?.localKey===TARGET_KEY&&target?.incomingKey===TARGET_KEY&&parentOneStep&&parentSemanticExact&&alternativesExact&&situationIdentityExact&&changedIds.length===1&&nonTargetExact&&situationOneStep&&expectedTitleChange;
      state.plan=plan;state.canonical=canonical;state.beforeRaw=localStorage.getItem(api.STORAGE_KEY);state.priorMergeRollbackRaw=api.MERGE_ROLLBACK_KEY?localStorage.getItem(api.MERGE_ROLLBACK_KEY):null;state.cursor=cursor;state.targetSituationId=changedId;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_RECEIVER_MATERIALIZE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:safe?'ready':'blocked',summary:{cursor,targetKey:TARGET_KEY,targetSituationId:changedId,localTitle:clean(oldSituation?.title),canonicalTitle:clean(newSituation?.title),incomingNewer:incomingNewer.length,conflicts:Number(counts.conflict||0),localNewer:Number(counts.localNewer||0),blockingIssues:safe?0:1,pass:safe}};
      const detail=`cursor ${cursor} · local ${beforeKeys.length} / Canonical ${canonicalKeys.length}\nsame ${same.length} · incoming-newer ${incomingNewer.length} · local-newer ${counts.localNewer||0} · conflicts ${counts.conflict||0} · local-only ${localOnly.length}\nparent one-step ${parentOneStep?'yes':'no'} · parent semantics exact ${parentSemanticExact?'yes':'no'}\nSituation identities exact ${situationIdentityExact?'yes':'no'} · changed Situation ${changedId||'none'} · one-step ${situationOneStep?'yes':'no'}\nchanged fields ${changedFields.join(', ')||'none'} · other children exact ${nonTargetExact&&alternativesExact?'yes':'no'}\nTitle ${clean(oldSituation?.title)||'—'} → ${clean(newSituation?.title)||'—'}\nno data changed yet`;
      if(!safe){show('BLOCKED · Situation receiver materialization safety gate did not match the expected WID5578 revision.',false,detail);state.applyButton.disabled=true;return;}
      show('READY · Canonical WID5578 Situation 1 is one safe revision ahead of local.',true,detail);state.applyButton.disabled=false;
    }catch(e){show(`BLOCKED · ${e?.message||String(e)}`,false,'No Learning Metadata was changed.');if(state.applyButton)state.applyButton.disabled=true;}
    finally{try{db?.close();}catch(_){}}
  }

  async function applyMaterialization(){
    const api=window.WLPLearningHooks;if(!state.plan||!state.canonical||!api?.applyPortableMerge)return;
    state.applyButton.disabled=true;show('APPLYING · Materializing the Canonical WID5578 Situation revision locally…',null,'Canonical / IndexedDB / outbox / Cloud data will not be changed.');
    try{
      const before=currentRecords(),beforeSignatures={};Object.entries(before).forEach(([k,v])=>{beforeSignatures[k]=stableStringify(v);});
      const result=api.applyPortableMerge(state.plan,{});restorePriorMergeRollback(api);
      const after=currentRecords(),changedKeys=Object.keys(beforeSignatures).filter(k=>!after[k]||stableStringify(after[k])!==beforeSignatures[k]),addedKeys=Object.keys(after).filter(k=>!before[k]),verify=verifyAgainstCanonical(state.canonical),targetAfter=after[TARGET_KEY],targetSituation=situations(targetAfter).find(s=>clean(s.situationId)===state.targetSituationId)||null;
      const pass=Number(result?.changed||0)===1&&Number(result?.updated||0)===1&&Number(result?.added||0)===0&&Number(result?.conflictIncoming||0)===0&&changedKeys.length===1&&changedKeys[0]===TARGET_KEY&&addedKeys.length===0&&verify.exact&&clean(targetSituation?.title)===EXPECTED_NEW_TITLE;
      if(!pass){if(state.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,state.beforeRaw);restorePriorMergeRollback(api);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));throw new Error(`Post-materialization verification failed; local Learning Metadata was restored. changed=${changedKeys.join(',')||'none'} semanticMismatch=${verify.semanticMismatch.join(',')||'none'} lineageMismatch=${verify.lineageMismatch.join(',')||'none'}`);}
      localStorage.setItem(ROLLBACK_KEY,JSON.stringify({savedAt:new Date().toISOString(),appVersion:APP_VERSION,beforeRaw:state.beforeRaw,targetKey:TARGET_KEY,targetSituationId:state.targetSituationId,cursor:state.cursor},null,2));
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_RECEIVER_MATERIALIZE_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'pass',summary:{cursor:state.cursor,targetKey:TARGET_KEY,targetSituationId:state.targetSituationId,title:EXPECTED_NEW_TITLE,blockingIssues:0,pass:true},invariants:{localOnlyWrite:true,noIndexedDbWrite:true,noOutboxWrite:true,noCloudWrite:true,semanticExact:true,lineageExact:true}};
      show('PASS · Canonical WID5578 Situation revision was safely materialized on this device.',true,`changed locally ${TARGET_KEY} only · Situation ${state.targetSituationId}\nTitle ${EXPECTED_OLD_TITLE} → ${EXPECTED_NEW_TITLE}\nsemantic exact yes · lineage exact yes\nIndexedDB 0 writes · outbox 0 writes · Cloud 0 writes · cursor ${state.cursor}`);state.rollbackButton.hidden=false;
    }catch(e){show(`BLOCKED · ${e?.message||String(e)}`,false,'No partial receiver materialization is being kept.');}
  }

  function rollbackMaterialization(){
    const api=window.WLPLearningHooks;if(!api?.STORAGE_KEY)return;
    try{const saved=JSON.parse(localStorage.getItem(ROLLBACK_KEY)||'null');if(!saved||saved.targetKey!==TARGET_KEY||!Object.prototype.hasOwnProperty.call(saved,'beforeRaw'))throw new Error('No v345 receiver materialization rollback is available.');if(saved.beforeRaw===null)localStorage.removeItem(api.STORAGE_KEY);else localStorage.setItem(api.STORAGE_KEY,saved.beforeRaw);localStorage.removeItem(ROLLBACK_KEY);window.dispatchEvent(new CustomEvent('wlp-learning-hooks-changed'));show('ROLLED BACK · v345 Situation receiver materialization was reverted.',null,'WID5578 local Learning Metadata was restored to the pre-v345 state.');state.rollbackButton.hidden=true;}catch(e){show(`ROLLBACK BLOCKED · ${e?.message||String(e)}`,false,'No additional change was made.');}
  }

  window.WLPCanonicalLearningMetadataSituationReceiverMaterializeCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(active()){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(prepare,0),{once:true});else setTimeout(prepare,0);}
})();
