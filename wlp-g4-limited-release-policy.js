/* WLP G4-1 LIMITED RELEASE POLICY. Compile-time configuration only.
 * SOURCE REVIEW: all switches OFF. No URL, localStorage or query override.
 * For an isolated release, the exact origin and account UUID must be reviewed
 * and compiled into a distinct ZIP; never upload that ZIP to ordinary E7a.
 */
(function(root,factory){const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPG4LimitedPilotPolicy=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const BUILD_APPROVED=false;
const APPROVED_ORIGIN='';
const APPROVED_ACCOUNT_ID='';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEAMS=Object.freeze(['study','continue','paired']);
function originNow(){return typeof window==='undefined'?'':window.location.origin;}
function gate(seam){return BUILD_APPROVED===true &&
 SEAMS.includes(seam) && /^https:\/\//.test(APPROVED_ORIGIN) &&
 originNow()===APPROVED_ORIGIN && UUID.test(APPROVED_ACCOUNT_ID);}
function verifyAccount(accountId,seam){
 if(!gate(seam)||String(accountId||'').toLowerCase()!==APPROVED_ACCOUNT_ID.toLowerCase())
   throw Error('G4 limited release HOLD: unapproved origin or account');
 return true;
}
return Object.freeze({gate,verifyAccount,status:()=>Object.freeze({approved:gate('study'),
 configured:BUILD_APPROVED,scope:'exact-origin-and-account',autoSync:false})});
});
