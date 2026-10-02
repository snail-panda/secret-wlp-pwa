/* WLP v1.8.6.287 — Standard Practice default Canonical rating-correction write.
   Local Standard Practice history remains the immediate UI/rollback record. Each accepted history
   rating edit is also queued as an append-only Canonical learning_events rating_correction.
   Corrections form a linear supersedes_event_id chain rooted at the immutable Standard event.
   Explicit rollback: ?wlpLegacyStandardRatingWrite=1. No Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.287-standard-rating-correction-default-write-v1';
  const ROLLBACK_FLAG='wlpLegacyStandardRatingWrite';
  const AUDIT_FLAG='wlpStandardRatingWriteAudit';
  const PENDING_KEY='WLP Canonical Standard Rating Correction Pending V1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',EVENT_STORE='learning_events',CARD_STORE='cards';
  const META_KEY='authority_mirror';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const RATINGS=new Set(['got-it','almost','not-yet','no-idea']);
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const state={busy:false,report:null,panel:null,status:null,detail:null};

  const clean=value=>String(value??'').trim();
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=stableValue(value[key]);});return out;}return value;}
  const stableStringify=value=>JSON.stringify(stableValue(value));
  const utf8=value=>new TextEncoder().encode(String(value??''));
  async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',utf8(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(value){const hex=String(value||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(hex))throw new Error('Invalid UUID namespace.');return new Uint8Array(hex.match(/../g).map(pair=>parseInt(pair,16)));}
  function bytesToUuid(bytes){const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',all));const out=hash.slice(0,16);out[6]=(out[6]&0x0f)|0x50;out[8]=(out[8]&0x3f)|0x80;return bytesToUuid(out);}
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
  const txDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));});

  function rollbackActive(){return new URLSearchParams(location.search).get(ROLLBACK_FLAG)==='1';}
  function auditActive(){return new URLSearchParams(location.search).get(AUDIT_FLAG)==='1';}
  function readPending(){try{const value=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch(_){return[];}}
  function writePending(items){try{if(items.length)localStorage.setItem(PENDING_KEY,JSON.stringify(items.slice(-100)));else localStorage.removeItem(PENDING_KEY);return true;}catch(_){return false;}}
  function validRating(value){return RATINGS.has(clean(value));}

  function makePanel(){
    if(state.panel)return;
    const panel=document.createElement('section');panel.id='wlp-standard-rating-default-write-audit';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:fixed;z-index:100004;right:8px;top:max(8px,env(safe-area-inset-top));width:min(420px,calc(100vw - 16px));max-height:48vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML='<strong style="display:block;font-size:13px">Canonical Standard Practice · rating correction default write</strong><div id="wlp-standard-rating-default-write-status" style="margin-top:4px"></div><div id="wlp-standard-rating-default-write-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(panel);state.panel=panel;state.status=panel.querySelector('#wlp-standard-rating-default-write-status');state.detail=panel.querySelector('#wlp-standard-rating-default-write-detail');
  }
  function setStatus(text,ok=null,detail='',force=false){if(!force&&!auditActive())return;makePanel();state.status.textContent=text;state.status.style.fontWeight=ok===null?'500':'700';state.status.style.color=ok===true?'#18794e':ok===false?'#b42318':'#1c2d22';state.detail.textContent=detail;}

  function openDb(){return new Promise((resolve,reject)=>{let upgrading=false;const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{upgrading=true;try{request.transaction.abort();}catch(_){}};request.onsuccess=()=>{const db=request.result;if(upgrading){db.close();reject(new Error('wlp-cloud-v1 is not already installed at schema v1.'));return;}const required=[META_STORE,OUTBOX_STORE,EVENT_STORE,CARD_STORE],missing=required.filter(store=>!db.objectStoreNames.contains(store));if(missing.length){db.close();reject(new Error(`Missing IndexedDB store(s): ${missing.join(', ')}.`));return;}resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open wlp-cloud-v1.'));request.onblocked=()=>reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).get(key));await txDone(tx);return value||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),value=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(value)?value:[];}
  async function getMeta(db,key){return getRow(db,META_STORE,key);}
  async function getOutbox(db){return getAll(db,OUTBOX_STORE);}
  async function addOutbox(db,mutation){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(mutation));await txDone(tx);}

  function enqueue(detail){
    const sourceEventId=clean(detail?.eventId),wordId=clean(detail?.wordId),rating=clean(detail?.rating),previousRating=clean(detail?.previousRating),ratingUpdatedAt=clean(detail?.ratingUpdatedAt);
    if(!sourceEventId||!wordId||!validRating(rating)||!ratingUpdatedAt||rating===previousRating)return rating===previousRating;
    if(previousRating&&!validRating(previousRating))return false;
    const pending=readPending(),key=`${sourceEventId}\u0000${ratingUpdatedAt}\u0000${rating}`;
    const next={key,sourceEventId,wordId,previousRating,rating,ratingUpdatedAt,queuedAt:new Date().toISOString()};
    const index=pending.findIndex(item=>clean(item?.key)===key);
    if(index>=0)pending[index]=next;else pending.push(next);
    return writePending(pending);
  }

  function envelope(row){return row?.payload&&typeof row.payload==='object'?row.payload:null;}
  function effectiveRating(eventPayload){
    if(!eventPayload)return'';
    if(clean(eventPayload.event_type)==='event')return clean(eventPayload?.payload?.selfRating);
    if(clean(eventPayload.event_type)==='rating_correction')return clean(eventPayload?.payload?.rating);
    return'';
  }
  function correctionRoot(eventPayload){return clean(eventPayload?.payload?.originalCanonicalEventId);}
  function correctionOriginalSource(eventPayload){return clean(eventPayload?.payload?.originalEventId);}

  async function resolveTail(db,rootEventId,sourceEventId,cardId){
    const rootRow=await getRow(db,EVENT_STORE,rootEventId),root=envelope(rootRow);
    if(!root||clean(root.event_type)!=='event'||clean(root.source_stream)!=='standard')return null;
    if(clean(root.card_id)!==cardId||clean(root.source_event_id)!==sourceEventId)throw new Error('Canonical Standard root event identity does not match the local rating edit.');
    const rows=await getAll(db,EVENT_STORE),children=new Map();
    for(const row of rows){
      const event=envelope(row);if(!event||clean(event.event_type)!=='rating_correction'||clean(event.source_stream)!=='standard')continue;
      if(clean(event.card_id)!==cardId||correctionRoot(event)!==rootEventId||correctionOriginalSource(event)!==sourceEventId)continue;
      const parent=clean(event.supersedes_event_id);if(!parent)continue;
      if(!children.has(parent))children.set(parent,[]);children.get(parent).push({row,event});
    }
    let tailId=rootEventId,tailEvent=root,depth=0;
    const seen=new Set([tailId]);
    while(true){
      const next=children.get(tailId)||[];
      if(next.length>1)throw new Error('Canonical Standard rating history has more than one correction branch; automatic correction is blocked.');
      if(!next.length)break;
      const child=next[0],childId=clean(child.event.event_id||child.row?.rowKey);
      if(!childId||seen.has(childId))throw new Error('Canonical Standard rating correction chain is invalid.');
      seen.add(childId);tailId=childId;tailEvent=child.event;depth++;
    }
    return{rootRow,root,tailId,tailEvent,depth,effectiveRating:effectiveRating(tailEvent)};
  }

  async function drain(){
    if(state.busy||rollbackActive())return;state.busy=true;let db=null;
    try{
      let pending=readPending();
      if(!pending.length){setStatus('READY · No pending Standard rating corrections.',true,'Normal history rating edits are queued automatically.');return;}
      db=await openDb();const [meta,outbox]=await Promise.all([getMeta(db,META_KEY),getOutbox(db)]);
      if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Standard rating correction default write requires ACTIVE Authority v3.');
      if(outbox.length){setStatus('WAIT · Another Canonical action is pending.',true,`rating queue ${pending.length} · outbox ${outbox.length}`);return;}

      while(pending.length){
        const item=pending[0],sourceEventId=clean(item.sourceEventId),wordId=clean(item.wordId),previousRating=clean(item.previousRating),rating=clean(item.rating),ratingUpdatedAt=clean(item.ratingUpdatedAt);
        if(!sourceEventId||!wordId||!validRating(rating)||!ratingUpdatedAt||rating===previousRating||(previousRating&&!validRating(previousRating))){pending.shift();writePending(pending);continue;}
        const rootEventId=await uuidV5(`event|standard:${sourceEventId}`),cardId=await uuidV5(`card|wid:${wordId}`),card=await getRow(db,CARD_STORE,cardId);
        if(!card||clean(card?.payload?.word_id)!==wordId)throw new Error(`Canonical card identity for WID${wordId} could not be resolved.`);
        const tail=await resolveTail(db,rootEventId,sourceEventId,cardId);
        if(!tail){setStatus(`WAIT · WID${wordId} Standard source event is not Canonical yet.`,true,`rating queue ${pending.length} · will retry after foreground sync`);return;}
        if(clean(tail.effectiveRating)!==previousRating)throw new Error(`WID${wordId} rating precondition changed (${previousRating||'unrated'} → ${tail.effectiveRating||'unrated'} in Canonical). Automatic overwrite is blocked.`);

        const correctionSourceId=`rating-correction:${sourceEventId}:${ratingUpdatedAt}:${rating}`,correctionEventId=await uuidV5(`event|standard-rating-correction:${correctionSourceId}`),existing=await getRow(db,EVENT_STORE,correctionEventId);
        if(existing){pending.shift();writePending(pending);continue;}
        const occurredAt=new Date(Date.parse(ratingUpdatedAt)||Date.now()).toISOString();
        const intent={kind:'standard-practice-rating-correction-default',correctionSourceId,correctionEventId,rootEventId,supersedesEventId:tail.tailId,sourceEventId,cardId,wordId,previousRating,rating,ratingUpdatedAt,chainDepth:tail.depth+1,baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey),contract:'standard-rating-correction-chain-v2'};
        const actionId=await uuidV5(`sync-action|standard-rating-correction|${await sha256(stableStringify(intent))}`),mutationId=await uuidV5(`sync-mutation|learning_events|${actionId}`);
        const eventPayload={event_id:correctionEventId,source_event_id:correctionSourceId,card_id:cardId,session_id:null,event_type:'rating_correction',source_stream:'standard',occurred_at:occurredAt,completed_at:occurredAt,device_id:meta.deviceKey||null,legacy_word_id:Number(wordId),schema_version:2,payload:{action:'standard_rating_correction',source:'standard-practice-history',wordId,originalEventId:sourceEventId,originalCanonicalEventId:rootEventId,supersedesEventId:tail.tailId,previousRating,rating,ratingUpdatedAt,chainDepth:tail.depth+1},imported_at:null,supersedes_event_id:tail.tailId};
        const mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalStandardRatingCorrectionDefaultWrite:true,transportEligible:true,status:'pending',mutationId,mutationKind:'append',tableName:'learning_events',rowKey:correctionEventId,precondition:{rowMustBeAbsent:true},payload:eventPayload,payloadHash:await sha256(stableStringify(eventPayload))};mutation.mutationHash=await sha256(stableStringify(mutation));
        await addOutbox(db,mutation);pending.shift();writePending(pending);
        state.report={format:'WLP_CANONICAL_STANDARD_RATING_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{wordId,sourceEventId,eventType:'rating_correction',previousRating,rating,chainDepth:tail.depth+1,pendingAfter:pending.length,outboxAfter:1,blockingIssues:0,pass:true},plan:{actionId,mutationId,eventId:correctionEventId,rootEventId,supersedesEventId:tail.tailId}};
        setStatus(`PENDING · WID${wordId} rating ${previousRating||'unrated'} → ${rating} staged.`,true,`chain ${tail.depth+1} · queue ${pending.length} · foreground sync will auto-push`);
        window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'standard-rating-default-write',sourceStream:'standard',actionId,wordId,eventType:'rating_correction',mutationCount:1}}));
        return;
      }
      setStatus('READY · Standard rating correction queue is clear.',true,'No write needed.');
    }catch(error){
      const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_STANDARD_RATING_DEFAULT_WRITE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{blockingIssues:1,pass:false},issues:{blocking:[message]}};setStatus(`CHECK · ${message}`,false,'Pending rating correction data is retained locally; Canonical history was not silently overwritten.',true);
    }finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  function onCorrected(event){if(rollbackActive())return;const detail=event?.detail||{};if(!enqueue(detail)){setStatus('CHECK · Standard Practice rating correction could not be queued.',false,'The local Standard Practice history remains saved.',true);return;}void drain();}
  function onSyncComplete(){setTimeout(()=>{void drain();},140);}

  window.addEventListener('wlp-standard-practice-rating-corrected',onCorrected);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalStandardRatingWrite=Object.freeze({version:1,appVersion:APP_VERSION,rollbackFlag:ROLLBACK_FLAG,drain,getReport:()=>clone(state.report),pendingCount:()=>readPending().length});
  if(auditActive())setStatus(rollbackActive()?'ROLLBACK · Standard rating Canonical default write disabled.':'READY · Standard rating corrections use append-only Canonical outbox.',true,`pending ${readPending().length}`);
  if(!rollbackActive())setTimeout(()=>{void drain();},0);
})();
