/* WLP P1-E7b — Continue runtime seam / DEV ONLY / no auto transport.
 * Trusted binding is NOT present in E7a and must only be supplied by the
 * correctly authenticated E7b Local Journal + paired receiver integration.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.WLPE7bContinueRuntime=api;
})(typeof window!=='undefined'?window:this,function(root){
  'use strict';
  const OVERLAY=root.WLPE7bContinueDurableOverlay;
  const GATE=root.WLPE7bContinuePairGate;
  const CONTEXT_KEY='wlp:study-contexts:v1';
  const SESSION_KEY='wlp:studyq-sessions:v1';
  let instance=null, provider=null, initPromise=null, initializedOwnerKey="";
  const clean=v=>String(v??'').trim();
  function raw(key){try{const v=JSON.parse(root.localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}}
  const legacyContexts=()=>raw(CONTEXT_KEY);
  const legacySessions=()=>raw(SESSION_KEY);
  function establish(){
    // NOT a public-API auth proof: caller must be a trusted bound E7b runtime.
    const binding=root.WLPE7bContinueTrustedBinding;
    if(!binding || typeof binding.getVerifiedIdentitySync!=='function'||
      typeof binding.listCommittedReceiverFrames!=='function'||
      typeof binding.capturePairedRevisionDurably!=='function' || !OVERLAY || !GATE) return false;
    provider=binding;
    instance=OVERLAY.make({storage:root.localStorage,gate:GATE,
      identityNow:()=>binding.getVerifiedIdentitySync(),
      onPairPending:(pair,id)=>binding.capturePairedRevisionDurably(pair,id)});
    // Private Trusted Binding receives the SAME overlay used by Continue.
    // Remote ACK reconciliation must never operate against a second stale map.
    if(typeof binding.onOverlayReady==='function')binding.onOverlayReady(instance);
    return true;
  }
  async function initialize(){
    const binding=root.WLPE7bContinueTrustedBinding;
    let ident;
    try {ident=binding?.getVerifiedIdentitySync?.();}
    catch (_) {reset();return {ready:false,reason:'identity-not-verified'};}
    const nextKey=ident?.verified===true ? [ident.accountId,ident.candidateKey,ident.generation].join('|') : '';
    if(initializedOwnerKey && initializedOwnerKey!==nextKey){reset();}
    if(initPromise) return initPromise;
    initPromise=(async()=>{
      if(!instance && !establish())return {ready:false,reason:'trusted-binding-not-installed'};
      const before=provider.getVerifiedIdentitySync();
      if(!before?.verified || !clean(before.accountId) || !clean(before.candidateKey)||!clean(before.generation))return {ready:false,reason:'identity-not-verified'};
      const restored=instance.activateFromDisk();
      initializedOwnerKey=[before.accountId,before.candidateKey,before.generation].join('|');
      let frames;
      try { frames=await provider.listCommittedReceiverFrames(before); }
      catch (_) { frames=null; }
      if(!Array.isArray(frames)) return {ready:restored.enabled,offline:true,reason:'receiver-frames-not-ready',restored};
      const after=provider.getVerifiedIdentitySync();
      if(!after?.verified || after.accountId!==before.accountId || after.candidateKey!==before.candidateKey ||
        after.generation!==before.generation){instance.close();return {ready:false,reason:'account-or-authority-changed'};}
      const pending=typeof provider.listLocalPendingIds==='function' ? await provider.listLocalPendingIds(after) : null;
      if(!pending || !Array.isArray(pending.contextIds)||!Array.isArray(pending.sessionIds)) {
        return {ready:restored.enabled,offline:true,reason:'pending-outbox-inventory-not-confirmed',restored};
      }
      const confirmed=provider.getVerifiedIdentitySync();
      if(!confirmed?.verified || confirmed.accountId!==before.accountId || confirmed.candidateKey!==before.candidateKey ||
        confirmed.generation!==before.generation){instance.close();return {ready:false,reason:'account-changed'};}
      const result=instance.acceptCommitted({frames,legacyContexts:legacyContexts(),
        legacySessions:legacySessions(),pendingContextIds:pending.contextIds,pendingSessionIds:pending.sessionIds,
        originOwned:pending.originOwned||[]});
      // Queue persistence retries only; the callback MUST NOT transmit unknown
      // owner histories or auto-enable the OFF Cloud gate.
      void instance.replayPending().catch(()=>{});
      return {ready:true,restored,...result};
    })().catch(err=>({ready:false,reason:String(err?.message||err)}));
    const outcome=await initPromise;
    if(!outcome.ready || outcome.offline) initPromise=null; // retry after auth/network readiness
    return outcome;
  }
  function ready(){return !!instance && instance.count()>0;}
  function contexts(rawContexts=legacyContexts()){
    if(!ready())return rawContexts;
    return instance.readContexts(rawContexts,legacySessions());
  }
  function sessions(rawSessions=legacySessions()){
    if(!ready())return rawSessions;
    return instance.readSessions(rawSessions,legacyContexts());
  }
  function getContext(contextId){
    if(!ready())return null;
    const legacy=legacyContexts();
    if(legacy.some(c=>clean(c?.contextId)===clean(contextId)) &&
       !instance.isRemote(contextId,legacy,legacySessions()))return null;
    return instance.getContext(contextId,legacy,legacySessions());
  }
  function isRemoteContext(contextId){return ready() && instance.isRemote(contextId,legacyContexts(),legacySessions());}
  function isRemoteSession(sessionId){
    if(!ready())return false;
    return instance.isRemoteSession(sessionId,legacyContexts(),legacySessions());
  }
  function patchContext(contextId,patch){
    if(!isRemoteContext(contextId))return null;
    return instance.patchContext(contextId,patch,legacyContexts(),legacySessions());
  }
  // Explicit remote-only paired autosave. The regular WLP original localStorage
  // writer must be bypassed for this one imported Cloud Session. Ownership is
  // attested by the trusted receiver inventory, not inferred from local text.
  function saveRemoteStandardPair(contextId, session, contextPatch){
    if(!isRemoteContext(contextId) || !isRemoteSession(session?.sessionId))
      throw Error('E7b remote pair not active under verified account');
    const validator=provider?.validatePairedBodies;
    if(typeof validator!=='function') throw Error('E7b trusted paired body validator not installed');
    return instance.saveRemoteStandardPair({contextId,session,contextPatch,validateBodies:validator},
      legacyContexts(),legacySessions());
  }
  function saveSessionsFromStandard(sessions){
    if(!Array.isArray(sessions)) throw Error('E7b invalid session collection');
    const local=[];
    for(const s of sessions){
      if(isRemoteSession(s?.sessionId)){
        instance.saveRemoteSession(s,legacyContexts(),legacySessions());
      } else local.push(s);
    }
    return local;
  }
  async function retryLocalOutbox(){return instance?instance.replayPending():0;}
  function reset(){if(instance)instance.close();instance=null;provider=null;initPromise=null;initializedOwnerKey="";}
  return Object.freeze({initialize,ready,contexts,sessions,getContext,isRemoteContext,isRemoteSession,
    patchContext,saveRemoteStandardPair,saveSessionsFromStandard,retryLocalOutbox,reset});
});
