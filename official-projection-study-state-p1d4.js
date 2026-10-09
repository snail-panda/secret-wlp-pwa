/* WLP P1-D4/P1-D5: opt-in Studied or Review+Attention Canonical state trial on the verified
   Local Official Projection. Read-only preflight; writes remain exclusively
   in the existing Canonical Study State writer, not in this file. */
(() => {
  'use strict';
  const q = new URLSearchParams(location.search);
  const requested = q.get('wlpProjectionTrial') === '1' && q.get('wlpProjectionState') === '1' && q.get('wlpProjectionEvents') !== '1';
  const reviewRequested = requested && q.get('wlpProjectionReview') === '1';
  const AUTHORITY = 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc';
  const MANIFEST = '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63';
  let ready = false, status = null;
  const fail = reason => { throw new Error(`P1-D${reviewRequested ? '5 REVIEW' : '4 STUDIED'} pilot BLOCKED: ${reason}`); };
  const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('IndexedDB request failed')); });
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || Error('IDB transaction aborted')); tx.onerror = () => reject(tx.error || Error('IDB transaction failed')); });
  async function prepare(rows, batch) {
    ready = false; status = null;
    if (!requested) fail('Explicit State pilot query is missing or conflicts with event pilot');
    if (typeof indexedDB.databases !== 'function') fail('Cannot verify local Canonical mirror existence');
    const sessionHelper = window.WLPP1C3Review;
    if (!sessionHelper?.readSession) fail('Existing authentication helper is unavailable');
    const { session } = await sessionHelper.readSession();
    if (!session?.userId || !session?.accessToken) fail('Signed-in WLP account unavailable');
    if (!Array.isArray(rows) || !/^\d+$/.test(String(batch || ''))) fail('Invalid Official deck');
    const cards = rows.filter(r => Number(r['Batch #']) === Number(batch));
    if (cards.length === 0) fail('No Official cards in requested deck');
    const first = cards[0];
    if (!first.__p1d1Canonical || !first.__p1d1CardId || !/^\d+$/.test(String(first.WordID))) fail('First card lacks verified Canonical identity');
    const list = await indexedDB.databases();
    if (!list.some(item => item.name === 'wlp-cloud-v1')) fail('Existing Canonical mirror has not been initialized');
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('wlp-cloud-v1', 1);
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} reject(Error('Refusing to create or upgrade a missing mirror')); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || Error('Cannot open existing Canonical mirror'));
      r.onblocked = () => reject(Error('Canonical mirror blocked by another tab'));
    });
    try {
      if (['sync_meta', 'cards', 'sync_outbox', 'learning_state'].some(n => !db.objectStoreNames.contains(n))) fail('Canonical mirror missing required stores');
      const tx = db.transaction(['sync_meta','cards','sync_outbox'],'readonly');
      const meta = req(tx.objectStore('sync_meta').get('authority_mirror'));
      const card = req(tx.objectStore('cards').get(first.__p1d1CardId));
      const outbox = req(tx.objectStore('sync_outbox').getAll());
      const completion = done(tx);
      const [mirror,row,pending] = await Promise.all([meta,card,outbox]); await completion;
      if (!mirror || mirror.candidateKey !== AUTHORITY || mirror.snapshotManifestHash !== MANIFEST || Number(mirror.headVersion) !== 3) fail('Canonical mirror Authority mismatch');
      if (!mirror.userId || String(mirror.userId) !== String(session.userId)) fail('Canonical mirror belongs to another or unidentified account');
      if (!row || String(row.payload?.word_id || '') !== String(first.WordID)) fail('Canonical card identity missing or differs from Local Projection');
      if (!Array.isArray(pending)) fail('Cannot inspect Canonical outbox');
      if (pending.length !== 0) fail(`Existing Outbox contains ${pending.length} pending row(s); leave them untouched and retry after their normal sync`);
      status = Object.freeze({ wordId:String(first.WordID), cardId:first.__p1d1CardId, deckSize:cards.length, outbox:0, mode:reviewRequested ? 'review-attention' : 'studied' });
      ready = true;
      return status;
    } finally { db.close(); }
  }
  window.WLPP1D4StudyPilot = Object.freeze({ requested, prepare, isActive:()=>ready && requested, isReviewPilot:()=>ready && reviewRequested, getStatus:()=>status });
})();
