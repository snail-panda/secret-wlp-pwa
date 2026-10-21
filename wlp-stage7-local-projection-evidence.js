/* Stage7: read-only, per-record proof for legacy Draft/Local Edit projections.
 * Does not mutate localStorage, IDB or Cloud. Never equates localStorage presence
 * with account ownership; the caller must attest verified Cloud & local Mirror.
 * This module is not a migration, import, or automatic conflict resolver.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7LocalProjectionEvidence=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const DRAFT='wlp:local-additions:v1',EDIT='wlp:local-overrides:v1';
 const FIELDS=Object.freeze([['Word','word'],['IPA','ipa'],['Part of Speech','part_of_speech'],
  ['Definition','definition'],['Synonym(s)','synonyms'],['Example Sentence','example_sentence'],
  ['Note(s)','notes'],['Category','category'],['Source','source']]);
 const fail=c=>{throw Error('Legacy projection HOLD: '+c)};
 const str=v=>String(v??'');
 const shaPattern=/^[a-f0-9]{64}$/i;
 const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
 const stable=v=>Array.isArray(v)?v.map(stable):plain(v)?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
 async function sha(s){if(!globalThis.crypto?.subtle)fail('SHA256_NOT_AVAILABLE');const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');}
 const project=d=>Object.fromEntries(FIELDS.map(([k,v])=>[v,str(d?.[k])]));
 const fingerprint=(storage)=>JSON.stringify([storage.getItem(DRAFT),storage.getItem(EDIT)]);
 function parse(storage){
  if(!storage||typeof storage.getItem!=='function')fail('LOCAL_STORAGE_UNAVAILABLE');
  const parseKey=(key,empty,assert)=>{
   const raw=storage.getItem(key);if(raw===null)return empty;
   let obj;try{obj=JSON.parse(raw);}catch{fail('INVALID_JSON_'+key);}
   if(!assert(obj))fail('INVALID_SHAPE_'+key);return obj;
  };
  const drafts=parseKey(DRAFT,[],Array.isArray),edits=parseKey(EDIT,{},plain);
  if(drafts.some(x=>!plain(x))||Object.values(edits).some(x=>!plain(x)))fail('INVALID_RECORD');
  return {drafts,edits};
 }
 const canonMap=rows=>{
  if(!Array.isArray(rows))fail('VERIFIED_CANONICAL_ROWS_MISSING');
  const out=new Map();for(const r of rows){
   if(!r||!['cards','card_content','card_local_overrides'].includes(r.tableName)||!str(r.rowKey))continue;
   const k=r.tableName+'\0'+r.rowKey;if(out.has(k))fail('CANONICAL_DUPLICATE_ROW');
   if(!r.tombstone&&(!plain(r.payload)||!shaPattern.test(str(r.payloadHash))))fail('CANONICAL_ROW_UNVERIFIED');
   out.set(k,r);
  }return out;
 };
 function officialCards(map){const byWid=new Map();for(const [key,row] of map){
  if(!key.startsWith('cards\0')||row.tombstone)continue;
  const p=row.payload||{},wid=str(p.word_id);
  if(p.status==='active'&&p.origin_kind==='official'&&/^\d+$/.test(wid)){
   if(byWid.has(wid))fail('DUPLICATE_OFFICIAL_WORD_ID');byWid.set(wid,row);
  }
 }return byWid;}
 function draftIdentity(map,id){const matches=[];for(const [key,r] of map){
  if(!key.startsWith('cards\0')||r.tombstone)continue;
  const p=r.payload||{};
  if(p.origin_kind==='personal'&&str(p.origin_ref)===id&&p.status==='draft'&&str(p.legacy_key)==='draft:'+id)matches.push(r);
 }return matches.length===1?matches[0]:null;}
 function contentEquals(payload,draft){return FIELDS.every(([k,v])=>str(payload?.[v])===str(draft?.[k]));}
 function overlayForWid(map,wid){
  const matches=[];
  for(const [key,row] of map){
   if(!key.startsWith('card_local_overrides\0')||row.tombstone||str(row.payload?.deleted_at))continue;
   if(str(row.payload?.legacy_word_id)===wid)matches.push(row);
  }
  return matches.length===1?matches[0]:null;
 }
 function overlayProjectionMatches(payload,local){
  // This is the exact v400 localOverrideFromCanonical projection, not an
  // inferred match by WID, timestamps or a subset of the edited fields.
  const keys=new Set([...FIELDS.map(([k])=>k),'updatedAt','__noteLineBreaks']);
  if(Object.keys(local).some(k=>!keys.has(k)))return false;
  return FIELDS.every(([k,v])=>str(local[k])===str(payload?.[v]))&&
   str(local.updatedAt)===str(payload?.updated_at)&&
   local.__noteLineBreaks===Boolean(payload?.note_line_breaks);
 }
 function validOverlay(row,wid,official,content){
  if(!row||row.tombstone||!plain(row.payload)||!official||!content||content.tombstone)return false;
  const o=row.payload,c=official.payload||{};
  return str(row.rowKey)===str(o.card_id)&&str(official.rowKey)===str(o.card_id)&&
   str(c.card_id)===str(o.card_id)&&c.origin_kind==='official'&&c.status==='active'&&
   str(c.legacy_key)==='wid:'+wid&&str(c.word_id)===wid&&
   str(o.legacy_word_id)===wid&&Number.isSafeInteger(o.revision)&&o.revision>=1&&
   !!str(o.updated_at)&&!!str(o.updated_by_device)&&!str(o.deleted_at)&&
   str(o.base_official_content_hash)===str(content.payloadHash);
 }
 // Read-only decision only; all content remains inside the isolated collector.
 async function review({ownerVerified,baseVerified,cloudVerified,localMirrorVerified,baseRows,cloudRows,storage,expectedDraftCount,expectedEditCount}={}){
  if(ownerVerified!==true)fail('ACCOUNT_OWNER_UNVERIFIED');
  if(baseVerified!==true||cloudVerified!==true||localMirrorVerified!==true)fail('VERIFIED_HISTORY_OR_MIRROR_REQUIRED');
  const before=fingerprint(storage),{drafts,edits}=parse(storage);
  if(!Number.isSafeInteger(expectedDraftCount)||expectedDraftCount!==drafts.length||
     !Number.isSafeInteger(expectedEditCount)||expectedEditCount!==Object.keys(edits).length)
   fail('INVENTORY_COUNT_DIFFERENT');
  const base=canonMap(baseRows),cloud=canonMap(cloudRows),codes=[],seen=new Set();
  for(const d of drafts){
   const id=str(d.localId).trim();
   if(!id||seen.has(id)){codes.push('HOLD_DRAFT_IDENTITY');continue;}seen.add(id);
   const b=draftIdentity(base,id),c=draftIdentity(cloud,id);
   if(!b||!c||b.rowKey!==c.rowKey){codes.push('HOLD_DRAFT_IDENTITY');continue;}
   const bc=base.get('card_content\0'+b.rowKey),cc=cloud.get('card_content\0'+c.rowKey);
   if(!bc||!cc||bc.tombstone||cc.tombstone){codes.push('HOLD_DRAFT_CONTENT_ABSENT');continue;}
   const expectedHash=await sha(JSON.stringify(stable(Object.fromEntries(FIELDS.map(([k])=>[k,str(d[k]).trim()])))));
   if(!contentEquals(bc.payload,d)||!contentEquals(cc.payload,d)||
      str(bc.payload.source_payload_hash)!==expectedHash||str(cc.payload.source_payload_hash)!==expectedHash){
    codes.push('HOLD_DRAFT_CHANGED_OR_UNPROVEN');continue;
   }
   codes.push('DRAFT_PROJECTION_MATCHES_VERIFIED_BASE_AND_CLOUD');
  }
  // The verified Cloud historical/current snapshots include overlays, but
  // v400 intentionally excludes them from the normal IndexedDB Mirror.
  // Prove the *entire* overlay projection using both immutable ledger states.
  const officialBase=officialCards(base),officialCloud=officialCards(cloud);
  const activeOverrides=map=>[...map.values()].filter(row=>
   row.tableName==='card_local_overrides'&&!row.tombstone&&!str(row.payload?.deleted_at));
  const historicalActive=activeOverrides(base),cloudActive=activeOverrides(cloud);
  const editIds=Object.keys(edits);
  // An unrepresented active Cloud overlay cannot be silently ignored, even if
  // localStorage has no edits. The receiver must not overwrite a missing map.
  if(historicalActive.length!==editIds.length||cloudActive.length!==editIds.length)
   codes.push('HOLD_OVERLAY_INVENTORY_MISMATCH');
  for(const [wid,edit] of Object.entries(edits)){
   if(!/^\d+$/.test(wid)||!officialBase.has(wid)||!officialCloud.has(wid)||!plain(edit)){
    codes.push('HOLD_LOCAL_EDIT_IDENTITY');continue;
   }
   const b=overlayForWid(base,wid),c=overlayForWid(cloud,wid);
   if(!b||!c||b.rowKey!==c.rowKey||b.payloadHash!==c.payloadHash){
    codes.push('HOLD_OVERLAY_MISSING_OR_CHANGED');continue;
   }
   const bc=base.get('card_content\0'+b.rowKey),cc=cloud.get('card_content\0'+c.rowKey);
   if(!validOverlay(b,wid,officialBase.get(wid),bc)||
      !validOverlay(c,wid,officialCloud.get(wid),cc)){
    codes.push('HOLD_OVERLAY_AUTHORITY_OR_BASE_HASH');continue;
   }
   if(!overlayProjectionMatches(b.payload,edit)||!overlayProjectionMatches(c.payload,edit)){
    codes.push('HOLD_LOCAL_EDIT_PROJECTION_DIFFERS');continue;
   }
   codes.push('LOCAL_EDIT_MATCHES_VERIFIED_BASE_AND_CLOUD_OVERLAY');
  }
  const after=fingerprint(storage);
  if(before!==after)fail('LOCAL_PROJECTION_CHANGED_DURING_READ');
  const count=code=>codes.filter(x=>x===code).length;
  const verifiedDraftCount=count('DRAFT_PROJECTION_MATCHES_VERIFIED_BASE_AND_CLOUD');
  const verifiedLocalEditCount=count('LOCAL_EDIT_MATCHES_VERIFIED_BASE_AND_CLOUD_OVERLAY');
  return Object.freeze({format:'WLP_STAGE7_LEGACY_PROJECTION_PROOF',readOnly:true,
   totalDrafts:drafts.length,verifiedDraftCount,totalLocalEdits:editIds.length,verifiedLocalEditCount,
   unresolvedCount:codes.length-verifiedDraftCount-verifiedLocalEditCount,
   draftProjectionsProven:verifiedDraftCount===drafts.length,
   localEditProjectionsProven:verifiedLocalEditCount===editIds.length&&
    historicalActive.length===editIds.length&&cloudActive.length===editIds.length,
   // Projection bytes are redacted; digest is useful for a second read.
   projectionFingerprint:await sha(before),
   codes:Object.freeze([...new Set(codes)].sort()),
   eligibleForExistingV400:codes.length===verifiedDraftCount+verifiedLocalEditCount});
 }
 return Object.freeze({review,parse,project});
});
