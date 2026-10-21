/* Stage7 G4 Library enrollment facade, reusing Bublanina-proven G4 modules.
 * Existing-data origins: READ ONLY / preserve. New empty origins: explicit
 * atomic first install ONLY when independently release-approved at build time.
 * Never reset, clear, import-replace, drop, or migrate an existing DB.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WLPStage7LibraryOnboarding=api;
})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const fail=reason=>{throw Error('Stage7 Library HOLD: '+reason);};
 function describe(proof,approved){
   const code=String(proof?.verdict?.code||'HOLD_UNVERIFIED');
   const local=proof?.local||{};
   const remote=proof?.remote||null;
   const fresh=code==='FIRST_BROWSER_CANDIDATE';
   const existing=code.startsWith('EXISTING_');
   const label=fresh?'New browser: verified Cloud authority, no known existing local WLP data':
     existing?'Existing WLP data: preserve and use a guarded synchronization/migration path':
     'Setup HOLD: ownership, stored data, or Cloud state requires attention';
   return Object.freeze({code,label,readOnly:true,existing, fresh,
     canInstall:fresh&&approved===true,
     mirrorPresent:local.mirrorPresent===true,
     journalPresent:local.journalPresent===true,
     officialPresent:local.officialPresent===true,
     localEdits:Number(local.localEditCount||0),
     localDrafts:Number(local.localDraftCount||0),
     // null is meaningful: never interpret unknown pending count as zero.
     pendingOutbox:local.pendingOutbox??null,
     otherLocalKeys:Number(local.additionalLocalKeyCount||0),
     otherSessionKeys:Number(local.additionalSessionKeyCount||0),
     otherDatabases:Number(local.additionalDbCount||0),
     headVersion:remote?.authority?.headVersion??null,
     cloudCursor:remote?.cursor??null,
     cloudVerified:remote?.identityVerified===true&&remote?.authorityVerified===true});
 }
 function make({boundary,snapshot,device,installer,policy,locks}={}){
   if(!boundary?.inspect||!snapshot?.verify||!snapshot?.prepareFirstInstall||
      !device?.registerExplicit||!installer?.installFresh||!policy?.gate)
     fail('Proven Account/Cloud/Library modules are missing');
   const approved=()=>policy.gate('library-install')===true;
   let busy=false;
   async function inspect(){return describe(await boundary.inspect(),approved());}
   async function verifyReadOnly(){
     const initial=await inspect();
     if(!initial.cloudVerified)fail('Cloud owner/Authority not verified');
     const result=await snapshot.verify();
     if(result?.verified!==true||result.accountMatch!==true)
       fail('Full Cloud snapshot verification not confirmed');
     return Object.freeze({status:'VERIFIED_READ_ONLY',verdict:initial.code,
       officialCards:result.officialCards,cloudCursor:result.cursor,
       mirrorRows:result.rowCount,mayInstall:false});
   }
   async function setupFreshExplicit(){
     if(!approved())fail('Fresh-browser installation is not approved for this Stage7 build/host');
     if(!locks?.request)fail('Cross-tab installation lock is unavailable; preserve data');
     if(busy)fail('Library setup already running');
     busy=true;
     try{
       return await locks.request('wlp:stage7:initial-library-install:v1',{mode:'exclusive',ifAvailable:true},async lock=>{
         if(!lock)fail('Another tab is preparing this browser; wait without clearing data');
         if(!approved())fail('Release approval changed');
         const before=await inspect();
         if(!before.canInstall||!before.cloudVerified)fail('Browser is not a verified empty-first-install candidate ('+before.code+')');
         // A single explicit user action can register the local browser, then
         // install the full verified snapshot. Each donor module independently
         // re-checks live owner, device, Authority, local data and manifest.
         const registered=await device.registerExplicit();
         if(registered?.status!=='DEVICE_REGISTERED'||registered.readback!==true)
           fail('Device registration did not pass independent Cloud readback');
         if(!approved())fail('Release approval changed during device registration');
         const middle=await inspect();
         if(!middle.canInstall||!middle.cloudVerified)fail('Local or Cloud boundary changed after device registration');
         const installed=await installer.installFresh();
         if(installed?.status!=='INSTALLED_SOURCE_ONLY'||!Number.isSafeInteger(installed.mirrorRows)||
            installed.mirrorRows<=0||installed.outbox!==0||installed.accountBound!==true)
           fail('Atomic installation not fully confirmed; do not clear any data');
         return Object.freeze({status:'INSTALLED_MIRROR_ONLY',mirrorRows:installed.mirrorRows,
           cursor:installed.cursor,readbackConfirmed:true,normalStudyEnabled:false,
           normalSyncEnabled:false,officialProjectionInstalled:false});
       });
     }finally{busy=false;}
   }
   return Object.freeze({inspect,verifyReadOnly,setupFreshExplicit});
 }
 return Object.freeze({make,describe});
});
