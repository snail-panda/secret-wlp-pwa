/* G4-1 Standard native Journal writer source contract. OFF BY DEFAULT.
 * This library exports a validator/binder only: it performs no Cloud RPC,
 * no IndexedDB open, no storage mutation and never auto-installs itself.
 * The real G3-B authenticated driver remains a separately reviewed dependency.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.WLPG4StandardSaveContract=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const assert=(v,m)=>{if(!v)throw Error('G4 STANDARD SAVE HOLD: '+m);};
const clone=x=>JSON.parse(JSON.stringify(x));
function validIdentity(id){return id?.verified===true&&typeof id.accountId==='string'&&!!id.accountId&&
 !!id.candidateKey&&!!id.deviceKey&&!!id.generation&&Number.isSafeInteger(id.headVersion)&&id.headVersion>=1;}
function same(a,b){return validIdentity(a)&&validIdentity(b)&&
 ['accountId','candidateKey','deviceKey','generation','headVersion'].every(k=>a[k]===b[k]);}
function make({driver,identityNow}={}){
 assert(driver&&typeof identityNow==='function','trusted driver + live identity required');
 assert(driver.approved===true&&typeof driver.verifyForNewStarts==='function'&&
  typeof driver.prepareStart==='function'&&typeof driver.onContextCreated==='function'&&
  typeof driver.commit==='function'&&typeof driver.stageDraft==='function'&&
  typeof driver.readDraft==='function'&&typeof driver.clearCommittedDraft==='function','verified G3-B Journal driver and draft lane required');
 let frozenIdentity=null,started=false,held=false;
 function verified(){const id=identityNow();assert(validIdentity(id),'owner/authority unavailable');return clone(id);}
 const publicApi={
  approved:true,cloudWrite:false,
  get ready(){return !!frozenIdentity&&!held;},
  async refreshStartProof(){
   assert(!held,'prior HOLD requires explicit reconciliation');
   const before=verified();
   const proof=await driver.verifyForNewStarts();
   assert(proof?.ready===true,'G3-B Journal start proof rejected');
   const after=verified();assert(same(before,after),'identity changed during proof');
   frozenIdentity=after;started=false;return {ready:true};
  },
  // Explicit current E7b wire/Journal compatibility. Do not widen this list
  // to built-set without independently verifying the Cloud wire and receiver.
  supportsSource(source){
   const ids=source?.source?.wordIds;
   return ['deck','range','review-set'].includes(source?.sourceType)&&
     Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&
     ids.every(id=>/^\d+$/.test(String(id)))&&
     new Set(ids.map(String)).size===ids.length;
  },
  async resumeExisting({context,session}={}){
   assert(!held&&!started&&frozenIdentity&&same(frozenIdentity,identityNow()),
    'Resume requires fresh verified Owner/Authority and unused contract');
   assert(typeof driver.resumeExisting==='function','general Resume writer not installed');
   assert(context?.practiceMode==='standard'&&context?.sessionRef?.type==='standard'&&
    context.sessionRef.sessionId===session?.sessionId&&publicApi.supportsSource(context),
    'incompatible original Context and Session');
   assert(context.status==='incomplete'&&['incomplete','ended-early'].includes(session?.status)&&
    Number.isSafeInteger(session.experienceCount)&&session.experienceCount>0&&
    Number.isSafeInteger(session.plannedExperienceCount)&&session.experienceCount<session.plannedExperienceCount,
    'only an incomplete durable Session may be resumed');
   // Identity and Journal must be rechecked by the adapter BEFORE it attaches
   // any per-tab enrollment. A read-only inspection alone is NOT a Resume.
   const receipt=await driver.resumeExisting({context:clone(context),session:clone(session)});
   assert(receipt?.bound===true&&receipt?.contextId===context.contextId&&
    receipt?.sessionId===session.sessionId&&/^[a-f0-9]{64}$/i.test(receipt.parentHash||''),
    'writer did not restore verified durable enrollment');
   assert(same(frozenIdentity,identityNow()),'Owner changed during Resume binding');
   started=true;
   return clone(receipt);
  },
  prepareStart(sessionId,source){
   assert(!held&&frozenIdentity&&same(frozenIdentity,identityNow()),'start owner changed');
   assert(publicApi.supportsSource(source),'source type/wordIds unsupported by verified E7b wire');
   assert(!started&&!!sessionId&&source?.sourceType&&Array.isArray(source?.source?.wordIds),
    'duplicate/invalid start');
   assert(driver.prepareStart(sessionId,clone(source))===true,'driver refused start');
   started=true;return true;
  },
  async onContextCreated(context){
   assert(started&&!held&&same(frozenIdentity,identityNow()),'unverified enrollment');
   assert(context?.practiceMode==='standard'&&context?.sessionRef?.type==='standard',
    'non-standard Context');
   const receipt=await driver.onContextCreated(clone(context));
   assert(receipt?.enrolled===true,'durable enrollment missing');return receipt;
  },
  async commit(candidate){
   assert(started&&!held&&same(frozenIdentity,identityNow()),'save identity unavailable');
   const s=candidate?.session,c=candidate?.context;
   assert(s?.sessionId===candidate?.sessionId&&c?.contextId===candidate?.contextId&&
    c?.sessionRef?.sessionId===s?.sessionId,'Session/Context mismatch');
   assert(['incomplete','completed','ended-early'].includes(s?.status), 'invalid Session status');
   assert(Array.isArray(s.experiences)&&s.experiences.length>=1,'empty Session');
   assert(s.experiences.every(e=>e?.attempt?.eventId&&typeof e.attempt?.responseText==='string'),
    'missing original Events or responses');
   const result=await driver.commit(clone(candidate));
   if(!(result?.status==='pending'&&result?.durable===true&&result?.projected===true)){
    held=true;throw Error('Journal or WLP projection not verified: '+String(result?.status));
   }
   assert(same(frozenIdentity,identityNow()),'identity changed after commit');
   return clone(result);
  },
  async stageDraft(draft){
   assert(started&&!held&&frozenIdentity&&same(frozenIdentity,identityNow()),'draft owner unavailable');
   const result=await driver.stageDraft(clone(draft));
   assert(result?.saved===true&&result?.draftOnly===true,'local draft checkpoint not confirmed');
   assert(same(frozenIdentity,identityNow()),'identity changed after draft checkpoint');
   return clone(result);
  },
  async readDraft(draft){
   assert(started&&!held&&frozenIdentity&&same(frozenIdentity,identityNow()),'draft inspection owner unavailable');
   return driver.readDraft(clone(draft)); // never applies a draft automatically
  },
  async clearCommittedDraft(draft,receipt){
   assert(started&&!held&&frozenIdentity&&same(frozenIdentity,identityNow()),'draft cleanup owner unavailable');
   const result=await driver.clearCommittedDraft(clone(draft),clone(receipt));
   assert(result?.cleared===true,'committed draft cleanup not confirmed');
   return result;
  },
  reportHold:message=>{held=true;try{driver.reportHold?.(String(message));}catch(_){}},
  status:()=>({approved:true,cloudWrite:false,ready:!!frozenIdentity&&!held,held})
 };
 return Object.freeze(publicApi);
}
return Object.freeze({make,validIdentity,same});
});
