/* WLP G4-1 — Account + previously proven E7b paired transport composition.
 * SOURCE ONLY, no page loads this file, never installs timers/listeners/UI/SW.
 * Reuses E7b uploader + atomic inbox without changing their logic.
 * Production SQL exists with Gate OFF. Outbound and inbound RPC operations
 * remain hidden until a separately reviewed build explicitly authorizes them.
 */
(function(root,factory){const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4PairedTransportComposerSOURCEOFF=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const check=(test,msg)=>{if(!test)throw Error('G4 production transport HOLD: '+msg);};
// REVIEWED BUILD GATE: cannot be turned on via URL, localStorage or Account UI.
// Production paired schema exists, but its per-account write Gate is OFF.
// Keep false until a separate approved release and bounded real-account test.
const PAIRED_PRODUCTION_RELEASE_APPROVED=typeof window!=='undefined'&&window.WLPStage7G4ReleasePolicy?.gate('paired')===true;
function deps(root){return {
 wire:root.WLPE7bPairedWireDEV,
 rpc:root.WLPG4PairedRpcV1SOURCEOFF,
 uploader:root.WLPE7bPairedUploaderDEV,
 remoteUploader:root.WLPE7bRemoteReviseUploaderDEV,
 inbox:root.WLPE7bPairedInboxDEV
};}
function make({root,indexedDB,fetchImpl,localLease,modules,
  pairedMode='new-g4-mirror',verifyExistingE7aSource}={}){
 const legacyMode=pairedMode==='existing-e7a-authority';
 check(legacyMode||pairedMode==='new-g4-mirror','unknown Paired Library source');
 if(legacyMode)check(typeof verifyExistingE7aSource==='function','existing-E7a provenance verifier required');
 const approvedPilot=legacyMode ?
   root?.WLPStage7G4ReleasePolicy?.gate('existing-e7a-paired')===true :
   PAIRED_PRODUCTION_RELEASE_APPROVED;
 check(root&&indexedDB?.open&&typeof fetchImpl==='function','Browser dependencies required');
 if(approvedPilot)root.WLPStage7G4ReleasePolicy.verifyAccount(localLease?.accountId,
  legacyMode?'existing-e7a-paired':'paired');
 check(localLease?.localOnly===true&&localLease?.studyHubEnabled===false&&
  localLease?.cloudSyncEnabled===false&&
  typeof localLease.identityNow==='function'&&typeof localLease.verifyIdentity==='function',
  'Trusted local Journal lease must be prepared FIRST');
 const m=modules||deps(root);
 check(typeof m.wire?.sameIdentity==='function'&&typeof m.rpc?.make==='function'&&
  typeof m.uploader?.make==='function'&&typeof m.remoteUploader?.make==='function'&&
  typeof m.inbox?.make==='function',
  'Missing proven E7b transport modules');
 // All components bind to the EXACT identity generation of the G4 local writer.
 // This constructor NEVER invokes network or opens/creates an IndexedDB.
 const identityNow=()=>{
  const i=m.wire.normalizeIdentity(localLease.identityNow());
  check(i.accountId===localLease.accountId&&i.deviceKey===localLease.deviceKey&&
   i.candidateKey===localLease.candidateKey&&i.headVersion===localLease.headVersion,
   'Journal account/device/Authority binding has changed');
  return i;
 };
 const rpc=m.rpc.make({indexedDB,fetchImpl,identityNow,wire:m.wire,approvedPilot});
 // A fresh E7a provenance check is also required at the LAST server-send
 // boundary, for the precise immutable prepared Action, not just when the
 // foreground loop entered. The existing RPC implementation is untouched.
 const originRpc=legacyMode ? Object.freeze({
   ...rpc,
   submitPrepared:async args=>{
     const proof=await verifyExistingE7aSource();
     check(proof?.ready===true&&proof.mode==='existing-e7a-authority'&&
       Array.isArray(proof.verified)&&
       proof.verified.includes(args?.action?.source_session_id),
       'prepared Action lacks fresh E7a source-session witness');
     return rpc.submitPrepared(args);
   }
 }) : rpc;
 const uploader=m.uploader.make({indexedDB,identityNow,rpc:originRpc,approvedPilot});
 const inbox=m.inbox.make({indexedDB,identityNow,
  canonicalRowsForFrame:async(frame,id)=>{
   check(m.wire.sameIdentity(id,identityNow()),'Inbox identity changed');
   const wordIds=frame?.record?.context?.source?.wordIds;
   check(Array.isArray(wordIds)&&wordIds.length>0,'Missing canonical card witness');
   return rpc.canonicalCardRows(wordIds);
  }});
 // SOURCE OFF exposes NO RPCs or transport operations. For a separately
 // reviewed, compiled-on release, this uses the SAME durable E7b journal
 // revision/Action ID and atomic inbox code as the prior real-device proof.
 // The SQL server gate still independently controls Cloud writes per account.
 let running=false,remoteUploader=null;
 // A remote uploader MUST receive the exact authenticated E7b Continue
 // overlay already bound to this owner. Merely having Inbox frames does not
 // authorize creating a remote REVISE or sending on the new-session lane.
 function bindReceivedOverlay({overlay,approved=false}={}){
  check(approved===true,'Received overlay binding requires owner approval');
  check(!remoteUploader,'Remote revision writer already bound');
  check(overlay&&typeof overlay.rebaseAcknowledgedRemoteRevision==='function'&&
   typeof overlay.pendingForReplay==='function'&&typeof overlay.hasVerifiedOriginShadow==='function',
    'Proven E7b overlay missing');
  const before=identityNow();
  remoteUploader=m.remoteUploader.make({indexedDB,identityNow,rpc,overlay,
   approvedPilot});
  check(m.wire.sameIdentity(before,identityNow()),'Overlay owner changed during binding');
  return Object.freeze({bound:true,sourceOff:!approvedPilot});
 }
 const runOnce=async(kind)=>{
  check(approvedPilot,'Paired production release has not been approved');
  check(!running,'transport operation already active in this tab');
  running=true;
  try{
   const before=identityNow();
   if(legacyMode){
    const source=await verifyExistingE7aSource();
    check(source?.ready===true&&source?.mode==='existing-e7a-authority',
     'existing-E7a card, owner and pending Action proof missing');
   }
   const proven=await localLease.verifyIdentity();
   check(m.wire.sameIdentity(before,proven)&&m.wire.sameIdentity(proven,identityNow()),
    'current account, device or Authority proof does not match writer lease');
   // Do not call Journal captureCandidate, invent an Action, clear the old
   // Canonical Outbox, or project incoming history into an unapproved UI.
   let result;
   if(kind==='send'){
     // Existing G4 CREATE/REVISE keeps its proven uploader. A received
     // Session's distinct remote REVISE lane is used only when that uploader
     // has no pending action, and only with the trusted received overlay.
     result=await uploader.flushOne();
     if(result?.status==='empty' && remoteUploader)
       result=await remoteUploader.flushOne();
   } else result=await rpc.pullIntoInbox({inbox,limit:50});
   check(m.wire.sameIdentity(before,identityNow()),'transport owner changed before result');
   return result;
  }finally{running=false;}
 };
 // Exact-account E7a pilot, receiver-only first-visit preparation. Creates ONLY
 // the empty existing E7b v1 Journal schema if absent; refuses repair/migration.
 // Caller must have entered the approved Study Hub route and verified the
 // same account/Authority; a network callback cannot invoke this API.
 async function preparePilotReceiverJournal({approved=false}={}){
  check(legacyMode&&approvedPilot&&approved===true,
   'Only the reviewed existing-E7a receiver pilot may prepare a Journal');
  const before=identityNow();
  root.WLPStage7G4ReleasePolicy.verifyAccount(before.accountId,'existing-e7a-paired');
  const fresh=await localLease.verifyIdentity();
  check(m.wire.sameIdentity(before,fresh)&&m.wire.sameIdentity(before,identityNow()),
   'Receiver account or Authority changed during preparation');
  check(typeof inbox.prepareEmptyJournalForExplicitReceive==='function',
   'Existing E7b receiver bootstrap unavailable');
  const result=await inbox.prepareEmptyJournalForExplicitReceive({approved:true});
  check(m.wire.sameIdentity(before,identityNow()),
   'Receiver account changed after empty Journal preparation');
  return Object.freeze({ready:true,created:result?.created===true,version:result?.version});
 }
 const publicApi={
  preparePilotReceiverJournal,
  status:()=>Object.freeze({sourceOff:!approvedPilot,cloudSendEnabled:approvedPilot,cloudReceiveEnabled:approvedPilot,pairedMode,
   journalReused:true,rpcNames:'wlp_paired_*_v1',
   boundToLocalWriter:true,remoteRevisionBound:!!remoteUploader}),
  bindReceivedOverlay,
  // Read previously durably received frames only: no Cloud calls, ACK,
  // transport enrollment, or adoption into the legacy WLP history.
  listCommittedReceiverFrames:async({approved=false}={})=>{
   check(approved===true,'Explicit verified Continue read approval required');
   const before=identityNow();
   const proof=await localLease.verifyIdentity();
   check(m.wire.sameIdentity(before,proof)&&m.wire.sameIdentity(before,identityNow()),
    'Receiver owner changed before local read');
   const frames=await inbox.listCommittedReceiverFrames();
   check(m.wire.sameIdentity(before,identityNow()),'Receiver owner changed after local read');
   return frames;
  },
  readLocalCursor:async({approved=false}={})=>{
   check(approved===true,'Explicit local cursor inspection approval required');
   await localLease.verifyIdentity();
   return inbox.readCursor();
  }
 };
 if(approvedPilot){
  // Deliberate one-step APIs, not a timer, auto-sync or page hook.
  publicApi.flushOne=()=>runOnce('send');
  publicApi.receiveOnce=()=>runOnce('receive');
 }
 return Object.freeze(publicApi);
}
return Object.freeze({make});
});
