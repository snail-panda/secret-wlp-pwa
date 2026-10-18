/* Stage7 existing Cloud/Library read-only status surface.
 * Uses the established G4 ownership/Authority/Cursor boundary without enabling
 * first-browser installation, reconcile, v400 transport, or Paired writer.
 * No operation runs on page load: only an explicitly clicked Cloud GET check.
 */
(()=>{'use strict';
 const button=document.getElementById('library-cloud-check');
 const status=document.getElementById('library-cloud-status');
 const detail=document.getElementById('library-cloud-detail');
 if(!button||!status||!detail)return;
 let busy=false;
 const label={
  EXISTING_ACCOUNT_LIBRARY:'Existing Library identified; Cloud and Local cursors match',
  EXISTING_SYNC_NEEDED:'Existing Library identified; Cloud contains later changes',
  EXISTING_PENDING:'Existing Library has pending local changes; keep Outbox',
  EXISTING_AUTHORITY_CHANGE:'HOLD — Cloud Authority differs from the local Mirror',
  EXISTING_LOCAL_DATA:'HOLD — local data needs existing-Library reconciliation',
  FIRST_BROWSER_CANDIDATE:'New-browser candidate; installation remains disabled',
  HOLD_OTHER_ACCOUNT:'HOLD — different account detected',
  HOLD_DEVICE_MISMATCH:'HOLD — device identity does not match',
  HOLD_EXISTING_MIRROR:'HOLD — local Mirror evidence incomplete',
  HOLD_CURSOR_INVALID:'HOLD — local cursor invalid',
  HOLD_LOCAL_UNVERIFIED:'HOLD — local storage cannot be verified',
  HOLD_AUTH_NOT_VERIFIED:'HOLD — live account not verified',
  HOLD_AUTHORITY_UNVERIFIED:'HOLD — Cloud Authority not verified'
 };
 function fmt(v){return Number.isSafeInteger(v)&&v>=0?String(v):'unknown';}
 button.addEventListener('click',async()=>{
  if(busy)return;
  busy=true;button.disabled=true;
  status.textContent='Checking saved Library and live Cloud (read only)…';
  detail.textContent='No Library install, merge or sync upload will be attempted. Saved Cloud Auth token may be renewed.';
  try {
   // Reuse the proven G4 Shadow session freshness logic only on an explicit
   // click. This can rotate ONLY the saved Auth session; no Library/Outbox
   // writer is loaded on this page.
   const freshnessFactory=window.WLPG4SharedAuthFreshnessSOURCEOFF;
   if(!freshnessFactory?.make)throw Error('Established Cloud session renewal unavailable');
   const freshness=freshnessFactory.make({
    indexedDB:window.indexedDB,fetchImpl:window.fetch.bind(window),locks:window.navigator.locks
   });
   status.textContent='Checking existing Cloud session, then Library/Authority (read only)…';
   const auth=freshness.ensureFresh();
   const renewal=await auth;
   const boundary=window.WLPG4LibraryBoundary;
   if(!boundary||typeof boundary.inspect!=='function')throw Error('Library verifier unavailable');
   const proof=await boundary.inspect();
   const verdict=proof?.verdict?.code||'HOLD_UNVERIFIED';
   const local=proof?.local||{};
   const remote=proof?.remote||null;
   const cloudVerified=remote?.identityVerified===true&&remote?.authorityVerified===true;
   status.textContent=label[verdict]||'HOLD — '+String(verdict).slice(0,70);
   detail.textContent=[
    'Live Cloud account/Authority: '+(cloudVerified?'verified':'not verified'),
    'Local Mirror: '+(local.mirrorPresent?'present':'absent'),
    'Local cursor: '+fmt(local.mirrorCursor),
    'Cloud cursor: '+fmt(remote?.cursor),
    'Pending Outbox: '+fmt(local.pendingOutbox),
    'Local Drafts: '+fmt(local.localDraftCount),
    'Local Edits: '+fmt(local.localEditCount),
    'Study Journal: '+(local.journalPresent?'present':'not detected'),
    'Other preserved WLP storage: '+(Number(local.additionalLocalKeyCount||0)+Number(local.additionalSessionKeyCount||0)+Number(local.additionalDbCount||0))+' item(s)',
    'Cloud session: '+(renewal?.renewed===true?'renewed securely':'existing session still valid'),
    'Status: Library read only — no Library/Outbox/Cloud records changed. Only saved Auth credentials may be renewed. Sync and Library installation remain disabled.'
   ].join(' · ');
  }catch(error){
   status.textContent='HOLD — Library/Cloud check not completed';
   const message=String(error?.message||error);
   detail.textContent=message.slice(0,400)+' · No Library or Cloud records changed. Auth session metadata may have been renewed. Do not clear, reinstall or replace your Library.';
  }finally{busy=false;button.disabled=false;}
 });
})();
