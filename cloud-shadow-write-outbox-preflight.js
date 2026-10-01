/* WLP v1.8.6.223 — Learning Write / Outbox Contract Preflight v1.
   Read-only. Models the first Review attention mutation as an immutable Authority-v2
   base plus a two-mutation local outbox overlay (learning_state patch + interaction
   learning_event append). No IndexedDB, localStorage, Cloud, or live WLP write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.223-learning-write-outbox-contract-preflight-v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const OUTBOX_STORE = 'sync_outbox';
  const META_KEY = 'authority_mirror';
  const CARD_NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const TARGET_CARD_ID = 'ea2f787b-41fe-5446-bbff-49c0c6ed73e2';
  const TARGET_WORD_ID = '2876';
  const EXPECTED = Object.freeze({
    candidateKey: 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283',
    headVersion: 2,
    migrationVersion: '3',
    manifestHash: 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3',
    canonicalRows: 21424,
    learningStateRows: 111,
    learningEventRows: 1150,
    firstSeen: '2026-09-26T21:44:15.400Z'
  });
  const state = { busy:false, report:null };

  function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function stableValue(value){
    if(Array.isArray(value)) return value.map(stableValue);
    if(value && typeof value === 'object'){
      const out={}; Object.keys(value).sort().forEach(key=>{ if(value[key] !== undefined) out[key]=stableValue(value[key]); }); return out;
    }
    return value;
  }
  function stableStringify(value){ return JSON.stringify(stableValue(value)); }
  function utf8Bytes(value){ return new TextEncoder().encode(String(value ?? '')); }
  async function digest(algorithm, bytes){ return new Uint8Array(await crypto.subtle.digest(algorithm, bytes)); }
  async function sha256(value){ const bytes=await digest('SHA-256',utf8Bytes(value)); return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join(''); }
  function uuidToBytes(value){
    const hex=String(value||'').replace(/-/g,'').toLowerCase(); if(!/^[0-9a-f]{32}$/.test(hex)) throw new Error('Invalid UUID namespace.');
    const out=new Uint8Array(16); for(let i=0;i<16;i++) out[i]=Number.parseInt(hex.slice(i*2,i*2+2),16); return out;
  }
  function bytesToUuid(bytes){ const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; }
  async function uuidV5(namespaceUuid,name){
    const ns=uuidToBytes(namespaceUuid), nb=utf8Bytes(name), input=new Uint8Array(ns.length+nb.length); input.set(ns); input.set(nb,ns.length);
    const hash=await digest('SHA-1',input), bytes=hash.slice(0,16); bytes[6]=(bytes[6]&0x0f)|0x50; bytes[8]=(bytes[8]&0x3f)|0x80; return bytesToUuid(bytes);
  }
  function requestPromise(request){ return new Promise((resolve,reject)=>{ request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.')); }); }
  function transactionDone(tx){ return new Promise((resolve,reject)=>{ tx.oncomplete=()=>resolve(); tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.')); tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.')); }); }
  async function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onsuccess=()=>{
        const db=req.result; const required=['cards','learning_state','learning_events',META_STORE,OUTBOX_STORE];
        const missing=required.filter(name=>!db.objectStoreNames.contains(name)); if(missing.length){db.close();reject(new Error(`Canonical mirror schema missing: ${missing.join(', ')}`));return;} resolve(db);
      };
      req.onerror=()=>reject(req.error||new Error('Could not open wlp-cloud-v1.'));
      req.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP page.'));
    });
  }
  async function getRow(db,store,rowKey){ const tx=db.transaction(store,'readonly'); const value=await requestPromise(tx.objectStore(store).get(rowKey)); await transactionDone(tx); return value||null; }
  async function countStore(db,store){ const tx=db.transaction(store,'readonly'); const count=await requestPromise(tx.objectStore(store).count()); await transactionDone(tx); return Number(count||0); }
  async function getMeta(db){ return getRow(db,META_STORE,META_KEY); }

  function nextLevel(level){ return level==='high'?'medium':level==='medium'?'light':level==='light'?'medium':'medium'; }
  function plusOneSecondIso(payload){
    const values=[payload?.updated_at,payload?.last_attention_updated_at,payload?.last_seen_at,payload?.last_reviewed_at].map(v=>Date.parse(String(v||''))).filter(Number.isFinite);
    const base=values.length?Math.max(...values):Date.parse('2026-10-01T00:00:00.000Z'); return new Date(base+1000).toISOString();
  }

  async function buildPlan(meta,stateRow,cardRow){
    const base=clone(stateRow.payload||{}), fromLevel=String(base.review_level||'').toLowerCase(), toLevel=nextLevel(fromLevel), simulatedAt=plusOneSecondIso(base), simulatedMs=Date.parse(simulatedAt);
    const basePayloadHash=await sha256(stableStringify(base));
    const stateIntent={
      kind:'review-attention-set', cardId:TARGET_CARD_ID, wordId:TARGET_WORD_ID, fromLevel, toLevel, simulatedAt,
      basePayloadHash, baseHeadVersion:Number(meta.headVersion||0), baseCandidateKey:String(meta.candidateKey||'')
    };
    const actionHash=await sha256(stableStringify(stateIntent));
    const actionId=`preflight-action:${actionHash}`;
    const stateMutationId=`mut:${await sha256(`state|${actionId}`)}`;
    const eventMutationId=`mut:${await sha256(`event|${actionId}`)}`;
    const eventId=await uuidV5(CARD_NAMESPACE_UUID,`event|interaction|${actionId}`);
    const changedFields=['known','review','review_level','last_attention_updated_at','revision','updated_at'];
    const patch={
      known:false, review:true, review_level:toLevel, last_attention_updated_at:simulatedAt,
      revision:Number(base.revision||0)+1, updated_at:simulatedAt
    };
    const stateMutation={
      mutationId:stateMutationId, schemaVersion:1, mutationKind:'patch', tableName:'learning_state', rowKey:TARGET_CARD_ID,
      baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},
      precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},
      changedFields, patch, deviceKey:meta.deviceKey||null, actionId, createdAt:simulatedAt, status:'pending'
    };
    stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={
      event_id:eventId, source_event_id:actionId, card_id:TARGET_CARD_ID, session_id:null, event_type:'attention_set', source_stream:'interaction',
      occurred_at:simulatedAt, completed_at:null, device_id:meta.deviceKey||null, legacy_word_id:Number(TARGET_WORD_ID), schema_version:1,
      payload:{timestamp:simulatedMs,action:'attention_set',wordId:TARGET_WORD_ID,source:'review-suggestion',level:toLevel,reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],fromLevel,suggested:true,suggestionPolicyVersion:'1.0.0',evidenceThrough:0},
      imported_at:null, supersedes_event_id:null
    };
    const eventPayloadHash=await sha256(stableStringify(eventPayload));
    const eventMutation={
      mutationId:eventMutationId, schemaVersion:1, mutationKind:'append', tableName:'learning_events', rowKey:eventId,
      baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},
      precondition:{rowMustBeAbsent:true}, payload:eventPayload, payloadHash:eventPayloadHash, deviceKey:meta.deviceKey||null, actionId, createdAt:simulatedAt, status:'pending'
    };
    eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    const overlayState={...base,...patch};
    return {actionId,simulatedAt,fromLevel,toLevel,basePayloadHash,stateMutation,eventMutation,overlayState,card:clone(cardRow?.payload||{})};
  }

  function setStatus(text,kind=''){ const el=$('write-outbox-preflight-status'); if(!el)return; el.textContent=text; el.className=`status-line${kind?` ${kind}`:''}`; }
  function render(report){
    state.report=report;
    $('write-outbox-preflight-result').textContent=report.summary.pass?'PASS':'CHECK';
    $('write-outbox-preflight-result').style.color=report.summary.pass?'#18794e':'#b42318';
    $('write-outbox-preflight-base').textContent=report.summary.baseMirrorVerified?'PASS':'CHECK';
    $('write-outbox-preflight-outbox').textContent=String(report.summary.outboxRowsBefore);
    $('write-outbox-preflight-mutations').textContent=String(report.summary.proposedMutations);
    $('write-outbox-preflight-overlay-state').textContent=String(report.summary.overlayLearningStateRows);
    $('write-outbox-preflight-overlay-events').textContent=String(report.summary.overlayLearningEventRows);
    $('write-outbox-preflight-conflicts').textContent=report.summary.conflictGuardsPresent?'PASS':'CHECK';
    $('write-outbox-preflight-repeat').textContent=report.summary.repeatablePlan?'PASS':'CHECK';
    $('write-outbox-preflight-blocking').textContent=String(report.summary.blockingIssues);
    $('write-outbox-preflight-action').textContent=report.plan.actionId||'—';
    $('write-outbox-preflight-state-id').textContent=report.plan.stateMutationId||'—';
    $('write-outbox-preflight-event-id').textContent=report.plan.eventMutationId||'—';
    const body=$('write-outbox-preflight-proof-body'); body.innerHTML='';
    report.checks.forEach(item=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${item.name}</td><td><strong>${item.pass?'PASS':'CHECK'}</strong></td><td>${item.evidence}</td>`; body.appendChild(tr); });
    const notes=$('write-outbox-preflight-notes'); notes.innerHTML='';
    [...report.issues.blocking,...report.issues.warnings].forEach(msg=>{ const li=document.createElement('li'); li.textContent=msg; notes.appendChild(li); });
    $('write-outbox-preflight-panel').classList.remove('hidden');
    $('export-write-outbox-preflight').disabled=false;
    setStatus(report.summary.pass
      ? `Write / Outbox contract preflight PASS · immutable Authority-v2 base preserved · 2 deterministic pending mutations model one Review attention action · no data written.`
      : `Write / Outbox preflight found ${report.summary.blockingIssues} blocker(s). No data was written.`,report.summary.pass?'success':'error');
  }

  async function run(){
    if(state.busy)return; state.busy=true; const button=$('run-write-outbox-preflight'); if(button)button.disabled=true; $('export-write-outbox-preflight').disabled=true; $('write-outbox-preflight-panel').classList.remove('hidden'); setStatus('Reading the Authority-v2 mirror and building a deterministic in-memory write / outbox overlay plan…','');
    let db=null;
    try{
      db=await openDb();
      const [meta,stateRow,cardRow,outboxBefore,stateCount,eventCount]=await Promise.all([
        getMeta(db),getRow(db,'learning_state',TARGET_CARD_ID),getRow(db,'cards',TARGET_CARD_ID),countStore(db,OUTBOX_STORE),countStore(db,'learning_state'),countStore(db,'learning_events')
      ]);
      const blocking=[]; const warnings=[];
      if(!meta) blocking.push('Authority mirror metadata is missing.');
      if(String(meta?.candidateKey||'')!==EXPECTED.candidateKey||Number(meta?.headVersion||0)!==EXPECTED.headVersion||String(meta?.migrationVersion||'')!==EXPECTED.migrationVersion||String(meta?.snapshotManifestHash||'')!==EXPECTED.manifestHash) blocking.push('Local mirror is not the exact ACTIVE Authority v2 base.');
      if(Number(meta?.canonicalRowCount||0)!==EXPECTED.canonicalRows) blocking.push(`Mirror metadata row count is ${meta?.canonicalRowCount??'unknown'}, expected ${EXPECTED.canonicalRows}.`);
      if(stateCount!==EXPECTED.learningStateRows) blocking.push(`learning_state count is ${stateCount}, expected ${EXPECTED.learningStateRows}.`);
      if(eventCount!==EXPECTED.learningEventRows) blocking.push(`learning_events count is ${eventCount}, expected ${EXPECTED.learningEventRows}.`);
      if(outboxBefore!==0) blocking.push(`sync_outbox is not empty (${outboxBefore} row(s)); first write transport must start from a clean outbox.`);
      if(!stateRow||!cardRow) blocking.push('WID 2876 Canonical Card / Learning State spot-check row is missing.');
      if(String(cardRow?.payload?.word_id??'')!==TARGET_WORD_ID) blocking.push(`Card ${TARGET_CARD_ID} does not resolve to WID ${TARGET_WORD_ID}.`);
      if(String(stateRow?.payload?.first_seen_at||'')!==EXPECTED.firstSeen) blocking.push('WID 2876 explicit first_seen_at is not the verified Authority-v2 value.');
      const computedBaseHash=stateRow?await sha256(stableStringify(stateRow.payload||{})):'';
      if(stateRow&&computedBaseHash!==String(stateRow.payloadHash||'')) blocking.push('WID 2876 base learning_state payload hash does not match the mirror row.');

      const plan=stateRow&&cardRow&&meta?await buildPlan(meta,stateRow,cardRow):null;
      const plan2=stateRow&&cardRow&&meta?await buildPlan(meta,stateRow,cardRow):null;
      const repeatable=Boolean(plan&&plan2&&stableStringify(plan)===stableStringify(plan2));
      const baseUnchanged=stateRow?await sha256(stableStringify(stateRow.payload||{}))===computedBaseHash:false;
      const stateMutation=plan?.stateMutation, eventMutation=plan?.eventMutation;
      const conflictGuardsPresent=Boolean(stateMutation?.precondition?.payloadHash&&stateMutation?.precondition?.fields&&eventMutation?.precondition?.rowMustBeAbsent===true);
      const firstSeenPreserved=Boolean(plan&&plan.overlayState.first_seen_at===stateRow.payload.first_seen_at);
      const statePatchScoped=Boolean(plan&&Object.keys(plan.stateMutation.patch).every(k=>['known','review','review_level','last_attention_updated_at','revision','updated_at'].includes(k))&&plan.stateMutation.patch.review===true);
      const eventAppendScoped=Boolean(plan&&plan.eventMutation.tableName==='learning_events'&&plan.eventMutation.payload.source_stream==='interaction'&&plan.eventMutation.payload.event_type==='attention_set'&&plan.eventMutation.payload.card_id===TARGET_CARD_ID);
      const twoMutations=Boolean(plan&&new Set([plan.stateMutation.mutationId,plan.eventMutation.mutationId]).size===2);
      const actionShared=Boolean(plan&&plan.stateMutation.actionId===plan.eventMutation.actionId&&plan.actionId===plan.stateMutation.actionId);

      if(!repeatable) blocking.push('In-memory mutation plan is not repeatable.');
      if(!baseUnchanged) blocking.push('Preflight altered the in-memory base payload unexpectedly.');
      if(!conflictGuardsPresent) blocking.push('Proposed outbox mutations do not carry sufficient conflict preconditions.');
      if(!firstSeenPreserved) blocking.push('Learning-state overlay would regress explicit first_seen_at.');
      if(!statePatchScoped) blocking.push('Learning-state mutation changes fields outside the intended Review attention write scope.');
      if(!eventAppendScoped) blocking.push('Interaction-event append does not map cleanly to Canonical learning_events.');
      if(!twoMutations||!actionShared) blocking.push('The proposed state patch and interaction append are not a single deduplicatable action pair.');

      const [outboxAfter,stateCountAfter,eventCountAfter,stateAfter]=await Promise.all([countStore(db,OUTBOX_STORE),countStore(db,'learning_state'),countStore(db,'learning_events'),getRow(db,'learning_state',TARGET_CARD_ID)]);
      const noWrites=outboxAfter===outboxBefore&&stateCountAfter===stateCount&&eventCountAfter===eventCount&&stableStringify(stateAfter)===stableStringify(stateRow);
      if(!noWrites) blocking.push('Read-only preflight changed IndexedDB state.');

      warnings.push('This step defines and tests the local write contract only. It does not enable Review write cutover, Cloud mutation upload, conflict resolution, or live sync.');
      warnings.push('The proposed architecture keeps the verified Authority-v2 mirror immutable and represents new local work in sync_outbox as an overlay until transport/acknowledgement is implemented.');
      warnings.push('Review must not switch to Canonical reads by default until its attention writes can enter this outbox/overlay path atomically; otherwise refreshed Review would ignore unsynced local changes.');

      const checks=[
        ['Exact Authority-v2 mirror base',Boolean(meta&&String(meta.candidateKey)===EXPECTED.candidateKey&&Number(meta.headVersion)===2),`${meta?.candidateKey||'(missing)'} · head ${meta?.headVersion??'?'}`],
        ['Clean sync_outbox start',outboxBefore===0,`${outboxBefore} row(s)`],
        ['WID 2876 base payload hash verified',Boolean(stateRow&&computedBaseHash===stateRow.payloadHash),computedBaseHash||'(missing)'],
        ['Review attention maps to scoped learning_state patch',statePatchScoped,plan?`${plan.fromLevel} → ${plan.toLevel} · ${plan.stateMutation.changedFields.join(', ')}`:'unavailable'],
        ['Review action maps to interaction learning_event append',eventAppendScoped,plan?`${plan.eventMutation.payload.event_id} · ${plan.eventMutation.payload.event_type}`:'unavailable'],
        ['Two mutations share one action identity',twoMutations&&actionShared,plan?.actionId||'unavailable'],
        ['Conflict guards prevent blind same-field overwrite',conflictGuardsPresent,stateMutation?`base payload ${stateMutation.precondition.payloadHash}`:'unavailable'],
        ['Explicit first_seen_at survives overlay',firstSeenPreserved,plan?.overlayState?.first_seen_at||'unavailable'],
        ['Immutable Canonical base remains unchanged',baseUnchanged&&noWrites,`state ${stateCountAfter} · events ${eventCountAfter} · outbox ${outboxAfter}`],
        ['Mutation plan repeatability',repeatable,repeatable?'same action/mutation IDs on rerun':'mismatch']
      ].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));

      const report={
        format:'WLP_CANONICAL_WRITE_OUTBOX_CONTRACT_PREFLIGHT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-local-write-outbox-overlay-contract-preflight',
        device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},
        authority:{candidateKey:meta?.candidateKey||null,headVersion:meta?.headVersion??null,migrationVersion:meta?.migrationVersion||null,snapshotManifestHash:meta?.snapshotManifestHash||null,canonicalRows:meta?.canonicalRowCount??null},
        summary:{baseMirrorVerified:checks[0].pass,outboxRowsBefore:outboxBefore,proposedMutations:plan?2:0,overlayLearningStateRows:stateCount,overlayLearningEventRows:eventCount+(plan?1:0),conflictGuardsPresent,repeatablePlan:repeatable,baseMirrorUntouched:noWrites,firstSeenPreserved,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},
        plan:plan?{actionId:plan.actionId,simulatedAt:plan.simulatedAt,wordId:TARGET_WORD_ID,cardId:TARGET_CARD_ID,fromLevel:plan.fromLevel,toLevel:plan.toLevel,stateMutationId:plan.stateMutation.mutationId,eventMutationId:plan.eventMutation.mutationId,stateMutationHash:plan.stateMutation.mutationHash,eventMutationHash:plan.eventMutation.mutationHash,basePayloadHash:plan.basePayloadHash,statePrecondition:clone(plan.stateMutation.precondition),eventPrecondition:clone(plan.eventMutation.precondition),statePatch:clone(plan.stateMutation.patch),eventPayloadHash:plan.eventMutation.payloadHash}: {},
        counts:{before:{learning_state:stateCount,learning_events:eventCount,sync_outbox:outboxBefore},projectedOverlay:{learning_state:stateCount,learning_events:eventCount+(plan?1:0),sync_outbox:outboxBefore+(plan?2:0)},afterReadOnlyVerification:{learning_state:stateCountAfter,learning_events:eventCountAfter,sync_outbox:outboxAfter}},
        checks,issues:{blocking,warnings},
        invariants:{noCloudWrites:true,noIndexedDbWrites:noWrites,noLocalStorageWrites:true,noLiveWlpWrites:true,authorityBaseImmutable:true,outboxUsedAsPendingOverlayLayer:true,noReviewReadCutover:true,noWriteTransportEnabled:true,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:firstSeenPreserved}
      };
      render(report);
    }catch(error){
      console.error(error); render({format:'WLP_CANONICAL_WRITE_OUTBOX_CONTRACT_PREFLIGHT',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'read-only-local-write-outbox-overlay-contract-preflight',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{},summary:{baseMirrorVerified:false,outboxRowsBefore:0,proposedMutations:0,overlayLearningStateRows:0,overlayLearningEventRows:0,conflictGuardsPresent:false,repeatablePlan:false,baseMirrorUntouched:true,firstSeenPreserved:false,blockingIssues:1,nextPhaseEligible:false,pass:false},plan:{},counts:{},checks:[],issues:{blocking:[error?.message||String(error)],warnings:[]},invariants:{noCloudWrites:true,noIndexedDbWrites:true,noLocalStorageWrites:true,noLiveWlpWrites:true}});
    }finally{ if(db)db.close(); state.busy=false; if(button)button.disabled=false; }
  }

  function exportReport(){ if(!state.report)return; const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`wlp-canonical-write-outbox-preflight-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); }
  $('run-write-outbox-preflight')?.addEventListener('click',run);
  $('export-write-outbox-preflight')?.addEventListener('click',exportReport);
  window.WLPCanonicalWriteOutboxPreflight=Object.freeze({version:1,getReport:()=>clone(state.report)});
})();
