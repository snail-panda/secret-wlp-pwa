/* WLP v1.8.6.321 — Card Study flip Canonical receiver audit.
   Query-gated by ?wlpInteractionReceiveAudit=<WID> on flashcards/wlp/batch.html.
   Read-only: verifies a Canonical interaction/flip for the requested legacy WID is
   present in this device's local Canonical mirror after foreground sync. */
(() => {
  'use strict';

  const FLAG='wlpInteractionReceiveAudit';
  const expectedWid=String(new URLSearchParams(location.search).get(FLAG)||'').trim();
  if(!/^\d+$/.test(expectedWid))return;

  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const BASE={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'};
  const clean=v=>String(v??'').trim();
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});
  let panel,status,detail,timer=null,attempts=0;

  function makePanel(){if(panel)return;panel=document.createElement('section');panel.id='wlp-interaction-receiver-audit';panel.setAttribute('aria-live','polite');panel.style.cssText='position:fixed;z-index:100011;left:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';panel.innerHTML='<strong style="display:block;font-size:13px">Card Study · flip Canonical receiver audit</strong><div id="wlp-interaction-receiver-status" style="margin-top:4px">Checking…</div><div id="wlp-interaction-receiver-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';document.body.appendChild(panel);status=panel.querySelector('#wlp-interaction-receiver-status');detail=panel.querySelector('#wlp-interaction-receiver-detail');}
  function setStatus(text,ok=null,more=''){makePanel();status.textContent=text;status.style.fontWeight=ok===null?'500':'700';status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';detail.textContent=more;}
  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}
  function isExpected(row){const p=row?.payload||{};return String(p.legacy_word_id??'')===expectedWid&&clean(p.source_stream)==='interaction'&&clean(p.event_type)==='event'&&clean(p?.payload?.action)==='flip';}
  async function inspect(){attempts+=1;let db=null;try{db=await openDb();const [meta,events,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,EVENT_STORE),getAll(db,OUTBOX_STORE)]);if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Receiver audit requires ACTIVE Authority v3.');const cursor=await cursorValue(db,meta),matches=events.filter(isExpected).sort((a,b)=>String(b?.payload?.occurred_at||'').localeCompare(String(a?.payload?.occurred_at||'')));if(matches.length){if(timer){clearTimeout(timer);timer=null;}const row=matches[0],eventId=clean(row?.payload?.event_id||row?.event_id||row?.id);setStatus(`PASS · Canonical WID${expectedWid} flip is present on this device.`,true,`cursor ${cursor} · matching Canonical flips ${matches.length} · outbox ${outbox.length}${eventId?` · event ${eventId}`:''}`);return;}if(attempts<24){setStatus(`CHECKING · Waiting for Canonical WID${expectedWid} flip…`,null,`cursor ${cursor} · outbox ${outbox.length} · read-only receiver audit`);timer=setTimeout(()=>void inspect(),500);}else setStatus(`CHECK · Canonical WID${expectedWid} flip is not present on this device yet.`,false,`cursor ${cursor} · outbox ${outbox.length} · no write was staged by this audit`);}catch(error){setStatus(`BLOCKED · ${error?.message||String(error)}`,false,'Read-only audit; no Canonical write was staged.');}finally{try{db?.close();}catch(_){}}}

  window.addEventListener('wlp-canonical-auto-sync-complete',()=>{attempts=0;if(timer){clearTimeout(timer);timer=null;}void inspect();});
  makePanel();setStatus(`CHECKING · Looking for Canonical WID${expectedWid} flip…`,null,'Read-only · no outbox mutation will be staged.');setTimeout(()=>void inspect(),700);
})();
