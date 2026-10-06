/* WLP v1.8.6.354 — Query-gated real Alternative edit Canonical write canary.
   Query only: ?wlpLearningMetadataAlternativeEditCanary=1 on editor-local-edit.html?wid=5578
   One normal local Save may change exactly one existing Alternative row's expression OR note
   (no add/remove/reorder, no Situation link change, no Situation change, no Entry/Sense/Memory change).
   Because the local Learning Metadata v2 record advances its parent lineage on every child edit,
   this canary stages the matching card_learning_metadata parent revision and learning_alternatives
   child revision together as one two-mutation action. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.354-learning-metadata-alternative-real-edit-canary-v1';
  const FLAG='wlpLearningMetadataAlternativeEditCanary';
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
    const p=document.createElement('section');p.id='wlp-learning-metadata-alternative-edit-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100015;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(820px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · real Alternative edit compound canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');
  }
  function show(text,ok=null,detail='',force=false){if(!active()&&!force)return;makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function short(v,n=120){const s=clean(v);return s.length>n?`${s.slice(0,n-1)}…`:s||'—';}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function readSnapshot(db){
    const stores=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE,ALTERNATIVE_STORE,LINK_STORE],tx=db.transaction(stores,'readonly'),done=txDone(tx);
    const m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),c=tx.objectStore(CARD_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE),a=tx.objectStore(ALTERNATIVE_STORE),l=tx.objectStore(LINK_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(c.getAll()),req(md.getAll()),req(s.getAll()),req(a.getAll()),req(l.getAll())]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],cards:values[3]||[],metadataRows:values[4]||[],situationRows:values[5]||[],alternativeRows:values[6]||[],linkRows:values[7]||[]};
  }
  async function readVerify(db,parentKey,alternativeKey){
    const tx=db.transaction([META_STORE,OUTBOX_STORE,METADATA_STORE,ALTERNATIVE_STORE],'readonly'),done=txDone(tx),m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),md=tx.objectStore(METADATA_STORE),a=tx.objectStore(ALTERNATIVE_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(md.get(parentKey)),req(a.get(alternativeKey))]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],parent:values[3]||null,alternative:values[4]||null};
  }
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await done;}
  const cursorValue=(meta,cursor)=>Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursor?.lastSyncCursor||0));

  function localRecord(){const api=window.WLPLearningHooks;if(!api?.getRecord)throw new Error('Learning Metadata v2 engine is unavailable.');const r=api.getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);}
  function parentSemantic(r){const c=r?.content||{};return{entryType:clean(c.entryType),senseHook:clean(c.senseHook),memoryHook:clean(c.memoryHook),deletedAt:clean(r?.deletedAt)};}
  function parentLineageAdvancedOnce(before,after){return clean(after?.metadataId)===clean(before?.metadataId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function alternativeSemantic(a){return{expression:clean(a?.expression),note:clean(a?.note),situationIds:(Array.isArray(a?.situationIds)?a.situationIds:[]).map(clean).filter(Boolean),deletedAt:clean(a?.deletedAt)};}
  function alternativeLineageAdvancedOnce(before,after){return clean(after?.alternativeId)===clean(before?.alternativeId)&&Number(after?.revision)===Number(before?.revision)+1&&clean(after?.parentVersionId)===clean(before?.versionId)&&clean(after?.versionId)&&clean(after?.versionId)!==clean(before?.versionId);}
  function activeAlternatives(r){return(Array.isArray(r?.content?.alternativeExpressions)?r.content.alternativeExpressions:[]).filter(x=>!clean(x?.deletedAt)&&clean(x?.expression));}
  function situations(r){return Array.isArray(r?.content?.situations)?r.content.situations:[];}
  function changedAlternativeFields(before,after){const b=alternativeSemantic(before),a=alternativeSemantic(after),out=[];if(b.expression!==a.expression)out.push('expression');if(b.note!==a.note)out.push('notes');return out;}

  function parentPayloadFromLocal(basePayload,record,cardId){
    const c=record?.content||{};
    return {...clone(basePayload),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Math.max(1,Number(record.revision)||1),version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};
  }
  function alternativePayloadFromLocal(basePayload,alternative,cardId){
    return {...clone(basePayload),card_id:cardId,source_alternative_id:clean(alternative.alternativeId)||null,status:clean(alternative.status)||null,revision:Math.max(1,Number(alternative.revision)||1),version_id:clean(alternative.versionId)||null,parent_version_id:clean(alternative.parentVersionId)||null,created_at:clean(alternative.createdAt)||null,updated_at:clean(alternative.updatedAt)||null,created_by_device:clean(alternative.createdByDevice)||clean(basePayload?.created_by_device)||null,updated_by_device:clean(alternative.updatedByDevice)||null,deleted_at:clean(alternative.deletedAt)||null,expression:clean(alternative.expression),notes:clean(alternative.note),source_history:Array.isArray(alternative.history)?clone(alternative.history):[]};
  }

  function buildCanonicalRecord(parentWrapper,situationRows,alternativeRows,linkRows,cardId){
    const p=payload(parentWrapper),sourceSituationByCanonical=new Map();
    const situations=situationRows.map(payload).filter(s=>clean(s.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(s=>{if(clean(s.situation_id))sourceSituationByCanonical.set(clean(s.situation_id),clean(s.source_situation_id));return{situationId:clean(s.source_situation_id),status:clean(s.status)||'provisional',revision:Math.max(1,Number(s.revision)||1),versionId:clean(s.version_id),parentVersionId:clean(s.parent_version_id),createdAt:clean(s.created_at),updatedAt:clean(s.updated_at),createdByDevice:clean(s.created_by_device),updatedByDevice:clean(s.updated_by_device),deletedAt:clean(s.deleted_at),title:clean(s.title),anchor:clean(s.anchor),communicativeNeed:clean(s.communicative_need),history:Array.isArray(s.source_history)?clone(s.source_history):[]};});
    const linksByAlternative=new Map();linkRows.map(payload).forEach(l=>{const aid=clean(l.alternative_id),sid=clean(l.situation_id);if(!aid||!sid||clean(l.deleted_at))return;if(!linksByAlternative.has(aid))linksByAlternative.set(aid,[]);linksByAlternative.get(aid).push(sid);});
    const alternativeExpressions=alternativeRows.map(payload).filter(a=>clean(a.card_id)===cardId).sort((a,b)=>(Number(a.ordinal)||0)-(Number(b.ordinal)||0)).map(a=>({alternativeId:clean(a.source_alternative_id),status:clean(a.status)||'provisional',revision:Math.max(1,Number(a.revision)||1),versionId:clean(a.version_id),parentVersionId:clean(a.parent_version_id),createdAt:clean(a.created_at),updatedAt:clean(a.updated_at),createdByDevice:clean(a.created_by_device)||clean(a.updated_by_device),updatedByDevice:clean(a.updated_by_device),deletedAt:clean(a.deleted_at),expression:clean(a.expression),situationIds:(linksByAlternative.get(clean(a.alternative_id))||[]).map(id=>sourceSituationByCanonical.get(id)||'').filter(Boolean),note:clean(a.notes),history:Array.isArray(a.source_history)?clone(a.source_history):[]}));
    return{metadataId:clean(p.metadata_id),entryKey:`wid:${TARGET_WID}`,entryKind:'master',wordId:TARGET_WID,localDraftId:'',status:clean(p.status)||'provisional',revision:Math.max(1,Number(p.revision)||1),versionId:clean(p.version_id),parentVersionId:clean(p.parent_version_id),createdAt:clean(p.created_at),updatedAt:clean(p.updated_at),createdByDevice:clean(p.created_by_device),updatedByDevice:clean(p.updated_by_device),deletedAt:clean(p.deleted_at),content:{senseHook:clean(p.sense_hook),memoryHook:clean(p.memory_hook),entryType:clean(p.entry_type),situations,alternativeExpressions},history:Array.isArray(p.source_history)?clone(p.source_history):[]};
  }

  function resolveCanonical(snap){
    const card=snap.cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${TARGET_WID}`);if(!card)throw new Error(`Canonical card for WID${TARGET_WID} is missing.`);
    const cardId=clean(card.rowKey||card?.payload?.card_id),parent=snap.metadataRows.find(w=>clean(w?.rowKey||w?.payload?.card_id)===cardId);if(!parent||!parent.payload)throw new Error(`Canonical Learning Metadata for WID${TARGET_WID} is missing.`);
    const activeRows=snap.alternativeRows.filter(w=>clean(w?.payload?.card_id)===cardId&&!clean(w?.payload?.deleted_at)).sort((a,b)=>(Number(a?.payload?.ordinal)||0)-(Number(b?.payload?.ordinal)||0));
    if(!activeRows.length)throw new Error(`Canonical WID${TARGET_WID} has no active Alternative row.`);
    const targetRow=activeRows[0],targetPayload=payload(targetRow),sourceAlternativeId=clean(targetPayload.source_alternative_id);if(!sourceAlternativeId)throw new Error('Target Alternative source identity is missing.');
    return{cardId,parent,targetRow,targetSourceAlternativeId:sourceAlternativeId,canonicalRecord:buildCanonicalRecord(parent,snap.situationRows,snap.alternativeRows,snap.linkRows,cardId)};
  }

  async function prepare(){
    if(!active())return;makePanel();let db=null;
    try{
      if(targetWid()!==TARGET_WID)throw new Error(`Open this canary on editor-local-edit.html?wid=${TARGET_WID}.`);
      db=await openDb();const snap=await readSnapshot(db),cursor=cursorValue(snap.meta,snap.cursor);
      if(!snap.meta||clean(snap.meta.candidateKey)!==BASE.candidateKey||Number(snap.meta.headVersion||0)!==BASE.headVersion||clean(snap.meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Alternative edit canary requires ACTIVE Authority v3.');
      if(snap.outbox.length)throw new Error(`sync_outbox must start empty; found ${snap.outbox.length}.`);
      const canonical=resolveCanonical(snap),local=localRecord();
      if(stableStringify(local)!==stableStringify(canonical.canonicalRecord))throw new Error(`WID${TARGET_WID} local Learning Metadata is not fully exact to Canonical; do not edit yet.`);
      const localTarget=activeAlternatives(local).find(a=>clean(a.alternativeId)===canonical.targetSourceAlternativeId);if(!localTarget)throw new Error('Local target Alternative does not match Canonical Alternative 1 identity.');
      const parentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(canonical.parent.payload)),alternativeHash=clean(canonical.targetRow.payloadHash)||await sha256(stableStringify(canonical.targetRow.payload));
      state.before={cursor,cardId:canonical.cardId,parentHash,alternativeHash,parentRowKey:clean(canonical.parent.rowKey||canonical.cardId),alternativeRowKey:clean(canonical.targetRow.rowKey||canonical.targetRow.payload?.alternative_id),targetSourceAlternativeId:canonical.targetSourceAlternativeId,local:clone(local),target:clone(localTarget)};state.armed=true;
      state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,cursor,outbox:0,targetAlternativeId:canonical.targetSourceAlternativeId,blockingIssues:0,pass:true},invariants:{localAggregateExactCanonical:true,parentAndAlternativeCompoundRequired:true,realEditorSaveRequired:true,noLinkChange:true}};
      show(`READY · WID${TARGET_WID} Alternative 1 is armed for one real edit.`,true,`cursor ${cursor} · outbox 0 · local aggregate = Canonical exact\nAlternative ${canonical.targetSourceAlternativeId}\nExpression: ${short(localTarget.expression)}\nNote: ${short(localTarget.note)}\nSituation links: ${(localTarget.situationIds||[]).map(clean).filter(Boolean).join(', ')||'General'}\nChange exactly one field in Alternative 1: Expression OR Note only, then press Save Changes once.`);
    }catch(e){state.armed=false;state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No Canonical write was staged.');}
    finally{try{db?.close();}catch(_){}}
  }

  async function onLocalChanged(){
    if(!active()||!state.armed||state.busy||!state.before)return;state.busy=true;let db=null;
    try{
      await new Promise(r=>setTimeout(r,0));const before=state.before,after=localRecord();
      const beforeActive=activeAlternatives(before.local),afterActive=activeAlternatives(after);
      if(stableStringify(parentSemantic(before.local))!==stableStringify(parentSemantic(after)))throw new Error('Entry Type / Sense Hook / Memory Hook changed; Alternative canary requires parent semantics unchanged.');
      if(stableStringify(situations(before.local))!==stableStringify(situations(after)))throw new Error('Situation content changed; Alternative canary stages no Situation rows.');
      if(beforeActive.length!==afterActive.length)throw new Error('Alternative add/remove is not allowed in this real-field canary.');
      if(beforeActive.map(x=>clean(x.alternativeId)).join('|')!==afterActive.map(x=>clean(x.alternativeId)).join('|'))throw new Error('Alternative identity/order changed; this canary allows one field edit only.');
      const changed=beforeActive.map((a,i)=>({before:a,after:afterActive[i],changed:stableStringify(a)!==stableStringify(afterActive[i])})).filter(x=>x.changed);
      if(changed.length===0){state.busy=false;return;}
      state.armed=false;
      if(changed.length!==1||clean(changed[0].before.alternativeId)!==before.targetSourceAlternativeId)throw new Error('Exactly Alternative 1 must be the only changed Alternative.');
      const oldAlternative=changed[0].before,newAlternative=changed[0].after;
      if(stableStringify((oldAlternative.situationIds||[]).map(clean).filter(Boolean))!==stableStringify((newAlternative.situationIds||[]).map(clean).filter(Boolean)))throw new Error('Alternative Situation link changed; link transport is a later stage and is blocked here.');
      const changedFields=changedAlternativeFields(oldAlternative,newAlternative);
      if(changedFields.length!==1)throw new Error(`Change exactly one Alternative 1 field (Expression OR Note); detected ${changedFields.length}.`);
      if(!clean(newAlternative.expression)||clean(newAlternative.deletedAt))throw new Error('Alternative 1 must remain active with a non-empty Expression.');
      if(!parentLineageAdvancedOnce(before.local,after))throw new Error('Local parent lineage did not advance exactly once for the child edit.');
      if(!alternativeLineageAdvancedOnce(oldAlternative,newAlternative))throw new Error('Alternative 1 lineage did not advance exactly once.');
      const otherBefore=beforeActive.filter(x=>clean(x.alternativeId)!==before.targetSourceAlternativeId),otherAfter=afterActive.filter(x=>clean(x.alternativeId)!==before.targetSourceAlternativeId);if(stableStringify(otherBefore)!==stableStringify(otherAfter))throw new Error('A non-target Alternative changed.');

      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty before staging; found ${snap.outbox.length}.`);
      const cursorBefore=cursorValue(snap.meta,snap.cursor),canonical=resolveCanonical(snap),currentParentHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(canonical.parent.payload)),currentAlternativeHash=clean(canonical.targetRow.payloadHash)||await sha256(stableStringify(canonical.targetRow.payload));
      if(currentParentHash!==before.parentHash)throw new Error('Canonical parent row changed after READY; stale edit was blocked.');
      if(currentAlternativeHash!==before.alternativeHash)throw new Error('Canonical Alternative row changed after READY; stale edit was blocked.');
      if(canonical.targetSourceAlternativeId!==before.targetSourceAlternativeId)throw new Error('Canonical target Alternative identity changed after READY.');

      const nextParentPayload=parentPayloadFromLocal(canonical.parent.payload,after,before.cardId),nextAlternativePayload=alternativePayloadFromLocal(canonical.targetRow.payload,newAlternative,before.cardId),nextParentHash=await sha256(stableStringify(nextParentPayload)),nextAlternativeHash=await sha256(stableStringify(nextAlternativePayload));
      if(nextParentHash===currentParentHash)throw new Error('Parent lineage payload did not advance after Alternative edit.');
      if(nextAlternativeHash===currentAlternativeHash)throw new Error('Alternative payload did not change.');
      const actionId=crypto.randomUUID(),createdAt=new Date().toISOString();
      const parentMutation={schemaVersion:1,baseAuthority:{candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash},deviceKey:snap.meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataAlternativeEditCanary:true,transportEligible:true,status:'pending',mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:before.parentRowKey,precondition:{payloadHash:currentParentHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextParentPayload,payloadHash:nextParentHash};
      parentMutation.mutationHash=await sha256(stableStringify(parentMutation));
      const alternativeMutation={schemaVersion:1,baseAuthority:{candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash},deviceKey:snap.meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataAlternativeEditCanary:true,transportEligible:true,status:'pending',mutationId:crypto.randomUUID(),mutationKind:'upsert',tableName:'learning_alternatives',rowKey:before.alternativeRowKey,precondition:{payloadHash:currentAlternativeHash},changedFields:[...changedFields,'revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:nextAlternativePayload,payloadHash:nextAlternativeHash};
      alternativeMutation.mutationHash=await sha256(stableStringify(alternativeMutation));
      await addOutboxRows(db,[parentMutation,alternativeMutation]);
      state.active={actionId,cursorBefore,parentRowKey:before.parentRowKey,alternativeRowKey:before.alternativeRowKey,parentHash:nextParentHash,alternativeHash:nextAlternativeHash,changedFields};
      show(`PENDING · Real WID${TARGET_WID} Alternative edit staged as one compound action.`,true,`cursor ${cursorBefore} · outbox 0 → 2\nchanged Alternative field ${changedFields[0]}\nparent lineage + Alternative lineage will travel together.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-alternative-edit-canary',tableName:'learning_alternatives',mutationKind:'upsert',actionId,mutationCount:2,companionTable:'card_learning_metadata'}}));
    }catch(e){state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-after-local-save',error:String(e?.message||e),summary:{wordId:TARGET_WID,blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'The local editor save remains local. No unsafe Canonical write was staged.',true);}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verifyForeground(detail){
    if(!active()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The compound outbox action is intentionally retained for retry. Do not make another Learning Metadata edit.',true);return;}
    let db=null;try{db=await openDb();const snap=await readVerify(db,state.active.parentRowKey,state.active.alternativeRowKey),cursorAfter=cursorValue(snap.meta,snap.cursor),parentOk=clean(snap.parent?.payloadHash)===state.active.parentHash,alternativeOk=clean(snap.alternative?.payloadHash)===state.active.alternativeHash,pass=snap.outbox.length===0&&parentOk&&alternativeOk&&cursorAfter>state.active.cursorBefore;
      state.report={format:'WLP_LEARNING_METADATA_ALTERNATIVE_REAL_EDIT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,cursorBefore:state.active.cursorBefore,cursorAfter,outboxAfter:snap.outbox.length,changedFields:clone(state.active.changedFields),blockingIssues:pass?0:1,pass},invariants:{realEditorSave:true,parentAndAlternativeSameAction:true,parentPayloadMatchesLocalLineage:parentOk,alternativePayloadMatchesLocalRevision:alternativeOk,noSituationWrite:true,noLinkWrite:true}};
      show(pass?`PASS · WID${TARGET_WID} real Alternative edit reached Canonical.`:'CHECK · Alternative real-edit transport verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${snap.outbox.length}\nparent payload match ${parentOk?'yes':'no'} · Alternative payload match ${alternativeOk?'yes':'no'}\nchanged Alternative field ${state.active.changedFields.join(', ')}`,!pass);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.',true);}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-learning-hooks-changed',()=>{void onLocalChanged();});
  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataAlternativeEditCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();