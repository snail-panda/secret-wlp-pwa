/* Explicit login only; no on-load network or data mutation. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const account=window.WLPStage7Account.make({indexedDB:window.indexedDB,fetchImpl:window.fetch.bind(window),cryptoImpl:window.crypto});
 async function update(){
  const s=await account.readStatus();
  $('account-status').textContent=s.signedIn?'Existing Cloud account saved locally (not live-verified)':'No saved WLP Cloud account session';
  $('local-status').textContent=[s.configured?'Existing Cloud project configured':'Cloud project not configured on this browser',
    s.mirrorPresent?'Local Canonical Mirror present':'No Local Canonical Mirror detected',
    s.outboxCount===null?'Canonical Outbox DB absent':'Canonical pending Outbox: '+s.outboxCount].join(' · ');
  $('account-form').hidden=!s.configured;
  if(!s.configured)$('account-result').textContent='Cloud project provisioning is not yet connected to this account page. Existing local data was not changed.';
 }
 $('account-refresh').addEventListener('click',()=>update().catch(e=>$('account-result').textContent='HOLD: '+String(e?.message||e)));
 $('account-form').addEventListener('submit',async(e)=>{
  e.preventDefault();const button=$('account-submit'),input=$('account-password');button.disabled=true;
  $('account-result').textContent='Verifying the existing WLP Cloud account…';
  try {const result=await account.signIn($('account-email').value,input.value);
   $('account-result').textContent=result.saved?'Sign-in verified and saved on this browser. No Library installation or synchronization started.':'HOLD: Sign-in not confirmed';
   await update();
  }catch(err){$('account-result').textContent='HOLD: '+String(err?.message||err);}
  finally{input.value='';button.disabled=false;}
 });
 update().catch(e=>$('account-status').textContent='HOLD: '+String(e?.message||e));
})();
