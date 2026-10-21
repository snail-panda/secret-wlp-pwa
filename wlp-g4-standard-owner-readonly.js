/* WLP G4-1: durable per-Session ownership inspection for Standard Continue.
 * No bootstrap, writes, network calls, authentication, or feature activation.
 * Journal schema/keys come from the previously verified G3-B source.
 * An E7b Journal session must NEVER be resumed through the E7a legacy writer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WLPG4StandardOwnerReadOnly = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const DB_NAME = 'wlp-study-context-sync-v1';
  const clean = value => String(value ?? '').trim();
  const decision = (writer, reason) => Object.freeze({ writer, reason });
  const hold = reason => decision('hold', reason);
  const legacy = reason => decision('legacy-canonical', reason);

  async function openIfExists(idb) {
    if (!idb || typeof idb.open !== 'function') throw Error('IndexedDB unavailable');
    // databases() is optional on Safari. A non-existent DB must not be created.
    if (typeof idb.databases === 'function') {
      const found = await idb.databases();
      if (!Array.isArray(found)) throw Error('Cannot inspect IndexedDB database list');
      if (!found.some(item => item?.name === DB_NAME)) return null;
    }
    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME); let absent = false;
      request.onupgradeneeded = () => {
        absent = true;
        try { request.transaction.abort(); } catch (_) { /* atomic abort */ }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (absent) { db.close(); resolve(null); }
        else resolve(db);
      };
      request.onerror = () => absent ? resolve(null) : reject(request.error || Error('G4 Journal open failed'));
      request.onblocked = () => reject(Error('G4 Journal is blocked by another tab'));
    });
  }

  function getOwnershipRows(db, sessionId, contextId) {
    return new Promise((resolve, reject) => {
      let enrollment = null, sessionLink = null, heads = null;
      let tx;
      try {
        if (!db.objectStoreNames.contains('meta') || !db.objectStoreNames.contains('heads')) {
          reject(Error('G4 Journal missing required stores')); return;
        }
        tx = db.transaction(['meta','heads'], 'readonly');
        const meta = tx.objectStore('meta');
        meta.get('e7b:session:' + sessionId).onsuccess = event => { sessionLink = event.target.result || null; };
        if (contextId) {
          meta.get('e7b:enrolled:' + contextId).onsuccess = event => { enrollment = event.target.result || null; };
        }
        tx.objectStore('heads').getAll().onsuccess = event => { heads = event.target.result; };
        tx.oncomplete = () => resolve({enrollment, sessionLink, heads});
        tx.onabort = () => reject(tx.error || Error('G4 Journal read aborted'));
        tx.onerror = () => reject(tx.error || Error('G4 Journal read failed'));
      } catch (error) { reject(error); }
    });
  }

  async function inspectResume({ indexedDB, sessionId, contextId } = {}) {
    const sid = clean(sessionId), cid = clean(contextId);
    if (!sid || !cid) return hold('missing-standard-session-or-context-id');
    let db = null;
    try {
      db = await openIfExists(indexedDB);
      if (!db) return legacy('no-g4-journal-database');
      const { enrollment, sessionLink, heads } = await getOwnershipRows(db, sid, cid);
      if (!Array.isArray(heads)) return hold('g4-heads-read-incomplete');
      const matching = heads.filter(item => clean(item?.sessionId) === sid || clean(item?.contextId) === cid);
      if (!sessionLink && !enrollment && matching.length === 0)
        return legacy('no-durable-g4-ownership-for-session');
      // An enrollment/Head exists, even if unfinished or mismatched. No fallback
      // to Legacy: the latter could silently overwrite a compatibility projection.
      if (!sessionLink || !enrollment || matching.length !== 1)
        return hold('g4-enrollment-or-head-incomplete');
      const head = matching[0];
      if (clean(sessionLink.contextId) !== cid ||
          clean(enrollment.contextId) !== cid || clean(enrollment.sessionId) !== sid ||
          clean(head.contextId) !== cid || clean(head.sessionId) !== sid ||
          enrollment.accountBoundAtStart !== true ||
          clean(enrollment.accountId) !== clean(head.accountId) ||
          clean(enrollment.deviceKey) !== clean(head.deviceKey) ||
          clean(enrollment.candidateKey) !== clean(head.candidateKey) ||
          Number(enrollment.headVersion) !== Number(head.headVersion) ||
          clean(sessionLink.accountId) !== clean(enrollment.accountId) ||
          clean(sessionLink.deviceKey) !== clean(enrollment.deviceKey)) {
        return hold('g4-durable-identity-mismatch');
      }
      return decision('g4-journal', 'durable-g4-session-needs-verified-driver');
    } catch (_) {
      // A failed ownership read is not proof that the session is Legacy.
      return hold('g4-owner-read-unavailable');
    } finally { try { db?.close(); } catch (_) {} }
  }
  // A fresh session has no Context ID yet. Read the actual Journal schema
  // without creating a database; a partially owned SID is never assumed empty.
  async function inspectNewSession({indexedDB,sessionId}={}) {
    const sid=clean(sessionId);
    if(!sid) return hold('missing-new-session-id');
    let db=null;
    try {
      db=await openIfExists(indexedDB);
      if(!db) return legacy('no-durable-g4-ownership-for-session');
      if(!db.objectStoreNames.contains('meta')||!db.objectStoreNames.contains('heads'))
        return hold('g4-new-session-owner-schema-incomplete');
      const found=await new Promise((resolve,reject)=>{
        const tx=db.transaction(['meta','heads'],'readonly');let marker=null,heads=null,metaRows=null;
        tx.objectStore('meta').get('e7b:session:'+sid).onsuccess=e=>{marker=e.target.result||null;};
        tx.objectStore('meta').getAll().onsuccess=e=>{metaRows=e.target.result;};
        tx.objectStore('heads').getAll().onsuccess=e=>{heads=e.target.result;};
        tx.oncomplete=()=>resolve({marker,heads,metaRows});
        tx.onerror=()=>reject(tx.error||Error('new-session-owner-read-error'));
        tx.onabort=()=>reject(tx.error||Error('new-session-owner-read-aborted'));
      });
      if(!Array.isArray(found.heads)||!Array.isArray(found.metaRows)) return hold('new-session-ledger-not-readable');
      if(found.marker||found.heads.some(h=>clean(h?.sessionId)===sid)||
         found.metaRows.some(m=>clean(m?.sessionId)===sid))
        return hold('new-session-id-already-owned');
      return legacy('no-durable-g4-ownership-for-session');
    } catch(_){return hold('new-session-owner-read-unavailable');}
    finally{try{db?.close();}catch(_){}}
  }
  // Inspect the *durable* enrollment records after onContextCreated resolves.
  // A Journal Head is intentionally absent until the first committed answer.
  async function inspectEnrolledStart({indexedDB,sessionId,contextId,identity}={}) {
    const sid=clean(sessionId),cid=clean(contextId);
    if(!sid||!cid||!identity?.verified)return hold('enrollment-owner-identity-missing');
    let db=null;
    try {
      db=await openIfExists(indexedDB);
      if(!db||!db.objectStoreNames.contains('meta')||!db.objectStoreNames.contains('heads'))
        return hold('enrollment-database-missing');
      const found=await new Promise((resolve,reject)=>{
        const tx=db.transaction(['meta','heads'],'readonly');let enroll=null,link=null,heads=null;
        tx.objectStore('meta').get('e7b:enrolled:'+cid).onsuccess=e=>{enroll=e.target.result||null;};
        tx.objectStore('meta').get('e7b:session:'+sid).onsuccess=e=>{link=e.target.result||null;};
        tx.objectStore('heads').getAll().onsuccess=e=>{heads=e.target.result;};
        tx.oncomplete=()=>resolve({enroll,link,heads});
        tx.onerror=()=>reject(tx.error||Error('enrollment-owner-read-failed'));
        tx.onabort=()=>reject(tx.error||Error('enrollment-owner-read-aborted'));
      });
      const e=found.enroll,l=found.link;
      if(!e||!l||!Array.isArray(found.heads)||found.heads.some(h=>clean(h?.sessionId)===sid))
        return hold('enrollment-partial-or-session-head-already-present');
      if(e.accountBoundAtStart!==true||e.transportEligible!==true||
        clean(e.sessionId)!==sid||clean(e.contextId)!==cid||
        clean(l.contextId)!==cid||clean(l.accountId)!==clean(e.accountId)||
        clean(l.deviceKey)!==clean(e.deviceKey)||
        ['accountId','deviceKey','candidateKey','generation'].some(k=>clean(e[k])!==clean(identity[k]))||
        Number(e.headVersion)!==Number(identity.headVersion))
        return hold('enrollment-identity-or-original-session-mismatch');
      return decision('g4-enrolled-start','durable-enrollment-verified-before-answer');
    } catch(_){return hold('enrollment-owner-inspection-failed');}
    finally{try{db?.close();}catch(_){}}
  }
  return Object.freeze({ version:'g4-standard-resume-owner-readonly-v2', inspectResume,
    inspectNewSession,inspectEnrolledStart });
});
