/* WLP P1-D1 · opt-in Official-card read trial, NO default cutover.
 * Only reads the account-bound P1-B shadow IndexedDB and the existing protected
 * Local Edit compatibility snapshots/decision receipts. Does NOT fetch Cloud,
 * edit Official/Local Edit data, modify synchronization, or activate a new DB.
 * Explicitly excludes Draft/Review and two Official canaries without batch IDs.
 */
(() => {
  'use strict';
  const PROJECTION_DB = 'wlp-official-shadow-p1-v1';
  const ACCOUNT_RE = /^[a-f0-9]{64}$/i;
  const FIELD_MAP = Object.freeze({
    'Word': 'word', 'IPA': 'ipa', 'Part of Speech': 'part_of_speech',
    'Definition': 'definition', 'Synonym(s)': 'synonyms',
    'Example Sentence': 'example_sentence', 'Note(s)': 'notes',
    'Category': 'category', 'Source': 'source'
  });
  const fail = text => { throw new Error(`P1-D1 BLOCKED: ${text}`); };
  const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('IndexedDB request failed'));
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Read transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('Read transaction failed'));
  });
  const hasOwn = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const coerce = v => String(v ?? '');
  const assert = (condition, text) => { if (!condition) fail(text); };

  async function openExistingDb() {
    assert(typeof indexedDB.databases === 'function', 'Safe IndexedDB database discovery unavailable');
    const dbs = await indexedDB.databases();
    assert(dbs.some(x => x.name === PROJECTION_DB), 'Local Projection is not installed in this browser');
    return new Promise((resolve, reject) => {
      // No version argument: never upgrade or create a new projection database.
      const r = indexedDB.open(PROJECTION_DB);
      r.onupgradeneeded = () => {
        try { r.transaction.abort(); } catch (_) {}
        reject(new Error('Missing or uninitialized Local Projection DB'));
      };
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('official') || !db.objectStoreNames.contains('meta')) {
          db.close(); reject(new Error('Incomplete Local Projection DB')); return;
        }
        resolve(db);
      };
      r.onerror = () => reject(r.error || new Error('Cannot open Local Projection DB'));
      r.onblocked = () => reject(new Error('Local Projection DB is blocked by another tab'));
    });
  }
  async function getActive(db) {
    const tx = db.transaction('meta', 'readonly');
    const p = req(tx.objectStore('meta').get('active'));
    const end = done(tx);
    const item = await p; await end;
    return item?.value || null;
  }
  function checkActive(meta) {
    assert(meta && meta.source === 'cloud', 'A verified Cloud-origin Local Projection is required');
    assert(Number.isSafeInteger(meta.count) && meta.count >= 6660, 'Invalid Official count');
    assert(Number.isSafeInteger(meta.cursor) && meta.cursor >= 614, 'Local Projection is older than approved baseline');
    assert(typeof meta.generation === 'string' && meta.generation.length > 10, 'Missing active generation');
    assert(ACCOUNT_RE.test(meta.accountKey || ''), 'Local Projection is not account-bound');
    assert(/^v3:[a-f0-9]{64}$/i.test(meta.authorityKey || ''), 'Unexpected Canonical authority');
    assert(ACCOUNT_RE.test(meta.libraryManifestHash || ''), 'Missing Canonical library manifest');
  }
  async function readGeneration(db, meta) {
    const rows = [];
    const tx = db.transaction('official', 'readonly');
    const end = done(tx);
    const store = tx.objectStore('official');
    const range = IDBKeyRange.bound([meta.generation, ''], [meta.generation, '\uffff']);
    await new Promise((resolve, reject) => {
      const cursor = store.openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) { resolve(); return; }
        rows.push(c.value); c.continue();
      };
      cursor.onerror = () => reject(cursor.error || new Error('Projection card read failed'));
    });
    await end;
    assert(rows.length === meta.count, `Local Projection size mismatch: ${rows.length}/${meta.count}`);
    return rows;
  }
  async function checkLocalAccount(meta) {
    const helper = window.WLPP1C3Review;
    assert(helper?.readSession && helper?.accountKey, 'Account-bound local session guard unavailable');
    const { config, session } = await helper.readSession();
    assert(config?.url && session?.userId && session?.accessToken, 'No signed-in WLP Cloud session for this browser');
    const url = new URL(config.url);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.pathname.replace(/\//g, ''), 'Unsafe Cloud session endpoint');
    const key = await helper.accountKey(url.origin, session.userId);
    assert(key === meta.accountKey, 'Signed-in WLP account differs from installed Local Projection');
    // This is intentionally a LOCAL account-binding check, not live network re-verification.
    // The existing Cloud sign-in and sync system remain responsible for online credentials.
    return key;
  }
  function convertEntry(raw) {
    const entry = raw?.entry;
    const card = entry?.card;
    const content = entry?.effectiveContent;
    assert(card?.status === 'active' && card?.origin_kind === 'official', 'Non-Official entry in Official projection');
    assert(typeof card.word_id === 'number' && Number.isSafeInteger(card.word_id) && card.word_id > 0, 'Invalid Official WordID');
    assert(entry.cardId === raw.cardId && card.card_id === raw.cardId && content?.card_id === raw.cardId, 'Card ID mismatch');
    assert(raw.wordId === card.word_id && !entry.localOverride, 'Unresolved Canonical Local Override');
    const row = {
      'Batch #': card.legacy_batch == null ? '' : coerce(card.legacy_batch),
      'Guidance #': card.legacy_guidance == null ? '' : coerce(card.legacy_guidance),
      WordID: coerce(card.word_id),
      __hasLocalOverride: false,
      __noteLineBreaks: true,
      __p1d1Canonical: true,
      __p1d1CardId: raw.cardId,
      __p1d1OrderKey: coerce(card.order_key)
    };
    for (const [field, key] of Object.entries(FIELD_MAP)) {
      assert(typeof content[key] === 'string', `Missing canonical ${field} WID${card.word_id}`);
      row[field] = content[key];
    }
    return row;
  }
  async function checkLegacyEdits(meta, sourceEntries, overrides) {
    assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'Legacy Local Edit format invalid');
    const helper = window.WLPP1C4Decisions;
    assert(helper?.readReceipts && helper?.assessReceipt, 'Reviewed Local Edit decision validator unavailable');
    const byWid = new Map(sourceEntries.map(x => [coerce(x.WordID), x]));
    const receipts = await helper.readReceipts(meta.accountKey);
    let overrideCount = 0, differing = 0, approvals = 0;
    for (const [wid, old] of Object.entries(overrides)) {
      if (!old || typeof old !== 'object' || Array.isArray(old)) fail(`Invalid Legacy Local Edit WID${wid}`);
      const canonical = byWid.get(wid);
      assert(canonical, `Legacy Local Edit WID${wid} lacks Canonical Official card`);
      overrideCount++;
      for (const field of Object.keys(FIELD_MAP)) {
        if (!hasOwn(old, field)) continue;
        assert(typeof old[field] === 'string', `Invalid Legacy Local Edit WID${wid} ${field}`);
        if (old[field] === canonical[field]) continue;
        differing++;
        const matches = receipts.filter(r => r.wordId === Number(wid) && r.field === field && r.decision === 'canonical' &&
          r.cardId === canonical.__p1d1CardId);
        assert(matches.length, `WID${wid} ${field} is unresolved; trial refuses to hide this Local Edit`);
        const verdicts = [];
        for (const record of matches) {
          verdicts.push(await helper.assessReceipt(record, meta, {
            wid: Number(wid), field, cardId: canonical.__p1d1CardId,
            canonical: canonical[field], local: old[field]
          }));
        }
        assert(verdicts.includes('MATCH'), `WID${wid} ${field} review receipt is ${verdicts.join(', ')}`);
        approvals++;
      }
    }
    return { overrideCount, differing, approvals };
  }
  async function readRows(overrides) {
    let db;
    try {
      db = await openExistingDb();
      const meta = await getActive(db);
      checkActive(meta);
      await checkLocalAccount(meta);
      const stored = await readGeneration(db, meta);
      const entries = stored.map(convertEntry).sort((a, b) =>
        a.__p1d1OrderKey.localeCompare(b.__p1d1OrderKey) || Number(a.WordID) - Number(b.WordID));
      assert(new Set(entries.map(x => x.WordID)).size === meta.count, 'Duplicate Official WordID');
      const batchCards = entries.filter(x => x['Batch #'] !== '');
      const noBatch = entries.length - batchCards.length;
      assert(batchCards.length >= 6658, 'Legacy batch cards are missing');
      const edits = await checkLegacyEdits(meta, entries, overrides);
      const after = await getActive(db);
      await checkLocalAccount(after);
      assert(after?.generation === meta.generation && after?.accountKey === meta.accountKey && after?.libraryManifestHash === meta.libraryManifestHash, 'Active Projection changed while reading; re-open the page');
      return {rows: entries, info: {
        count: entries.length, batchCards: batchCards.length, noBatch,
        cursor: meta.cursor, generation: meta.generation, ...edits
      }};
    } finally { db?.close(); }
  }
  const api = Object.freeze({readRows, convertEntry, checkActive, checkLegacyEdits});
  if (typeof window !== 'undefined') window.WLPP1DStudyTrial = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
