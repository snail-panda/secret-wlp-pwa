/* WLP P1-C4: explicit local-only, account-bound field decision receipts.
   Stores no vocabulary text, no credentials, no Master/Local edits; NEVER applies
   receipts to the live WLP. Historical receipts are retained, including stale ones. */
(() => {
  'use strict';
  const DB='wlp-p1c4-local-review-receipts-v1', STORE='receipts';
  const HEX64=/^[a-f0-9]{64}$/i;
  const APPROVALS=new Set(['canonical','local']);
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const sha=async v=>{
    const bytes=new TextEncoder().encode(String(v));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const context=m=>({
    accountKey:m.accountKey,generation:m.generation,cursor:m.cursor,
    libraryManifestHash:m.libraryManifestHash,authorityKey:m.authorityKey
  });
  function checkContext(meta){
    assert(meta?.source==='cloud'&&HEX64.test(String(meta.accountKey||'')),'A verified account-bound Cloud projection is required');
    assert(typeof meta.generation==='string'&&meta.generation.length>10,'Missing projection generation');
    assert(Number.isSafeInteger(meta.cursor)&&meta.cursor>=614,'Invalid Canonical cursor');
    assert(HEX64.test(String(meta.libraryManifestHash||'')),'Missing verified Canonical manifest');
    assert(/^v3:[a-f0-9]{64}$/i.test(String(meta.authorityKey||'')),'Unexpected Canonical authority');
  }
  async function createReceipt(meta,row,decision,recordedAt){
    checkContext(meta);
    assert(Number.isSafeInteger(row?.wid)&&row.wid>0,'Invalid WordID for decision');
    assert(typeof row.field==='string'&&row.field.length&&row.field.length<80,'Invalid field name');
    assert(typeof row.cardId==='string'&&row.cardId.length>8,'Missing stable card ID');
    assert(typeof row.canonical==='string'&&typeof row.local==='string'&&row.canonical!==row.local,'Decision values are missing or no longer in conflict');
    assert(APPROVALS.has(decision),'Only a human-selected Canonical or Local Edit choice can be recorded');
    assert(typeof crypto.randomUUID==='function','Secure random receipt IDs are unavailable');
    const date=recordedAt||new Date().toISOString();
    assert(!Number.isNaN(Date.parse(date)),'Invalid receipt date');
    return {
      format:'WLP_P1C4_LOCAL_DECISION_RECEIPT',version:1,
      id:crypto.randomUUID(),...context(meta),wordId:row.wid,field:row.field,
      cardId:row.cardId,decision,canonicalSha256:await sha(row.canonical),
      localSha256:await sha(row.local),recordedAt:date,
      appliesToLiveWlp:false,legacyLocalEditRetained:true
    };
  }
  async function assessReceipt(record,meta,row){
    checkContext(meta);
    if(!record)return 'MISSING';
    if(record.format!=='WLP_P1C4_LOCAL_DECISION_RECEIPT'||record.version!==1||!APPROVALS.has(record.decision))return 'INVALID';
    if(record.accountKey!==meta.accountKey)return 'WRONG ACCOUNT';
    if(record.generation!==meta.generation||record.cursor!==meta.cursor||record.libraryManifestHash!==meta.libraryManifestHash||record.authorityKey!==meta.authorityKey)return 'STALE PROJECTION';
    if(record.wordId!==row?.wid||record.field!==row.field||record.cardId!==row.cardId)return 'WRONG FIELD';
    if(record.canonicalSha256!==(await sha(row.canonical))||record.localSha256!==(await sha(row.local)))return 'STALE CONTENT';
    return 'MATCH';
  }
  function openDb(create){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{
        if(!create){r.transaction.abort();reject(new Error('Receipt DB did not exist; no DB created'));return;}
        if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'});
      };
      r.onsuccess=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains(STORE)){db.close();reject(new Error('Receipt store missing'));return;}
        resolve(db);
      };
      r.onerror=()=>reject(r.error||new Error('Receipt DB failed'));
      r.onblocked=()=>reject(new Error('Receipt DB is blocked'));
    });
  }
  async function saveReceipts(receipts){
    assert(Array.isArray(receipts)&&receipts.length>0&&receipts.length<=50,'Invalid number of local decision receipts');
    assert(receipts.every(r=>r.format==='WLP_P1C4_LOCAL_DECISION_RECEIPT'&&r.appliesToLiveWlp===false),'Unsafe decision receipt');
    const db=await openDb(true);
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);
        for(const row of receipts)store.add(row);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Decision receipt write error'));
        tx.onabort=()=>reject(tx.error||new Error('Decision receipt write aborted'));
      });
    }finally{db.close();}
  }
  async function readReceipts(accountKey){
    assert(HEX64.test(String(accountKey||'')),'Account key is required to read isolated decisions');
    assert(typeof indexedDB.databases==='function','Cannot safely verify that the receipt database exists');
    const names=await indexedDB.databases();
    if(!names.some(d=>d.name===DB))return [];
    const db=await openDb(false);
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),rows=[];
        const cursor=store.openCursor();
        cursor.onsuccess=()=>{
          const c=cursor.result;
          if(c){if(c.value?.accountKey===accountKey)rows.push(c.value);c.continue();}
        };
        cursor.onerror=()=>reject(cursor.error||new Error('Receipt cursor failed'));
        tx.oncomplete=()=>resolve(rows);
        tx.onabort=()=>reject(tx.error||new Error('Receipt read aborted'));
      });
    }finally{db.close();}
  }
  const api=Object.freeze({createReceipt,assessReceipt,saveReceipts,readReceipts,checkContext,sha});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.WLPP1C4Decisions=api;
})();
