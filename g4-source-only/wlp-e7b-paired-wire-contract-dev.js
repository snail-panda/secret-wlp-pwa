/* WLP E7b: PostgreSQL v0.3 paired-wire contract adapter.
 * DEVELOPMENT ONLY. No network, no credentials, no Cloud mutation, no storage, no UI.
 * Does NOT provide a trusted sign-in or account proof. Consumer MUST inject
 * verified Supabase identity AND independently verified Canonical card rows.
 * This is NOT a replacement for the existing Local Journal uploader/receiver.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPE7bPairedWireDEV=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const NAMESPACE='87dc20eddd355ba38bde04bf389874ce';
const CHANNEL='paired-standard-context-v1';
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clean=x=>String(x??'').trim();
const copy=x=>JSON.parse(JSON.stringify(x));
const fail=x=>{throw new Error('E7b paired wire rejected: '+x);};
const check=(x,message)=>{if(!x)fail(message);};
const uuidRe=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const numericWID=x=>/^\d+$/.test(clean(x));
const nonNegInt=x=>Number.isSafeInteger(x)&&x>=0;
function normalizeIdentity(identity){
 check(isObj(identity)&&identity.verified===true,'trusted-identity-required');
 for(const k of ['accountId','deviceKey','candidateKey','generation']) check(clean(identity[k]),'identity-'+k+'-required');
 check(uuidRe.test(identity.accountId),'account-must-be-uuid');
 check(nonNegInt(identity.headVersion),'authority-head-version-required');
 return identity;
}
function sameIdentity(a,b){
 return !!a&&!!b&&a.verified===true&&b.verified===true&&
 ['accountId','deviceKey','candidateKey','headVersion','generation'].every(k=>a[k]===b[k]);
}
function cryptoAPI(){
 if(typeof globalThis!=='undefined'&&globalThis.crypto?.subtle)return globalThis.crypto;
 if(typeof require==='function') return require('node:crypto').webcrypto;
 fail('WebCrypto-unavailable');
}
async function uuidV5(name){
 check(typeof name==='string'&&name.length<=2048,'invalid-uuid-name');
 const ns=new Uint8Array(NAMESPACE.match(/../g).map(v=>parseInt(v,16)));
 const message=new TextEncoder().encode(name);
 const bytes=new Uint8Array(ns.length+message.length);bytes.set(ns);bytes.set(message,ns.length);
 const digest=new Uint8Array(await cryptoAPI().subtle.digest('SHA-1',bytes));
 const out=digest.slice(0,16);out[6]=(out[6]&15)|80;out[8]=(out[8]&63)|128;
 const hex=Array.from(out,b=>b.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
}
function validateBodies(context,session){
 check(isObj(context)&&isObj(session),'paired-bodies-required');
 check(clean(context.contextId)&&clean(session.sessionId),'context-session-source-ids-required');
 check(context.practiceMode==='standard'&&['deck','range','review-set'].includes(context.sourceType),'unsupported-context-source');
 check(context.sessionRef?.type==='standard'&&context.sessionRef.sessionId===session.sessionId,'context-session-reference-mismatch');
 check(['active','incomplete','completed'].includes(context.status),'unsupported-context-status');
 check(['incomplete','ended-early','completed'].includes(session.status),'unsupported-session-status');
 check(session.status!=='completed'||context.status==='completed','completed-session-needs-completed-context');
 const ids=context.source?.wordIds,subset=session.wordIds,exps=session.experiences,p=context.progress;
 check(Array.isArray(ids)&&ids.length>=1&&ids.length<=1000,'invalid-context-word-list');
 check(ids.every(numericWID)&&new Set(ids.map(clean)).size===ids.length,'invalid-or-duplicate-context-word-id');
 check(Array.isArray(subset)&&Array.isArray(exps)&&subset.length===exps.length&&subset.length<=ids.length,'invalid-saved-experiences');
 check(isObj(session.counts)&&session.experienceCount===subset.length&&nonNegInt(session.plannedExperienceCount)&&session.plannedExperienceCount>=subset.length,'invalid-session-counts');
 let last=-1;
 subset.forEach((wid,i)=>{
  const at=ids.findIndex(id=>clean(id)===clean(wid));
  check(at>last,'session-order-not-source-subsequence');
  check(isObj(exps[i])&&clean(exps[i].wordId)===clean(wid)&&isObj(exps[i].attempt),'session-experience-or-attempt-mismatch');
  last=at;
 });
 check(isObj(p)&&nonNegInt(p.totalCount)&&nonNegInt(p.completedCount)&&nonNegInt(p.currentIndex),'invalid-context-progress');
 check(p.totalCount>=ids.length&&p.currentIndex<=ids.length&&p.completedCount===subset.length,'inconsistent-progress-counts');
 check(Array.isArray(p.completedWordIds)&&p.completedWordIds.every(wid=>subset.some(w=>clean(w)===clean(wid))),'completed-word-id-not-in-saved-session');
 if(clean(p.currentWordId))check(ids.some(wid=>clean(wid)===clean(p.currentWordId)),'current-word-id-not-in-source');
 check(JSON.stringify({context,session}).length<=1024*1024,'action-data-over-sql-limit');
 return ids.map(clean);
}
async function verifiedCards(ids,cardRows){
 check(Array.isArray(cardRows),'authenticated-canonical-card-evidence-required');
 const rows=new Map();
 for(const row of cardRows){
  if(!isObj(row))continue;
  const wid=clean(row.wid||row.payload?.legacy_key?.replace(/^wid:/,''));
  if(wid)rows.set(wid,row);
 }
 const cards=[];
 for(const wid of ids){
  const row=rows.get(wid),id=await uuidV5('card|wid:'+wid);
  check(row&&row.tombstone===false&&clean(row.rowKey||row.row_key)===id&&row.payload?.legacy_key==='wid:'+wid,
    'card-authority-evidence-mismatch-for-wid-'+wid);
  cards.push({cardId:id,wid});
 }
 return cards;
}
async function buildAction({identity,revision,actionId,cardRows}){
 const id=normalizeIdentity(identity);
 check(isObj(revision)&&revision.accountId===id.accountId&&revision.candidateKey===id.candidateKey&&
   revision.deviceKey===id.deviceKey&&revision.headVersion===id.headVersion,'revision-account-device-authority-mismatch');
 check(revision.kind==='standard-session-context-pair'&&revision.accountBoundAtStart===true,'owner-unverified-local-revision');
 check(uuidRe.test(actionId),'action-id-must-be-uuid');
 const c=copy(revision.context),s=copy(revision.session),ids=validateBodies(c,s);
 await verifiedCards(ids,cardRows);
 const base=revision.baseRevision,token=revision.baseToken;
 check(nonNegInt(base),'original-base-revision-required');
 if(base>0)check(clean(token),'original-base-token-required');
 else check(token===null||token===undefined,'create-must-have-null-base-token');
 const action={action_id:actionId,operation:base===0?'create':'revise',
  context_id:await uuidV5('context|'+c.contextId),session_id:await uuidV5('session|standard:'+s.sessionId),
  source_context_id:c.contextId,source_session_id:s.sessionId,candidate_key:id.candidateKey,
  head_version:id.headVersion,base_revision:base,context:c,session:s};
 if(base>0)action.base_token=token;
 check(JSON.stringify(action).length<=1024*1024,'paired-action-over-sql-limit');
 return copy(action); // Persist this complete immutable action BEFORE any RPC. Do not regenerate on retry.
}
function validateAppliedAck(ack,preparedAction){
 check(isObj(ack)&&isObj(preparedAction)&&ack.status==='applied','not-an-applied-ack');
 check(ack.action_id===preparedAction.action_id&&ack.context_id===preparedAction.context_id&&
  ack.session_id===preparedAction.session_id,'ack-action-identity-mismatch');
 check(nonNegInt(ack.revision)&&ack.revision>0&&clean(ack.server_token)&&
   nonNegInt(ack.paired_seq)&&ack.paired_seq>0,'invalid-ack-revision-or-cursor');
 check(ack.revision===preparedAction.base_revision+1,'ack-revision-not-next');
 return Object.freeze({status:'applied',actionId:ack.action_id,contextId:ack.context_id,
  sessionId:ack.session_id,serverRevision:ack.revision,serverToken:ack.server_token,
  pairedSeq:ack.paired_seq,idempotent:ack.idempotent===true});
}
async function validatePullFrame(frame,identity,cardRows){
 const id=normalizeIdentity(identity);
 check(isObj(frame)&&frame.channel===CHANNEL,'invalid-frame-channel');
 check(frame.account_id===id.accountId&&frame.candidate_key===id.candidateKey&&
  frame.head_version===id.headVersion,'frame-account-or-authority-mismatch');
 check(uuidRe.test(frame.action_id)&&uuidRe.test(frame.context_id)&&uuidRe.test(frame.session_id),'invalid-frame-action-or-pair-id');
 check(nonNegInt(frame.paired_seq)&&frame.paired_seq>0,'invalid-frame-sequence');
 check(isObj(frame.record),'invalid-frame-record');
 const c=frame.record.context,s=frame.record.session,ids=validateBodies(c,s);
 check(frame.source_context_id===c.contextId&&frame.source_session_id===s.sessionId,'frame-source-id-mismatch');
 check(frame.context_id===await uuidV5('context|'+c.contextId)&&
   frame.session_id===await uuidV5('session|standard:'+s.sessionId),'frame-pair-uuid-mismatch');
 const verified=await verifiedCards(ids,cardRows);
 check(Array.isArray(frame.record.children)&&frame.record.children.length===ids.length,'invalid-frame-children-length');
 for(let i=0;i<verified.length;i++){
  const row=frame.record.children[i];
  check(isObj(row)&&row.context_id===frame.context_id&&row.ordinal===i&&
   row.card_id===verified[i].cardId,'child-order-or-canonical-card-id-mismatch');
 }
 check(nonNegInt(frame.record.revision)&&frame.record.revision>=1&&clean(frame.record.server_token),'invalid-server-revision-token');
 return Object.freeze({accountId:id.accountId,candidateKey:id.candidateKey,headVersion:id.headVersion,
  contextId:c.contextId,sessionId:s.sessionId,serverRevision:frame.record.revision,
  serverToken:frame.record.server_token,seq:frame.paired_seq,actionId:frame.action_id,
  context:copy(c),session:copy(s)});
}
function toContinueFrame(validated,committedReceipt){
 check(isObj(validated)&&isObj(committedReceipt)&&committedReceipt.source==='e7b-idb-paired-receiver-commit-v1'&&
   committedReceipt.durable===true&&committedReceipt.accountId===validated.accountId&&
   committedReceipt.candidateKey===validated.candidateKey&&
   committedReceipt.seq===validated.seq&&committedReceipt.contextId===validated.contextId&&
   committedReceipt.sessionId===validated.sessionId,'trusted-durable-receiver-commit-required');
 return {accountId:validated.accountId,candidateKey:validated.candidateKey,contextId:validated.contextId,
   sessionId:validated.sessionId,serverRevision:validated.serverRevision,serverToken:validated.serverToken,
   receiverCommitted:true,hasPending:false,context:copy(validated.context),session:copy(validated.session)};
}
return Object.freeze({uuidV5,normalizeIdentity,sameIdentity,validateBodies,buildAction,
 validateAppliedAck,validatePullFrame,toContinueFrame,CHANNEL});
});
