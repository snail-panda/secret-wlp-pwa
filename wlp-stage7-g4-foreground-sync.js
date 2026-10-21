/* WLP Stage 7 / G4 — foreground Paired transport controller.
 * Does not construct Journal actions, modify Canonical v400 queues, install DBs,
 * or import data into Legacy History. Operates ONLY over the existing proven
 * G4 paired transport after an exact owner/Authority lease was prepared.
 * Production execution requires a separately approved Stage7 build policy.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7G4ForegroundSync=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const LOCK='wlp:g4:paired-foreground-transport:v1';
const fail=s=>{throw Error('G4 foreground HOLD: '+s);};
const same=(a,b)=>a?.verified===true&&b?.verified===true&&
 ['accountId','deviceKey','candidateKey','headVersion','generation'].every(k=>String(a[k])===String(b[k]));
function make({root,transport,lease,policy,sourceGuard,legacyOutboxCount,
  pairedMode='new-g4-mirror',
  now=()=>Date.now(),maxSend=6,minRetryMs=5000,maxRetryMs=300000}={}){
 if(!root?.document?.addEventListener||!root?.addEventListener||!root?.navigator?.locks?.request||
  !transport?.flushOne||!transport?.receiveOnce||!lease?.identityNow||!lease?.verifyIdentity||
  !policy?.gate||!policy?.verifyAccount||typeof sourceGuard!=='function'||
  typeof legacyOutboxCount!=='function')fail('trusted foreground dependencies unavailable');
 if(!Number.isSafeInteger(maxSend)||maxSend<1||maxSend>20||minRetryMs<1000||maxRetryMs<minRetryMs)
  fail('invalid work or retry limits');
 const e7aMode=pairedMode==='existing-e7a-authority';
 if(!e7aMode&&pairedMode!=='new-g4-mirror')fail('unrecognized paired source');
 const releaseAllowed=()=>e7aMode ? policy.gate('existing-e7a-study')===true&&
    policy.gate('existing-e7a-paired')===true :
    policy.gate('paired')===true&&policy.gate('study')===true;
 let started=false,stopped=false,busy=false,dirty=false,scheduled=null,failure=0,lastError='',
  lastCloudAck='',lastPairedSeq=null,lastReceive=null,attempts=0,completedRuns=0;
 const listeners=[];
 const status=()=>Object.freeze({
  enabled:started&&!stopped,active:busy,failures:failure,lastError,
  lastCloudAck,lastPairedSeq,lastReceive,attempts,completedRuns,
  mode:'foreground-only',legacyOutboxUntouched:true
 });
 function notify(){try{root.dispatchEvent(new root.CustomEvent('wlp-g4-sync-status',{detail:status()}));}catch(_){}}
 function clearScheduled(){if(scheduled!==null){root.clearTimeout(scheduled);scheduled=null;}}
 function allowedForeground(){return root.navigator.onLine!==false&&
  root.document.visibilityState!=='hidden';}
 function backoff(){return Math.min(maxRetryMs,minRetryMs*Math.pow(2,Math.min(failure-1,6)));}
 function schedule(delay=0){
  if(stopped||!started||scheduled!==null)return;
  scheduled=root.setTimeout(()=>{scheduled=null;void run('scheduled');},delay);
 }
 async function preflight(){
  if(!releaseAllowed())fail('Stage7 G4 release is not approved');
  if(transport.status?.().cloudSendEnabled!==true||transport.status?.().cloudReceiveEnabled!==true)
   fail('proven Paired transport is not approved');
  const before=lease.identityNow();
  policy.verifyAccount(before?.accountId,e7aMode?'existing-e7a-paired':'paired');
  const proof=await lease.verifyIdentity();
  if(!same(before,proof)||!same(before,lease.identityNow()))fail('owner/device/Authority changed');
  const source=await sourceGuard();
  if(e7aMode){
   if(source?.mode!=='existing-e7a-authority'||source.ready!==true)
    fail('existing E7a Paired card/Session proof is unavailable');
  }else if(source?.mode!=='new-g4-mirror')
   fail('only protected G4 Mirror may use Paired transport');
  const pending=await legacyOutboxCount();
  if(!Number.isSafeInteger(pending)||pending!==0)fail('legacy Canonical Outbox is nonempty or unknown');
  if(!same(before,lease.identityNow()))fail('owner lease changed during pending checks');
  return before;
 }
 async function run(reason='foreground'){
  if(!started||stopped)return status();
  if(busy)return status();
  if(!allowedForeground())return status();
  busy=true;attempts++;notify();
  try{
   const lockResult=await root.navigator.locks.request(LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)return 'other-tab-active';
    if(!allowedForeground())return 'not-foreground';
    const owner=await preflight();
    let last='empty';
    for(let n=0;n<maxSend;n++){
     if(!allowedForeground())break;
     await preflight();
     const result=await transport.flushOne();
     if(!same(owner,lease.identityNow()))fail('owner changed after Cloud submit');
     if(result?.status==='empty'){last='empty';break;}
     if(result?.status==='acked'){
       if(!result.actionId)fail('Cloud ACK missing action ID');
       lastCloudAck=String(result.actionId);last='acked';
     }else if(result?.status==='reconciled')last='reconciled';
     else fail('unexpected submit outcome, pending Action preserved');
    }
    // Independently receive; an ACK is never used to claim receive durability.
    if(allowedForeground()){
     await preflight();
     const received=await transport.receiveOnce();
     if(!same(owner,lease.identityNow()))fail('owner changed after Inbox receive');
     if(!received||typeof received!=='object'||
        !Number.isSafeInteger(received.stored)||!Number.isSafeInteger(received.quarantined)||
        !Number.isSafeInteger(received.pairedSeq))fail('receiver did not confirm durable Inbox');
     lastPairedSeq=received.pairedSeq;
     lastReceive={stored:received.stored,quarantined:received.quarantined,pairedSeq:received.pairedSeq};
     if(received.quarantined>0)fail('Inbox quarantined '+received.quarantined+' frame(s)');
    }
    return last;
   });
   if(lockResult==='other-tab-active'){
    schedule(minRetryMs);
   }else if(lockResult!=='not-foreground'){
    failure=0;lastError='';completedRuns++;
    // If the burst was fully used, a pending action may remain. Retry in
    // foreground with a bounded delay rather than spinning indefinitely.
    if(lockResult==='acked'||lockResult==='reconciled')schedule(minRetryMs);
   }
  }catch(e){failure++;lastError=String(e?.message||e);schedule(backoff());}
  finally{busy=false;if(dirty){dirty=false;clearScheduled();schedule(minRetryMs);}notify();}
  return status();
 }
 function add(target,name,handler){target.addEventListener(name,handler);listeners.push([target,name,handler]);}
 function start(){
  if(started||stopped)fail('controller already started or stopped');
  // No calls occur on module import or constructor. Release approval only.
  if(!releaseAllowed())fail('Stage7 release approval not present');
  started=true;
  add(root,'online',()=>{clearScheduled();schedule(0);});
  add(root,'pageshow',()=>{clearScheduled();schedule(0);});
  add(root.document,'visibilitychange',()=>{
   if(root.document.visibilityState!=='hidden'){clearScheduled();schedule(0);}
  });
  schedule(0);notify();return status();
 }
 function journalCommitted(){
  // Call ONLY after confirmed durable Journal commit / remote revision stage.
  // The action must already exist in the proven immutable Journal Outbox.
  if(!started||stopped)return;
  if(busy){dirty=true;return;}
  clearScheduled();schedule(0);
 }
 function stop(){stopped=true;clearScheduled();for(const [t,n,h] of listeners)t.removeEventListener(n,h);
  listeners.length=0;notify();return status();}
 return Object.freeze({start,run,journalCommitted,stop,status});
}
return Object.freeze({make,LOCK});
});
