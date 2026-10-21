/* Stage7 Account — existing-Library handoff; inspection only in SOURCE OFF. */
(()=>{'use strict';
 const status=document.getElementById('existing-library-status');
 const detail=document.getElementById('existing-library-detail');
 const check=document.getElementById('existing-library-check');
 const apply=document.getElementById('existing-library-apply');
 if(!status||!detail||!check||!apply)return;
 let ready=false;
 const setBusy=x=>{check.disabled=x;apply.disabled=x||!ready;};
 try{
  const evidence=window.WLPStage7CanonicalEvidenceCollector.make({
   verifiedSnapshot:window.WLPG4VerifiedSnapshot,
   planner:window.WLPStage7CanonicalThreeWay
  });
  const ctl=window.WLPStage7ExistingLibraryReconcile.make({
   boundary:window.WLPG4LibraryBoundary,legacySync:window.WLPCanonicalForegroundSync,
   evidence,policy:window.WLPStage7G4ReleasePolicy,locks:window.navigator?.locks});
  check.addEventListener('click',async()=>{
   ready=false;apply.hidden=true;setBusy(true);status.textContent='Checking existing Mirror against Cloud (read-only)…';
   try{const result=await ctl.inspect();
    status.textContent=result.code;
    detail.textContent=result.reason+' · Cloud Cursor '+(result.cloudCursor??'?')+
     ' · Existing Outbox '+(result.outbox??'unknown')+'. No data changed.';
    // One verified read-only inspection. The independent Cloud, v400 Outbox
    // schema and non-Outbox legacy edit protection are all checked in ctl.
    // SOURCE OFF remains the only permissible state for this ZIP.
    if(result.outboxReview)detail.textContent+=' Outbox evidence: '+result.outboxReview+
      ' · '+(result.actionCount||0)+' pending action(s). Read-only.';
    ready=result.eligible&&result.buildApproved===true;
    apply.hidden=!ready;
   }catch(e){status.textContent='HOLD';detail.textContent=String(e?.message||e)+' · No data changed.';}
   finally{setBusy(false);}
  });
  apply.addEventListener('click',async()=>{
   if(!ready)return;ready=false;apply.hidden=true;setBusy(true);status.textContent='Using existing Canonical v400 transport…';
   try{const result=await ctl.reconcileExplicit();status.textContent=result.status;
    detail.textContent=result.reason+' · Cursor '+result.localCursor+' / '+result.cloudCursor+
     ' · Pending Outbox '+result.outbox+'.';
   }catch(e){status.textContent='HOLD — Existing data retained';detail.textContent=String(e?.message||e);}
   finally{setBusy(false);}
  });
 }catch(e){status.textContent='HOLD';detail.textContent=String(e?.message||e);apply.hidden=true;}
})();
