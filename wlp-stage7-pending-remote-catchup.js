/* WLP Stage7 SOURCE OFF — no writer. Fail-closed read-only remote/action scope gate.
 * Only established v400 may verify the remote action and commit it. A pass
 * permits ONE receiver action while a pinned pending Outbox is retained.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.WLPStage7PendingRemoteCatchup=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const TABLES=new Set(['cards','card_content','card_classification','card_learning_metadata',
  'learning_state','learning_events','learning_situations','learning_alternatives',
  'learning_alternative_situations','card_local_overrides']);
 const str=x=>String(x??'').trim();
 const fail=x=>{throw Error('Stage7 pending remote catch-up HOLD: '+x);};
 function tokens(row,isRemote){
  const t=str(isRemote?row?.table_name:row?.tableName),k=str(isRemote?row?.row_key:row?.rowKey),
   p=(isRemote?row?.payload:(row?.payload||row?.patch));
  if(!TABLES.has(t)||!k||!p||typeof p!=='object'||Array.isArray(p))fail('UNVERIFIED_ACTION_SCOPE');
  const out=new Set(['exact:'+t+'\u0000'+k,'row:'+k]);
  const add=(type,value)=>{const x=str(value);if(x)out.add(type+':'+x);};
  add('card',p.card_id);add('card',p.cardId);
  add('word',p.word_id);add('word',p.wordId);add('word',p.legacy_word_id);
  if(/^wid:\d+$/.test(str(p.legacy_key)))add('word',str(p.legacy_key).slice(4));
  if(/^wid:\d+$/.test(k))add('word',k.slice(4));
  if(t==='cards'||t==='card_content'||t==='card_classification'||t==='card_learning_metadata'||t==='card_local_overrides')add('card',k);
  if(t==='learning_events')add('card',p.card_id);
  if(t==='learning_state')add('card',p.card_id||k);
  if(t==='learning_situations'||t==='learning_alternatives')add('card',p.card_id);
  if(t==='learning_alternative_situations'){
   add('situation',p.situation_id);add('alternative',p.alternative_id);
  }
  if(t==='learning_situations')add('situation',k);
  if(t==='learning_alternatives')add('alternative',k);
  // Require a comparable logical identity on top of row key: a bare row ID
  // is not evidence that changes to related Canonical tables are disjoint.
  if(![...out].some(x=>x.startsWith('card:')||x.startsWith('word:')||x.startsWith('situation:')||x.startsWith('alternative:')))
   fail('INCOMPLETE_CROSS_TABLE_SCOPE');
  return out;
 }
 function review({outboxRows,remoteRows,localCursor,expectedActionId,verifiedOutboxCode}={}){
  if(verifiedOutboxCode!=='OUTBOX_REVALIDATE_WITH_V400')fail('OUTBOX_PRECONDITION_NOT_PROVEN');
  if(!Number.isSafeInteger(localCursor)||localCursor<0||!Array.isArray(outboxRows)||!outboxRows.length||
     !Array.isArray(remoteRows)||!remoteRows.length||!str(expectedActionId))fail('MISSING_PINNED_EVIDENCE');
  const pendingIds=new Set(),pendingTokens=new Set(),mutationIds=new Set();
  for(const m of outboxRows){
   if(str(m?.actionId)===''||str(m?.mutationId)===''||mutationIds.has(str(m.mutationId))||
      m.transportEligible!==true||m.status!=='pending'||m.diagnosticOnly===true||m.candidateOnly===true)
      fail('INVALID_PENDING_ROW');
   mutationIds.add(str(m.mutationId));pendingIds.add(str(m.actionId));
   for(const token of tokens(m,false))pendingTokens.add(token);
  }
  if(!pendingIds.has(str(expectedActionId)))fail('PINNED_ACTION_NOT_PENDING');
  let remoteAction='',last=localCursor;
  const changeIds=new Set();
  for(const change of remoteRows){
   const seq=Number(change?.change_seq),action=str(change?.action_id),mutation=str(change?.mutation_id);
   if(!Number.isSafeInteger(seq)||seq<=last||!action||!mutation||changeIds.has(mutation))
    fail('REMOTE_SEQUENCE_OR_MUTATION_INTEGRITY');
   if(remoteAction&&action!==remoteAction)fail('MULTIPLE_REMOTE_ACTIONS');
   if(pendingIds.has(action))fail('REMOTE_ACTION_ALREADY_PENDING_LOCALLY');
   remoteAction=action;last=seq;changeIds.add(mutation);
   for(const token of tokens(change,true))if(pendingTokens.has(token))fail('REMOTE_ACTION_COLLIDES_WITH_PENDING_SCOPE');
  }
  return Object.freeze({code:'DISJOINT_REMOTE_ACTION_CANDIDATE',readOnly:true,
   remoteActionId:remoteAction,remoteRows:remoteRows.length,remoteSeqMax:last,
   outboxCount:outboxRows.length,pendingActions:pendingIds.size,canSendPending:false});
 }
 return Object.freeze({review});
});
