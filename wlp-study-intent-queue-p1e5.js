/* P1-E5 — persistent opt-in Study-intent journal.
 * Stores only local user intentions in the EXISTING sync_meta store; no new DB,
 * Cloud transport or parallel sync engine. One acknowledged Study action at a
 * time is handed off atomically to the existing sync_outbox.
 */
(() => {
  'use strict';
  const KEY = 'p1e5:study-intents:v1', VERSION = 1, LIMIT = 200;
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const request = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Intent journal IndexedDB request failed'));
  });
  const complete = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Intent journal transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('Intent journal transaction failed'));
  });
  function owner(meta) {
    const account = String(meta?.userId || ''), device = String(meta?.deviceKey || ''), authority = String(meta?.candidateKey || '');
    if (!account || !device || !authority) throw new Error('E5 requires a verified account/device/authority identity');
    return {account, device, authority};
  }
  function check(row, id) {
    if (!row) return [];
    if (row.version !== VERSION || row.account !== id.account || row.device !== id.device || row.authority !== id.authority || !Array.isArray(row.intents)) {
      throw new Error('E5 local intent journal is incompatible with the current account/device/authority; never overwrite it');
    }
    if (row.intents.length > LIMIT) throw new Error('E5 intent journal exceeds its safety limit');
    const ids = new Set();
    for (const intent of row.intents) {
      if (!intent || typeof intent.id !== 'string' || ids.has(intent.id) || !/^\d+$/.test(String(intent.wordId || '')) ||
          !['studied','studied_removed','review','review_removed','attention_set'].includes(intent.action) || !Number.isFinite(Date.parse(intent.createdAt))) {
        throw new Error('E5 intent journal contains an invalid or duplicate instruction');
      }
      ids.add(intent.id);
    }
    return clone(row.intents);
  }
  async function read(db, meta) {
    const id = owner(meta), tx = db.transaction('sync_meta', 'readonly'), end = complete(tx);
    const row = await request(tx.objectStore('sync_meta').get(KEY)); await end;
    return check(row, id);
  }
  async function append(db, meta, item) {
    const id = owner(meta);
    if (!crypto?.randomUUID) throw new Error('E5 secure intent identity is unavailable');
    if (!/^\d+$/.test(String(item?.wordId || '')) || !['studied','studied_removed','review','review_removed','attention_set'].includes(String(item?.action || '')))
      throw new Error('E5 unsupported Study intent');
    if (!['neutral','studied','review:none','review:light','review:medium','review:high'].includes(String(item.expectedFromState || '')))
      throw new Error('E5 cannot determine the expected Study state safely');
    const intent = {id:crypto.randomUUID(),wordId:String(item.wordId),action:String(item.action),expectedFromState:String(item.expectedFromState),createdAt:new Date().toISOString()};
    if (intent.action === 'attention_set') {
      intent.level = String(item.level || '').toLowerCase();
      intent.reasons = clone(item.reasons || []);
      if (!['','light','medium','high'].includes(intent.level) || !Array.isArray(intent.reasons)) throw new Error('E5 invalid Attention intent');
    }
    const tx = db.transaction('sync_meta','readwrite'), end = complete(tx), store = tx.objectStore('sync_meta');
    try {
      const existing = await request(store.get(KEY));
      const intents = check(existing, id);
      if (intents.length !== Number(item.expectedQueueCount)) throw new Error('E5 intent queue changed in another tab; reload this page before writing');
      if (intents.length >= LIMIT) throw new Error('E5 intent queue is full; no action was recorded');
      intents.push(intent);
      store.put({key:KEY,version:VERSION,...id,intents,updatedAt:new Date().toISOString()});
      await end;
      return {intent:clone(intent),intents};
    } catch (err) { try {tx.abort();}catch(_){} await end.catch(()=>{}); throw err; }
  }
  async function handoff(db, meta, intent, mutations) {
    const id = owner(meta);
    if (!Array.isArray(mutations) || mutations.length !== 2 || new Set(mutations.map(m => String(m?.tableName || ''))).size !== 2 ||
        !mutations.some(m => m.tableName === 'learning_state') || !mutations.some(m => m.tableName === 'learning_events') ||
        mutations.some(m => !m?.mutationId || !m?.actionId || m.transportEligible !== true || m.canonicalStudyDefaultCutover !== true) ||
        String(mutations[0].actionId) !== String(mutations[1].actionId)) throw new Error('E5 handoff requires one proven Study state/event pair');
    const tx = db.transaction(['sync_meta','sync_outbox'],'readwrite'), end = complete(tx), store = tx.objectStore('sync_meta'), outbox = tx.objectStore('sync_outbox');
    try {
      const [row, pending] = await Promise.all([request(store.get(KEY)),request(outbox.count())]);
      const intents = check(row,id);
      if (pending !== 0) throw new Error('E5 will not hand off an intent while another Canonical action is pending');
      if (!intents.length || intents[0].id !== intent.id) throw new Error('E5 queue head changed; no handoff permitted');
      if (intents[0].wordId !== intent.wordId || intents[0].action !== intent.action || intents[0].expectedFromState !== intent.expectedFromState)
        throw new Error('E5 intent changed before handoff');
      for (const mutation of mutations) outbox.add(clone(mutation));
      store.put({...row,intents:intents.slice(1),updatedAt:new Date().toISOString()});
      await end;
      return intents.slice(1);
    } catch(err) { try {tx.abort();}catch(_){} await end.catch(()=>{}); throw err; }
  }
  window.WLPStudyIntentQueueE5 = Object.freeze({version:1,read,append,handoff,limit:LIMIT});
})();
