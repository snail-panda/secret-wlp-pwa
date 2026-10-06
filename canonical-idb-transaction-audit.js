/* WLP v1.8.6.350 — Safari IndexedDB transaction-completion ordering audit.
   Query-gated: ?wlpIdbTransactionAudit=1&wlpAutoSyncReceiver=0&wlpPendingOutboxRecovery=0
   Read-only. No WLP writes, no cursor ACK, no Canonical writes, no session mutation. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('wlpIdbTransactionAudit') !== '1') return;

  const DB_NAME='wlp-cloud-v1', DB_VERSION=1, META_STORE='sync_meta', OUTBOX_STORE='sync_outbox';
  const META_KEY='authority_mirror', CURSOR_KEY='sync_cursor';
  const TIMEOUT_MS=4000, LEGACY_TIMEOUT_MS=2500;

  const box=document.createElement('section');
  box.id='wlp-idb-transaction-audit';
  box.setAttribute('aria-live','polite');
  box.style.cssText='position:fixed;z-index:100011;left:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.38 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
  box.innerHTML='<strong style="display:block;font-size:13px">IndexedDB Transaction Audit · v350</strong><div id="wlp-idbtx-status" style="margin-top:5px;font-weight:700">RUNNING · read-only Safari transaction test…</div><pre id="wlp-idbtx-detail" style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace"></pre>';
  document.body.appendChild(box);
  const status=box.querySelector('#wlp-idbtx-status'), detail=box.querySelector('#wlp-idbtx-detail');
  const lines=[];
  function log(s){lines.push(String(s));detail.textContent=lines.join('\n');}
  function finish(text,ok){status.textContent=text;status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#7a5d00';}
  function withTimeout(p,label,ms=TIMEOUT_MS){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(`${label} timed out after ${ms}ms`)),ms))]);}
  function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed'));});}
  function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed'));});}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error(`${DB_NAME} unexpectedly needs upgrade`));return;}res(db);};r.onerror=()=>rej(r.error||new Error(`Could not open ${DB_NAME}`));r.onblocked=()=>rej(new Error(`${DB_NAME} open blocked`));});}

  // Safe Safari order: attach transaction completion handlers immediately,
  // before awaiting the request that may allow the transaction to complete.
  async function safeGet(db,store,key){
    const tx=db.transaction(store,'readonly');
    const done=txDone(tx);
    const value=await req(tx.objectStore(store).get(key));
    await done;
    return value||null;
  }
  async function safeGetAll(db,store){
    const tx=db.transaction(store,'readonly');
    const done=txDone(tx);
    const value=await req(tx.objectStore(store).getAll());
    await done;
    return Array.isArray(value)?value:[];
  }

  // Existing production/v349 order: await request first, attach oncomplete later.
  // Read-only comparison only; timeout prevents a permanent diagnostic hang.
  async function legacyGet(db,store,key){
    const tx=db.transaction(store,'readonly');
    const value=await req(tx.objectStore(store).get(key));
    await txDone(tx);
    return value||null;
  }

  (async()=>{
    let db=null;
    try{
      log('mode read-only · production auto receiver must be disabled by URL');
      if(params.get('wlpAutoSyncReceiver')!=='0' || params.get('wlpPendingOutboxRecovery')!=='0'){
        finish('BLOCKED · disable auto receiver and pending recovery in URL',false);return;
      }

      log('STEP 1 · open wlp-cloud-v1');
      db=await withTimeout(openDb(),'open wlp-cloud-v1');
      log(`PASS 1 · stores ${Array.from(db.objectStoreNames).join(', ')}`);
      if(!db.objectStoreNames.contains(META_STORE)||!db.objectStoreNames.contains(OUTBOX_STORE)) throw new Error('required sync stores missing');

      log('STEP 2 · safe authority_mirror read (completion listener attached first)');
      const meta=await withTimeout(safeGet(db,META_STORE,META_KEY),'safe authority_mirror read');
      log(`PASS 2 · materialized cursor ${Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0)}`);

      log('STEP 3 · safe sync_cursor read');
      const cursorMeta=await withTimeout(safeGet(db,META_STORE,CURSOR_KEY),'safe sync_cursor read');
      const cursor=Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(cursorMeta?.lastSyncCursor||0));
      log(`PASS 3 · effective cursor ${cursor}`);

      log('STEP 4 · safe sync_outbox getAll');
      const outbox=await withTimeout(safeGetAll(db,OUTBOX_STORE),'safe sync_outbox read');
      log(`PASS 4 · outbox ${outbox.length}`);

      log('STEP 5 · compare existing request→then-oncomplete ordering');
      let legacyTimedOut=false;
      try{
        const legacy=await withTimeout(legacyGet(db,META_STORE,CURSOR_KEY),'legacy sync_cursor read',LEGACY_TIMEOUT_MS);
        log(`RESULT 5 · legacy read returned this attempt · cursor ${Number(legacy?.lastSyncCursor||0)}`);
      }catch(e){
        if(/timed out/i.test(String(e?.message||e))){legacyTimedOut=true;log(`RESULT 5 · ${e.message}`);}else throw e;
      }

      if(legacyTimedOut){
        finish('CONFIRMED · Safari transaction-completion listener race reproduced.',true);
        log('Safe listener-first reads succeeded while the existing request-first helper timed out.');
        log('No WLP data, cursor, outbox, Canonical row, or session was changed.');
      }else{
        finish('PASS · listener-first IndexedDB reads work; legacy race did not reproduce this attempt.',true);
        log('The local DB is readable. Because the old ordering is timing-dependent, a non-timeout here does not rule out the Safari race.');
        log('No WLP data, cursor, outbox, Canonical row, or session was changed.');
      }
    }catch(error){
      const msg=error?.message||String(error);log(`ERROR · ${msg}`);
      finish(/timed out/i.test(msg)?`TIMEOUT · ${msg}`:`CHECK · ${msg}`,false);
    }finally{try{db?.close();}catch(_){}}
  })();
})();
