/* G4-1 READ-ONLY Standard Practice history source seam.
 * Source candidate, intentionally inert when loaded by the normal WLP page.
 * There is NO auto-install, no user/URL flag, no Cloud call, no storage write.
 * A separately reviewed trusted E7b receiver can supply an authenticated
 * account-scoped provider only after owner/device/authority verification.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WLPG4StandardHistoryAdapter=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const text=x=>String(x??'').trim();
  const copy=x=>JSON.parse(JSON.stringify(x));
  function assert(ok,message){if(!ok)throw Error('G4 HISTORY HOLD: '+message);}
  function sameId(a,b){return a.accountId===b.accountId&&a.candidateKey===b.candidateKey&&a.generation===b.generation;}
  function identityOk(x){return x?.verified===true&&!!text(x.accountId)&&!!text(x.candidateKey)&&!!text(x.generation);}
  function make({identityNow,listCommittedPairs}={}) {
    assert(typeof identityNow==='function'&&typeof listCommittedPairs==='function','trusted identity and receiver required');
    let approved=false;
    const knownRemoteIds=new Set(); // Once seen, keep legacy rating edit locked if identity later expires.
    function activateVerified(){
      const id=identityNow();
      assert(identityOk(id),'verified account/authority unavailable');
      approved=true;return {ready:true};
    }
    function isReady(){
      if(!approved)return false;
      try{return identityOk(identityNow());}catch(_){return false;}
    }
    function mergeSessions(localSessions){
      assert(Array.isArray(localSessions),'local history invalid');
      if(!approved)return localSessions;
      const before=identityNow();
      assert(identityOk(before),'owner not verified');
      const remote=listCommittedPairs(copy(before));
      assert(Array.isArray(remote),'durable receiver pairs unavailable');
      assert(remote.length<=10000,'excess receiver pairs');
      const ids=new Set(localSessions.map(x=>text(x?.sessionId)).filter(Boolean));
      const contextIds=new Set();
      const accepted=[];
      for(const pair of remote){
        assert(pair&&typeof pair==='object','invalid receiver pair');
        assert(text(pair.accountId)===before.accountId&&text(pair.candidateKey)===before.candidateKey,
          'received pair owner/authority mismatch');
        const sid=text(pair.sessionId),cid=text(pair.contextId);
        assert(!!sid&&!!cid&&sid===text(pair.session?.sessionId)&&cid===text(pair.context?.contextId),
          'received Session/Context identity mismatch');
        assert(!ids.has(sid)&&!contextIds.has(cid),'local or received Session collision');
        // Do not import incomplete, pending, unverified, or conflicted Cloud history.
        assert(pair.pending!==true&&pair.replayNeeded!==true&&pair.conflict!==true,
          'pending/conflicted received Session is not approved for history');
        assert(Number.isInteger(pair.serverRevision)&&pair.serverRevision>=1,'received revision invalid');
        const s=pair.session,c=pair.context;
        assert(s?.status==='completed'&&c?.status==='completed', 'received Session not completed');
        const exp=s.experiences;
        assert(Array.isArray(exp)&&exp.length>0&&exp.length<=1000,'received experiences invalid');
        assert(Number(s.experienceCount)===exp.length&&Number(c.progress?.completedCount)===exp.length,
          'received progress does not match experiences');
        const eventIds=new Set();
        for(const e of exp){
          const ev=text(e?.attempt?.eventId);
          assert(ev&&!eventIds.has(ev),'missing/duplicate durable Event ID');
          eventIds.add(ev);
        }
        ids.add(sid);contextIds.add(cid);
        accepted.push(copy(s));
      }
      const after=identityNow();
      assert(identityOk(after)&&sameId(before,after),'authority changed while reading');
      for(const s of accepted)knownRemoteIds.add(s.sessionId);
      return localSessions.concat(accepted); // Never mutate existing history arrays/objects.
    }
    function isCloudSession(sessionId){return knownRemoteIds.has(text(sessionId));}
    return Object.freeze({activateVerified,isReady,mergeSessions,isCloudSession});
  }
  return Object.freeze({make});
});
