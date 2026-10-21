/* Stage7 existing Mirror / verified historical feed -> three-way planner.
 * Read-only source candidate. Not a migration or apply API.
 * The source alone attests owner, materialized Mirror hashes, historical
 * common cursor manifest, current Cloud highwater and preserved inventories.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7CanonicalEvidenceCollector=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function make({verifiedSnapshot,planner}={}){
  if(!verifiedSnapshot?.collectExistingEvidenceReadOnly||!planner?.plan)
   throw Error('Existing evidence Collector HOLD: trusted Cloud/Mirror reader or planner unavailable');
  let busy=false;
  async function inspectReadOnly(){
   if(busy)throw Error('Existing evidence Collector HOLD: already checking; no second read');
   busy=true;
   try{
    const material=await verifiedSnapshot.collectExistingEvidenceReadOnly();
    const result=planner.plan(material);
    if(result.readOnly!==true||result.canApplyAutomatically!==false)
     throw Error('Evidence Collector HOLD: planner returned writable outcome');
    return Object.freeze({code:result.status,readOnly:true,canApplyAutomatically:false,
      localCursor:result.localCursor,cloudCursor:result.cloudCursor,rowsCompared:result.totalRows,
      counts:Object.freeze({...result.counts}),
      outboxReview:Object.freeze({...material.outboxReview}),
      legacyProjection:Object.freeze({...material.legacyProjection}),needsConflictReview:result.needsConflictReview,
      needsLocalMutationReview:result.needsLocalMutationReview,
      localOutbox:result.pendingOutbox,localEditCount:result.localEditCount,
      localDraftCount:result.localDraftCount,unknownLegacyData:result.unknownLegacyData,
      // no raw payload, token, account email, or mutable evidence is exposed
      proof:Object.freeze({...material.proof})});
   }finally{busy=false;}
  }
  return Object.freeze({inspectReadOnly});
 }
 return Object.freeze({make});
});
