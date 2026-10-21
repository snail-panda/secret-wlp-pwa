/* Stage7 E7a v400 pending source actions: READ-ONLY evidence review.
 * The established v400 transport remains the only authorized source writer.
 * A positive result means "worth handing to v400's revalidation", NEVER an
 * ACK or an authorization to write. Unknown mutation shapes fail closed.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7OutboxEvidence=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const SHA=/^[0-9a-f]{64}$/i;
 const fail=message=>{throw Error('Stage7 Outbox HOLD: '+message);};
 const text=x=>String(x??'').trim();
 const KEY=(t,k)=>t+'\u0000'+k;
 const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
 function normalize(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('NON_FINITE_NUMBER');return v;}
  if(Array.isArray(v))return v.map(normalize);
  if(!plain(v))fail('INVALID_JSON_VALUE');
  const out={};for(const k of Object.keys(v).sort()){
   if(['__proto__','prototype','constructor'].includes(k)||v[k]===undefined)fail('UNSAFE_JSON_FIELD');
   out[k]=normalize(v[k]);
  }return out;
 }
 const serialize=v=>JSON.stringify(normalize(v));
 async function hash(v){
  if(!globalThis.crypto?.subtle)fail('CRYPTO_UNAVAILABLE');
  const bytes=new TextEncoder().encode(serialize(v));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function rowMap(rows){
  const m=new Map();for(const r of rows){
   const t=text(r?.tableName??r?.table_name),k=text(r?.rowKey??r?.row_key);
   if(!t||!k||m.has(KEY(t,k)))fail('INVALID_OR_DUPLICATE_CANONICAL_KEY');
   m.set(KEY(t,k),r);
  }return m;
 }
 const fingerprint=r=>r?{tombstone:Boolean(r.tombstone),payloadHash:text(r.payloadHash??r.payload_hash)}:null;
 function sameRow(a,b){
  const x=fingerprint(a),y=fingerprint(b);
  return x===null?y===null:!!y&&x.tombstone===y.tombstone&&x.payloadHash===y.payloadHash;
 }
 function preconditionMatches(pre,row){
  if(pre.rowMustBeAbsent===true||pre.mustBeMissing===true)return !row;
  if(SHA.test(text(pre.payloadHash)))return !!row&&!row.tombstone&&
   text(row.payloadHash??row.payload_hash)===text(pre.payloadHash);
  return false;
 }
 const emptyResult=Object.freeze({code:'NO_PENDING_OUTBOX',rows:0,actions:0,cloudOverlap:0,needsLegacyTransport:false,readOnly:true,canApplyAutomatically:false});
 async function review({rows,baseRows,cloudRows,ownerId,deviceKey,authority}={}){
  if(!Array.isArray(rows)||!Array.isArray(baseRows)||!Array.isArray(cloudRows)||!text(ownerId)||!text(deviceKey)||
   !text(authority?.candidateKey)||!Number.isSafeInteger(authority?.headVersion)||!text(authority?.snapshotManifestHash))
   fail('VERIFIED_OWNER_DEVICE_AUTHORITY_REQUIRED');
  if(rows.length===0)return emptyResult;
  const base=rowMap(baseRows),cloud=rowMap(cloudRows);
  const actions=new Map(),mutations=new Set(),touched=new Map();
  let cloudOverlap=0,collision=0,uncertain=0;
  for(const m of rows){
   const key=KEY(text(m?.tableName),text(m?.rowKey));
   if(!text(m?.tableName)||!text(m?.rowKey)||!text(m?.actionId)||!text(m?.mutationId)||
     !text(m?.deviceKey)||!plain(m.precondition)||!SHA.test(text(m.mutationHash)))
     fail('INCOMPLETE_PERSISTED_MUTATION');
   if(m.status!=='pending'||m.transportEligible!==true||m.diagnosticOnly===true||m.candidateOnly===true)
     fail('NON_TRANSPORT_PENDING_MUTATION');
   if(m.deviceKey!==deviceKey||m.baseAuthority?.candidateKey!==authority.candidateKey||
     Number(m.baseAuthority?.headVersion)!==authority.headVersion||
     m.baseAuthority?.snapshotManifestHash!==authority.snapshotManifestHash)
     fail('ACTION_OWNER_DEVICE_AUTHORITY_MISMATCH');
   if(mutations.has(m.mutationId))fail('DUPLICATE_MUTATION_ID');
   mutations.add(m.mutationId);
   const {mutationHash,...unsigned}=m;
   if((await hash(unsigned))!==text(mutationHash))fail('MUTATION_INTEGRITY_HASH_MISMATCH');
   // The persistent v400 sources use full payload or patch mutations.
   // Verify complete full payload hashes; patch mutationHash protects the
   // patch contents without pretending that a patch is the final row hash.
   if(m.payload!==undefined&&((!SHA.test(text(m.payloadHash)))||(await hash(m.payload))!==m.payloadHash))
     fail('PERSISTED_PAYLOAD_HASH_MISMATCH');
   if(!['insert','append','upsert','patch','delete'].includes(m.mutationKind))fail('UNKNOWN_MUTATION_KIND');
   if(m.mutationKind==='patch'&&!plain(m.patch))fail('PATCH_PAYLOAD_NOT_PRESENT');
   if(m.mutationKind!=='patch'&&!plain(m.payload))fail('FULL_PAYLOAD_NOT_PRESENT');
   const list=actions.get(m.actionId)||[];list.push(m);actions.set(m.actionId,list);
   if(touched.has(key)){
     // Multiple pending writes to same row need the established v400 ordered
     // action resolver; a one-pass comparison is not sufficient.
     uncertain++;continue;
   }
   touched.set(key,true);
   const was=base.get(key),now=cloud.get(key),p=m.precondition;
   if(!preconditionMatches(p,was)){
     // A precondition may be aimed at an in-memory overlay rather than the
     // materialized base: never infer a base from a mutation timestamp.
     uncertain++;continue;
   }
   if(!sameRow(was,now)){
     cloudOverlap++;
     if(!preconditionMatches(p,now))collision++;
   }
  }
  // Duplicate-row actions are included for inventory, without trusting them.
  if(actions.size!==new Set(rows.map(x=>text(x.actionId))).size)uncertain++;
  // One-action-at-a-time handling, precondition checks and idempotent retries
  // still belong to v400; this analyzer issues NO mutations or ACKs.
  const code=collision>0?'HOLD_CLOUD_PRECONDITION_COLLISION':uncertain>0?
   'HOLD_UNPROVEN_OUTBOX_BASE':'OUTBOX_REVALIDATE_WITH_V400';
  return Object.freeze({code,rows:rows.length,actions:actions.size,cloudOverlap,
   needsLegacyTransport:true,readOnly:true,canApplyAutomatically:false});
 }
 return Object.freeze({review});
});
