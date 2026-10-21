/* WLP G4-1: explicit one-action pilot transport controls.
 * Never schedules background sync, creates actions, overwrites local records,
 * or claims a Cloud ACK until the proven uploader returns status 'acked'.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4ManualSyncControls=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const check=(p,m)=>{if(!p)throw Error('G4 pilot sync HOLD: '+m);};
function classify(kind,result){
 if(kind==='send'){
  if(result?.status==='acked')return 'Cloud ACK confirmed for action '+String(result.actionId||'(missing ID)');
  if(result?.status==='empty')return 'No pending Paired action to send.';
  if(result?.status==='reconciled')return 'Existing remote action reconciled locally; Cloud ACK not newly asserted.';
  throw Error('Unexpected submit result; state retained for inspection');
 }
 if(result&&typeof result==='object')return 'Receiver operation returned. Check Continue after durable Inbox confirmation.';
 throw Error('Unexpected pull result; do not assume received');
}
function mount({root,transport,accountId}={}){
 check(root?.document&&root.WLPG4LimitedPilotPolicy?.verifyAccount(accountId,'paired')===true,
  'account or host not approved');
 check(transport?.status?.().cloudSendEnabled===true&&typeof transport.flushOne==='function'&&
  typeof transport.receiveOnce==='function','proven transport not enabled');
 const slot=root.document.getElementById('wlp-g4-pilot-sync');
 check(slot&&slot.hidden===true,'pilot controls container unavailable');
 check(!slot.dataset.bound,'pilot controls already bound');
 slot.dataset.bound='true';
 const status=slot.querySelector('[data-g4-pilot-status]');
 const send=slot.querySelector('[data-g4-pilot-send]');
 const receive=slot.querySelector('[data-g4-pilot-receive]');
 check(status&&send&&receive,'pilot control elements incomplete');
 let busy=false;
 const run=async kind=>{
  if(busy)return;
  busy=true;send.disabled=true;receive.disabled=true;
  status.textContent=kind==='send'?'Sending one existing durable Action…':'Receiving Cloud changes once…';
  try{
   root.WLPG4LimitedPilotPolicy.verifyAccount(accountId,'paired');
   const result=await (kind==='send'?transport.flushOne():transport.receiveOnce());
   status.textContent=classify(kind,result);
  }catch(e){status.textContent='HOLD: '+String(e?.message||e)+'. Do not clear, retry blindly, or import.';}
  finally{busy=false;send.disabled=false;receive.disabled=false;}
 };
 send.addEventListener('click',()=>void run('send'));
 receive.addEventListener('click',()=>void run('receive'));
 slot.hidden=false;
 status.textContent='Pilot only. Local Journal must be saved before Send once. No automatic sync.';
 return Object.freeze({ready:true,manualOnly:true});
}
return Object.freeze({mount,classify});
});
