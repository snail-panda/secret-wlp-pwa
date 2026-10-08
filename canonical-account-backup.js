/* WLP v1.8.6.402 — Canonical Safety Archive export + proven Restore execution layer.
   Adds a read-only external ZIP archive containing the effective account snapshot,
   ACTIVE Authority base, raw sync history, mutation/ACK/conflict ledgers, and restore audit.
   Restore behavior remains the proven v400/v401 path; no restore semantics change here. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.402-canonical-safety-archive-v1';
  const FORMAT='WLP_CANONICAL_ACCOUNT_BACKUP',VERSION=1;
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const RESTORE_TABLE='wlp_account_restore_points_v1';
  const RESTORE_RPC='wlp_create_account_restore_point_v1';
  const EXECUTE_RESTORE_RPC='wlp_execute_account_restore_point_v1';
  const AUTHORITY_HEAD='wlp_canonical_authority_heads';
  const AUTHORITY_RECORDS='wlp_canonical_authority_candidate_records';
  const CHANGE_TABLE='wlp_sync_changes_v1';
  const MUTATION_TABLE='wlp_sync_mutations_v1';
  const ACK_TABLE='wlp_sync_action_acknowledgements_v1';
  const RECEIPT_TABLE='wlp_sync_mutation_receipts_v1';
  const CONFLICT_TABLE='wlp_sync_conflicts_v1';
  const RESTORE_RUN_TABLE='wlp_account_restore_runs_v1';
  const $=id=>document.getElementById(id);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const state={restorePoints:[],preview:null,executing:false};

  function stableValue(value){
    if(Array.isArray(value))return value.map(stableValue);
    if(value&&typeof value==='object'){
      const out={};
      Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});
      return out;
    }
    return value;
  }
  const stableStringify=value=>JSON.stringify(stableValue(value));
  async function sha256(text){
    const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));
    return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function identity(tableName,rowKey){return `${String(tableName||'')}\u0000${String(rowKey||'')}`;}
  function pad(n){return String(n).padStart(2,'0');}
  function stamp(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;}
  function formatDate(value){
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return'—';
    try{return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d);}catch{return d.toLocaleString();}
  }
  function downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function downloadJson(data,filename){downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),filename);}
  function jsonText(value){return `${JSON.stringify(value,null,2)}\n`;}
  function u16(value){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,value,true);return a;}
  function u32(value){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,value>>>0,true);return a;}
  const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}return table;})();
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
  function zipDosDateTime(date){const d=date instanceof Date?date:new Date(date);const year=Math.max(1980,d.getFullYear());return{time:((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31),date:(((year-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31)};}
  function buildStoreZip(entries,createdAt=new Date()){
    const encoder=new TextEncoder(),locals=[],centrals=[];let offset=0;const dt=zipDosDateTime(createdAt);
    for(const entry of entries){
      const nameBytes=encoder.encode(String(entry.name)),dataBytes=entry.bytes instanceof Uint8Array?entry.bytes:encoder.encode(String(entry.text??'')),crc=crc32(dataBytes),flags=0x0800;
      const local=new Blob([u32(0x04034b50),u16(20),u16(flags),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(dataBytes.length),u32(dataBytes.length),u16(nameBytes.length),u16(0),nameBytes,dataBytes]);
      locals.push(local);
      const central=new Blob([u32(0x02014b50),u16(20),u16(20),u16(flags),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(dataBytes.length),u32(dataBytes.length),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBytes]);
      centrals.push(central);offset+=local.size;
    }
    const centralOffset=offset,centralSize=centrals.reduce((sum,b)=>sum+b.size,0),end=new Blob([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(centralSize),u32(centralOffset),u16(0)]);
    return new Blob([...locals,...centrals,end],{type:'application/zip'});
  }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  function setStatus(text,tone=''){
    const node=$('canonical-account-status');
    if(!node)return;
    node.hidden=false;node.textContent=text;node.dataset.tone=tone;
  }
  function setBusy(busy){
    ['canonical-account-export','canonical-account-archive','canonical-restore-create','canonical-account-refresh','canonical-restore-file-choose'].forEach(id=>{const b=$(id);if(b)b.disabled=Boolean(busy);});
    const confirm=$('canonical-restore-confirm-input');if(confirm)confirm.disabled=Boolean(busy);
    document.querySelectorAll('.canonical-restore-preview-button').forEach(b=>{b.disabled=Boolean(busy);});
    updateExecutionButton();
  }

  function openShadowDb(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(SHADOW_DB,1);let created=false;
      request.onupgradeneeded=()=>{created=true;try{request.transaction.abort();}catch(_){}};
      request.onsuccess=()=>{if(created){request.result.close();reject(new Error('WLP Cloud session is not initialized on this browser.'));return;}resolve(request.result);};
      request.onerror=()=>reject(request.error||new Error('Could not open WLP Cloud session storage.'));
      request.onblocked=()=>reject(new Error('WLP Cloud session storage is blocked by another tab.'));
    });
  }
  function idbGet(db,key){return new Promise((resolve,reject)=>{const tx=db.transaction(SHADOW_META,'readonly'),req=tx.objectStore(SHADOW_META).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
  function idbPut(db,value){return new Promise((resolve,reject)=>{const tx=db.transaction(SHADOW_META,'readwrite');tx.objectStore(SHADOW_META).put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Could not refresh WLP Cloud session.'));});}

  async function cloudContext(){
    const db=await openShadowDb();
    let config,session;
    try{config=await idbGet(db,CONFIG_KEY);session=await idbGet(db,SESSION_KEY);}finally{db.close();}
    if(!config?.url||!config?.publishableKey)throw new Error('WLP Cloud configuration is missing on this browser. Open Cloud Shadow once and save the Supabase connection.');
    if(!session?.accessToken||!session?.refreshToken||!session?.userId)throw new Error('No WLP Cloud account session is available on this browser. Sign in to Supabase through WLP first.');

    async function authRefresh(){
      const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey},body:JSON.stringify({refresh_token:session.refreshToken})});
      const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}
      if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`WLP Cloud session refresh failed (${response.status}).`);
      session={...session,accessToken:data.access_token,refreshToken:data.refresh_token||session.refreshToken,userId:data.user?.id||session.userId,email:data.user?.email||session.email,expiresAt:Date.now()+Math.max(60,Number(data.expires_in||3600))*1000,savedAt:new Date().toISOString()};
      const refreshDb=await openShadowDb();try{await idbPut(refreshDb,{...session,key:SESSION_KEY});}finally{refreshDb.close();}
    }
    if(Number(session.expiresAt||0)<=Date.now()+60000)await authRefresh();

    async function rest(path,options={}){
      const headers={apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`,...(options.headers||{})};
      if(options.body!=null)headers['Content-Type']='application/json';
      const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/rest/v1/${path}`,{method:options.method||'GET',headers,body:options.body==null?undefined:JSON.stringify(options.body)}),text=await response.text();let data=null;
      try{data=text?JSON.parse(text):null;}catch{data=text;}
      if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||`Supabase Data API request failed (${response.status}).`);
      return{data,response};
    }
    async function fetchPaged(table,select,extra=''){
      const size=1000,out=[];
      for(let from=0;;from+=size){
        const to=from+size-1,suffix=extra?`&${extra}`:'',r=await rest(`${table}?select=${encodeURIComponent(select)}${suffix}`,{headers:{Range:`${from}-${to}`,Prefer:'count=exact'}}),rows=Array.isArray(r.data)?r.data:[];
        out.push(...rows);
        if(rows.length<size)break;
        const total=Number((r.response.headers.get('content-range')||'').split('/')[1]);
        if(Number.isFinite(total)&&out.length>=total)break;
      }
      return out;
    }
    return{config,session,rest,fetchPaged};
  }

  async function fetchHead(api){
    const rows=await api.fetchPaged(AUTHORITY_HEAD,'candidate_key,head_version,snapshot_manifest_hash,canonical_row_count,migration_version,promoted_at','order=promoted_at.desc');
    if(rows.length!==1)throw new Error(`Canonical Account Safety expected one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }
  async function fetchHighWater(api,head){
    const r=await api.rest(`${CHANGE_TABLE}?select=change_seq&candidate_key=eq.${encodeURIComponent(head.candidate_key)}&head_version=eq.${encodeURIComponent(head.head_version)}&order=change_seq.desc&limit=1`),rows=Array.isArray(r.data)?r.data:[];
    return Number(rows[0]?.change_seq||0);
  }
  async function fetchRestorePoints(api,limit=8){
    try{return await api.fetchPaged(RESTORE_TABLE,'restore_point_id,label,candidate_key,head_version,snapshot_manifest_hash,authority_row_count,change_seq_high_water,overlay_change_count,restore_point_hash,created_by_device,created_at',`order=created_at.desc&limit=${Math.max(1,Math.min(20,Number(limit)||8))}`);}catch(error){if(String(error?.message||'').toLowerCase().includes('does not exist'))return[];throw error;}
  }

  function headMatches(left,right){
    return String(left?.candidate_key??left?.candidateKey??'')===String(right?.candidate_key??right?.candidateKey??'')&&
      Number(left?.head_version??left?.headVersion??0)===Number(right?.head_version??right?.headVersion??0)&&
      String(left?.snapshot_manifest_hash??left?.snapshotManifestHash??'')===String(right?.snapshot_manifest_hash??right?.snapshotManifestHash??'');
  }

  async function verifyPayloadBytes(payload,payloadHash,label){
    if(payload==null)return;
    if(!payloadHash)throw new Error(`${label} has payload bytes but no payload hash.`);
    const computed=await sha256(stableStringify(payload));
    if(computed!==String(payloadHash))throw new Error(`${label} payload hash mismatch.`);
  }

  async function fetchCanonicalDataset(api,head,highWater){
    setStatus('Reading ACTIVE Authority and Canonical change history…','working');
    const [baseRows,changeRows]=await Promise.all([
      api.fetchPaged(AUTHORITY_RECORDS,'table_name,row_key,payload_hash,payload,tombstone',`candidate_key=eq.${encodeURIComponent(head.candidate_key)}&order=table_name.asc,row_key.asc`),
      highWater?api.fetchPaged(CHANGE_TABLE,'change_seq,table_name,row_key,operation,payload_hash,payload,tombstone,server_at,action_id,mutation_id,device_key',`candidate_key=eq.${encodeURIComponent(head.candidate_key)}&head_version=eq.${encodeURIComponent(head.head_version)}&change_seq=lte.${highWater}&order=change_seq.asc`):Promise.resolve([])
    ]);
    if(baseRows.length!==Number(head.canonical_row_count||0))throw new Error(`Canonical Authority base count mismatch: expected ${Number(head.canonical_row_count||0)}, read ${baseRows.length}.`);
    let checked=0;
    for(const row of baseRows){
      await verifyPayloadBytes(row.payload,String(row.payload_hash||''),`Authority ${String(row.table_name||'')}/${String(row.row_key||'')}`);
      checked+=1;if(checked%1500===0)setStatus(`Checking Canonical payload integrity… ${checked.toLocaleString()} rows`,'working');
    }
    for(const row of changeRows){
      if(row.payload!=null)await verifyPayloadBytes(row.payload,String(row.payload_hash||''),`Change ${Number(row.change_seq||0)} ${String(row.table_name||'')}/${String(row.row_key||'')}`);
      checked+=1;if(checked%1500===0)setStatus(`Checking Canonical payload integrity… ${checked.toLocaleString()} rows`,'working');
    }
    return{baseRows,changeRows};
  }

  async function materializeRecords(baseRows,changeRows,maxChangeSeq,label='Canonical state'){
    const map=new Map();
    for(const row of baseRows){
      const tableName=String(row.table_name||''),rowKey=String(row.row_key||'');if(!tableName||!rowKey)continue;
      map.set(identity(tableName,rowKey),{tableName,rowKey,payloadHash:String(row.payload_hash||''),payload:clone(row.payload),tombstone:Boolean(row.tombstone),source:'authority',lastChangeSeq:null,lastOperation:'bootstrap',lastServerAt:null});
    }
    let overlayChangeRows=0;
    for(const row of changeRows){
      const changeSeq=Number(row.change_seq||0);if(changeSeq>Number(maxChangeSeq||0))break;
      const tableName=String(row.table_name||''),rowKey=String(row.row_key||'');if(!tableName||!rowKey)continue;
      overlayChangeRows+=1;
      const key=identity(tableName,rowKey),payloadHash=String(row.payload_hash||''),tombstone=Boolean(row.tombstone),prior=map.get(key)||null;
      let payload=clone(row.payload);
      if(!tombstone&&payload==null){
        if(!payloadHash)throw new Error(`${label} blocked: active sparse change ${tableName}/${rowKey} has no payload hash.`);
        if(!prior||prior.payload==null)throw new Error(`${label} blocked: active sparse change ${tableName}/${rowKey} has no prior payload to recover.`);
        if(String(prior.payloadHash||'')!==payloadHash)throw new Error(`${label} blocked: active sparse change ${tableName}/${rowKey} payload hash does not match the prior effective payload.`);
        payload=clone(prior.payload);
      }
      map.set(key,{tableName,rowKey,payloadHash,payload,tombstone,source:'change',lastChangeSeq:changeSeq,lastOperation:String(row.operation||''),lastServerAt:row.server_at||null});
    }
    const records=[...map.values()].sort((a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey));
    const tableCounts={};let activeCount=0,tombstoneCount=0;
    for(const row of records){
      if(!row.tombstone&&row.payload==null)throw new Error(`${label} blocked: active record ${row.tableName}/${row.rowKey} has no payload.`);
      const block=tableCounts[row.tableName]||(tableCounts[row.tableName]={total:0,active:0,tombstone:0});
      block.total+=1;
      if(row.tombstone){block.tombstone+=1;tombstoneCount+=1;}else{block.active+=1;activeCount+=1;}
    }
    const manifestRows=records.map(row=>({tableName:row.tableName,rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:row.tombstone}));
    const manifestHash=await sha256(stableStringify(manifestRows));
    return{records,map,recordCount:records.length,activeCount,tombstoneCount,overlayChangeRows,tableCounts,manifestHash,highWaterChangeSeq:Number(maxChangeSeq||0)};
  }

  async function readCurrentCanonical(api){
    const head=await fetchHead(api),highWater=await fetchHighWater(api,head),dataset=await fetchCanonicalDataset(api,head,highWater),current=await materializeRecords(dataset.baseRows,dataset.changeRows,highWater,'Current Canonical state');
    const headCheck=await fetchHead(api);
    if(!headMatches(headCheck,head))throw new Error('ACTIVE Authority Head changed while reading current Canonical state. Retry.');
    return{head,highWater,dataset,current};
  }

  function canonicalSnapshotObject(api,head,highWater,current,restorePoints,exportedAt=new Date().toISOString()){
    return{
      format:FORMAT,version:VERSION,appVersion:APP_VERSION,exportedAt,
      account:{userId:String(api.session.userId||''),email:String(api.session.email||'')},
      authority:{candidateKey:String(head.candidate_key),headVersion:Number(head.head_version),snapshotManifestHash:String(head.snapshot_manifest_hash),canonicalRowCount:Number(head.canonical_row_count||0),migrationVersion:head.migration_version??null,promotedAt:head.promoted_at||null},
      highWaterChangeSeq:highWater,
      summary:{recordCount:current.recordCount,activeCount:current.activeCount,tombstoneCount:current.tombstoneCount,overlayChangeRows:current.overlayChangeRows,tableCounts:current.tableCounts,manifestHash:current.manifestHash},
      restorePoints:(restorePoints||[]).map(clone),
      records:current.records
    };
  }

  async function buildCanonicalSnapshot(api){
    const {head,highWater,current}=await readCurrentCanonical(api),restorePoints=await fetchRestorePoints(api,20);
    return canonicalSnapshotObject(api,head,highWater,current,restorePoints);
  }

  async function verifyRawChangePayloads(rows){
    let checked=0;
    for(const row of rows){
      if(row?.payload!=null)await verifyPayloadBytes(row.payload,String(row.payload_hash||''),`Raw change ${Number(row.change_seq||0)} ${String(row.table_name||'')}/${String(row.row_key||'')}`);
      checked+=1;if(checked%500===0)setStatus(`Checking raw Canonical change payloads… ${checked.toLocaleString()} / ${rows.length.toLocaleString()}`,'working');
    }
  }

  function projectRows(rows,fields){return (rows||[]).map(row=>{const out={};for(const field of fields)out[field]=row?.[field]??null;return out;});}
  async function fingerprint(value){return sha256(stableStringify(value));}
  async function verifyArchiveBoundary(api,start,raw){
    const endHead=await fetchHead(api),endHigh=await fetchHighWater(api,endHead);
    if(!headMatches(start.head,endHead)||Number(endHigh)!==Number(start.highWater))throw new Error('Canonical Safety Archive blocked: ACTIVE Authority or change cursor moved during export. Retry when authoring/sync is idle.');
    const checks=[
      [MUTATION_TABLE,'mutation_id,status,result,received_at,applied_at','order=received_at.asc,mutation_id.asc',projectRows(raw.mutations,['mutation_id','status','result','received_at','applied_at'])],
      [ACK_TABLE,'action_id,status,result,acknowledged_at,mutation_ids','order=acknowledged_at.asc,action_id.asc',projectRows(raw.acknowledgements,['action_id','status','result','acknowledged_at','mutation_ids'])],
      [RECEIPT_TABLE,'mutation_id,status,mutation_hash,received_at','order=received_at.asc,mutation_id.asc',projectRows(raw.receipts,['mutation_id','status','mutation_hash','received_at'])],
      [CONFLICT_TABLE,'conflict_id,status,resolution_value,detected_at,resolved_at','order=detected_at.asc,conflict_id.asc',projectRows(raw.conflicts,['conflict_id','status','resolution_value','detected_at','resolved_at'])],
      [RESTORE_TABLE,'restore_point_id,restore_point_hash,change_seq_high_water,created_at','order=created_at.asc,restore_point_id.asc',projectRows(raw.restorePoints,['restore_point_id','restore_point_hash','change_seq_high_water','created_at'])],
      [RESTORE_RUN_TABLE,'restore_run_id,status,planned_action_count,applied_action_count,post_change_seq,created_at,completed_at','order=created_at.asc,restore_run_id.asc',projectRows(raw.restoreRuns,['restore_run_id','status','planned_action_count','applied_action_count','post_change_seq','created_at','completed_at'])]
    ];
    for(const [table,select,extra,before] of checks){
      const after=await api.fetchPaged(table,select,extra);
      if(await fingerprint(before)!==await fingerprint(after))throw new Error(`Canonical Safety Archive blocked: ${table} changed during export. Retry when Canonical activity is idle.`);
    }
  }

  async function buildSafetyArchive(api){
    setStatus('Building Canonical Safety Archive · fixing one account boundary…','working');
    const start=await readCurrentCanonical(api),exportedAt=new Date().toISOString();
    const [restorePoints,mutations,acknowledgements,receipts,conflicts,restoreRuns,rawChanges]=await Promise.all([
      api.fetchPaged(RESTORE_TABLE,'*','order=created_at.asc,restore_point_id.asc'),
      api.fetchPaged(MUTATION_TABLE,'*','order=received_at.asc,mutation_id.asc'),
      api.fetchPaged(ACK_TABLE,'*','order=acknowledged_at.asc,action_id.asc'),
      api.fetchPaged(RECEIPT_TABLE,'*','order=received_at.asc,mutation_id.asc'),
      api.fetchPaged(CONFLICT_TABLE,'*','order=detected_at.asc,conflict_id.asc'),
      api.fetchPaged(RESTORE_RUN_TABLE,'*','order=created_at.asc,restore_run_id.asc'),
      start.highWater?api.fetchPaged(CHANGE_TABLE,'*',`change_seq=lte.${start.highWater}&order=change_seq.asc`):Promise.resolve([])
    ]);
    await verifyRawChangePayloads(rawChanges);
    if(start.highWater&&Number(rawChanges.at(-1)?.change_seq||0)!==Number(start.highWater))throw new Error('Canonical Safety Archive blocked: raw change history does not reach the fixed high-water cursor.');
    const raw={restorePoints,mutations,acknowledgements,receipts,conflicts,restoreRuns,rawChanges};
    await verifyArchiveBoundary(api,start,raw);
    const effective=canonicalSnapshotObject(api,start.head,start.highWater,start.current,restorePoints,exportedAt);
    const files=[
      {name:'effective-account.json',text:jsonText(effective)},
      {name:'authority/active-head.json',text:jsonText(start.head)},
      {name:'authority/active-base-records.json',text:jsonText(start.dataset.baseRows)},
      {name:'history/sync-changes.json',text:jsonText(rawChanges)},
      {name:'history/sync-mutations.json',text:jsonText(mutations)},
      {name:'history/action-acknowledgements.json',text:jsonText(acknowledgements)},
      {name:'history/mutation-receipts.json',text:jsonText(receipts)},
      {name:'history/conflicts.json',text:jsonText(conflicts)},
      {name:'safety/restore-points.json',text:jsonText(restorePoints)},
      {name:'safety/restore-runs.json',text:jsonText(restoreRuns)}
    ];
    const schema={format:'WLP_CANONICAL_SAFETY_ARCHIVE',version:1,appVersion:APP_VERSION,semantics:{'effective-account.json':'Self-contained effective Canonical Account Backup v1, restorable through the existing preview/restore design.','authority/active-base-records.json':'Immutable ACTIVE Authority base rows at export boundary.','history/sync-changes.json':'Raw ordered Canonical change feed through the fixed high-water cursor.','history/sync-mutations.json':'Raw steady-state mutation ledger, including envelopes/results.','history/action-acknowledgements.json':'Raw action acknowledgement ledger.','history/mutation-receipts.json':'Historical quarantined mutation receipts used during the v3 cutover.','history/conflicts.json':'Raw conflict ledger.','safety/restore-points.json':'Cloud Restore Point checkpoints.','safety/restore-runs.json':'Durable Restore execution audit runs.'},restoreNote:'History files are audit/disaster-recovery material. Restore must append new restoring actions; historical rows are never deleted or rewritten.'};
    files.push({name:'schema.json',text:jsonText(schema)});
    const readme=`WLP Canonical Safety Archive v1\nExported: ${exportedAt}\nAuthority: ${start.head.candidate_key} / head ${start.head.head_version}\nFixed Canonical cursor: ${start.highWater}\nEffective records: ${start.current.recordCount}\nRaw changes: ${rawChanges.length}\nMutations: ${mutations.length}\nACKs: ${acknowledgements.length}\nConflicts: ${conflicts.length}\nRestore Points: ${restorePoints.length}\nRestore Runs: ${restoreRuns.length}\n\nThis ZIP intentionally contains no Supabase access/refresh token, API key, or browser session/config object.\nThe effective account snapshot is in effective-account.json. Raw history is retained for audit/disaster recovery.\nRestore history must remain append-only; do not erase historical Canonical rows.\n`;
    files.unshift({name:'README.txt',text:readme});
    const encoder=new TextEncoder(),manifestFiles=[];
    for(const file of files){const bytes=encoder.encode(file.text);file.bytes=bytes;manifestFiles.push({name:file.name,bytes:bytes.length,sha256:await sha256(file.text)});delete file.text;}
    const manifest={format:'WLP_CANONICAL_SAFETY_ARCHIVE',version:1,appVersion:APP_VERSION,exportedAt,account:{userId:String(api.session.userId||''),email:String(api.session.email||'')},authority:{candidateKey:String(start.head.candidate_key),headVersion:Number(start.head.head_version),snapshotManifestHash:String(start.head.snapshot_manifest_hash),canonicalRowCount:Number(start.head.canonical_row_count||0)},highWaterChangeSeq:Number(start.highWater),effectiveManifestHash:start.current.manifestHash,counts:{effectiveRecords:start.current.recordCount,authorityBaseRows:start.dataset.baseRows.length,rawChanges:rawChanges.length,mutations:mutations.length,acknowledgements:acknowledgements.length,mutationReceipts:receipts.length,conflicts:conflicts.length,restorePoints:restorePoints.length,restoreRuns:restoreRuns.length},security:{containsAuthTokens:false,containsSupabaseConfig:false,containsSessionSecrets:false},files:manifestFiles};
    const manifestText=jsonText(manifest),secretNeedles=['\"accessToken\":','\"refreshToken\":','\"access_token\":','\"refresh_token\":','\"publishableKey\":','\"apikey\":'];
    for(const file of files){const text=new TextDecoder().decode(file.bytes);for(const needle of secretNeedles){if(text.includes(needle))throw new Error(`Canonical Safety Archive blocked: secret-like key ${needle.replaceAll('\"','')} found in ${file.name}.`);}}
    files.unshift({name:'manifest.json',bytes:encoder.encode(manifestText)});
    return{blob:buildStoreZip(files,new Date(exportedAt)),manifest};
  }

  async function validateBackupFile(backup,api){
    if(!backup||typeof backup!=='object')throw new Error('Selected file is not a Canonical Account Backup object.');
    if(String(backup.format||'')!==FORMAT||Number(backup.version)!==VERSION)throw new Error('Selected file is not a supported WLP Canonical Account Backup v1 file.');
    if(String(backup.account?.userId||'')!==String(api.session.userId||''))throw new Error('Selected Canonical Account Backup belongs to a different WLP account.');
    if(!Array.isArray(backup.records)||!backup.records.length)throw new Error('Selected Canonical Account Backup contains no records.');
    const map=new Map(),records=[];let checked=0,activeCount=0,tombstoneCount=0;
    for(const raw of backup.records){
      const tableName=String(raw?.tableName||''),rowKey=String(raw?.rowKey||''),payloadHash=String(raw?.payloadHash||''),tombstone=Boolean(raw?.tombstone),payload=clone(raw?.payload);
      if(!tableName||!rowKey)throw new Error('Selected Canonical Account Backup contains a record without tableName/rowKey.');
      const key=identity(tableName,rowKey);if(map.has(key))throw new Error(`Selected Canonical Account Backup contains duplicate record ${tableName}/${rowKey}.`);
      if(!tombstone&&payload==null)throw new Error(`Selected Canonical Account Backup contains active record ${tableName}/${rowKey} without payload.`);
      if(payload!=null)await verifyPayloadBytes(payload,payloadHash,`Backup ${tableName}/${rowKey}`);
      const row={tableName,rowKey,payloadHash,payload,tombstone,source:String(raw?.source||'backup'),lastChangeSeq:raw?.lastChangeSeq==null?null:Number(raw.lastChangeSeq),lastOperation:String(raw?.lastOperation||''),lastServerAt:raw?.lastServerAt||null};
      map.set(key,row);records.push(row);if(tombstone)tombstoneCount+=1;else activeCount+=1;
      checked+=1;if(checked%1500===0)setStatus(`Checking selected backup integrity… ${checked.toLocaleString()} / ${backup.records.length.toLocaleString()} records`,'working');
    }
    records.sort((a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey));
    const manifestRows=records.map(row=>({tableName:row.tableName,rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:row.tombstone})),manifestHash=await sha256(stableStringify(manifestRows));
    if(String(backup.summary?.manifestHash||'')!==manifestHash)throw new Error('Selected Canonical Account Backup manifest hash does not match its records.');
    if(Number(backup.summary?.recordCount||0)!==records.length||Number(backup.summary?.activeCount||0)!==activeCount||Number(backup.summary?.tombstoneCount||0)!==tombstoneCount)throw new Error('Selected Canonical Account Backup summary counts do not match its records.');
    return{backup,records,map,recordCount:records.length,activeCount,tombstoneCount,manifestHash,highWaterChangeSeq:Number(backup.highWaterChangeSeq||0)};
  }

  function compareEffectiveStates(current,target){
    const keys=new Set([...current.map.keys(),...target.map.keys()]);
    const changes=[],byTable={};let unchanged=0,historyOnlyExtra=0;
    function bucket(table){return byTable[table]||(byTable[table]={create:0,update:0,resurrect:0,tombstone:0,unchanged:0,historyOnlyExtra:0,totalActions:0});}
    for(const key of keys){
      const cur=current.map.get(key)||null,tgt=target.map.get(key)||null,table=tgt?.tableName||cur?.tableName||'unknown',rowKey=tgt?.rowKey||cur?.rowKey||'',b=bucket(table);
      if(!cur&&tgt){
        const kind=tgt.tombstone?'history-only-target-tombstone':'create';
        if(kind==='create'){b.create+=1;b.totalActions+=1;changes.push({kind,tableName:table,rowKey,current:null,target:tgt});}else{b.historyOnlyExtra+=1;historyOnlyExtra+=1;}
        continue;
      }
      if(cur&&!tgt){
        if(cur.tombstone){b.historyOnlyExtra+=1;historyOnlyExtra+=1;}else{b.tombstone+=1;b.totalActions+=1;changes.push({kind:'tombstone',tableName:table,rowKey,current:cur,target:null});}
        continue;
      }
      const exact=Boolean(cur&&tgt&&cur.tombstone===tgt.tombstone&&String(cur.payloadHash||'')===String(tgt.payloadHash||''));
      if(exact){unchanged+=1;b.unchanged+=1;continue;}
      if(cur.tombstone&&!tgt.tombstone){b.resurrect+=1;b.totalActions+=1;changes.push({kind:'resurrect',tableName:table,rowKey,current:cur,target:tgt});continue;}
      if(!cur.tombstone&&tgt.tombstone){b.tombstone+=1;b.totalActions+=1;changes.push({kind:'tombstone',tableName:table,rowKey,current:cur,target:tgt});continue;}
      if(cur.tombstone&&tgt.tombstone){b.historyOnlyExtra+=1;historyOnlyExtra+=1;continue;}
      b.update+=1;b.totalActions+=1;changes.push({kind:'update',tableName:table,rowKey,current:cur,target:tgt});
    }
    const totals=Object.values(byTable).reduce((acc,b)=>{acc.create+=b.create;acc.update+=b.update;acc.resurrect+=b.resurrect;acc.tombstone+=b.tombstone;acc.totalActions+=b.totalActions;return acc;},{create:0,update:0,resurrect:0,tombstone:0,totalActions:0});
    changes.sort((a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey));
    return{changes,byTable,unchanged,historyOnlyExtra,...totals};
  }

  async function restorePlanHash(diff){
    const rows=(diff?.changes||[]).map(item=>({
      kind:String(item.kind||''),tableName:String(item.tableName||''),rowKey:String(item.rowKey||''),
      currentPayloadHash:String(item.current?.payloadHash||''),currentTombstone:Boolean(item.current?.tombstone),
      targetPayloadHash:String(item.target?.payloadHash||''),targetTombstone:Boolean(item.target?.tombstone)
    })).sort((a,b)=>a.tableName<b.tableName?-1:a.tableName>b.tableName?1:a.rowKey<b.rowKey?-1:a.rowKey>b.rowKey?1:0);
    return sha256(stableStringify(rows));
  }
  function confirmationPhrase(report){return report?.restorePointId?`RESTORE ${String(report.restorePointId).slice(0,8)}`:'';}
  function updateExecutionButton(){
    const button=$('canonical-restore-execute-button'),input=$('canonical-restore-confirm-input');if(!button)return;
    const report=state.preview,phrase=confirmationPhrase(report),eligible=Boolean(report&&report.targetSource==='Cloud Restore Point'&&report.restorePointId);
    button.disabled=state.executing||!eligible||!input||String(input.value||'')!==phrase;
  }
  function renderExecutionGate(report){
    const box=$('canonical-restore-execute');if(!box)return;
    const eligible=Boolean(report&&report.targetSource==='Cloud Restore Point'&&report.restorePointId);
    box.hidden=!eligible;
    if(!eligible){const input=$('canonical-restore-confirm-input');if(input)input.value='';updateExecutionButton();return;}
    const phrase=confirmationPhrase(report),count=Number(report.diff?.totalActions||0);
    $('canonical-restore-confirm-phrase').textContent=phrase;
    $('canonical-restore-execute-copy').textContent=count===0
      ? 'This preview is already an exact match. Confirming now exercises the locked server execution gate as a true NOOP: zero Canonical restore changes, with only a durable restore-run audit marker.'
      : `${count.toLocaleString()} restoring action(s) are locked by this Preview. Execution will append new Canonical restore changes; it will not delete historical rows or rewrite the Authority snapshot.`;
    const input=$('canonical-restore-confirm-input');if(input)input.value='';
    const result=$('canonical-restore-execute-result');if(result)result.textContent='Preview is frozen until the Canonical cursor or plan changes. Any drift blocks execution.';
    updateExecutionButton();
  }

  function renderRestorePoints(rows){
    state.restorePoints=Array.isArray(rows)?rows.map(clone):[];
    const wrap=$('canonical-restore-list');if(!wrap)return;
    if(!state.restorePoints.length){wrap.innerHTML='<p class="canonical-restore-empty">No Cloud Restore Points yet.</p>';return;}
    wrap.innerHTML=state.restorePoints.slice(0,8).map(row=>`<article class="canonical-restore-row"><div><strong>${escapeHtml(row.label||'Manual checkpoint')}</strong><span>${escapeHtml(formatDate(row.created_at))}</span></div><div class="canonical-restore-row-side"><small>cursor ${Number(row.change_seq_high_water||0)} · base ${Number(row.authority_row_count||0)} · overlay ${Number(row.overlay_change_count||0)} · ${escapeHtml(String(row.restore_point_hash||'').slice(0,12))}…</small><button type="button" class="canonical-restore-preview-button" data-restore-id="${escapeHtml(String(row.restore_point_id||''))}">Preview</button></div></article>`).join('');
  }

  function clearRestorePreview(){
    state.preview=null;
    const section=$('canonical-restore-preview');if(section)section.hidden=true;
    const input=$('canonical-restore-file');if(input)input.value='';
    if($('canonical-restore-preview-tables'))$('canonical-restore-preview-tables').innerHTML='';
    if($('canonical-restore-preview-samples'))$('canonical-restore-preview-samples').innerHTML='';
    const execute=$('canonical-restore-execute');if(execute)execute.hidden=true;
    const confirm=$('canonical-restore-confirm-input');if(confirm)confirm.value='';
    updateExecutionButton();
  }

  function renderRestorePreview(report){
    state.preview=report;
    const section=$('canonical-restore-preview');if(!section)return;
    section.hidden=false;
    $('canonical-restore-preview-title').textContent=report.targetLabel;
    $('canonical-restore-preview-source').textContent=report.targetSource;
    $('canonical-restore-preview-target-cursor').textContent=Number.isFinite(report.targetCursor)?String(report.targetCursor):'file snapshot';
    $('canonical-restore-preview-current-cursor').textContent=String(report.currentCursor);
    $('canonical-restore-preview-writes').textContent=String(report.diff.totalActions);
    $('canonical-restore-preview-updates').textContent=String(report.diff.update+report.diff.resurrect);
    $('canonical-restore-preview-tombstones').textContent=String(report.diff.tombstone);
    $('canonical-restore-preview-creates').textContent=String(report.diff.create);
    $('canonical-restore-preview-unchanged').textContent=String(report.diff.unchanged);
    $('canonical-restore-preview-history-only').textContent=String(report.diff.historyOnlyExtra);
    $('canonical-restore-preview-summary').textContent=report.diff.totalActions===0
      ? `No restoring actions are needed. Current Canonical effective state already matches this target. ${report.diff.historyOnlyExtra?`${report.diff.historyOnlyExtra} history-only tombstone row(s) are retained for audit continuity.`:''}`
      : `${report.diff.totalActions.toLocaleString()} restoring action(s) would be needed to make the effective account state match this target. For a Cloud Restore Point, v400 can execute only after this exact Preview is confirmed and revalidated.`;
    const tables=Object.entries(report.diff.byTable).filter(([,b])=>b.totalActions||b.historyOnlyExtra).sort((a,b)=>a[0].localeCompare(b[0]));
    $('canonical-restore-preview-tables').innerHTML=tables.length?tables.map(([table,b])=>`<div class="canonical-preview-table-row"><strong>${escapeHtml(table)}</strong><span>${b.totalActions} action${b.totalActions===1?'':'s'}${b.create?` · +${b.create} create`:''}${b.update?` · ${b.update} update`:''}${b.resurrect?` · ${b.resurrect} resurrect`:''}${b.tombstone?` · ${b.tombstone} tombstone`:''}${b.historyOnlyExtra?` · ${b.historyOnlyExtra} audit-only`:''}</span></div>`).join(''):'<p class="canonical-preview-empty">No table changes.</p>';
    const samples=report.diff.changes.slice(0,40);
    $('canonical-restore-preview-samples').innerHTML=samples.length?samples.map(item=>`<div class="canonical-preview-sample"><span class="canonical-preview-kind is-${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.tableName)}</strong><code>${escapeHtml(item.rowKey)}</code></div>`).join(''):'<p class="canonical-preview-empty">No restoring changes to show.</p>';
    const details=$('canonical-restore-preview-details');if(details)details.open=report.diff.totalActions>0;
    renderExecutionGate(report);
    section.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  async function computeRestorePointPreview(restorePointId){
    const point=state.restorePoints.find(row=>String(row.restore_point_id||'')===String(restorePointId||''));
    if(!point)throw new Error('Selected Cloud Restore Point is no longer in the current list. Refresh and try again.');
    const api=await cloudContext(),head=await fetchHead(api),currentHighWater=await fetchHighWater(api,head);
    if(!headMatches(point,head))throw new Error('Restore Preview blocked: selected Cloud Restore Point belongs to a different Authority Head.');
    if(Number(point.authority_row_count||0)!==Number(head.canonical_row_count||0))throw new Error('Restore Preview blocked: selected Cloud Restore Point Authority row count does not match the ACTIVE Authority.');
    const targetCursor=Number(point.change_seq_high_water||0);
    if(targetCursor>currentHighWater)throw new Error(`Restore Preview blocked: restore-point cursor ${targetCursor} is ahead of current cursor ${currentHighWater}.`);
    const dataset=await fetchCanonicalDataset(api,head,currentHighWater),current=await materializeRecords(dataset.baseRows,dataset.changeRows,currentHighWater,'Current Canonical state'),target=await materializeRecords(dataset.baseRows,dataset.changeRows,targetCursor,'Restore Point target');
    if(target.overlayChangeRows!==Number(point.overlay_change_count||0))throw new Error(`Restore Preview blocked: restore-point overlay count expected ${Number(point.overlay_change_count||0)}, reconstructed ${target.overlayChangeRows}.`);
    const headCheck=await fetchHead(api),highWaterCheck=await fetchHighWater(api,headCheck);
    if(!headMatches(headCheck,head))throw new Error('ACTIVE Authority Head changed during Restore Preview. Retry.');
    if(highWaterCheck!==currentHighWater)throw new Error(`Canonical change cursor advanced during Restore Preview (${currentHighWater} → ${highWaterCheck}). Retry.`);
    const diff=compareEffectiveStates(current,target),planHash=await restorePlanHash(diff);
    return{targetSource:'Cloud Restore Point',targetLabel:String(point.label||'Manual checkpoint'),restorePointId:String(point.restore_point_id||''),restorePointHash:String(point.restore_point_hash||''),targetCursor,currentCursor:currentHighWater,targetManifestHash:target.manifestHash,currentManifestHash:current.manifestHash,planHash,diff};
  }

  async function previewRestorePoint(restorePointId){
    const report=await computeRestorePointPreview(restorePointId);
    renderRestorePreview(report);
    setStatus(report.diff.totalActions?`Restore Preview ready · ${report.diff.totalActions.toLocaleString()} restoring action(s) locked for confirmation · NO DATA WRITTEN.`:`Restore Preview PASS · current state already matches the selected Cloud Restore Point · execution gate can be tested as a server-checked NOOP.`,'success');
    return report;
  }

  async function previewBackupFile(file){
    if(!file)return;
    const api=await cloudContext();
    setStatus(`Reading ${file.name}…`,'working');
    let backup;try{backup=JSON.parse(await file.text());}catch{throw new Error('Selected file is not valid JSON.');}
    const target=await validateBackupFile(backup,api),head=await fetchHead(api);
    if(!headMatches(backup.authority,head))throw new Error('Restore Preview blocked: selected backup belongs to a different Authority Head.');
    if(Number(backup.authority?.canonicalRowCount||0)!==Number(head.canonical_row_count||0))throw new Error('Restore Preview blocked: selected backup Authority row count does not match the ACTIVE Authority.');
    const currentHighWater=await fetchHighWater(api,head),dataset=await fetchCanonicalDataset(api,head,currentHighWater),current=await materializeRecords(dataset.baseRows,dataset.changeRows,currentHighWater,'Current Canonical state');
    const headCheck=await fetchHead(api),highWaterCheck=await fetchHighWater(api,headCheck);
    if(!headMatches(headCheck,head))throw new Error('ACTIVE Authority Head changed during Restore Preview. Retry.');
    if(highWaterCheck!==currentHighWater)throw new Error(`Canonical change cursor advanced during Restore Preview (${currentHighWater} → ${highWaterCheck}). Retry.`);
    const diff=compareEffectiveStates(current,target),planHash=await restorePlanHash(diff);
    renderRestorePreview({targetSource:'Canonical Account Backup JSON',targetLabel:file.name,targetCursor:Number(backup.highWaterChangeSeq||0),currentCursor:currentHighWater,targetManifestHash:target.manifestHash,currentManifestHash:current.manifestHash,planHash,diff});
    setStatus(diff.totalActions?`Backup Restore Preview ready · ${diff.totalActions.toLocaleString()} restoring action(s) would be required · JSON execution remains disabled in v400.`:`Backup Restore Preview PASS · current state already matches the selected backup · JSON execution remains disabled in v400.`,'success');
  }

  async function executeRestorePoint(){
    const frozen=clone(state.preview);
    if(!frozen||frozen.targetSource!=='Cloud Restore Point'||!frozen.restorePointId)throw new Error('Run Preview on a Cloud Restore Point before execution.');
    const phrase=confirmationPhrase(frozen),input=String($('canonical-restore-confirm-input')?.value||'');
    if(input!==phrase)throw new Error(`Type the exact confirmation phrase: ${phrase}`);
    state.executing=true;setBusy(true);
    const resultNode=$('canonical-restore-execute-result');if(resultNode)resultNode.textContent='Revalidating the frozen Preview against the locked Canonical account…';
    try{
      const fresh=await computeRestorePointPreview(frozen.restorePointId);
      const same=Number(fresh.currentCursor)===Number(frozen.currentCursor)&&String(fresh.currentManifestHash||'')===String(frozen.currentManifestHash||'')&&String(fresh.targetManifestHash||'')===String(frozen.targetManifestHash||'')&&Number(fresh.diff.totalActions||0)===Number(frozen.diff?.totalActions||0)&&String(fresh.planHash||'')===String(frozen.planHash||'');
      if(!same)throw new Error('Restore execution blocked: Canonical state or restore plan changed after Preview. Run Preview again.');
      const api=await cloudContext(),deviceKey=String(localStorage.getItem('wlp:device-id:v1')||'').trim();
      if(!deviceKey)throw new Error("Restore execution requires this browser's registered WLP device key.");
      if(resultNode)resultNode.textContent='Calling the locked restore RPC. Historical Canonical rows will not be deleted.';
      const r=await api.rest(`rpc/${EXECUTE_RESTORE_RPC}`,{method:'POST',body:{
        p_restore_point_id:fresh.restorePointId,
        p_device_key:deviceKey,
        p_expected_current_change_seq:Number(fresh.currentCursor),
        p_expected_current_manifest_hash:String(fresh.currentManifestHash),
        p_expected_target_manifest_hash:String(fresh.targetManifestHash),
        p_expected_action_count:Number(fresh.diff.totalActions||0),
        p_expected_plan_hash:String(fresh.planHash),
        p_confirmation:phrase
      }}),server=Array.isArray(r.data)?r.data[0]:r.data;
      if(!server||!['noop','applied'].includes(String(server.status||'')))throw new Error(`Restore RPC returned unexpected status ${String(server?.status||'missing')}.`);
      if(String(server.status)==='applied'){
        if(Number(server.appliedActionCount||0)!==Number(fresh.diff.totalActions||0)||!server.actionId||!Number(server.lastChangeSeq||0))throw new Error('Restore RPC applied result is incomplete.');
        const sync=window.WLPCanonicalForegroundSync;if(!sync?.runSync)throw new Error('Restore was accepted by Cloud, but the local Canonical receiver is unavailable on this page. Do not perform another write; reload this page so the receiver can be retried.');
        if(resultNode)resultNode.textContent=`Cloud appended ${Number(server.appliedActionCount||0).toLocaleString()} restoring action(s). Applying the one restore action to this browser…`;
        const receipt=await sync.runSync({trigger:'account-restore-execution',receiverOnly:true});
        if(!receipt?.summary?.pass||Number(receipt.summary.cursorAfter||0)<Number(server.lastChangeSeq||0))throw new Error('Cloud restore succeeded, but local receiver verification did not reach the restore cursor. Do not execute again; retry receiver sync.');
      }else if(Number(server.changeWrites||0)!==0){throw new Error('Restore NOOP unexpectedly reported Canonical change writes.');}
      const post=await computeRestorePointPreview(fresh.restorePointId);
      if(Number(post.diff.totalActions||0)!==0)throw new Error(`Restore post-check failed: ${Number(post.diff.totalActions||0)} restoring action(s) still remain.`);
      renderRestorePreview(post);
      if(String(server.status)==='noop'){
        if(resultNode)resultNode.textContent=`PASS · Server-checked NOOP · 0 Canonical changes written · restore-run ${String(server.restoreRunId||'').slice(0,8)}… recorded for audit.`;
        setStatus('Restore execution gate PASS · server-checked NOOP · 0 Canonical changes written · durable audit marker recorded.','success');
      }else{
        if(resultNode)resultNode.textContent=`PASS · ${Number(server.appliedActionCount||0).toLocaleString()} append-only restoring change(s) applied · history retained · post-restore Preview is 0.`;
        setStatus(`Restore PASS · ${Number(server.appliedActionCount||0).toLocaleString()} restoring action(s) appended · browser receiver committed · post-restore Preview 0.`,'success');
      }
    }finally{state.executing=false;setBusy(false);updateExecutionButton();}
  }

  async function refreshSummary(){
    setBusy(true);
    try{
      const api=await cloudContext(),head=await fetchHead(api),highWater=await fetchHighWater(api,head),points=await fetchRestorePoints(api,8);
      $('canonical-account-head').textContent=`Authority v${Number(head.head_version||0)} · cursor ${highWater}`;
      $('canonical-account-user').textContent=api.session.email||'Signed-in WLP account';
      renderRestorePoints(points);
      setStatus(`Canonical account ready · Authority v${Number(head.head_version||0)} · cursor ${highWater} · ${points.length} recent restore point${points.length===1?'':'s'}.`,'success');
    }catch(error){setStatus(error?.message||String(error),'error');}
    finally{setBusy(false);}
  }

  async function createRestorePoint(){
    setBusy(true);
    try{
      const api=await cloudContext(),label=String($('canonical-restore-label')?.value||'').trim(),deviceKey=String(localStorage.getItem('wlp:device-id:v1')||'').trim(),r=await api.rest(`rpc/${RESTORE_RPC}`,{method:'POST',body:{p_label:label||null,p_device_key:deviceKey||null}}),point=Array.isArray(r.data)?r.data[0]:r.data;
      if(!point?.restorePointId)throw new Error('Cloud Restore Point RPC did not return a restore point.');
      if($('canonical-restore-label'))$('canonical-restore-label').value='';
      setStatus(`Cloud Restore Point created · cursor ${Number(point.changeSeqHighWater||0)} · ${String(point.restorePointHash||'').slice(0,12)}…`,'success');
      const points=await fetchRestorePoints(api,8);renderRestorePoints(points);
    }catch(error){setStatus(error?.message||String(error),'error');}
    finally{setBusy(false);}
  }

  async function exportCanonicalAccount(){
    setBusy(true);
    try{
      const api=await cloudContext(),backup=await buildCanonicalSnapshot(api),filename=`wlp-canonical-account-backup-${stamp(new Date(backup.exportedAt))}.json`;
      downloadJson(backup,filename);
      $('canonical-account-export-summary').textContent=`${backup.summary.recordCount} records · ${backup.summary.activeCount} active · ${backup.summary.tombstoneCount} tombstones · cursor ${backup.highWaterChangeSeq}`;
      setStatus(`Canonical Account Backup ready: ${filename} · manifest ${backup.summary.manifestHash.slice(0,16)}…`,'success');
    }catch(error){setStatus(error?.message||String(error),'error');}
    finally{setBusy(false);}
  }

  async function exportCanonicalSafetyArchive(){
    setBusy(true);
    try{
      const api=await cloudContext(),archive=await buildSafetyArchive(api),filename=`wlp-canonical-safety-archive-${stamp(new Date(archive.manifest.exportedAt))}.zip`;
      downloadBlob(archive.blob,filename);
      const c=archive.manifest.counts;
      $('canonical-account-archive-summary').textContent=`cursor ${archive.manifest.highWaterChangeSeq} · ${c.effectiveRecords} effective · ${c.rawChanges} changes · ${c.mutations} mutations · ${c.acknowledgements} ACKs · ${c.restoreRuns} restore runs`;
      setStatus(`Canonical Safety Archive ready: ${filename} · fixed cursor ${archive.manifest.highWaterChangeSeq} · history + restore audit included.`,'success');
    }catch(error){setStatus(error?.message||String(error),'error');}
    finally{setBusy(false);}
  }

  function bind(){
    $('canonical-account-refresh')?.addEventListener('click',()=>{void refreshSummary();});
    $('canonical-restore-create')?.addEventListener('click',()=>{void createRestorePoint();});
    $('canonical-account-export')?.addEventListener('click',()=>{void exportCanonicalAccount();});
    $('canonical-account-archive')?.addEventListener('click',()=>{void exportCanonicalSafetyArchive();});
    $('canonical-restore-list')?.addEventListener('click',event=>{
      const button=event.target.closest?.('.canonical-restore-preview-button');if(!button)return;
      setBusy(true);clearRestorePreview();
      void previewRestorePoint(button.dataset.restoreId).catch(error=>setStatus(error?.message||String(error),'error')).finally(()=>setBusy(false));
    });
    $('canonical-restore-file-choose')?.addEventListener('click',()=>{$('canonical-restore-file')?.click();});
    $('canonical-restore-file')?.addEventListener('change',event=>{
      const file=event.target.files?.[0];if(!file)return;
      setBusy(true);clearRestorePreview();
      void previewBackupFile(file).catch(error=>setStatus(error?.message||String(error),'error')).finally(()=>setBusy(false));
    });
    $('canonical-restore-preview-clear')?.addEventListener('click',clearRestorePreview);
    $('canonical-restore-confirm-input')?.addEventListener('input',updateExecutionButton);
    $('canonical-restore-execute-button')?.addEventListener('click',()=>{void executeRestorePoint().catch(error=>setStatus(error?.message||String(error),'error'));});
    void refreshSummary();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
