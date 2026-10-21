/* WLP P1-E7b: Remote Continue -> account-bound durable staged journal.
 * DEVELOPMENT/HOLD ONLY. No automatic network sending, no Local-only adoption.
 * A remote-resumed pair must first be committed by trusted receiver to IndexedDB,
 * then written as a complete pair by Continue overlay to account-scoped storage.
 * This component persists immutable remote-revision snapshots to the EXISTING
 * journal's meta store, without setting existing new-session transportEligible.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bRemoteRevisionJournalDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const Wire=typeof module==='object'&&module.exports?require('./wlp-e7b-paired-wire-contract-dev.js'):root.WLPE7bPairedWireDEV;
const DB='wlp-study-context-sync-v1', PREFIX='e7b:remote-revise-stage:v1:',OVERLAY='wlp:e7b:paired-continue:v1:';
const copy=x=>JSON.parse(JSON.stringify(x));
const clean=x=>String(x??'').trim();
const check=(ok,why)=>{if(!ok)throw Error('E7b remote journal blocked: '+why);};
function cryptoAPI(){return root?.crypto?.subtle?root.crypto:require('node:crypto').webcrypto;}
async function pairHash(pair){const b=new TextEncoder().encode(JSON.stringify({context:pair.context,session:pair.session}));
 const hash=await cryptoAPI().subtle.digest('SHA-256',b);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function ownerPrefix(id){return `${id.accountId}|${id.deviceKey}|${id.candidateKey}|${id.headVersion}|`;}
function stageHeadKey(id,contextId){return PREFIX+ownerPrefix(id)+encodeURIComponent(contextId)+':head';}
function stageRevisionKey(id,contextId,localRevision){return PREFIX+ownerPrefix(id)+encodeURIComponent(contextId)+':rev:'+String(localRevision).padStart(12,'0');}
function overlayKey(id){return OVERLAY+encodeURIComponent(id.accountId)+':'+encodeURIComponent(id.candidateKey);}
function same(a,b){return Wire.sameIdentity(a,b);}
function make({indexedDB,storage,identityNow,approvedStage=false,randomUUID=()=>cryptoAPI().randomUUID()}={}){
 check(indexedDB?.open&&storage?.getItem&&typeof identityNow==='function','trusted storage/identity required');
 const current=()=>Wire.normalizeIdentity(identityNow());
 function readOverlay(id,contextId){
  const raw=storage.getItem(overlayKey(id));check(raw!==null,'account-bound Continue overlay absent');
  let doc;try{doc=JSON.parse(raw);}catch(_){check(false,'invalid overlay JSON');}
  check(doc?.version===1&&doc?.accountId===id.accountId&&doc?.candidateKey===id.candidateKey&&Array.isArray(doc.pairs),'overlay owner/schema mismatch');
  const matches=doc.pairs.filter(p=>p.contextId===contextId);
  check(matches.length===1,'one existing account-bound Continue pair required');
  const pair=matches[0];check(pair.pending===true&&pair.replayNeeded===true&&Number.isSafeInteger(pair.localRevision)&&pair.localRevision>0,'remote local edit not pending');
  check(pair.accountId===id.accountId&&pair.candidateKey===id.candidateKey&&pair.session?.sessionId===pair.sessionId&&
    pair.context?.contextId===pair.contextId&&pair.context?.sessionRef?.sessionId===pair.sessionId,'overlay pair owner/reference mismatch');
  check(Number.isSafeInteger(pair.serverRevision)&&pair.serverRevision>0&&clean(pair.serverToken),'missing received Cloud revision/token');
  Wire.validateBodies(pair.context,pair.session);return copy(pair);
 }
 function openExisting(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{try{req.transaction.abort();}catch(_){};};
  req.onerror=()=>reject(req.error||Error('journal open failed'));req.onblocked=()=>reject(Error('journal open blocked'));
  req.onsuccess=()=>{const db=req.result;if(!['meta','heads','outbox'].every(n=>db.objectStoreNames.contains(n))){db.close();reject(Error('journal schema missing'));return;}resolve(db);};
 });}
 function validReceiverRow(row,id,pair){
  return row&&row.kind==='e7b-paired-received-dev-v1'&&row.state==='committed'&&
   row.accountId===id.accountId&&row.deviceKey===id.deviceKey&&row.candidateKey===id.candidateKey&&
   row.headVersion===id.headVersion&&row.contextId===pair.contextId&&row.sessionId===pair.sessionId&&
   Number.isSafeInteger(row.seq)&&row.seq>0&&row.validated?.seq===row.seq&&
   row.validated.accountId===id.accountId&&row.validated.candidateKey===id.candidateKey&&
   row.validated.headVersion===id.headVersion&&row.validated.contextId===pair.contextId&&
   row.validated.sessionId===pair.sessionId&&row.validated.serverRevision===pair.serverRevision&&
   row.validated.serverToken===pair.serverToken&&
   JSON.stringify(row.validated.context?.source?.wordIds)===JSON.stringify(pair.context.source.wordIds)&&
   row.validated.context?.sourceType===pair.context.sourceType&&
   row.validated.context?.sessionRef?.sessionId===pair.sessionId;
 }
 function receiverPrefix(id){return 'e7b:paired-sql-inbox-dev:v1:frame:'+encodeURIComponent(id.accountId)+':'+encodeURIComponent(id.deviceKey)+':'+encodeURIComponent(id.candidateKey)+':'+id.headVersion+':';}
 // An ACKed remote REVISE legitimately advances the cloud base beyond the
 // original committed receiver frame. Only accept this if EVERY successor is
 // proven by durable, matched ACK + immutable staged-revision records in IDB.
 function confirmedAckChain(meta,id,contextId,sourceRevision,sourceToken,latestRevision,latestToken){
  if(sourceRevision===latestRevision&&sourceToken===latestToken)return true;
  let rev=sourceRevision,token=sourceToken;
  const acks=meta.filter(r=>r.kind==='e7b-remote-prepared-revise-action-v1'&&r.ackedAt&&r.ack&&
    r.accountId===id.accountId&&r.deviceKey===id.deviceKey&&r.candidateKey===id.candidateKey&&
    r.headVersion===id.headVersion&&r.contextId===contextId).sort((a,b)=>a.baseRevision-b.baseRevision);
  for(const a of acks){
   if(a.baseRevision!==rev||a.baseToken!==token)continue;
   const stage=meta.find(r=>r.key===a.revisionKey&&r.kind==='e7b-remote-staged-revision-v1');
   if(!stage||stage.status!=='acked'||stage.actionId!==a.action.action_id||
      a.ack.actionId!==a.action.action_id||a.ack.serverRevision!==rev+1||
      !a.ack.serverToken||stage.serverRevision!==a.ack.serverRevision||
      stage.serverToken!==a.ack.serverToken)return false;
   rev=a.ack.serverRevision;token=a.ack.serverToken;
  }
  return rev===latestRevision&&token===latestToken;
 }
 async function stagePending(contextId,expectedLocalRevision=null){
  check(approvedStage===true,'remote stage pilot is OFF');const before=current();contextId=clean(contextId);check(contextId,'missing context');
  const pair=readOverlay(before,contextId);
  // Callback revision is a hint only: NEVER stage stale data from earlier callback.
  if(expectedLocalRevision!==null&&expectedLocalRevision!==pair.localRevision)return {status:'superseded',latest:pair.localRevision};
  const hash=await pairHash(pair);check(same(before,current()),'identity changed during hash');
  const db=await openExisting();let result;
  try{result=await new Promise((resolve,reject)=>{
   const tx=db.transaction(['meta','heads','outbox'],'readwrite');const meta=tx.objectStore('meta');
   const rq=meta.getAll(),hq=tx.objectStore('heads').getAll(),oq=tx.objectStore('outbox').getAll();
   const headKey=stageHeadKey(before,contextId),revKey=stageRevisionKey(before,contextId,pair.localRevision);
   const existingHead=meta.get(headKey),existingRev=meta.get(revKey);let count=0,answer,issue;
   function ready(){if(++count!==5)return;try{
    check(same(before,current()),'account changed during durable stage');
    const latest=readOverlay(before,contextId);
    check(latest.localRevision===pair.localRevision&&JSON.stringify(latest.context)===JSON.stringify(pair.context)&&
      JSON.stringify(latest.session)===JSON.stringify(pair.session)&&latest.serverToken===pair.serverToken,
      'Continue pair changed while preparing remote revision; replay latest');
    const prefix=receiverPrefix(before);
    const rows=(rq.result||[]).filter(r=>clean(r?.key).startsWith(prefix)&&r.contextId===contextId&&r.kind==='e7b-paired-received-dev-v1');
    check(rows.length>0,'trusted committed receiver provenance missing');
    rows.sort((a,b)=>b.seq-a.seq);
    const received=rows[0]?.validated;
    const receiverBaseline=received?{...pair,serverRevision:received.serverRevision,
      serverToken:received.serverToken}:pair;
    check(validReceiverRow(rows[0],before,receiverBaseline)&&
      confirmedAckChain(rq.result||[],before,contextId,received.serverRevision,received.serverToken,
        pair.serverRevision,pair.serverToken),
      'receiver baseline changed without durable ACK ancestry, quarantined or owner mismatch');
    const originalHeads=(hq.result||[]).filter(h=>h.accountId===before.accountId&&
      h.candidateKey===before.candidateKey&&h.contextId===contextId);
    const originalOutbox=(oq.result||[]).filter(o=>o.accountId===before.accountId&&
      o.candidateKey===before.candidateKey&&o.contextId===contextId&&o.transportEligible===true);
    let originShadow=null;
    if(originalHeads.length||originalOutbox.length){
      // This lane is now allowed on the original browser ONLY if the Cloud
      // receiver previously adopted the ACKed creation under full provenance.
      check(!!pair.shadowOriginal&&originalHeads.length===1&&originalOutbox.length>0,
        'local new-session Journal collision without trusted origin shadow');
      const h=originalHeads[0],origin=pair.shadowOriginal;
      const fromStorage=key=>{try{const a=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(a)?a:[];}catch(_){return [];}};
      const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
        Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
      const eq=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
      const cs=fromStorage('wlp:study-contexts:v1').filter(c=>c?.contextId===contextId);
      const ss=fromStorage('wlp:studyq-sessions:v1').filter(s=>s?.sessionId===pair.sessionId);
      check(cs.length===1&&ss.length===1&&eq(cs[0],origin.context)&&eq(ss[0],origin.session)&&
        h.deviceKey===before.deviceKey&&h.headVersion===before.headVersion&&
        h.sessionId===pair.sessionId&&h.hasPending===false&&!!h.pairHash&&
        h.serverRevision===pair.originRevision&&h.serverToken===pair.originToken&&
        eq(h.session,origin.session)&&eq(h.context?.progress,origin.context?.progress)&&
        originalOutbox.every(o=>o.deviceKey===before.deviceKey&&o.headVersion===before.headVersion&&
          o.sessionId===pair.sessionId&&o.status==='acked'),
        'original G4 Journal/compatibility projection is not fully ACKed or changed');
      originShadow={pairHash:h.pairHash,serverRevision:h.serverRevision,serverToken:h.serverToken};
    }
    const old=existingHead.result||null,oldRev=existingRev.result||null;
    if(old){check(old.kind==='e7b-remote-stage-head-v1'&&old.accountId===before.accountId&&old.deviceKey===before.deviceKey&&
      old.candidateKey===before.candidateKey&&old.headVersion===before.headVersion&&old.sessionId===pair.sessionId&&
      old.receiverSeq===rows[0].seq&&old.serverRevision===pair.serverRevision&&old.serverToken===pair.serverToken,
      'remote baseline changed while local edits remain pending');
     check(old.latestLocalRevision<=pair.localRevision,'stale local revision');}
    if(oldRev){check(oldRev.hash===hash&&oldRev.localRevision===pair.localRevision,'same revision changed contents');
      answer={status:'already-staged',actionId:oldRev.actionId,localRevision:pair.localRevision};return;}
    // A new staged snapshot is immutable. Earlier ones remain until a separate
    // verified remote REVISE/ACK transport resolves them; never overwrite them.
    check(!old||old.latestLocalRevision<pair.localRevision,'same local revision without matching staged snapshot');
    const actionId=randomUUID();check(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(actionId),'invalid action uuid');
    const revision={key:revKey,kind:'e7b-remote-staged-revision-v1',accountId:before.accountId,
      deviceKey:before.deviceKey,candidateKey:before.candidateKey,headVersion:before.headVersion,
      contextId,sessionId:pair.sessionId,localRevision:pair.localRevision,receiverSeq:rows[0].seq,
      baseServerRevision:pair.serverRevision,baseServerToken:pair.serverToken,
      previousActionId:old?.latestActionId||null,actionId,hash,
      context:copy(pair.context),session:copy(pair.session),originShadow,
      transportEligible:false,status:'staged-not-sent'};
    const newHead={key:headKey,kind:'e7b-remote-stage-head-v1',accountId:before.accountId,deviceKey:before.deviceKey,
      candidateKey:before.candidateKey,headVersion:before.headVersion,contextId,sessionId:pair.sessionId,
      receiverSeq:rows[0].seq,serverRevision:pair.serverRevision,serverToken:pair.serverToken,
      latestLocalRevision:pair.localRevision,latestActionId:actionId,pending:true};
    meta.add(revision);meta.put(newHead);answer={status:'staged',actionId,localRevision:pair.localRevision};
   }catch(e){issue=e;try{tx.abort();}catch(_){}}}
   rq.onsuccess=ready;hq.onsuccess=ready;oq.onsuccess=ready;existingHead.onsuccess=ready;existingRev.onsuccess=ready;
   tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(issue||tx.error||Error('remote revision transaction aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(before,current()),'account changed after remote stage');return result;
 }
 // Direct use as ContinueTrustedBinding.capturePairedRevisionDurably callback.
 // Do not trust caller-provided pair content/owner; reread the persisted overlay.
 async function capturePairedRevisionDurably(pair,callerIdentity){
  const id=current();check(callerIdentity?.verified===true&&callerIdentity.accountId===id.accountId&&
    callerIdentity.candidateKey===id.candidateKey&&callerIdentity.generation===id.generation,
    'untrusted pending callback identity');
  return stagePending(pair?.contextId,pair?.localRevision);
 }
 async function listStaged(){const id=current(),db=await openExisting();try{
  return await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readonly'),r=tx.objectStore('meta').getAll();
   r.onsuccess=()=>{try{check(same(id,current()),'identity changed while reading queue');resolve((r.result||[])
    .filter(v=>v.kind==='e7b-remote-staged-revision-v1'&&v.accountId===id.accountId&&v.deviceKey===id.deviceKey&&
       v.candidateKey===id.candidateKey&&v.headVersion===id.headVersion).sort((a,b)=>a.localRevision-b.localRevision).map(copy));}
     catch(e){reject(e);}};
   r.onerror=()=>reject(r.error||Error('remote queue read failed'));tx.onabort=()=>reject(tx.error||Error('remote queue aborted'));
  });}finally{db.close();}}
 return Object.freeze({stagePending,capturePairedRevisionDurably,listStaged});
}
return Object.freeze({make,stageHeadKey,stageRevisionKey});
});
