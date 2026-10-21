/* WLP G4-1 — verified E7b RECEIVED Standard history bridge, SOURCE CANDIDATE.
 * No automatic connection or activation. No remote request, writes, or SW use.
 * Only a trusted authentication/bootstrap path may call make(...).activate().
 * This bridge cross-checks account-scoped Continue Overlay against actual durable
 * E7b IndexedDB receiver frames supplied by the VERIFIED E7b inbox reader.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.WLPG4E7bVerifiedHistoryBridge=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const PREFIX='wlp:e7b:paired-continue:v1:';
  const str=x=>String(x??'').trim();
  const deep=x=>JSON.parse(JSON.stringify(x));
  function check(ok,why){if(!ok) throw Error('G4 E7b receiver HOLD: '+why);}
  function idOK(id){return id?.verified===true && !!str(id.accountId) && !!str(id.candidateKey) &&
    !!str(id.deviceKey) && !!str(id.generation) && Number.isSafeInteger(id.headVersion)&&id.headVersion>=1;}
  function same(a,b){return idOK(a)&&idOK(b) &&
    ['accountId','candidateKey','deviceKey','generation','headVersion'].every(k=>a[k]===b[k]);}
  function keyFor(id){return PREFIX+encodeURIComponent(id.accountId)+':'+encodeURIComponent(id.candidateKey);}
  const validRating=x=>['got-it','almost','not-yet','no-idea'].includes(str(x));
  function core(pair){
    const s=pair.session,c=pair.context;
    return JSON.stringify({
      contextId:pair.contextId,sessionId:pair.sessionId,revision:pair.serverRevision,token:pair.serverToken,
      sourceType:c.sourceType,wordIds:c.source.wordIds.map(str),contextStatus:c.status,
      sessionStatus:s.status,completedCount:c.progress.completedCount,
      experienceCount:s.experienceCount,experiences:s.experiences.map(e=>({
        wordId:str(e.wordId),eventId:str(e.attempt?.eventId),
        responseText:e.attempt?.responseText,selfRating:str(e.attempt?.selfRating)
      }))
    });
  }
  function verifyPair(p,id,tag){
    check(p&&typeof p==='object'&&p.accountId===id.accountId&&p.candidateKey===id.candidateKey,
      tag+' owner/authority mismatch');
    check(!!str(p.contextId)&&!!str(p.sessionId)&&str(p.serverToken)&&
      Number.isSafeInteger(p.serverRevision)&&p.serverRevision>=1,tag+' missing durable identity');
    const c=p.context,s=p.session;
    check(c&&s&&c.contextId===p.contextId&&s.sessionId===p.sessionId&&
      c.sessionRef?.sessionId===p.sessionId&&c.sessionRef?.type==='standard'&&c.practiceMode==='standard',
      tag+' Session/Context mismatch');
    check(s.status==='completed'&&c.status==='completed'&&
      p.pending!==true&&p.replayNeeded!==true&&p.conflict!==true&&p.hasPending!==true,
      tag+' not clean completed Session');
    check(Array.isArray(c.source?.wordIds)&&c.source.wordIds.length>=1&&
      c.source.wordIds.length<=20000&&c.source.wordIds.every(x=>/^\d+$/.test(str(x))),
      tag+' invalid Context source');
    check(Array.isArray(s.experiences)&&s.experiences.length>=1&&s.experiences.length<=1000&&
      Number(s.experienceCount)===s.experiences.length&&
      Number(c.progress?.completedCount)===s.experiences.length,
      tag+' progress/experience mismatch');
    const events=new Set(),wordIds=new Set(c.source.wordIds.map(str));
    for(const e of s.experiences){
      const ev=str(e?.attempt?.eventId);
      check(ev&&!events.has(ev)&&wordIds.has(str(e.wordId))&&
        typeof e.attempt?.responseText==='string'&&validRating(e.attempt?.selfRating),
        tag+' Event/response/rating mismatch');
      events.add(ev);
    }
  }
  function make({identityNow,receiver,storage,sourceFactory}={}){
    check(typeof identityNow==='function','trusted owner provider required');
    check(receiver&&typeof receiver.listCommittedReceiverFrames==='function'&&
      typeof receiver.readCursor==='function','existing verified durable inbox reader required');
    check(storage&&typeof storage.getItem==='function','account-scoped storage reader required');
    check(sourceFactory&&typeof sourceFactory.make==='function','verified Standard history adapter required');
    let activeReader=null;
    let approval=null;
    async function activate(){
      check(!approval,'already activated (no duplicate install)');
      const before=deep(identityNow());
      check(idOK(before),'verified Owner/Device/Authority required');
      const cursor=await receiver.readCursor();
      check(Number.isSafeInteger(cursor)&&cursor>=1,'missing receiver Cursor');
      const committed=await receiver.listCommittedReceiverFrames();
      check(Array.isArray(committed)&&committed.length<=10000,'unavailable receiver history');
      check(same(before,identityNow()),'identity changed during receiver read');
      const storageKey=keyFor(before),raw=storage.getItem(storageKey);
      check(typeof raw==='string','account Continue Overlay absent');
      let overlay;
      try{overlay=JSON.parse(raw);}catch(_){check(false,'Overlay JSON corrupt');}
      check(overlay&&overlay.version===1&&overlay.accountId===before.accountId&&
        overlay.candidateKey===before.candidateKey&&Array.isArray(overlay.pairs)&&
        overlay.pairs.length<=10000,'Overlay account/schema mismatch');
      const latest=new Map();
      for(const frame of committed){
        check(frame&&frame.receiverCommitted===true&&frame.hasPending===false,
          'frame not committed by actual inbox');
        // Other received Contexts are permitted: the overlay selects what is
        // available for normal history. Never require exactly two Contexts.
        check(frame.accountId===before.accountId&&frame.candidateKey===before.candidateKey,
          'cross-account receiver frame');
        check(!latest.has(str(frame.contextId)),'duplicate latest receiver Context');
        latest.set(str(frame.contextId),frame);
      }
      const accepted=[],sessionIds=new Set(),contextIds=new Set();
      for(const p of overlay.pairs){
        check(p&&p.accountId===before.accountId&&p.candidateKey===before.candidateKey,
          'Overlay entry owner mismatch');
        check(!contextIds.has(str(p.contextId))&&!sessionIds.has(str(p.sessionId)),
          'Overlay duplicate Context/Session');
        contextIds.add(str(p.contextId));sessionIds.add(str(p.sessionId));
        // Dirty edits must not be presented as acknowledged received history.
        if(p.pending===true||p.replayNeeded===true||p.conflict===true) continue;
        verifyPair(p,before,'Overlay');
        const durable=latest.get(str(p.contextId));
        check(durable,'Overlay lacks committed durable inbox Context');
        verifyPair(durable,before,'Inbox');
        check(core(p)===core(durable),'Overlay and Inbox revision/token/answer mismatch');
        accepted.push(deep(p));
      }
      check(same(before,identityNow()),'identity changed during Overlay verification');
      check(storage.getItem(storageKey)===raw,'Overlay changed during verification');
      const candidate=sourceFactory.make({
        identityNow,
        listCommittedPairs:()=>{
          check(same(before,identityNow()),'identity changed after activation');
          check(storage.getItem(storageKey)===raw,'Overlay changed after activation');
          return deep(accepted);
        }
      });
      candidate.activateVerified();
      check(candidate.isReady(),'adapter activation unsuccessful');
      activeReader=candidate;
      approval=Object.freeze({accountId:before.accountId,candidateKey:before.candidateKey,
        generation:before.generation,deviceKey:before.deviceKey,cursor,received:committed.length,
        accepted:accepted.length});
      return Object.freeze({reader:candidate,report:approval});
    }
    function readStatus(){return approval ? {...approval,ready:activeReader.isReady()} : {ready:false};}
    return Object.freeze({activate,readStatus});
  }
  return Object.freeze({make,keyFor});
});
