/* Normal Account screen Library readiness; no operations on page load. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const out=$('library-readiness-result'),check=$('library-readiness-check'),setup=$('library-fresh-setup');
 const candidate=window.WLPStage7LibraryOnboarding;
 const status=$('library-readiness-status');
 if(!candidate?.make){out.textContent='HOLD: Library safety module unavailable.';return;}
 const onboarding=candidate.make({
  boundary:window.WLPG4LibraryBoundary,snapshot:window.WLPG4VerifiedSnapshot,
  device:window.WLPG4DeviceOnboarding,installer:window.WLPG4FirstBrowserInstall,
  policy:window.WLPStage7G4ReleasePolicy,locks:window.navigator.locks
 });
 const busy=value=>{check.disabled=value;setup.disabled=value;};
 let verifiedFresh=false;
 async function inspect(){
   verifiedFresh=false;setup.hidden=true;
   const r=await onboarding.inspect();
   status.textContent=r.label;
   out.textContent=`${r.code} · Mirror: ${r.mirrorPresent?'present':'absent'} · `+
    `Legacy pending Outbox: ${r.pendingOutbox??'unknown'} · `+
    `Drafts: ${r.localDrafts} · Local Edits: ${r.localEdits} · `+
    `G4 Journal: ${r.journalPresent?'present':'absent'} · `+
    `Cloud Authority: ${r.cloudVerified?'verified':'unverified'}${r.cloudCursor===null?'':` · Cursor: ${r.cloudCursor}`}. `+
    'No local or Cloud data was changed.';
   // The first-install operation is not even offered for an existing-data origin.
   verifiedFresh=r.canInstall&&r.cloudVerified;
   setup.hidden=!verifiedFresh;
   return r;
 }
 check.addEventListener('click',async()=>{
   busy(true);out.textContent='Checking saved WLP data and Cloud owner (read only)…';
   try{await inspect();}catch(err){verifiedFresh=false;setup.hidden=true;
     status.textContent='Library check HOLD';out.textContent='HOLD: '+String(err?.message||err)+'. Existing data preserved.';}
   finally{busy(false);}
 });
 setup.addEventListener('click',async()=>{
   if(!verifiedFresh){out.textContent='HOLD: Complete read-only Library check first.';return;}
   busy(true);setup.hidden=true;
   out.textContent='Registering this new browser and validating complete Cloud Snapshot before atomic Mirror installation…';
   try{
     const result=await onboarding.setupFreshExplicit();
     verifiedFresh=false;
     status.textContent='Canonical Mirror installed (initial stage)';
     out.textContent=`${result.status}: ${result.mirrorRows.toLocaleString()} verified records, Cursor ${result.cursor}. `+
       'Normal Study and AutoSync remain disabled until the full Stage7 migration release is approved. '+
       'No existing Library was replaced.';
   }catch(err){verifiedFresh=false;status.textContent='Library setup HOLD';
     out.textContent='HOLD: '+String(err?.message||err)+'. Do not retry, clear, or replace local data without review.';}
   finally{busy(false);}
 });
})();
