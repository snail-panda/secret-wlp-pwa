/* WLP P1-E7b — ACCOUNT-BOUND, DURABLE CONTINUE OVERLAY, DEV ONLY.
 * No cloud calls, no automatic owner adoption, no global localStorage modifications.
 * Only activate via a TRUSTED, pre-verified, account+Authority identity provider and
 * trusted paired receiver plus durable local outbox capture callback.
 * Sync readers remain synchronous; all writes are transactional at the pair JSON
 * record level using one synchronous, account-namespaced localStorage setItem.
 * Pending state NEVER cleared merely because the capture callback ran.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WLPE7bContinueDurableOverlay = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const VERSION = 1;
  const KEY_PREFIX = 'wlp:e7b:paired-continue:v1:';
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const clean = v => String(v ?? '').trim();
  const deep = v => JSON.parse(JSON.stringify(v));
  function error(message) { throw Error('E7b Continue overlay blocked: ' + message); }
  function assert(x, name) { if (!x) error(name); }
  function identityEquals(a, b) {
    return !!a && !!b && a.verified === true && b.verified === true &&
      clean(a.accountId) === clean(b.accountId) && clean(a.candidateKey) === clean(b.candidateKey) &&
      clean(a.generation) === clean(b.generation) && clean(a.generation).length > 0;
  }
  function identityKey(id) { return KEY_PREFIX + encodeURIComponent(id.accountId) + ':' + encodeURIComponent(id.candidateKey); }
  function hasCollision(pair, legacyContexts, legacySessions) {
    return legacyContexts.some(c => clean(c?.contextId) === pair.contextId || clean(c?.sessionRef?.sessionId) === pair.sessionId) ||
      legacySessions.some(s => clean(s?.sessionId) === pair.sessionId);
  }
  function make({storage, gate, identityNow, onPairPending}) {
    assert(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function', 'storage-unavailable');
    assert(gate && typeof gate.planHydration === 'function' && typeof gate.validatePair === 'function', 'gate-unavailable');
    assert(typeof identityNow === 'function', 'trusted-identity-required');
    assert(typeof onPairPending === 'function', 'durable-outbox-writer-required');
    let bound = null;
    let pairs = new Map();
    function current() {
      const id = identityNow();
      if (!identityEquals(id, bound)) {
        pairs = new Map(); bound = null; return null;
      }
      return id;
    }
    function stored(id) {
      let raw;
      try { raw = storage.getItem(identityKey(id)); } catch (_) { error('local-storage-read-failed'); }
      if (raw === null) return [];
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { error('local-storage-corrupt'); }
      assert(isObj(parsed) && parsed.version === VERSION && parsed.accountId === id.accountId &&
        parsed.candidateKey === id.candidateKey && Array.isArray(parsed.pairs), 'stored-owner-or-schema-mismatch');
      assert(parsed.pairs.length <= 10000, 'stored-pair-count-invalid');
      return parsed.pairs;
    }
    function persist(id, candidate) {
      assert(identityEquals(id, identityNow()), 'account-changed-before-local-write');
      const payload = JSON.stringify({version:VERSION, accountId:id.accountId,
        candidateKey:id.candidateKey, pairs:Array.from(candidate.values())});
      try { storage.setItem(identityKey(id),payload); }
      catch (_) { error('durable-local-write-failed'); }
      assert(identityEquals(id, identityNow()), 'account-changed-after-local-write');
      pairs = candidate;
    }
    function pairShape(p) {
      assert(isObj(p) && isObj(p.context) && isObj(p.session) &&
        clean(p.contextId) === clean(p.context.contextId) &&
        clean(p.sessionId) === clean(p.session.sessionId) &&
        clean(p.context.sessionRef?.sessionId) === clean(p.sessionId) &&
        p.context.sessionRef?.type === 'standard' && p.context.practiceMode === 'standard' &&
        ['incomplete','ended-early','completed'].includes(p.session.status) &&
        ['active','incomplete','completed'].includes(p.context.status) &&
        Array.isArray(p.session.experiences) && Array.isArray(p.context.source?.wordIds) &&
        p.context.source.wordIds.length > 0, 'corrupt-pair');
    }
    function activateFromDisk() {
      const id = identityNow();
      if (!isObj(id) || id.verified !== true || !clean(id.accountId) || !clean(id.candidateKey) || !clean(id.generation)) {
        bound = null; pairs = new Map(); return {restored:0, enabled:false};
      }
      const persisted = stored(id);
      const next = new Map();
      for (const p of persisted) {
        pairShape(p);
        assert(p.accountId === id.accountId && p.candidateKey === id.candidateKey, 'stored-pair-owner-mismatch');
        assert(!next.has(p.contextId), 'duplicate-stored-context');
        next.set(p.contextId, deep(p));
      }
      if (!identityEquals(id, identityNow())) error('identity-changed-during-restore');
      bound = deep(id); pairs = next;
      return {restored: next.size, enabled:true};
    }
    function acceptCommitted({frames, legacyContexts, legacySessions, pendingContextIds = [], pendingSessionIds = [], originOwned = []}) {
      const id = current(); assert(id, 'not-verified');
      assert(Array.isArray(frames) && Array.isArray(legacyContexts) && Array.isArray(legacySessions), 'missing-input-inventory');
      // Receiver metadata MUST be constructed by the caller from a successful,
      // trusted, atomic IndexedDB transaction, never copied from untrusted RPC JSON.
      const plan = gate.planHydration({identity:id, frames, localContexts:legacyContexts,
        localSessions:legacySessions, pendingContextIds, pendingSessionIds, originOwned});
      const next = new Map(pairs);
      const accepted = [], preserved = [], rejected = [];
      for (const pair of plan.eligible) {
        if (hasCollision(pair,legacyContexts,legacySessions) && !pair.shadowOriginal) {
          rejected.push(pair.contextId);continue;
        }
        const old = next.get(pair.contextId);
        if (old) {
          // Pending local edits always win, including after restart.
          if (old.pending === true) {preserved.push(pair.contextId);continue;}
          if (old.sessionId !== pair.sessionId || pair.serverRevision < old.serverRevision) {
            rejected.push(pair.contextId); continue;
          }
          if (pair.serverRevision === old.serverRevision && pair.serverToken !== old.serverToken) {
            rejected.push(pair.contextId); continue;
          }
        }
        // When a newer received frame lands, preserve the INITIAL trusted
        // local ACK witness so its original projection stays immutable.
        const original=old?.shadowOriginal||pair.shadowOriginal;
        next.set(pair.contextId, {...pair, ...(original?{shadowOriginal:original}:{}),
          pending:false, replayNeeded:false});
        accepted.push(pair.contextId);
      }
      if (accepted.length) persist(id,next);
      return {received:frames.length,accepted,preserved,rejected,blocked:plan.blocked,skippedLocal:plan.skippedLocal};
    }
    function available(legacyContexts = [],legacySessions = []) {
      const id = current(); if (!id) return [];
      if (!Array.isArray(legacyContexts) || !Array.isArray(legacySessions)) return [];
      // Shadow only an unchanged, verified ORIGINAL local projection. Any
      // unrelated collision or later modification restores the normal HOLD.
      const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
        Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
      const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
      return [...pairs.values()].filter(p=>{
        if(!hasCollision(p,legacyContexts,legacySessions))return true;
        if(!p.shadowOriginal)return false;
        const cs=legacyContexts.filter(c=>clean(c?.contextId)===p.contextId);
        const ss=legacySessions.filter(s=>clean(s?.sessionId)===p.sessionId);
        return cs.length===1&&ss.length===1&&
          same(cs[0],p.shadowOriginal.context)&&same(ss[0],p.shadowOriginal.session)&&
          !legacyContexts.some(c=>clean(c?.contextId)!==p.contextId&&clean(c?.sessionRef?.sessionId)===p.sessionId);
      });
    }
    function readContexts(legacyContexts,legacySessions) {
      assert(Array.isArray(legacyContexts)&&Array.isArray(legacySessions),'legacy-inventory-missing');
      const published=available(legacyContexts,legacySessions);
      const shadows=new Set(published.filter(p=>p.shadowOriginal).map(p=>p.contextId));
      return [...deep(legacyContexts.filter(c=>!shadows.has(clean(c?.contextId)))),...published.map(p=>deep(p.context))]
        .sort((a,b)=>(Date.parse(b.lastMeaningfulAt||b.createdAt||0)||0)-(Date.parse(a.lastMeaningfulAt||a.createdAt||0)||0));
    }
    function readSessions(legacySessions,legacyContexts) {
      assert(Array.isArray(legacyContexts)&&Array.isArray(legacySessions),'legacy-inventory-missing');
      const published=available(legacyContexts,legacySessions);
      const shadows=new Set(published.filter(p=>p.shadowOriginal).map(p=>p.sessionId));
      return [...deep(legacySessions.filter(s=>!shadows.has(clean(s?.sessionId)))),...published.map(p=>deep(p.session))];
    }
    function getContext(contextId,legacyContexts,legacySessions) {
      return readContexts(legacyContexts,legacySessions).find(c => clean(c?.contextId)===clean(contextId)) || null;
    }
    function isRemote(contextId,legacyContexts=[],legacySessions=[]) {
      return available(legacyContexts,legacySessions).some(p=>p.contextId===clean(contextId));
    }
    function isRemoteSession(sessionId,legacyContexts=[],legacySessions=[]){
      return available(legacyContexts,legacySessions).some(p=>p.sessionId===clean(sessionId));
    }
    function updatePair(contextId, {context, session}, legacyContexts = [], legacySessions = []) {
      const id = current(); assert(id,'identity-not-verified');
      assert(Array.isArray(legacyContexts)&&Array.isArray(legacySessions),'legacy-inventory-missing');
      const old = pairs.get(clean(contextId));
      assert(old && available(legacyContexts,legacySessions).some(p=>p.contextId===old.contextId),
        'pair-not-owned-or-unverified-local-collision');
      assert(isObj(context) || isObj(session),'empty-update');
      const nextPair = deep(old);
      if (context) nextPair.context=deep(context);
      if (session) nextPair.session=deep(session);
      pairShape(nextPair);
      nextPair.pending=true;
      nextPair.replayNeeded=true;
      nextPair.localRevision=(Number(old.localRevision)||0)+1;
      const next=new Map(pairs); next.set(nextPair.contextId,nextPair);
      persist(id,next); // MUST finish sync durable write before returning a saved state.
      // Asynchronous account-bound capture is separate: inability to enqueue cannot
      // erase locally durable dirty pair or mark it as uploaded/ACKed.
      try { Promise.resolve(onPairPending(deep(nextPair),deep(id))).catch(()=>{}); } catch (_) {}
      return deep(nextPair);
    }
    // Paired Standard autosave: one account-scoped durable write, one pending
    // revision callback. Never publish a partially updated Session/Context.
    // The production paired contract MUST be supplied by the trusted caller;
    // no public unverified toggle can turn this into a transport writer.
    function saveRemoteStandardPair({contextId, session, contextPatch, validateBodies},
                                    legacyContexts = [], legacySessions = []) {
      const id = current(); assert(id, 'identity-not-verified');
      assert(typeof validateBodies === 'function', 'paired-contract-validation-required');
      assert(Array.isArray(legacyContexts) && Array.isArray(legacySessions), 'legacy-inventory-missing');
      const old = pairs.get(clean(contextId));
      assert(old && available(legacyContexts,legacySessions).some(p=>p.contextId===old.contextId),
        'pair-not-owned-or-unverified-local-collision');
      assert(isObj(session) && clean(session.sessionId) === old.sessionId, 'session-ref-mismatch');
      assert(isObj(contextPatch), 'context-update-required');
      const context = {...deep(old.context), ...deep(contextPatch),
        source: contextPatch.source ? {...deep(old.context.source), ...deep(contextPatch.source)} : deep(old.context.source),
        progress: contextPatch.progress ? {...deep(old.context.progress), ...deep(contextPatch.progress)} : deep(old.context.progress),
        sessionRef: contextPatch.sessionRef ? {...deep(old.context.sessionRef), ...deep(contextPatch.sessionRef)} : deep(old.context.sessionRef)};
      assert(clean(context.contextId) === old.contextId &&
        clean(context.sessionRef?.sessionId) === old.sessionId &&
        context.sessionRef?.type === 'standard', 'immutable-pair-identity-changed');
      assert(JSON.stringify(context.source?.wordIds) === JSON.stringify(old.context.source?.wordIds),
        'ordered-source-identity-changed');
      assert(context.status === (session.status === 'completed' ? 'completed' : 'incomplete'),
        'paired-completion-status-mismatch');
      validateBodies(context, session); // the SAME SQL-paired Wire contract as the uploader
      const written = updatePair(contextId, {context, session}, legacyContexts, legacySessions);
      return {context:deep(written.context), session:deep(written.session), localRevision:written.localRevision};
    }
    function patchContext(contextId, patch, legacyContexts = [], legacySessions = []) {
      const old = pairs.get(clean(contextId));
      assert(old,'context-not-present');
      const changed = typeof patch === 'function' ? patch(deep(old.context)) : patch;
      assert(isObj(changed),'invalid-context-patch');
      const base = old.context;
      const context = {...base,...deep(changed),
        source: changed.source ? {...base.source,...deep(changed.source)} : base.source,
        progress: changed.progress ? {...base.progress,...deep(changed.progress)} : base.progress,
        sessionRef:changed.sessionRef ? {...base.sessionRef,...deep(changed.sessionRef)}:base.sessionRef};
      return updatePair(contextId,{context},legacyContexts,legacySessions).context;
    }
    function saveRemoteSession(session,legacyContexts=[],legacySessions=[]) {
      assert(isObj(session)&&clean(session.sessionId),'invalid-session');
      const matches=available(legacyContexts,legacySessions).filter(p=>p.sessionId===session.sessionId);
      assert(matches.length===1,'session-not-unambiguously-owned');
      return updatePair(matches[0].contextId,{session},legacyContexts,legacySessions).session;
    }
    function acknowledgeLocalRevision(contextId, localRevision, receipt) {
      const id=current(); assert(id,'identity-not-verified');
      const old=pairs.get(clean(contextId));
      assert(old && old.pending === true, 'missing-pending-pair');
      assert(isObj(receipt) && receipt.trusted === true && Number.isSafeInteger(receipt.serverRevision) &&
        receipt.serverRevision > old.serverRevision && clean(receipt.serverToken), 'invalid-server-ack');
      // The authenticated transport must correlate the receipt to the ORIGINAL
      // immutable action and local revision; never infer ACK from an RPC payload.
      assert(Number(localRevision) === old.localRevision,'stale-ack-must-not-clear-newer-local-work');
      const next=new Map(pairs);
      next.set(old.contextId,{...old,pending:false,replayNeeded:false,
        serverRevision:receipt.serverRevision,serverToken:receipt.serverToken});
      persist(id,next);
      return true;
    }
    // Internal-only bridge from a durable IndexedDB remote-REVISE ACK.
    // Caller MUST first verify the persisted immutable Action + applied ACK in IDB.
    // Unlike acknowledgeLocalRevision(), an older ACK advances the server base
    // while leaving newer unsent local answers and progress pending.
    function rebaseAcknowledgedRemoteRevision(contextId, receipt) {
      const id=current(); assert(id,'identity-not-verified');
      assert(isObj(receipt) && receipt.source==='e7b-idb-remote-ack-v1' &&
        clean(receipt.actionId) && Number.isSafeInteger(receipt.localRevision) && receipt.localRevision>0 &&
        Number.isSafeInteger(receipt.baseServerRevision) && receipt.baseServerRevision>0 &&
        clean(receipt.baseServerToken) && Number.isSafeInteger(receipt.serverRevision) &&
        receipt.serverRevision===receipt.baseServerRevision+1 && clean(receipt.serverToken), 'invalid-durable-remote-ack');
      const old=pairs.get(clean(contextId));assert(old,'remote-pair-not-present');
      const persisted=stored(id).find(p=>p.contextId===clean(contextId));
      assert(persisted && JSON.stringify(persisted)===JSON.stringify(old),
        'Continue overlay changed in another tab; reload before ACK rebase');
      assert(old.accountId===id.accountId && old.candidateKey===id.candidateKey &&
        old.localRevision>=receipt.localRevision,'ACK pair owner or local revision mismatch');
      if(old.serverRevision===receipt.serverRevision && old.serverToken===receipt.serverToken){
        return {status:'already-rebased',pending:old.pending===true};
      }
      assert(old.serverRevision===receipt.baseServerRevision && old.serverToken===receipt.baseServerToken,
        'server revision/token has changed; never overwrite newer state');
      const stillPending=old.localRevision>receipt.localRevision;
      const next=new Map(pairs);
      next.set(old.contextId,{...old,serverRevision:receipt.serverRevision,serverToken:receipt.serverToken,
        pending:stillPending,replayNeeded:stillPending});
      persist(id,next);
      return {status:'rebased',pending:stillPending};
    }
    // The remote uploader may coexist with the ORIGINAL ACKed Chrome Journal
    // only when its immutable enrollment/ACK baseline and compatibility
    // projection still exactly match the provenance saved at Cloud receive.
    // This is read-only and does not promote the original Journal action.
    function hasVerifiedOriginShadow(contextId,heads=[],outbox=[],proof=null){
      const id=current(),p=pairs.get(clean(contextId));
      if(!id||!p?.shadowOriginal||!Array.isArray(heads)||!Array.isArray(outbox))return false;
      const original=p.shadowOriginal;
      const read=key=>{try{const v=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}};
      const cs=read('wlp:study-contexts:v1').filter(c=>clean(c?.contextId)===p.contextId);
      const ss=read('wlp:studyq-sessions:v1').filter(s=>clean(s?.sessionId)===p.sessionId);
      const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
        Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
      const eq=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
      if(cs.length!==1||ss.length!==1||!eq(cs[0],original.context)||!eq(ss[0],original.session))return false;
      const match=r=>r?.accountId===id.accountId&&r?.deviceKey===id.deviceKey&&
        r?.candidateKey===id.candidateKey&&Number(r?.headVersion)===Number(id.headVersion)&&r?.contextId===p.contextId;
      const hs=heads.filter(match),os=outbox.filter(match);
      if(hs.length!==1||!os.length||os.some(o=>o.sessionId!==p.sessionId||o.status!=='acked'||o.transportEligible!==true))return false;
      const h=hs[0];
      if(h.sessionId!==p.sessionId||h.hasPending!==false||!h.pairHash||
        h.serverRevision!==p.originRevision||h.serverToken!==p.originToken||
        !eq(h.session,original.session)||!eq(h.context?.progress,original.context?.progress)||
        !eq(h.context?.source?.wordIds,original.context?.source?.wordIds))return false;
      return !proof||(proof.pairHash===h.pairHash&&proof.serverRevision===h.serverRevision&&proof.serverToken===h.serverToken);
    }
    function pendingForReplay() {return current()?[...pairs.values()].filter(p=>p.pending===true).map(deep):[];}
    async function replayPending() {
      const id=current(); if (!id) return 0;
      const pending = pendingForReplay(); let sent=0;
      for(const p of pending){
        if(!identityEquals(id,identityNow())) break;
        try{await onPairPending(deep(p),deep(id)); sent++;}
        catch(_){} // remain pending until explicit Cloud ACK/revision reconciliation
      }
      return sent;
    }
    function count() {return current()?pairs.size:0;}
    function close() {bound=null;pairs=new Map();}
    return Object.freeze({activateFromDisk,acceptCommitted,readContexts,readSessions,getContext,
      isRemote,isRemoteSession,hasVerifiedOriginShadow,patchContext,saveRemoteSession,saveRemoteStandardPair,acknowledgeLocalRevision,rebaseAcknowledgedRemoteRevision,pendingForReplay,replayPending,count,close});
  }
  return Object.freeze({make,VERSION,KEY_PREFIX});
});
