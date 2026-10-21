/* WLP P1-E7b Continue Pair Gate — DEVELOPMENT ONLY, no side effects.
 * Validates account-scoped received Standard Session+Study Context pairs against
 * actual legacy WLP Resume semantics before ANY hydration or UI publication.
 * Does not transport, adopt legacy history, write storage, or claim resumability.
 * Caller must already have verified auth/Authority and durable receiver commit.
 */
(function(root, make) {
  const api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WLPE7bContinuePairGate = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  const clean = x => String(x ?? '').trim();
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const numericWID = x => /^\d+$/.test(clean(x));
  const isNum = n => Number.isSafeInteger(n) && n >= 0;
  const sortTime = pair => Date.parse(pair.context.lastMeaningfulAt || pair.context.createdAt || 0) || 0;
  function reject(code) { throw new Error('E7b Continue blocked: ' + code); }
  function validIdentity(id) {
    if (!isObj(id) || !clean(id.accountId) || !clean(id.candidateKey)) reject('missing-verified-account-authority');
    return { accountId: clean(id.accountId), candidateKey: clean(id.candidateKey) };
  }
  function validatePair(frame, identity) {
    const id = validIdentity(identity);
    if (!isObj(frame) || frame.accountId !== id.accountId || frame.candidateKey !== id.candidateKey) reject('wrong-account-or-authority');
    // A staging/local outbox entry is NOT a confirmed receiver pair.
    if (frame.hasPending !== false || !isNum(frame.serverRevision) || frame.serverRevision < 1 ||
        !clean(frame.serverToken) || frame.receiverCommitted !== true) reject('uncommitted-or-pending-receiver-pair');
    const context = frame.context, session = frame.session;
    if (!isObj(context) || !isObj(session)) reject('incomplete-context-session-pair');
    const cid = clean(context.contextId), sid = clean(session.sessionId);
    if (!cid || !sid || clean(context.sessionRef?.sessionId) !== sid || context.sessionRef?.type !== 'standard') reject('context-session-id-mismatch');
    if (frame.contextId && frame.contextId !== cid) reject('frame-context-id-mismatch');
    if (frame.sessionId && frame.sessionId !== sid) reject('frame-session-id-mismatch');
    if (context.practiceMode !== 'standard' || !['deck','range','review-set'].includes(context.sourceType)) reject('unsupported-practice-or-source');
    const ids = context.source?.wordIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20000 ||
        !ids.every(numericWID) || new Set(ids.map(clean)).size !== ids.length) reject('invalid-ordered-context-wids');
    if (!['incomplete', 'ended-early','completed'].includes(session.status)) reject('unsupported-standard-session-status');
    if (session.status === 'completed' ? context.status !== 'completed' : !['active','incomplete'].includes(context.status)) reject('completion-status-mismatch');
    const subset = session.wordIds, exps = session.experiences;
    if (!Array.isArray(subset) || !subset.length || !Array.isArray(exps) || exps.length !== subset.length ||
        new Set(subset.map(clean)).size !== subset.length) reject('missing-or-duplicate-session-experiences');
    let last = -1;
    for (let i = 0; i < subset.length; i++) {
      const word = clean(subset[i]);
      const next = ids.findIndex(x => clean(x) === word);
      if (next <= last) reject('session-card-order-not-a-subsequence');
      if (!isObj(exps[i]) || clean(exps[i].wordId) !== word || !isObj(exps[i].attempt)) reject('missing-or-mismatched-original-attempt');
      last = next;
    }
    const p = context.progress;
    if (!isObj(p) || !isNum(p.currentIndex) || !isNum(p.totalCount) ||
        !isNum(p.completedCount) || p.completedCount > p.totalCount ||
        p.totalCount < subset.length || p.currentIndex > p.totalCount ||
        !Array.isArray(p.completedWordIds) || !p.completedWordIds.every(x => ids.some(w => clean(w) === clean(x)))) reject('invalid-progress');
    // The existing WLP deliberately clears completedWordIds at completion.
    // Do not impose monotonic completed IDs or infer them from counts.
    if (JSON.stringify({context, session}).length > 3 * 1024 * 1024) reject('pair-exceeds-size-limit');
    return { contextId: cid, sessionId: sid, context: clone(context), session: clone(session),
      accountId: id.accountId, candidateKey: id.candidateKey, serverRevision: frame.serverRevision,
      serverToken: frame.serverToken };
  }
  // The caller's originOwned list comes exclusively from the trusted E7b
  // Journal IDB owner/ACK proof, never a caller-invented legacy Context.
  function mayReturnToOrigin(pair, originalContext, originalSession, proof) {
    if (!originalContext || !originalSession || !proof ||
        proof.contextId !== pair.contextId || proof.sessionId !== pair.sessionId ||
        !Number.isSafeInteger(proof.serverRevision) || proof.serverRevision < 1 ||
        pair.serverRevision <= proof.serverRevision || !clean(proof.serverToken) ||
        clean(originalContext.sessionRef?.sessionId) !== pair.sessionId ||
        clean(originalSession.sessionId) !== pair.sessionId ||
        originalContext.practiceMode !== 'standard' ||
        originalSession.status === 'completed' ||
        !['incomplete','ended-early'].includes(originalSession.status) ||
        !same(originalContext.source?.wordIds, pair.context.source?.wordIds)) return false;
    // The origin must be an actual prefix of the newly received session. Its
    // original answers, ratings and event identities may NOT disappear/change.
    const local = originalSession.experiences, remote = pair.session.experiences;
    if (!Array.isArray(local) || !local.length || !Array.isArray(remote) ||
        remote.length < local.length ||
        Number(pair.context.progress?.completedCount) < Number(originalContext.progress?.completedCount)) return false;
    for (let i=0;i<local.length;i++) {
      const a=local[i],b=remote[i];
      if (clean(a?.wordId)!==clean(b?.wordId) ||
          !a?.attempt || !b?.attempt ||
          ['eventId','wordId','responseText','selfRating'].some(k=>clean(a.attempt[k])!==clean(b.attempt[k]))) return false;
    }
    return true;
  }
  function planHydration({identity, frames, localContexts, localSessions, pendingContextIds = [], pendingSessionIds = [], originOwned = []}) {
    validIdentity(identity);
    if (![frames, localContexts, localSessions, pendingContextIds, pendingSessionIds, originOwned].every(Array.isArray)) reject('missing-current-local-inventory');
    const originalOwners=new Map();
    for (const o of originOwned) {
      if (!clean(o?.contextId) || originalOwners.has(o.contextId)) reject('duplicate-or-invalid-origin-proof');
      originalOwners.set(o.contextId,o);
    }
    const originalContext = new Map(), originalSession = new Map(), ownersOfSession = new Map();
    for (const c of localContexts) {
      if (!clean(c?.contextId)) reject('invalid-existing-local-context');
      if (originalContext.has(clean(c.contextId))) reject('ambiguous-local-context-id');
      originalContext.set(clean(c.contextId), c);
      const sid = clean(c.sessionRef?.sessionId);
      if (sid) {
        if (ownersOfSession.has(sid) && ownersOfSession.get(sid) !== clean(c.contextId)) reject('ambiguous-local-session-binding');
        ownersOfSession.set(sid, clean(c.contextId));
      }
    }
    for (const s of localSessions) {
      if (!clean(s?.sessionId)) reject('invalid-existing-local-session');
      if (originalSession.has(clean(s.sessionId))) reject('ambiguous-local-session-id');
      originalSession.set(clean(s.sessionId), s);
    }
    const pendingContext = new Set(pendingContextIds.map(clean)), pendingSession = new Set(pendingSessionIds.map(clean));
    const eligible = [], blocked = [], skippedLocal = [], counts = new Map(), sidCounts = new Map();
    for (const f of frames) {
      const key = clean(f?.contextId || f?.context?.contextId), sid = clean(f?.sessionId || f?.session?.sessionId);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
      if (sid) sidCounts.set(sid, (sidCounts.get(sid) || 0) + 1);
    }
    for (const f of frames) {
      let pair;
      try { pair = validatePair(f, identity); }
      catch (err) { blocked.push({contextId: clean(f?.contextId || f?.context?.contextId), reason: String(err.message)});continue; }
      const {contextId: cid, sessionId: sid} = pair;
      if (counts.get(cid) !== 1 || sidCounts.get(sid) !== 1) { blocked.push({contextId: cid, reason: 'ambiguous-received-pair'}); continue; }
      if (pendingContext.has(cid) || pendingSession.has(sid)) { blocked.push({contextId: cid, reason: 'unsent-local-changes-have-priority'});continue; }
      const oldCtx = originalContext.get(cid), oldSess = originalSession.get(sid);
      if (oldCtx || oldSess || ownersOfSession.has(sid)) {
        const origin=originalOwners.get(cid);
        if (ownersOfSession.get(sid)===cid &&
            mayReturnToOrigin(pair,oldCtx,oldSess,origin)) {
          eligible.push({...pair,shadowOriginal:{context:clone(oldCtx),session:clone(oldSess)},
            originRevision:origin.serverRevision,originToken:origin.serverToken});
        } else {
          skippedLocal.push({contextId:cid,reason:'local-collision-without-verified-ACKed-origin'});
        }
        continue;
      }
      eligible.push(pair);
    }
    eligible.sort((a,b) => sortTime(b) - sortTime(a));
    return Object.freeze({eligible, blocked, skippedLocal,
      counts: Object.freeze({received: frames.length, eligible: eligible.length, blocked: blocked.length,
        skippedLocal: skippedLocal.length}),
      // NON-DEPLOYABLE preview. NOTHING may be offered in Continue before
      // a separate account-safe, restart-durable and recoverable materialization.
      materializationCommitted: false, continuePublished: false, writes: 0});
  }
  return Object.freeze({validatePair, planHydration, mayReturnToOrigin});
});
