/* WLP v1.8.6.225 — Storage Facade Pending Outbox Overlay Round-trip v1.
   Diagnostic-only local write test. Inserts one guarded learning_state patch plus
   one interaction learning_event append into sync_outbox, verifies that the real
   Storage Compatibility Facade overlays them on reads while the Canonical base
   stays immutable, then cleans the diagnostic rows and verifies the facade returns
   to the exact base view. No Cloud, localStorage, or live Review write occurs. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.225-storage-facade-outbox-overlay-roundtrip-v1';
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
    firstSeenMs: 1790459055400,
    firstSeenIso: '2026-09-26T21:44:15.400Z'
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

  function plusTwoSecondsIso(payload){
    const values=[payload?.updated_at,payload?.last_attention_updated_at,payload?.last_seen_at,payload?.last_reviewed_at].map(v=>Date.parse(String(v||''))).filter(Number.isFinite);
    const base=values.length?Math.max(...values):Date.parse('2026-10-01T00:00:00.000Z'); return new Date(base+2000).toISOString();
  }

  async function buildPlan(meta,stateRow){
    const base=clone(stateRow.payload||{}), fromLevel=String(base.review_level||'').toLowerCase();
    if(fromLevel!=='high') throw new Error(`WID 2876 expected base attention high, got ${fromLevel||'(empty)'}.`);
    const toLevel='medium', simulatedAt=plusTwoSecondsIso(base), simulatedMs=Date.parse(simulatedAt), basePayloadHash=await sha256(stableStringify(base));
    if(basePayloadHash!==String(stateRow.payloadHash||'')) throw new Error('WID 2876 base payload hash mismatch.');
    const intent={diagnostic:true,kind:'facade-overlay-review-attention-set',cardId:TARGET_CARD_ID,wordId:TARGET_WORD_ID,fromLevel,toLevel,simulatedAt,basePayloadHash,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:String(meta.candidateKey||'')};
    const actionId=`overlay-diag-action:${await sha256(stableStringify(intent))}`;
    const stateMutationId=`overlay-diag-mut:${await sha256(`state|${actionId}`)}`;
    const eventMutationId=`overlay-diag-mut:${await sha256(`event|${actionId}`)}`;
    const eventId=await uuidV5(CARD_NAMESPACE_UUID,`overlay-diagnostic-event|interaction|${actionId}`);
    const patch={known:false,review:true,review_level:toLevel,last_attention_updated_at:simulatedAt,revision:Number(base.revision||0)+1,updated_at:simulatedAt};
    const shared={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:simulatedAt,diagnosticOnly:true,transportEligible:false,status:'diagnostic-pending'};
    const stateMutation={...shared,mutationId:stateMutationId,mutationKind:'patch',tableName:'learning_state',rowKey:TARGET_CARD_ID,precondition:{payloadHash:basePayloadHash,fields:{review:Boolean(base.review),review_level:base.review_level??null,last_attention_updated_at:base.last_attention_updated_at??null,revision:Number(base.revision||0)}},changedFields:['known','review','review_level','last_attention_updated_at','revision','updated_at'],patch};
    stateMutation.mutationHash=await sha256(stableStringify(stateMutation));
    const eventPayload={event_id:eventId,source_event_id:actionId,card_id:TARGET_CARD_ID,session_id:null,event_type:'attention_set',source_stream:'interaction',occurred_at:simulatedAt,completed_at:null,device_id:meta.deviceKey||null,legacy_word_id:Number(TARGET_WORD_ID),schema_version:1,payload:{timestamp:simulatedMs,action:'attention_set',wordId:TARGET_WORD_ID,source:'diagnostic-facade-overlay-roundtrip',level:toLevel,reasons:Array.isArray(base.review_reasons)?clone(base.review_reasons):[],fromLevel,suggested:true,suggestionPolicyVersion:'1.0.0',evidenceThrough:0,diagnosticOnly:true},imported_at:null,supersedes_event_id:null};
    const eventMutation={...shared,mutationId:eventMutationId,mutationKind:'append',tableName:'learning_events',rowKey:eventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};
    eventMutation.mutationHash=await sha256(stableStringify(eventMutation));
    return {actionId,simulatedAt,fromLevel,toLevel,stateMutation,eventMutation};
  }

  async function enqueuePair(db,plan){
    const tx=db.transaction(OUTBOX_STORE,'readwrite'), store=tx.objectStore(OUTBOX_STORE);
    const [a,b]=await Promise.all([requestPromise(store.get(plan.stateMutation.mutationId)),requestPromise(store.get(plan.eventMutation.mutationId))]);
    let wrote=0;
    if(a||b){
      if(!a||!b) throw new Error('Overlay diagnostic outbox pair is partially present.');
      if(stableStringify(a)!==stableStringify(plan.stateMutation)||stableStringify(b)!==stableStringify(plan.eventMutation)) throw new Error('Overlay diagnostic mutation IDs collide with different rows.');
    }else{ store.add(clone(plan.stateMutation)); store.add(clone(plan.eventMutation)); wrote=2; }
    await transactionDone(tx); return {wrote,idempotent:wrote===0};
  }
  async function cleanupPair(db,plan){ const tx=db.transaction(OUTBOX_STORE,'readwrite'), store=tx.objectStore(OUTBOX_STORE); store.delete(plan.stateMutation.mutationId); store.delete(plan.eventMutation.mutationId); await transactionDone(tx); }

  function setStatus(text,kind=''){ const el=$('outbox-facade-overlay-status'); if(!el)return; el.textContent=text; el.className=`status-line${kind?` ${kind}`:''}`; }
  function render(report){
    state.report=report; $('outbox-facade-overlay-panel')?.classList.remove('hidden');
    const result=$('outbox-facade-overlay-result'); if(result){result.textContent=report.summary.pass?'PASS':'CHECK';result.style.color=report.summary.pass?'#18794e':'#b42318';}
    const values={
      'outbox-facade-overlay-before':report.summary.outboxRowsBefore,
      'outbox-facade-overlay-written':report.summary.rowsWritten,
      'outbox-facade-overlay-applied':report.summary.overlayMutationsApplied,
      'outbox-facade-overlay-level':report.overlay?.reviewLevel||'—',
      'outbox-facade-overlay-event':report.summary.interactionEventDelta,
      'outbox-facade-overlay-base':report.summary.baseMirrorUntouched?'PASS':'FAIL',
      'outbox-facade-overlay-cleanup':report.summary.cleanupVerified?'PASS':'FAIL',
      'outbox-facade-overlay-after':report.summary.outboxRowsAfter,
      'outbox-facade-overlay-blocking':report.summary.blockingIssues
    };
    Object.entries(values).forEach(([id,value])=>{const el=$(id);if(el)el.textContent=String(value);});
    if($('outbox-facade-overlay-action')) $('outbox-facade-overlay-action').textContent=report.plan?.actionId||'—';
    const body=$('outbox-facade-overlay-proof-body'); if(body)body.innerHTML=(report.checks||[]).map(row=>`<tr><td>${row.name}</td><td>${row.pass?'PASS':'FAIL'}</td><td>${row.evidence}</td></tr>`).join('');
    const notes=$('outbox-facade-overlay-notes'); if(notes)notes.innerHTML=[...(report.issues?.blocking||[]),...(report.issues?.warnings||[])].map(x=>`<li>${String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</li>`).join('');
    $('export-outbox-facade-overlay').disabled=!report.summary.pass; setStatus(report.summary.pass?'PASS · pending outbox rows are visible through the real read-only facade overlay and cleanup restores the base view.':'CHECK · facade overlay round-trip found a blocker.',report.summary.pass?'ok':'bad');
  }

  async function run(){
    if(state.busy)return; state.busy=true; const button=$('run-outbox-facade-overlay'); if(button)button.disabled=true; setStatus('Writing a quarantined diagnostic pair, opening the real facade overlay, then cleaning it up…');
    let db=null, plan=null, cleanupNeeded=false;
    try{
      const provider=window.WLPCanonicalStorageCompatibilityFacade;
      if(!provider?.open) throw new Error('Storage Compatibility Facade v225 is unavailable.');
      db=await openDb();
      const meta=await getMeta(db), outboxBefore=await countStore(db,OUTBOX_STORE), stateRow=await getRow(db,'learning_state',TARGET_CARD_ID);
      const metaOk=Boolean(meta&&meta.candidateKey===EXPECTED.candidateKey&&Number(meta.headVersion)===EXPECTED.headVersion&&String(meta.migrationVersion)===EXPECTED.migrationVersion&&meta.snapshotManifestHash===EXPECTED.manifestHash&&Number(meta.canonicalRowCount)===EXPECTED.canonicalRows);
      if(!metaOk) throw new Error('Local mirror is not the exact ACTIVE Authority-v2 base.');
      if(outboxBefore!==0) throw new Error(`sync_outbox must start empty for this diagnostic; found ${outboxBefore} row(s).`);
      if(!stateRow) throw new Error('WID 2876 learning_state base row is missing.');
      if(String(stateRow.payload?.first_seen_at||'')!==EXPECTED.firstSeenIso) throw new Error('WID 2876 first_seen_at is not the verified Authority-v2 value.');

      const baseFacade=await provider.open(), baseRecord=baseFacade.readProgressRecord(TARGET_WORD_ID), baseInteractionCount=baseFacade.readInteractionEvents().length;
      if(baseFacade.pendingOutboxRows!==0||baseFacade.overlayMutationsApplied!==0) throw new Error('Base facade unexpectedly reports pending overlay mutations before the diagnostic write.');
      if(baseRecord.reviewLevel!=='high'||Number(baseRecord.firstSeen)!==EXPECTED.firstSeenMs) throw new Error('Base facade WID 2876 is not the expected high-attention Authority-v2 state.');

      plan=await buildPlan(meta,stateRow); const write=await enqueuePair(db,plan); cleanupNeeded=true; const outboxDuring=await countStore(db,OUTBOX_STORE);
      const overlayFacade=await provider.open(), overlayRecord=overlayFacade.readProgressRecord(TARGET_WORD_ID), overlayInteractions=overlayFacade.readInteractionEvents();
      const eventFound=overlayInteractions.some(event=>String(event?.source||'')==='diagnostic-facade-overlay-roundtrip'&&String(event?.wordId||'')===TARGET_WORD_ID&&String(event?.level||'')==='medium');
      const interactionEventDelta=overlayInteractions.length-baseInteractionCount;
      const overlayVerified=Boolean(overlayFacade.pendingOutboxRows===2&&overlayFacade.overlayMutationsApplied===2&&overlayFacade.overlayStateMutationsApplied===1&&overlayFacade.overlayEventMutationsApplied===1&&overlayRecord.reviewLevel==='medium'&&Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs&&interactionEventDelta===1&&eventFound);
      const baseDuring=await getRow(db,'learning_state',TARGET_CARD_ID), baseMirrorUntouched=stableStringify(baseDuring)===stableStringify(stateRow);

      await cleanupPair(db,plan); cleanupNeeded=false; const outboxAfter=await countStore(db,OUTBOX_STORE), afterFacade=await provider.open(), afterRecord=afterFacade.readProgressRecord(TARGET_WORD_ID), afterInteractionCount=afterFacade.readInteractionEvents().length;
      const cleanupVerified=Boolean(outboxAfter===0&&afterFacade.pendingOutboxRows===0&&afterFacade.overlayMutationsApplied===0&&afterRecord.reviewLevel==='high'&&Number(afterRecord.firstSeen)===EXPECTED.firstSeenMs&&afterInteractionCount===baseInteractionCount);
      const baseAfter=await getRow(db,'learning_state',TARGET_CARD_ID), baseStillUntouched=stableStringify(baseAfter)===stableStringify(stateRow);
      const blocking=[];
      if(write.wrote!==2||outboxDuring!==2) blocking.push('Diagnostic pair did not atomically persist as exactly two outbox rows.');
      if(!overlayVerified) blocking.push('Storage Compatibility Facade did not reproduce the pending outbox overlay exactly.');
      if(!baseMirrorUntouched||!baseStillUntouched) blocking.push('Canonical learning_state base changed during overlay verification.');
      if(!cleanupVerified) blocking.push('Cleanup did not restore the exact base facade view and empty outbox.');

      const checks=[
        ['Exact Authority-v2 base and empty outbox',metaOk&&outboxBefore===0,`${meta.candidateKey} · outbox ${outboxBefore}`],
        ['Base facade starts on WID 2876 High',baseRecord.reviewLevel==='high'&&Number(baseRecord.firstSeen)===EXPECTED.firstSeenMs,`High · firstSeen ${baseRecord.firstSeen}`],
        ['Atomic diagnostic pair persisted',write.wrote===2&&outboxDuring===2,`${write.wrote} write(s) · ${outboxDuring} row(s)`],
        ['Real facade applies both pending mutations',overlayFacade.overlayMutationsApplied===2,`${overlayFacade.overlayMutationsApplied} applied`],
        ['Facade overlays Review attention High → Medium',overlayRecord.reviewLevel==='medium',`${baseRecord.reviewLevel} → ${overlayRecord.reviewLevel}`],
        ['Facade appends one interaction event',interactionEventDelta===1&&eventFound,`Δ ${interactionEventDelta} · event found=${eventFound}`],
        ['Explicit firstSeen survives overlay',Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs,String(overlayRecord.firstSeen)],
        ['Canonical base remains immutable',baseMirrorUntouched&&baseStillUntouched,'learning_state wrapper unchanged'],
        ['Cleanup restores base facade + empty outbox',cleanupVerified,`level ${afterRecord.reviewLevel} · outbox ${outboxAfter}`]
      ].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));

      const report={
        format:'WLP_CANONICAL_OUTBOX_FACADE_OVERLAY_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'diagnostic-outbox-to-real-storage-facade-overlay-roundtrip',
        device:{deviceKey:meta.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},
        authority:{candidateKey:meta.candidateKey,headVersion:meta.headVersion,migrationVersion:meta.migrationVersion,snapshotManifestHash:meta.snapshotManifestHash,canonicalRows:meta.canonicalRowCount},
        summary:{outboxRowsBefore:outboxBefore,rowsWritten:write.wrote,outboxRowsDuring:outboxDuring,overlayMutationsApplied:overlayFacade.overlayMutationsApplied,overlayStateMutationsApplied:overlayFacade.overlayStateMutationsApplied,overlayEventMutationsApplied:overlayFacade.overlayEventMutationsApplied,interactionEventDelta,baseMirrorUntouched:baseMirrorUntouched&&baseStillUntouched,cleanupVerified,outboxRowsAfter:outboxAfter,blockingIssues:blocking.length,nextPhaseEligible:blocking.length===0,pass:blocking.length===0},
        plan:{actionId:plan.actionId,wordId:TARGET_WORD_ID,cardId:TARGET_CARD_ID,fromLevel:plan.fromLevel,toLevel:plan.toLevel,stateMutationId:plan.stateMutation.mutationId,eventMutationId:plan.eventMutation.mutationId,diagnosticOnly:true,transportEligible:false},
        overlay:{source:overlayFacade.source,pendingOutboxRows:overlayFacade.pendingOutboxRows,reviewLevel:overlayRecord.reviewLevel,firstSeen:overlayRecord.firstSeen,interactionEvents:overlayInteractions.length,eventFound},
        afterCleanup:{source:afterFacade.source,pendingOutboxRows:afterFacade.pendingOutboxRows,reviewLevel:afterRecord.reviewLevel,firstSeen:afterRecord.firstSeen,interactionEvents:afterInteractionCount},
        checks,issues:{blocking,warnings:['This validates the production read overlay path, not Review UI writes. The diagnostic pair is transport-ineligible and removed before PASS.','Progress default reads will now see valid pending outbox overlays automatically; with an empty outbox its visible behavior is unchanged.','Review remains on legacy reads/writes. Cloud transport, acknowledgement, and conflict resolution are still disabled.']},
        invariants:{noCloudWrites:true,noLocalStorageWrites:true,noLiveReviewWrites:true,indexedDbWritesRestrictedToSyncOutbox:true,diagnosticRowsTransportIneligible:true,cleanupComplete:cleanupVerified,authorityBaseImmutable:baseMirrorUntouched&&baseStillUntouched,facadeReadOnly:true,progressOverlayReady:true,noReviewReadCutover:true,noWriteTransportEnabled:true,noConflictAutoOverwrite:true,explicitFirstSeenPreserved:Number(overlayRecord.firstSeen)===EXPECTED.firstSeenMs}
      };
      render(report);
    }catch(error){
      const message=error?.message||String(error); try{if(db&&plan&&cleanupNeeded)await cleanupPair(db,plan);}catch(cleanupError){console.error('Overlay diagnostic cleanup failed',cleanupError);} console.error(error);
      render({format:'WLP_CANONICAL_OUTBOX_FACADE_OVERLAY_ROUNDTRIP',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'diagnostic-outbox-to-real-storage-facade-overlay-roundtrip',device:{platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{},summary:{outboxRowsBefore:0,rowsWritten:0,outboxRowsDuring:0,overlayMutationsApplied:0,overlayStateMutationsApplied:0,overlayEventMutationsApplied:0,interactionEventDelta:0,baseMirrorUntouched:true,cleanupVerified:false,outboxRowsAfter:-1,blockingIssues:1,nextPhaseEligible:false,pass:false},plan:{},overlay:{},afterCleanup:{},checks:[],issues:{blocking:[message],warnings:['If a diagnostic outbox write started before failure, best-effort cleanup was attempted. Confirm sync_outbox is empty before retrying.']},invariants:{noCloudWrites:true,noLocalStorageWrites:true,noLiveReviewWrites:true,noReviewReadCutover:true,noWriteTransportEnabled:true}});
    }finally{if(db)db.close();state.busy=false;if(button)button.disabled=false;}
  }

  function exportReport(){
    if(!state.report)return; const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`wlp-canonical-outbox-facade-overlay-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }

  $('run-outbox-facade-overlay')?.addEventListener('click',run);
  $('export-outbox-facade-overlay')?.addEventListener('click',exportReport);
  window.WLPCanonicalOutboxFacadeOverlayRoundtrip=Object.freeze({version:1,getReport:()=>clone(state.report)});
})();
