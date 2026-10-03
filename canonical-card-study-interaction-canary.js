/* WLP v1.8.6.321 — Card Study interaction event-only Canonical transport canary.
   Query-gated by ?wlpInteractionCanary=flip on flashcards/wlp/batch.html.
   Waits for one NEW local flip on the URL-targeted WID after the audit arms, then
   automatically stages exactly that flip into Canonical learning_events.
   Normal Card Study interaction writes are not cut over by this file. */
(() => {
  'use strict';

  const FLAG='wlpInteractionCanary';
  const ACTION=String(new URLSearchParams(location.search).get(FLAG)||'').trim();
  if(ACTION!=='flip')return;

  const APP_VERSION='1.8.6.321-card-study-interaction-flip-canary-v1';
  const INTERACTION_KEY='wlp:stage7:interaction-events:v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1,META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events',CARD_STORE='cards';
  const META_KEY='authority_mirror',CURSOR_KEY='sync_cursor';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE={candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'};
  const TARGET_WORD_ID=String(new URLSearchParams(location.search).get('wordid')||'').trim();
  const state={armed:false,busy:false,baselineTimestamp:0,staged:null,legacyRaw:null,report:null,panel:null,status:null,detail:null,exportButton:null,timer:null};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').trim();
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const utf8=v=>new TextEncoder().encode(String(v??''));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',utf8(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(bytes){const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const h=new Uint8Array(await crypto.subtle.digest('SHA-1',all)),out=h.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>rej(tx.error||new Error('IndexedDB transaction failed.'));});

  function makePanel(){
    if(state.panel)return;
    const p=document.createElement('section');p.id='wlp-interaction-canary';p.setAttribute('aria-live','polite');
    p.style.cssText='position:fixed;z-index:100010;left:8px;top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    p.innerHTML='<strong style="display:block;font-size:13px">Card Study · flip Canonical transport canary</strong><div id="wlp-interaction-status" style="margin-top:4px">Checking…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-interaction-export" type="button" disabled>Export JSON</button></div><div id="wlp-interaction-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-interaction-status');state.detail=p.querySelector('#wlp-interaction-detail');state.exportButton=p.querySelector('#wlp-interaction-export');
    state.exportButton.style.cssText='font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;';state.exportButton.addEventListener('click',exportReport);
  }
  function setStatus(text,ok=null,detail=''){makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;state.exportButton.disabled=!state.report;}
  function exportReport(){if(!state.report)return;const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wlp-card-study-flip-canary-${String(state.report.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}
  function readFlips(){try{const v=JSON.parse(localStorage.getItem(INTERACTION_KEY)||'[]');return(Array.isArray(v)?v:[]).filter(e=>e&&typeof e==='object'&&clean(e.action)==='flip'&&clean(e.wordId)&&Number(e.timestamp)>0);}catch(_){return[];}}
  function maxTargetFlipTimestamp(){return readFlips().filter(e=>!TARGET_WORD_ID||clean(e.wordId)===TARGET_WORD_ID).reduce((m,e)=>Math.max(m,Number(e.timestamp)||0),0);}
  function newestNewFlip(){return readFlips().filter(e=>(!TARGET_WORD_ID||clean(e.wordId)===TARGET_WORD_ID)&&Number(e.timestamp)>state.baselineTimestamp).sort((a,b)=>Number(b.timestamp)-Number(a.timestamp))[0]||null;}
  function eventIdentity(e){return`${Number(e.timestamp)}|${clean(e.wordId)}|${clean(e.source)}|${clean(e.deck)}|${clean(e.action)}`;}
  async function idsFor(e){const sourceEventId=await uuidV5(`interaction|${clean(e.action)}|${eventIdentity(e)}`),canonicalEventId=await uuidV5(`event|interaction:${sourceEventId}`);return{sourceEventId,canonicalEventId};}

  async function arm(){
    let db=null;
    try{
      if(!/^\d+$/.test(TARGET_WORD_ID))throw new Error('Flip canary requires a numeric wordid in this Study Card URL.');
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Flip canary requires ACTIVE Authority v3.');
      const pendingEncounter=Number(window.WLPCanonicalCardStudyEncounterWrite?.pendingCount?.()||0);
      if(outbox.length||pendingEncounter){setStatus('WAIT · Finishing the page-open encounter first.',null,`outbox ${outbox.length} · encounter pending ${pendingEncounter}`);setTimeout(()=>void arm(),350);return;}
      state.baselineTimestamp=maxTargetFlipTimestamp();state.armed=true;
      state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{armed:true,action:'flip',wordId:TARGET_WORD_ID,blockingIssues:0,pass:true},issues:{blocking:[],warnings:['Only a NEW flip created after this audit arms will be staged.','The page-open encounter uses its existing production-default writer and is not part of this flip canary.']}};
      setStatus(`READY · Flip WID${TARGET_WORD_ID} once.`,true,'Press Show Answer once. The new flip will stage automatically; do not press other interaction controls yet.');
      poll();
    }catch(error){const m=error?.message||String(error);state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[m]}};setStatus(`BLOCKED · ${m}`,false,'No flip mutation was staged.');}
    finally{try{db?.close();}catch(_){}}
  }
  function poll(){if(!state.armed||state.staged||state.busy)return;const e=newestNewFlip();if(e){void stage(e);return;}state.timer=setTimeout(poll,180);}

  async function stage(event){
    if(state.busy||state.staged)return;state.busy=true;let db=null;
    try{
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);if(outbox.length)throw new Error(`sync_outbox must be empty before flip staging; found ${outbox.length}.`);
      if(clean(event.wordId)!==TARGET_WORD_ID||clean(event.action)!=='flip')throw new Error('Detected interaction does not match this WID/flip canary.');
      const ids=await idsFor(event);if(await getRow(db,EVENT_STORE,ids.canonicalEventId))throw new Error('This flip already exists in Canonical; create one new flip only.');
      const wordId=clean(event.wordId),cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
      if(!['source-deck','review-deck','study-set','solo'].includes(clean(event.source)))throw new Error(`Flip source is unsupported (${clean(event.source)||'missing'}).`);
      const occurredAt=new Date(Number(event.timestamp)).toISOString(),intent={kind:'card-study-interaction-event-only-canary',action:'flip',sourceEventId:ids.sourceEventId,canonicalEventId:ids.canonicalEventId,cardId,wordId,timestamp:Number(event.timestamp),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'interaction-card-study-v1'},actionId=await uuidV5(`sync-action|interaction-flip|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`);
      const eventPayload={event_id:ids.canonicalEventId,source_event_id:ids.sourceEventId,card_id:cardId,session_id:null,event_type:'event',source_stream:'interaction',occurred_at:occurredAt,completed_at:occurredAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:clone(event),imported_at:null,supersedes_event_id:null};
      const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalCardStudyInteractionTransportCanary:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:ids.canonicalEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
      const cursorBefore=await cursorValue(db,meta);state.legacyRaw=localStorage.getItem(INTERACTION_KEY);await addOutbox(db,mutation);state.staged={actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId,wordId,cursorBefore};state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),mode:'real-card-study-flip-to-canonical-outbox',summary:{armed:true,staged:true,action:'flip',wordId,cursorBefore,outboxBefore:0,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId,wordId},issues:{blocking:[],warnings:['One new real Card Study flip was staged. Legacy interaction localStorage remains the compatibility copy.']}};
      setStatus(`PENDING · WID${wordId} flip staged automatically.`,true,`cursor ${cursorBefore} · waiting for foreground sync`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'card-study-interaction-canary',sourceStream:'interaction',actionId,wordId,eventType:'event',mutationCount:1}}));
    }catch(error){const m=error?.message||String(error);state.report={format:'WLP_CANONICAL_CARD_STUDY_INTERACTION_CANARY',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[m]}};setStatus(`BLOCKED · ${m}`,false,'Do not create another interaction until this is understood.');}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function onSyncComplete(ev){
    const d=ev?.detail||{};if(!state.staged||clean(d.actionId)!==state.staged.actionId)return;if(d.pass!==true){setStatus(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The staged flip outbox row is retained on failure.');return;}
    let db=null;
    try{
      db=await openDb();const [row,outbox,meta]=await Promise.all([getRow(db,EVENT_STORE,state.staged.eventId),getAll(db,OUTBOX_STORE),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),legacyUnchanged=localStorage.getItem(INTERACTION_KEY)===state.legacyRaw,eventPresent=Boolean(row&&clean(row?.payload?.source_event_id)===state.staged.sourceEventId&&clean(row?.payload?.source_stream)==='interaction'&&clean(row?.payload?.payload?.action)==='flip'),outboxClear=outbox.length===0,pass=eventPresent&&outboxClear&&legacyUnchanged&&cursorAfter>state.staged.cursorBefore,blocking=[];
      if(!eventPresent)blocking.push('Canonical Card Study flip is missing after foreground sync.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!legacyUnchanged)blocking.push('Legacy interaction localStorage changed after flip staging.');if(!(cursorAfter>state.staged.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.staged.cursorBefore}.`);
      state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,staged:false,foregroundSynced:true,cursorAfter,outboxAfter:outbox.length,eventPresent,legacyLocalStorageUntouched:legacyUnchanged,blockingIssues:blocking.length,pass},issues:{blocking,warnings:['This proves the Card Study interaction event-only contract with one real flip. Normal interaction writes are not cut over yet.']}};
      setStatus(pass?`PASS · WID${state.staged.wordId} flip reached Canonical.`:`BLOCKED · ${blocking.join(' ')}`,pass,`cursor ${state.staged.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}`);
    }catch(error){setStatus(`CHECK · ${error?.message||String(error)}`,false,'Foreground sync completed, but local verification could not finish.');}
    finally{try{db?.close();}catch(_){}}
  }

  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  makePanel();setStatus('CHECKING · Waiting for the page-open encounter sync to settle…',null,'Do not flip yet.');
  setTimeout(()=>void arm(),900);
})();
