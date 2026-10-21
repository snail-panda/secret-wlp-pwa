/* WLP P1-E7b: Cloud-received Standard Continue -> durable remote REVISE/ACK.
 * DEV/HOLD ONLY; no automatic scheduling, no access to legacy Local-only records,
 * no standalone authorization, no SQL migration, no UI or Service Worker changes.
 * Receiver-provenance journal stages remain transportEligible:false for the
 * existing NEW-session uploader. This module has its own explicit pilot gate.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bRemoteReviseUploaderDEV=api;})(typeof window!=='undefined'?window:this,function(root){
'use strict';
const Wire=typeof module==='object'&&module.exports?require('./wlp-e7b-paired-wire-contract-dev.js'):root.WLPE7bPairedWireDEV;
const Journal=typeof module==='object'&&module.exports?require('./wlp-e7b-remote-revision-journal-dev.js'):root.WLPE7bRemoteRevisionJournalDEV;
const DB='wlp-study-context-sync-v1',PREP='e7b:remote-prepared-revise:v1:';
const copy=x=>JSON.parse(JSON.stringify(x));
const check=(v,why)=>{if(!v)throw Error('E7b remote REVISE blocked: '+why);};
const same=(a,b)=>Wire.sameIdentity(a,b);
const belong=(r,id)=>!!r&&r.accountId===id.accountId&&r.deviceKey===id.deviceKey&&
 r.candidateKey===id.candidateKey&&r.headVersion===id.headVersion;
function make({indexedDB,identityNow,rpc,overlay,approvedPilot=false,approvedPrepare=false}={}){
 check(indexedDB?.open&&typeof identityNow==='function','durable storage and trusted identity required');
 check(rpc?.canonicalCardRows&&rpc?.submitPrepared,'authenticated RPC required');
 check(overlay?.rebaseAcknowledgedRemoteRevision,'trusted Continue ACK bridge required');
 const current=()=>Wire.normalizeIdentity(identityNow());
 const key=id=>PREP+id;
 function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(_){}};
  r.onerror=()=>reject(r.error||Error('IDB open failed'));r.onblocked=()=>reject(Error('IDB blocked'));
  r.onsuccess=()=>{const db=r.result;if(!['meta','heads','revisions','outbox'].every(n=>db.objectStoreNames.contains(n))){db.close();reject(Error('journal schema missing'));return;}resolve(db);};
 });}
 async function readRows(){const id=current(),db=await open();try{const rows=await new Promise((resolve,reject)=>{
  const tx=db.transaction(['meta','heads','outbox'],'readonly'),names=['meta','heads','outbox'],out={};
  for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>out[name]=r.result||[];}
  tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error||Error('snapshot aborted'));tx.onerror=()=>{};
 });check(same(id,current()),'identity changed while scanning');return {id,rows};}finally{db.close();}}
 function choose({id,rows}){
  const all=rows.meta.filter(r=>r.kind==='e7b-remote-staged-revision-v1'&&belong(r,id));
  const contexts=[...new Set(all.map(r=>r.contextId))].sort();
  for(const ctx of contexts){
   const revisions=all.filter(r=>r.contextId===ctx).sort((a,b)=>a.localRevision-b.localRevision);
   const h=rows.meta.find(r=>r.key===Journal.stageHeadKey(id,ctx));
   check(h?.kind==='e7b-remote-stage-head-v1'&&belong(h,id),'missing original remote stage head');
   const receiver=rows.meta.filter(r=>r.kind==='e7b-paired-received-dev-v1'&&belong(r,id)&&
     r.contextId===ctx).sort((a,b)=>b.seq-a.seq)[0];
   check(receiver?.state==='committed'&&receiver.seq===h.receiverSeq&&
     receiver.validated?.serverRevision>=1&&receiver.validated?.serverToken&&
     revisions.every(r=>r.receiverSeq===receiver.seq&&r.baseServerRevision>=receiver.validated.serverRevision&&
       r.baseServerRevision<=h.serverRevision&&!!r.baseServerToken),
     'received Cloud provenance is missing, superseded or quarantined');
   let previous=null,last=0,firstPending=null;
   let proofRevision=receiver.validated.serverRevision,proofToken=receiver.validated.serverToken;
   for(const r of revisions){
    check(r.contextId===ctx&&r.sessionId===h.sessionId&&r.receiverSeq===h.receiverSeq&&
     r.baseServerRevision>0&&r.baseServerToken&&r.localRevision>last&&
     r.previousActionId===(previous?.actionId||null),'remote revision ancestry, owner or baseline invalid');
    check(r.status==='acked'||r.status==='staged-not-sent','invalid stage status');
    check(r.transportEligible===false,'remote stage wrongly promoted to new-session lane');
    if(r.status!=='acked'&&!firstPending)firstPending=r;
    if(firstPending&&r!==firstPending)check(r.status!=='acked','remote ACK has a gap');
    if(r.status==='acked'){
     const p=rows.meta.find(v=>v.key===key(r.actionId));
     check(p?.ackedAt&&belong(p,id)&&p.ack?.actionId===r.actionId&&
       p.baseRevision===proofRevision&&p.baseToken===proofToken&&
       p.ack.serverRevision===proofRevision+1&&p.ack.serverToken===r.serverToken&&
       r.serverRevision===p.ack.serverRevision,'ACK provenance chain broken');
     proofRevision=r.serverRevision;proofToken=r.serverToken;
    }else check(r.baseServerRevision<=proofRevision&&r.baseServerRevision>=receiver.validated.serverRevision,
      'future server revision in unsent remote stage');
    previous=r;last=r.localRevision;
   }
   check(h.latestLocalRevision===last&&h.latestActionId===previous?.actionId,
     'remote journal head does not match immutable revision chain');
   check(h.serverRevision===proofRevision&&h.serverToken===proofToken,
     'remote journal Cloud head lacks continuous durable ACK chain');
   const collisions=[...rows.heads,...rows.outbox].filter(r=>r.contextId===ctx&&
     r.accountId===id.accountId&&r.candidateKey===id.candidateKey&&r.transportEligible===true);
   if(collisions.length){
     check(typeof overlay.hasVerifiedOriginShadow==='function'&&
       revisions.every(r=>r.originShadow&&
         overlay.hasVerifiedOriginShadow(ctx,rows.heads,rows.outbox,r.originShadow)),
       'remote Context collided with changed/pending new-session Journal');
   }
   if(!firstPending)continue;
   const prepared=rows.meta.find(r=>r.key===key(firstPending.actionId))||null;
   check(Number.isSafeInteger(h.serverRevision)&&h.serverRevision>0&&h.serverToken,
     'Cloud baseline missing');
   check(prepared===null||prepared.kind==='e7b-remote-prepared-revise-action-v1','prepared Action kind collision');
   // Once a REVISE Action has been written, its precise base must survive retries.
   if(prepared){check(belong(prepared,id)&&prepared.contextId===ctx&&prepared.revisionKey===firstPending.key&&
      prepared.baseRevision===h.serverRevision&&prepared.baseToken===h.serverToken&&!prepared.ackedAt,
      'prepared Action baseline changed before ACK');}
   return {id,stage:firstPending,head:h,prepared};
  }
  return null;
 }
 async function readPreparedAction(actionId){const id=current(),db=await open();try{
  const val=await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readonly'),r=tx.objectStore('meta').get(key(actionId));
   let record=null;r.onsuccess=()=>record=r.result||null;
   tx.oncomplete=()=>resolve(record);tx.onabort=()=>reject(tx.error||Error('prepared read aborted'));tx.onerror=()=>{};
  });check(belong(val,id)&&val.kind==='e7b-remote-prepared-revise-action-v1'&&val.remoteReceiverProvenance===true,
    'prepared Action absent or wrong owner/provenance');check(same(id,current()),'identity switched');return copy(val);
 }finally{db.close();}}
 async function prepareOne(){check(approvedPrepare===true||approvedPilot===true,'remote REVISE preparation OFF');
  const selected=choose(await readRows());if(!selected)return null;
  if(selected.prepared)return readPreparedAction(selected.stage.actionId);
  const {id,stage,head}=selected;
  Wire.validateBodies(stage.context,stage.session);
  const cardRows=await rpc.canonicalCardRows(stage.context.source.wordIds);
  check(same(id,current()),'identity changed during card witness verification');
  // This ephemeral attestation is ONLY derived from a previously validated,
  // committed receiver frame plus the remote stage, not from new-study enrollment.
  const action=await Wire.buildAction({identity:id,actionId:stage.actionId,cardRows,revision:{
   ...stage,kind:'standard-session-context-pair',accountBoundAtStart:true,
   baseRevision:head.serverRevision,baseToken:head.serverToken}});
  check(action.operation==='revise'&&action.base_revision===head.serverRevision,'received session must REVISE');
  check(same(id,current()),'identity changed preparing Action');
  const row={key:key(stage.actionId),kind:'e7b-remote-prepared-revise-action-v1',remoteReceiverProvenance:true,
   accountId:id.accountId,deviceKey:id.deviceKey,candidateKey:id.candidateKey,headVersion:id.headVersion,
   contextId:stage.contextId,sessionId:stage.sessionId,revisionKey:stage.key,headKey:head.key,
   localRevision:stage.localRevision,receiverSeq:stage.receiverSeq,baseRevision:head.serverRevision,
   baseToken:head.serverToken,action:copy(action),ackedAt:null,overlayRebasedAt:null};
  const db=await open();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction('meta','readwrite'),m=tx.objectStore('meta'),results={};let count=0,err;
   const got=name=>ev=>{results[name]=ev.target.result||null;if(++count===4){try{
     check(same(id,current()),'identity changed during durable preparation');
     const oldHead=results.head,oldStage=results.stage;
     const latestReceiver=(results.frames||[]).filter(v=>v.kind==='e7b-paired-received-dev-v1'&&
       belong(v,id)&&v.contextId===stage.contextId).sort((a,b)=>b.seq-a.seq)[0];
     check(latestReceiver?.state==='committed'&&latestReceiver.seq===stage.receiverSeq,
       'receiver changed or was quarantined during remote preparation');
     check(!results.prepared,'concurrent prepared Action exists, retry');
     check(belong(oldHead,id)&&oldHead.serverRevision===row.baseRevision&&oldHead.serverToken===row.baseToken&&
       oldHead.latestLocalRevision>=stage.localRevision,'remote head changed while preparing');
     check(belong(oldStage,id)&&oldStage.status==='staged-not-sent'&&
       JSON.stringify(oldStage)===JSON.stringify(stage),'original immutable stage changed');
     m.add(row); // complete Action durable BEFORE invoking RPC
    }catch(e){err=e;try{tx.abort();}catch(_){}}}};
   m.get(row.key).onsuccess=got('prepared');m.get(head.key).onsuccess=got('head');m.get(stage.key).onsuccess=got('stage');
   m.getAll().onsuccess=got('frames');
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(err||tx.error||Error('prepare aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(id,current()),'identity changed after prepared Action was saved');
  return readPreparedAction(stage.actionId);
 }
 function receipt(prepared){const ack=prepared.ack;
  check(prepared.ackedAt&&ack&&ack.actionId===prepared.action.action_id&&
    ack.serverRevision===prepared.baseRevision+1&&ack.serverToken,'invalid durable remote ACK');
  return {source:'e7b-idb-remote-ack-v1',actionId:ack.actionId,localRevision:prepared.localRevision,
   baseServerRevision:prepared.baseRevision,baseServerToken:prepared.baseToken,
   serverRevision:ack.serverRevision,serverToken:ack.serverToken};
 }
 // ACK is committed to IndexedDB first. Then overlay rebase is replayable,
 // because localStorage and IndexedDB cannot be one ACID transaction.
 async function reconcileOne(){
  check(approvedPilot===true,'remote REVISE pilot OFF');const {id,rows}=await readRows();
  const pending=rows.meta.filter(r=>r.kind==='e7b-remote-prepared-revise-action-v1'&&belong(r,id)&&
    r.ackedAt&&!r.overlayRebasedAt).sort((a,b)=>a.baseRevision-b.baseRevision);
  if(!pending.length)return {status:'empty'};
  const prepared=pending[0],proof=receipt(prepared);
  check(same(id,current()),'identity changed before overlay ACK rebase');
  const result=overlay.rebaseAcknowledgedRemoteRevision(prepared.contextId,proof);
  check(same(id,current()),'identity changed after overlay rebase');
  const db=await open();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction('meta','readwrite'),m=tx.objectStore('meta');let err;
   m.get(prepared.key).onsuccess=event=>{try{const saved=event.target.result;
    check(belong(saved,id)&&JSON.stringify(saved.ack)===JSON.stringify(prepared.ack)&&saved.ackedAt,
      'durable ACK changed before reconciliation');
    m.put({...saved,overlayRebasedAt:new Date().toISOString()});
   }catch(e){err=e;try{tx.abort();}catch(_){}}};
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(err||tx.error||Error('ACK reconciliation aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(id,current()),'identity changed after overlay reconciliation');
  return {status:'reconciled',actionId:prepared.action.action_id,pending:result.pending};
 }
 async function flushOne(){check(approvedPilot===true,'remote REVISE pilot OFF');
  const repaired=await reconcileOne();if(repaired.status==='reconciled')return repaired;
  const id=current(),prepared=await prepareOne();if(!prepared)return {status:'empty'};
  check(same(id,current()),'account changed before sending remote REVISE');
  const ack=await rpc.submitPrepared({action:copy(prepared.action),readPreparedAction});
  check(same(id,current()),'identity changed after authenticated RPC');
  check(ack?.status==='applied'&&ack.actionId===prepared.action.action_id&&
    ack.contextId===prepared.action.context_id&&ack.sessionId===prepared.action.session_id&&
    ack.serverRevision===prepared.baseRevision+1&&ack.serverToken,'remote RPC ACK mismatch');
  const db=await open();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction('meta','readwrite'),m=tx.objectStore('meta'),vals={};let count=0,err;
   const got=name=>ev=>{vals[name]=ev.target.result||null;if(++count===3){try{
    check(same(id,current()),'account changed before durable remote ACK');
    const p=vals.prepared,h=vals.head,s=vals.stage;
    check(belong(p,id)&&belong(h,id)&&belong(s,id)&&p.kind==='e7b-remote-prepared-revise-action-v1',
      'remote ACK target lost or owner changed');
    check(JSON.stringify(p.action)===JSON.stringify(prepared.action)&&s.actionId===ack.actionId&&
      h.serverRevision===p.baseRevision&&h.serverToken===p.baseToken&&
      s.status==='staged-not-sent','ACK base/action changed or duplicate local ACK');
    check(ack.serverRevision===p.baseRevision+1,'server ACK wrong successor');
    m.put({...p,ackedAt:new Date().toISOString(),ack:copy(ack)});
    m.put({...s,status:'acked',ackedAt:new Date().toISOString(),serverRevision:ack.serverRevision,
      serverToken:ack.serverToken});
    m.put({...h,serverRevision:ack.serverRevision,serverToken:ack.serverToken,
      pending:h.latestLocalRevision>s.localRevision});
   }catch(e){err=e;try{tx.abort();}catch(_){}}}};
   m.get(prepared.key).onsuccess=got('prepared');m.get(prepared.headKey).onsuccess=got('head');
   m.get(prepared.revisionKey).onsuccess=got('stage');
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(err||tx.error||Error('durable remote ACK aborted'));tx.onerror=()=>{};
  });}finally{db.close();}
  check(same(id,current()),'account changed after durable remote ACK');
  const finalized=await reconcileOne();
  check(finalized.status==='reconciled'&&finalized.actionId===ack.actionId,'overlay ACK reconciliation incomplete');
  return {status:'acked',actionId:ack.actionId,serverRevision:ack.serverRevision,pending:finalized.pending};
 }
 return Object.freeze({prepareOne,readPreparedAction,reconcileOne,flushOne,readRows});
}
return Object.freeze({make,PREP});
});
