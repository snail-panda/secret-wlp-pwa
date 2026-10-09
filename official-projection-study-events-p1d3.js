/* WLP P1-D3 — explicit, events-only Canonical Local Projection study pilot.
   Reuses existing activity/interaction local event journals, existing Canonical
   event writers and foreground sync. Does not enable membership/attention edits.
   Validates local account + existing canonical identity BEFORE opening the pilot.
   No database or localStorage writes occur here. */
(() => {
  'use strict';
  const p = new URLSearchParams(location.search);
  const requested = p.get('wlpProjectionTrial') === '1' && p.get('wlpProjectionEvents') === '1';
  const EXPECTED_AUTHORITY = 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc';
  const EXPECTED_MANIFEST = '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63';
  let ready = false;
  let status = null;
  const fail = message => { throw new Error(`P1-D3 events-only pilot BLOCKED: ${message}`); };
  const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('IndexedDB request failed')); });
  const done = t => new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onabort = () => reject(t.error || new Error('IndexedDB transaction failed')); t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed')); });
  async function openExisting() {
    if (typeof indexedDB.databases !== 'function') fail('Cannot verify existing Canonical mirror DB');
    const databases = await indexedDB.databases();
    if (!databases.some(item => item.name === 'wlp-cloud-v1')) fail('Canonical mirror DB not installed in this browser');
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('wlp-cloud-v1', 1);
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} reject(new Error('Cannot create/upgrade Canonical mirror in the pilot')); };
      r.onsuccess = () => {
        const db = r.result;
        const required = ['sync_meta', 'cards', 'sync_outbox', 'learning_events'];
        if (required.some(store => !db.objectStoreNames.contains(store))) {
          db.close(); reject(new Error('Existing Canonical mirror has missing stores')); return;
        }
        resolve(db);
      };
      r.onerror = () => reject(r.error || new Error('Canonical mirror open failed'));
      r.onblocked = () => reject(new Error('Canonical mirror open blocked by another tab'));
    });
  }
  async function prepare(rows, batch) {
    if (!requested) fail('Explicit events pilot query is missing');
    ready = false;
    status = null;
    const sessionHelper = window.WLPP1C3Review;
    if (!sessionHelper?.readSession) fail('Account verification helper is unavailable');
    const { session } = await sessionHelper.readSession();
    if (!session?.userId || !session?.accessToken) fail('Signed-in WLP account not available');
    if (!Array.isArray(rows) || !rows.length || !batch || !/^\d+$/.test(String(batch))) fail('Invalid Official deck for event pilot');
    const deckRows = rows.filter(row => Number(row['Batch #']) === Number(batch));
    if (!deckRows.length) fail('Official deck has no cards');
    const first = deckRows[0];
    if (!first.__p1d1Canonical || !first.__p1d1CardId || !/^\d+$/.test(String(first.WordID))) fail('First Official card lacks stable identity');
    let db;
    try {
      db = await openExisting();
      const t = db.transaction(['sync_meta', 'cards', 'sync_outbox'], 'readonly');
      const meta = req(t.objectStore('sync_meta').get('authority_mirror'));
      const card = req(t.objectStore('cards').get(first.__p1d1CardId));
      const outbox = req(t.objectStore('sync_outbox').getAll());
      const finish = done(t);
      const [mirror,cardRow,pending] = await Promise.all([meta,card,outbox]); await finish;
      if (!mirror || mirror.candidateKey !== EXPECTED_AUTHORITY || mirror.snapshotManifestHash !== EXPECTED_MANIFEST || Number(mirror.headVersion) !== 3) fail('Canonical mirror Authority does not match existing write system');
      if (mirror.userId && String(mirror.userId) !== String(session.userId)) fail('Canonical mirror belongs to a different account');
      if (!mirror.userId) fail('Canonical mirror account ownership is not identified');
      if (!cardRow || String(cardRow?.payload?.word_id || '') !== String(first.WordID)) fail(`WID${first.WordID} is not registered in existing Canonical mirror; refuses Static Master bootstrap`);
      if (!Array.isArray(pending)) fail('Canonical outbox cannot be checked');
      // Existing queued work must NEVER be erased or rewritten by the pilot.
      status = Object.freeze({ firstWordId:String(first.WordID), existingOutbox:pending.length, count:deckRows.length });
      ready = true;
      return status;
    } catch (e) { ready = false; fail(e?.message || String(e)); }
    finally { try { db?.close(); } catch (_) {} }
  }
  window.WLPP1D3EventPilot = Object.freeze({requested, isActive:() => ready && requested, prepare, getStatus:() => status});
})();
