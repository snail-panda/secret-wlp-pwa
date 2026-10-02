/* WLP v1.8.6.265 — Automatic Canonical sync supported-action generalization after raw-precondition fix.
   Safe scope for this release:
   - foreground source auto-push for the already-proven Study / Review action shapes;
   - state + event: studied, studied_removed, review, review_removed, attention_set;
   - event-only: attention_suggestion_kept;
   - receiver auto-pull remains explicitly gated by ?wlpAutoSyncReceiverCanary=1 and commits one action at a time.
   Any failure preserves the source outbox for the proven manual Cloud Shadow fallback.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.265-canonical-auto-sync-raw-precondition-fix-v1';
  const RECEIVER_FLAG='wlpAutoSyncReceiverCanary';
  const PAIR_EVENT_TYPES=new Set(['studied','studied_removed','review','review_removed','attention_set']);
  const EVENT_ONLY_TYPES=new Set(['attention_suggestion_kept']);
  const APPLY_RPC='wlp_sync_apply_incremental_action_v1';
  const CURSOR_ACK_RPC='wlp_sync_ack_cursor_v1';
  const CHANGE_TABLE='wlp_sync_changes_v1';
  const MUTATION_TABLE='wlp_sync_mutations_v1';
  const ACK_TABLE='wlp_sync_action_acknowledgements_v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_DB_VERSION=1,SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const BASE={key:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',head:3,manifest:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',rows:21425};
  const CANONICAL_TABLES=Object.freeze(['card_classification','card_content','card_learning_metadata','cards','learner_profile','learner_route_state','learning_alternative_situations','learning_alternatives','learning_events','learning_sessions','learning_situations','learning_state','study_build_cards','study_builds','study_context_cards','study_contexts','user_preferences']);
  const state={busy:false,report:null,panel:null,status:null,detail:null,exportButton:null};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const identity=(t,k)=>`${t}\u0000${k}`;
  async function sha256(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});}

  function makePanel(){
    if(state.panel)return;
    const box=document.createElement('section');
    box.id='wlp-auto-sync-canary-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100001;left:8px;top:max(8px,env(safe-area-inset-top));width:min(390px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Auto Sync · v265 generalized canary</strong><div id="wlp-auto-sync-canary-status" style="margin-top:4px">Waiting…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-auto-sync-canary-export" type="button" disabled>Export JSON</button></div><div id="wlp-auto-sync-canary-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);state.panel=box;state.status=box.querySelector('#wlp-auto-sync-canary-status');state.detail=box.querySelector('#wlp-auto-sync-canary-detail');state.exportButton=box.querySelector('#wlp-auto-sync-canary-export');
    state.exportButton.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;state.exportButton.disabled=!state.report;}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-auto-sync-${state.report.summary?.role||'audit'}-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[...CANONICAL_TABLES,META_STORE,OUTBOX_STORE],missing=required.filter(s=>!db.objectStoreNames.contains(s));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getMeta(db,key){const tx=db.transaction(META_STORE,'readonly'),v=await req(tx.objectStore(META_STORE).get(key));await txDone(tx);return v||null;}
  async function getAllOutbox(db){const tx=db.transaction(OUTBOX_STORE,'readonly'),v=await req(tx.objectStore(OUTBOX_STORE).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}

  function openShadowDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(SHADOW_DB,SHADOW_DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('Supabase Shadow configuration database is not installed.'));return;}if(!db.objectStoreNames.contains(SHADOW_META)){db.close();rej(new Error('Supabase Shadow metadata store is missing.'));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open Supabase Shadow metadata.'));});}
  async function shadowGet(key){const db=await openShadowDb();try{const tx=db.transaction(SHADOW_META,'readonly'),v=await req(tx.objectStore(SHADOW_META).get(key));await txDone(tx);return v||null;}finally{db.close();}}
  async function shadowPut(value){const db=await openShadowDb();try{const tx=db.transaction(SHADOW_META,'readwrite');tx.objectStore(SHADOW_META).put(value);await txDone(tx);}finally{db.close();}}
  async function authRequest(config,path,body){const headers={'Content-Type':'application/json',apikey:config.publishableKey};const response=await fetch(`${config.url}${path}`,{method:'POST',headers,body:JSON.stringify(body)}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`Supabase Auth request failed (${response.status}).`);return data;}
  async function cloudContext(){
    const config=await shadowGet(CONFIG_KEY),saved=await shadowGet(SESSION_KEY);if(!config?.url||!config?.publishableKey)throw new Error('Supabase configuration is missing. Open Cloud Shadow and configure it first.');if(!saved?.accessToken||!saved?.refreshToken||!saved?.userId)throw new Error('Saved Supabase session is missing. Open Cloud Shadow and sign in first.');let session=saved;
    if(Number(session.expiresAt||0)<=Date.now()+60000){const data=await authRequest(config,'/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refreshToken}),expiresIn=Math.max(60,Number(data.expires_in||3600));session={key:SESSION_KEY,accessToken:data.access_token,refreshToken:data.refresh_token,userId:data.user?.id||session.userId,email:data.user?.email||session.email||'',expiresAt:Date.now()+expiresIn*1000,savedAt:new Date().toISOString()};if(!session.userId)throw new Error('Supabase refresh did not return a user ID.');await shadowPut(session);}
    async function rest(path,options={}){const headers={apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`,...(options.headers||{})};if(options.body!=null)headers['Content-Type']='application/json';const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/rest/v1/${path}`,{method:options.method||'GET',headers,body:options.body==null?undefined:JSON.stringify(options.body)}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||`Supabase Data API request failed (${response.status}).`);return{data,response};}
    async function fetchPaged(table,select,extra=''){const size=1000,out=[];for(let from=0;;from+=size){const to=from+size-1,suffix=extra?`&${extra}`:'',r=await rest(`${table}?select=${encodeURIComponent(select)}${suffix}`,{headers:{Range:`${from}-${to}`,Prefer:'count=exact'}}),rows=Array.isArray(r.data)?r.data:[];out.push(...rows);if(rows.length<size)break;const total=Number((r.response.headers.get('content-range')||'').split('/')[1]);if(Number.isFinite(total)&&out.length>=total)break;}return out;}
    return{config,session,rest,fetchPaged};
  }

  async function fetchHead(a){const rows=await a.fetchPaged('wlp_canonical_authority_heads','candidate_key,head_version,snapshot_manifest_hash,canonical_row_count,migration_version','order=promoted_at.desc');if(rows.length!==1)throw new Error(`Expected one ACTIVE Authority Head, found ${rows.length}.`);return rows[0];}
  async function fetchChangesAfter(a,cursor){return a.fetchPaged(CHANGE_TABLE,'change_seq,candidate_key,head_version,table_name,row_key,operation,changed_fields,mutation_id,action_id,device_key,payload_hash,payload,tombstone,server_at',`change_seq=gt.${Number(cursor||0)}&order=change_seq.asc`);}
  async function fetchChangesForAction(a,actionId){return a.fetchPaged(CHANGE_TABLE,'change_seq,candidate_key,head_version,table_name,row_key,operation,changed_fields,mutation_id,action_id,device_key,payload_hash,payload,tombstone,server_at',`action_id=eq.${encodeURIComponent(actionId)}&order=change_seq.asc`);}
  async function fetchMutationsForAction(a,actionId){return a.fetchPaged(MUTATION_TABLE,'mutation_id,device_key,action_id,table_name,row_key,status,result,received_at,applied_at',`action_id=eq.${encodeURIComponent(actionId)}&order=received_at.asc`);}
  async function fetchAck(a,actionId){const rows=await a.fetchPaged(ACK_TABLE,'action_id,device_key,candidate_key,head_version,mutation_ids,status,acknowledged_at,result',`action_id=eq.${encodeURIComponent(actionId)}`);return rows[0]||null;}
  function firstActionOnly(rows){
    if(!Array.isArray(rows)||!rows.length)return[];
    const actionId=String(rows[0]?.action_id||'');if(!actionId)return[];
    const out=[];for(const row of rows){if(String(row?.action_id||'')!==actionId)break;out.push(row);}return out;
  }
  function sourceShape(rows){
    if(!Array.isArray(rows))return null;
    const states=rows.filter(x=>x?.tableName==='learning_state'),events=rows.filter(x=>x?.tableName==='learning_events');
    if(rows.length===2&&states.length===1&&events.length===1)return'state-event';
    if(rows.length===1&&states.length===0&&events.length===1)return'event-only';
    return null;
  }
  async function fingerprintMirror(db){const rows=[];for(const store of CANONICAL_TABLES){const tx=db.transaction(store,'readonly'),items=await req(tx.objectStore(store).getAll());await txDone(tx);for(const item of items)rows.push({tableName:store,rowKey:String(item.rowKey),tombstone:Boolean(item.tombstone),payloadHash:String(item.payloadHash)});}rows.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));return{rows,rowCount:rows.length,manifestHash:await sha256(stableStringify(rows))};}
  function stateLabel(payload){const p=payload||{};if(Boolean(p.known)&&!Boolean(p.review))return'studied';if(Boolean(p.review)){const level=String(p.review_level||'').toLowerCase();return level?`review:${level}`:'review';}return'neutral';}
  async function verifyChanges(changes){
    if(!Array.isArray(changes)||![1,2].includes(changes.length))throw new Error(`Auto Sync expected one event-only change or one state/event pair, found ${changes?.length??0}.`);
    const stateChange=changes.find(x=>x.table_name==='learning_state'&&x.operation==='upsert')||null;
    const eventChange=changes.find(x=>x.table_name==='learning_events'&&x.operation==='append')||null;
    if(!eventChange)throw new Error('Auto Sync requires one learning_events append.');
    const actionId=String(eventChange.action_id||'');
    for(const x of changes){
      if(!x.payload||typeof x.payload!=='object')throw new Error(`Change ${x.change_seq} has no payload.`);
      if(await sha256(stableStringify(x.payload))!==String(x.payload_hash||''))throw new Error(`Change ${x.change_seq} payload hash mismatch.`);
      if(String(x.candidate_key)!==BASE.key||Number(x.head_version)!==BASE.head)throw new Error(`Change ${x.change_seq} is not anchored to ACTIVE Authority v3.`);
      if(String(x.action_id||'')!==actionId)throw new Error('Auto Sync changes do not share one actionId.');
    }
    const eventType=String(eventChange.payload?.event_type||'');
    const eventPayload=eventChange.payload?.payload||{};
    const wordId=String(eventChange.payload?.legacy_word_id??eventPayload.wordId??'');
    const actionSource=String(eventPayload.source||'');
    if(changes.length===1){
      if(stateChange)throw new Error('Event-only Auto Sync must not contain learning_state.');
      if(!EVENT_ONLY_TYPES.has(eventType))throw new Error(`Event-only Auto Sync event type is unsupported (${eventType||'missing'}).`);
      const from=String(eventPayload.fromLevel||'').toLowerCase(),to=String(eventPayload.suggestedLevel||'').toLowerCase();
      if(String(eventPayload.action||'')!=='attention_suggestion_kept'||actionSource!=='review-hub'||!['light','medium','high'].includes(from)||!['light','medium','high'].includes(to)||from===to)throw new Error('Event-only Keep payload is invalid.');
      return{changeShape:'event-only',stateChange:null,eventChange,eventType,targetState:null,actionId,wordId,actionSource,expectedMutations:1,seqMax:Number(eventChange.change_seq||0),seqMin:Number(eventChange.change_seq||0)};
    }
    if(!stateChange)throw new Error('Two-change Auto Sync requires one learning_state upsert.');
    if(String(eventChange.payload?.card_id||'')!==String(stateChange.row_key||''))throw new Error('Auto Sync state/event target card identity mismatch.');
    if(!PAIR_EVENT_TYPES.has(eventType))throw new Error(`State/event Auto Sync event type is unsupported (${eventType||'missing'}).`);
    const targetState=stateLabel(stateChange.payload);
    if(eventType==='attention_set'){
      const targetLevel=String(stateChange.payload?.review_level||'').toLowerCase();
      if(!['light','medium','high'].includes(targetLevel)||!Boolean(stateChange.payload?.review))throw new Error(`Auto Sync target Attention is invalid (${targetLevel||'missing'}).`);
      const eventLevel=String(eventPayload.level||'').toLowerCase();
      if(eventLevel&&eventLevel!==targetLevel)throw new Error(`Auto Sync state/event Attention target mismatch (${targetLevel} vs ${eventLevel}).`);
    }else if(eventType==='studied'&&targetState!=='studied')throw new Error(`studied event does not converge to studied state (${targetState}).`);
    else if(eventType==='studied_removed'&&targetState!=='neutral')throw new Error(`studied_removed event does not converge to neutral state (${targetState}).`);
    else if(eventType==='review'&&!targetState.startsWith('review'))throw new Error(`review event does not converge to review state (${targetState}).`);
    else if(eventType==='review_removed'&&targetState!=='neutral')throw new Error(`review_removed event does not converge to neutral state (${targetState}).`);
    return{changeShape:'state-event',stateChange,eventChange,eventType,targetState,actionId,wordId,actionSource,expectedMutations:2,seqMax:Math.max(...changes.map(x=>Number(x.change_seq||0))),seqMin:Math.min(...changes.map(x=>Number(x.change_seq||0)))};
  }
  async function predictMaterialized(db,changes){const before=await fingerprintMirror(db),map=new Map(before.rows.map(x=>[identity(x.tableName,x.rowKey),x]));for(const x of changes)map.set(identity(x.table_name,x.row_key),{tableName:String(x.table_name),rowKey:String(x.row_key),tombstone:Boolean(x.tombstone),payloadHash:String(x.payload_hash)});const rows=[...map.values()].sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));return{before,rowCount:rows.length,manifestHash:await sha256(stableStringify(rows))};}
  async function applyLocal(db,changes,meta,cursorMeta,isSource,outboxMutations){
    const verified=await verifyChanges(changes),predicted=await predictMaterialized(db,changes),appliedAt=new Date().toISOString();
    const stores=[...(verified.stateChange?['learning_state']:[]),'learning_events',META_STORE,OUTBOX_STORE],tx=db.transaction(stores,'readwrite');
    if(verified.stateChange)tx.objectStore('learning_state').put({rowKey:String(verified.stateChange.row_key),payloadHash:String(verified.stateChange.payload_hash),tombstone:Boolean(verified.stateChange.tombstone),payload:clone(verified.stateChange.payload)});
    tx.objectStore('learning_events').put({rowKey:String(verified.eventChange.row_key),payloadHash:String(verified.eventChange.payload_hash),tombstone:Boolean(verified.eventChange.tombstone),payload:clone(verified.eventChange.payload)});
    const nextMeta={...meta,lastSyncCursor:verified.seqMax,lastSuccessfulSyncAt:appliedAt,materializedSyncCursor:verified.seqMax,materializedManifestHash:predicted.manifestHash,materializedCanonicalRowCount:predicted.rowCount,syncOverlayApplied:true,revisionSource:'wlp_sync_changes_v1-auto-sync-supported-actions',materializedAt:appliedAt};
    tx.objectStore(META_STORE).put(nextMeta);
    tx.objectStore(META_STORE).put({...(cursorMeta||{}),key:CURSOR_KEY,lastSyncCursor:verified.seqMax,lastSuccessfulSyncAt:appliedAt,candidateKey:BASE.key,headVersion:BASE.head,snapshotManifestHash:BASE.manifest,materializedManifestHash:predicted.manifestHash,materializedCanonicalRowCount:predicted.rowCount});
    if(isSource)for(const m of outboxMutations)tx.objectStore(OUTBOX_STORE).delete(m.mutationId);
    await txDone(tx);
    const after=await fingerprintMirror(db);if(after.rowCount!==predicted.rowCount||after.manifestHash!==predicted.manifestHash)throw new Error('Auto Sync post-commit mirror fingerprint mismatch.');
    return{verified,predicted,after,appliedAt};
  }

  async function runSync({trigger='manual',expectedActionId=''}={}){
    if(state.busy)return null;state.busy=true;makePanel();setStatus('SYNCING · Canonical Auto Sync v264 is running…',null,'Source outbox is preserved unless server ACK + atomic local commit both succeed.');let db=null,role='receiver';
    try{
      const a=await cloudContext();db=await openDb();const meta=await getMeta(db,META_KEY),cursorMeta=await getMeta(db,CURSOR_KEY),outbox=await getAllOutbox(db),cursorBefore=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      if(String(meta?.candidateKey||'')!==BASE.key||Number(meta?.headVersion||0)!==BASE.head||String(meta?.snapshotManifestHash||'')!==BASE.manifest)throw new Error('Auto Sync requires ACTIVE Authority v3.');
      let serverResult=null,changes=[],actionId='',sourceRows=[];
      if(outbox.length){
        role='source';sourceRows=outbox.filter(x=>x?.transportEligible===true&&!x?.diagnosticOnly&&!x?.candidateOnly);
        if(sourceRows.length!==outbox.length)throw new Error(`Auto Sync will not ignore unsupported outbox rows (${outbox.length-sourceRows.length} unsupported); use manual Cloud Shadow.`);
        const shape=sourceShape(sourceRows);if(!shape)throw new Error(`Auto Sync will not touch unsupported outbox shape (${outbox.length} row(s)); use manual Cloud Shadow.`);
        const actionIds=[...new Set(sourceRows.map(x=>String(x.actionId||'')))];if(actionIds.length!==1)throw new Error('Auto Sync source rows do not share one actionId.');actionId=actionIds[0];
        if(expectedActionId&&actionId!==expectedActionId)throw new Error('Auto Sync staged actionId does not match the pending outbox.');
        const eventMutation=sourceRows.find(x=>x?.tableName==='learning_events'),eventType=String(eventMutation?.payload?.event_type||'');
        if(shape==='state-event'&&!PAIR_EVENT_TYPES.has(eventType))throw new Error(`State/event Auto Sync event type is unsupported (${eventType||'missing'}); use manual Cloud Shadow.`);
        if(shape==='event-only'&&!EVENT_ONLY_TYPES.has(eventType))throw new Error(`Event-only Auto Sync event type is unsupported (${eventType||'missing'}); use manual Cloud Shadow.`);
        const raw=await a.rest(`rpc/${APPLY_RPC}`,{method:'POST',body:{p_device_key:String(meta.deviceKey||''),p_mutations:clone(sourceRows)}});serverResult=Array.isArray(raw.data)?raw.data[0]:raw.data;
        if(!serverResult||typeof serverResult!=='object')throw new Error('Auto Sync apply RPC returned no JSON result.');
        if(serverResult.status==='conflict')throw new Error(`Server preserved conflict ${serverResult.conflictId||'unknown'}; outbox retained for manual resolution.`);
        if(serverResult.status!=='applied'||serverResult.applied!==true)throw new Error(`Auto Sync apply did not return applied status (${serverResult.status||'unknown'}).`);
        changes=await fetchChangesForAction(a,actionId);
      }else{
        role='receiver';const pending=await fetchChangesAfter(a,cursorBefore);
        if(pending.length===0){state.report={format:'WLP_CANONICAL_AUTO_SYNC_CANARY',version:2,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'foreground-auto-sync-supported-action-generalization-canary',summary:{role:'receiver-noop',trigger,cursorBefore,cursorAfter:cursorBefore,outboxBefore:0,outboxAfter:0,changeRows:0,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['No remote change was available. Nothing was written.']},invariants:{manualCloudShadowFallbackPreserved:true,noServiceWorkerSync:true}};setStatus('READY · No new Canonical changes to pull.',true,`cursor ${cursorBefore} · outbox 0`);return clone(state.report);}
        changes=firstActionOnly(pending);actionId=String(changes[0]?.action_id||'');
      }
      const verified=await verifyChanges(changes);if(actionId!==verified.actionId)throw new Error('Auto Sync action identity mismatch.');if(verified.seqMin<=cursorBefore)throw new Error(`Auto Sync change sequence overlaps committed cursor ${cursorBefore}.`);
      const outboxBefore=outbox.length,local=await applyLocal(db,changes,meta,cursorMeta,role==='source',sourceRows),outboxAfter=(await getAllOutbox(db)).length,stateRow=verified.stateChange?await getRow(db,'learning_state',verified.stateChange.row_key):null,eventRow=await getRow(db,'learning_events',verified.eventChange.row_key);
      const ackRaw=await a.rest(`rpc/${CURSOR_ACK_RPC}`,{method:'POST',body:{p_device_key:String(meta.deviceKey||''),p_change_seq:verified.seqMax}}),cursorAck=Array.isArray(ackRaw.data)?ackRaw.data[0]:ackRaw.data;
      const retry=await fetchChangesAfter(a,verified.seqMax),sameActionRetry=retry.filter(x=>String(x.action_id||'')===actionId),mutations=await fetchMutationsForAction(a,actionId),ack=await fetchAck(a,actionId),head=await fetchHead(a);
      const localStateLabel=verified.stateChange?stateLabel(stateRow?.payload):'unchanged',stateOk=!verified.stateChange||localStateLabel===verified.targetState,eventOk=String(eventRow?.payload?.event_type||'')===verified.eventType,headOk=String(head.candidate_key)===BASE.key&&Number(head.head_version)===BASE.head&&String(head.snapshot_manifest_hash)===BASE.manifest,mutationOk=mutations.length===verified.expectedMutations&&mutations.every(x=>x.status==='applied'),ackOk=Boolean(ack&&ack.status==='applied'&&Array.isArray(ack.mutation_ids)&&ack.mutation_ids.length===verified.expectedMutations),cursorAckOk=Number(cursorAck?.lastAckChangeSeq||0)>=verified.seqMax,outboxOk=outboxAfter===0,retryOk=sameActionRetry.length===0;
      const checks=[['Supported action shape verified',Boolean(verified.wordId)&&((verified.changeShape==='state-event'&&PAIR_EVENT_TYPES.has(verified.eventType))||(verified.changeShape==='event-only'&&EVENT_ONLY_TYPES.has(verified.eventType))),`${verified.changeShape} · WID${verified.wordId||'?'} · ${verified.eventType}`],['Canonical state converged to target',stateOk,localStateLabel],['Canonical event converged locally',eventOk,String(eventRow?.rowKey||'missing')],['Materialized mirror fingerprint committed',local.after.manifestHash===local.predicted.manifestHash,`${local.after.rowCount} rows · ${local.after.manifestHash}`],['Source outbox clears only after acknowledged local commit',outboxOk,`${outboxBefore} → ${outboxAfter}`],['Mutation ledger + action acknowledgement are complete',mutationOk&&ackOk,`${mutations.length}/${verified.expectedMutations} mutations · ack ${ack?.status||'missing'}`],['Device cursor acknowledgement reached local commit',cursorAckOk,String(cursorAck?.lastAckChangeSeq??'missing')],['Exact action retry is a no-op',retryOk,`${sameActionRetry.length} same-action row(s)`],['Authority v3 head remains unchanged',headOk,`${head.candidate_key} · head ${head.head_version}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));
      const blocking=checks.filter(x=>!x.pass).map(x=>x.name),pass=blocking.length===0;
      state.report={format:'WLP_CANONICAL_AUTO_SYNC_CANARY',version:2,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'foreground-auto-sync-supported-action-generalization-canary',device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:BASE.key,headVersion:BASE.head,snapshotManifestHash:BASE.manifest},summary:{role,trigger,changeShape:verified.changeShape,wordId:verified.wordId,eventType:verified.eventType,serverApplied:role==='source'?Boolean(serverResult?.applied):false,changeRows:changes.length,cursorBefore,cursorAfter:verified.seqMax,outboxBefore,outboxAfter,stateLevel:localStateLabel,materializedRowsBefore:local.predicted.before.rowCount,materializedRowsAfter:local.after.rowCount,mutationRows:mutations.length,acknowledged:ackOk,cursorAcknowledged:cursorAckOk,retrySameActionRows:sameActionRetry.length,pendingRemoteChangeRows:retry.length-sameActionRetry.length,blockingIssues:blocking.length,pass},serverResult:clone(serverResult),changes:clone(changes),before:{cursor:cursorBefore,outboxRows:outboxBefore,materializedRows:local.predicted.before.rowCount,materializedManifestHash:local.predicted.before.manifestHash},after:{cursor:verified.seqMax,outboxRows:outboxAfter,materializedRows:local.after.rowCount,materializedManifestHash:local.after.manifestHash},checks,issues:{blocking,warnings:['v264 foreground auto-sync accepts only the already-proven state/event and Keep event-only action shapes; unsupported outbox shapes remain manual Cloud Shadow fallback.','Receiver auto-pull remains query-gated and commits one action at a time.','No Service Worker/background sync is enabled. This is foreground page sync only.']},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true,authorityHeadUnchanged:headOk}};
      if(!pass)throw new Error(blocking.join('; '));
      setStatus(role==='source'?`PASS · WID${verified.wordId} ${verified.eventType} auto-pushed at cursor ${verified.seqMax}.`:`PASS · WID${verified.wordId} ${verified.eventType} auto-pulled at cursor ${verified.seqMax}.`,true,`outbox ${outboxBefore} → ${outboxAfter} · ${changes.length} change(s) · ${retry.length-sameActionRetry.length} later remote row(s) pending · manual Cloud Shadow remains available.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-auto-sync-complete',{detail:{pass:true,role,actionId,wordId:verified.wordId,eventType:verified.eventType,changeShape:verified.changeShape,actionSource:verified.actionSource,cursorAfter:verified.seqMax,outboxAfter}}));window.dispatchEvent(new CustomEvent('wlp-canonical-review-candidate-refresh'));return clone(state.report);
    }catch(error){
      const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_AUTO_SYNC_CANARY',version:2,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'foreground-auto-sync-supported-action-generalization-canary',summary:{role,trigger,blockingIssues:1,pass:false},issues:{blocking:[message],warnings:['Automatic sync stopped. The source outbox is intentionally not cleaned up on failure; use Cloud Shadow manual steady sync as fallback.']},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true}};setStatus(`CHECK · ${message}`,false,'Do not stage another write. Manual Cloud Shadow steady sync remains the fallback.');window.dispatchEvent(new CustomEvent('wlp-canonical-auto-sync-complete',{detail:{pass:false,role,error:message}}));return clone(state.report);
    }finally{try{db?.close();}catch(_){}state.busy=false;if(state.exportButton)state.exportButton.disabled=!state.report;}
  }

  function onStaged(event){const d=event?.detail||{},eventType=String(d.eventType||''),mutationCount=Number(d.mutationCount||0);const supported=(PAIR_EVENT_TYPES.has(eventType)&&mutationCount===2)||(EVENT_ONLY_TYPES.has(eventType)&&mutationCount===1);if(!supported)return;setTimeout(()=>{void runSync({trigger:`${String(d.source||'canonical')}-outbox-staged`,expectedActionId:String(d.actionId||'')});},80);}
  function init(){window.addEventListener('wlp-canonical-outbox-staged',onStaged);if(new URLSearchParams(location.search).get(RECEIVER_FLAG)==='1'){makePanel();setTimeout(()=>{void runSync({trigger:'receiver-page-load'});},150);}}
  window.WLPCanonicalAutoSyncCanary=Object.freeze({version:2,pairEventTypes:[...PAIR_EVENT_TYPES],eventOnlyTypes:[...EVENT_ONLY_TYPES],runSync,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
