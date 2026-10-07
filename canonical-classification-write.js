/* WLP v1.8.6.384 — Classification Canonical create + safe portable-import queue.
   Scope:
   - preserves v382 existing-row guarded Classification upserts;
   - allows a missing card_classification row to be created only after the official
     Canonical card identity exists;
   - portable Classification imports enqueue changed official WIDs and drain them
     one Canonical action at a time;
   - missing official card identities use the already-proven cards + card_content
     lazy bootstrap shape before Classification creation;
   - pending Classification work is persisted locally so reload/close does not lose it;
   - no Service Worker/background sync is used. */
(() => {
  'use strict';

  const APP_VERSION='1.8.6.386-classification-bootstrap-preflight-backlog-guard-v1';
  const PENDING_KEY='WLP Canonical Classification Pending V1';
  const DB_NAME='wlp-cloud-v1',DB_VERSION=1;
  const META_STORE='sync_meta',OUTBOX_STORE='sync_outbox',CARD_STORE='cards',CONTENT_STORE='card_content',CLASS_STORE='card_classification',META_KEY='authority_mirror';
  const NAMESPACE_UUID='87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BASE=Object.freeze({candidateKey:'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',headVersion:3,manifestHash:'2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63'});
  const api=window.WLPClassificationMetadata;
  const SCRIPT_URL=document.currentScript?.src||'';
  const MASTER_TSV_URL=SCRIPT_URL?new URL('./flashcards/wlp/wlp-flashcard-master.tsv',SCRIPT_URL).href:new URL('./flashcards/wlp/wlp-flashcard-master.tsv',location.href).href;
  const state={busy:false,active:null,bootstrap:null,masterCache:null,preflightWords:new Set(),report:null};

  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  function stableValue(v){if(Array.isArray(v))return v.map(stableValue);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{if(v[k]!==undefined)o[k]=stableValue(v[k]);});return o;}return v;}
  const stableStringify=v=>JSON.stringify(stableValue(v));
  const utf8=v=>new TextEncoder().encode(String(v??''));
  async function sha256(v){const d=await crypto.subtle.digest('SHA-256',utf8(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function uuidToBytes(v){const h=String(v||'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/i.test(h))throw new Error('Invalid UUID namespace.');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));}
  function bytesToUuid(b){const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  async function uuidV5(name){const a=uuidToBytes(NAMESPACE_UUID),b=utf8(name),all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);const h=new Uint8Array(await crypto.subtle.digest('SHA-1',all)),o=h.slice(0,16);o[6]=(o[6]&15)|80;o[8]=(o[8]&63)|128;return bytesToUuid(o);}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB request failed.'));});
  const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onabort=()=>rej(t.error||new Error('IndexedDB transaction aborted.'));t.onerror=()=>rej(t.error||new Error('IndexedDB transaction failed.'));});

  function emptyQueue(){return{version:1,items:[],batch:null};}
  function readQueue(){
    try{
      const parsed=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
      if(Array.isArray(parsed))return{version:1,items:parsed.filter(x=>x&&/^wid:\d+$/.test(clean(x.key))),batch:null};
      if(!parsed||typeof parsed!=='object')return emptyQueue();
      const items=(Array.isArray(parsed.items)?parsed.items:[]).filter(x=>x&&/^wid:\d+$/.test(clean(x.key))).map(x=>({key:clean(x.key),source:clean(x.source)||'local-save',queuedAt:clean(x.queuedAt)||new Date().toISOString()}));
      const batch=parsed.batch&&typeof parsed.batch==='object'?clone(parsed.batch):null;
      return{version:1,items,batch};
    }catch(_){return emptyQueue();}
  }
  function writeQueue(q){
    const cleanQueue={version:1,items:Array.isArray(q?.items)?q.items:[],batch:q?.batch&&typeof q.batch==='object'?q.batch:null};
    if(!cleanQueue.items.length&&!cleanQueue.batch)localStorage.removeItem(PENDING_KEY);else localStorage.setItem(PENDING_KEY,JSON.stringify(cleanQueue));
    return cleanQueue;
  }
  function batchProgress(q){
    const b=q?.batch;if(!b||!Array.isArray(b.keys)||!b.keys.length)return null;
    const pending=new Set((q.items||[]).map(x=>clean(x.key))),total=Number(b.total)||b.keys.length,remaining=b.keys.filter(k=>pending.has(clean(k))).length,done=Math.max(0,total-remaining);
    return{total,remaining,done,completedAt:clean(b.completedAt),startedAt:clean(b.startedAt)};
  }
  function showProgress(message='',error=false){
    const el=document.getElementById('classification-import-status');
    if(!el)return;
    if(!message){el.hidden=true;return;}
    el.hidden=false;el.textContent=message;el.classList.toggle('is-error',Boolean(error));
  }
  function refreshProgress(extra=''){
    const q=readQueue(),p=batchProgress(q);
    if(p){
      if(p.remaining===0){showProgress(`Canonical Classification sync complete · ${p.total.toLocaleString()}/${p.total.toLocaleString()} processed.${extra?` ${extra}`:''}`);return;}
      showProgress(`Canonical Classification sync · ${p.done.toLocaleString()}/${p.total.toLocaleString()} processed · ${p.remaining.toLocaleString()} remaining.${extra?` ${extra}`:''}`);return;
    }
    if(extra)showProgress(extra);
  }
  function enqueueKeys(keys,source){
    const valid=[...new Set((Array.isArray(keys)?keys:[]).map(clean).filter(k=>/^wid:\d+$/.test(k)&&api?.hasClassification?.(api.get(k))))];
    if(!valid.length)return 0;
    const q=readQueue(),existing=new Set(q.items.map(x=>x.key)),now=new Date().toISOString();
    valid.forEach(key=>{if(!existing.has(key)){q.items.push({key,source:clean(source)||'local-save',queuedAt:now});existing.add(key);}});
    if(source==='portable-merge')q.batch={source:'portable-merge',total:valid.length,keys:valid,startedAt:now,completedAt:''};
    writeQueue(q);setTimeout(()=>refreshProgress(),0);return valid.length;
  }
  function finishKey(key){
    const q=readQueue();q.items=q.items.filter(x=>x.key!==key);
    if(q.batch&&Array.isArray(q.batch.keys)){const left=new Set(q.items.map(x=>x.key));if(q.batch.keys.every(k=>!left.has(clean(k))))q.batch.completedAt=new Date().toISOString();}
    writeQueue(q);refreshProgress();
  }

  function openDb(){return new Promise((res,rej)=>{let upgrading=false;const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{upgrading=true;try{r.transaction.abort();}catch(_){}};r.onsuccess=()=>{const db=r.result;if(upgrading){db.close();rej(new Error('wlp-cloud-v1 is not installed at schema v1.'));return;}const missing=[META_STORE,OUTBOX_STORE,CARD_STORE,CONTENT_STORE,CLASS_STORE].filter(x=>!db.objectStoreNames.contains(x));if(missing.length){db.close();rej(new Error(`Missing Canonical store(s): ${missing.join(', ')}.`));return;}res(db);};r.onerror=()=>rej(r.error||new Error('Could not open wlp-cloud-v1.'));r.onblocked=()=>rej(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));});}
  async function getRow(db,store,key){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).get(key));await txDone(tx);return v||null;}
  async function getAll(db,store){const tx=db.transaction(store,'readonly'),v=await req(tx.objectStore(store).getAll());await txDone(tx);return Array.isArray(v)?v:[];}
  async function addOutbox(db,row){const tx=db.transaction(OUTBOX_STORE,'readwrite');tx.objectStore(OUTBOX_STORE).add(clone(row));await txDone(tx);}
  async function addOutboxMany(db,rows){const tx=db.transaction(OUTBOX_STORE,'readwrite'),store=tx.objectStore(OUTBOX_STORE);for(const row of rows)store.add(clone(row));await txDone(tx);}

  function tags(v){return Array.isArray(v)?v.map(clean).filter(Boolean):[];}
  function sameArray(a,b){const x=tags(a),y=tags(b);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
  function sameClassificationPayload(payload,record){return Boolean(payload)&&sameArray(payload.entry_types,record.entryTypes)&&sameArray(payload.usage_tags,record.usageTags)&&sameArray(payload.topic_tags,record.topicTags)&&sameArray(payload.discovery_tags,record.discoveryTags);}
  function changedFields(current,next){const out=[];if(!sameArray(current.entry_types,next.entry_types))out.push('entry_types');if(!sameArray(current.usage_tags,next.usage_tags))out.push('usage_tags');if(!sameArray(current.topic_tags,next.topic_tags))out.push('topic_tags');if(!sameArray(current.discovery_tags,next.discovery_tags))out.push('discovery_tags');return out;}

  function parseTSV(text){
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i+=1){const ch=text[i],next=text[i+1];if(ch==='"'){if(quoted&&next==='"'){field+='"';i+=1;}else quoted=!quoted;}else if(ch==='\t'&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i+=1;row.push(field);if(row.some(v=>String(v).length))rows.push(row);row=[];field='';}else field+=ch;}
    row.push(field);if(row.some(v=>String(v).length))rows.push(row);if(!rows.length)return[];const headers=rows[0].map(v=>String(v||'').trim());return rows.slice(1).filter(r=>r.some(v=>String(v).trim())).map((cols,index)=>{const obj={__masterIndex:index+1};headers.forEach((h,i)=>{obj[h]=String(cols[i]??'');});return obj;});
  }
  async function masterRows(){if(state.masterCache)return state.masterCache;const response=await fetch(MASTER_TSV_URL,{cache:'no-store'});if(!response.ok)throw new Error(`Master TSV request failed (${response.status}).`);const text=await response.text(),rows=parseTSV(text),hash=await sha256(text);state.masterCache={rows,hash};return state.masterCache;}
  async function officialBaseHash(db){const tx=db.transaction(CARD_STORE,'readonly'),cursor=tx.objectStore(CARD_STORE).openCursor();const value=await new Promise((resolve,reject)=>{cursor.onsuccess=()=>{const c=cursor.result;if(!c){resolve('');return;}const h=clean(c.value?.payload?.official_base_hash);if(h){resolve(h);return;}c.continue();};cursor.onerror=()=>reject(cursor.error||new Error('Could not read an existing official-base hash.'));});await txDone(tx);return clean(value);}
  async function buildOfficialCardBootstrap(db,meta,wordId,cardId){
    const master=await masterRows(),row=master.rows.find(x=>clean(x.WordID)===wordId);if(!row)throw new Error(`WID${wordId} is not present in the deployed Master TSV.`);
    const baseHash=await officialBaseHash(db),now=new Date().toISOString(),sourceContent={Word:row.Word||'',IPA:row.IPA||'','Part of Speech':row['Part of Speech']||'',Definition:row.Definition||'','Synonym(s)':row['Synonym(s)']||'','Example Sentence':row['Example Sentence']||'','Note(s)':row['Note(s)']||'',Category:row.Category||'',Source:row.Source||''},sourcePayloadHash=await sha256(stableStringify(sourceContent));
    const cardPayload={card_id:cardId,legacy_key:`wid:${wordId}`,word_id:Number(wordId),status:'active',origin_kind:'official',origin_ref:null,legacy_batch:Number(clean(row['Batch #']))||null,legacy_guidance:clean(row['Guidance #'])||null,order_key:String(90000000+Number(row.__masterIndex||0)).padStart(8,'0'),official_base_hash:baseHash||master.hash,row_version:1,created_at:null,updated_at:null,created_by_device:null,updated_by_device:null,deleted_at:null};
    const contentPayload={card_id:cardId,word:row.Word||'',ipa:row.IPA||'',part_of_speech:row['Part of Speech']||'',definition:row.Definition||'',synonyms:row['Synonym(s)']||'',example_sentence:row['Example Sentence']||'',notes:row['Note(s)']||'',category:row.Category||'',source:row.Source||'',field_meta:{},row_version:1,updated_at:null,updated_by_device:null,migration_source:'master-incremental-bootstrap',source_payload_hash:sourcePayloadHash};
    const intent={kind:'official-card-incremental-bootstrap',wordId,cardId,masterHash:master.hash,cardPayloadHash:await sha256(stableStringify(cardPayload)),contentPayloadHash:await sha256(stableStringify(contentPayload)),baseHeadVersion:Number(meta.headVersion||0),baseCandidateKey:clean(meta.candidateKey)},actionId=await uuidV5(`sync-action|official-card-bootstrap|${await sha256(stableStringify(intent))}`);
    const makeMutation=async(tableName,payload)=>{const mutationId=await uuidV5(`sync-mutation|${tableName}|${actionId}`),m={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:now,diagnosticOnly:false,candidateOnly:false,canonicalOfficialCardBootstrap:true,transportEligible:true,status:'pending',mutationId,mutationKind:'insert',tableName,rowKey:cardId,precondition:{rowMustBeAbsent:true},payload,payloadHash:await sha256(stableStringify(payload))};m.mutationHash=await sha256(stableStringify(m));return m;};
    return{actionId,wordId,cardId,mutations:[await makeMutation(CARD_STORE,cardPayload),await makeMutation(CONTENT_STORE,contentPayload)]};
  }

  async function buildClassificationMutation(meta,key,cardId,current){
    const record=api.get(key),now=clean(record.updatedAt)||new Date().toISOString(),deviceKey=String(meta.deviceKey||'');
    if(current?.payload&&current.payloadHash){
      const p=current.payload,next={...clone(p),card_id:cardId,entry_types:tags(record.entryTypes),usage_tags:tags(record.usageTags),topic_tags:tags(record.topicTags),discovery_tags:tags(record.discoveryTags),revision:Math.max(1,Number(p.revision)||1)+1,field_meta:(p.field_meta&&typeof p.field_meta==='object'&&!Array.isArray(p.field_meta))?clone(p.field_meta):{},updated_at:now,updated_by_device:deviceKey,deleted_at:null};
      const changed=changedFields(p,next);if(!changed.length)return{status:'noop'};
      const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalClassificationDefaultWrite:true,canonicalClassificationCreate:false,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:CLASS_STORE,rowKey:cardId,precondition:{payloadHash:String(current.payloadHash)},changedFields:changed,payload:next,payloadHash:await sha256(stableStringify(next))};mutation.mutationHash=await sha256(stableStringify(mutation));return{status:'ready',mode:'update',actionId,mutation};
    }
    const payload={card_id:cardId,entry_types:tags(record.entryTypes),usage_tags:tags(record.usageTags),topic_tags:tags(record.topicTags),discovery_tags:tags(record.discoveryTags),revision:1,field_meta:{},updated_at:now,updated_by_device:deviceKey,deleted_at:null};
    const actionId=crypto.randomUUID(),mutationId=crypto.randomUUID(),changedFields=['entry_types','usage_tags','topic_tags','discovery_tags','revision','field_meta','updated_at','updated_by_device','deleted_at'],mutation={schemaVersion:1,baseAuthority:{candidateKey:meta.candidateKey,headVersion:Number(meta.headVersion||0),snapshotManifestHash:meta.snapshotManifestHash},deviceKey:meta.deviceKey||null,actionId,createdAt:new Date().toISOString(),diagnosticOnly:false,candidateOnly:false,canonicalClassificationDefaultWrite:true,canonicalClassificationCreate:true,transportEligible:true,status:'pending',mutationId,mutationKind:'upsert',tableName:CLASS_STORE,rowKey:cardId,precondition:{mustBeMissing:true},changedFields,payload,payloadHash:await sha256(stableStringify(payload))};mutation.mutationHash=await sha256(stableStringify(mutation));return{status:'ready',mode:'create',actionId,mutation};
  }

  async function drain(){
    if(state.busy||!api)return;state.busy=true;let db=null;
    try{
      let q=readQueue();
      while(q.items.length){
        const key=clean(q.items[0]?.key),record=api.get(key);
        if(!/^wid:\d+$/.test(key)||!api.hasClassification(record)){finishKey(key);q=readQueue();continue;}
        const wid=key.slice(4);
        db=await openDb();
        const [meta,outbox]=await Promise.all([getRow(db,META_STORE,META_KEY),getAll(db,OUTBOX_STORE)]);
        if(!meta||clean(meta.candidateKey)!==BASE.candidateKey||Number(meta.headVersion||0)!==BASE.headVersion||clean(meta.snapshotManifestHash)!==BASE.manifestHash)throw new Error('Classification Canonical write requires ACTIVE Authority v3.');
        if(outbox.length){refreshProgress(`Waiting for ${outbox.length.toLocaleString()} pending Canonical outbox row${outbox.length===1?'':'s'} to clear.`);return;}

        const cardId=await uuidV5(`card|wid:${wid}`);let card=await getRow(db,CARD_STORE,cardId);
        if((!card||clean(card?.payload?.word_id)!==wid)&&!state.preflightWords.has(wid)&&window.WLPCanonicalForegroundSync?.runSync){
          state.preflightWords.add(wid);refreshProgress(`Checking Cloud for WID${wid} card identity…`);
          const pulled=await window.WLPCanonicalForegroundSync.runSync({trigger:'classification-card-identity-preflight',receiverOnly:true});
          if(pulled===null){state.preflightWords.delete(wid);setTimeout(()=>{void drain();},320);return;}
          card=await getRow(db,CARD_STORE,cardId);
          if((!card||clean(card?.payload?.word_id)!==wid)&&Number(pulled?.summary?.pendingRemoteChangeRows||0)>0){state.preflightWords.delete(wid);refreshProgress(`Catching up Cloud before WID${wid} card bootstrap · ${Number(pulled.summary.pendingRemoteChangeRows||0)} later remote change row(s) pending.`);setTimeout(()=>{void drain();},320);return;}
        }
        if(!card||clean(card?.payload?.word_id)!==wid){
          const bootstrap=await buildOfficialCardBootstrap(db,meta,wid,cardId);await addOutboxMany(db,bootstrap.mutations);state.bootstrap={...bootstrap,key};
          refreshProgress(`WID${wid} official card identity bootstrap staged.`);
          window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'official-card-bootstrap',actionId:bootstrap.actionId,wordId:wid,tableName:'cards',mutationKind:'insert',mutationCount:2}}));
          return;
        }

        const current=await getRow(db,CLASS_STORE,cardId);
        if(current?.payload&&sameClassificationPayload(current.payload,record)){finishKey(key);q=readQueue();db.close();db=null;continue;}
        const built=await buildClassificationMutation(meta,key,cardId,current);
        if(built.status==='noop'){finishKey(key);q=readQueue();db.close();db=null;continue;}
        await addOutbox(db,built.mutation);state.active={actionId:built.actionId,key,wid,cardId,mode:built.mode};
        refreshProgress(`WID${wid} Classification ${built.mode==='create'?'create':'update'} staged.`);
        window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged',{detail:{source:'classification-default-write',tableName:CLASS_STORE,mutationKind:'upsert',actionId:built.actionId,mutationCount:1,wordId:wid}}));
        return;
      }
      refreshProgress();
    }catch(error){const message=error?.message||String(error);state.report={format:'WLP_CANONICAL_CLASSIFICATION_WRITE',version:2,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),summary:{pending:readQueue().items.length,blockingIssues:1,pass:false},issues:{blocking:[message]}};showProgress(`CHECK · Classification Canonical sync stopped. ${message}`,true);console.error('WLP Classification Canonical queue failed:',error);}
    finally{try{db?.close();}catch(_){}state.busy=false;}
  }

  async function verifyActiveAndFinish(){
    const active=state.active;if(!active)return;let db=null;
    try{
      db=await openDb();const row=await getRow(db,CLASS_STORE,active.cardId),record=api.get(active.key);
      if(!row?.payload||!sameClassificationPayload(row.payload,record)){refreshProgress(`WID${active.wid} synced, but local Canonical verification does not yet match; retry retained.`);state.active=null;setTimeout(()=>{void drain();},160);return;}
      finishKey(active.key);state.active=null;setTimeout(()=>{void drain();},120);
    }catch(error){showProgress(`CHECK · Could not verify WID${active.wid} Classification after sync. ${error?.message||String(error)}`,true);state.active=null;}
    finally{try{db?.close();}catch(_){}}
  }

  function onChanged(event){
    const d=event?.detail||{},source=clean(d.source);if(source!=='local-save'&&source!=='portable-merge')return;
    const keys=Array.isArray(d.changedKeys)?d.changedKeys:[];if(!enqueueKeys(keys,source))return;setTimeout(()=>{void drain();},0);
  }
  function onSyncComplete(event){
    const d=event?.detail||{},actionId=clean(d.actionId);
    if(state.bootstrap&&actionId===state.bootstrap.actionId){
      if(d.pass!==true){showProgress(`CHECK · WID${state.bootstrap.wordId} card identity bootstrap did not complete. ${clean(d.error)}`,true);return;}
      state.bootstrap=null;setTimeout(()=>{void drain();},120);return;
    }
    if(state.active&&actionId===state.active.actionId){
      if(d.pass!==true){showProgress(`CHECK · WID${state.active.wid} Classification sync did not complete. ${clean(d.error)}`,true);return;}
      void verifyActiveAndFinish();return;
    }
    if(d.pass===true)setTimeout(()=>{void drain();},160);
  }

  if(api?.EVENT_NAME)window.addEventListener(api.EVENT_NAME,onChanged);
  window.addEventListener('wlp-canonical-auto-sync-complete',onSyncComplete);
  window.WLPCanonicalClassificationWrite=Object.freeze({version:2,appVersion:APP_VERSION,drain,pendingCount:()=>readQueue().items.length,getReport:()=>clone(state.report)});
  setTimeout(()=>{refreshProgress();void drain();},0);
})();
