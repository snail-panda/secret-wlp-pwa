/* WLP G4-1 production Paired REST seam — SOURCE OFF; derived from proven E7b adapter.
 * New RPC names _v1; E7b sandbox binding shortcuts not accepted.
 * DEVELOPMENT ONLY / NO AUTO-START / NO UI / NO SERVICE WORKER / NO WRITES UNTIL SQL IS MIGRATED.
 * All calls are explicitly initiated by a trusted E7b runtime. Existing Shadow login
 * and Canonical Mirror remain the source of saved identity/configuration; this module
 * NEVER refreshes credentials or updates those stores. If token is expired, the
 * existing WLP login/refresh writer must refresh first. Account changes fail closed.
 */
(function(root,factory){ const api=factory();if(typeof module==='object'&&module.exports) module.exports=api;
else root.WLPG4PairedRpcV1SOURCEOFF=api; })(typeof window!=='undefined'?window:this,function(){
'use strict';
const SHADOW='wlp-cloud-shadow-v0', MIRROR='wlp-cloud-v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean=v=>String(v??'').trim();
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(x,why)=>{if(!x)throw Error('E7b paired RPC blocked: '+why);};
function same(a,b){return !!a&&!!b&&a.verified===true&&b.verified===true&&
 ['accountId','deviceKey','candidateKey','headVersion','generation'].every(k=>a[k]===b[k]);}
function dbRow(indexedDB,name,store,key){return new Promise((resolve,reject)=>{
 const open=indexedDB.open(name,1);let upgraded=false;
 open.onupgradeneeded=()=>{upgraded=true;try{open.transaction.abort();}catch(_){}};
 open.onerror=()=>reject(open.error||Error('E7b database unavailable: '+name));
 open.onblocked=()=>reject(Error('E7b database busy: '+name));
 open.onsuccess=()=>{
  const db=open.result;
  if(upgraded||!db.objectStoreNames.contains(store)){db.close();reject(Error('E7b database uninitialized: '+name));return;}
  const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).get(key);let value=null;
  req.onsuccess=()=>{value=req.result||null;};req.onerror=()=>{try{tx.abort();}catch(_){}};
  tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=()=>{db.close();reject(tx.error||Error('E7b metadata read failed'));};
  tx.onerror=()=>{};
 };
});}
function normalizeUrl(url){
 check(/^https:\/\//i.test(clean(url)),'HTTPS Supabase URL required');
 const u=new URL(url);check(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
   u.pathname.replace(/\/+$/,'')==='' ,'invalid Supabase project URL');
 return u.origin;
}
function make({indexedDB,fetchImpl,identityNow,wire,approvedPilot=false}={}){
 check(indexedDB&&typeof indexedDB.open==='function','IndexedDB is required');
 check(typeof fetchImpl==='function','fetch is required');
 check(typeof identityNow==='function','trusted E7b identity provider required');
 check(wire&&typeof wire.validateAppliedAck==='function','paired wire adapter required');
 const ident=()=>wire.normalizeIdentity(identityNow());
 async function localSnapshot(){
  // Only existing WLP Shadow login and Canonical Mirror are accepted.
  const [config,session,mirror,device]=await Promise.all([
   dbRow(indexedDB,SHADOW,'meta','supabase_config'),
   dbRow(indexedDB,SHADOW,'meta','supabase_session'),
   dbRow(indexedDB,MIRROR,'sync_meta','authority_mirror'),
   dbRow(indexedDB,SHADOW,'meta','shadow_device')]);
  const before=ident();
  check(config?.publishableKey&&session?.accessToken&&UUID.test(clean(session.userId)), 'Cloud Shadow sign-in missing');
  check(session.userId===before.accountId&&mirror?.userId===before.accountId,'saved user and Mirror account mismatch');
  check(mirror.deviceKey===before.deviceKey&&mirror.candidateKey===before.candidateKey&&
    Number(mirror.headVersion)===before.headVersion,'Mirror Authority or device mismatch');
  if(device?.deviceKey)check(device.deviceKey===before.deviceKey,'Cloud Shadow device mismatch');
  check(Number(session.expiresAt)>Date.now()+15000,'session expired; use existing WLP auth refresh first');
  return {identity:clone(before),url:normalizeUrl(config.url),publishableKey:clean(config.publishableKey),
    token:clean(session.accessToken)};
 }
 function sameSnapshot(a,b){return same(a?.identity,b?.identity)&&a.url===b.url&&a.publishableKey===b.publishableKey;}
 async function fetchJson(snap,path,{method='GET',body}={}){
  const opts={method,headers:{apikey:snap.publishableKey,Authorization:'Bearer '+snap.token},cache:'no-store'};
  if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const r=await fetchImpl(snap.url+path,opts);
  check(r&&typeof r.ok==='boolean','fetch did not return a response');
  let json;const content=await r.text();
  try{json=content?JSON.parse(content):null;}catch(_){throw Error('E7b paired RPC: invalid JSON response');}
  if(!r.ok)throw Error('E7b paired RPC HTTP '+r.status+': '+clean(json?.message||json?.error||json?.hint||'server rejected request'));
  return json;
 }
 async function confirmed(){
  // A concurrent existing WLP refresh can rotate the JWT during verification.
  // Verify the FINAL token used for REST, never silently promote an unverified new token.
  let snap=await localSnapshot();
  for(let i=0;i<3;i++){
   const user=await fetchJson(snap,'/auth/v1/user');
   check(clean(user?.id)===snap.identity.accountId,'authenticated Supabase user does not match Local Library');
   const again=await localSnapshot();check(sameSnapshot(snap,again),'account/Authority changed during auth validation');
   if(again.token===snap.token)return again;
   snap=again;
  }
  check(false,'auth token rotated repeatedly during verification; retry later');
 }
 async function assertFresh(snap){
  const now=await localSnapshot();check(sameSnapshot(snap,now),'account/Authority switched while RPC pending');
  return now;
 }
 async function activeHead(snap){
  const rows=await fetchJson(snap,'/rest/v1/wlp_canonical_authority_heads?select=candidate_key,head_version&order=promoted_at.desc&limit=2');
  check(Array.isArray(rows)&&rows.length===1,'expected exactly one active Authority head');
  check(rows[0].candidate_key===snap.identity.candidateKey&&Number(rows[0].head_version)===snap.identity.headVersion,
   'server Authority differs from verified Local Mirror');
 }
 async function call(rpc,body){
  check(['wlp_paired_submit_v1','wlp_paired_pull_v1','wlp_paired_ack_v1'].includes(rpc),'unapproved paired RPC');
  if(rpc==='wlp_paired_submit_v1')check(approvedPilot===true,'Cloud submit requires explicitly approved pilot');
  const proof=await confirmed();
  // For an IMMUTABLY prepared action (checked in submitPrepared), do not reject
  // a lost-ACK retry merely because the server's active Authority has since
  // advanced. The SQL RPC authenticates account/device, checks replay identity
  // FIRST and rejects any NEW stale-Authority write itself. All other RPCs
  // continue to require active Authority here.
  if(rpc!=='wlp_paired_submit_v1')await activeHead(proof);
  await assertFresh(proof);
  const result=await fetchJson(proof,'/rest/v1/rpc/'+rpc,{method:'POST',body});
  await assertFresh(proof);
  return {identity:clone(proof.identity),result};
 }
 async function canonicalCardRows(wids){
  const proof=await confirmed();await activeHead(proof);
  check(Array.isArray(wids)&&wids.length>0&&wids.length<=1000&&wids.every(w=>/^\d+$/.test(clean(w))), 'invalid card witness list');
  const unique=[...new Set(wids.map(clean))];check(unique.length===wids.length,'duplicate WID');
  const result=[];
  for(let i=0;i<unique.length;i+=30){
   const sub=unique.slice(i,i+30),ids=await Promise.all(sub.map(w=>wire.uuidV5('card|wid:'+w)));
   const qs=new URLSearchParams({select:'row_key,payload,tombstone',owner_id:'eq.'+proof.identity.accountId,
    candidate_key:'eq.'+proof.identity.candidateKey,table_name:'eq.cards',row_key:'in.('+ids.join(',')+')'});
   const rows=await fetchJson(proof,'/rest/v1/wlp_canonical_authority_candidate_records?'+qs.toString());
   check(Array.isArray(rows),'invalid Canonical card rows');
   result.push(...rows);
   await assertFresh(proof);
  }
  const verifiedByKey=new Map(result.map(r=>[r.row_key,r]));
  const cards=[];
  for(const wid of unique){
   const uuid=await wire.uuidV5('card|wid:'+wid),row=verifiedByKey.get(uuid);
   check(row&&row.tombstone===false&&row.payload?.legacy_key==='wid:'+wid,'missing active Canonical card WID'+wid);
   cards.push({...row,wid,rowKey:uuid});
  }
  await assertFresh(proof);return cards;
 }
 async function submitPrepared({action,readPreparedAction}){
  check(approvedPilot===true,'Cloud submit requires explicitly approved pilot');
  check(action&&typeof readPreparedAction==='function','durable action reader required');
  const bound=ident();
  const persisted=await readPreparedAction(action.action_id);
  check(((persisted?.kind==='e7b-paired-prepared-action-v1'&&persisted?.accountBoundAtStart===true)||
    (persisted?.kind==='e7b-remote-prepared-revise-action-v1'&&persisted?.remoteReceiverProvenance===true&&
     persisted?.action?.operation==='revise'&&persisted?.baseRevision>0)),
    'durable account-bound prepared action proof missing');
  check(persisted.accountId===bound.accountId&&persisted.deviceKey===bound.deviceKey&&
    persisted.candidateKey===bound.candidateKey&&persisted.headVersion===bound.headVersion,
    'durable action owner/device/Authority mismatch');
  check(action.candidate_key===bound.candidateKey&&action.head_version===bound.headVersion,
    'submitted action Authority differs from current sign-in');
  check(JSON.stringify(persisted.action)===JSON.stringify(action),'action differs from immutable durable prepared copy');
  const {identity,result}=await call('wlp_paired_submit_v1',{p_device_key:bound.deviceKey,p_action:clone(action)});
  check(same(bound,identity),'owner/device changed before RPC');
  check(same(bound,ident())&&same(bound,identity),'account/Authority switched before ACK validation');
  const ack=wire.validateAppliedAck(result,action);
  check(result?.device_key===bound.deviceKey,'server ACK device does not match submitted device');
  return ack; // caller must durably mark ACK; never delete source queue here.
 }
 async function pullIntoInbox({inbox,limit=50}){
  check(approvedPilot===true,'Cloud pull requires explicitly approved pilot');
  check(inbox&&typeof inbox.readCursor==='function'&&typeof inbox.ingestPull==='function'&&
    typeof inbox.prepareEmptyJournalForExplicitReceive==='function','durable inbox required');
  check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'invalid pull limit');
  // This is invoked ONLY from the explicit Receive once path, AFTER the owning
  // transport verified the live account/device/Authority lease. It does not
  // initialize Canonical Mirror, existing History, or a new Study Session.
  const before=ident();
  await inbox.prepareEmptyJournalForExplicitReceive({approved:true});
  check(same(before,ident()),'account changed during receiver Journal preparation');
  const after=await inbox.readCursor();
  check(same(before,ident()),'account changed before pull');
  const output=await call('wlp_paired_pull_v1',{p_device_key:before.deviceKey,p_after:after,p_limit:limit});
  check(same(before,output.identity)&&same(before,ident()),'account changed after pull');
  const committed=await inbox.ingestPull({response:output.result});
  check(same(before,ident()),'account changed after durable inbox commit');
  const durable=await inbox.readCursor();
  check(Number.isSafeInteger(durable)&&durable>=after&&durable===committed.pairedSeq,'receiver cursor not durably committed');
  if(durable>0){
   const ack=await call('wlp_paired_ack_v1',{p_device_key:before.deviceKey,p_seq:durable});
   check(same(before,ack.identity)&&ack.result?.status==='acknowledged'&&
     Number(ack.result.paired_seq)>=durable,'server cursor ACK invalid');
  }
  return {stored:committed.stored,quarantined:committed.quarantined,pairedSeq:durable};
 }
 return Object.freeze({confirmed,canonicalCardRows,submitPrepared,pullIntoInbox});
}
return Object.freeze({make});
});
