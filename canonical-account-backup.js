/* WLP v1.8.6.397 — Canonical Account Backup + immutable restore-point markers.
   Read-only Canonical export. Restore execution is intentionally NOT enabled in v397. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.397-canonical-account-backup-v1';
  const FORMAT='WLP_CANONICAL_ACCOUNT_BACKUP',VERSION=1;
  const SHADOW_DB='wlp-cloud-shadow-v0',SHADOW_META='meta',CONFIG_KEY='supabase_config',SESSION_KEY='supabase_session';
  const RESTORE_TABLE='wlp_account_restore_points_v1';
  const RESTORE_RPC='wlp_create_account_restore_point_v1';
  const AUTHORITY_HEAD='wlp_canonical_authority_heads';
  const AUTHORITY_RECORDS='wlp_canonical_authority_candidate_records';
  const CHANGE_TABLE='wlp_sync_changes_v1';
  const $=id=>document.getElementById(id);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

  function stableValue(value){
    if(Array.isArray(value))return value.map(stableValue);
    if(value&&typeof value==='object'){
      const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;
    }
    return value;
  }
  const stableStringify=value=>JSON.stringify(stableValue(value));
  async function sha256(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function identity(tableName,rowKey){return `${String(tableName||'')}\u0000${String(rowKey||'')}`;}
  function pad(n){return String(n).padStart(2,'0');}
  function stamp(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;}
  function formatDate(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';try{return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d);}catch{return d.toLocaleString();}}
  function downloadJson(data,filename){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function setStatus(text,tone=''){
    const node=$('canonical-account-status');if(!node)return;node.hidden=false;node.textContent=text;node.dataset.tone=tone;
  }
  function setBusy(busy){['canonical-account-export','canonical-restore-create','canonical-account-refresh'].forEach(id=>{const b=$(id);if(b)b.disabled=Boolean(busy);});}

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
      const headers={apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`,...(options.headers||{})};if(options.body!=null)headers['Content-Type']='application/json';
      const response=await fetch(`${String(config.url).replace(/\/+$/,'')}/rest/v1/${path}`,{method:options.method||'GET',headers,body:options.body==null?undefined:JSON.stringify(options.body)}),text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}
      if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||`Supabase Data API request failed (${response.status}).`);return{data,response};
    }
    async function fetchPaged(table,select,extra=''){
      const size=1000,out=[];for(let from=0;;from+=size){const to=from+size-1,suffix=extra?`&${extra}`:'',r=await rest(`${table}?select=${encodeURIComponent(select)}${suffix}`,{headers:{Range:`${from}-${to}`,Prefer:'count=exact'}}),rows=Array.isArray(r.data)?r.data:[];out.push(...rows);if(rows.length<size)break;const total=Number((r.response.headers.get('content-range')||'').split('/')[1]);if(Number.isFinite(total)&&out.length>=total)break;}return out;
    }
    return{config,session,rest,fetchPaged};
  }

  async function fetchHead(api){
    const rows=await api.fetchPaged(AUTHORITY_HEAD,'candidate_key,head_version,snapshot_manifest_hash,canonical_row_count,migration_version,promoted_at','order=promoted_at.desc');
    if(rows.length!==1)throw new Error(`Canonical Account Backup expected one ACTIVE Authority Head, found ${rows.length}.`);return rows[0];
  }
  async function fetchHighWater(api,head){
    const r=await api.rest(`${CHANGE_TABLE}?select=change_seq&candidate_key=eq.${encodeURIComponent(head.candidate_key)}&head_version=eq.${encodeURIComponent(head.head_version)}&order=change_seq.desc&limit=1`),rows=Array.isArray(r.data)?r.data:[];return Number(rows[0]?.change_seq||0);
  }
  async function fetchRestorePoints(api,limit=8){
    try{return await api.fetchPaged(RESTORE_TABLE,'restore_point_id,label,candidate_key,head_version,snapshot_manifest_hash,authority_row_count,change_seq_high_water,overlay_change_count,restore_point_hash,created_by_device,created_at',`order=created_at.desc&limit=${Math.max(1,Math.min(20,Number(limit)||8))}`);}catch(error){if(String(error?.message||'').toLowerCase().includes('does not exist'))return[];throw error;}
  }

  async function buildCanonicalSnapshot(api){
    setStatus('Reading ACTIVE Authority and Canonical change overlay…','working');
    const head=await fetchHead(api),highWater=await fetchHighWater(api,head);
    const [baseRows,changeRows,restorePoints]=await Promise.all([
      api.fetchPaged(AUTHORITY_RECORDS,'table_name,row_key,payload_hash,payload,tombstone',`candidate_key=eq.${encodeURIComponent(head.candidate_key)}&order=table_name.asc,row_key.asc`),
      highWater?api.fetchPaged(CHANGE_TABLE,'change_seq,table_name,row_key,operation,payload_hash,payload,tombstone,server_at,action_id,mutation_id,device_key',`candidate_key=eq.${encodeURIComponent(head.candidate_key)}&head_version=eq.${encodeURIComponent(head.head_version)}&change_seq=lte.${highWater}&order=change_seq.asc`):Promise.resolve([]),
      fetchRestorePoints(api,20)
    ]);

    const map=new Map();
    for(const row of baseRows){const tableName=String(row.table_name||''),rowKey=String(row.row_key||'');if(!tableName||!rowKey)continue;map.set(identity(tableName,rowKey),{tableName,rowKey,payloadHash:String(row.payload_hash||''),payload:clone(row.payload),tombstone:Boolean(row.tombstone),source:'authority',lastChangeSeq:null,lastOperation:'bootstrap',lastServerAt:null});}
    for(const row of changeRows){const tableName=String(row.table_name||''),rowKey=String(row.row_key||'');if(!tableName||!rowKey)continue;map.set(identity(tableName,rowKey),{tableName,rowKey,payloadHash:String(row.payload_hash||''),payload:clone(row.payload),tombstone:Boolean(row.tombstone),source:'change',lastChangeSeq:Number(row.change_seq||0),lastOperation:String(row.operation||''),lastServerAt:row.server_at||null});}
    const records=[...map.values()].sort((a,b)=>a.tableName.localeCompare(b.tableName)||a.rowKey.localeCompare(b.rowKey));
    const tableCounts={};let activeCount=0,tombstoneCount=0;
    for(const row of records){const block=tableCounts[row.tableName]||(tableCounts[row.tableName]={total:0,active:0,tombstone:0});block.total+=1;if(row.tombstone){block.tombstone+=1;tombstoneCount+=1;}else{block.active+=1;activeCount+=1;}}
    const manifestRows=records.map(row=>({tableName:row.tableName,rowKey:row.rowKey,payloadHash:row.payloadHash,tombstone:row.tombstone}));
    const manifestHash=await sha256(stableStringify(manifestRows));
    const headCheck=await fetchHead(api);if(String(headCheck.candidate_key)!==String(head.candidate_key)||Number(headCheck.head_version)!==Number(head.head_version)||String(headCheck.snapshot_manifest_hash)!==String(head.snapshot_manifest_hash))throw new Error('ACTIVE Authority Head changed during Canonical Account Backup. Retry the export.');

    const exportedAt=new Date().toISOString();
    return{
      format:FORMAT,version:VERSION,appVersion:APP_VERSION,exportedAt,
      account:{userId:String(api.session.userId||''),email:String(api.session.email||'')},
      authority:{candidateKey:String(head.candidate_key),headVersion:Number(head.head_version),snapshotManifestHash:String(head.snapshot_manifest_hash),canonicalRowCount:Number(head.canonical_row_count||0),migrationVersion:head.migration_version??null,promotedAt:head.promoted_at||null},
      highWaterChangeSeq:highWater,
      summary:{recordCount:records.length,activeCount,tombstoneCount,overlayChangeRows:changeRows.length,tableCounts,manifestHash},
      restorePoints:restorePoints.map(clone),
      records
    };
  }

  function renderRestorePoints(rows){
    const wrap=$('canonical-restore-list');if(!wrap)return;
    if(!Array.isArray(rows)||!rows.length){wrap.innerHTML='<p class="canonical-restore-empty">No Cloud Restore Points yet.</p>';return;}
    wrap.innerHTML=rows.slice(0,8).map(row=>`<article class="canonical-restore-row"><div><strong>${escapeHtml(row.label||'Manual checkpoint')}</strong><span>${escapeHtml(formatDate(row.created_at))}</span></div><small>cursor ${Number(row.change_seq_high_water||0)} · base ${Number(row.authority_row_count||0)} · overlay ${Number(row.overlay_change_count||0)} · ${escapeHtml(String(row.restore_point_hash||'').slice(0,12))}…</small></article>`).join('');
  }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  async function refreshSummary(){
    setBusy(true);try{const api=await cloudContext(),head=await fetchHead(api),highWater=await fetchHighWater(api,head),points=await fetchRestorePoints(api,8);$('canonical-account-head').textContent=`Authority v${Number(head.head_version||0)} · cursor ${highWater}`;$('canonical-account-user').textContent=api.session.email||'Signed-in WLP account';renderRestorePoints(points);setStatus(`Canonical account ready · Authority v${Number(head.head_version||0)} · cursor ${highWater} · ${points.length} recent restore point${points.length===1?'':'s'}.`,'success');}catch(error){setStatus(error?.message||String(error),'error');}finally{setBusy(false);}}

  async function createRestorePoint(){
    setBusy(true);try{const api=await cloudContext(),label=String($('canonical-restore-label')?.value||'').trim(),deviceKey=String(localStorage.getItem('wlp:device-id:v1')||'').trim(),r=await api.rest(`rpc/${RESTORE_RPC}`,{method:'POST',body:{p_label:label||null,p_device_key:deviceKey||null}}),point=Array.isArray(r.data)?r.data[0]:r.data;if(!point?.restorePointId)throw new Error('Cloud Restore Point RPC did not return a restore point.');if($('canonical-restore-label'))$('canonical-restore-label').value='';setStatus(`Cloud Restore Point created · cursor ${Number(point.changeSeqHighWater||0)} · ${String(point.restorePointHash||'').slice(0,12)}…`,'success');const points=await fetchRestorePoints(api,8);renderRestorePoints(points);}catch(error){setStatus(error?.message||String(error),'error');}finally{setBusy(false);}}

  async function exportCanonicalAccount(){
    setBusy(true);try{const api=await cloudContext(),backup=await buildCanonicalSnapshot(api),filename=`wlp-canonical-account-backup-${stamp(new Date(backup.exportedAt))}.json`;downloadJson(backup,filename);$('canonical-account-export-summary').textContent=`${backup.summary.recordCount} records · ${backup.summary.activeCount} active · ${backup.summary.tombstoneCount} tombstones · cursor ${backup.highWaterChangeSeq}`;setStatus(`Canonical Account Backup ready: ${filename} · manifest ${backup.summary.manifestHash.slice(0,16)}…`,'success');}catch(error){setStatus(error?.message||String(error),'error');}finally{setBusy(false);}}

  function bind(){
    $('canonical-account-refresh')?.addEventListener('click',()=>{void refreshSummary();});
    $('canonical-restore-create')?.addEventListener('click',()=>{void createRestorePoint();});
    $('canonical-account-export')?.addEventListener('click',()=>{void exportCanonicalAccount();});
    void refreshSummary();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
