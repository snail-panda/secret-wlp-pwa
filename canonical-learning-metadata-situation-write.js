/* WLP v1.8.6.371 — Learning Metadata existing-Situation production-default Canonical write.
   Production default on editor-local-edit.html?wid=... .
   Diagnostic panel only: ?wlpLearningMetadataSituationWriteAudit=1
   Diagnostic hold for a pre-existing safe local revision: ?wlpLearningMetadataSituationWriteHold=1
   Explicit rollback/compatibility: ?wlpLegacyLearningMetadataSituationWrite=1

   Supported production shape:
   - one existing active Situation content revision (title / anchor / communicativeNeed);
   - no Situation add/remove/reorder/tombstone;
   - no Alternative change;
   - parent semantic fields unchanged;
   - the changed Situation lineage advances exactly one revision;
   - for a normal existing-Situation content edit, the metadata parent lineage stays unchanged and only learning_situations is staged;
   - one-step legacy parent+Situation revisions remain recoverable for compatibility.

   A safe local revision that was already saved before this cutover can be recovered without
   asking the user to edit/save it again. No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.371-learning-metadata-situation-child-only-write-v1';
  const DIAG_FLAG='wlpLearningMetadataSituationWriteAudit';
  const HOLD_FLAG='wlpLearningMetadataSituationWriteHold';
  const ROLLBACK_FLAG='wlpLegacyLearningMetadataSituationWrite';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata',SITUATION_STORE='learning_situations',ALTERNATIVE_STORE='learning_alternatives',LINK_STORE='learning_alternative_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const ALLOWED_SITUATION_FIELDS=new Set(['title','anchor','communicative_need']);
  const state={panel:null,status:null,detail:null,report:null,armed:false,busy:false,before:null,active:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const diagnostics=()=>params().get(DIAG_FLAG)==='1';
  const hold=()=>params().get(HOLD_FLAG)==='1';
  const rollback=()=>params().get(ROLLBACK_FLAG)==='1';
  const targetWid=()=>clean(params().get('wid'));
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}

  function makePanel(force=false){
    if(state.panel||(!diagnostics()&&!force))return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-situation-write-audit';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100015;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(820px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation production-default write audit</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');
  }
  function show(text,ok=null,detail='',force=false){if(!diagnostics()&&!force)return;makePanel(force);if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function short(v,n=120){const s=clean(v);return s.length>n?`${s.slice(0,n-1)}…`:s||'—';}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  function localRecord(wid){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${wid}`);if(!r)throw new Error(`Local Learning Metadata WID${wid} is missing.`);return clone(r);}
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function parentLineageExact(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision||0)===Number(before?.revision||0)&&clean(after?.versionId)===clean(before?.versionId)&&clean(after?.parentVersionId)===clean(before?.parentVersionId)&&clean(after?.updatedAt)===clean(before?.updatedAt)&&clean(after?.updatedByDevice)===clean(before?.updatedByDevice)&&stableStringify(after?.history||[])===stableStringify(before?.history||[]);}
  function situationSemantic(s){return{title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed),deletedAt:clean(s?.deletedAt)};}
  function situationLineageAdvancedOnce(before,after){return clean(after?.situationId)===clean(before?.situationId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function activeSituations(r){return (Array.isArray(r?.content?.situations)?r.content.situations:[]).filter(x=>!clean(x?.deletedAt)&&clean(x?.anchor));}
  function alternatives(r){return Array.isArray(r?.content?.alternativeExpressions)?r.content.alternativeExpressions:[];}
  function changedSituationFields(before,after){const b=situationSemantic(before),a=situationSemantic(after),out=[];if(b.title!==a.title)out.push('title');if(b.anchor!==a.anchor)out.push('anchor');if(b.communicativeNeed!==a.communicativeNeed)out.push('communicative_need');return out;}

  function parentPayloadFromLocal(basePayload,record,cardId){
    const c=record?.content||{};
    return {...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};
  }
  function situationPayloadFromLocal(basePayload,situation,cardId){
    return {...clone(basePayload),card_id:cardId,source_situation_id:clean(situation.situationId)||null,status:clean(situation.status)||null,revision:Math.max(1,Number(situation.revision)||1),version_id:clean(situation.versionId)||null,parent_version_id:clean(situation.parentVersionId)||null,created_at:clean(situation.createdAt)||null,updated_at:clean(situation.updatedAt)||null,created_by_device:clean(situation.createdByDevice)||null,updated_by_device:clean(situation.updatedByDevice)||null,deleted_at:clean(situation.deletedAt)||null,title:clean(situation.title),anchor:clean(situation.anchor),communicative_need:clean(situation.communicativeNeed),source_history:Array.isArray(situation.history)?clone(situation.history):[]};
  }

  function buildCanonicalRecord(parentWrapper,situationRows,alternativeRows,linkRows,cardId,wid){
    const p=payload(parentWrapper),sourceSituationByCanonical=new Map();
    const situations=situationRows.map(payload).filter(s=>clean(s.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>{if(clean(s.situation_id))sourceSituationByCanonical.set(clean(s.situation_id),clean(s.source_situation_id));return{situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]};});
    const linksByAlternative=new Map();linkRows.map(payload).forEach(l=>{const aid=clean(l.alternative_id),sid=clean(l.situation_id);if(!aid||!sid||clean(l.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const alternativeExpressions=alternativeRows.map(payload).filter(a=>clean(a.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]}));
    return{metadataId:clean(p.metadata_id),entryKey:`wid:${wid}`,entryKind:'master',wordId:wid,localDraftId:'',status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),createdAt:clean(p.created_at),updatedAt:clean(p.updated_at),createdByDevice:clean(p.created_by_device),updatedByDevice:clean(p.updated_by_device),deletedAt:clean(p.deleted_at),content:{senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),entryType:clean(p.entry_type),situations,alternativeExpressions},history:Array.isArray(p.source_history)?clone(p.source_history):[]};
  }

  async function resolveCanonical(db,wid){
    const [cards,metadataRows,situationRows,alternativeRows,linkRows]=await Promise.all([getAll(db,CARD_STORE),getAll(db,METADATA_STORE),getAll(db,SITUATION_STORE),getAll(db,ALTERNATIVE_STORE),getAll(db,LINK_STORE)]);
    const card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${wid}`);if(!card)throw new Error(`Canonical card for WID${wid} is missing.`);
    const cardId=clean(card.rowKey||card?.payload?.card_id),parent=metadataRows.find(w=>clean(w?.rowKey||w?.payload?.card_id)===cardId);if(!parent||!parent.payload)throw new Error(`Canonical Learning Metadata for WID${wid} is missing.`);
    const activeRows=situationRows.filter(w=>clean(w?.payload?.card_id)===cardId&&!clean(w?.payload?.deleted_at)).sort((a,b)=>(Number(a?.payload?.ordinal)||0)-(Number(b?.payload?.ordinal)||0));
    const rowBySourceId=new Map(activeRows.map(w=>[clean(w?.payload?.source_situation_id),w]).filter(([id])=>id));
    return{wid,cardId,parent,activeRows,rowBySourceId,canonicalRecord:buildCanonicalRecord(parent,situationRows,alternativeRows,linkRows,cardId,wid)};
  }

  function analyzeAdvance(canonicalRecord,local){
    if(stableStringify(canonicalRecord)===stableStringify(local))return{kind:'same'};
    if(stableStringify(parentSemantic(canonicalRecord))!==stableStringify(parentSemantic(local)))return{kind:'unsafe',reason:'Entry Type / Sense Hook / Memory Hook differs.'};
    if(stableStringify(alternatives(canonicalRecord))!==stableStringify(alternatives(local)))return{kind:'unsafe',reason:'Alternative content differs.'};
    const parentMode=parentLineageExact(canonicalRecord,local)?'child-only':parentLineageAdvancedOnce(canonicalRecord,local)?'legacy-compound':'';
    if(!parentMode)return{kind:'unsafe',reason:'Parent lineage is neither the same canonical baseline nor one recoverable legacy revision ahead.'};
    const before=activeSituations(canonicalRecord),after=activeSituations(local);
    if(before.length!==after.length)return{kind:'unsafe',reason:'Situation add/remove is not production-auto-writable yet.'};
    const beforeIds=before.map(x=>clean(x.situationId)),afterIds=after.map(x=>clean(x.situationId));
    if(stableStringify(beforeIds)!==stableStringify(afterIds))return{kind:'unsafe',reason:'Situation identity/order differs.'};
    const changed=before.map((s,i)=>({before:s,after:after[i]})).filter(x=>stableStringify(x.before)!==stableStringify(x.after));
    if(changed.length!==1)return{kind:'unsafe',reason:`Expected exactly one changed existing Situation; found ${changed.length}.`};
    const oldSituation=changed[0].before,newSituation=changed[0].after;
    if(!situationLineageAdvancedOnce(oldSituation,newSituation))return{kind:'unsafe',reason:'Changed Situation lineage is not exactly one revision ahead.'};
    if(!clean(newSituation.anchor)||clean(newSituation.deletedAt))return{kind:'unsafe',reason:'Changed Situation must remain active with a non-empty Anchor.'};
    const changedFields=changedSituationFields(oldSituation,newSituation);
    if(!changedFields.length||!changedFields.every(x=>ALLOWED_SITUATION_FIELDS.has(x)))return{kind:'unsafe',reason:'Situation change includes an unsupported field.'};
    return{kind:parentMode==='child-only'?'safe-child-only-ahead':'safe-local-ahead',parentMode,oldSituation,newSituation,targetSourceSituationId:clean(oldSituation.situationId),changedFields};
  }

  async function stageCurrent({reason='real-save'}={}){
    if(state.busy)return;state.busy=true;let db=null;
    try{
      const wid=targetWid();if(!/^\d+$/.test(wid))throw new Error('Open editor-local-edit with a numeric ?wid=.');
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);if(outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${outbox.length}.`);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation production write requires ACTIVE Authority v3.');
      const cursorBefore=await cursorValue(db,meta),canonical=await resolveCanonical(db,wid),local=localRecord(wid),analysis=analyzeAdvance(canonical.canonicalRecord,local);
      if(!['safe-child-only-ahead','safe-local-ahead'].includes(analysis.kind))throw new Error(analysis.kind==='same'?'No pending Situation revision exists to stage.':analysis.reason||'Local Situation revision is not safe to stage.');
      const targetRow=canonical.rowBySourceId.get(analysis.targetSourceSituationId);if(!targetRow)throw new Error('Canonical target Situation row is missing.');
      const currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(canonical.parent.payload)),currentSituationHash=clean(targetRow.payloadHash)||await sha256(stableStringify(targetRow.payload));
      const nextSituationPayload=situationPayloadFromLocal(targetRow.payload,analysis.newSituation,canonical.cardId),nextSituationHash=await sha256(stableStringify(nextSituationPayload));
      if(nextSituationHash===currentSituationHash)throw new Error('Situation payload did not change.');
      const actionId=crypto.randomUUID(),createdAt=new Date().toISOString(),common={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationDefaultWrite:true,transportEligible:true,status:'pending'};
      const situationMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_situations',rowKey:clean(targetRow.rowKey||targetRow.payload?.situation_id),precondition:{payloadHash:currentSituationHash},changedFields:[...analysis.changedFields,'revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextSituationPayload,payloadHash:nextSituationHash};
      situationMutation.mutationHash=await sha256(stableStringify(situationMutation));
      let rows=[situationMutation],parentHash=currentParentHash,parentRowKey=clean(canonical.parent.rowKey||canonical.cardId),transportShape='situation-only';
      if(analysis.parentMode==='legacy-compound'){
        const nextParentPayload=parentPayloadFromLocal(canonical.parent.payload,local,canonical.cardId),nextParentHash=await sha256(stableStringify(nextParentPayload));
        if(nextParentHash===currentParentHash)throw new Error('Legacy parent lineage payload did not advance.');
        const parentMutation={...common,mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
        parentMutation.mutationHash=await sha256(stableStringify(parentMutation));
        rows=[parentMutation,situationMutation];parentHash=nextParentHash;transportShape='legacy-parent+situation';
      }
      await addOutboxRows(db,rows);
      state.armed=false;state.active={actionId,wid,cursorBefore,parentRowKey,situationRowKey:situationMutation.rowKey,parentHash,situationHash:nextSituationHash,changedFields:analysis.changedFields.slice(),reason,transportShape};
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'pending',summary:{wordId:wid,cursorBefore,outboxAfterStage:rows.length,changedFields:clone(analysis.changedFields),transportShape,recoveredSavedLocalRevision:reason==='saved-local-recovery',blockingIssues:0,pass:true},invariants:{productionDefault:true,childRowIndependent:transportShape==='situation-only',legacyCompoundRecovery:transportShape==='legacy-parent+situation',noAlternativeWrite:true,existingSituationOnly:true}};
      show(`PENDING · Production-default WID${wid} Situation revision staged.`,true,`cursor ${cursorBefore} · outbox 0 → ${rows.length} · changed ${analysis.changedFields.join(', ')}\n${reason==='saved-local-recovery'?'saved local revision recovered without another edit/save':'normal editor Save captured'}\n${transportShape==='situation-only'?'Situation child only; metadata parent lineage stays unchanged.':'legacy parent + Situation compatibility recovery.'}`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-default-write',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:rows.length,companionTable:rows.length===2?'card_learning_metadata':''}}));
      return true;
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{wordId:targetWid(),blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor revision remains local. No unsafe Canonical write was staged.',true);return false;}
    finally{state.busy=false;try{db?.close();}catch(_){} }
  }

  async function prepare(){
    if(rollback()){if(diagnostics())show('ROLLBACK · Legacy Situation-write behavior is active.',null,'Production-default Situation Canonical write is disabled by query flag.');return;}
    const wid=targetWid();let db=null;
    try{
      if(!/^\d+$/.test(wid))throw new Error('Open editor-local-edit with a numeric ?wid=.');
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]),cursor=await cursorValue(db,meta);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation production write requires ACTIVE Authority v3.');
      if(outbox.length)throw new Error(`sync_outbox must start empty; found ${outbox.length}.`);
      const canonical=await resolveCanonical(db,wid),local=localRecord(wid),analysis=analyzeAdvance(canonical.canonicalRecord,local);
      if(analysis.kind==='same'){
        state.before={wid,cursor,canonicalRecord:clone(canonical.canonicalRecord)};state.armed=true;
        state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:wid,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{productionDefault:true,localAggregateExactCanonical:true,existingSituationEditArmed:true}};
        show(`READY · WID${wid} is armed for a safe existing-Situation edit.`,true,`cursor ${cursor} · outbox 0 · local aggregate = Canonical exact\nNormal Save will Canonical-sync one existing Situation child revision without advancing the metadata parent lineage.`);
        return;
      }
      if(['safe-child-only-ahead','safe-local-ahead'].includes(analysis.kind)){
        state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:hold()?'recovery-ready':'recovering',summary:{wordId:wid,cursor,outbox:0,targetSituationId:analysis.targetSourceSituationId,changedFields:clone(analysis.changedFields),blockingIssues:0,pass:true},invariants:{productionDefault:true,safeSavedLocalRevision:true,parentSameBaseline:analysis.kind==='safe-child-only-ahead',legacyParentOneStep:analysis.kind==='safe-local-ahead',situationOneStep:true,noAlternativeWrite:true}};
        if(hold()){
          show(`READY · Saved local WID${wid} Situation revision is safe to recover.`,true,`cursor ${cursor} · outbox 0\nSituation ${analysis.targetSourceSituationId} · changed ${analysis.changedFields.join(', ')}\n${short(analysis.oldSituation.title)} → ${short(analysis.newSituation.title)}\nHOLD is active: no data changed or staged.`);
          return;
        }
        setTimeout(()=>{void stageCurrent({reason:'saved-local-recovery'});},0);return;
      }
      throw new Error(analysis.reason||'Local Learning Metadata is not safe for automatic Situation write.');
    }catch(e){state.armed=false;state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{wordId:wid,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical Situation write was staged.');}
    finally{try{db?.close();}catch(_){} }
  }

  async function onLocalChanged(){
    if(rollback()||!state.armed||state.busy||!state.before)return;
    try{
      await new Promise(r=>setTimeout(r,0));const after=localRecord(state.before.wid),analysis=analyzeAdvance(state.before.canonicalRecord,after);
      if(analysis.kind==='same')return;
      state.armed=false;
      if(!['safe-child-only-ahead','safe-local-ahead'].includes(analysis.kind))throw new Error(analysis.reason||'Saved Situation edit is not safe for automatic Canonical write.');
      await stageCurrent({reason:'real-save'});
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:state.before?.wid||targetWid(),blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical Situation write was staged.',true);}
  }

  async function verifyForeground(detail){
    if(!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The outbox action is intentionally retained for retry. Do not make another Learning Metadata edit.',true);return;}
    let db=null;try{
      db=await openDb();const [outbox,parentRow,situationRow,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,METADATA_STORE,state.active.parentRowKey),getRow(db,SITUATION_STORE,state.active.situationRowKey),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),parentOk=clean(parentRow?.payloadHash)===state.active.parentHash,situationOk=clean(situationRow?.payloadHash)===state.active.situationHash,pass=outbox.length===0&&parentOk&&situationOk&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:state.active.wid,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:outbox.length,changedFields:clone(state.active.changedFields),transportShape:state.active.transportShape,recoveredSavedLocalRevision:state.active.reason==='saved-local-recovery',blockingIssues:pass?0:1,pass},invariants:{productionDefault:true,parentPayloadExpected:parentOk,situationPayloadMatchesLocalRevision:situationOk,childRowIndependent:state.active.transportShape==='situation-only',noAlternativeWrite:true}};
      show(pass?`PASS · Production-default WID${state.active.wid} Situation revision reached Canonical.`:'CHECK · Situation-write transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}\nparent payload expected ${parentOk?'yes':'no'} · Situation payload match ${situationOk?'yes':'no'}\nshape ${state.active.transportShape} · changed ${state.active.changedFields.join(', ')}${state.active.reason==='saved-local-recovery'?' · saved local revision recovered':''}`,!pass);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){} }
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataSituationWrite=Object.freeze({version:1,prepare,stageCurrent,getReport:()=>clone(state.report),productionDefault:true,diagnosticFlag:DIAG_FLAG,holdFlag:HOLD_FLAG,rollbackFlag:ROLLBACK_FLAG});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
