/* WLP v1.8.6.326 — Learning Metadata Canonical materialization plan audit.
   Read-only simulation of Canonical -> local Learning Metadata v2 union materialization.
   Query only: ?wlpLearningMetadataMaterializePlan=1
   No localStorage, IndexedDB, outbox, or Cloud writes are performed. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.326-learning-metadata-canonical-materialization-plan-v1';
  const FLAG = 'wlpLearningMetadataMaterializePlan';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const STORES = ['cards','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','sync_meta'];
  const META_KEY = 'authority_mirror';
  const CURSOR_KEY = 'cloud_shadow_steady_sync_v1';
  const BASE = Object.freeze({
    candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion:3,
    manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'
  });
  const state = { report:null, panel:null, status:null, detail:null, exportButton:null };

  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableValue(value[key]); });
      return out;
    }
    return value;
  }
  const stableStringify = value => JSON.stringify(stableValue(value));
  const requestPromise = req => new Promise((resolve,reject) => { req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error || new Error('IndexedDB request failed.')); });
  const transactionDone = tx => new Promise((resolve,reject) => { tx.oncomplete=()=>resolve(); tx.onabort=()=>reject(tx.error || new Error('IndexedDB transaction aborted.')); tx.onerror=()=>reject(tx.error || new Error('IndexedDB transaction failed.')); });
  const payload = wrapper => wrapper && typeof wrapper==='object' && wrapper.payload && typeof wrapper.payload==='object' ? wrapper.payload : {};
  const active = () => new URLSearchParams(location.search).get(FLAG) === '1';

  function makePanel() {
    if (state.panel || !active()) return;
    const panel=document.createElement('section');
    panel.id='wlp-learning-metadata-materialization-plan';
    panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100010;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:50vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    panel.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Canonical materialization plan</strong><div id="wlp-learning-metadata-plan-status" style="margin-top:4px">Simulating read-only Canonical → local union…</div><div id="wlp-learning-metadata-plan-detail" style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><div style="margin-top:8px"><button id="wlp-learning-metadata-plan-export" type="button" disabled>Export JSON</button></div>';
    document.body.appendChild(panel);
    const button=panel.querySelector('#wlp-learning-metadata-plan-export');
    button.style.cssText='font:inherit;padding:6px 9px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22';
    button.addEventListener('click',exportReport);
    state.panel=panel;state.status=panel.querySelector('#wlp-learning-metadata-plan-status');state.detail=panel.querySelector('#wlp-learning-metadata-plan-detail');state.exportButton=button;
  }
  function show(text,ok=null,detail='') {
    makePanel(); if(!state.status)return;
    state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;
    if(state.exportButton)state.exportButton.disabled=!state.report;
  }
  function exportReport(){
    if(!state.report)return;
    const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`wlp-learning-metadata-materialization-plan-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function openDb(){
    return new Promise((resolve,reject)=>{let upgrading=false;const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{upgrading=true;try{req.transaction.abort();}catch(_){}};req.onsuccess=()=>{const db=req.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=STORES.filter(name=>!db.objectStoreNames.contains(name));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));req.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});
  }
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),rows=await requestPromise(tx.objectStore(store).getAll());await transactionDone(tx);return Array.isArray(rows)?rows:[];}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),row=await requestPromise(tx.objectStore(store).get(key));await transactionDone(tx);return row||null;}

  function normalizeLocalRecord(key,raw){
    const r=raw&&typeof raw==='object'?raw:{},c=r.content&&typeof r.content==='object'?r.content:{};
    const situations=(Array.isArray(c.situations)?c.situations:[]).map(s=>({situationId:clean(s?.situationId),status:clean(s?.status)||'provisional',revision:Math.max(1,Number(s?.revision)||1),versionId:clean(s?.versionId),parentVersionId:clean(s?.parentVersionId),deletedAt:clean(s?.deletedAt),title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed)})).sort((a,b)=>a.situationId.localeCompare(b.situationId));
    const alternatives=(Array.isArray(c.alternativeExpressions)?c.alternativeExpressions:[]).map(a=>({alternativeId:clean(a?.alternativeId),status:clean(a?.status)||'provisional',revision:Math.max(1,Number(a?.revision)||1),versionId:clean(a?.versionId),parentVersionId:clean(a?.parentVersionId),deletedAt:clean(a?.deletedAt),expression:clean(a?.expression),note:clean(a?.note),situationIds:(Array.isArray(a?.situationIds)?a.situationIds:[]).map(clean).filter(Boolean).sort()})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId));
    return {entryKey:key,deletedAt:clean(r.deletedAt),metadataId:clean(r.metadataId),status:clean(r.status)||'provisional',revision:Math.max(1,Number(r.revision)||1),versionId:clean(r.versionId),parentVersionId:clean(r.parentVersionId),entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),situations,alternatives};
  }
  function buildCanonical(cards,metadataRows,situationRows,alternativeRows,linkRows){
    const cardKeyById=new Map(cards.map(w=>{const p=payload(w);return[clean(p.card_id),clean(p.legacy_key)];}).filter(([id,key])=>id&&key));
    const situationsByCard=new Map(),alternativesByCard=new Map(),sourceSituationByCanonical=new Map(),linksByAlternative=new Map();
    situationRows.forEach(w=>{const p=payload(w),cardId=clean(p.card_id);if(!cardId)return;if(!situationsByCard.has(cardId))situationsByCard.set(cardId,[]);situationsByCard.get(cardId).push(p);if(clean(p.situation_id))sourceSituationByCanonical.set(clean(p.situation_id),clean(p.source_situation_id));});
    alternativeRows.forEach(w=>{const p=payload(w),cardId=clean(p.card_id);if(!cardId)return;if(!alternativesByCard.has(cardId))alternativesByCard.set(cardId,[]);alternativesByCard.get(cardId).push(p);});
    linkRows.forEach(w=>{const p=payload(w),aid=clean(p.alternative_id),sid=clean(p.situation_id);if(!aid||!sid||clean(p.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const out={};
    metadataRows.forEach(w=>{const p=payload(w),cardId=clean(p.card_id),entryKey=cardKeyById.get(cardId)||'';if(!entryKey)return;const situations=(situationsByCard.get(cardId)||[]).map(s=>({situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need)})).sort((a,b)=>a.situationId.localeCompare(b.situationId));const alternatives=(alternativesByCard.get(cardId)||[]).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),deletedAt:clean(a.deleted_at),expression:clean(a.expression),note:clean(a.notes),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean).sort()})).sort((a,b)=>a.alternativeId.localeCompare(b.alternativeId));out[entryKey]={entryKey,deletedAt:clean(p.deleted_at),metadataId:clean(p.metadata_id),status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),entryType:clean(p.entry_type),senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),situations,alternatives};});
    return out;
  }
  function semanticShape(r){return{deletedAt:r.deletedAt,entryType:r.entryType,senseHook:r.senseHook,memoryHook:r.memoryHook,situations:r.situations.map(s=>({situationId:s.situationId,deletedAt:s.deletedAt,title:s.title,anchor:s.anchor,communicativeNeed:s.communicativeNeed})),alternatives:r.alternatives.map(a=>({alternativeId:a.alternativeId,deletedAt:a.deletedAt,expression:a.expression,note:a.note,situationIds:a.situationIds}))};}
  function lineageShape(r){return{metadataId:r.metadataId,status:r.status,revision:r.revision,versionId:r.versionId,parentVersionId:r.parentVersionId,situations:r.situations.map(s=>({situationId:s.situationId,status:s.status,revision:s.revision,versionId:s.versionId,parentVersionId:s.parentVersionId})),alternatives:r.alternatives.map(a=>({alternativeId:a.alternativeId,status:a.status,revision:a.revision,versionId:a.versionId,parentVersionId:a.parentVersionId}))};}

  async function run(){
    if(!active())return;makePanel();
    try{
      if(!window.WLPLearningHooks?.allRecords)throw new Error('Learning Metadata v2 engine is unavailable.');
      const localRaw=window.WLPLearningHooks.allRecords({includeDeleted:true})||{},local={};Object.entries(localRaw).forEach(([key,value])=>{local[key]=normalizeLocalRecord(key,value);});
      const db=await openDb();
      const [meta,cursorMeta,cards,metadata,situations,alternatives,links]=await Promise.all([getRow(db,'sync_meta',META_KEY),getRow(db,'sync_meta',CURSOR_KEY),getAll(db,'cards'),getAll(db,'card_learning_metadata'),getAll(db,'learning_situations'),getAll(db,'learning_alternatives'),getAll(db,'learning_alternative_situations')]);
      if(clean(meta?.candidateKey)!==BASE.candidateKey||Number(meta?.headVersion||0)!==BASE.headVersion||clean(meta?.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Learning Metadata plan requires ACTIVE Authority v3.');
      const canonical=buildCanonical(cards,metadata,situations,alternatives,links),localKeys=Object.keys(local).sort(),canonicalKeys=Object.keys(canonical).sort();
      const inserts=canonicalKeys.filter(key=>!local[key]),localOnly=localKeys.filter(key=>!canonical[key]),shared=localKeys.filter(key=>canonical[key]);
      const semanticConflicts=[],lineageConflicts=[];shared.forEach(key=>{if(stableStringify(semanticShape(local[key]))!==stableStringify(semanticShape(canonical[key])))semanticConflicts.push(key);if(stableStringify(lineageShape(local[key]))!==stableStringify(lineageShape(canonical[key])))lineageConflicts.push(key);});
      const simulated={...local};inserts.forEach(key=>{simulated[key]=clone(canonical[key]);});
      const simulatedKeys=Object.keys(simulated).sort();let postSemanticExact=0,postLineageExact=0;const postSemanticMismatch=[],postLineageMismatch=[];
      canonicalKeys.forEach(key=>{const row=simulated[key];if(row&&stableStringify(semanticShape(row))===stableStringify(semanticShape(canonical[key])))postSemanticExact+=1;else postSemanticMismatch.push(key);if(row&&stableStringify(lineageShape(row))===stableStringify(lineageShape(canonical[key])))postLineageExact+=1;else postLineageMismatch.push(key);});
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      const safe=localOnly.length===0&&semanticConflicts.length===0&&lineageConflicts.length===0&&postSemanticMismatch.length===0&&postLineageMismatch.length===0&&simulatedKeys.length===canonicalKeys.length;
      state.report={format:'WLP_LEARNING_METADATA_CANONICAL_MATERIALIZATION_PLAN',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-canonical-to-local-union-simulation',authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,materializedSyncCursor:cursor},before:{localRecords:localKeys.length,canonicalRecords:canonicalKeys.length,sharedRecords:shared.length,localOnly,canonicalMissingLocally:inserts,semanticConflicts,lineageConflicts},plan:{insertKeys:inserts,insertCount:inserts.length,overwriteKeys:[],overwriteCount:0,deleteKeys:[],deleteCount:0},afterSimulation:{localRecords:simulatedKeys.length,canonicalRecords:canonicalKeys.length,semanticExact:postSemanticExact,lineageExact:postLineageExact,semanticMismatch:postSemanticMismatch,lineageMismatch:postLineageMismatch,exactUnion:safe},invariants:{readOnly:true,noLocalStorageWrites:true,noIndexedDbWrites:true,noOutboxWrites:true,noCloudWrites:true,noOverwriteOfExistingLocalRecords:true,noDeletes:true}};
      db.close();
      const detail=`before local ${localKeys.length} / Canonical ${canonicalKeys.length} · shared ${shared.length}\nplan inserts ${inserts.length}: ${inserts.join(', ')||'none'} · overwrites 0 · deletes 0\npre-existing semantic conflicts ${semanticConflicts.length} · lineage conflicts ${lineageConflicts.length} · local-only ${localOnly.length}\nafter simulation semantic ${postSemanticExact}/${canonicalKeys.length} · lineage ${postLineageExact}/${canonicalKeys.length} · cursor ${cursor}\nread-only · no data changed`;
      show(safe?'PASS · Canonical union can be materialized by insert-only merge.':'CHECK · Materialization plan is not insert-only safe.',safe,detail);
    }catch(error){state.report={format:'WLP_LEARNING_METADATA_CANONICAL_MATERIALIZATION_PLAN',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[error?.message||String(error)]},invariants:{readOnly:true,noLocalStorageWrites:true,noIndexedDbWrites:true,noOutboxWrites:true,noCloudWrites:true}};show(`BLOCKED · ${error?.message||String(error)}`,false,'Read-only plan; no data was changed.');}
  }
  if(active()){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(run,0),{once:true});else setTimeout(run,0);}
})();
