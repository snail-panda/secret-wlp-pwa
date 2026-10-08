/* WLP P1-C2: PURE, read-only field policy. No browser storage, Cloud or live UI writes.
   Legacy override records are full 9-field snapshots, not auditable field patches.
   Without the pre-edit base, a difference alone NEVER proves newer local intent. */
(() => {
  'use strict';
  const FIELDS=Object.freeze([
    ['Word','word'],['IPA','ipa'],['Part of Speech','part_of_speech'],
    ['Definition','definition'],['Synonym(s)','synonyms'],
    ['Example Sentence','example_sentence'],['Note(s)','notes'],
    ['Category','category'],['Source','source']
  ]);
  const normalize=value=>String(value??'').replace(/\r\n?/g,'\n').trim();
  const same=(a,b)=>String(a??'')===String(b??'');
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};

  // All decisions use Canonical as a SHADOW preview only. Held fields prohibit live cutover.
  // Nothing here mutates legacy records or silently resolves a genuine conflict.
  function classifyField(base,canonical,local,hasField){
    if(!hasField)return 'missing-local-field-hold';
    if(same(local,canonical))return 'matches-canonical';
    if(normalize(local)===normalize(canonical))return 'format-only-review';
    if(same(local,base)&&!same(canonical,base))return 'canonical-advanced';
    if(same(base,canonical)&&!same(local,base))return 'local-provenance-unknown-hold';
    return 'divergent-history-unknown-hold';
  }
  const HOLD=new Set(['missing-local-field-hold','local-provenance-unknown-hold','divergent-history-unknown-hold','format-only-review']);
  const publicLabels=Object.freeze({
    'matches-canonical':'Matches Canonical · no extra overlay needed',
    'canonical-advanced':'Canonical has advanced · preserve both, preview Canonical',
    'format-only-review':'Formatting differs · review before cutover',
    'local-provenance-unknown-hold':'Local differs, origin unknown · HOLD for review',
    'divergent-history-unknown-hold':'Both differ, origin unknown · HOLD for review',
    'missing-local-field-hold':'Incomplete legacy record · HOLD for review'
  });
  function evaluate(master,byWid,overrides,comparison){
    assert(comparison?.status==='PASS','P1-C source comparison must PASS before P1-C2 policy evaluation');
    assert(comparison?.active?.source==='cloud'&&comparison.active.accountBound===true,'Account-bound Cloud projection required');
    assert(comparison.active.accountOwnershipReverified===false,'Unexpected ownership state: review integration before using this policy');
    assert(master instanceof Map&&byWid instanceof Map,'Source maps missing');
    assert(overrides&&typeof overrides==='object'&&!Array.isArray(overrides),'Legacy Local Edit snapshot missing');
    const wids=Object.keys(overrides).map(Number).sort((a,b)=>a-b);
    const expected=comparison.ids?.legacyOverrideWids||[];
    assert(JSON.stringify(wids)===JSON.stringify(expected),'Local Edit set changed since P1-C source comparison');
    const summary={legacyCopies:wids.length,fieldSnapshots:0,matchesCanonical:0,canonicalAdvanced:0,formatReview:0,localUnknownHold:0,divergentHold:0,missingHold:0,heldFields:0,heldCards:0,canonicalOnlyCards:comparison.counts.projectionOnly};
    const byWord=[];
    for(const wid of wids){
      const base=master.get(wid),official=byWid.get(wid),local=overrides[String(wid)];
      assert(base&&official?.effectiveContent&&local&&typeof local==='object'&&!Array.isArray(local),`WID${wid}: missing data or invalid Local Edit`);
      const fields=[];
      for(const [label,key] of FIELDS){
        const classification=classifyField(base[label],official.effectiveContent[key],local[label],own(local,label));
        summary.fieldSnapshots++;
        if(classification==='matches-canonical')summary.matchesCanonical++;
        if(classification==='canonical-advanced')summary.canonicalAdvanced++;
        if(classification==='format-only-review')summary.formatReview++;
        if(classification==='local-provenance-unknown-hold')summary.localUnknownHold++;
        if(classification==='divergent-history-unknown-hold')summary.divergentHold++;
        if(classification==='missing-local-field-hold')summary.missingHold++;
        if(HOLD.has(classification))summary.heldFields++;
        fields.push({field:label,classification,held:HOLD.has(classification),preview:'canonical-only (shadow; no live cutover)'});
      }
      if(fields.some(f=>f.held))summary.heldCards++;
      byWord.push({wid,fields});
    }
    assert(summary.fieldSnapshots===summary.legacyCopies*FIELDS.length,'Not all nine fields were evaluated');
    const held=byWord.flatMap(r=>r.fields.filter(f=>f.held).map(f=>({wid:r.wid,field:f.field,classification:f.classification})));
    return {
      status:summary.heldFields?'REVIEW REQUIRED':'PREVIEW READY',
      statement:'Canonical preview only; uncertain Legacy Local Edit fields retained and held. LIVE CUTOVER NOT AUTHORIZED.',
      summary,byWord,held,
      constraints:{readOnly:true,previewUsesCanonical:true,localEditsPreserved:true,unresolvedNeverAutoMerged:true,historyBaseUnavailable:true,accountOwnershipReverified:false,liveCutoverAuthorized:false,noCloudCalls:true,noDataWritten:true}
    };
  }
  const api=Object.freeze({classifyField,evaluate,publicLabels});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.WLPP1C2Policy=api;
})();
