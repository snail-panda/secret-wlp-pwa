/* WLP v1.8.6.380 — Card Study encounter default Canonical write + lazy official-card bootstrap.
   New normal Card Study encounters remain in the existing local activity history for
   rollback/compatibility and are also queued into Canonical learning_events.
   Normal success is silent. Audit only: ?wlpEncounterWriteAudit=1.
   Explicit rollback: ?wlpLegacyEncounterWrite=1.
   The old manual transport canary remains query-gated and disables this default writer
   when ?wlpEncounterCanary=1 is present, preventing double staging during diagnostics.
   No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.380-card-study-encounter-official-card-bootstrap-master-url-fix-v1';
  const ROLLBACK_FLAG='wlpLegacyEncounterWrite';
  const AUDIT_FLAG='wlpEncounterWriteAudit';
  const MANUAL_CANARY_FLAG='wlpEncounterCanary';
  const RECEIVER_AUDIT_FLAG='wlpEncounterReceiveAudit';
  const INTERACTION_RECEIVER_AUDIT_FLAG='wlpInteractionReceiveAudit';
  const PENDING_KEY='WLP Canonical Card Study Encounter Pending V1';
  const ACTIVITY_KEY='wlp:stage7:activity-events:v1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events',CARD_STORE='cards',CONTENT_STORE='card_content';
  const META_KEY='authority_mirror',CURSOR_KEY='cloud_shadow_steady_sync_v1';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,active:null,bootstrap:null,report:null,panel:null,status:null,detail:null,masterCache:null,preflightWords:new Set()};
  // Capture the root-level script URL while document.currentScript is still available.
  // masterRows() runs later from an event callback, where document.currentScript is null.
  const SCRIPT_URL=document.currentScript?.src||'';
  const MASTER_TSV_URL=SCRIPT_URL?new URL('./flashcards/wlp/wlp-flashcard-master.tsv',SCRIPT_URL).href:new URL('./wlp-flashcard-master.tsv',location.href).href;


  const clean=v=>String(v??'').trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const utf8=v=>new TextEncoder().encode(String(v??''));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',utf8(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const h=new Uint8Array(await crypto.subtle.digest('SHA-1',all)),o=h.slice(0,16);o[6]=(o[6]&15)|80;o[8]=(o[8]&63)|128;return bytesToUuid(o);}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});

  function params(){return new URLSearchParams(location.search);}
  function rollbackActive(){return params().get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return params().get(AUDIT_FLAG)==='1';}
  function manualCanaryActive(){return params().get(MANUAL_CANARY_FLAG)==='1';}
  function receiverAuditActive(){return params().has(RECEIVER_AUDIT_FLAG)||params().has(INTERACTION_RECEIVER_AUDIT_FLAG);}
  function writerActive(){return !rollbackActive()&&!manualCanaryActive()&&!receiverAuditActive();}
  function validEncounter(e){return e&&typeof e==='object'&&clean(e.type)==='study'&&clean(e.action)==='encounter'&&clean(e.wordId)&&Number(e.timestamp)>0&&['source-deck','review-deck','study-set','solo'].includes(clean(e.source));}
  function eventIdentity(e){return`${Number(e.timestamp)}|${clean(e.wordId)}|${clean(e.source)}|${clean(e.deck)}|study|encounter`;}
  function readPending(){try{const v=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return(Array.isArray(v)?v:[]).filter(x=>x&&typeof x==='object'&&validEncounter(x.event));}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-250)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}

  function makePanel(){if(state.panel)return;const p=document.createElement('section');p.id='wlp-encounter-default-write-audit';p.setAttribute('aria-live','polite');p.style.cssText='position:fixed;z-index:100008;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);width:min(650px,calc(100vw - 20px));max-height:42vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 14px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22;text-align:center';p.innerHTML='<strong style="display:block;font-size:13px">Card Study · encounter production-default write audit</strong><div id="wlp-encounter-default-write-status" style="margin-top:4px"></div><div id="wlp-encounter-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';document.body.appendChild(p);state.panel=p;state.status=p.querySelector('#wlp-encounter-default-write-status');state.detail=p.querySelector('#wlp-encounter-default-write-detail');}
  function show(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,m){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(m));await txDone(tx);}
  async function cursorValue(db,meta){const c=await getRow(db,META_STORE,CURSOR_KEY);return Math.max(Number(meta?.materializedSyncCursor??meta?.lastSyncCursor??0),Number(c?.lastSyncCursor||0));}


  function parseTSV(text){
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i+=1){const ch=text[i],next=text[i+1];if(ch==='"'){if(quoted&&next==='"'){field+='"';i+=1;}else quoted=!quoted;}else if(ch==='\t'&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i+=1;row.push(field);if(row.some(v=>String(v).length))rows.push(row);row=[];field='';}else field+=ch;}
    row.push(field);if(row.some(v=>String(v).length))rows.push(row);if(!rows.length)return[];const headers=rows[0].map(v=>String(v||'').trim());return rows.slice(1).filter(r=>r.some(v=>String(v).trim())).map((cols,index)=>{const obj={__masterIndex:index+1};headers.forEach((h,i)=>{obj[h]=String(cols[i]??'');});return obj;});
  }
  async function masterRows(){
    if(state.masterCache)return state.masterCache;
    const response=await fetch(MASTER_TSV_URL,{cache:'no-store'});if(!response.ok)throw new Error(`Master TSV request failed (${response.status}).`);const text=await response.text(),rows=parseTSV(text),hash=await sha256(text);state.masterCache={rows,hash};return state.masterCache;
  }
  async function officialBaseHash(db){
    const tx=db.transaction(CARD_STORE,'readonly'),cursor=tx.objectStore(CARD_STORE).openCursor();const value=await new Promise((resolve,reject)=>{cursor.onsuccess=()=>{const c=cursor.result;if(!c){resolve('');return;}const h=clean(c.value?.payload?.official_base_hash);if(h){resolve(h);return;}c.continue();};cursor.onerror=()=>reject(cursor.error||new Error('Could not read an existing official-base hash.'));});await txDone(tx);return clean(value);
  }
  async function buildOfficialCardBootstrap(db,meta,wordId,cardId){
    const master=await masterRows(),row=master.rows.find(x=>clean(x.WordID)===wordId);if(!row)throw new Error(`WID${wordId} is not present in the deployed Master TSV.`);
    const baseHash=await officialBaseHash(db),now=new Date().toISOString(),sourceContent={Word:row.Word||'',IPA:row.IPA||'','Part of Speech':row['Part of Speech']||'',Definition:row.Definition||'','Synonym(s)':row['Synonym(s)']||'','Example Sentence':row['Example Sentence']||'','Note(s)':row['Note(s)']||'',Category:row.Category||'',Source:row.Source||''},sourcePayloadHash=await sha256(stableStringify(sourceContent));
    const cardPayload={card_id:cardId,legacy_key:`wid:${wordId}`,word_id:Number(wordId),status:'active',origin_kind:'official',origin_ref:null,legacy_batch:Number(clean(row['Batch #']))||null,legacy_guidance:clean(row['Guidance #'])||null,order_key:String(90000000+Number(row.__masterIndex||0)).padStart(8,'0'),official_base_hash:baseHash||master.hash,row_version:1,created_at:null,updated_at:null,created_by_device:null,updated_by_device:null,deleted_at:null};
    const contentPayload={card_id:cardId,word:row.Word||'',ipa:row.IPA||'',part_of_speech:row['Part of Speech']||'',definition:row.Definition||'',synonyms:row['Synonym(s)']||'',example_sentence:row['Example Sentence']||'',notes:row['Note(s)']||'',category:row.Category||'',source:row.Source||'',field_meta:{},row_version:1,updated_at:null,updated_by_device:null,migration_source:'master-incremental-bootstrap',source_payload_hash:sourcePayloadHash};
    const intent={kind:'official-card-incremental-bootstrap',wordId,cardId,masterHash:master.hash,cardPayloadHash:await sha256(stableStringify(cardPayload)),contentPayloadHash:await sha256(stableStringify(contentPayload)),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey)},actionId=await uuidV5(`sync-action|official-card-bootstrap|${await sha256(stableStringify(intent))}`);
    const makeMutation=async(tableName,payload)=>{const mutationId=await uuidV5(`sync-mutation|${tableName}|${actionId}`),m={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:now,diagnosticOnly:false,candidateOnly:false,canonicalOfficialCardBootstrap:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName,rowKey:cardId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};m.mutationHash=await sha256(stableStringify(m));return m;};
    return{actionId,wordId,cardId,mutations:[await makeMutation(CARD_STORE,cardPayload),await makeMutation(CONTENT_STORE,contentPayload)]};
  }
  async function addOutboxMany(db,mutations){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const m of mutations)store.add(clone(m));await txDone(tx);}

  async function idsFor(e){const sourceEventId=await uuidV5(`activity|encounter|${eventIdentity(e)}`),canonicalEventId=await uuidV5(`event|activity:${sourceEventId}`);return{sourceEventId,canonicalEventId};}
  function enqueue(e){if(!validEncounter(e)||!writerActive())return false;const pending=readPending(),key=eventIdentity(e),next={identity:key,event:clone(e),queuedAt:new Date().toISOString()};const i=pending.findIndex(x=>clean(x.identity)===key);if(i>=0)pending[i]=next;else pending.push(next);const ok=writePending(pending);if(ok)show(`QUEUED · WID${clean(e.wordId)} encounter.`,true,`production default · pending ${pending.length}`);return ok;}

  async function drain(){
    if(state.busy||!writerActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){if(state.report?.summary?.pass===true)return;show('READY · Production-default encounter write is active.',true,'No pending encounter · normal Study Card opens queue automatically.');return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Encounter default write requires ACTIVE Authority v3.');
      if(outbox.length){show('WAIT · Another Canonical action is pending.',true,`encounter queue ${pending.length} · outbox ${outbox.length}`);return;}
      while(pending.length){
        const item=pending[0],event=clone(item.event||{});if(!validEncounter(event)){pending.shift();writePending(pending);continue;}
        const wordId=clean(event.wordId),ids=await idsFor(event),existing=await getRow(db,EVENT_STORE,ids.canonicalEventId);
        if(existing){pending.shift();writePending(pending);continue;}
        const cardId=await uuidV5(`card|wid:${wordId}`);let card=await getRow(db,CARD_STORE,cardId);
        if((!card||clean(card?.payload?.word_id)!==wordId)&&!state.preflightWords.has(wordId)&&window.WLPCanonicalForegroundSync?.runSync){state.preflightWords.add(wordId);const pulled=await window.WLPCanonicalForegroundSync.runSync({trigger:'official-card-bootstrap-preflight',receiverOnly:true});if(pulled===null){show(`WAIT · Checking Cloud for WID${wordId} Canonical identity.`,true,'A foreground sync is already running; bootstrap will retry after it finishes.');setTimeout(()=>{void drain();},320);return;}card=await getRow(db,CARD_STORE,cardId);}
        if(!card||clean(card?.payload?.word_id)!==wordId){const bootstrap=await buildOfficialCardBootstrap(db,meta,wordId,cardId);await addOutboxMany(db,bootstrap.mutations);state.bootstrap=bootstrap;state.report={format:'WLP_CANONICAL_CARD_STUDY_ENCOUNTER_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{defaultCutoverActive:true,officialCardBootstrapStaged:true,wordId,pendingAfter:pending.length,outboxAfter:2,blockingIssues:0,pass:true},plan:{actionId:bootstrap.actionId,cardId,bootstrapMutationIds:bootstrap.mutations.map(x=>x.mutationId)}};show(`PENDING · WID${wordId} Canonical card identity bootstrap staged.`,true,'The encounter remains queued and will retry automatically after the card/content pair syncs.');window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'official-card-bootstrap',actionId:bootstrap.actionId,wordId,tableName:'cards',mutationKind:'insert',mutationCount:2}}));return;}
        const occurredAt=new Date(Number(event.timestamp)).toISOString(),intent={kind:'card-study-encounter-default-event',sourceEventId:ids.sourceEventId,canonicalEventId:ids.canonicalEventId,cardId,wordId,timestamp:Number(event.timestamp),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'activity-study-encounter-v1'},actionId=await uuidV5(`sync-action|activity-encounter|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`),eventPayload={event_id:ids.canonicalEventId,source_event_id:ids.sourceEventId,card_id:cardId,session_id:null,event_type:'event',source_stream:'activity',occurred_at:occurredAt,completed_at:occurredAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:1,payload:event,imported_at:null,supersedes_event_id:null},mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalCardStudyEncounterDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:ids.canonicalEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
        const cursorBefore=await cursorValue(db,meta),legacyRawAtStage=localStorage.getItem(ACTIVITY_KEY);await addOutbox(db,mutation);pending.shift();writePending(pending);state.active={actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId,wordId,cursorBefore,legacyRawAtStage};state.report={format:'WLP_CANONICAL_CARD_STUDY_ENCOUNTER_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{defaultCutoverActive:true,wordId,cursorBefore,pendingAfter:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:ids.canonicalEventId,sourceEventId:ids.sourceEventId}};show(`PENDING · WID${wordId} encounter staged automatically.`,true,`cursor ${cursorBefore} · foreground sync will auto-push`);window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'card-study-encounter-default-write',sourceStream:'activity',actionId,wordId,eventType:'event',mutationCount:1}}));return;
      }
      show('READY · Encounter Canonical queue is clear.',true,'No write needed.');
    }catch(error){const m=error?.message||String(error);state.report={format:'WLP_CANONICAL_CARD_STUDY_ENCOUNTER_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[m]}};show(`CHECK · ${m}`,false,'The local encounter remains saved; pending Canonical work is retained for retry.',true);}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function onSyncComplete(ev){
    const d=ev?.detail||{};
    if(state.bootstrap&&clean(d.actionId)===state.bootstrap.actionId){
      if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Official card bootstrap sync did not complete.'}`,false,'The two bootstrap outbox rows and local encounter remain retained for retry.',true);return;}
      let db=null;try{db=await openDb();const [card,content]=await Promise.all([getRow(db,CARD_STORE,state.bootstrap.cardId),getRow(db,CONTENT_STORE,state.bootstrap.cardId)]),ok=Boolean(card&&content&&clean(card?.payload?.word_id)===state.bootstrap.wordId&&clean(content?.payload?.card_id)===state.bootstrap.cardId);if(!ok){show(`CHECK · WID${state.bootstrap.wordId} Canonical card bootstrap did not materialize locally.`,false,'The encounter remains queued for retry.',true);return;}show(`PASS · WID${state.bootstrap.wordId} Canonical card identity registered.`,true,'Queued encounter will continue automatically.');state.bootstrap=null;}catch(error){show(`CHECK · ${error?.message||String(error)}`,false,'Official card bootstrap verification could not finish.',true);}finally{try{db?.close();}catch(_){}}
    }
    if(state.active&&clean(d.actionId)===state.active.actionId){
      if(d.pass!==true){show(`CHECK · ${clean(d.error)||'Foreground sync did not complete.'}`,false,'The staged outbox row is retained for retry.',true);return;}
      let db=null;try{db=await openDb();const [row,outbox,meta]=await Promise.all([getRow(db,EVENT_STORE,state.active.eventId),getAll(db,OUTBOX_STORE),getRow(db,META_STORE,META_KEY)]),cursorAfter=await cursorValue(db,meta),eventPresent=Boolean(row&&clean(row?.payload?.source_event_id)===state.active.sourceEventId&&clean(row?.payload?.source_stream)==='activity'&&clean(row?.payload?.payload?.type)==='study'&&clean(row?.payload?.payload?.action)==='encounter'),outboxClear=outbox.length===0,legacyUnchanged=localStorage.getItem(ACTIVITY_KEY)===state.active.legacyRawAtStage,pass=eventPresent&&outboxClear&&legacyUnchanged&&cursorAfter>state.active.cursorBefore,blocking=[];if(!eventPresent)blocking.push('Canonical encounter is missing after foreground sync.');if(!outboxClear)blocking.push(`sync_outbox is ${outbox.length}; expected 0.`);if(!legacyUnchanged)blocking.push('Legacy activity history changed during Canonical staging/sync.');if(!(cursorAfter>state.active.cursorBefore))blocking.push(`Cursor did not advance beyond ${state.active.cursorBefore}.`);state.report={...state.report,generatedAt:new Date().toISOString(),summary:{...state.report.summary,cursorAfter,outboxAfter:outbox.length,eventPresent,legacyLocalStorageUntouchedDuringCanonicalWrite:legacyUnchanged,blockingIssues:blocking.length,pass},issues:{blocking,warnings:['Normal Study Card encounter writes are now Canonical by default while the legacy activity history remains for rollback/compatibility.']}};show(pass?`PASS · Production-default WID${state.active.wordId} encounter reached Canonical.`:`CHECK · ${blocking.join(' ')}`,pass,`cursor ${state.active.cursorBefore} → ${cursorAfter} · outbox ${outbox.length}`);state.active=null;}catch(error){show(`CHECK · ${error?.message||String(error)}`,false,'Foreground sync completed but local verification could not finish.',true);}finally{try{db?.close();}catch(_){}};
    }
    setTimeout(()=>{void drain();},120);
  }

  function onEncounter(ev){if(!writerActive())return;const event=ev?.detail?.event;if(!validEncounter(event)){show('CHECK · Recorded encounter could not be queued.',false,'The local activity event remains saved.',true);return;}if(!enqueue(event)){show('CHECK · Encounter pending queue could not be saved.',false,'The local activity event remains saved.',true);return;}void drain();}

  window.addEventListener('wlp-card-study-encounter-recorded',onEncounter);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalCardStudyEncounterWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,auditFlag:AUDIT_FLAG,drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length,isActive:writerActive});
  if(auditActive())show(rollbackActive()?'ROLLBACK · Production-default encounter write is disabled.':manualCanaryActive()?'DIAGNOSTIC · Manual encounter canary owns writes on this page.':receiverAuditActive()?'DIAGNOSTIC · Receiver audit is read-only; default encounter write is suppressed on this page.':'READY · Production-default encounter write is active.',true,`pending ${readPending().length} · audit query does not activate the write`);
  if(writerActive())setTimeout(()=>{void drain();},0);
})();
