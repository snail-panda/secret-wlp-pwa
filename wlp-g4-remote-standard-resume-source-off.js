/* G4-1 received Standard Continue -> proven E7b remote revision contract.
 * REVIEW CANDIDATE ONLY. No timers, transport calls, account switching, or
 * writes to WLP legacy Context/Session/Event keys. Must be bound only after
 * the authenticated G4 Writer lease and E7b receiver have been verified.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4RemoteStandardResumeSOURCEOFF=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const clean=v=>String(v??'').trim();
const clone=v=>JSON.parse(JSON.stringify(v));
const hold=s=>{throw Error('Remote Standard Continue HOLD: '+s);};
const check=(v,s)=>{if(!v)hold(s);};
function make({runtime,stageDurably}={}){
 check(runtime&&['ready','isRemoteContext','isRemoteSession','getContext','sessions',
  'saveRemoteStandardPair'].every(k=>typeof runtime[k]==='function'),'verified E7b runtime required');
 check(typeof stageDurably==='function','durable remote revision stage required');
 function open(contextId){
  contextId=clean(contextId);
  check(runtime.ready()&&runtime.isRemoteContext(contextId),'remote Context not verified');
  const context=runtime.getContext(contextId);
  const sessionId=clean(context?.sessionRef?.sessionId);
  check(context?.practiceMode==='standard' && sessionId &&
   runtime.isRemoteSession(sessionId),'received Context/Session owner mismatch');
  // Include the actual local Session inventory. The guarded E7b overlay
  // verifies the ACKed original and shadows that one Session only after
  // adopting the newer received Revision; an empty [] falsely hides it.
  const matches=runtime.sessions().filter(s=>clean(s?.sessionId)===sessionId);
  check(matches.length===1,'ambiguous remote Session');
  const session=matches[0];
  const ids=context.source?.wordIds;
  check(Array.isArray(ids)&&ids.length>0&&new Set(ids.map(clean)).size===ids.length,
   'received ordered card witness missing');
  check(session.status==='incomplete'||session.status==='ended-early',
   'only incomplete received Standard Session can resume');
  check(session.experiences?.length>0&&session.experiences.every((e,i,a)=>
   ids.includes(clean(e?.wordId)) && (i===0||ids.indexOf(clean(a[i-1]?.wordId))<ids.indexOf(clean(e?.wordId)))),
   'received answers/source ordering mismatch');
  return Object.freeze({context:clone(context),session:clone(session),contextId,sessionId});
 }
 async function save({contextId,session,contextPatch}={}){
  const previous=open(contextId);
  check(clean(session?.sessionId)===previous.sessionId &&
   clean(contextPatch?.contextId)===previous.contextId &&
   clean(contextPatch?.sessionRef?.sessionId)===previous.sessionId &&
   contextPatch?.sessionRef?.type==='standard','immutable received pair identity changed');
  check(JSON.stringify(contextPatch?.source?.wordIds)===
   JSON.stringify(previous.context.source.wordIds),'ordered received cards changed');
  const result=runtime.saveRemoteStandardPair(contextId,clone(session),clone(contextPatch));
  check(Number.isSafeInteger(result?.localRevision)&&result.localRevision>=1&&
   result?.session?.sessionId===previous.sessionId,
   'remote overlay save not confirmed');
  // The overlay is a local recovery copy; only successful IDB staging is
  // confirmation that the pending Cloud mutation is durable. If staging
  // fails, the caller HOLDs and the overlay remains pending for recovery.
  const staged=await stageDurably({contextId:previous.contextId,
   localRevision:result.localRevision});
  check(staged?.durable===true && staged.localRevision===result.localRevision &&
   typeof staged.actionId==='string' && staged.actionId,
   'remote IndexedDB stage was not confirmed');
  return Object.freeze({saved:true,durable:true,actionId:staged.actionId,
   localRevision:result.localRevision});
 }
 function readContexts(legacyContexts=[]){
  check(Array.isArray(legacyContexts),'legacy inventory unavailable');
  if(!runtime.ready())return legacyContexts;
  const all=runtime.contexts(legacyContexts);
  check(Array.isArray(all),'verified remote context read unavailable');
  return all;
 }
 return Object.freeze({open,save,readContexts,isRemoteContext:id=>runtime.ready()&&runtime.isRemoteContext(id)});
}
return Object.freeze({make});
});
