/* Stage7 existing E7a Library — guarded hand-off to the *existing* v400
 * incremental transport. No new Cloud protocol, no local DB replacement.
 * There is no execution on module load. Build approval is OFF in this candidate.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7ExistingLibraryReconcile=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const fail=m=>{throw Error('Existing Library HOLD: '+m);};
 const threeWayPlan=evidence=>{
  const planner=(typeof window!=='undefined'?window.WLPStage7CanonicalThreeWay:null);
  if(!planner?.plan)fail('Verified three-way field planner is not loaded');
  return planner.plan(evidence);
 };
 const text=x=>String(x??'').trim();
 const sameAuthority=(a,b)=>!!a&&!!b&&a.candidateKey===b.candidateKey&&
   Number(a.headVersion)===Number(b.headVersion)&&a.snapshotManifestHash===b.snapshotManifestHash;
 function classify(proof){
  const loc=proof?.local||{},remote=proof?.remote,code=text(proof?.verdict?.code);
  if(!remote?.identityVerified||!remote?.authorityVerified||!text(remote.userId)||!remote.authority)
   return {code:'HOLD_CLOUD_IDENTITY',eligible:false,reason:'Cloud owner and Authority must be verified'};
  if(!loc.mirrorPresent)return {code:'HOLD_EXISTING_MIRROR_ABSENT',eligible:false,reason:'Existing-data reconciliation never invokes new-browser install'};
  if(!loc.mirrorValid||loc.ownerMismatch||loc.deviceMismatch||loc.mirrorAuthorityDifferent)
   return {code:'HOLD_LOCAL_OWNERSHIP_OR_AUTHORITY',eligible:false,reason:'Existing Mirror ownership or Authority is not independently verified'};
  if(loc.legacyV400Allowed!==true)
   return {code:'HOLD_NOT_LEGACY_V400_MIRROR',eligible:false,reason:'G4 new-browser or disabled legacy Mirror must never use v400'};
  if(!['EXISTING_ACCOUNT_LIBRARY','EXISTING_SYNC_NEEDED','EXISTING_PENDING'].includes(code))
   return {code:'HOLD_UNSUPPORTED_BOUNDARY',eligible:false,reason:'Boundary result is not an approved existing E7a Library path'};
  if(!Number.isSafeInteger(remote.cursor)||remote.cursor<0)
   return {code:'HOLD_CLOUD_CURSOR',eligible:false,reason:'Cloud Cursor is not valid'};
  if(!Number.isSafeInteger(loc.mirrorCursor)||loc.mirrorCursor<0||loc.mirrorCursor>remote.cursor)
   return {code:'HOLD_LOCAL_CURSOR',eligible:false,reason:'Local Mirror cursor is missing or newer than Cloud'};
  if(loc.pendingOutbox===null||!Number.isSafeInteger(loc.pendingOutbox)||loc.pendingOutbox<0)
   return {code:'HOLD_UNKNOWN_OUTBOX',eligible:false,reason:'Never interpret unknown Outbox as empty'};
  const p=loc.pendingOutbox>0;
  return Object.freeze({code:p?'EXISTING_OUTBOX_HANDOFF':code==='EXISTING_SYNC_NEEDED'?'EXISTING_DELTA_HANDOFF':'EXISTING_UP_TO_DATE',
   eligible:true,reason:p?'Existing Canonical v400 transport must validate and ACK pending Outbox before Cloud catch-up':
   code==='EXISTING_SYNC_NEEDED'?'Existing Canonical v400 receiver will reconcile Cloud changes by verified Cursor':'Existing Mirror is current at last verified Cloud Cursor',
   outbox:loc.pendingOutbox,cloudCursor:remote.cursor,owner:remote.userId,authority:remote.authority});
 }
 function make({boundary,legacySync,policy,locks,evidence}={}){
  if(!boundary?.inspect||!legacySync?.runSync||!legacySync?.inspectPendingStage7||
     !legacySync?.supportedAuthority||!evidence?.inspectReadOnly||!policy?.gate||!locks?.request)
   fail('Established v400 transport, verified evidence, safety inventory, release policy or browser lock unavailable');
  const approved=()=>policy.gate('legacy-reconcile')===true;
  let busy=false;
  const exactLegacyAuthority=p=>p.eligible&&sameAuthority(p.authority,legacySync.supportedAuthority);
  // No transport work without a *fresh*, independently reconstructed Cloud
  // history, exact local Mirror and Outbox fingerprint, and v400 action schema.
  async function prepare(proof,p){
   if(!exactLegacyAuthority(p))fail('Cloud Authority is not supported by this v400');
   const evidenceRead=await evidence.inspectReadOnly();
   if(evidenceRead.readOnly!==true||evidenceRead.canApplyAutomatically!==false||
      evidenceRead.localCursor!==proof.local.mirrorCursor||
      evidenceRead.cloudCursor!==p.cloudCursor||evidenceRead.localOutbox!==p.outbox||
      evidenceRead.needsConflictReview===true)
    fail('Independent Cloud/Mirror/field comparison was not stable or conflict-free');
   // These keys live outside the materialized Mirror. They need individual
   // owner/base proofs before receiving or sending anything in this path.
   const projection=evidenceRead.legacyProjection;
   if(!projection||projection.readOnly!==true||
      projection.totalDrafts!==evidenceRead.localDraftCount||
      projection.totalLocalEdits!==evidenceRead.localEditCount||
      projection.eligibleForExistingV400!==true||
      !/^[a-f0-9]{64}$/i.test(text(projection.projectionFingerprint))||
      evidenceRead.unknownLegacyData===true)
    fail('HOLD_NON_OUTBOX_LOCAL_CHANGES: legacy projection records, unknown stores or owner/base are not fully proven');
   const device=text(proof.local?.mirror?.deviceKey);
   if(!device)fail('Verified local device identity is missing');
   const pending=await legacySync.inspectPendingStage7({ownerId:p.owner,deviceKey:device});
   if(pending.outboxCount!==p.outbox||
      !/^[a-f0-9]{64}$/i.test(text(pending.fingerprint))||
      evidenceRead.proof?.outboxFingerprint!==pending.fingerprint)
    fail('Outbox changed between verified Cloud reconstruction and v400 shape validation');
   if(p.outbox>0){
    // The current v400 source path commits its own Action feed as the next
    // materialized cursor. Never skip intervening Cloud actions.
    if(p.cloudCursor!==proof.local.mirrorCursor&&
       evidenceRead.outboxReview?.code!=='OUTBOX_REVALIDATE_WITH_V400')
     fail('HOLD_PENDING_OUTBOX_WITH_REMOTE_DELTA: intervening Cloud actions do not pass source preconditions');
    if(evidenceRead.outboxReview?.code!=='OUTBOX_REVALIDATE_WITH_V400'||
       !pending.actionId||!Number.isSafeInteger(pending.rowCount)||pending.rowCount<1)
     fail('Pending Outbox is not verified for v400 revalidation');
   }else if((evidenceRead.code!=='READY_FOR_EXISTING_TRANSPORT_RECHECK'&&
       !(evidenceRead.code==='HOLD_LOCAL_CHANGE_REVIEW'&&
         evidenceRead.needsConflictReview===false&&projection.eligibleForExistingV400===true))||
      pending.actionId)
    fail('Receiver is not clear of pending or non-Outbox local changes');
   if(!/^[a-f0-9]{64}$/i.test(text(evidenceRead.proof?.localManifest)))
    fail('Exact independently verified Mirror fingerprint missing');
   return Object.freeze({mode:p.outbox>0?(p.cloudCursor>proof.local.mirrorCursor?'catchup':'source'):'receiver',pending,
     mirrorManifest:evidenceRead.proof.localManifest,
     evidenceCode:evidenceRead.code,outboxCode:evidenceRead.outboxReview?.code||'',
     projectionFingerprint:projection.projectionFingerprint});
  }
  async function inspect(){
   const proof=await boundary.inspect(),p=classify(proof);
   if(!p.eligible)return Object.freeze({...p,buildApproved:approved(),readOnly:true});
   try{
    const ready=await prepare(proof,p);
    return Object.freeze({...p,code:ready.mode==='source'?'VERIFIED_V400_OUTBOX_HANDOFF':ready.mode==='catchup'?'VERIFIED_V400_PENDING_REMOTE_CATCHUP':'VERIFIED_V400_RECEIVER_HANDOFF',
     reason:'Verified historical Cloud/Mirror proof and established v400 action preflight match; no write has occurred',
     outboxReview:ready.outboxCode,actionCount:ready.pending.actionCount,
     buildApproved:approved(),readOnly:true});
   }catch(error){return Object.freeze({code:'HOLD_VERIFIED_EVIDENCE',eligible:false,
    reason:String(error?.message||error),buildApproved:approved(),readOnly:true,
    outbox:p.outbox,cloudCursor:p.cloudCursor});}
  }
  async function reconcileExplicit(){
   if(!approved())fail('Stage7 release has not approved legacy reconciliation');
   if(busy)fail('Another reconcile operation is already running in this tab');
   busy=true;
   try{return await locks.request('wlp:stage7:existing-library-reconcile:v1',
    {mode:'exclusive',ifAvailable:true},async lock=>{
     if(!lock)fail('Another Stage7 tab holds the reconciliation lock');
     if(!approved())fail('Release approval changed');
     const beforeProof=await boundary.inspect(),before=classify(beforeProof);
     if(!before.eligible)fail(before.code+' — '+before.reason);
     const prepared=await prepare(beforeProof,before);
     if(!approved())fail('Stage7 release approval changed during evidence collection');
     // This is THE EXISTING v400 sender/receiver, not a parallel submit path.
     // Pin the exact read-only Outbox digest and selected v400 Action ID.
     // A strict receiver must never convert to an unreviewed source push.
     const result=await legacySync.runSync({trigger:'stage7-explicit-existing-library-reconcile',
      stage7Guarded:true,receiverOnly:prepared.mode!=='source',
      strictReceiverOnly:prepared.mode!=='source',
      stage7PendingCatchup:prepared.mode==='catchup',
      expectedOutboxReviewCode:prepared.outboxCode,
      expectedActionId:prepared.pending.actionId,
      expectedOutboxFingerprint:prepared.pending.fingerprint,
      expectedMirrorManifest:prepared.mirrorManifest,
      expectedLegacyProjectionFingerprint:prepared.projectionFingerprint,
      expectedCursor:beforeProof.local.mirrorCursor});
     if(!result||typeof result!=='object')fail('v400 busy/queued; never interpret as success');
     const summary=result.summary||{};
     if(summary.pass!==true||Number(summary.blockingIssues||0)>0)
      fail('v400 reported HOLD; inspect original Outbox and Mirror before retry');
     const afterProof=await boundary.inspect(),after=classify(afterProof);
     if(!after.eligible||after.owner!==before.owner||!sameAuthority(after.authority,before.authority))
      fail('Account/Authority changed during reconciliation; do not claim success');
     if(after.cloudCursor<before.cloudCursor)fail('Cloud cursor moved backwards');
     const cursorBefore=Number(summary.cursorBefore),cursorAfter=Number(summary.cursorAfter);
     if(!Number.isSafeInteger(cursorBefore)||!Number.isSafeInteger(cursorAfter)||cursorAfter<cursorBefore||
       cursorBefore!==beforeProof.local.mirrorCursor||cursorAfter!==afterProof.local.mirrorCursor)
      fail('v400 receipt cursor did not match pre/post materialized Mirror');
     if(summary.role==='receiver-deferred'||summary.deferred===true)
      return Object.freeze({status:'DEFERRED_LOCAL_PRESERVED',owner:before.owner,
       outbox:after.outbox,cloudCursor:after.cloudCursor,localCursor:cursorAfter,
       reason:'v400 deferred receiver; no convergence claimed'});
     if(prepared.mode==='catchup'){
      if(summary.role!=='receiver'||summary.serverApplied!==false||
         summary.cursorAcknowledged!==true||
         !Number.isSafeInteger(Number(summary.changeRows))||Number(summary.changeRows)<1||
         after.outbox!==before.outbox||Number(summary.outboxBefore)!==before.outbox||
         Number(summary.outboxAfter)!==before.outbox||cursorAfter<=cursorBefore||
         !Array.isArray(result.changes)||result.changes.length!==Number(summary.changeRows)||
         result.changes.some(row=>String(row.action_id)===prepared.pending.actionId))
       fail('v400 disjoint Cloud receiver did not retain the exact pending Outbox');
     }else if(prepared.mode==='source'){
      if(!['source','receiver-reconcile'].includes(summary.role)||
         summary.acknowledged!==true||summary.cursorAcknowledged!==true||
         after.outbox!==before.outbox-prepared.pending.rowCount||
         !Array.isArray(result.changes)||
         !result.changes.length||
         result.changes.some(row=>String(row.action_id)!==prepared.pending.actionId))
       fail('v400 source ACK/commit did not prove the pinned action or pending Outbox delta');
     }else if(!['receiver','receiver-noop','receiver-projection-repair'].includes(summary.role)||
        after.outbox!==0)
      fail('Strict v400 receiver did not preserve empty Outbox');
     if(summary.role==='receiver-noop' && after.code!=='EXISTING_UP_TO_DATE')
      fail('v400 no-op while Cloud Cursor remains ahead; no convergence claimed');
     return Object.freeze({status:after.code==='EXISTING_UP_TO_DATE'?'LEGACY_CANONICAL_CAUGHT_UP':'LEGACY_CANONICAL_PROGRESS',
      owner:before.owner,role:summary.role,outbox:after.outbox,cloudCursor:after.cloudCursor,
      localCursor:cursorAfter,changes:Number(summary.changeRows||0),
      reason:prepared.mode==='catchup'?'One independently verified disjoint Cloud action received through v400; pending Outbox preserved and fresh proof required before next action.':'Existing v400 verified the pinned Action, server ACK and durable local commit; no G4 duplicate writer.'});
    });}finally{busy=false;}
  }
  return Object.freeze({inspect,reconcileExplicit});
 }
 return Object.freeze({make,classify,sameAuthority,threeWayPlan});
});
