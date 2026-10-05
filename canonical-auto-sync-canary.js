/* WLP v1.8.6.342 — Safe multi-action pending-outbox foreground recovery + existing Canonical sync behavior.
   Production scope:
   - foreground source auto-push is enabled for the already-proven Study / Review action shapes;
   - state + event: studied, studied_removed, review, review_removed, attention_set;
   - event-only: attention_suggestion_kept, Card Study encounter/interaction events, completed Standard Practice events, interpreted AI Practice events, and append-only Standard rating corrections;
   - session-only: one completed Standard or query-gated AI Practice learning_sessions insert;
   - normal Home, Review, Study-card, Progress, Study Hub, Deck Browser, and Learning Metadata pages perform foreground checks on page load and debounced foreground resume;
   - a pre-existing pending outbox is auto-retried only when every row is transportEligible production data and every action group independently forms an already-proven supported shape;
   - multiple independent supported actionIds are recovered one action at a time, preserving each original actionId/mutationId and clearing only the acknowledged action rows after atomic local commit;
   - unsupported, diagnostic/candidate, non-pending, or malformed action groups are never auto-pushed and continue to defer to manual Cloud Shadow fallback;
   - single-flight is preserved; a receiver request queued during another sync runs only after any queued source action;
   - normal successful/no-op/deferred sync is silent; ?wlpAutoSyncAudit=1 exposes diagnostics/export;
   - the last successful material sync receipt is persisted locally so audit can inspect/export it even after a later no-op;
   - exporting diagnostics temporarily suppresses focus/visibility resume checks so Safari download UI cannot trigger a redundant receiver pull;
   - transient receiver-only network failures are deferred without replacing the safe Last Sync receipt; true blocking failures still surface diagnostics automatically;
   - ?wlpAutoSyncReceiver=0 disables default page-load and foreground-resume receiver pulls;
   - the legacy ?wlpAutoSyncReceiverCanary=1 diagnostic receiver remains available for compatibility.
   Any failure preserves the source outbox for the proven manual Cloud Shadow fallback.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.342-canonical-foreground-sync-multi-action-pending-outbox-recovery-v1';
  const REPORT_FORMAT='WLP_CANONICAL_FOREGROUND_SYNC',REPORT_VERSION=1,REPORT_MODE='foreground-sync-production-multi-action-pending-outbox-recovery';
  const RECEIVER_FLAG='wlpAutoSyncReceiverCanary';
  const RECEIVER_DISABLE_FLAG='wlpAutoSyncReceiver';
  const RECOVERY_DISABLE_FLAG='wlpPendingOutboxRecovery';
  const AUDIT_FLAG='wlpAutoSyncAudit';
  const LAST_RECEIPT_KEY='WLP Canonical Foreground Sync Last Receipt V1';
  const PAIR_EVENT_TYPES=new Set(['studied','studied_removed','review','review_removed','attention_set']);
  const EVENT_ONLY_TYPES=new Set(['attention_suggestion_kept']);
  const STANDARD_EVENT_STREAM='standard',AI_EVENT_STREAM='ai',ACTIVITY_EVENT_STREAM='activity',INTERACTION_EVENT_STREAM='interaction',STANDARD_EVENT_TYPE='event',STANDARD_RATING_CORRECTION_TYPE='rating_correction';
  const CARD_INTERACTION_ACTIONS=new Set(['flip','audio_play','record_start','record_save','google_search','jp_search','image_search','external_reference','youglish']);
  const APPLY_RPC='wlp_sync_apply_incremental_action_v1';
  const CURSOR_ACK_RPC='wlp_sync_ack_cursor_v1';
  const CHANGE_TABLE='wlp_sync_changes_v1';
  const MUTATION_TABLE='wlp_sync_mutations_v1';
  const ACK_TABLE='wlp_sync_action_acknowledgements_v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_DB_VERSION=1,SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const BASE={key:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',head:3,manifest:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',rows:21425};
  const CANONICAL_TABLES=Object.freeze(['card_classification','card_content','card_learning_metadata','cards','learner_profile','learner_route_state','learning_alternative_situations','learning_alternatives','learning_events','learning_sessions','learning_situations','learning_state','study_build_cards','study_builds','study_context_cards','study_contexts','user_preferences']);
  const RESUME_DEBOUNCE_MS=220,RESUME_COOLDOWN_MS=1200,EXPORT_RESUME_GUARD_MS=5000;
  const state={busy:false,report:null,lastReceipt:null,panel:null,status:null,detail:null,exportButton:null,pendingSourceRun:null,pendingReceiverRun:null,resumeTimer:null,lastReceiverRequestAt:0,suppressResumeUntil:0,defaultReceiverEnabled:false,pendingOutboxRecoveryEnabled:true,pageKind:'',auditEnabled:false,sourceFailure:null,recoveryBatch:null};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const identity=(t,k)=>`${t}\u0000${k}`;
  async function sha256(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});}
  function isTransientReceiverNetworkError(error){const m=String(error?.message||error||'').toLowerCase();return m==='load failed'||m.includes('failed to fetch')||m.includes('networkerror')||m.includes('network request failed')||m.includes('network connection was lost');}

  function readLastReceipt(){
    try{const raw=localStorage.getItem(LAST_RECEIPT_KEY);if(!raw)return null;const r=JSON.parse(raw),summary=r?.summary||{};if(r?.format!==REPORT_FORMAT||summary.pass!==true||Number(summary.changeRows||0)<=0)return null;return r;}catch(_){return null;}
  }
  function persistLastReceipt(report){
    const summary=report?.summary||{};if(report?.format!==REPORT_FORMAT||summary.pass!==true||Number(summary.changeRows||0)<=0)return false;
    try{localStorage.setItem(LAST_RECEIPT_KEY,JSON.stringify(report));state.lastReceipt=clone(report);return true;}catch(_){return false;}
  }
  function isMeaningfulReport(report){return Boolean(report?.summary?.pass===true&&Number(report?.summary?.changeRows||0)>0);}
  function exportableReport(){if(state.report?.summary?.pass===false)return state.report;if(isMeaningfulReport(state.report))return state.report;return state.lastReceipt||state.report||null;}
  function lastReceiptSummary(){const r=state.lastReceipt,s=r?.summary||{};if(!r)return'';const cursor=(s.cursorBefore!=null&&s.cursorAfter!=null)?`cursor ${s.cursorBefore} → ${s.cursorAfter}`:`cursor ${s.cursorAfter??'?'}`;const target=s.wordId?`WID${s.wordId} ${s.eventType||''}`.trim():(s.sessionId?`${s.sessionOnlyShape==='ai-session'?'AI':'Standard'} session ${s.sessionId}`:(s.eventType||s.role||'sync'));return`Last Sync · ${s.role||'sync'} · ${target} · ${cursor} · ${r.generatedAt||''}`;}
  function updateExportButton(){if(!state.exportButton)return;const report=exportableReport();state.exportButton.disabled=!report;state.exportButton.textContent=report&&report===state.lastReceipt&&!isMeaningfulReport(state.report)&&state.report?.summary?.pass!==false?'Export Last Sync JSON':'Export JSON';}
  function detailWithLastReceipt(detail=''){const last=state.auditEnabled?lastReceiptSummary():'';return[detail,last].filter(Boolean).join(' · ');}
  function makePanel(){
    if(state.panel)return;
    const box=document.createElement('section');
    box.id='wlp-auto-sync-canary-box';box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;z-index:100001;left:8px;top:max(8px,env(safe-area-inset-top));width:min(390px,calc(100vw - 16px));max-height:46vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML='<strong style="display:block;font-size:13px">Canonical Foreground Sync · v342</strong><div id="wlp-auto-sync-canary-status" style="margin-top:4px">Waiting…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-auto-sync-canary-export" type="button" disabled>Export JSON</button></div><div id="wlp-auto-sync-canary-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);state.panel=box;state.status=box.querySelector('#wlp-auto-sync-canary-status');state.detail=box.querySelector('#wlp-auto-sync-canary-detail');state.exportButton=box.querySelector('#wlp-auto-sync-canary-export');
    state.exportButton.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';state.exportButton.addEventListener('click',exportReport);updateExportButton();
  }
  function setStatus(text,ok=null,detail='',options={}){if(!state.panel&&!state.auditEnabled&&!options.forcePanel)return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detailWithLastReceipt(detail);updateExportButton();}
  function exportReport(){const report=exportableReport();if(!report)return;const now=Date.now();state.suppressResumeUntil=now+EXPORT_RESUME_GUARD_MS;state.lastReceiverRequestAt=now;if(state.resumeTimer){clearTimeout(state.resumeTimer);state.resumeTimer=null;}const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-canonical-foreground-sync-${report.summary?.role||'audit'}-${String(report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

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
    const states=rows.filter(x=>x?.tableName==='learning_state'),events=rows.filter(x=>x?.tableName==='learning_events'),sessions=rows.filter(x=>x?.tableName==='learning_sessions'),metadata=rows.filter(x=>x?.tableName==='card_learning_metadata'),situations=rows.filter(x=>x?.tableName==='learning_situations');
    if(rows.length===2&&states.length===1&&events.length===1&&sessions.length===0&&metadata.length===0&&situations.length===0)return'state-event';
    if(rows.length===1&&states.length===0&&events.length===1&&sessions.length===0&&metadata.length===0&&situations.length===0)return'event-only';
    if(rows.length===1&&states.length===0&&events.length===0&&sessions.length===1&&metadata.length===0&&situations.length===0&&sessions[0]?.mutationKind==='insert')return'session-only';
    if(rows.length===1&&states.length===0&&events.length===0&&sessions.length===0&&metadata.length===1&&situations.length===0&&metadata[0]?.mutationKind==='upsert')return'metadata-only';
    if(rows.length===1&&states.length===0&&events.length===0&&sessions.length===0&&metadata.length===0&&situations.length===1&&situations[0]?.mutationKind==='upsert')return'situation-only';
    return null;
  }
  function pendingOutboxRecoveryPlan(rows,{preferredActionId=''}={}){
    if(!Array.isArray(rows)||rows.length===0)return{recoverable:false,reason:'empty'};
    if(rows.some(x=>x?.transportEligible!==true||x?.diagnosticOnly===true||x?.candidateOnly===true))return{recoverable:false,reason:'unsupported flags'};
    if(rows.some(x=>String(x?.status||'pending')!=='pending'))return{recoverable:false,reason:'non-pending status'};
    const grouped=new Map();
    rows.forEach((row,index)=>{const actionId=String(row?.actionId||'');if(!actionId)return;let g=grouped.get(actionId);if(!g){g={actionId,rows:[],firstIndex:index,createdAt:String(row?.createdAt||'')};grouped.set(actionId,g);}g.rows.push(row);const created=String(row?.createdAt||'');if(created&&(!g.createdAt||created<g.createdAt))g.createdAt=created;});
    if(grouped.size===0||[...grouped.values()].reduce((n,g)=>n+g.rows.length,0)!==rows.length)return{recoverable:false,reason:'missing actionId'};
    const actions=[];
    for(const group of grouped.values()){
      try{const verified=validateSourceActionRows(group.rows);actions.push({...group,shape:verified.shape});}
      catch(error){return{recoverable:false,reason:`unsupported action ${group.actionId}: ${error?.message||String(error)}`};}
    }
    actions.sort((a,b)=>{const ac=a.createdAt||'',bc=b.createdAt||'';if(ac&&bc&&ac!==bc)return ac.localeCompare(bc);if(ac&&!bc)return-1;if(!ac&&bc)return 1;return a.firstIndex-b.firstIndex;});
    const preferred=String(preferredActionId||'');
    const selected=preferred?actions.find(x=>x.actionId===preferred):actions[0];
    if(!selected)return{recoverable:false,reason:`expected actionId ${preferred} is not pending`};
    return{recoverable:true,shape:selected.shape,actionId:selected.actionId,selectedRows:selected.rows.slice(),actionCount:actions.length,actions:actions.map(x=>({actionId:x.actionId,shape:x.shape,rowCount:x.rows.length,createdAt:x.createdAt||''}))};
  }
  async function fingerprintMirror(db){const rows=[];for(const store of CANONICAL_TABLES){const tx=db.transaction(store,'readonly'),items=await req(tx.objectStore(store).getAll());await txDone(tx);for(const item of items)rows.push({tableName:store,rowKey:String(item.rowKey),tombstone:Boolean(item.tombstone),payloadHash:String(item.payloadHash)});}rows.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));return{rows,rowCount:rows.length,manifestHash:await sha256(stableStringify(rows))};}
  function stateLabel(payload){const p=payload||{};if(Boolean(p.known)&&!Boolean(p.review))return'studied';if(Boolean(p.review)){const level=String(p.review_level||'').toLowerCase();return level?`review:${level}`:'review';}return'neutral';}
  function eventOnlyKind(canonicalEvent){const e=canonicalEvent||{},type=String(e.event_type||''),stream=String(e.source_stream||'');if(type==='attention_suggestion_kept'&&stream==='interaction')return'review-keep';if(type==='event'&&stream===ACTIVITY_EVENT_STREAM)return'card-study-encounter';if(type==='event'&&stream===INTERACTION_EVENT_STREAM)return'card-study-interaction';if(type===STANDARD_EVENT_TYPE&&stream===STANDARD_EVENT_STREAM)return'standard-event';if(type===STANDARD_RATING_CORRECTION_TYPE&&stream===STANDARD_EVENT_STREAM)return'standard-rating-correction';if(type==='event'&&stream===AI_EVENT_STREAM)return'ai-event';return'';}
  function verifyEventOnlyPayload(canonicalEvent){const e=canonicalEvent||{},legacy=e.payload||{},kind=eventOnlyKind(e);if(kind==='review-keep'){const from=String(legacy.fromLevel||'').toLowerCase(),to=String(legacy.suggestedLevel||'').toLowerCase();if(String(legacy.action||'')!=='attention_suggestion_kept'||String(legacy.source||'')!=='review-hub'||!['light','medium','high'].includes(from)||!['light','medium','high'].includes(to)||from===to)throw new Error('Event-only Keep payload is invalid.');return kind;}if(kind==='card-study-encounter'){const sourceEventId=String(e.source_event_id||''),wordId=String(e.legacy_word_id??''),legacyWordId=String(legacy.wordId??''),timestamp=Number(legacy.timestamp||0),source=String(legacy.source||'');if(!sourceEventId||!wordId||legacyWordId!==wordId||String(legacy.type||'')!=='study'||String(legacy.action||'')!=='encounter'||!Number.isFinite(timestamp)||timestamp<=0||!['source-deck','review-deck','study-set','solo'].includes(source)||!String(e.occurred_at||'')||!String(e.completed_at||''))throw new Error('Event-only Card Study encounter payload is invalid.');return kind;}if(kind==='card-study-interaction'){const sourceEventId=String(e.source_event_id||''),wordId=String(e.legacy_word_id??''),legacyWordId=String(legacy.wordId??''),timestamp=Number(legacy.timestamp||0),source=String(legacy.source||''),action=String(legacy.action||'');if(!sourceEventId||!wordId||legacyWordId!==wordId||!CARD_INTERACTION_ACTIONS.has(action)||!Number.isFinite(timestamp)||timestamp<=0||!['source-deck','review-deck','study-set','solo'].includes(source)||!String(e.occurred_at||'')||!String(e.completed_at||''))throw new Error('Event-only Card Study interaction payload is invalid.');return kind;}if(kind==='standard-event'){const sourceEventId=String(e.source_event_id||''),legacyEventId=String(legacy.eventId??legacy.event_id??legacy.id??''),wordId=String(e.legacy_word_id??''),legacyWordId=String(legacy.wordId??'');if(!sourceEventId||legacyEventId!==sourceEventId||!wordId||legacyWordId!==wordId||!String(legacy.completedAt||legacy.completed_at||''))throw new Error('Event-only Standard Practice payload is invalid.');return kind;}if(kind==='ai-event'){const sourceEventId=String(e.source_event_id||''),legacyEventId=String(legacy.eventId??legacy.event_id??legacy.id??''),wordId=String(e.legacy_word_id??''),legacyWordId=String(legacy.wordId??''),sessionId=String(legacy.sessionId??legacy.session_id??''),status=String(legacy.interpretationStatus||'');if(!sourceEventId||legacyEventId!==sourceEventId||!wordId||legacyWordId!==wordId||!sessionId||status!=='interpreted'||!legacy.interpreterResult||typeof legacy.interpreterResult!=='object'||!String(legacy.createdAt||legacy.timestamp||''))throw new Error('Event-only AI Practice payload is invalid.');return kind;}if(kind==='standard-rating-correction'){const wordId=String(e.legacy_word_id??''),legacyWordId=String(legacy.wordId??''),rating=String(legacy.rating||''),previous=String(legacy.previousRating||''),supersedes=String(e.supersedes_event_id||''),root=String(legacy.originalCanonicalEventId||''),declaredSupersedes=String(legacy.supersedesEventId||supersedes),originalEventId=String(legacy.originalEventId||'');const validPrevious=!previous||['got-it','almost','not-yet','no-idea'].includes(previous);if(String(legacy.action||'')!=='standard_rating_correction'||String(legacy.source||'')!=='standard-practice-history'||!wordId||legacyWordId!==wordId||!['got-it','almost','not-yet','no-idea'].includes(rating)||!validPrevious||rating===previous||!String(legacy.ratingUpdatedAt||'')||!supersedes||!root||!originalEventId||declaredSupersedes!==supersedes)throw new Error('Event-only Standard Practice rating correction payload is invalid.');return kind;}throw new Error(`Event-only Foreground Sync event shape is unsupported (${String(e.source_stream||'missing')}:${String(e.event_type||'missing')}).`);}
  function verifySessionPayload(canonicalSession){
    const row=canonicalSession||{},legacy=row.payload||{},sourceId=String(row.source_session_id||''),legacyId=String(legacy.sessionId??legacy.session_id??legacy.id??''),sessionType=String(row.session_type||'');
    if(!sourceId||legacyId!==sourceId||String(row.status||'')!=='completed'||!String(row.started_at||'')||!String(row.ended_at||''))throw new Error('Completed-session envelope is invalid.');
    if(sessionType==='standard'){
      if(String(legacy.status||'')!=='completed'||!String(legacy.completedAt||legacy.completed_at||'')||!Array.isArray(legacy.experiences)||legacy.experiences.length<1)throw new Error('Standard Practice completed-session payload is invalid.');
      return 'standard-session';
    }
    if(sessionType==='ai'){
      const completed=Number(legacy.completed||0),total=Number(legacy.total||0),turns=Array.isArray(legacy.turns)?legacy.turns:[];
      if(String(legacy.startedAt||'')!==String(row.started_at||'')||String(legacy.endedAt||'')!==String(row.ended_at||'')||!Number.isInteger(completed)||completed<1||!Number.isInteger(total)||total<completed||turns.length!==completed||turns.some(turn=>!String(turn?.eventId||'')))throw new Error('AI Practice completed-session payload is invalid.');
      return 'ai-session';
    }
    throw new Error(`Completed-session type is unsupported (${sessionType||'missing'}).`);
  }
  function verifyMetadataPayload(change){
    const payload=change?.payload||{};
    if(String(change?.table_name||'')!=='card_learning_metadata'||String(change?.operation||'')!=='upsert'||!payload||typeof payload!=='object'||String(payload.card_id||'')!==String(change?.row_key||''))throw new Error('Learning Metadata parent-row change is invalid.');
    if(!String(payload.metadata_id||'')||!String(payload.version_id||'')||Number(payload.revision||0)<1)throw new Error('Learning Metadata parent-row lineage is incomplete.');
    return 'learning-metadata-parent';
  }
  function verifySituationPayload(change){
    const payload=change?.payload||{};
    if(String(change?.table_name||'')!=='learning_situations'||String(change?.operation||'')!=='upsert'||!payload||typeof payload!=='object'||String(payload.situation_id||'')!==String(change?.row_key||'')||!String(payload.card_id||''))throw new Error('Learning Metadata Situation-row change is invalid.');
    if(!String(payload.source_situation_id||'')||!String(payload.version_id||'')||Number(payload.revision||0)<1)throw new Error('Learning Metadata Situation-row lineage is incomplete.');
    return 'learning-metadata-situation';
  }
  function validateSourceActionRows(rows){
    if(!Array.isArray(rows)||rows.length===0)throw new Error('Source action has no outbox rows.');
    if(rows.some(x=>x?.transportEligible!==true||x?.diagnosticOnly===true||x?.candidateOnly===true))throw new Error('Source action contains unsupported flags.');
    if(rows.some(x=>String(x?.status||'pending')!=='pending'))throw new Error('Source action contains non-pending rows.');
    const actionIds=[...new Set(rows.map(x=>String(x?.actionId||'')))];if(actionIds.length!==1||!actionIds[0])throw new Error('Source action rows do not share one actionId.');
    const shape=sourceShape(rows);if(!shape)throw new Error(`Unsupported source action shape (${rows.length} row(s)).`);
    const eventMutation=rows.find(x=>x?.tableName==='learning_events'),sessionMutation=rows.find(x=>x?.tableName==='learning_sessions'),metadataMutation=rows.find(x=>x?.tableName==='card_learning_metadata'),situationMutation=rows.find(x=>x?.tableName==='learning_situations'),eventType=String(eventMutation?.payload?.event_type||'');
    if(shape==='state-event'&&!PAIR_EVENT_TYPES.has(eventType))throw new Error(`State/event event type is unsupported (${eventType||'missing'}).`);
    if(shape==='event-only')verifyEventOnlyPayload(eventMutation?.payload||{});
    if(shape==='session-only')verifySessionPayload(sessionMutation?.payload||{});
    if(shape==='metadata-only'&&(String(metadataMutation?.rowKey||'')!==String(metadataMutation?.payload?.card_id||'')||!String(metadataMutation?.precondition?.payloadHash||'')))throw new Error('Learning Metadata source mutation is invalid.');
    if(shape==='situation-only'&&(String(situationMutation?.rowKey||'')!==String(situationMutation?.payload?.situation_id||'')||!String(situationMutation?.payload?.card_id||'')||!String(situationMutation?.precondition?.payloadHash||'')))throw new Error('Learning Metadata Situation source mutation is invalid.');
    return{shape,actionId:actionIds[0],eventMutation,sessionMutation,metadataMutation,situationMutation,eventType};
  }

  async function verifyChanges(changes){
    if(!Array.isArray(changes)||![1,2].includes(changes.length))throw new Error(`Foreground Sync expected one single-row change or one state/event pair, found ${changes?.length??0}.`);
    const stateChange=changes.find(x=>x.table_name==='learning_state'&&x.operation==='upsert')||null;
    const eventChange=changes.find(x=>x.table_name==='learning_events'&&x.operation==='append')||null;
    const sessionChange=changes.find(x=>x.table_name==='learning_sessions'&&(x.operation==='insert'||x.operation==='upsert'))||null;
    const metadataChange=changes.find(x=>x.table_name==='card_learning_metadata'&&x.operation==='upsert')||null;
    const situationChange=changes.find(x=>x.table_name==='learning_situations'&&x.operation==='upsert')||null;
    const anchor=eventChange||sessionChange||metadataChange||situationChange;if(!anchor)throw new Error('Foreground Sync requires a supported learning_events, learning_sessions, card_learning_metadata, or learning_situations change.');
    const actionId=String(anchor.action_id||'');
    for(const x of changes){
      if(!x.payload||typeof x.payload!=='object')throw new Error(`Change ${x.change_seq} has no payload.`);
      if(await sha256(stableStringify(x.payload))!==String(x.payload_hash||''))throw new Error(`Change ${x.change_seq} payload hash mismatch.`);
      if(String(x.candidate_key)!==BASE.key||Number(x.head_version)!==BASE.head)throw new Error(`Change ${x.change_seq} is not anchored to ACTIVE Authority v3.`);
      if(String(x.action_id||'')!==actionId)throw new Error('Foreground Sync changes do not share one actionId.');
    }
    if(changes.length===1&&metadataChange){
      if(stateChange||eventChange||sessionChange)throw new Error('Learning Metadata Foreground Sync must contain only card_learning_metadata.');
      const metadataOnlyShape=verifyMetadataPayload(metadataChange);
      return{changeShape:'metadata-only',metadataOnlyShape,stateChange:null,eventChange:null,sessionChange:null,metadataChange,eventType:'learning_metadata_upsert',targetState:null,actionId,wordId:'',sessionId:'',metadataRowKey:String(metadataChange.row_key||''),actionSource:'learning-metadata',expectedMutations:1,seqMax:Number(metadataChange.change_seq||0),seqMin:Number(metadataChange.change_seq||0)};
    }
    if(changes.length===1&&situationChange){
      if(stateChange||eventChange||sessionChange||metadataChange)throw new Error('Learning Metadata Situation Foreground Sync must contain only learning_situations.');
      const situationOnlyShape=verifySituationPayload(situationChange);
      return{changeShape:'situation-only',situationOnlyShape,stateChange:null,eventChange:null,sessionChange:null,metadataChange:null,situationChange,eventType:'learning_situation_upsert',targetState:null,actionId,wordId:'',sessionId:'',metadataRowKey:'',situationRowKey:String(situationChange.row_key||''),actionSource:'learning-metadata-situation',expectedMutations:1,seqMax:Number(situationChange.change_seq||0),seqMin:Number(situationChange.change_seq||0)};
    }
    if(changes.length===1&&sessionChange){
      if(stateChange||eventChange)throw new Error('Session-only Foreground Sync must contain only learning_sessions.');
      const sessionOnlyShape=verifySessionPayload(sessionChange.payload);
      return{changeShape:'session-only',sessionOnlyShape,stateChange:null,eventChange:null,sessionChange,metadataChange:null,eventType:'session_completed',targetState:null,actionId,wordId:'',sessionId:String(sessionChange.payload?.source_session_id||''),actionSource:sessionOnlyShape==='ai-session'?'ai-practice-session':'standard-practice-session',expectedMutations:1,seqMax:Number(sessionChange.change_seq||0),seqMin:Number(sessionChange.change_seq||0)};
    }
    if(!eventChange)throw new Error('Foreground Sync event shape requires one learning_events append.');
    const eventType=String(eventChange.payload?.event_type||'');
    const eventPayload=eventChange.payload?.payload||{};
    const wordId=String(eventChange.payload?.legacy_word_id??eventPayload.wordId??'');
    const actionSource=String(eventPayload.source||'');
    if(changes.length===1){
      if(stateChange||sessionChange)throw new Error('Event-only Foreground Sync must not contain learning_state or learning_sessions.');
      const eventOnlyShape=verifyEventOnlyPayload(eventChange.payload);
      return{changeShape:'event-only',eventOnlyShape,stateChange:null,eventChange,sessionChange:null,metadataChange:null,eventType,targetState:null,actionId,wordId,sessionId:'',actionSource,expectedMutations:1,seqMax:Number(eventChange.change_seq||0),seqMin:Number(eventChange.change_seq||0)};
    }
    if(!stateChange||sessionChange)throw new Error('Two-change Foreground Sync requires one learning_state upsert and one learning_events append.');
    if(String(eventChange.payload?.card_id||'')!==String(stateChange.row_key||''))throw new Error('Foreground Sync state/event target card identity mismatch.');
    if(!PAIR_EVENT_TYPES.has(eventType))throw new Error(`State/event Foreground Sync event type is unsupported (${eventType||'missing'}).`);
    const targetState=stateLabel(stateChange.payload);
    if(eventType==='attention_set'){
      const targetLevel=String(stateChange.payload?.review_level||'').toLowerCase();
      if(!['','light','medium','high'].includes(targetLevel)||!Boolean(stateChange.payload?.review))throw new Error(`Foreground Sync target Attention is invalid (${targetLevel||'none'}).`);
      const eventLevel=String(eventPayload.level||'').toLowerCase();
      if(eventLevel&&eventLevel!==targetLevel)throw new Error(`Foreground Sync state/event Attention target mismatch (${targetLevel} vs ${eventLevel}).`);
    }else if(eventType==='studied'&&targetState!=='studied')throw new Error(`studied event does not converge to studied state (${targetState}).`);
    else if(eventType==='studied_removed'&&targetState!=='neutral')throw new Error(`studied_removed event does not converge to neutral state (${targetState}).`);
    else if(eventType==='review'&&!targetState.startsWith('review'))throw new Error(`review event does not converge to review state (${targetState}).`);
    else if(eventType==='review_removed'&&targetState!=='neutral')throw new Error(`review_removed event does not converge to neutral state (${targetState}).`);
    return{changeShape:'state-event',stateChange,eventChange,sessionChange:null,metadataChange:null,eventType,targetState,actionId,wordId,sessionId:'',actionSource,expectedMutations:2,seqMax:Math.max(...changes.map(x=>Number(x.change_seq||0))),seqMin:Math.min(...changes.map(x=>Number(x.change_seq||0)))};
  }
  async function predictMaterialized(db,changes){const before=await fingerprintMirror(db),map=new Map(before.rows.map(x=>[identity(x.tableName,x.rowKey),x]));for(const x of changes)map.set(identity(x.table_name,x.row_key),{tableName:String(x.table_name),rowKey:String(x.row_key),tombstone:Boolean(x.tombstone),payloadHash:String(x.payload_hash)});const rows=[...map.values()].sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));return{before,rowCount:rows.length,manifestHash:await sha256(stableStringify(rows))};}
  async function applyLocal(db,changes,meta,cursorMeta,isSource,outboxMutations){
    const verified=await verifyChanges(changes),predicted=await predictMaterialized(db,changes),appliedAt=new Date().toISOString();
    const stores=[...(verified.stateChange?['learning_state']:[]),...(verified.eventChange?['learning_events']:[]),...(verified.sessionChange?['learning_sessions']:[]),...(verified.metadataChange?['card_learning_metadata']:[]),...(verified.situationChange?['learning_situations']:[]),META_STORE,OUTBOX_STORE],tx=db.transaction(stores,'readwrite');
    if(verified.stateChange)tx.objectStore('learning_state').put({rowKey:String(verified.stateChange.row_key),payloadHash:String(verified.stateChange.payload_hash),tombstone:Boolean(verified.stateChange.tombstone),payload:clone(verified.stateChange.payload)});
    if(verified.eventChange)tx.objectStore('learning_events').put({rowKey:String(verified.eventChange.row_key),payloadHash:String(verified.eventChange.payload_hash),tombstone:Boolean(verified.eventChange.tombstone),payload:clone(verified.eventChange.payload)});
    if(verified.sessionChange)tx.objectStore('learning_sessions').put({rowKey:String(verified.sessionChange.row_key),payloadHash:String(verified.sessionChange.payload_hash),tombstone:Boolean(verified.sessionChange.tombstone),payload:clone(verified.sessionChange.payload)});
    if(verified.metadataChange)tx.objectStore('card_learning_metadata').put({rowKey:String(verified.metadataChange.row_key),payloadHash:String(verified.metadataChange.payload_hash),tombstone:Boolean(verified.metadataChange.tombstone),payload:clone(verified.metadataChange.payload)});
    if(verified.situationChange)tx.objectStore('learning_situations').put({rowKey:String(verified.situationChange.row_key),payloadHash:String(verified.situationChange.payload_hash),tombstone:Boolean(verified.situationChange.tombstone),payload:clone(verified.situationChange.payload)});
    const nextMeta={...meta,lastSyncCursor:verified.seqMax,lastSuccessfulSyncAt:appliedAt,materializedSyncCursor:verified.seqMax,materializedManifestHash:predicted.manifestHash,materializedCanonicalRowCount:predicted.rowCount,syncOverlayApplied:true,revisionSource:'wlp_sync_changes_v1-foreground-production',materializedAt:appliedAt};
    tx.objectStore(META_STORE).put(nextMeta);
    tx.objectStore(META_STORE).put({...(cursorMeta||{}),key:CURSOR_KEY,lastSyncCursor:verified.seqMax,lastSuccessfulSyncAt:appliedAt,candidateKey:BASE.key,headVersion:BASE.head,snapshotManifestHash:BASE.manifest,materializedManifestHash:predicted.manifestHash,materializedCanonicalRowCount:predicted.rowCount});
    if(isSource)for(const m of outboxMutations)tx.objectStore(OUTBOX_STORE).delete(m.mutationId);
    await txDone(tx);
    const after=await fingerprintMirror(db);if(after.rowCount!==predicted.rowCount||after.manifestHash!==predicted.manifestHash)throw new Error('Foreground Sync post-commit mirror fingerprint mismatch.');
    return{verified,predicted,after,appliedAt};
  }

  async function runSync({trigger='manual',expectedActionId='',receiverOnly=false}={}){
    if(state.busy){if(expectedActionId)state.pendingSourceRun={trigger,expectedActionId};else if(receiverOnly)state.pendingReceiverRun={trigger,receiverOnly:true};return null;}state.busy=true;setStatus('SYNCING · Canonical Foreground Sync v342 is running…',null,'Source outbox is preserved unless server ACK + atomic local commit both succeed.');let db=null,role='receiver',effectiveReceiverOnly=receiverOnly,recoveredPendingOutbox=false,recoveryPlan=null;
    try{
      const a=await cloudContext();db=await openDb();const meta=await getMeta(db,META_KEY),cursorMeta=await getMeta(db,CURSOR_KEY),outbox=await getAllOutbox(db),cursorBefore=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      if(String(meta?.candidateKey||'')!==BASE.key||Number(meta?.headVersion||0)!==BASE.head||String(meta?.snapshotManifestHash||'')!==BASE.manifest)throw new Error('Foreground Sync requires ACTIVE Authority v3.');
      if(outbox.length&&state.pendingOutboxRecoveryEnabled&&!effectiveReceiverOnly)recoveryPlan=pendingOutboxRecoveryPlan(outbox,{preferredActionId:expectedActionId});
      if(effectiveReceiverOnly&&outbox.length){
        recoveryPlan=state.pendingOutboxRecoveryEnabled?pendingOutboxRecoveryPlan(outbox,{preferredActionId:expectedActionId}):{recoverable:false,reason:'recovery disabled by query'};
        if(recoveryPlan.recoverable){
          effectiveReceiverOnly=false;recoveredPendingOutbox=true;
        }else{
          if(state.sourceFailure){
            state.report={...clone(state.sourceFailure.report),generatedAt:new Date().toISOString(),summary:{...clone(state.sourceFailure.report?.summary||{}),receiverResumeDeferred:true,outboxAfter:outbox.length},issues:{...clone(state.sourceFailure.report?.issues||{}),warnings:[...(state.sourceFailure.report?.issues?.warnings||[]),`A later foreground check did not auto-retry the pending outbox (${recoveryPlan.reason}); the source error remains authoritative.`]}};
            setStatus(`CHECK · ${state.sourceFailure.message}`,false,`cursor ${cursorBefore} · outbox ${outbox.length} · pending source is not eligible for automatic recovery (${recoveryPlan.reason})`,{forcePanel:true});
            return clone(state.report);
          }
          state.report={format:REPORT_FORMAT,version:REPORT_VERSION,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:REPORT_MODE,summary:{role:'receiver-deferred',trigger,cursorBefore,cursorAfter:cursorBefore,outboxBefore:outbox.length,outboxAfter:outbox.length,changeRows:0,blockingIssues:0,pass:true,pendingOutboxRecoveryEligible:false},issues:{blocking:[],warnings:[`Foreground pull was deferred because local Canonical outbox rows are pending but are not eligible for automatic recovery (${recoveryPlan.reason}). No source push was attempted.`]},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true}};
          setStatus('READY · Foreground pull deferred; local outbox needs manual handling.',true,`cursor ${cursorBefore} · outbox ${outbox.length} · ${recoveryPlan.reason}`);
          return clone(state.report);
        }
      }
      let serverResult=null,changes=[],actionId='',sourceRows=[],expectedOutboxAfter=0;
      if(outbox.length){
        role='source';
        if(recoveryPlan?.recoverable){sourceRows=recoveryPlan.selectedRows.slice();expectedOutboxAfter=outbox.length-sourceRows.length;}
        else{sourceRows=outbox.filter(x=>x?.transportEligible===true&&!x?.diagnosticOnly&&!x?.candidateOnly);expectedOutboxAfter=0;if(sourceRows.length!==outbox.length)throw new Error(`Foreground Sync will not ignore unsupported outbox rows (${outbox.length-sourceRows.length} unsupported); use manual Cloud Shadow.`);}
        const sourceValidation=validateSourceActionRows(sourceRows),shape=sourceValidation.shape;actionId=sourceValidation.actionId;
        if(expectedActionId&&actionId!==expectedActionId)throw new Error('Foreground Sync staged actionId does not match the pending outbox.');
        if(recoveryPlan?.recoverable&&recoveryPlan.actionCount>1&&!state.recoveryBatch)state.recoveryBatch={initialOutbox:outbox.length,totalActions:recoveryPlan.actionCount,completed:[],startedAt:new Date().toISOString()};
        const raw=await a.rest(`rpc/${APPLY_RPC}`,{method:'POST',body:{p_device_key:String(meta.deviceKey||''),p_mutations:clone(sourceRows)}});serverResult=Array.isArray(raw.data)?raw.data[0]:raw.data;
        if(!serverResult||typeof serverResult!=='object')throw new Error('Foreground Sync apply RPC returned no JSON result.');
        if(serverResult.status==='conflict')throw new Error(`Server preserved conflict ${serverResult.conflictId||'unknown'}; outbox retained for manual resolution.`);
        if(serverResult.status!=='applied'||serverResult.applied!==true)throw new Error(`Foreground Sync apply did not return applied status (${serverResult.status||'unknown'}).`);
        changes=await fetchChangesForAction(a,actionId);
      }else{
        role='receiver';const pending=await fetchChangesAfter(a,cursorBefore);
        if(pending.length===0){state.report={format:REPORT_FORMAT,version:REPORT_VERSION,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:REPORT_MODE,summary:{role:'receiver-noop',trigger,cursorBefore,cursorAfter:cursorBefore,outboxBefore:0,outboxAfter:0,changeRows:0,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['No remote change was available. Nothing was written.']},invariants:{manualCloudShadowFallbackPreserved:true,noServiceWorkerSync:true}};setStatus('READY · No new Canonical changes to pull.',true,`cursor ${cursorBefore} · outbox 0`);return clone(state.report);}
        changes=firstActionOnly(pending);actionId=String(changes[0]?.action_id||'');
      }
      const verified=await verifyChanges(changes);if(actionId!==verified.actionId)throw new Error('Foreground Sync action identity mismatch.');if(verified.seqMin<=cursorBefore)throw new Error(`Foreground Sync change sequence overlaps committed cursor ${cursorBefore}.`);
      const outboxBefore=outbox.length,local=await applyLocal(db,changes,meta,cursorMeta,role==='source',sourceRows),outboxAfter=(await getAllOutbox(db)).length,stateRow=verified.stateChange?await getRow(db,'learning_state',verified.stateChange.row_key):null,eventRow=verified.eventChange?await getRow(db,'learning_events',verified.eventChange.row_key):null,sessionRow=verified.sessionChange?await getRow(db,'learning_sessions',verified.sessionChange.row_key):null,metadataRow=verified.metadataChange?await getRow(db,'card_learning_metadata',verified.metadataChange.row_key):null,situationRow=verified.situationChange?await getRow(db,'learning_situations',verified.situationChange.row_key):null;
      const ackRaw=await a.rest(`rpc/${CURSOR_ACK_RPC}`,{method:'POST',body:{p_device_key:String(meta.deviceKey||''),p_change_seq:verified.seqMax}}),cursorAck=Array.isArray(ackRaw.data)?ackRaw.data[0]:ackRaw.data;
      const retry=await fetchChangesAfter(a,verified.seqMax),sameActionRetry=retry.filter(x=>String(x.action_id||'')===actionId),mutations=await fetchMutationsForAction(a,actionId),ack=await fetchAck(a,actionId),head=await fetchHead(a);
      const localStateLabel=verified.stateChange?stateLabel(stateRow?.payload):'unchanged',stateOk=!verified.stateChange||localStateLabel===verified.targetState,eventOk=!verified.eventChange||String(eventRow?.payload?.event_type||'')===verified.eventType,sessionOk=!verified.sessionChange||(String(sessionRow?.payload?.source_session_id||'')===verified.sessionId&&String(sessionRow?.payload?.session_type||'')===(verified.sessionOnlyShape==='ai-session'?'ai':'standard')&&String(sessionRow?.payload?.status||'')==='completed'),metadataOk=!verified.metadataChange||(String(metadataRow?.rowKey||'')===verified.metadataRowKey&&String(metadataRow?.payloadHash||'')===String(verified.metadataChange.payload_hash||'')),situationOk=!verified.situationChange||(String(situationRow?.rowKey||'')===verified.situationRowKey&&String(situationRow?.payloadHash||'')===String(verified.situationChange.payload_hash||'')),headOk=String(head.candidate_key)===BASE.key&&Number(head.head_version)===BASE.head&&String(head.snapshot_manifest_hash)===BASE.manifest,mutationOk=mutations.length===verified.expectedMutations&&mutations.every(x=>x.status==='applied'),ackOk=Boolean(ack&&ack.status==='applied'&&Array.isArray(ack.mutation_ids)&&ack.mutation_ids.length===verified.expectedMutations),cursorAckOk=Number(cursorAck?.lastAckChangeSeq||0)>=verified.seqMax,outboxOk=outboxAfter===expectedOutboxAfter,retryOk=sameActionRetry.length===0;
      const shapeOk=(verified.changeShape==='metadata-only'&&Boolean(verified.metadataOnlyShape)&&Boolean(verified.metadataRowKey))||(verified.changeShape==='situation-only'&&Boolean(verified.situationOnlyShape)&&Boolean(verified.situationRowKey))||(verified.changeShape==='session-only'&&Boolean(verified.sessionOnlyShape)&&Boolean(verified.sessionId))||(Boolean(verified.wordId)&&((verified.changeShape==='state-event'&&PAIR_EVENT_TYPES.has(verified.eventType))||(verified.changeShape==='event-only'&&Boolean(verified.eventOnlyShape))));
      const shapeEvidence=verified.changeShape==='metadata-only'?`${verified.changeShape}/${verified.metadataOnlyShape} · ${verified.metadataRowKey}`:verified.changeShape==='situation-only'?`${verified.changeShape}/${verified.situationOnlyShape} · ${verified.situationRowKey}`:verified.changeShape==='session-only'?`${verified.changeShape}/${verified.sessionOnlyShape} · ${verified.sessionId}`:`${verified.changeShape}${verified.eventOnlyShape?`/${verified.eventOnlyShape}`:''} · WID${verified.wordId||'?'} · ${verified.eventType}`;
      const checks=[['Supported action shape verified',shapeOk,shapeEvidence],['Canonical state converged to target',stateOk,localStateLabel],['Canonical event converged locally',eventOk,verified.eventChange?String(eventRow?.rowKey||'missing'):'n/a'],['Canonical session converged locally',sessionOk,verified.sessionChange?String(sessionRow?.rowKey||'missing'):'n/a'],['Canonical Learning Metadata converged locally',metadataOk,verified.metadataChange?String(metadataRow?.rowKey||'missing'):'n/a'],['Canonical Learning Metadata Situation converged locally',situationOk,verified.situationChange?String(situationRow?.rowKey||'missing'):'n/a'],['Materialized mirror fingerprint committed',local.after.manifestHash===local.predicted.manifestHash,`${local.after.rowCount} rows · ${local.after.manifestHash}`],['Processed action rows clear only after acknowledged local commit',outboxOk,`${outboxBefore} → ${outboxAfter} · expected ${expectedOutboxAfter}`],['Mutation ledger + action acknowledgement are complete',mutationOk&&ackOk,`${mutations.length}/${verified.expectedMutations} mutations · ack ${ack?.status||'missing'}`],['Device cursor acknowledgement reached local commit',cursorAckOk,String(cursorAck?.lastAckChangeSeq??'missing')],['Exact action retry is a no-op',retryOk,`${sameActionRetry.length} same-action row(s)`],['Authority v3 head remains unchanged',headOk,`${head.candidate_key} · head ${head.head_version}`]].map(([name,pass,evidence])=>({name,pass:Boolean(pass),evidence:String(evidence)}));
      const blocking=checks.filter(x=>!x.pass).map(x=>x.name),pass=blocking.length===0;
      state.report={format:REPORT_FORMAT,version:REPORT_VERSION,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:REPORT_MODE,device:{deviceKey:meta?.deviceKey||null,platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?'iPhone Safari/WebKit':'Windows Browser'},authority:{candidateKey:BASE.key,headVersion:BASE.head,snapshotManifestHash:BASE.manifest},summary:{role,trigger,recoveredPendingOutbox,recoveryShape:recoveryPlan?.shape||null,recoveryActionCount:recoveryPlan?.actionCount||0,recoveryActionId:recoveryPlan?.actionId||'',changeShape:verified.changeShape,eventOnlyShape:verified.eventOnlyShape||null,sessionOnlyShape:verified.sessionOnlyShape||null,metadataOnlyShape:verified.metadataOnlyShape||null,situationOnlyShape:verified.situationOnlyShape||null,metadataRowKey:verified.metadataRowKey||'',situationRowKey:verified.situationRowKey||'',wordId:verified.wordId,sessionId:verified.sessionId||null,eventType:verified.eventType,serverApplied:role==='source'?Boolean(serverResult?.applied):false,changeRows:changes.length,cursorBefore,cursorAfter:verified.seqMax,outboxBefore,outboxAfter,stateLevel:localStateLabel,materializedRowsBefore:local.predicted.before.rowCount,materializedRowsAfter:local.after.rowCount,mutationRows:mutations.length,acknowledged:ackOk,cursorAcknowledged:cursorAckOk,retrySameActionRows:sameActionRetry.length,pendingRemoteChangeRows:retry.length-sameActionRetry.length,blockingIssues:blocking.length,pass},serverResult:clone(serverResult),changes:clone(changes),before:{cursor:cursorBefore,outboxRows:outboxBefore,materializedRows:local.predicted.before.rowCount,materializedManifestHash:local.predicted.before.manifestHash},after:{cursor:verified.seqMax,outboxRows:outboxAfter,materializedRows:local.after.rowCount,materializedManifestHash:local.after.manifestHash},checks,issues:{blocking,warnings:['Foreground sync accepts the proven state/event actions, event-only Review/Standard/AI actions, completed Standard/AI Practice sessions, and proven Learning Metadata parent/Situation single-row upserts; unsupported outbox shapes remain manual Cloud Shadow fallback.','Normal Home, Review, Study-card, Progress, Study Hub, Deck Browser, and Learning Metadata pages perform foreground checks on page load and debounced foreground resume; safe supported pending production outbox action groups are retried one action at a time before receiver pull; ?wlpAutoSyncReceiver=0 disables these checks, while ?wlpPendingOutboxRecovery=0 disables only automatic pending-outbox recovery.','No Service Worker/background sync is enabled. This is foreground page sync only.']},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true,authorityHeadUnchanged:headOk}};
      if(!pass)throw new Error(blocking.join('; '));
      if(role==='source')state.sourceFailure=null;
      if(role==='source'&&state.recoveryBatch){state.recoveryBatch.completed.push({actionId,shape:verified.changeShape,eventType:verified.eventType,wordId:verified.wordId||'',cursorAfter:verified.seqMax,outboxAfter});}
      const completedBatch=role==='source'&&state.recoveryBatch&&outboxAfter===0?clone(state.recoveryBatch):null;
      if(completedBatch){state.report.summary.recoveryBatch={initialOutbox:completedBatch.initialOutbox,totalActions:completedBatch.totalActions,completedActions:completedBatch.completed.length,actions:completedBatch.completed};state.recoveryBatch=null;}
      persistLastReceipt(state.report);
      const targetLabel=verified.changeShape==='metadata-only'?`Learning Metadata ${verified.metadataRowKey}`:verified.changeShape==='situation-only'?`Learning Metadata Situation ${verified.situationRowKey}`:verified.changeShape==='session-only'?`${verified.sessionOnlyShape==='ai-session'?'AI':'Standard'} session ${verified.sessionId}`:`WID${verified.wordId} ${verified.eventType}`;
      if(role==='source'&&outboxAfter>0&&recoveryPlan?.recoverable){state.pendingReceiverRun={trigger:'pending-outbox-recovery-continue',receiverOnly:true};setStatus(`PASS · ${targetLabel} recovered; continuing pending outbox recovery.`,true,`outbox ${outboxBefore} → ${outboxAfter} · action ${actionId} committed · next supported pending action will retry automatically.`);}
      else if(completedBatch&&completedBatch.totalActions>1){setStatus('PASS · Pending outbox recovery batch completed.',true,`outbox ${completedBatch.initialOutbox} → 0 · ${completedBatch.completed.length}/${completedBatch.totalActions} action(s) recovered · last cursor ${verified.seqMax}.`);}
      else{setStatus(role==='source'?`PASS · ${targetLabel} ${recoveredPendingOutbox?'recovered from pending outbox':'auto-pushed'} at cursor ${verified.seqMax}.`:`PASS · ${targetLabel} auto-pulled at cursor ${verified.seqMax}.`,true,`outbox ${outboxBefore} → ${outboxAfter} · ${changes.length} change(s) · ${retry.length-sameActionRetry.length} later remote row(s) pending · manual Cloud Shadow remains available.`);}
      window.dispatchEvent(new CustomEvent('wlp-canonical-auto-sync-complete',{detail:{pass:true,role,actionId,wordId:verified.wordId,sessionId:verified.sessionId||'',eventType:verified.eventType,changeShape:verified.changeShape,actionSource:verified.actionSource,metadataRowKey:verified.metadataRowKey||'',situationRowKey:verified.situationRowKey||'',cursorAfter:verified.seqMax,outboxAfter,recoveryBatchCompleted:Boolean(completedBatch)}}));window.dispatchEvent(new CustomEvent('wlp-canonical-review-candidate-refresh'));return clone(state.report);
    }catch(error){
      const message=error?.message||String(error);
      if(effectiveReceiverOnly&&isTransientReceiverNetworkError(error)){
        state.report={format:REPORT_FORMAT,version:REPORT_VERSION,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:REPORT_MODE,summary:{role:'receiver-deferred',trigger,changeRows:0,blockingIssues:0,pass:true,deferred:true},issues:{blocking:[],warnings:[`Receiver-only Cloud check was deferred: ${message}`,'No local Canonical write was changed. The next page load or foreground resume will retry automatically.']},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true}};
        setStatus('WAIT · Receiver check deferred.',null,'Cloud could not be reached for this receiver-only check. Last Sync remains safe; the next foreground check will retry.');
        window.dispatchEvent(new CustomEvent('wlp-canonical-auto-sync-complete',{detail:{pass:true,deferred:true,role:'receiver-deferred',error:message}}));return clone(state.report);
      }
      state.report={format:REPORT_FORMAT,version:REPORT_VERSION,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:REPORT_MODE,summary:{role,trigger,blockingIssues:1,pass:false},issues:{blocking:[message],warnings:['Automatic sync stopped. The source outbox is intentionally not cleaned up on failure; use Cloud Shadow manual steady sync as fallback.']},invariants:{manualCloudShadowFallbackPreserved:true,sourceOutboxRetainedOnFailure:true,noServiceWorkerSync:true,noConflictAutoOverwrite:true}};if(role==='source')state.sourceFailure={message,report:clone(state.report)};setStatus(`CHECK · ${message}`,false,'Do not stage another write. Manual Cloud Shadow steady sync remains the fallback.',{forcePanel:true});window.dispatchEvent(new CustomEvent('wlp-canonical-auto-sync-complete',{detail:{pass:false,role,error:message}}));return clone(state.report);
    }finally{
      try{db?.close();}catch(_){}
      state.busy=false;updateExportButton();
      const queuedSource=state.pendingSourceRun;state.pendingSourceRun=null;
      const queuedReceiver=state.pendingReceiverRun;state.pendingReceiverRun=null;
      if(queuedSource){
        if(queuedReceiver)state.pendingReceiverRun=queuedReceiver;
        setTimeout(()=>{void runSync(queuedSource);},0);
      }else if(queuedReceiver){
        setTimeout(()=>{void runSync(queuedReceiver);},0);
      }
    }
  }

  function onStaged(event){const d=event?.detail||{},eventType=String(d.eventType||''),sourceStream=String(d.sourceStream||''),tableName=String(d.tableName||''),mutationKind=String(d.mutationKind||''),mutationCount=Number(d.mutationCount||0);const supported=(PAIR_EVENT_TYPES.has(eventType)&&mutationCount===2)||(EVENT_ONLY_TYPES.has(eventType)&&mutationCount===1)||(eventType==='event'&&sourceStream===ACTIVITY_EVENT_STREAM&&mutationCount===1)||(eventType==='event'&&sourceStream===INTERACTION_EVENT_STREAM&&mutationCount===1)||((eventType===STANDARD_EVENT_TYPE||eventType===STANDARD_RATING_CORRECTION_TYPE)&&sourceStream===STANDARD_EVENT_STREAM&&mutationCount===1)||(eventType==='event'&&sourceStream===AI_EVENT_STREAM&&mutationCount===1)||(tableName==='learning_sessions'&&mutationKind==='insert'&&mutationCount===1)||(tableName==='card_learning_metadata'&&mutationKind==='upsert'&&mutationCount===1)||(tableName==='learning_situations'&&mutationKind==='upsert'&&mutationCount===1);if(!supported)return;setTimeout(()=>{void runSync({trigger:`${String(d.source||'canonical')}-outbox-staged`,expectedActionId:String(d.actionId||'')});},80);}
  function requestDefaultReceiver(trigger,{delay=0,markNow=false}={}){
    if(!state.defaultReceiverEnabled)return;
    if(document.visibilityState&&document.visibilityState!=='visible')return;
    const now=Date.now();
    if(now-state.lastReceiverRequestAt<RESUME_COOLDOWN_MS)return;
    if(markNow)state.lastReceiverRequestAt=now;
    if(state.resumeTimer)clearTimeout(state.resumeTimer);
    state.resumeTimer=setTimeout(()=>{
      state.resumeTimer=null;
      if(!state.defaultReceiverEnabled)return;
      if(document.visibilityState&&document.visibilityState!=='visible')return;
      const at=Date.now();
      if(!markNow&&at-state.lastReceiverRequestAt<RESUME_COOLDOWN_MS)return;
      state.lastReceiverRequestAt=at;
      void runSync({trigger,receiverOnly:true});
    },Math.max(0,Number(delay)||0));
  }
  function onForegroundResume(){
    if(!state.defaultReceiverEnabled)return;
    if(Date.now()<state.suppressResumeUntil)return;
    requestDefaultReceiver(`receiver-${state.pageKind||'page'}-foreground-resume`,{delay:RESUME_DEBOUNCE_MS});
  }
  function init(){
    window.addEventListener('wlp-canonical-outbox-staged',onStaged);
    const params=new URLSearchParams(location.search),explicitReceiver=params.get(RECEIVER_FLAG)==='1',receiverDisabled=params.get(RECEIVER_DISABLE_FLAG)==='0',recoveryDisabled=params.get(RECOVERY_DISABLE_FLAG)==='0',audit=params.get(AUDIT_FLAG)==='1',reviewPage=/(^|\/)review(?:\.html)?\/?$/i.test(location.pathname),studyPage=/(^|\/)batch(?:\.html)?\/?$/i.test(location.pathname),progressPage=/(^|\/)progress(?:\.html)?\/?$/i.test(location.pathname),studyHubPage=/(^|\/)study-hub(?:\.html)?\/?$/i.test(location.pathname),deckBrowserPage=/(^|\/)deck-browser(?:\.html)?\/?$/i.test(location.pathname),learningMetadataPage=/(^|\/)editor-learning-metadata(?:\.html)?\/?$/i.test(location.pathname);
    const scriptPath=(()=>{try{return new URL(document.currentScript?.src||'./canonical-auto-sync-canary.js',location.href).pathname;}catch(_){return '';}})(),appRoot=scriptPath?scriptPath.replace(/\/[^/]*$/,'/'):'';
    const homePage=Boolean(appRoot)&&(location.pathname===appRoot||location.pathname===`${appRoot}index`||location.pathname===`${appRoot}index.html`);
    const defaultForegroundReceiver=(homePage||reviewPage||studyPage||progressPage||studyHubPage||deckBrowserPage||learningMetadataPage)&&!receiverDisabled;
    state.defaultReceiverEnabled=defaultForegroundReceiver;
    state.pendingOutboxRecoveryEnabled=!recoveryDisabled;
    state.pageKind=homePage?'home':reviewPage?'review':studyPage?'study':progressPage?'progress':studyHubPage?'study-hub':deckBrowserPage?'deck-browser':learningMetadataPage?'learning-metadata':'';
    state.auditEnabled=audit||explicitReceiver;
    state.lastReceipt=readLastReceipt();
    if(state.auditEnabled){makePanel();if(state.lastReceipt)setStatus('AUDIT · Last Sync receipt available.',true,'A new receiver check will still run; if it is a no-op, Export Last Sync JSON keeps the preceding material sync receipt.');}
    if(defaultForegroundReceiver){
      const trigger=homePage?'receiver-home-load-default':reviewPage?'receiver-review-load-default':studyPage?'receiver-study-load-default':progressPage?'receiver-progress-load-default':studyHubPage?'receiver-study-hub-load-default':deckBrowserPage?'receiver-deck-browser-load-default':'receiver-learning-metadata-load-default';
      requestDefaultReceiver(trigger,{delay:150,markNow:true});
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')onForegroundResume();});
      window.addEventListener('focus',onForegroundResume);
    }else if(explicitReceiver){
      setTimeout(()=>{void runSync({trigger:'receiver-page-load-canary',receiverOnly:true});},150);
    }
  }
  const publicApi=Object.freeze({version:4,pairEventTypes:[...PAIR_EVENT_TYPES],eventOnlyTypes:[...EVENT_ONLY_TYPES,'activity:event:study-encounter','interaction:event:card-study','standard:event','standard:rating_correction','ai:event'],singleRowTypes:['standard:learning_sessions:insert','card_learning_metadata:upsert','learning_situations:upsert'],runSync,getReport:()=>clone(state.report),getLastReceipt:()=>clone(state.lastReceipt)});
  window.WLPCanonicalForegroundSync=publicApi;
  window.WLPCanonicalAutoSyncCanary=publicApi;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
