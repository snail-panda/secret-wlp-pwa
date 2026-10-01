/* WLP v1.8.6.224 — Local Outbox Atomic Write + Overlay Round-trip v1.
   Diagnostic-only local write test. Writes exactly two deterministic diagnostic
   mutations to sync_outbox, verifies persistent read-back + idempotent retry +
   overlay materialization, then atomically removes them. Canonical base stores,
   localStorage, Cloud, and live WLP remain untouched. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.224-local-outbox-atomic-roundtrip-v1';
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
    const hex=String(value||'').replace(/-/g,'').toLowerCase();
    if(!/^[0-9a-f]{32}$/.test(hex)) throw new Error('Invalid UUID namespace.');
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
        const missing=required.filter(name=>!db.objectStoreNames.contains(name));
        if(missing.length){db.close();reject(new Error(`Canonical mirror schema missing: ${missing.join(', ')}`));return;}
        resolve(db);
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

  async function buildDiagnosticPlan(meta,stateRow){
    const base=clone(stateRow.payload||{}), fromLevel=String(base.review_level||'').toLowerCase(), toLevel=nextLevel(fromLevel), simulatedAt=plusOneSecondIso(base), simulatedMs=Date.parse(simulatedAt);
    const basePayloadHash=await sha256(stableStringify(base));
    const intent={
      diagnostic:true, kind:'review-attention-set', cardId:TARGET_CARD_ID, wordId:TARGET_WORD_ID, fromLevel, toLevel, simulatedAt,
      basePayloadHash, baseHeadVersion:Number(meta.headVersion||0), baseCandidateKey:String(meta.candidateKey||'')
    };
    const actionHash=await sha256(stableStringify(intent));
    const actionId=`diag-action:${actionHash}`;
    const stateMutationId=`diag-mut:${await sha256(`state|${actionId}`)}`;
    const eventMutationId=`diag-mut:${await sha256(`event|${actionId}`)}`;
    const eventId=await uuidV5(CARD_NAMESPACE_UUID,`diagnostic-event|interaction|${actionId}`);
    const patch={
      known:false, review:true, review_level:toLevel, last_attention_updated_at:simulatedAt,
      revision:Number(base.revision||0)+1, updated_at:simulatedAt
    };
    const shared={
      schemaVersion:1,
      baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},
      deviceKey:meta.deviceKey||null, actionId, createdAt:simulatedAt,
      diagnosticOnly:true, transportEligible:false, status:'diagnostic-pending'
    };
    const stateMutation={
      ...shared, mutationId:stateMutationId, mutationKind:'patch', tableName:'learning_state', rowKey:TARGET_CARD_ID,
      precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},
      changedFields:['known','review','review_level','last_attention_updated_at','revision','updated_at'], patch
    };
    stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={
      event_id:eventId, source_event_id:actionId, card_id:TARGET_CARD_ID, session_id:null, event_type:'attention_set', source_stream:'interaction',
      occurred_at:simulatedAt, completed_at:null, device_id:meta.deviceKey||null, legacy_word_id:Number(TARGET_WORD_ID), schema_version:1,
      payload:{timestamp:simulatedMs,action:'attention_set',wordId:TARGET_WORD_ID,source:'diagnostic-outbox-roundtrip',level:toLevel,reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],fromLevel,suggested:true,suggestionPolicyVersion:'1.0.0',evidenceThrough:0,diagnosticOnly:true},
      imported_at:null, supersedes_event_id:null
    };
    const eventPayloadHash=await sha256(stableStringify(eventPayload));
    const eventMutation={
      ...shared, mutationId:eventMutationId, mutationKind:'append', tableName:'learning_events', rowKey:eventId,
      precondition:{rowMustBeAbsent:true}, payload:eventPayload, payloadHash:eventPayloadHash
    };
    eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return {actionId,simulatedAt,fromLevel,toLevel,basePayloadHash,stateMutation,eventMutation,overlayState:{...base,...patch}};
  }

  async function enqueuePair(db,plan){
    const tx=db.transaction(OUTBOX_STORE,'readwrite');
    const store=tx.objectStore(OUTBOX_STORE);
    const [existingState,existingEvent]=await Promise.all([
      requestPromise(store.get(plan.stateMutation.mutationId)),
      requestPromise(store.get(plan.eventMutation.mutationId))
    ]);
    let wrote=0;
    if(existingState||existingEvent){
      if(!existingState||!existingEvent) throw new Error('Diagnostic outbox pair is partially present; refusing to repair silently.');
      if(stableStringify(existingState)!==stableStringify(plan.stateMutation)||stableStringify(existingEvent)!==stableStringify(plan.eventMutation)) throw new Error('Existing diagnostic mutation IDs do not match the deterministic plan.');
    }else{
      store.add(clone(plan.stateMutation));
      store.add(clone(plan.eventMutation));
      wrote=2;
    }
    await transactionDone(tx);
    return {wrote,idempotent:wrote===0};
  }

  async function cleanupPair(db,plan){
    const tx=db.transaction(OUTBOX_STORE,'readwrite');
    const store=tx.objectStore(OUTBOX_STORE);
    store.delete(plan.stateMutation.mutationId);
    store.delete(plan.eventMutation.mutationId);
    await transactionDone(tx);
  }

  function setStatus(text,kind=''){ const el=$('write-outbox-roundtrip-status'); if(!el)return; el.textContent=text; el.className=`status-line${kind?` ${kind}`:''}`; }
  function render(report){
    state.report=report;
    $('write-outbox-roundtrip-panel')?.classList.remove('hidden');
    const result=$('write-outbox-roundtrip-result'); if(result){ result.textContent=report.summary.pass?'PASS':'CHECK'; result.style.color=report.summary.pass?'#18794e':'#b42318'; }
    const map={
      'write-outbox-roundtrip-base':report.summary.baseMirrorVerified?'PASS':'CHECK',
      'write-outbox-roundtrip-before':report.summary.outboxRowsBefore,
      'write-outbox-roundtrip-written':report.summary.initialRowsWritten,
      'write-outbox-roundtrip-persisted':report.summary.persistedRowsVerified,
      'write-outbox-roundtrip-retry':report.summary.retryIdempotent?'PASS':'CHECK',
      'write-outbox-roundtrip-overlay':report.summary.overlayVerified?'PASS':'CHECK',
      'write-outbox-roundtrip-cleanup':report.summary.cleanupVerified?'PASS':'CHECK',
      'write-outbox-roundtrip-after':report.summary.outboxRowsAfter,
      'write-outbox-roundtrip-blocking':report.summary.blockingIssues
    };
    Object.entries(map).forEach(([id,value])=>{ const el=$(id); if(el)el.textContent=String(value); });
    const action=$('write-outbox-roundtrip-action'); if(action)action.textContent=report.plan?.actionId||'—';
    const stateId=$('write-outbox-roundtrip-state-id'); if(stateId)stateId.textContent=report.plan?.stateMutationId||'—';
    const eventId=$('write-outbox-roundtrip-event-id'); if(eventId)eventId.textContent=report.plan?.eventMutationId||'—';
    const body=$('write-outbox-roundtrip-proof-body'); if(body){ body.innerHTML=''; (report.checks||[]).forEach(item=>{ const tr=document.createElement('tr'); [item.name,item.pass?'PASS':'CHECK',item.evidence].forEach(text=>{ const td=document.createElement('td'); td.textContent=text; tr.appendChild(td); }); body.appendChild(tr); }); }
    const notes=$('write-outbox-roundtrip-notes'); if(notes){ notes.innerHTML=''; [...(report.issues?.blocking||[]),...(report.issues?.warnings||[])].forEach(text=>{ const li=document.createElement('li'); li.textContent=text; notes.appendChild(li); }); }
    const exportButton=$('export-write-outbox-roundtrip'); if(exportButton)exportButton.disabled=false;
    setStatus(report.summary.pass?'PASS · Diagnostic outbox pair persisted, overlaid, retried idempotently, and cleaned back to zero.':'CHECK · Inspect the blocking items before enabling any live write path.',report.summary.pass?'ok':'bad');
  }

  async function run(){
    if(state.busy) return; state.busy=true;
    const button=$('run-write-outbox-roundtrip'); if(button)button.disabled=true;
    const panel=$('write-outbox-roundtrip-panel'); if(panel)panel.classList.remove('hidden');
    setStatus('Running local outbox atomic round-trip…','');
    let db=null, plan=null, cleanupNeeded=false;
    try{
      db=await openDb();
      const blocking=[], warnings=[];
      const [meta,stateRow,stateCount,eventCount,outboxBefore]=await Promise.all([
        getMeta(db),getRow(db,'learning_state',TARGET_CARD_ID),countStore(db,'learning_state'),countStore(db,'learning_events'),countStore(db,OUTBOX_STORE)
      ]);
      const metaOk=Boolean(meta&&String(meta.candidateKey)===EXPECTED.candidateKey&&Number(meta.headVersion)===EXPECTED.headVersion&&String(meta.migrationVersion)===EXPECTED.migrationVersion&&String(meta.snapshotManifestHash)===EXPECTED.manifestHash&&Number(meta.canonicalRowCount)===EXPECTED.canonicalRows);
      if(!metaOk) blocking.push('Local Canonical mirror is not the exact ACTIVE Authority-v2 mirror.');
      if(stateCount!==EXPECTED.learningStateRows) blocking.push(`learning_state count is ${stateCount}, expected ${EXPECTED.learningStateRows}.`);
      if(eventCount!==EXPECTED.learningEventRows) blocking.push(`learning_events count is ${eventCount}, expected ${EXPECTED.learningEventRows}.`);
      if(outboxBefore!==0) blocking.push(`sync_outbox must start empty; found ${outboxBefore} row(s).`);
      if(!stateRow) blocking.push('WID 2876 Canonical learning_state row is missing.');
      const baseStateStable=stateRow?clone(stateRow):null;
      const computedBaseHash=stateRow?await sha256(stableStringify(stateRow.payload||{})):'';
      if(stateRow&&computedBaseHash!==String(stateRow.payloadHash||'')) blocking.push('WID 2876 base payload hash does not match the mirror row.');
      if(stateRow&&String(stateRow.payload?.first_seen_at||'')!==EXPECTED.firstSeen) blocking.push('WID 2876 explicit first_seen_at is not the verified Authority-v2 value.');
      if(blocking.length) throw new Error(blocking.join(' '));

      plan=await buildDiagnosticPlan(meta,stateRow);
      const firstWrite=await enqueuePair(db,plan); cleanupNeeded=true;
      const outboxAfterWrite=await countStore(db,OUTBOX_STORE);
      const [storedStateMutation,storedEventMutation]=await Promise.all([
        getRow(db,OUTBOX_STORE,plan.stateMutation.mutationId),getRow(db,OUTBOX_STORE,plan.eventMutation.mutationId)
      ]);
      const persistedRowsVerified=Number(Boolean(storedStateMutation))+Number(Boolean(storedEventMutation));
      const persistedExact=stableStringify(storedStateMutation)===stableStringify(plan.stateMutation)&&stableStringify(storedEventMutation)===stableStringify(plan.eventMutation);
      const retry=await enqueuePair(db,plan);
      const outboxAfterRetry=await countStore(db,OUTBOX_STORE);
      const overlayState={...(stateRow.payload||{}),...(storedStateMutation?.patch||{})};
      const overlayVerified=Boolean(
        storedStateMutation&&storedEventMutation&&
        overlayState.review_level===plan.toLevel&&
        overlayState.first_seen_at===stateRow.payload.first_seen_at&&
        storedEventMutation.payload?.card_id===TARGET_CARD_ID&&
        storedEventMutation.payload?.event_type==='attention_set'&&
        storedEventMutation.diagnosticOnly===true&&storedEventMutation.transportEligible===false&&
        storedStateMutation.diagnosticOnly===true&&storedStateMutation.transportEligible===false
      );
      const baseDuringState=await getRow(db,'learning_state',TARGET_CARD_ID);
      const [stateCountDuring,eventCountDuring]=await Promise.all([countStore(db,'learning_state'),countStore(db,'learning_events')]);
      const baseUntouchedDuring=stableStringify(baseDuringState)===stableStringify(baseStateStable)&&stateCountDuring===stateCount&&eventCountDuring===eventCount;

      await cleanupPair(db,plan); cleanupNeeded=false;
      const outboxAfter=await countStore(db,OUTBOX_STORE);
      const [stateAfter,stateCountAfter,eventCountAfter]=await Promise.all([getRow(db,'learning_state',TARGET_CARD_ID),countStore(db,'learning_state'),countStore(db,'learning_events')]);
      const cleanupVerified=outboxAfter===0;
      const baseUntouchedAfter=stableStringify(stateAfter)===stableStringify(baseStateStable)&&stateCountAfter===stateCount&&eventCountAfter===eventCount;

      if(firstWrite.wrote!==2) blocking.push(`Initial diagnostic enqueue wrote ${firstWrite.wrote} rows instead of 2.`);
      if(outboxAfterWrite!==2) blocking.push(`sync_outbox count after initial enqueue is ${outboxAfterWrite}, expected 2.`);
      if(persistedRowsVerified!==2||!persistedExact) blocking.push('Persisted diagnostic outbox rows do not round-trip exactly.');
      if(!retry.idempotent||retry.wrote!==0||outboxAfterRetry!==2) blocking.push('Same diagnostic enqueue retry was not idempotent.');
      if(!overlayVerified) blocking.push('Outbox overlay materialization did not reproduce the intended Review attention action safely.');
      if(!baseUntouchedDuring||!baseUntouchedAfter) blocking.push('Canonical base stores changed during the diagnostic outbox round-trip.');
      if(!cleanupVerified) blocking.push(`Diagnostic cleanup left ${outboxAfter} sync_outbox row(s).`);

      const checks=[
        ['Exact Authority-v2 mirror base',metaOk,`${meta.candidateKey} · head ${meta.headVersion}`],
        ['Clean sync_outbox start',outboxBefore===0,`${outboxBefore} row(s)`],
        ['Atomic diagnostic pair inserted',firstWrite.wrote===2&&outboxAfterWrite===2,`${firstWrite.wrote} write(s) · ${outboxAfterWrite} row(s)`],
        ['Persistent read-back matches deterministic envelopes',persistedRowsVerified===2&&persistedExact,`${persistedRowsVerified}/2 exact`],
        ['Same pair retry is idempotent',retry.idempotent&&retry.wrote===0&&outboxAfterRetry===2,`writes=${retry.wrote} · rows=${outboxAfterRetry}`],
        ['Overlay reproduces intended attention change',overlayVerified,`${plan.fromLevel} → ${plan.toLevel} · firstSeen preserved`],
        ['Diagnostic rows are transport-ineligible',Boolean(storedStateMutation?.transportEligible===false&&storedEventMutation?.transportEligible===false),'transportEligible=false on both'],
        ['Canonical base stays immutable',baseUntouchedDuring&&baseUntouchedAfter,`state ${stateCountAfter} · events ${eventCountAfter}`],
        ['Diagnostic cleanup returns outbox to zero',cleanupVerified,`${outboxAfter} row(s)`]
      ].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));

      warnings.push('This is the first real local write to wlp-cloud-v1, but only to sync_outbox and only with diagnostic, transport-ineligible rows that are removed before PASS.');
      warnings.push('No Review UI write path is enabled yet. No Cloud mutation transport, acknowledgement, or conflict resolution is enabled yet.');
      warnings.push('The verified Authority-v2 Canonical base remains immutable; future live user writes must enter sync_outbox first and be read through an overlay until acknowledged.');

      const report={
        format:'WLP_CANONICAL_LOCAL_OUTBOX_ATOMIC_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'diagnostic-indexeddb-outbox-write-read-retry-overlay-cleanup',
        device:{deviceKey:meta.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},
        authority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,migrationVersion:meta.migrationVersion,snapshotManifestHash:meta.snapshotManifestHash,canonicalRows:meta.canonicalRowCount},
        summary:{baseMirrorVerified:metaOk,outboxRowsBefore:outboxBefore,initialRowsWritten:firstWrite.wrote,persistedRowsVerified,retryIdempotent:retry.idempotent,overlayVerified,cleanupVerified,outboxRowsAfter:outboxAfter,baseMirrorUntouched:baseUntouchedDuring&&baseUntouchedAfter,firstSeenPreserved:overlayState.first_seen_at===stateRow.payload.first_seen_at,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},
        plan:{actionId:plan.actionId,wordId:TARGET_WORD_ID,cardId:TARGET_CARD_ID,fromLevel:plan.fromLevel,toLevel:plan.toLevel,stateMutationId:plan.stateMutation.mutationId,eventMutationId:plan.eventMutation.mutationId,basePayloadHash:plan.basePayloadHash,stateMutationHash:plan.stateMutation.mutationHash,eventMutationHash:plan.eventMutation.mutationHash,diagnosticOnly:true,transportEligible:false},
        counts:{before:{learning_state:stateCount,learning_events:eventCount,sync_outbox:outboxBefore},afterInitialWrite:{learning_state:stateCountDuring,learning_events:eventCountDuring,sync_outbox:outboxAfterWrite},afterRetry:{sync_outbox:outboxAfterRetry},afterCleanup:{learning_state:stateCountAfter,learning_events:eventCountAfter,sync_outbox:outboxAfter}},
        overlay:{reviewLevel:overlayState.review_level,revision:overlayState.revision,firstSeenAt:overlayState.first_seen_at,eventType:storedEventMutation?.payload?.event_type||null,eventRowKey:storedEventMutation?.rowKey||null},
        checks,issues:{blocking,warnings},
        invariants:{cloudWrites:false,localStorageWrites:false,liveWlpWrites:false,indexedDbWritesRestrictedToSyncOutbox:true,diagnosticRowsTransportIneligible:true,diagnosticCleanupComplete:cleanupVerified,authorityBaseImmutable:baseUntouchedDuring&&baseUntouchedAfter,noReviewWriteCutover:true,noWriteTransportEnabled:true,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:overlayState.first_seen_at===stateRow.payload.first_seen_at}
      };
      render(report);
    }catch(error){
      const message=error?.message||String(error);
      try{ if(db&&plan&&cleanupNeeded) await cleanupPair(db,plan); }catch(cleanupError){ console.error('Diagnostic cleanup failed',cleanupError); }
      console.error(error);
      render({format:'WLP_CANONICAL_LOCAL_OUTBOX_ATOMIC_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'diagnostic-indexeddb-outbox-write-read-retry-overlay-cleanup',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{},summary:{baseMirrorVerified:false,outboxRowsBefore:0,initialRowsWritten:0,persistedRowsVerified:0,retryIdempotent:false,overlayVerified:false,cleanupVerified:false,outboxRowsAfter:-1,baseMirrorUntouched:true,firstSeenPreserved:false,blockingIssues:1,nextPhaseEligible:false,pass:false},plan:{},counts:{},overlay:{},checks:[],issues:{blocking:[message],warnings:['If a diagnostic write started before failure, the script attempted best-effort cleanup. Re-run only after confirming sync_outbox is empty.']},invariants:{cloudWrites:false,localStorageWrites:false,liveWlpWrites:false,noReviewWriteCutover:true,noWriteTransportEnabled:true}});
    }finally{ if(db)db.close(); state.busy=false; if(button)button.disabled=false; }
  }

  function exportReport(){
    if(!state.report)return;
    const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=`wlp-canonical-local-outbox-roundtrip-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0);
  }

  $('run-write-outbox-roundtrip')?.addEventListener('click',run);
  $('export-write-outbox-roundtrip')?.addEventListener('click',exportReport);
  window.WLPCanonicalLocalOutboxRoundtrip=Object.freeze({version:1,getReport:()=>clone(state.report)});
})();
