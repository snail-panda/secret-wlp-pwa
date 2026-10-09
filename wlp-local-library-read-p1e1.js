/* WLP P1-E1 — strictly opt-in, read-only Canonical Mirror card-source trial.
 * Reuses existing P1-D8B Study UI, account-bound Official Projection validation,
 * approved legacy edit receipts, and read-only Canonical Compatibility Adapter.
 * Does not write, sync, install, migrate, or change default WLP navigation.
 */
(() => {
  'use strict';
  const FIELD_NAMES = Object.freeze([
    'Word','IPA','Part of Speech','Definition','Synonym(s)',
    'Example Sentence','Note(s)','Category','Source'
  ]);
  const fail = message => { throw new Error(`P1-E1 BLOCKED: ${message}`); };
  const assert = (test, message) => { if (!test) fail(message); };
  const clean = value => String(value ?? '').trim();
  const req = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Local Mirror metadata read failed'));
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Local Mirror metadata transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Local Mirror metadata transaction aborted'));
  });
  async function mirrorIdentity() {
    assert(typeof indexedDB.databases === 'function', 'Safe database discovery unavailable');
    const known = await indexedDB.databases();
    assert(known.some(item => item.name === 'wlp-cloud-v1'), 'Canonical Mirror not installed');
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('wlp-cloud-v1');
        request.onupgradeneeded = () => {
          try { request.transaction.abort(); } catch (_) {}
          reject(new Error('Canonical Mirror database is not initialized'));
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Cannot open Canonical Mirror'));
      });
      assert(db.objectStoreNames.contains('sync_meta'), 'Mirror metadata store missing');
      const tx = db.transaction('sync_meta', 'readonly');
      const read = req(tx.objectStore('sync_meta').get('authority_mirror'));
      const end = done(tx);
      const meta = await read;
      await end;
      return meta;
    } finally { if (db) db.close(); }
  }
  async function readRows(overrides) {
    // Retain all P1-D8B source/account validation and WID4120 decision receipts.
    const projection = window.WLPP1DStudyTrial;
    const adapterProvider = window.WLPCanonicalCompatibilityAdapter;
    const sessionProvider = window.WLPP1C3Review;
    assert(typeof projection?.readRows === 'function', 'Existing Official Projection reader missing');
    assert(typeof adapterProvider?.open === 'function', 'Existing Canonical Mirror reader missing');
    assert(typeof sessionProvider?.readSession === 'function', 'Existing account check missing');

    const baseline = await projection.readRows(overrides);
    const [adapter, mirrorMeta, sessionInfo] = await Promise.all([
      adapterProvider.open(), mirrorIdentity(), sessionProvider.readSession()
    ]);
    assert(adapter?.readOnly === true && adapter.source === 'wlp-cloud-v1', 'Verified read-only Mirror required');
    assert(sessionInfo?.session?.userId && mirrorMeta?.userId === sessionInfo.session.userId, 'Mirror belongs to another account');
    assert(mirrorMeta?.candidateKey === adapter.meta?.candidateKey, 'Mirror authority changed while opening adapter');
    const deviceId = clean(localStorage.getItem('wlp:device-id:v1'));
    assert(deviceId && mirrorMeta?.deviceKey === deviceId, 'Local Mirror belongs to a different browser/device identity');
    // The Mirror cannot be older than the verified account-bound Official Projection.
    const cursor = Number(mirrorMeta?.materializedSyncCursor);
    assert(Number.isSafeInteger(cursor) && cursor >= baseline.info.cursor, 'Mirror is older than Local Official Projection');
    assert(adapter.pendingOutboxRows === 0, 'Pending Outbox exists; view-only trial waits until it syncs');
    const entries = [];
    const keys = new Set();
    for (const card of adapter.list('card')) {
      if (card.tombstone || card.payload?.deletedAt || card.payload?.status !== 'active' || card.payload?.originKind !== 'official') continue;
      const payload = card.payload;
      const wid = Number(payload.wordId);
      assert(Number.isSafeInteger(wid) && wid > 0, 'Official Card has no valid WID');
      const key = `wid:${wid}`;
      assert(card.entityKey === key && !keys.has(key), `Duplicate or malformed Official key WID${wid}`);
      keys.add(key);
      const bundle = adapter.getCardBundle(key);
      assert(bundle?.content && !bundle.content.tombstone, `Official WID${wid} has no active card content`);
      const content = bundle.content.payload || {};
      const row = {
        'Batch #': payload.legacyBatch == null ? '' : String(payload.legacyBatch),
        'Guidance #': payload.legacyGuidance == null ? '' : String(payload.legacyGuidance),
        WordID: String(wid), __noteLineBreaks: true, __hasLocalOverride: false,
        __p1e1CanonicalMirror: true
      };
      for (const field of FIELD_NAMES) {
        assert(typeof content[field] === 'string', `Canonical WID${wid} missing ${field}`);
        row[field] = content[field];
      }
      entries.push(row);
    }
    const previous = new Map(baseline.rows.map(row => [row.WordID, row]));
    const current = new Map(entries.map(row => [row.WordID, row]));
    for (const old of baseline.rows) {
      const latest = current.get(old.WordID);
      assert(latest, `Existing Official WID${old.WordID} is absent from the Mirror`);
      assert(latest['Batch #'] === old['Batch #'] && latest['Guidance #'] === old['Guidance #'],
        `WID${old.WordID} deck membership/order changed; verify before read cutover`);
    }
    // Verified P1-C4 decisions are content-specific; never silently hide legacy
    // fields if the Mirror has moved beyond the reviewed Projection version.
    for (const row of entries) {
      const old = previous.get(row.WordID);
      const localEdit = overrides?.[row.WordID];
      if (!old || !localEdit || typeof localEdit !== 'object') continue;
      for (const field of FIELD_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(localEdit, field)) continue;
        assert(row[field] === old[field], `WID${row.WordID} ${field} changed after Local Edit approval; resolve before cutover`);
      }
    }
    entries.sort((a, b) =>
      Number(a['Batch #'] || Number.MAX_SAFE_INTEGER) - Number(b['Batch #'] || Number.MAX_SAFE_INTEGER) ||
      Number(a['Guidance #'] || Number.MAX_SAFE_INTEGER) - Number(b['Guidance #'] || Number.MAX_SAFE_INTEGER) ||
      Number(a.WordID) - Number(b.WordID));
    const batchCards = entries.filter(row => row['Batch #'] !== '').length;
    assert(batchCards >= baseline.info.batchCards, 'Canonical Mirror is missing existing deck-assigned Official cards');
    const lastMirrorMeta = await mirrorIdentity();
    assert(lastMirrorMeta?.userId === mirrorMeta.userId &&
      lastMirrorMeta?.materializedSyncCursor === mirrorMeta.materializedSyncCursor &&
      lastMirrorMeta?.materializedManifestHash === mirrorMeta.materializedManifestHash,
      'Mirror changed during read; reopen the card page');
    return { rows: entries, info: {
      count: entries.length, batchCards, noBatch: entries.length - batchCards,
      cursor, source: 'canonical-mirror', referenceProjectionCursor: baseline.info.cursor
    } };
  }
  window.WLPP1E1LocalMirrorRead = Object.freeze({version: 1, readOnly: true, readRows});
})();
