/* G4-1 Continue page: authenticated remote Context publication.
 * REVIEW CANDIDATE. Build gate OFF; not a user-settable URL or storage flag.
 * Uses the SAME G4 account writer lease, E7b Inbox and Continue Runtime as
 * Study Hub, and never copies remote Contexts to the Legacy study key.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4ContinueEntryBootstrapSOURCEOFF=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const fail=s=>{throw Error('G4 Continue entry HOLD: '+s);};
const check=(v,s)=>{if(!v)fail(s);};
// A separate reviewed build must approve this together with the Study Hub
// remote-only Writer; never activate from query params or LocalStorage.
const CONTINUE_ENTRY_RELEASE_APPROVED=typeof window!=='undefined'&&window.WLPStage7G4ReleasePolicy?.gate('continue')===true;
async function prepare({root,indexedDB,storage,fetchImpl,studyContext,approved=false}={}){
 check(approved===true&&CONTINUE_ENTRY_RELEASE_APPROVED,
  'unreviewed build cannot publish received Continue');
 check(root?.WLPG4StudySourceRouting?.inspect&&root?.WLPG4AccountLocalWriterBridgeSOURCEOFF?.make&&
  root?.WLPG4PairedTransportComposerSOURCEOFF?.make&&root?.WLPG4ReceivedContinueBridge?.make&&
  root?.WLPG4RemoteStandardResumeSOURCEOFF?.make,'proven G4/E7b module missing');
 const route=await root.WLPG4StudySourceRouting.inspect({indexedDB});
 check(route?.mode==='new-g4-mirror','Continue entry is not an approved new G4 Mirror');
 const bound=root.WLPG4AccountLocalWriterBridgeSOURCEOFF.make({root,indexedDB,storage,
  cryptoImpl:root.crypto,fetchImpl,studyContext});
 const lease=await bound.prepareLocalOnly({approved:true});
 root.WLPStage7G4ReleasePolicy.verifyAccount(lease.accountId,'continue');
 check(lease?.driver?.approved===true&&lease.cloudSyncEnabled===false,
  'G4 local owner not verified');
 const transport=root.WLPG4PairedTransportComposerSOURCEOFF.make({root,indexedDB,fetchImpl,localLease:lease});
 const received=root.WLPG4ReceivedContinueBridge.make({root,indexedDB,storage,localLease:lease,transport});
 const result=await received.initialize({approved:true});
 check(result?.ready===true,'durable verified received Session not ready');
 const facade=root.WLPG4RemoteStandardResumeSOURCEOFF.make({
  runtime:root.WLPE7bContinueRuntime,
  stageDurably:args=>received.stageRemoteRevision(args)
 });
 // A Context is published only if the same guarded adapter can actually open
 // the exact remote-owned Session on the destination Study Hub.
 const readContexts=(legacyContexts)=>{
  const combined=facade.readContexts(legacyContexts);
  const eligible=combined.filter(c=>!facade.isRemoteContext(c.contextId)||c.status!=='completed');
  for(const c of eligible){if(facade.isRemoteContext(c.contextId))facade.open(c.contextId);}
  return eligible;
 };
 return Object.freeze({readContexts,isRemoteContext:facade.isRemoteContext});
}
function bootBrowser(){
 if(!CONTINUE_ENTRY_RELEASE_APPROVED)return;
 const root=window;
 void prepare({root,indexedDB:root.indexedDB,storage:root.localStorage,
  fetchImpl:root.fetch.bind(root),studyContext:root.WLPStudyContext,approved:true})
 .then(provider=>{root.WLPG4ContinueContextProvider=provider;
  root.dispatchEvent(new Event('wlp-g4-received-continue-ready'));})
 .catch(error=>{console.warn('G4 Continue remains local-only:',error.message);});
}
return Object.freeze({prepare,bootBrowser});
});
