/* Stage 7 G4 release boundary; NEVER use the former Bublanina UID/Origin.
 * Approval is a reviewed build configuration, not a URL/localStorage switch.
 * Account proof is performed by the existing online authenticated lease;
 * this policy is only a build/host guard and is not a security authority.
 * Only the allowlisted existing-E7a pilot account has both independent
 * capabilities ON in this reviewed trial build; all other routes remain OFF.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7G4ReleasePolicy=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const ENABLE_PROTECTED_G4_STUDY=false;
const ENABLE_G4_FOREGROUND=false;
// Independent approval: fresh empty-browser Library setup, never existing-Library migration.
const ENABLE_FRESH_BROWSER_LIBRARY_SETUP=false;
// Independent old E7a Mirror route: guarded delegation to existing v400 only.
const ENABLE_EXISTING_LIBRARY_RECONCILE=false;
// Separate, reviewed existing-E7a per-Session Journal pilot; deliberately OFF.
const ENABLE_EXISTING_E7A_STANDARD_JOURNAL=true;
// Independent Paired transport for proven existing-E7a Sessions. Never auto-enabled.
const ENABLE_EXISTING_E7A_PAIRED_TRANSPORT=true;
// Reviewed pilot account ONLY. Empty until an explicit verified-account release.
// This is NOT populated from a URL, localStorage or a browser user preference.
const EXISTING_E7A_PILOT_ACCOUNT_ID='57a6764f-d7dc-4c4e-8f3c-088d1d44e230';
const STAGE7_ORIGIN='https://stage7-app-ui--secret-wlp-pwa.netlify.app';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isExistingE7aPilotAccount=id=>UUID.test(EXISTING_E7A_PILOT_ACCOUNT_ID)&&
 UUID.test(String(id||''))&&String(id).toLowerCase()===EXISTING_E7A_PILOT_ACCOUNT_ID.toLowerCase();
function gate(seam){
 const origin=typeof window!=='undefined'?window.location.origin:'';
 if(origin!==STAGE7_ORIGIN)return false;
 if(seam==='library-install')return ENABLE_FRESH_BROWSER_LIBRARY_SETUP===true;
 if(seam==='legacy-reconcile')return ENABLE_EXISTING_LIBRARY_RECONCILE===true;
 if(seam==='existing-e7a-study')return ENABLE_EXISTING_E7A_STANDARD_JOURNAL===true&&UUID.test(EXISTING_E7A_PILOT_ACCOUNT_ID);
 if(seam==='existing-e7a-paired')return ENABLE_EXISTING_E7A_STANDARD_JOURNAL===true&&ENABLE_EXISTING_E7A_PAIRED_TRANSPORT===true&&UUID.test(EXISTING_E7A_PILOT_ACCOUNT_ID);
 if(ENABLE_PROTECTED_G4_STUDY!==true)return false;
 if(seam==='study'||seam==='continue')return true;
 if(seam==='paired')return ENABLE_G4_FOREGROUND===true;
 return false;
}
// Lifecycle guard. Replacing a Session is permitted ONLY after its exact
// terminal candidate has been durably committed and the draft has been cleared.
function canReplaceG4Session({owned=false,terminalSaved=false,held=false,saving=false,draftDirty=false}={}){
 return owned!==true || (terminalSaved===true&&held!==true&&saving!==true&&draftDirty!==true);
}
function verifyAccount(id,seam){
 if(!gate(seam)||!UUID.test(String(id||''))||
  (String(seam).startsWith('existing-e7a-')&&!isExistingE7aPilotAccount(id)))
  throw Error('Stage7 G4 HOLD: build, host, or verified account not approved');
 return true;
}
return Object.freeze({gate,verifyAccount,isExistingE7aPilotAccount,canReplaceG4Session,status:()=>Object.freeze({
  study:gate('study'),paired:gate('paired'),scope:'Stage7 exact-origin, online verified owner',
  foregroundOnly:true,buildFreshLibraryEnabled:ENABLE_FRESH_BROWSER_LIBRARY_SETUP,
  buildExistingLibraryReconcileEnabled:ENABLE_EXISTING_LIBRARY_RECONCILE,
  buildExistingE7aStandardJournalEnabled:ENABLE_EXISTING_E7A_STANDARD_JOURNAL,
  buildExistingE7aPairedEnabled:ENABLE_EXISTING_E7A_PAIRED_TRANSPORT,
  existingE7aAccountScoped:UUID.test(EXISTING_E7A_PILOT_ACCOUNT_ID),
  buildStudyEnabled:ENABLE_PROTECTED_G4_STUDY,
  buildPairedEnabled:ENABLE_G4_FOREGROUND})});
});
