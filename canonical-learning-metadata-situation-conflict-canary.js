/* WLP v1.8.6.368 — Situation 3 local-newer / same-child branch-conflict canary.
   Query:
     ?wlpLearningMetadataSituationConflictCanary=local
     ?wlpLearningMetadataSituationConflictCanary=remote
     ?wlpLearningMetadataSituationConflictCanary=resolve
     ?wlpLearningMetadataSituationConflictCanary=restore
   WID5578 only. No production behavior is enabled by this file without the query. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.370-learning-metadata-situation-conflict-lock-v1';
  const FLAG='wlpLearningMetadataSituationConflictCanary';
  const TARGET_WID='5578';
  const LOCAL_TITLE='Conflict local test';
  const REMOTE_TITLE='Conflict remote test';
  const TARGET_ANCHOR_PREFIX='Someone is reacting with far more agitation or emotional intensity than the immediate situation seems to call for.';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',METADATA_STORE='card_learning_metadata',SITUATION_STORE='learning_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,button:null,mode:'',busy:false,prepared:null,active:null};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uuid=()=>crypto.randomUUID();
  const makeId=p=>`${p}-${uuid()}`;
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});}
  const mode=()=>clean(new URLSearchParams(location.search).get(FLAG)).toLowerCase();
  const enabled=()=>['local','remote','resolve','restore','diagnose'].includes(mode());
  const targetWid=()=>clean(new URLSearchParams(location.search).get('wid'));
  function payload(w){return w&&typeof w==='object'&&w.payload&&typeof w.payload==='object'?w.payload:{};}
  const cursorValue=(meta,cursor)=>Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursor?.lastSyncCursor||0));

  function makePanel(){
    if(state.panel||!enabled())return;
    const p=document.createElement('section');p.id='wlp-learning-metadata-situation-conflict-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100030;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(850px,calc(100vw - 20px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation 3 conflict-protection canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><button type="button" data-action style="display:none;margin:10px auto 0;padding:8px 14px;border:1px solid rgba(31,55,39,.25);border-radius:999px;background:#edf6ef;color:#1c5137;font:700 13px system-ui;cursor:pointer"></button>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');state.button=p.querySelector('[data-action]');
    state.button.addEventListener('click',()=>{void runAction();});
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function action(label,visible=true){makePanel();state.button.textContent=label;state.button.style.display=visible?'inline-block':'none';}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const needed=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE].filter(x=>!db.objectStoreNames.contains(x));if(needed.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${needed.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function readSnapshot(db){
    const stores=[META_STORE,OUTBOX_STORE,CARD_STORE,METADATA_STORE,SITUATION_STORE],tx=db.transaction(stores,'readonly'),done=txDone(tx);
    const m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),c=tx.objectStore(CARD_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(c.getAll()),req(md.getAll()),req(s.getAll())]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],cards:values[3]||[],metadataRows:values[4]||[],situationRows:values[5]||[]};
  }
  async function readVerify(db,parentKey,situationKey){
    const tx=db.transaction([META_STORE,OUTBOX_STORE,METADATA_STORE,SITUATION_STORE],'readonly'),done=txDone(tx),m=tx.objectStore(META_STORE),o=tx.objectStore(OUTBOX_STORE),md=tx.objectStore(METADATA_STORE),s=tx.objectStore(SITUATION_STORE);
    const values=await Promise.all([req(m.get(META_KEY)),req(m.get(CURSOR_KEY)),req(o.getAll()),req(md.get(parentKey)),req(s.get(situationKey))]);await done;
    return{meta:values[0]||null,cursor:values[1]||null,outbox:Array.isArray(values[2])?values[2]:[],parent:values[3]||null,situation:values[4]||null};
  }
  async function addOutboxRows(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(OUTBOX_STORE);rows.forEach(row=>store.add(clone(row)));await done;}

  function api(){const a=window.WLPLearningHooks;if(!a?.STORAGE_KEY||!a?.getRecord||!a?.deviceId)throw new Error('Learning Metadata v2 engine is unavailable.');return a;}
  function rawStore(){const a=api();const raw=localStorage.getItem(a.STORAGE_KEY);const store=raw?JSON.parse(raw):null;if(!store?.records||typeof store.records!=='object')throw new Error('Learning Metadata local store is unavailable.');return store;}
  function localRecord(){const r=api().getRecord(`wid:${TARGET_WID}`);if(!r)throw new Error(`Local Learning Metadata WID${TARGET_WID} is missing.`);return clone(r);}
  function targetSituation(record){
    const rows=Array.isArray(record?.content?.situations)?record.content.situations:[];
    const matches=rows.filter(s=>!clean(s?.deletedAt)&&clean(s?.anchor).startsWith(TARGET_ANCHOR_PREFIX));
    if(matches.length!==1)throw new Error(`Expected exactly one active Situation 3 target; found ${matches.length}.`);
    return matches[0];
  }
  function situationSnapshot(s){return{versionId:clean(s?.versionId),parentVersionId:clean(s?.parentVersionId),revision:Math.max(1,Number(s?.revision)||1),changedAt:clean(s?.updatedAt),changedByDevice:clean(s?.updatedByDevice),status:clean(s?.status)||'provisional',deletedAt:clean(s?.deletedAt),title:clean(s?.title),anchor:clean(s?.anchor),communicativeNeed:clean(s?.communicativeNeed)};}
  function recordSnapshot(r){return{versionId:clean(r?.versionId),parentVersionId:clean(r?.parentVersionId),revision:Math.max(1,Number(r?.revision)||1),changedAt:clean(r?.updatedAt),changedByDevice:clean(r?.updatedByDevice),status:clean(r?.status)||'provisional',deletedAt:clean(r?.deletedAt),content:clone(r?.content||{})};}

  function writeLocalTitle(expectedTitle,nextTitle){
    const a=api(),store=rawStore(),key=`wid:${TARGET_WID}`,current=clone(store.records[key]);if(!current)throw new Error('WID5578 raw local record is missing.');
    const target=targetSituation(current);if(clean(target.title)!==clean(expectedTitle))throw new Error(`Situation 3 title is "${clean(target.title)}", expected "${clean(expectedTitle)}".`);
    const now=new Date().toISOString(),device=a.deviceId(),oldTarget=clone(target),oldParent=clone(current);
    target.revision=Math.max(1,Number(target.revision)||1)+1;target.parentVersionId=clean(target.versionId);target.versionId=makeId('sitver');target.updatedAt=now;target.updatedByDevice=device;target.deletedAt='';target.title=nextTitle;target.history=[...(Array.isArray(target.history)?target.history:[]),situationSnapshot(oldTarget)];
    current.revision=Math.max(1,Number(current.revision)||1)+1;current.parentVersionId=clean(current.versionId);current.versionId=makeId('ver');current.updatedAt=now;current.updatedByDevice=device;current.deletedAt='';current.history=[...(Array.isArray(current.history)?current.history:[]),recordSnapshot(oldParent)];
    store.records[key]=current;store.updatedAt=now;localStorage.setItem(a.STORAGE_KEY,JSON.stringify(store,null,2));
    return clone(a.getRecord(key));
  }

  function resolveCanonical(snap){
    if(!snap.meta||clean(snap.meta.candidateKey)!==BASE.candidateKey||Number(snap.meta.headVersion||0)!==BASE.headVersion||clean(snap.meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Conflict canary requires ACTIVE Authority v3.');
    const card=snap.cards.find(w=>clean(payload(w).legacy_key)===`wid:${TARGET_WID}`);if(!card)throw new Error(`Canonical WID${TARGET_WID} card is missing.`);const cardId=clean(card.rowKey||payload(card).card_id);
    const parent=snap.metadataRows.find(w=>clean(payload(w).card_id)===cardId&&!clean(payload(w).deleted_at));if(!parent)throw new Error('Canonical parent is missing.');
    const situation=snap.situationRows.find(w=>clean(payload(w).card_id)===cardId&&!Boolean(w?.tombstone)&&!clean(payload(w).deleted_at)&&clean(payload(w).anchor).startsWith(TARGET_ANCHOR_PREFIX));if(!situation)throw new Error('Canonical active Situation 3 is missing.');
    return{cardId,parent,situation,parentRowKey:clean(parent.rowKey||payload(parent).card_id),situationRowKey:clean(situation.rowKey||payload(situation).situation_id)};
  }
  function parentPayload(base,record,cardId){const c=record?.content||{};return{...clone(base),card_id:cardId,metadata_id:clean(record.metadataId)||null,entry_type:clean(c.entryType),sense_hook:clean(c.senseHook),memory_hook:clean(c.memoryHook),status:clean(record.status)||null,revision:Number(record.revision)||1,version_id:clean(record.versionId)||null,parent_version_id:clean(record.parentVersionId)||null,created_at:clean(record.createdAt)||null,updated_at:clean(record.updatedAt)||null,created_by_device:clean(record.createdByDevice)||null,updated_by_device:clean(record.updatedByDevice)||null,deleted_at:clean(record.deletedAt)||null,source_history:Array.isArray(record.history)?clone(record.history):[]};}
  function situationPayload(base,s,cardId){return{...clone(base),card_id:cardId,source_situation_id:clean(s.situationId)||null,status:clean(s.status)||null,revision:Number(s.revision)||1,version_id:clean(s.versionId)||null,parent_version_id:clean(s.parentVersionId)||null,created_at:clean(s.createdAt)||null,updated_at:clean(s.updatedAt)||null,created_by_device:clean(s.createdByDevice)||clean(base?.created_by_device)||null,updated_by_device:clean(s.updatedByDevice)||null,deleted_at:clean(s.deletedAt)||null,title:clean(s.title),anchor:clean(s.anchor),communicative_need:clean(s.communicativeNeed),source_history:Array.isArray(s.history)?clone(s.history):[]};}

  function exactLocalCanonical(local,canonical){
    const cp=payload(canonical.parent),cs=payload(canonical.situation),ls=targetSituation(local);
    return clean(local.versionId)===clean(cp.version_id)&&Number(local.revision||0)===Number(cp.revision||0)&&clean(ls.versionId)===clean(cs.version_id)&&Number(ls.revision||0)===Number(cs.revision||0)&&clean(ls.title)===clean(cs.title)&&clean(ls.anchor)===clean(cs.anchor)&&clean(ls.communicativeNeed)===clean(cs.communicative_need);
  }

  async function prepare(){
    if(!enabled())return;state.mode=mode();makePanel();
    if(targetWid()!==TARGET_WID){show(`BLOCKED · Open WID${TARGET_WID} for this canary.`,false,'No data changed.');return;}
    let db=null;
    try{
      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty; found ${snap.outbox.length}.`);
      const local=localRecord(),canonical=resolveCanonical(snap),cursor=cursorValue(snap.meta,snap.cursor),lt=targetSituation(local),ct=payload(canonical.situation);
      if(state.mode==='local'){
        if(!exactLocalCanonical(local,canonical)||clean(lt.title)!=='')throw new Error('Local-only branch requires PC/iPhone baseline alignment with blank Situation 3 title.');
        state.prepared={cursor,canonical,local};show('READY · Create the iPhone local-only descendant.',true,`cursor ${cursor} · outbox 0\nSituation 3 title: blank → "${LOCAL_TITLE}"\nThis writes localStorage only: no event, no outbox, no Cloud write.`);action('Create local-only branch');
      }else if(state.mode==='remote'){
        if(!exactLocalCanonical(local,canonical)||clean(lt.title)!=='')throw new Error('Remote branch requires the PC baseline aligned with blank Situation 3 title.');
        state.prepared={cursor,canonical,local};show('READY · Create the PC Canonical branch.',true,`cursor ${cursor} · outbox 0\nSituation 3 title: blank → "${REMOTE_TITLE}"\nStages exactly parent + Situation 3.`);action('Create Canonical branch');
      }else if(state.mode==='restore'){
        if(!exactLocalCanonical(local,canonical)||clean(lt.title)!==REMOTE_TITLE||clean(ct.title)!==REMOTE_TITLE)throw new Error('Baseline restore requires PC aligned with the Canonical remote-test branch.');
        state.prepared={cursor,canonical,local};show('READY · Restore Situation 3 title to the original blank value.',true,`cursor ${cursor} · outbox 0\nSituation 3 title: "${REMOTE_TITLE}" → blank\nStages exactly parent + Situation 3.`);action('Restore baseline title');
      }else if(state.mode==='diagnose'){
        const lp=payload(canonical.parent);
        const parentRelation =
          clean(local.versionId)===clean(lp.version_id) ? 'same-version' :
          clean(local.parentVersionId)===clean(lp.version_id) ? 'local-descends-from-canonical' :
          clean(lp.parent_version_id)===clean(local.versionId) ? 'canonical-descends-from-local' :
          'diverged';
        const childRelation =
          clean(lt.versionId)===clean(ct.version_id) ? 'same-version' :
          clean(lt.parentVersionId)===clean(ct.version_id) ? 'local-descends-from-canonical' :
          clean(ct.parent_version_id)===clean(lt.versionId) ? 'canonical-descends-from-local' :
          'diverged';
        show('DIAGNOSTIC · Read-only conflict state captured.',true,
          `cursor ${cursor} · outbox ${snap.outbox.length}\n`+
          `LOCAL title: "${clean(lt.title)}"\nCANONICAL title: "${clean(ct.title)}"\n`+
          `parent relation: ${parentRelation}\nchild relation: ${childRelation}\n`+
          `local parent rev ${Number(local.revision||0)} · canonical parent rev ${Number(lp.revision||0)}\n`+
          `local child rev ${Number(lt.revision||0)} · canonical child rev ${Number(ct.revision||0)}\n`+
          `conflict lock: ${api().getConflictLock?.(`wid:${TARGET_WID}`)?'present':'absent'}\n`+
          `No data changed.`);
        action('',false);
      }else if(state.mode==='resolve'){
        if(clean(lt.title)!==LOCAL_TITLE||clean(ct.title)!==REMOTE_TITLE)throw new Error('Explicit resolution requires local conflict title and Canonical remote-test title.');
        state.prepared={cursor,canonical,local};show('READY · Explicitly resolve the iPhone branch to Canonical.',true,`cursor ${cursor} · outbox 0\nlocal "${LOCAL_TITLE}" → Canonical "${REMOTE_TITLE}"\nNo Cloud write. This is an explicit conflict resolution, not auto-merge.`);action('Resolve local to Canonical');
      }
    }catch(e){show(`BLOCKED · ${String(e?.message||e)}`,false,'No data changed.');action('',false);}finally{try{db?.close();}catch(_){}}
  }

  async function stageTitle(expectedTitle,nextTitle){
    let db=null;
    try{
      db=await openDb();const snap=await readSnapshot(db);if(snap.outbox.length)throw new Error(`sync_outbox must be empty; found ${snap.outbox.length}.`);const canonical=resolveCanonical(snap),localBefore=localRecord();
      if(!exactLocalCanonical(localBefore,canonical)||clean(targetSituation(localBefore).title)!==expectedTitle)throw new Error('Local/Canonical baseline changed after READY.');
      const parentBaseHash=clean(canonical.parent.payloadHash)||await sha256(stableStringify(payload(canonical.parent))),situationBaseHash=clean(canonical.situation.payloadHash)||await sha256(stableStringify(payload(canonical.situation))),after=writeLocalTitle(expectedTitle,nextTitle),nextSituation=targetSituation(after);
      const pp=parentPayload(payload(canonical.parent),after,canonical.cardId),sp=situationPayload(payload(canonical.situation),nextSituation,canonical.cardId),ph=await sha256(stableStringify(pp)),sh=await sha256(stableStringify(sp)),actionId=uuid(),createdAt=new Date().toISOString(),baseAuthority={candidateKey:snap.meta.candidateKey,headVersion:Number(snap.meta.headVersion||0),snapshotManifestHash:snap.meta.snapshotManifestHash};
      const common={schemaVersion:1,baseAuthority,deviceKey:snap.meta.deviceKey||null,actionId,createdAt,diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationConflictCanary:true,transportEligible:true,status:'pending'};
      const parentMutation={...common,mutationId:uuid(),mutationKind:'upsert',tableName:'card_learning_metadata',rowKey:canonical.parentRowKey,precondition:{payloadHash:parentBaseHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history'],payload:pp,payloadHash:ph};
      const situationMutation={...common,mutationId:uuid(),mutationKind:'upsert',tableName:'learning_situations',rowKey:canonical.situationRowKey,precondition:{payloadHash:situationBaseHash},changedFields:['revision','version_id','parent_version_id','updated_at','updated_by_device','source_history','title'],payload:sp,payloadHash:sh};
      for(const m of [parentMutation,situationMutation])m.mutationHash=await sha256(stableStringify(m));
      await addOutboxRows(db,[parentMutation,situationMutation]);state.active={actionId,cursorBefore:cursorValue(snap.meta,snap.cursor),parentRowKey:canonical.parentRowKey,situationRowKey:canonical.situationRowKey,parentHash:ph,situationHash:sh,nextTitle};
      show(`PENDING · Situation 3 "${nextTitle||'(blank)'}" branch staged atomically.`,true,`cursor ${state.active.cursorBefore} · outbox 0 → 2\nparent + same Situation 3 child\nDo not stage another edit.`);action('',false);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-conflict-canary',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:2,companionTable:'card_learning_metadata'}}));
    }finally{try{db?.close();}catch(_){}}
  }

  function resolveLocalToCanonical(){
    const prepared=state.prepared,a=api(),canonical=prepared.canonical,ct=payload(canonical.situation),current=localRecord(),target=targetSituation(current);
    if(clean(target.title)!==LOCAL_TITLE||clean(ct.title)!==REMOTE_TITLE)throw new Error('Conflict state changed before explicit resolution.');
    const incomingKey=`wid:${TARGET_WID}`;
    const incomingRecord={
      metadataId:clean(payload(canonical.parent).metadata_id),
      entryKey:incomingKey,
      entryKind:'master',
      wordId:TARGET_WID,
      localDraftId:'',
      status:clean(payload(canonical.parent).status)||'provisional',
      revision:Number(payload(canonical.parent).revision)||1,
      versionId:clean(payload(canonical.parent).version_id),
      parentVersionId:clean(payload(canonical.parent).parent_version_id),
      createdAt:clean(payload(canonical.parent).created_at),
      updatedAt:clean(payload(canonical.parent).updated_at),
      createdByDevice:clean(payload(canonical.parent).created_by_device),
      updatedByDevice:clean(payload(canonical.parent).updated_by_device),
      deletedAt:clean(payload(canonical.parent).deleted_at),
      content:clone(current.content||{}),
      history:Array.isArray(payload(canonical.parent).source_history)?clone(payload(canonical.parent).source_history):[]
    };
    const incomingTarget=targetSituation(incomingRecord);
    incomingTarget.status=clean(ct.status)||incomingTarget.status;
    incomingTarget.revision=Number(ct.revision)||incomingTarget.revision;
    incomingTarget.versionId=clean(ct.version_id);
    incomingTarget.parentVersionId=clean(ct.parent_version_id);
    incomingTarget.createdAt=clean(ct.created_at)||incomingTarget.createdAt;
    incomingTarget.updatedAt=clean(ct.updated_at)||incomingTarget.updatedAt;
    incomingTarget.createdByDevice=clean(ct.created_by_device)||incomingTarget.createdByDevice;
    incomingTarget.updatedByDevice=clean(ct.updated_by_device)||incomingTarget.updatedByDevice;
    incomingTarget.deletedAt=clean(ct.deleted_at);
    incomingTarget.title=clean(ct.title);
    incomingTarget.anchor=clean(ct.anchor);
    incomingTarget.communicativeNeed=clean(ct.communicative_need);
    incomingTarget.history=Array.isArray(ct.source_history)?clone(ct.source_history):[];

    if(!a.applyConflictResolution)throw new Error('Shared Learning Metadata conflict-resolution API is unavailable.');
    a.applyConflictResolution(incomingKey,incomingRecord);
    const after=localRecord();
    if(!exactLocalCanonical(after,canonical))throw new Error('Explicit local→Canonical resolution verification failed.');
    show('PASS · iPhone local conflict branch explicitly resolved to Canonical.',true,`local "${LOCAL_TITLE}" → Canonical "${REMOTE_TITLE}"\\noutbox 0 · Cloud writes 0 · conflict lock cleared\\nThe production receiver did not silently choose either branch.`);action('',false);
  }

  async function runAction(){
    if(state.busy)return;state.busy=true;action('',false);
    try{
      if(state.mode==='local'){
        const db=await openDb();try{const before=await readSnapshot(db),after=writeLocalTitle('',LOCAL_TITLE),again=await readSnapshot(db);if(again.outbox.length!==0||cursorValue(before.meta,before.cursor)!==cursorValue(again.meta,again.cursor))throw new Error('Local-only branch unexpectedly touched Canonical sync state.');if(clean(targetSituation(after).title)!==LOCAL_TITLE)throw new Error('Local-only title verification failed.');show('PASS · Local-only Situation 3 descendant created.',true,`title "${LOCAL_TITLE}"\noutbox 0 · Canonical cursor unchanged at ${cursorValue(again.meta,again.cursor)}\nNext: use the production receiver audit to verify local-newer is preserved.`);}finally{db.close();}
      }else if(state.mode==='remote')await stageTitle('',REMOTE_TITLE);
      else if(state.mode==='restore')await stageTitle(REMOTE_TITLE,'');
      else if(state.mode==='resolve')resolveLocalToCanonical();
    }catch(e){show(`BLOCKED · ${String(e?.message||e)}`,false,'No second action should be attempted.');}
    finally{state.busy=false;}
  }

  async function verifyForeground(detail){
    if(!enabled()||!state.active)return;const d=detail&&typeof detail==='object'?detail:{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The two-row action is retained for retry. Do not make another edit.');return;}
    let db=null;try{
      db=await openDb();const snap=await readVerify(db,state.active.parentRowKey,state.active.situationRowKey),cursorAfter=cursorValue(snap.meta,snap.cursor),parentOk=clean(snap.parent?.payloadHash)===state.active.parentHash,situationOk=clean(snap.situation?.payloadHash)===state.active.situationHash&&clean(payload(snap.situation).title)===state.active.nextTitle,pass=snap.outbox.length===0&&parentOk&&situationOk&&cursorAfter>=state.active.cursorBefore+2;
      show(pass?`PASS · Canonical Situation 3 branch "${state.active.nextTitle||'(blank)'}" applied.`:'CHECK · Canonical branch verification is incomplete.',pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${snap.outbox.length}\nparent ${parentOk?'yes':'no'} · same child ${situationOk?'yes':'no'}`);if(pass)state.active=null;
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.');}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verifyForeground(e.detail);});
  window.WLPCanonicalLearningMetadataSituationConflictCanary=Object.freeze({version:1,prepare});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
