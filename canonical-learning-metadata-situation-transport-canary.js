/* WLP v1.8.6.339 — Canonical presence read-only audit for pending iPhone sync_outbox row.
   Query-gated only: ?wlpLearningMetadataSituationTransportCanary=1
   Stages one byte-exact existing WID5578 learning_situations payload.
   This is a transport-only proof: no Learning Metadata semantic/lineage change. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.339-iphone-outbox-canonical-presence-read-only-audit-v1';
  const FLAG='wlpLearningMetadataSituationTransportCanary';
  const TARGET_WID='5578';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',SITUATION_STORE='learning_situations';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_DB_VERSION=1,SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const CHANGE_TABLE='wlp_sync_changes_v1',MUTATION_TABLE='wlp_sync_mutations_v1',ACK_TABLE='wlp_sync_action_acknowledgements_v1';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={panel:null,status:null,detail:null,button:null,active:null,report:null,busy:false};

  const clean=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v??'')));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const enabled=()=>new URLSearchParams(location.search).get(FLAG)==='1';

  function makePanel(){
    if(state.panel||!enabled())return;
    const p=document.createElement('section');p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100013;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:13px">Learning Metadata · Situation-row Canonical transport canary</strong><div data-status style="margin-top:4px">Preparing…</div><div data-detail style="margin-top:7px;font-size:12px;opacity:.84;white-space:pre-line"></div><button type="button" data-stage style="margin-top:9px;padding:8px 12px;border:1px solid #b8c8bc;border-radius:10px;background:#f7faf7;color:#21362a;font:inherit">Stage exact WID5578 Situation row</button>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('[data-status]');state.detail=p.querySelector('[data-detail]');state.button=p.querySelector('[data-stage]');state.button.disabled=true;state.button.addEventListener('click',()=>{void stage();});
  }
  function show(text,ok=null,detail=''){makePanel();if(!state.status)return;state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,SITUATION_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  function outboxSummary(row,index){
    const payload=row?.payload||{},legacy=payload?.payload||{};
    const parts=[
      `Outbox ${index+1}`,
      `table ${clean(row?.tableName)||'—'} · ${clean(row?.mutationKind)||'—'} · status ${clean(row?.status)||'—'}`,
      `transportEligible ${row?.transportEligible===true?'yes':'no'} · diagnosticOnly ${row?.diagnosticOnly===true?'yes':'no'} · candidateOnly ${row?.candidateOnly===true?'yes':'no'}`,
      `created ${clean(row?.createdAt)||'—'}`,
      `rowKey ${clean(row?.rowKey)||'—'}`,
      `actionId ${clean(row?.actionId)||'—'}`,
      `mutationId ${clean(row?.mutationId)||'—'}`
    ];
    if(clean(row?.tableName)==='learning_events')parts.push(`event ${clean(payload?.source_stream)||'—'}:${clean(payload?.event_type)||'—'} · WID${clean(payload?.legacy_word_id)||'—'} · source ${clean(payload?.source_event_id)||'—'}`);
    if(clean(row?.tableName)==='learning_sessions')parts.push(`session ${clean(payload?.session_type)||'—'} · source ${clean(payload?.source_session_id)||'—'} · ${clean(payload?.status)||'—'}`);
    if(clean(row?.tableName)==='learning_state')parts.push(`state review ${payload?.review===true?'yes':'no'} · level ${clean(payload?.review_level)||'—'} · known ${payload?.known===true?'yes':'no'}`);
    if(clean(row?.tableName)==='card_learning_metadata')parts.push(`metadata ${clean(payload?.metadata_id)||'—'} · revision ${Number(payload?.revision||0)||0}`);
    if(clean(row?.tableName)==='learning_situations')parts.push(`situation ${clean(payload?.source_situation_id)||'—'} · revision ${Number(payload?.revision||0)||0}`);
    if(clean(row?.tableName)==='learning_events'&&clean(legacy?.action))parts.push(`legacy action ${clean(legacy.action)} · source ${clean(legacy.source)||'—'}`);
    return parts.join('\n');
  }
  function openShadowDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(SHADOW_DB,SHADOW_DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('Supabase Shadow configuration database is not installed.'));return;}if(!db.objectStoreNames.contains(SHADOW_META)){db.close();rej(new Error('Supabase Shadow metadata store is missing.'));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open Supabase Shadow metadata.'));});}
  async function shadowGetReadOnly(key){const db=await openShadowDb();try{const tx=db.transaction(SHADOW_META,'readonly'),v=await req(tx.objectStore(SHADOW_META).get(key));await txDone(tx);return v||null;}finally{db.close();}}
  async function refreshAccessToken(config,saved){const headers={'Content-Type':'application/json',apikey:config.publishableKey};const response=await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers,body:JSON.stringify({refresh_token:saved.refreshToken})}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`Supabase Auth refresh failed (${response.status}).`);if(!data?.access_token)throw new Error('Supabase Auth refresh returned no access token.');return data.access_token;}
  async function cloudReadOnlyContext(){
    const config=await shadowGetReadOnly(CONFIG_KEY),saved=await shadowGetReadOnly(SESSION_KEY);if(!config?.url||!config?.publishableKey)throw new Error('Supabase configuration is missing.');if(!saved?.accessToken||!saved?.refreshToken||!saved?.userId)throw new Error('Saved Supabase session is missing.');let accessToken=saved.accessToken;
    async function request(path,allowRefresh=true){const headers={apikey:config.publishableKey,Authorization:`Bearer ${accessToken}`};const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/rest/v1/${path}`,{method:'GET',headers}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(response.status===401&&allowRefresh){accessToken=await refreshAccessToken(config,saved);return request(path,false);}if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||`Supabase read-only lookup failed (${response.status}).`);return Array.isArray(data)?data:[];}
    return{request};
  }
  async function canonicalOutboxAudit(outbox){
    const a=await cloudReadOnlyContext(),results=[];
    for(const row of outbox){
      const tableName=clean(row?.tableName),rowKey=clean(row?.rowKey),actionId=clean(row?.actionId),mutationId=clean(row?.mutationId),payloadHash=clean(row?.payloadHash);
      if(!tableName||!rowKey||!actionId||!mutationId){results.push({state:'check',message:'Outbox identity is incomplete.',rowKey,actionId,mutationId});continue;}
      const selectChange='change_seq,table_name,row_key,operation,mutation_id,action_id,device_key,payload_hash,tombstone,server_at';
      const byAction=await a.request(`${CHANGE_TABLE}?select=${encodeURIComponent(selectChange)}&action_id=eq.${encodeURIComponent(actionId)}&order=change_seq.asc`);
      const byRow=await a.request(`${CHANGE_TABLE}?select=${encodeURIComponent(selectChange)}&table_name=eq.${encodeURIComponent(tableName)}&row_key=eq.${encodeURIComponent(rowKey)}&order=change_seq.asc`);
      const mutations=await a.request(`${MUTATION_TABLE}?select=${encodeURIComponent('mutation_id,device_key,action_id,table_name,row_key,status,result,received_at,applied_at')}&mutation_id=eq.${encodeURIComponent(mutationId)}`);
      const acks=await a.request(`${ACK_TABLE}?select=${encodeURIComponent('action_id,device_key,candidate_key,head_version,mutation_ids,status,acknowledged_at,result')}&action_id=eq.${encodeURIComponent(actionId)}`);
      const exactChange=byAction.find(x=>clean(x?.table_name)===tableName&&clean(x?.row_key)===rowKey&&clean(x?.mutation_id)===mutationId&&clean(x?.action_id)===actionId)||null;
      const exactMutation=mutations.find(x=>clean(x?.mutation_id)===mutationId&&clean(x?.table_name)===tableName&&clean(x?.row_key)===rowKey&&clean(x?.action_id)===actionId)||null;
      const exactAck=acks.find(x=>clean(x?.action_id)===actionId)||null;
      const mutationIds=Array.isArray(exactAck?.mutation_ids)?exactAck.mutation_ids.map(clean):[];
      const hashMatch=Boolean(exactChange&&clean(exactChange.payload_hash)===payloadHash),mutationApplied=clean(exactMutation?.status)==='applied',ackApplied=clean(exactAck?.status)==='applied'&&mutationIds.includes(mutationId),present=Boolean(exactChange&&hashMatch&&mutationApplied&&ackApplied);
      const absent=byAction.length===0&&byRow.length===0&&mutations.length===0&&acks.length===0;
      results.push({state:present?'present':absent?'absent':'check',tableName,rowKey,actionId,mutationId,payloadHash,byActionCount:byAction.length,byRowCount:byRow.length,mutationCount:mutations.length,ackCount:acks.length,changeSeq:exactChange?.change_seq??null,serverAt:clean(exactChange?.server_at),hashMatch,mutationApplied,ackApplied,exactChange:clone(exactChange),exactMutation:clone(exactMutation),exactAck:clone(exactAck)});
    }
    return results;
  }
  function canonicalAuditSummary(results){
    return results.map((r,index)=>{
      if(r.state==='present')return `Canonical ${index+1} · PRESENT\nchangeSeq ${r.changeSeq} · server ${r.serverAt||'—'}\npayload hash match yes · mutation applied yes · ack applied yes\nConclusion: server apply completed; this local outbox row is stale/un-cleared.`;
      if(r.state==='absent')return `Canonical ${index+1} · NOT FOUND\nchange rows 0 · mutation rows 0 · ack rows 0\nConclusion: this outbox row is genuinely unsent; do not delete it.`;
      return `Canonical ${index+1} · CHECK\naction changes ${r.byActionCount??0} · row changes ${r.byRowCount??0} · mutations ${r.mutationCount??0} · acks ${r.ackCount??0}\nhash match ${r.hashMatch?'yes':'no'} · mutation applied ${r.mutationApplied?'yes':'no'} · ack applied ${r.ackApplied?'yes':'no'}\nConclusion: remote evidence is partial or mismatched; do not delete or retry yet.`;
    }).join('\n\n');
  }
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  async function prepare(){
    if(!enabled())return;makePanel();let db=null;
    try{
      db=await openDb();const [meta,outbox,cards,situations]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE),getAll(db,CARD_STORE),getAll(db,SITUATION_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Situation transport canary requires ACTIVE Authority v3.');
      if(outbox.length){
        const summaries=outbox.map(outboxSummary);state.button.disabled=true;
        show(`BLOCKED · sync_outbox must start empty; found ${outbox.length}.`,false,`READ-ONLY OUTBOX AUDIT — no WLP data was changed or sent.\n\n${summaries.join('\n\n')}\n\nCanonical presence lookup running…`);
        let canonicalAudit=null,canonicalAuditError='';
        try{canonicalAudit=await canonicalOutboxAudit(outbox);}catch(error){canonicalAuditError=String(error?.message||error);}
        const canonicalDetail=canonicalAudit?canonicalAuditSummary(canonicalAudit):`Canonical lookup · CHECK\n${canonicalAuditError||'Read-only Canonical lookup could not complete.'}\nConclusion: keep the outbox row unchanged.`;
        state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked-outbox-canonical-read-only',summary:{outbox:outbox.length,canonicalStates:Array.isArray(canonicalAudit)?canonicalAudit.map(x=>x.state):[],blockingIssues:1,pass:false},outboxAudit:clone(outbox),canonicalReadOnlyAudit:clone(canonicalAudit),canonicalAuditError,invariants:{readOnlyOutboxAudit:true,canonicalLookupGetOnly:true,noOutboxWrite:true,noCanonicalDataWrite:true,noSyncDispatch:true}};
        show(`BLOCKED · sync_outbox must start empty; found ${outbox.length}.`,false,`READ-ONLY OUTBOX + CANONICAL AUDIT — no WLP data was changed or sent.\n\n${summaries.join('\n\n')}\n\n${canonicalDetail}`);
        return;
      }
      const card=cards.find(w=>clean(w?.payload?.legacy_key)===`wid:${TARGET_WID}`);if(!card)throw new Error(`Canonical card for WID${TARGET_WID} is missing.`);
      const cardId=clean(card.rowKey||card?.payload?.card_id);
      const row=situations.map(w=>({wrapper:w,payload:w?.payload||{}})).filter(x=>clean(x.payload.card_id)===cardId&&!clean(x.payload.deleted_at)).sort((a,b)=>(Number(a.payload.ordinal)||0)-(Number(b.payload.ordinal)||0))[0];
      if(!row)throw new Error(`WID${TARGET_WID} has no active Canonical Situation row.`);
      const rowKey=clean(row.wrapper.rowKey),payload=clone(row.payload),payloadHash=clean(row.wrapper.payloadHash)||await sha256(stableStringify(payload));
      if(clean(payload.situation_id)!==rowKey)throw new Error('Canonical Situation rowKey does not match payload.situation_id.');
      if(!clean(payload.source_situation_id)||!clean(payload.version_id)||Number(payload.revision||0)<1)throw new Error('Canonical Situation lineage is incomplete.');
      const cursor=await cursorValue(db,meta);
      state.active={phase:'ready',rowKey,payload,payloadHash,cursor,cardId,sourceSituationId:clean(payload.source_situation_id)};
      state.button.disabled=false;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'ready',summary:{wordId:TARGET_WID,rowKey,cursor,outbox:0,blockingIssues:0,pass:true},invariants:{exactExistingPayload:true,noSemanticChange:true,noLineageChange:true}};
      show(`READY · WID${TARGET_WID} Situation-row transport canary is safe to stage.`,true,`cursor ${cursor} · outbox 0\nSituation ${state.active.sourceSituationId}\nexact payload hash ${payloadHash.slice(0,14)}…\nNo Learning Metadata content or lineage will be changed.`);
    }catch(e){state.button.disabled=true;state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No outbox row was staged.');}
    finally{try{db?.close();}catch(_){}}
  }

  async function stage(){
    if(state.busy||state.active?.phase!=='ready')return;state.busy=true;state.button.disabled=true;let db=null;
    try{
      db=await openDb();const [meta,outbox,current]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE),getRow(db,SITUATION_STORE,state.active.rowKey)]);
      if(outbox.length)throw new Error(`sync_outbox must still be empty; found ${outbox.length}.`);
      const currentHash=clean(current?.payloadHash)||await sha256(stableStringify(current?.payload||{}));if(currentHash!==state.active.payloadHash)throw new Error('Situation row changed after READY; stale canary was blocked.');
      const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalLearningMetadataSituationTransportCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:'learning_situations',rowKey:state.active.rowKey,precondition:{payloadHash:state.active.payloadHash},changedFields:[],payload:clone(state.active.payload),payloadHash:state.active.payloadHash};mutation.mutationHash=await sha256(stableStringify(mutation));
      await addOutbox(db,mutation);state.active={...state.active,phase:'pending',actionId,mutationId};
      show(`PENDING · Exact WID${TARGET_WID} Situation row staged.`,true,`cursor ${state.active.cursor} · outbox 0 → 1 · foreground sync will auto-push\nPayload is byte/semantic identical to the current Canonical Situation row.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'learning-metadata-situation-canary',tableName:'learning_situations',mutationKind:'upsert',actionId,mutationCount:1}}));
    }catch(e){state.active={...state.active,phase:'blocked'};state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:'blocked',error:String(e?.message||e),summary:{blockingIssues:1,pass:false}};show(`BLOCKED · ${String(e?.message||e)}`,false,'No second write should be staged.');}
    finally{state.busy=false;try{db?.close();}catch(_){}}
  }

  async function verify(event){
    if(state.active?.phase!=='pending')return;const d=event?.detail||{};if(clean(d.actionId)&&clean(d.actionId)!==state.active.actionId)return;
    if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The outbox row is intentionally retained for retry. Do not press the button again.');return;}
    let db=null;try{
      db=await openDb();const [outbox,row,meta]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,SITUATION_STORE,state.active.rowKey),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),pass=outbox.length===0&&clean(row?.payloadHash)===state.active.payloadHash&&cursorAfter>state.active.cursor;
      state.report={format:'WLP_LEARNING_METADATA_SITUATION_TRANSPORT_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),phase:pass?'pass':'check',summary:{wordId:TARGET_WID,rowKey:state.active.rowKey,cursorBefore:state.active.cursor,cursorAfter,outboxAfter:outbox.length,blockingIssues:pass?0:1,pass},invariants:{exactPayloadPreserved:clean(row?.payloadHash)===state.active.payloadHash,noSemanticChange:true,noLineageChange:true}};
      show(pass?`PASS · WID${TARGET_WID} Situation row reached Canonical.`:'CHECK · Situation-row transport verification is incomplete.',pass,`cursor ${state.active.cursor} → ${cursorAfter} · outbox ${outbox.length}\nexact payload preserved ${clean(row?.payloadHash)===state.active.payloadHash?'yes':'no'} · semantic/lineage change 0`);
      if(pass)state.active={...state.active,phase:'pass'};
    }catch(e){show(`CHECK · ${String(e?.message||e)}`,false,'Transport may have completed, but local verification failed.');}finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',e=>{void verify(e);});
  window.WLPCanonicalLearningMetadataSituationTransportCanary=Object.freeze({version:1,prepare,getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void prepare();},{once:true});else void prepare();
})();
