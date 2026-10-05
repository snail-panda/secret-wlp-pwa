/* WLP v1.8.6.343 — Query-gated real Situation edit Canonical write canary.
   Query only: ?wlpLearningMetadataSituationEditCanary=1 on editor-local-edit.html?wid=5578
   One normal local Save may change exactly one existing Situation row (no add/remove/reorder,
   no Alternative change, no Entry/Sense/Memory change). Because the local Learning Metadata v2
   record advances its parent lineage on every child edit, this canary stages the matching
   card_learning_metadata parent revision and learning_situations child revision together as one
   two-mutation action. No SQL, Service Worker, or unrelated UI behavior is touched. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.343-learning-metadata-situation-real-edit-canary-v1';
  const FLAG='wlpLearningMetadataSituationEditCanary';
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
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const params=()=>new URLSearchParams(location.search);
  const active=()=>params().get(FLAG)==='1';
  const targetWid=()=>clean(params().get('wid'));
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}

  function makePanel(){
    if(state.panel||!active())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-situation-edit-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100015;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(820px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · real Situation edit compound canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');
  }
  function show(text,ok=null,detail='',force=false){if(!active()&&!force)return;makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function short(v,n=120){const s=clean(v);return s.length>n?`${s.slice(0,n-1)}…`:s||'—';}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  function localRecord(){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);}
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
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

  function buildCanonicalRecord(parentWrapper,situationRows,alternativeRows,linkRows,cardId){
    const p=payload(parentWrapper),sourceSituationByCanonical=new Map();
    const situations=situationRows.map(payload).filter(s=>clean(s.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>{if(clean(s.situation_id))sourceSituationByCanonical.set(clean(s.situation_id),clean(s.source_situation_id));return{situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]};});
    const linksByAlternative=new Map();linkRows.map(payload).forEach(l=>{const aid=clean(l.alternative_id),sid=clean(l.situation_id);if(!aid||!sid||clean(l.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const alternativeExpressions=alternativeRows.map(payload).filter(a=>clean(a.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]}));
    return{metadataId:clean(p.metadata_id),entryKey:`wid:${TARGET_WID}`,entryKind:'master',wordId:TARGET_WID,localDraftId:'',status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),createdAt:clean(p.created_at),updatedAt:clean(p.updated_at),createdByDevice:clean(p.created_by_device),updatedByDevice:clean(p.updated_by_device),deletedAt:clean(p.deleted_at),content:{senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),entryType:clean(p.entry_type),situations,alternativeExpressions},history:Array.isArray(p.source_history)?clone(p.source_history):[]};
  }

  async function resolveCanonical(db){
    const [cards,metadataRows,situationRows,alternativeRows,linkRows]=await Promise.all([getAll(db,CARD_STORE),getAll(db,METADATA_STORE),getAll(db,SITUATION_STORE),getAll(db,ALTERNATIVE_STORE),getAll(db,LINK_STORE)]);
    const card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${TARGET_WID}`);if(!card)throw new Error(`Canonical card for WID${TARGET_WID} is missing.`);
    const cardId=clean(card.rowKey||card?.payload?.card_id),parent=metadataRows.find(w=>clean(w?.rowKey||w?.payload?.card_id)===cardId);if(!parent||!parent.payload)throw new Error(`Canonical Learning Metadata for WID${TARGET_WID} is missing.`);
    const activeRows=situationRows.filter(w=>clean(w?.payload?.card_id)===cardId&&!clean(w?.payload?.deleted_at)).sort((a,b)=>(Number(a?.payload?.ordinal)||0)-(Number(b?.payload?.ordinal)||0));
    if(!activeRows.length)throw new Error(`Canonical WID${TARGET_WID} has no active Situation row.`);
    const targetRow=activeRows[0],targetPayload=payload(targetRow),sourceSituationId=clean(targetPayload.source_situation_id);if(!sourceSituationId)throw new Error('Target Situation source identity is missing.');
    return{cardId,parent,targetRow,targetSourceSituationId:sourceSituationId,canonicalRecord:buildCanonicalRecord(parent,situationRows,alternativeRows,linkRows,cardId)};
  }

  async function prepare(){
    if(!active())return;makePanel();let db=null;
    try{
      if(targetWid()!==TARGET_WID)throw new Error(`Open this canary on editor-local-edit.html?wid=${TARGET_WID}.`);
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]),cursor=await cursorValue(db,meta);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation edit canary requires ACTIVE Authority v3.');
      if(outbox.length)throw new Error(`sync_outbox must start empty; found ${outbox.length}.`);
      const canonical=await resolveCanonical(db),local=localRecord();
      if(stableStringify(local)!==stableStringify(canonical.canonicalRecord))throw new Error(`WID${TARGET_WID} local Learning Metadata is not fully exact to Canonical; do not edit yet.`);
      const localTarget=activeSituations(local).find(s=>clean(s.situationId)===canonical.targetSourceSituationId);if(!localTarget)throw new Error('Local target Situation does not match Canonical Situation 1 identity.');
      const parentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(canonical.parent.payload)),situationHash=clean(canonical.targetRow.payloadHash)||await sha256(stableStringify(canonical.targetRow.payload));
      state.before={cursor,cardId:canonical.cardId,parentHash,situationHash,parentRowKey:clean(canonical.parent.rowKey||canonical.cardId),situationRowKey:clean(canonical.targetRow.rowKey||canonical.targetRow.payload?.situation_id),targetSourceSituationId:canonical.targetSourceSituationId,local:clone(local),target:clone(localTarget)};state.armed=true;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,cursor,outbox:0,targetSituationId:canonical.targetSourceSituationId,blockingIssues:0,pass:true},invariants:{localAggregateExactCanonical:true,parentAndSituationCompoundRequired:true,realEditorSaveRequired:true}};
      show(`READY · WID${TARGET_WID} Situation 1 is armed for one real edit.`,true,`cursor ${cursor} · outbox 0 · local aggregate = Canonical exact\nSituation ${canonical.targetSourceSituationId}\nTitle: ${short(localTarget.title)}\nAnchor: ${short(localTarget.anchor)}\nNeed: ${short(localTarget.communicativeNeed)}\nChange exactly one field in Situation 1 only, then press Save Changes once.`);
    }catch(e){state.armed=false;state.report={format:'WLP_LEARNING_METADATA_SITUATION_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical write was staged.');}
    finally{try{db?.close();}catch(_){}}
  }

  async function onLocalChanged(){
    if(!active()||!state.armed||state.busy||!state.before)return;state.busy=true;let db=null;
    try{
      await new Promise(r=>setTimeout(r,0));const before=state.before,after=localRecord();
      const beforeActive=activeSituations(before.local),afterActive=activeSituations(after);
      if(stableStringify(parentSemantic(before.local))!==stableStringify(parentSemantic(after)))throw new Error('Entry Type / Sense Hook / Memory Hook changed; Situation canary requires parent semantics unchanged.');
      if(stableStringify(alternatives(before.local))!==stableStringify(alternatives(after)))throw new Error('Alternative content changed; Situation canary stages no Alternative rows.');
      if(beforeActive.length!==afterActive.length)throw new Error('Situation add/remove is not allowed in this real-field canary.');
      if(beforeActive.map(x=>clean(x.situationId)).join('|')!==afterActive.map(x=>clean(x.situationId)).join('|'))throw new Error('Situation identity/order changed; this canary allows one field edit only.');
      const changed=beforeActive.map((s,i)=>({before:s,after:afterActive[i],changed:stableStringify(s)!==stableStringify(afterActive[i])})).filter(x=>x.changed);
      if(changed.length===0){state.busy=false;return;}
      state.armed=false;
      if(changed.length!==1||clean(changed[0].before.situationId)!==before.targetSourceSituationId)throw new Error('Exactly Situation 1 must be the only changed Situation.');
      const oldSituation=changed[0].before,newSituation=changed[0].after,changedFields=changedSituationFields(oldSituation,newSituation);
      if(changedFields.length!==1)throw new Error(`Change exactly one Situation 1 field; detected ${changedFields.length}.`);
      if(!clean(newSituation.anchor)||clean(newSituation.deletedAt))throw new Error('Situation 1 must remain active with a non-empty Anchor.');
      if(!parentLineageAdvancedOnce(before.local,after))throw new Error('Local parent lineage did not advance exactly once for the child edit.');
      if(!situationLineageAdvancedOnce(oldSituation,newSituation))throw new Error('Situation 1 lineage did not advance exactly once.');
      const otherBefore=beforeActive.filter(x=>clean(x.situationId)!==before.targetSourceSituationId),otherAfter=afterActive.filter(x=>clean(x.situationId)!==before.targetSourceSituationId);if(stableStringify(otherBefore)!==stableStringify(otherAfter))throw new Error('A non-target Situation changed.');

      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);if(outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${outbox.length}.`);
      const cursorBefore=await cursorValue(db,meta),canonical=await resolveCanonical(db),currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(canonical.parent.payload)),currentSituationHash=clean(canonical.targetRow.payloadHash)||await sha256(stableStringify(canonical.targetRow.payload));
      if(currentParentHash!==before.parentHash)throw new Error('Canonical parent row changed after READY; stale edit was blocked.');
      if(currentSituationHash!==before.situationHash)throw new Error('Canonical Situation row changed after READY; stale edit was blocked.');
      if(canonical.targetSourceSituationId!==before.targetSourceSituationId)throw new Error('Canonical target Situation identity changed after READY.');

      const nextParentPayload=parentPayloadFromLocal(canonical.parent.payload,after,before.cardId),nextSituationPayload=situationPayloadFromLocal(canonical.targetRow.payload,newSituation,before.cardId),nextParentHash=await sha256(stableStringify(nextParentPayload)),nextSituationHash=await sha256(stableStringify(nextSituationPayload));
      if(nextParentHash===currentParentHash)throw new Error('Parent lineage payload did not advance after Situation edit.');
      if(nextSituationHash===currentSituationHash)throw new Error('Situation payload did not change.');
      const actionId=crypto.randomUUID(),createdAt=new Date().toISOString();
      const parentMutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationEditCanary:true,transportEligible:true,status:'pending',mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:before.parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
      parentMutation.mutationHash=await sha256(stableStringify(parentMutation));
      const situationMutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationEditCanary:true,transportEligible:true,status:'pending',mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_situations',rowKey:before.situationRowKey,precondition:{payloadHash:currentSituationHash},changedFields:[...changedFields,'revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextSituationPayload,payloadHash:nextSituationHash};
      situationMutation.mutationHash=await sha256(stableStringify(situationMutation));
      await addOutboxRows(db,[parentMutation,situationMutation]);
      state.active={actionId,cursorBefore,parentRowKey:before.parentRowKey,situationRowKey:before.situationRowKey,parentHash:nextParentHash,situationHash:nextSituationHash,changedFields};
      show(`PENDING · Real WID${TARGET_WID} Situation edit staged as one compound action.`,true,`cursor ${cursorBefore} · outbox 0 → 2\nchanged Situation field ${changedFields[0]}\nparent lineage + Situation lineage will travel together.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-edit-canary',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:2,companionTable:'card_learning_metadata'}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_SITUATION_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical write was staged.',true);}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verifyForeground(detail){
    if(!active()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The compound outbox action is intentionally retained for retry. Do not make another Learning Metadata edit.',true);return;}
    let db=null;try{db=await openDb();const [outbox,parentRow,situationRow,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,METADATA_STORE,state.active.parentRowKey),getRow(db,SITUATION_STORE,state.active.situationRowKey),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),parentOk=clean(parentRow?.payloadHash)===state.active.parentHash,situationOk=clean(situationRow?.payloadHash)===state.active.situationHash,pass=outbox.length===0&&parentOk&&situationOk&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:outbox.length,changedFields:clone(state.active.changedFields),blockingIssues:pass?0:1,pass},invariants:{realEditorSave:true,parentAndSituationSameAction:true,parentPayloadMatchesLocalLineage:parentOk,situationPayloadMatchesLocalRevision:situationOk,noAlternativeWrite:true}};
      show(pass?`PASS · WID${TARGET_WID} real Situation edit reached Canonical.`:'CHECK · Situation real-edit transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}\nparent payload match ${parentOk?'yes':'no'} · Situation payload match ${situationOk?'yes':'no'}\nchanged Situation field ${state.active.changedFields.join(', ')}`,!pass);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataSituationEditCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
