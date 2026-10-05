/* WLP v1.8.6.340 — Targeted pending-outbox recovery canary for the retained iPhone WID10 encounter.
   Query-gated only: ?wlpPendingOutboxRecoveryCanary=1
   This canary does NOT stage, edit, delete, or replace an outbox mutation. It only verifies the
   exact already-staged WID10 encounter action, then explicitly asks the existing foreground sync
   transport to retry that same actionId/mutationId. Outbox cleanup remains owned by the existing
   acknowledged atomic local commit path in canonical-auto-sync-canary.js. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.340-pending-outbox-recovery-canary';
  const FLAG='wlpPendingOutboxRecoveryCanary';
  const DB_NAME='wlp-cloud-v1', DB_VERSION=1;
  const OUTBOX_STORE='sync_outbox', EVENT_STORE='learning_events', META_STORE='sync_meta';
  const META_KEY='authority_mirror', CURSOR_KEY='cloud_shadow_steady_sync_v1';
  const TARGET=Object.freeze({
    wordId:'10',
    rowKey:'9e409a42-06ad-54f2-b1a6-0c861f0ee504',
    actionId:'2e8575f9-abb5-5cb7-83ed-5d3c0bf0762c',
    mutationId:'1d221416-a74e-5397-b283-5007bde92cc7',
    tableName:'learning_events',
    mutationKind:'append',
    sourceStream:'activity',
    legacyAction:'encounter',
    legacySource:'source-deck'
  });
  const state={busy:false,panel:null,status:null,detail:null,button:null};
  const clean=v=>String(v??'').trim();
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});
  const active=()=>new URLSearchParams(location.search).get(FLAG)==='1';

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[OUTBOX_STORE,EVENT_STORE,META_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function cursorValue(db){const [m,c]=await Promise.all([getRow(db,META_STORE,META_KEY),getRow(db,META_STORE,CURSOR_KEY)]);return Math.max(Number(m?.materializedSyncCursor??m?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}

  function makePanel(){
    if(state.panel)return;
    const p=document.createElement('section');p.id='wlp-pending-outbox-recovery-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100012;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(720px,calc(100vw - 20px));max-height:52vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:12px 16px;font:14px/1.38 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';
    p.innerHTML='<strong style="display:block;font-size:14px">Pending Outbox · Exact WID10 encounter recovery canary</strong><div id="wlp-pending-outbox-recovery-status" style="margin-top:6px;font-weight:700"></div><div id="wlp-pending-outbox-recovery-detail" style="margin-top:8px;white-space:pre-line;opacity:.86"></div><button id="wlp-pending-outbox-recovery-button" type="button" style="margin-top:12px;padding:10px 16px;border-radius:12px;border:1px solid rgba(31,85,55,.28);background:#f8fbf8;color:#20392a;font:inherit">Retry existing WID10 encounter outbox</button>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-pending-outbox-recovery-status');state.detail=p.querySelector('#wlp-pending-outbox-recovery-detail');state.button=p.querySelector('#wlp-pending-outbox-recovery-button');state.button.addEventListener('click',()=>{void retry();});
  }
  function show(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function exactTarget(row){
    const p=row?.payload?.payload||{};
    return clean(row?.rowKey)===TARGET.rowKey&&clean(row?.actionId)===TARGET.actionId&&clean(row?.mutationId)===TARGET.mutationId&&clean(row?.tableName)===TARGET.tableName&&clean(row?.mutationKind)===TARGET.mutationKind&&row?.transportEligible===true&&row?.diagnosticOnly!==true&&row?.candidateOnly!==true&&clean(row?.payload?.source_stream)===TARGET.sourceStream&&clean(row?.payload?.legacy_word_id)===TARGET.wordId&&clean(p?.action)===TARGET.legacyAction&&clean(p?.source)===TARGET.legacySource;
  }

  async function inspect(){
    let db=null;try{
      db=await openDb();const [outbox,event,cursor]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,EVENT_STORE,TARGET.rowKey),cursorValue(db)]);
      if(event){state.button.disabled=true;show('CHECK · Target event is already materialized locally.',false,`cursor ${cursor} · outbox ${outbox.length}\nDo not retry until this unexpected state is reviewed.`);return false;}
      if(outbox.length!==1){state.button.disabled=true;show(`BLOCKED · Expected exactly 1 retained outbox row; found ${outbox.length}.`,false,'Nothing was staged, sent, or deleted.');return false;}
      if(!exactTarget(outbox[0])){state.button.disabled=true;show('BLOCKED · The retained outbox row is not the exact audited WID10 encounter.',false,`rowKey ${clean(outbox[0]?.rowKey)||'missing'}\nactionId ${clean(outbox[0]?.actionId)||'missing'}\nNothing was changed.`);return false;}
      state.button.disabled=false;show('READY · Exact retained WID10 encounter is safe to retry.',true,`cursor ${cursor} · outbox 1\nSame actionId ${TARGET.actionId}\nSame mutationId ${TARGET.mutationId}\nNo new mutation will be staged.`);return true;
    }catch(error){state.button.disabled=true;show(`CHECK · ${error?.message||String(error)}`,false,'Nothing was changed.');return false;}finally{try{db?.close();}catch(_){}}
  }

  async function retry(){
    if(state.busy)return;state.busy=true;state.button.disabled=true;
    try{
      if(!(await inspect()))return;
      const api=window.WLPCanonicalForegroundSync;
      if(!api||typeof api.runSync!=='function')throw new Error('Canonical Foreground Sync API is unavailable.');
      show('RETRYING · Existing WID10 encounter outbox is being sent.',null,'No new event or mutation is being created.');
      const report=await api.runSync({trigger:'pending-wid10-encounter-recovery-canary',expectedActionId:TARGET.actionId});
      let db=null;try{
        db=await openDb();const [outbox,event,cursor]=await Promise.all([getAll(db,OUTBOX_STORE),getRow(db,EVENT_STORE,TARGET.rowKey),cursorValue(db)]);
        const present=Boolean(event&&clean(event?.payload?.source_stream)===TARGET.sourceStream&&clean(event?.payload?.legacy_word_id)===TARGET.wordId&&clean(event?.payload?.payload?.action)===TARGET.legacyAction),pass=report?.summary?.pass===true&&outbox.length===0&&present;
        state.button.disabled=pass;
        show(pass?'PASS · Retained WID10 encounter reached Canonical.':'CHECK · Recovery verification is incomplete.',pass,`cursor ${cursor} · outbox ${outbox.length}\nCanonical local event present ${present?'yes':'no'}\nNo duplicate mutation was staged.`);
      }finally{try{db?.close();}catch(_){}}
    }catch(error){show(`CHECK · ${error?.message||String(error)}`,false,'The existing outbox row should remain retained. Do not stage another write.');state.button.disabled=false;}finally{state.busy=false;}
  }

  function init(){if(!active())return;makePanel();state.button.disabled=true;void inspect();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
