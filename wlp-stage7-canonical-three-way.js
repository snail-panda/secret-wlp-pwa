/* WLP Stage7 verified 3-way row/field comparison. READ ONLY / SOURCE OFF.
 * This module is a constrained decision layer, NOT a transport or apply engine.
 * It deliberately does NOT infer a common ancestor from a stale local snapshot,
 * timestamp, Authority key, or Cloud head. The caller must verify independent
 * base, local and Cloud evidence, owner and completeness BEFORE calling plan().
 * Existing v400 continues to own compatible Canonical transport/ACK and
 * Cloud Shadow merge simulation remains source of legacy table policies.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7CanonicalThreeWay=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const HOLD=(code)=>{throw Error('Three-way HOLD: '+code);};
 const SAFE=/^[a-z][a-z0-9_]*$/;
 const TABLES=new Set(['cards','card_content','card_classification','card_learning_metadata',
  'learning_state','learning_events','learning_sessions','learner_profile',
  'learner_route_state','learning_situations','learning_alternatives',
  'learning_alternative_situations','study_builds','study_build_cards',
  'study_contexts','study_context_cards','user_preferences','card_local_overrides']);
 const SHA=/^[a-f0-9]{64}$/i;
 const PLAIN=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
   (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
 function clone(x){return x===undefined?undefined:JSON.parse(JSON.stringify(x));}
 function normalized(x){
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'){if(!Number.isFinite(x))HOLD('INVALID_NUMBER');return x;}
  if(Array.isArray(x))return x.map(v=>v===undefined?HOLD('UNDEFINED_ARRAY_VALUE'):normalized(v));
  if(!PLAIN(x))HOLD('NON_JSON_PAYLOAD');
  const out={};for(const k of Object.keys(x).sort()){
   if(['__proto__','prototype','constructor'].includes(k))HOLD('UNSAFE_FIELD_KEY');
   if(x[k]===undefined)HOLD('UNDEFINED_FIELD');
   out[k]=normalized(x[k]);
  }return out;
 }
 const equals=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
 const empty=Object.freeze({present:false});
 function state(obj,key){return Object.prototype.hasOwnProperty.call(obj,key)?{present:true,value:obj[key]}:empty;}
 function same(a,b){return a.present===b.present&&(!a.present||equals(a.value,b.value));}
 function snapshot(rows,label){
  if(!Array.isArray(rows))HOLD(`${label}_ROWS_MISSING`);
  const map=new Map();
  for(const row of rows){
   if(!PLAIN(row)||!TABLES.has(row.table_name)||typeof row.row_key!=='string'||!row.row_key||row.row_key.length>350)HOLD(`${label}_ROW_ID`);
   if(typeof row.tombstone!=='boolean')HOLD(`${label}_TOMBSTONE_NOT_EXPLICIT`);
   if(row.tombstone){if(row.payload!==null)HOLD(`${label}_TOMBSTONE_PAYLOAD`);}
   else if(!PLAIN(row.payload))HOLD(`${label}_PAYLOAD`);
   const key=row.table_name+'\u0000'+row.row_key;
   if(map.has(key))HOLD(`${label}_DUPLICATE_KEY`);
   if(!row.tombstone)normalized(row.payload);
   map.set(key,{table:row.table_name,rowKey:row.row_key,tombstone:row.tombstone,payload:row.tombstone?null:row.payload});
  }
  return map;
 }
 function rowSame(a,b){
  if(!a&&!b)return true;
  if(!a||!b)return false;
  return a.tombstone===b.tombstone&&(a.tombstone||equals(a.payload,b.payload));
 }
 function resolveRow(base,local,cloud){
  if(!base&&(local?.tombstone||cloud?.tombstone))return{code:'TOMBSTONE_REVIEW',blocking:true,fields:[]};
  // Absence in a COMPLETE manifest is a real absence, not an implicit deletion;
  // existing base row cannot disappear without an explicit tombstone.
  if(base&&(!local||!cloud))return{code:'HOLD_MISSING_ROW_WITHOUT_TOMBSTONE',blocking:true,fields:[]};
  const lc=rowSame(local,cloud),lb=rowSame(local,base),cb=rowSame(cloud,base);
  if(lc)return{code:lb?'UNCHANGED':'CONVERGED_EQUAL',blocking:false,fields:[]};
  if(local?.tombstone||cloud?.tombstone)return{code:'TOMBSTONE_REVIEW',blocking:true,fields:[]};
  if(lb)return{code:'CLOUD_ONLY_CANDIDATE',blocking:false,fields:[]};
  if(cb)return{code:'LOCAL_ONLY_CANDIDATE',blocking:false,fields:[]};
  // Scalar/nested top-level properties are atomic; arrays and nested objects
  // must not be independently spliced using guessing or timestamps.
  const fields=[...new Set([...Object.keys(base?.payload||{}),...Object.keys(local?.payload||{}),...Object.keys(cloud?.payload||{})])].sort();
  const decisions=[],conflicts=[];
  for(const key of fields){
   const b=state(base?.payload||{},key),l=state(local.payload,key),c=state(cloud.payload,key);
   const localChanged=!same(b,l),cloudChanged=!same(b,c);
   const code=!localChanged&&!cloudChanged?'UNCHANGED':localChanged&&!cloudChanged?'LOCAL_ONLY':
    !localChanged&&cloudChanged?'CLOUD_ONLY':same(l,c)?'BOTH_EQUAL':'CONFLICT';
   decisions.push({field:key,code});if(code==='CONFLICT')conflicts.push(key);
  }
  return {code:conflicts.length?'FIELD_CONFLICT':'DISJOINT_FIELD_CANDIDATE',
   blocking:conflicts.length>0,fields:decisions,conflictFields:conflicts};
 }
 // EVIDENCE CHECK: the same-owner and common-base proofs are supplied by
 // verified upstream snapshot collectors. The planner does not certify them.
 function plan(input){
  const e=input?.evidence;
  if(!PLAIN(e)||e.ownerVerified!==true||e.commonAncestorVerified!==true||
    e.localSnapshotVerified!==true||e.cloudSnapshotVerified!==true||
    e.localComplete!==true||e.cloudComplete!==true||e.baseComplete!==true)
   HOLD('UNVERIFIED_ANCESTOR_OR_SNAPSHOT');
  if(typeof e.ownerId!=='string'||!/^[0-9a-f-]{36}$/i.test(e.ownerId))HOLD('OWNER_UNVERIFIED');
  if(typeof e.baseManifestHash!=='string'||!SHA.test(e.baseManifestHash))HOLD('BASE_MANIFEST_UNVERIFIED');
  if(!Number.isSafeInteger(e.baseCursor)||e.baseCursor<0||
    !Number.isSafeInteger(e.localCursor)||e.localCursor<e.baseCursor||
    !Number.isSafeInteger(e.cloudCursor)||e.cloudCursor<e.baseCursor)HOLD('CURSOR_PROOF_MISSING');
  if(!Number.isSafeInteger(e.outboxCount)||e.outboxCount<0)HOLD('OUTBOX_COUNT_UNKNOWN');
  if(!Number.isSafeInteger(e.localEditCount)||e.localEditCount<0||
     !Number.isSafeInteger(e.localDraftCount)||e.localDraftCount<0||
     !Number.isSafeInteger(e.pendingJournalCount)||e.pendingJournalCount<0||
     typeof e.unknownLegacyData!=='boolean')HOLD('LOCAL_INVENTORY_INCOMPLETE');
  const base=snapshot(input.baseRows,'BASE'),local=snapshot(input.localRows,'LOCAL'),cloud=snapshot(input.cloudRows,'CLOUD');
  const all=[...new Set([...base.keys(),...local.keys(),...cloud.keys()])].sort();
  const decisions=[];const count={UNCHANGED:0,CONVERGED_EQUAL:0,CLOUD_ONLY_CANDIDATE:0,LOCAL_ONLY_CANDIDATE:0,DISJOINT_FIELD_CANDIDATE:0,FIELD_CONFLICT:0,DELETE_VS_EDIT_CONFLICT:0,TOMBSTONE_REVIEW:0,HOLD_MISSING_ROW_WITHOUT_TOMBSTONE:0};
  for(const key of all){const row=base.get(key)||local.get(key)||cloud.get(key);const d=resolveRow(base.get(key),local.get(key),cloud.get(key));
   count[d.code]++;
   decisions.push(Object.freeze({tableName:row.table,rowKey:row.rowKey,code:d.code,
     blocking:d.blocking,fields:(d.fields||[]).map(x=>Object.freeze(x)),conflictFields:d.conflictFields||[]}));
  }
  const blockers=decisions.filter(x=>x.blocking);
  // These are review candidates, not automatic resolution. The actual writer
  // needs verified mutation base hashes + device ownership + transactional RPC.
  const anyLocal=decisions.some(x=>['LOCAL_ONLY_CANDIDATE','DISJOINT_FIELD_CANDIDATE'].includes(x.code));
  const localNeedsReview=anyLocal||e.outboxCount>0||e.localEditCount>0||e.localDraftCount>0||
    e.pendingJournalCount>0||e.unknownLegacyData;
  return Object.freeze({format:'WLP_STAGE7_CANONICAL_THREE_WAY_PLAN',version:1,readOnly:true,
   canApplyAutomatically:false,needsConflictReview:blockers.length>0,
   needsLocalMutationReview:Boolean(localNeedsReview),
   ownerId:e.ownerId,baseManifestHash:e.baseManifestHash,
   baseCursor:e.baseCursor,localCursor:e.localCursor,cloudCursor:e.cloudCursor,
   pendingOutbox:e.outboxCount,localEditCount:e.localEditCount,localDraftCount:e.localDraftCount,
   pendingJournalCount:e.pendingJournalCount,unknownLegacyData:e.unknownLegacyData,
   totalRows:decisions.length,counts:count,decisions,
   status:blockers.length?'HOLD_CONFLICT_REVIEW':localNeedsReview?'HOLD_LOCAL_CHANGE_REVIEW':'READY_FOR_EXISTING_TRANSPORT_RECHECK',
   nextStep:'No mutation. Revalidate owner, Authority, all row hashes, Outbox and Cloud cursor using the established transport before any apply.'});
 }
 return Object.freeze({plan,resolveRow,equals,TABLES:Object.freeze([...TABLES])});
});
