/* Cached account status only. Does not create DB, sign in, refresh, sync or install. */
(()=>{'use strict';
 const label=document.getElementById('wlp-account-cached-status');
 if(!label||!window.WLPStage7Account)return;
 window.WLPStage7Account.make({indexedDB:window.indexedDB}).readStatus().then(s=>{
  label.textContent=s.signedIn?'Cloud account saved on this browser (not live-verified)':
    s.configured?'Cloud account not signed in on this browser':'Cloud account not yet configured on this browser';
 }).catch(()=>{label.textContent='Account status unavailable · no data changed';});
})();
