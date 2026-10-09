/* WLP P1-D8 · Local Library entry / account-bound readiness display.
 * READ-ONLY: no network, no storage writes, no sync, no source cutover.
 * Uses the existing P1 Official / Cloud Shadow / Canonical Mirror databases.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DB = Object.freeze({
    session: 'wlp-cloud-shadow-v0', official: 'wlp-official-shadow-p1-v1', mirror: 'wlp-cloud-v1'
  });
  const fail = (m) => { throw new Error(m); };
  const request = r => new Promise((yes, no) => {
    r.onsuccess = () => yes(r.result ?? null);
    r.onerror = () => no(r.error || new Error('Cannot read saved data'));
  });
  const stamp = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
  const SHA = /^[0-9a-f]{64}$/i;
  async function openExisting(name, known) {
    if (!known.has(name)) return null;
    return new Promise((yes, no) => {
      const r = indexedDB.open(name);
      r.onupgradeneeded = () => {
        try { r.transaction.abort(); } catch (_) {}
        no(new Error(`Uninitialized database: ${name}`));
      };
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error || new Error(`Could not open ${name}`));
      r.onblocked = () => no(new Error(`Database is blocked: ${name}`));
    });
  }
  async function fetchRows(db, store, keys) {
    if (!db?.objectStoreNames.contains(store)) fail(`Missing ${store} in saved library`);
    const tx = db.transaction(store, 'readonly');
    return Promise.all(keys.map(k => request(tx.objectStore(store).get(k))));
  }
  async function count(db, store) {
    if (!db?.objectStoreNames.contains(store)) fail(`Missing ${store} in saved library`);
    return request(db.transaction(store, 'readonly').objectStore(store).count());
  }
  async function fingerprint(config, session) {
    if (!config?.url || !session?.userId) return null;
    const u = new URL(config.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname.replace(/\//g, ''))
      fail('Unrecognized Cloud account endpoint');
    const bytes = new TextEncoder().encode(`wlp-shadow-p1b|${u.origin}|${session.userId}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  async function inspect() {
    if (typeof indexedDB.databases !== 'function') fail('Safe database discovery is unavailable in this browser');
    const known = new Set((await indexedDB.databases()).map(v => v.name));
    const all = {};
    for (const [key, name] of Object.entries(DB)) all[key] = await openExisting(name, known);
    try {
      const [config, session] = all.session
        ? await fetchRows(all.session, 'meta', ['supabase_config', 'supabase_session']) : [null, null];
      const [officialRecord] = all.official
        ? await fetchRows(all.official, 'meta', ['active']) : [null];
      const official = officialRecord?.value || null;
      const [mirror, cursor] = all.mirror
        ? await fetchRows(all.mirror, 'sync_meta', ['authority_mirror', 'sync_cursor']) : [null, null];
      const outbox = all.mirror ? await count(all.mirror, 'sync_outbox') : null;
      const account = await fingerprint(config, session);
      const authenticated = Boolean(config?.publishableKey && session?.refreshToken && session?.userId);
      const officialReady = Boolean(official?.source === 'cloud' && SHA.test(official.accountKey || '') &&
        Number.isSafeInteger(official.count) && official.count >= 6660 && stamp(official.cursor) != null &&
        SHA.test(official.libraryManifestHash || ''));
      const officialBound = Boolean(authenticated && officialReady && account === official.accountKey);
      const sameAccount = Boolean(officialBound && mirror?.userId === session.userId &&
        mirror?.candidateKey === official.authorityKey);
      const mirrorReady = Boolean(mirror?.userId && cursor && outbox !== null &&
        stamp(mirror.materializedSyncCursor) != null && stamp(cursor.lastSyncCursor) != null);
      const mismatch = Boolean(officialReady && authenticated && account !== official.accountKey) ||
        Boolean(mirrorReady && authenticated && mirror.userId !== session.userId) ||
        Boolean(mirrorReady && officialReady && mirror.candidateKey !== official.authorityKey);
      const currentDeviceId = String(localStorage.getItem('wlp:device-id:v1') || '').trim();
      const deviceMismatch = Boolean(mirrorReady && currentDeviceId && mirror.deviceKey && mirror.deviceKey !== currentDeviceId);
      const mirrorUpToDate = Boolean(mirrorReady && (!officialReady || mirror.materializedSyncCursor >= official.cursor));
      // Neither a cached token nor this local check proves current server authentication.
      return {authenticated, officialReady, mirrorReady, sameAccount, officialBound, mirrorUpToDate,
        mismatch: mismatch || deviceMismatch,
        officialCount: officialReady ? official.count : null,
        officialCursor: officialReady ? official.cursor : null,
        mirrorCursor: mirrorReady ? mirror.materializedSyncCursor : null,
        outbox, ready: Boolean(sameAccount && mirrorUpToDate && !deviceMismatch)};
    } finally { Object.values(all).forEach(db => db?.close()); }
  }
  function paint(s) {
    const target = $('my-library-state');
    if (!target) return;
    const extra = $('my-library-detail');
    const preview = $('my-library-preview');
    if (preview) preview.hidden = !s.officialBound || s.mismatch;
    if (s.mismatch) {
      target.textContent = 'ACCOUNT MISMATCH — Library access paused';
      if (extra) extra.textContent = 'A different WLP account is saved here. Do not install or overwrite anything; review the current sign-in first.';
    } else if (s.ready) {
      target.textContent = 'LOCAL LIBRARY READY';
      if (extra) extra.textContent = `${s.officialCount.toLocaleString()} Official cards · Official cursor ${s.officialCursor} · Sync library cursor ${s.mirrorCursor} · Pending Outbox ${s.outbox}. Identity matched locally; live Cloud sign-in was not rechecked.`;
    } else if (s.officialReady) {
      target.textContent = 'OFFICIAL CARDS INSTALLED — setup not finished';
      if (extra) extra.textContent = `${s.officialCount.toLocaleString()} Official cards saved locally · cursor ${s.officialCursor}. ${s.mirrorReady ? 'Sync Library exists but needs an account/cursor check.' : 'Account Sync Library needs initial setup.'}`;
    } else if (s.authenticated) {
      target.textContent = 'SIGNED-IN SESSION SAVED — Library not installed';
      if (extra) extra.textContent = 'Continue setup to download your Local Library. A saved session may need refreshing online.';
    } else {
      target.textContent = 'LOCAL LIBRARY NOT SET UP';
      if (extra) extra.textContent = 'Sign in to your WLP Cloud account and set up a local copy on this browser. Normal WLP remains available.';
    }
    const flag = target.closest('[data-my-library]');
    if (flag) flag.dataset.libraryState = s.mismatch ? 'blocked' : s.ready ? 'ready' : 'setup';
  }
  async function refresh() {
    const target = $('my-library-state');
    if (!target) return;
    target.textContent = 'Checking this browser’s saved Library…';
    try { paint(await inspect()); }
    catch (e) {
      target.textContent = 'CHECK — Local Library status unavailable';
      const detail = $('my-library-detail');
      if (detail) detail.textContent = String(e?.message || e) + '. No data was changed.';
      const preview = $('my-library-preview');
      if (preview) preview.hidden = true;
    }
  }
  $('my-library-refresh')?.addEventListener('click', refresh);
  refresh();
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.freeze({inspect, fingerprint});
})();
