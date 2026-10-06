/* WLP v1.8.6.349 — read-only iPhone receiver hang step audit.
   Query-gated: ?wlpReceiverHangAudit=1&wlpAutoSyncReceiver=0
   No WLP writes, no cursor ACK, no session refresh, no Canonical mutations. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('wlpReceiverHangAudit') !== '1') return;

  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox', META_KEY='authority_mirror', CURSOR_KEY='sync_cursor';
  const SHADOW_DB='wlp-cloud-shadow-v0', SHADOW_DB_VERSION=1, SHADOW_META='meta', CONFIG_KEY='supabase_config', SESSION_KEY='supabase_session';
  const CHANGE_TABLE='wlp_sync_changes_v1';
  const TIMEOUT_MS=8000;

  const box=document.createElement('section');
  box.id='wlp-receiver-hang-audit';
  box.setAttribute('aria-live','polite');
  box.style.cssText='position:fixed;z-index:100010;left:8px;top:max(8px,env(safe-area-inset-top));width:min(430px,calc(100vw - 16px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.38 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
  box.innerHTML='<strong style="display:block;font-size:13px">Canonical Receiver Hang Audit · v349</strong><div id="wlp-rha-status" style="margin-top:5px;font-weight:700">RUNNING · read-only diagnostics…</div><pre id="wlp-rha-detail" style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace"></pre>';
  document.body.appendChild(box);
  const status=box.querySelector('#wlp-rha-status'), detail=box.querySelector('#wlp-rha-detail');
  const lines=[];
  function log(s){lines.push(String(s));detail.textContent=lines.join('\n');}
  function finish(text,ok){status.textContent=text;status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#7a5d00';}
  function withTimeout(promise,label,ms=TIMEOUT_MS){return Promise.race([promise,new Promise((_,rej)=>setTimeout(()=>rej(new Error(`${label} timed out after ${ms}ms`)),ms))]);}
  function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed'));});}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed'));});}
  function openDb(name,version){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(name,version);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error(`${name} unexpectedly needs upgrade`));return;}res(db);};r.onerror=()=>rej(r.error||new Error(`Could not open ${name}`));r.onblocked=()=>rej(new Error(`${name} open blocked`));});}
  async function getStore(db,store,key){const tx=db.transaction(store,'readonly');const v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly');const v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function timedFetch(url,options,label){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);try{return await fetch(url,{...options,signal:controller.signal});}catch(e){if(e?.name==='AbortError')throw new Error(`${label} timed out after ${TIMEOUT_MS}ms`);throw e;}finally{clearTimeout(timer);}}

  (async()=>{
    try{
      log('mode read-only · auto receiver must be disabled by URL');
      if(params.get('wlpAutoSyncReceiver')!=='0'){finish('BLOCKED · add wlpAutoSyncReceiver=0',false);log('No network audit was run because production receiver was not disabled.');return;}

      log('STEP 1 · local cursor / outbox');
      const db=await withTimeout(openDb(DB_NAME,DB_VERSION),'open wlp-cloud-v1');
      let meta,cursorMeta,outbox;
      try{
        [meta,cursorMeta,outbox]=await withTimeout(Promise.all([getStore(db,META_STORE,META_KEY),getStore(db,META_STORE,CURSOR_KEY),getAll(db,OUTBOX_STORE)]),'read local sync state');
      } finally { db.close(); }
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      log(`PASS 1 · cursor ${cursor} · outbox ${outbox.length}`);

      log('STEP 2 · saved Supabase session');
      const sdb=await withTimeout(openDb(SHADOW_DB,SHADOW_DB_VERSION),'open shadow db');
      let config,session;
      try{
        [config,session]=await withTimeout(Promise.all([getStore(sdb,SHADOW_META,CONFIG_KEY),getStore(sdb,SHADOW_META,SESSION_KEY)]),'read shadow session');
      } finally { sdb.close(); }
      if(!config?.url||!config?.publishableKey||!session?.accessToken||!session?.refreshToken){throw new Error('Supabase config/session is incomplete');}
      const remainingMs=Number(session.expiresAt||0)-Date.now();
      const refreshRequired=remainingMs<=60000;
      log(`PASS 2 · session expires in ${Math.round(remainingMs/1000)}s · production refresh required ${refreshRequired?'YES':'no'}`);

      log('STEP 3 · direct change-feed GET with saved access token');
      const base=String(config.url).replace(/\/+$/,'');
      const select='change_seq,candidate_key,head_version,table_name,row_key,operation,changed_fields,mutation_id,action_id,device_key,payload_hash,payload,tombstone,server_at';
      const path=`${CHANGE_TABLE}?select=${encodeURIComponent(select)}&change_seq=gt.${cursor}&order=change_seq.asc`;
      const response=await timedFetch(`${base}/rest/v1/${path}`,{method:'GET',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`,Range:'0-999',Prefer:'count=exact'}},'change-feed GET');
      const text=await withTimeout(response.text(),'read change-feed response');
      let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}
      log(`RESULT 3 · HTTP ${response.status}`);
      if(!response.ok){
        const msg=(data&&typeof data==='object'&&(data.message||data.error_description||data.error))||String(data||'');
        log(`response ${String(msg).slice(0,300)}`);
        if(refreshRequired && (response.status===401||response.status===403)){
          finish('DIAGNOSIS · production is entering the auth-refresh path before pull.',null);
          log('The saved access token is no longer usable. v347 has no network timeout around token refresh, so a stalled refresh request can leave SYNCING on screen indefinitely.');
          return;
        }
        finish('CHECK · change-feed GET failed before local materialization.',false);return;
      }
      const rows=Array.isArray(data)?data:[];
      const seqs=rows.map(x=>Number(x?.change_seq||0)).filter(Number.isFinite);
      log(`PASS 3 · remote rows after ${cursor}: ${rows.length}${seqs.length?` · seq ${Math.min(...seqs)}→${Math.max(...seqs)}`:''}`);
      rows.slice(0,8).forEach((x,i)=>log(`  ${i+1}. seq ${x.change_seq} · ${x.table_name} · ${x.operation} · action ${x.action_id}`));
      if(rows.length===0){finish('CHECK · server returned no rows beyond the local cursor.',false);return;}
      finish(refreshRequired?'PASS · change feed is reachable even though production would first refresh auth.':'PASS · change feed is reachable; hang is after basic pull.',true);
      log('No WLP data, cursor, outbox, Canonical row, or saved session was changed by this audit.');
    }catch(error){
      const msg=error?.message||String(error);log(`ERROR · ${msg}`);
      if(/timed out/i.test(msg))finish(`TIMEOUT · ${msg}`,false);else finish(`CHECK · ${msg}`,false);
    }
  })();
})();
