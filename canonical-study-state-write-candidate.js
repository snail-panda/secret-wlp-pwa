/* P1-D5: opt-in Review+Attention pilot reuses normal Canonical writer without changing regular routes.
   WLP v1.8.6.282 — Canonical Study production diagnostics cleanup; normal success stays silent.
   All official Master cards use the Canonical learning_state / learning_events contract
   for Studied, Review, membership removal, and no-level/Light/Medium/High Attention writes.
   Missing learning_state rows may be created by the first Studied or Review action.
   One action pair may be pending at a time; the proven foreground auto-sync may claim supported
   actions, while manual Cloud Shadow steady-sync remains the fallback. Legacy localStorage membership/attention remains rollback-only; encounter-only compatibility writes continue without copying Canonical membership.
   Explicit rollback: ?wlpLegacyStudyAttentionWrite=1
   Draft cards are excluded. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.282-study-state-production-diagnostics-v1';
  const DB_NAME = 'wlp-cloud-v1', DB_VERSION = 1;
  const META_STORE = 'sync_meta', OUTBOX_STORE = 'sync_outbox', STATE_STORE = 'learning_state', CARD_STORE = 'cards';
  const META_KEY = 'authority_mirror', CURSOR_KEY = 'sync_cursor';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const CARD_NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const BOOTSTRAP = {
    candidateKey: 'v3:79a35fbf0c693e5f6fddfbfbb778180b0f4da14ac5f9fc57456d7c7f12636fdc',
    headVersion: 3,
    migrationVersion: '3',
    manifestHash: '2ed3ad8fb1b9dfecfe9b66095f92ae644f8d0f88c5da5b752d06b26ca5897d63',
    canonicalRows: 21425
  };

  const params = new URLSearchParams(location.search);
  const rollbackRequested = params.get('wlpLegacyStudyAttentionWrite') === '1';
  const AUDIT_FLAG = 'wlpStudyStateAudit';
  const auditRequested = params.get(AUDIT_FLAG) === '1';
  const draftRoute = params.has('draft');
  // E5 is restricted to the existing, explicit Local Library New Study route.
  const e5Enabled = params.get('wlpLocalLibrary') === '1' && params.get('wlpOfflineQueue') === '1' && !rollbackRequested && !draftRoute;
  const projectionStatePilot = params.get('wlpProjectionTrial') === '1' && params.get('wlpProjectionState') === '1' && params.get('wlpProjectionEvents') !== '1';
  const projectionReviewPilot = projectionStatePilot && params.get('wlpProjectionReview') === '1';
  const projectionStudiedPilot = projectionStatePilot && !projectionReviewPilot;
  const requested = !rollbackRequested && !draftRoute && (params.get('wlpProjectionTrial') !== '1' || projectionStatePilot); // P1-D2 trial must not initialize study-state writer
  const state = {
    ready: false,
    busy: false,
    globalPending: false,
    db: null,
    meta: null,
    cursorMeta: null,
    facade: null,
    prepareError: '',
    overlayByWordId: new Map(),
    contexts: new Map(),
    report: null,
    autoSyncRefreshPending: false,
    autoSyncRefreshDetail: null,
    pilotReviewCreatedHere: '', // Review→Attention only on the very card approved in this page session
    e5Intents: [], e5Draining: false, e5Error: '', e5AppendChain: Promise.resolve()
  };

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function stableValue(v) {
    if (Array.isArray(v)) return v.map(stableValue);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) out[k] = stableValue(v[k]); });
      return out;
    }
    return v;
  }
  function stableStringify(v) { return JSON.stringify(stableValue(v)); }
  function rawGuardField(payload, field) {
    return payload && Object.prototype.hasOwnProperty.call(payload, field) ? clone(payload[field]) : null;
  }
  function utf8Bytes(v) { return new TextEncoder().encode(String(v ?? '')); }
  async function sha256(v) {
    const out = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Bytes(v)));
    return [...out].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function uuidToBytes(v) {
    const h = String(v || '').replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(h)) throw new Error('Invalid UUID namespace.');
    return new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  }
  function bytesToUuid(b) {
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  async function uuidV5(ns, name) {
    const a = uuidToBytes(ns), b = utf8Bytes(name), all = new Uint8Array(a.length + b.length);
    all.set(a); all.set(b, a.length);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    const out = hash.slice(0, 16); out[6] = (out[6] & 0x0f) | 0x50; out[8] = (out[8] & 0x3f) | 0x80;
    return bytesToUuid(out);
  }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')); }
  function requestPromise(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || new Error('IndexedDB request failed.')); }); }
  function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.')); tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.')); }); }
  function openDb() {
    return new Promise((resolve, reject) => {
      let upgrading = false;
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { upgrading = true; };
      req.onsuccess = () => {
        const db = req.result;
        if (upgrading) { db.close(); reject(new Error('Canonical Study cutover blocked: wlp-cloud-v1 did not already exist at schema version 1.')); return; }
        const missing = [META_STORE, OUTBOX_STORE, STATE_STORE, CARD_STORE].filter(x => !db.objectStoreNames.contains(x));
        if (missing.length) { db.close(); reject(new Error(`Canonical Study cutover blocked: missing store(s): ${missing.join(', ')}.`)); return; }
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open wlp-cloud-v1.'));
      req.onblocked = () => reject(new Error('Canonical Study cutover IndexedDB open is blocked by another page.'));
    });
  }
  async function getMeta(db, key) { const tx = db.transaction(META_STORE, 'readonly'), row = await requestPromise(tx.objectStore(META_STORE).get(key)); await transactionDone(tx); return row || null; }
  async function getStateRow(db, cardId) { const tx = db.transaction(STATE_STORE, 'readonly'), row = await requestPromise(tx.objectStore(STATE_STORE).get(cardId)); await transactionDone(tx); return row || null; }
  async function getCardRow(db, cardId) { const tx = db.transaction(CARD_STORE, 'readonly'), row = await requestPromise(tx.objectStore(CARD_STORE).get(cardId)); await transactionDone(tx); return row || null; }
  async function countOutbox(db) { const tx = db.transaction(OUTBOX_STORE, 'readonly'), n = await requestPromise(tx.objectStore(OUTBOX_STORE).count()); await transactionDone(tx); return Number(n || 0); }
  async function getAllOutbox(db) { const tx = db.transaction(OUTBOX_STORE, 'readonly'), rows = await requestPromise(tx.objectStore(OUTBOX_STORE).getAll()); await transactionDone(tx); return Array.isArray(rows) ? rows : []; }
  async function cardIdForWordId(wordId) { return uuidV5(CARD_NAMESPACE_UUID, `card|wid:${String(wordId || '').trim()}`); }
  function ms(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return Number.isFinite(v) ? v : 0; const n = Date.parse(v); return Number.isFinite(n) ? n : 0; }
  function isoFromMs(v) { const n = Number(v || 0); return n > 0 && Number.isFinite(n) ? new Date(n).toISOString() : null; }
  function cleanWordId(v) { const s = String(v || '').trim(); return /^\d+$/.test(s) ? s : ''; }
  function rawLegacy(wordId) { try { return JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`) || '{}'); } catch (_) { return {}; } }
  function rawLegacyString(wordId) { return localStorage.getItem(`${PROGRESS_PREFIX}${wordId}`); }
  function pageRecord(wordId, p = {}) {
    return {
      ...clone(p),
      wordId: String(wordId || ''),
      studied: Boolean(p.studied),
      known: p.known ?? false,
      review: Boolean(p.review),
      reviewLevel: String(p.reviewLevel ?? p.review_level ?? ''),
      reviewReasons: Array.isArray(p.reviewReasons ?? p.review_reasons) ? clone(p.reviewReasons ?? p.review_reasons) : [],
      attempts: Number(p.attempts ?? p.attemptCount ?? p.attempt_count ?? 0),
      studyCount: Number(p.studyCount ?? p.study_count ?? 0),
      reviewCount: Number(p.reviewCount ?? p.review_count ?? 0),
      exposureCount: Number(p.exposureCount ?? p.exposure_count ?? 0),
      firstSeen: ms(p.firstSeen ?? p.first_seen_at),
      lastSeen: ms(p.lastSeen ?? p.last_seen_at),
      lastStudied: ms(p.lastStudied ?? p.lastStudiedAt ?? p.last_studied_at),
      lastReviewed: ms(p.lastReviewed ?? p.lastReviewedAt ?? p.last_reviewed_at),
      lastPracticed: ms(p.lastPracticed ?? p.lastPracticedAt ?? p.last_practiced_at),
      lastAttentionUpdated: ms(p.lastAttentionUpdated ?? p.lastAttentionUpdatedAt ?? p.last_attention_updated_at),
      lastResult: p.lastResult ?? p.last_result ?? null
    };
  }
  function legacyRecord(wordId, payload) { return pageRecord(wordId, payload || {}); }
  function neutralRecord(wordId) { return pageRecord(wordId, { known:false, review:false, studied:false, reviewLevel:'', reviewReasons:[] }); }
  function pageStateLabel(record) { const r = record || {}; if (Boolean(r.review)) return `review:${String(r.reviewLevel || 'none').toLowerCase()}`; if (Boolean(r.known)) return 'studied'; return 'neutral'; }
  function hasLegacyActiveMembership(record) { const r = record || {}; return Boolean(r.known) || Boolean(r.studied) || Boolean(r.review) || Boolean(String(r.reviewLevel || '')) || (Array.isArray(r.reviewReasons) && r.reviewReasons.length > 0); }
  function canonicalRecord(wordId) {
    const row = state.facade?.readProgressRecord?.(wordId) || {};
    return row && Object.keys(row).length ? pageRecord(wordId, row) : null;
  }
  function effectiveRecord(wordId) {
    const canonical = canonicalRecord(wordId);
    const legacy = rawLegacy(wordId);
    let record = state.overlayByWordId.has(wordId) ? clone(state.overlayByWordId.get(wordId)) :
      canonical || (Object.keys(legacy).length ? pageRecord(wordId, legacy) : neutralRecord(wordId));
    if (e5Enabled) for (const intent of state.e5Intents) {
      if (String(intent.wordId) !== String(wordId)) continue;
      record = applyQueuedIntent(record, intent);
    }
    return record;
  }
  function applyQueuedIntent(record, intent) {
    const next = pageRecord(intent.wordId, record);
    if (intent.action === 'studied') Object.assign(next,{known:true,review:false,reviewLevel:'',reviewReasons:[],studied:false});
    else if (intent.action === 'studied_removed' || intent.action === 'review_removed') Object.assign(next,{known:false,review:false,reviewLevel:'',reviewReasons:[],studied:false});
    else if (intent.action === 'review') Object.assign(next,{known:false,review:true});
    else if (intent.action === 'attention_set') Object.assign(next,{known:false,review:true,reviewLevel:intent.level || '',reviewReasons:clone(intent.reasons || [])});
    return next;
  }
  function e5Provider() {
    const provider = window.WLPStudyIntentQueueE5;
    if (!provider?.read || !provider?.append || !provider?.handoff) throw new Error('E5 durable Study intent journal is not loaded');
    return provider;
  }
  async function reloadE5Intents() {
    if (!e5Enabled) return;
    state.e5Intents = await e5Provider().read(state.db, state.meta);
  }
  function storeE5Intent(wordId, action, details = {}) {
    const next = state.e5AppendChain.catch(()=>{}).then(() => storeE5IntentSerialized(wordId,action,details));
    state.e5AppendChain = next;
    return next;
  }
  async function storeE5IntentSerialized(wordId, action, details = {}) {
    if (!state.ready) throw new Error(state.prepareError || 'Canonical Study is not ready');
    if (state.e5Error) throw new Error(`E5 intent queue is blocked: ${state.e5Error}`);
    if (state.busy) throw new Error('Previous Study action is still being prepared; retry after it finishes');
    const current = effectiveRecord(wordId), fromState = pageStateLabel(current);
    const resolved = action === 'studied-toggle' ? (current.known && !current.review ? 'studied_removed' : 'studied') :
      action === 'review-toggle' ? (current.review ? 'review_removed' : 'review') : action;
    if (!['studied','studied_removed','review','review_removed','attention_set'].includes(resolved)) throw new Error('E5 unsupported Study action');
    if (resolved === 'attention_set' && !current.review) throw new Error('E5 Attention requires a Review membership');
    const local = await e5Provider().append(state.db,state.meta,{wordId,action:resolved,expectedFromState:fromState,level:details.level,reasons:details.reasons,expectedQueueCount:state.e5Intents.length});
    state.e5Intents = local.intents;
    const ctx = state.contexts.get(wordId); try {ctx?.refresh?.();} catch(_) {}
    for (const entry of state.contexts.values()) { try { updateContextControls(entry); } catch (_) {} }
    e5QueueNotice();
    toast(`Saved locally · ${state.e5Intents.length} queued Study action(s), awaiting safe Canonical sync.`,4700);
    // Do not require online connectivity to commit an intent into local IndexedDB.
    setTimeout(()=>{void drainE5Intents();},0);
    return {pass:true,queued:true,intentId:local.intent.id,remaining:state.e5Intents.length};
  }
  function e5QueueNotice(inFlight = state.globalPending) {
    if (!e5Enabled) return;
    window.dispatchEvent(new CustomEvent('wlp-e5-intents-changed',{detail:{queued:state.e5Intents.length,inFlight:Boolean(inFlight)}}));
  }
  async function verifyE5Account() {
    const sessionProvider = window.WLPP1C3Review;
    if (typeof sessionProvider?.readSession !== 'function') throw new Error('E5 account verification is unavailable');
    const observed = await sessionProvider.readSession();
    if (String(observed?.session?.userId || '') !== String(state.meta?.userId || '')) throw new Error('E5 account session differs from the Local Canonical Mirror');
    if (String(localStorage.getItem('wlp:device-id:v1') || '') !== String(state.meta?.deviceKey || '')) throw new Error('E5 browser Device ID differs from Local Canonical Mirror');
  }
  async function drainE5Intents() {
    if (!e5Enabled || !state.ready || state.e5Draining || state.busy || !state.e5Intents.length || state.e5Error) return;
    if (navigator.onLine === false) return;
    state.e5Draining = true;
    try {
      await reloadE5Intents();
      if (!state.e5Intents.length || (await countOutbox(state.db)) !== 0) return;
      // Always pull before preparing the next state revision. If another foreground
      // sync is busy, do not stage an action against an unconfirmed base.
      const sync = window.WLPCanonicalForegroundSync;
      if (typeof sync?.runSync !== 'function') throw new Error('E5 requires the existing Foreground Sync');
      const report = await sync.runSync({trigger:'e5-study-queue-base-refresh',receiverOnly:true});
      if (report === null) { setTimeout(()=>{void drainE5Intents();},2000); return; }
      if (!report?.summary?.pass || report?.summary?.deferred || report?.summary?.role === 'receiver-deferred') {
        setStatus('E5 WAIT · Cloud refresh unavailable. Local intents are retained.',null,`Queued actions: ${state.e5Intents.length}. Retry on the next online/foreground event.`);
        return;
      }
      if ((await countOutbox(state.db)) !== 0) return;
      state.meta = await getMeta(state.db,META_KEY);
      state.cursorMeta = await getMeta(state.db,CURSOR_KEY);
      await verifyE5Account();
      await refreshFacade();
      const item = state.e5Intents[0], loaded = await loadCardBase(item.wordId);
      const settledLabel = pageStateLabel(loaded.baseRecord);
      if (settledLabel !== item.expectedFromState) throw new Error(`E5 conflict for WID ${item.wordId}: expected ${item.expectedFromState}, Canonical is ${settledLabel}. Queued intent preserved.`);
      const plan = item.action === 'attention_set'
        ? await buildAttentionPlan(item.wordId,item.level,item.reasons)
        : await buildMembershipPlan(item.wordId,item.action);
      // Atomic ownership transfer: the queue head is removed in the SAME IndexedDB
      // transaction that stages the proven state/event pair into sync_outbox.
      const result = await executePlan(plan,state.contexts.get(item.wordId),item);
      if (!result.pass) throw new Error(result.error || 'E5 Canonical handoff failed; inspect retained outbox');
    } catch(error) {
      state.e5Error = error?.message || String(error);
      setStatus(`E5 CHECK · ${state.e5Error}`,false,'Queued intents and/or Canonical Outbox were retained for safe recovery.',{forcePanel:true});
    } finally {state.e5Draining=false;}
  }

  function nextFrames(n = 2) { return new Promise(resolve => { const step = () => { if (--n <= 0) resolve(); else requestAnimationFrame(step); }; requestAnimationFrame(step); }); }
  async function waitForFacade() { for (let i = 0; i < 80; i++) { const p = window.WLPCanonicalStorageCompatibilityFacade; if (p?.open) return p; await new Promise(r => setTimeout(r, 25)); } return null; }

  function makePanel(force = false) {
    if (!requested || (!auditRequested && !force) || document.getElementById('wlp-study-attention-candidate-box')) return;
    const box = document.createElement('section');
    box.id = 'wlp-study-attention-candidate-box'; box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;z-index:100000;right:8px;top:max(8px,env(safe-area-inset-top));width:min(370px,calc(100vw - 16px));max-height:44vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    box.innerHTML = '<strong style="display:block;font-size:13px">Canonical Study State · v282</strong><div id="wlp-study-attention-candidate-status" style="margin-top:4px">Preparing Canonical Study authority…</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="wlp-study-attention-candidate-export" type="button" disabled>Export JSON</button></div><div id="wlp-study-attention-candidate-detail" style="margin-top:7px;font-size:12px;opacity:.82"></div>';
    document.body.appendChild(box);
    box.querySelectorAll('button').forEach(b => b.style.cssText = 'font:inherit;padding:6px 8px;border:1px solid #aeb9b1;border-radius:8px;background:#f7faf7;color:#1c2d22;');
    document.getElementById('wlp-study-attention-candidate-export')?.addEventListener('click', exportReport);
  }
  function setStatus(text, ok = null, detail = '', options = {}) {
    if (!document.getElementById('wlp-study-attention-candidate-box')) {
      if (!auditRequested && !options.forcePanel) return;
      makePanel(Boolean(options.forcePanel));
    }
    const el = document.getElementById('wlp-study-attention-candidate-status');
    if (el) { el.textContent = text; el.style.fontWeight = ok === null ? '500' : '700'; el.style.color = ok === true ? '#18794e' : ok === false ? '#b42318' : '#1c2d22'; }
    const d = document.getElementById('wlp-study-attention-candidate-detail'); if (d) d.textContent = detail;
    const b = document.getElementById('wlp-study-attention-candidate-export'); if (b) b.disabled = state.busy || !state.report;
  }
  function toast(message, duration = 4200) {
    let node = document.getElementById('study-progress-toast');
    if (!node) { node = document.createElement('div'); node.id = 'study-progress-toast'; node.className = 'study-progress-toast'; node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); document.body.appendChild(node); }
    node.textContent = message; node.classList.add('show'); clearTimeout(toast._timer); toast._timer = setTimeout(() => node.classList.remove('show'), duration);
  }

  async function refreshFacade() {
    const provider = await waitForFacade();
    if (!provider?.open) throw new Error('Storage Compatibility Facade is unavailable.');
    state.facade = await provider.open();
    return state.facade;
  }

  async function prepare() {
    if (!requested) return false;
    if (auditRequested) makePanel();
    try {
      const db = await openDb(), meta = await getMeta(db, META_KEY), cursorMeta = await getMeta(db, CURSOR_KEY);
      if (String(meta?.candidateKey || '') !== BOOTSTRAP.candidateKey || Number(meta?.headVersion || 0) !== BOOTSTRAP.headVersion || String(meta?.migrationVersion || '') !== BOOTSTRAP.migrationVersion || String(meta?.snapshotManifestHash || '') !== BOOTSTRAP.manifestHash || Number(meta?.canonicalRowCount || 0) !== BOOTSTRAP.canonicalRows) {
        db.close(); throw new Error('Default Canonical Study cutover requires the exact ACTIVE Authority-v3 bootstrap mirror.');
      }
      const cursor = Math.max(Number(meta?.materializedSyncCursor ?? meta?.lastSyncCursor ?? 0), Number(cursorMeta?.lastSyncCursor || 0));
      if (cursor < 18) { db.close(); throw new Error(`Default Canonical Study cutover requires the completed v255 roundtrip at cursor 18 or later; found ${cursor}.`); }
      state.db = db; state.meta = meta; state.cursorMeta = cursorMeta;
      const facade = await refreshFacade(), outbox = await countOutbox(db);
      state.globalPending = outbox > 0;
      if (outbox !== Number(facade.pendingOutboxRows || 0)) throw new Error(`Canonical outbox/facade count mismatch: ${outbox} vs ${Number(facade.pendingOutboxRows || 0)}.`);
      if (!e5Enabled && outbox !== 0 && outbox !== 2) throw new Error(`Default Canonical Study cutover found unsupported pending sync_outbox size ${outbox}; expected 0 or one action pair (2).`);
      if (e5Enabled) { await verifyE5Account(); await reloadE5Intents(); e5QueueNotice(); }
      state.ready = true; state.prepareError = '';
      setStatus(outbox ? 'READY · One Canonical Study action is pending Cloud sync.' : 'READY · Normal Study writes now use Canonical outbox.', true, `All official cards · cursor ${cursor} · outbox ${outbox}. Rollback: ?wlpLegacyStudyAttentionWrite=1`);
      if (e5Enabled && state.e5Intents.length) setTimeout(()=>{void drainE5Intents();},300);
      if (state.autoSyncRefreshPending) {
        const pendingDetail = clone(state.autoSyncRefreshDetail || { pass:true, role:'receiver' });
        setTimeout(() => { void onAutoSyncComplete({ detail:pendingDetail }); }, 0);
      }
      return true;
    } catch (error) {
      state.prepareError = error?.message || String(error); state.ready = false;
      setStatus(`BLOCKED · ${state.prepareError}`, false, 'Canonical writes are blocked. Legacy writes stay disabled unless the explicit rollback flag is used.', { forcePanel:true });
      return false;
    }
  }

  function readProgressKey(key) {
    if (!requested || !String(key || '').startsWith(PROGRESS_PREFIX)) return null;
    const wordId = cleanWordId(String(key).slice(PROGRESS_PREFIX.length));
    if (!wordId) return null;
    return effectiveRecord(wordId);
  }

  async function enqueueMutations(plan) {
    const tx = state.db.transaction(OUTBOX_STORE, 'readwrite'), store = tx.objectStore(OUTBOX_STORE);
    let wrote = 0;
    const existing = await Promise.all(plan.mutations.map(m => requestPromise(store.get(m.mutationId))));
    plan.mutations.forEach((m, i) => {
      const row = existing[i];
      if (row) { if (stableStringify(row) !== stableStringify(m)) throw new Error('Canonical Study mutation ID collision.'); }
      else { store.add(clone(m)); wrote++; }
    });
    await transactionDone(tx); return wrote;
  }
  async function cleanupMutations(plan) { const tx = state.db.transaction(OUTBOX_STORE, 'readwrite'), store = tx.objectStore(OUTBOX_STORE); for (const m of plan.mutations) store.delete(m.mutationId); await transactionDone(tx); }
  function mutationShared(actionId, at) {
    return { schemaVersion:1, baseAuthority:{ candidateKey:state.meta.candidateKey, headVersion:state.meta.headVersion, snapshotManifestHash:state.meta.snapshotManifestHash }, deviceKey:state.meta.deviceKey || null, actionId, createdAt:at, diagnosticOnly:false, candidateOnly:false, canonicalStudyDefaultCutover:true, transportEligible:true, status:'pending' };
  }

  async function loadCardBase(wordId) {
    const cardId = await cardIdForWordId(wordId), cardRow = await getCardRow(state.db, cardId), stateRow = await getStateRow(state.db, cardId);
    if (!cardRow) throw new Error(`WID ${wordId} Canonical card row is missing.`);
    const cardPayload = clone(cardRow.payload || {}), cardHash = await sha256(stableStringify(cardPayload));
    if (cardHash !== String(cardRow.payloadHash || '') || String(cardPayload.word_id || '') !== wordId) throw new Error(`WID ${wordId} Canonical card identity/hash mismatch.`);
    if (stateRow) {
      const payload = clone(stateRow.payload || {}), hash = await sha256(stableStringify(payload));
      if (hash !== String(stateRow.payloadHash || '') || String(payload.card_id || '') !== cardId) throw new Error(`WID ${wordId} Canonical learning_state identity/hash mismatch.`);
      return { cardId, stateRow:clone(stateRow), basePayload:payload, baseRecord:legacyRecord(wordId, payload), creating:false };
    }
    const legacy = pageRecord(wordId, rawLegacy(wordId));
    return { cardId, stateRow:null, basePayload:null, baseRecord:legacy, creating:true };
  }

  function seedInitialPayload(wordId, baseRecord, eventType, cardId, at) {
    const first = baseRecord.firstSeen || Date.parse(at), attempts = Number(baseRecord.attempts || 0), studyCount = Number(baseRecord.studyCount || 0), reviewCount = Number(baseRecord.reviewCount || 0);
    const payload = {
      card_id:cardId, studied:false, known:eventType === 'studied', review:eventType === 'review', review_level:null, review_reasons:[],
      exposure_count:Number(baseRecord.exposureCount || 0), study_count:studyCount + (eventType === 'studied' ? 1 : 0), review_count:reviewCount + (eventType === 'review' ? 1 : 0), attempt_count:attempts + 1,
      last_seen_at:at, first_seen_at:new Date(first).toISOString(), last_studied_at:eventType === 'studied' ? at : isoFromMs(baseRecord.lastStudied), last_reviewed_at:eventType === 'review' ? at : isoFromMs(baseRecord.lastReviewed), last_practiced_at:isoFromMs(baseRecord.lastPracticed),
      last_result:eventType, last_attention_updated_at:isoFromMs(baseRecord.lastAttentionUpdated), state_source:'interaction', field_meta:{}, revision:1, derived_through_change_seq:null, updated_at:at
    };
    return payload;
  }

  async function buildMembershipPlan(wordId, action) {
    const loaded = await loadCardBase(wordId), before = loaded.baseRecord, fromState = pageStateLabel(before);
    let eventType = String(action || '');
    if (eventType === 'studied-toggle') eventType = (Boolean(before.known) && !Boolean(before.review)) ? 'studied_removed' : 'studied';
    if (eventType === 'review-toggle') eventType = Boolean(before.review) ? 'review_removed' : 'review';
    if (!['studied','studied_removed','review','review_removed'].includes(eventType)) throw new Error(`Unsupported Canonical Study membership action: ${eventType || '(empty)'}.`);
    if (loaded.creating && hasLegacyActiveMembership(before)) throw new Error(`WID ${wordId} has active legacy membership but no Canonical learning_state. Default cutover will not silently reinterpret it; use rollback or repair migration first.`);
    if (loaded.creating && !['studied','review'].includes(eventType)) throw new Error(`WID ${wordId} has no Canonical learning_state; an initial state can only be created by Studied or Review.`);

    const at = new Date().toISOString(), atMs = Date.parse(at), sharedIntentBase = { cardId:loaded.cardId, wordId, fromState, at, baseHeadVersion:Number(state.meta.headVersion || 0), baseCandidateKey:String(state.meta.candidateKey || '') };
    let next, stateMutation, basePayloadHash = null;

    if (loaded.creating) {
      next = seedInitialPayload(wordId, before, eventType, loaded.cardId, at);
      const toState = pageStateLabel(legacyRecord(wordId, next));
      const intent = { kind:'study-card-initial-learning-state', action:eventType, ...sharedIntentBase, toState, baseAbsent:true, contract:'study-default-canonical-write-v1' };
      const actionId = await uuidV5(CARD_NAMESPACE_UUID, `sync-action|${await sha256(stableStringify(intent))}`), stateMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_state|${actionId}`), eventMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_events|${actionId}`), eventId = await uuidV5(CARD_NAMESPACE_UUID, `sync-event|${eventType}|${actionId}`), shared = mutationShared(actionId, at);
      stateMutation = { ...shared, mutationId:stateMutationId, mutationKind:'insert', tableName:'learning_state', rowKey:loaded.cardId, precondition:{rowMustBeAbsent:true}, changedFields:Object.keys(next), payload:next, payloadHash:await sha256(stableStringify(next)) };
      stateMutation.mutationHash = await sha256(stableStringify(stateMutation));
      const eventLegacy = { timestamp:atMs, action:eventType === 'review' ? 'added-to-review' : 'studied', wordId, source:'study-card', canonicalStudyDefaultCutover:true };
      if (eventType === 'review') eventLegacy.eventName = 'review';
      if (eventType === 'studied') { eventLegacy.previousReviewLevel = ''; eventLegacy.previousReviewReasons = []; }
      const eventPayload = { event_id:eventId, source_event_id:actionId, card_id:loaded.cardId, session_id:null, event_type:eventType, source_stream:'interaction', occurred_at:at, completed_at:null, device_id:state.meta.deviceKey || null, legacy_word_id:Number(wordId), schema_version:1, payload:eventLegacy, imported_at:null, supersedes_event_id:null };
      const eventMutation = { ...shared, mutationId:eventMutationId, mutationKind:'append', tableName:'learning_events', rowKey:eventId, precondition:{rowMustBeAbsent:true}, payload:eventPayload, payloadHash:await sha256(stableStringify(eventPayload)) };
      eventMutation.mutationHash = await sha256(stableStringify(eventMutation));
      return { actionId, eventId, eventType, wordId, cardId:loaded.cardId, fromState, toState, at, creating:true, baseWrapper:null, baseRecord:before, patchedPayload:next, mutations:[stateMutation,eventMutation] };
    }

    basePayloadHash = await sha256(stableStringify(loaded.basePayload));
    if (basePayloadHash !== String(loaded.stateRow.payloadHash || '')) throw new Error('Canonical base payload changed before membership Save.');
    const base = loaded.basePayload, patch = { revision:Number(base.revision || 0) + 1, updated_at:at, last_seen_at:at };
    if (eventType === 'studied') Object.assign(patch, { known:true, review:false, review_level:null, review_reasons:[], attempt_count:Number(base.attempt_count || 0) + 1, study_count:Number(base.study_count || 0) + 1, last_studied_at:at, last_result:'studied' });
    else if (eventType === 'studied_removed') Object.assign(patch, { known:false, review:false, review_level:null, review_reasons:[], last_result:'neutral' });
    else if (eventType === 'review') Object.assign(patch, { known:false, review:true, attempt_count:Number(base.attempt_count || 0) + 1, review_count:Number(base.review_count || 0) + 1, last_reviewed_at:at, last_result:'review' });
    else Object.assign(patch, { known:false, review:false, review_level:null, review_reasons:[], last_result:'neutral' });
    next = { ...base, ...patch };
    const toState = pageStateLabel(legacyRecord(wordId, next));
    const intent = { kind:'study-card-membership', action:eventType, ...sharedIntentBase, toState, basePayloadHash, contract:'study-default-canonical-write-v1' };
    const actionId = await uuidV5(CARD_NAMESPACE_UUID, `sync-action|${await sha256(stableStringify(intent))}`), stateMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_state|${actionId}`), eventMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_events|${actionId}`), eventId = await uuidV5(CARD_NAMESPACE_UUID, `sync-event|${eventType}|${actionId}`), shared = mutationShared(actionId, at);
    stateMutation = { ...shared, mutationId:stateMutationId, mutationKind:'patch', tableName:'learning_state', rowKey:loaded.cardId, precondition:{ payloadHash:basePayloadHash, fields:{ known:rawGuardField(base,'known'), review:rawGuardField(base,'review'), review_level:rawGuardField(base,'review_level'), review_reasons:rawGuardField(base,'review_reasons'), attempt_count:rawGuardField(base,'attempt_count'), study_count:rawGuardField(base,'study_count'), review_count:rawGuardField(base,'review_count'), revision:rawGuardField(base,'revision') } }, changedFields:Object.keys(patch), patch };
    stateMutation.mutationHash = await sha256(stableStringify(stateMutation));
    const eventLegacy = { timestamp:atMs, action:eventType, wordId, source:'study-card', canonicalStudyDefaultCutover:true };
    if (eventType === 'studied') { eventLegacy.previousReviewLevel = String(before.reviewLevel || ''); eventLegacy.previousReviewReasons = Array.isArray(before.reviewReasons) ? clone(before.reviewReasons) : []; }
    if (eventType === 'review') { eventLegacy.action = 'added-to-review'; eventLegacy.eventName = 'review'; }
    if (eventType === 'review_removed' || eventType === 'studied_removed') { eventLegacy.previousReviewLevel = String(before.reviewLevel || ''); eventLegacy.previousReviewReasons = Array.isArray(before.reviewReasons) ? clone(before.reviewReasons) : []; }
    const eventPayload = { event_id:eventId, source_event_id:actionId, card_id:loaded.cardId, session_id:null, event_type:eventType, source_stream:'interaction', occurred_at:at, completed_at:null, device_id:state.meta.deviceKey || null, legacy_word_id:Number(wordId), schema_version:1, payload:eventLegacy, imported_at:null, supersedes_event_id:null };
    const eventMutation = { ...shared, mutationId:eventMutationId, mutationKind:'append', tableName:'learning_events', rowKey:eventId, precondition:{rowMustBeAbsent:true}, payload:eventPayload, payloadHash:await sha256(stableStringify(eventPayload)) };
    eventMutation.mutationHash = await sha256(stableStringify(eventMutation));
    return { actionId, eventId, eventType, wordId, cardId:loaded.cardId, fromState, toState, at, creating:false, baseWrapper:loaded.stateRow, baseRecord:before, patchedPayload:next, mutations:[stateMutation,eventMutation] };
  }

  async function buildAttentionPlan(wordId, level, reasons) {
    const loaded = await loadCardBase(wordId);
    if (loaded.creating) throw new Error(`WID ${wordId} has no Canonical Review state yet. Create/sync Review before setting Attention.`);
    const base = loaded.basePayload, before = loaded.baseRecord;
    if (!Boolean(base.review)) throw new Error('Attention can only be saved while the card is in Review.');
    const toLevel = String(level || '').toLowerCase();
    if (!['','light','medium','high'].includes(toLevel)) throw new Error(`Unsupported Canonical Attention level: ${toLevel || '(none)'}.`);
    const fromLevel = String(base.review_level || '').toLowerCase(), reasonList = Array.isArray(reasons) ? clone(reasons) : [];
    const at = new Date().toISOString(), atMs = Date.parse(at), basePayloadHash = await sha256(stableStringify(base));
    if (basePayloadHash !== String(loaded.stateRow.payloadHash || '')) throw new Error('Canonical base payload changed before Attention Save.');
    const patch = { known:false, review:true, review_level:toLevel || null, review_reasons:reasonList, last_attention_updated_at:at, revision:Number(base.revision || 0) + 1, updated_at:at };
    const next = { ...base, ...patch }, fromState = pageStateLabel(before), toState = pageStateLabel(legacyRecord(wordId, next));
    const intent = { kind:'study-card-attention-save', cardId:loaded.cardId, wordId, fromLevel, toLevel, reasons:reasonList, at, basePayloadHash, baseHeadVersion:Number(state.meta.headVersion || 0), baseCandidateKey:String(state.meta.candidateKey || ''), contract:'study-default-canonical-write-v1' };
    const actionId = await uuidV5(CARD_NAMESPACE_UUID, `sync-action|${await sha256(stableStringify(intent))}`), stateMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_state|${actionId}`), eventMutationId = await uuidV5(CARD_NAMESPACE_UUID, `sync-mutation|learning_events|${actionId}`), eventId = await uuidV5(CARD_NAMESPACE_UUID, `sync-event|attention_set|${actionId}`), shared = mutationShared(actionId, at);
    const stateMutation = { ...shared, mutationId:stateMutationId, mutationKind:'patch', tableName:'learning_state', rowKey:loaded.cardId, precondition:{ payloadHash:basePayloadHash, fields:{ review:rawGuardField(base,'review'), review_level:rawGuardField(base,'review_level'), review_reasons:rawGuardField(base,'review_reasons'), last_attention_updated_at:rawGuardField(base,'last_attention_updated_at'), revision:rawGuardField(base,'revision') } }, changedFields:Object.keys(patch), patch };
    stateMutation.mutationHash = await sha256(stableStringify(stateMutation));
    const eventPayload = { event_id:eventId, source_event_id:actionId, card_id:loaded.cardId, session_id:null, event_type:'attention_set', source_stream:'interaction', occurred_at:at, completed_at:null, device_id:state.meta.deviceKey || null, legacy_word_id:Number(wordId), schema_version:1, payload:{ timestamp:atMs, action:'attention_set', wordId, source:'study-card', level:toLevel, reasons:reasonList, fromLevel, canonicalStudyDefaultCutover:true }, imported_at:null, supersedes_event_id:null };
    const eventMutation = { ...shared, mutationId:eventMutationId, mutationKind:'append', tableName:'learning_events', rowKey:eventId, precondition:{rowMustBeAbsent:true}, payload:eventPayload, payloadHash:await sha256(stableStringify(eventPayload)) };
    eventMutation.mutationHash = await sha256(stableStringify(eventMutation));
    return { actionId, eventId, eventType:'attention_set', wordId, cardId:loaded.cardId, fromState, toState, fromLevel, toLevel, at, creating:false, baseWrapper:loaded.stateRow, baseRecord:before, patchedPayload:next, mutations:[stateMutation,eventMutation] };
  }

  function uiStateForContext(ctx) {
    const root = ctx?.root;
    return { studiedText:(root?.querySelector('.btn-studied')?.textContent || '').trim(), studiedPressed:root?.querySelector('.btn-studied')?.getAttribute('aria-pressed') || '', reviewText:(root?.querySelector('.btn-review')?.textContent || '').trim(), reviewPressed:root?.querySelector('.btn-review')?.getAttribute('aria-pressed') || '', attentionHidden:Boolean(root?.querySelector('.btn-review-attention')?.hidden), attentionText:(root?.querySelector('.btn-review-attention')?.textContent || '').trim() };
  }
  function expectedUiOk(eventType, ui) {
    if (eventType === 'studied') return ui.studiedPressed === 'true' && ui.reviewPressed === 'false' && ui.attentionHidden;
    if (eventType === 'studied_removed') return ui.studiedPressed === 'false' && ui.reviewPressed === 'false' && ui.attentionHidden;
    if (eventType === 'review') return ui.studiedPressed === 'false' && ui.reviewPressed === 'true' && !ui.attentionHidden;
    if (eventType === 'review_removed') return ui.studiedPressed === 'false' && ui.reviewPressed === 'false' && ui.attentionHidden;
    if (eventType === 'attention_set') return ui.reviewPressed === 'true' && !ui.attentionHidden;
    return false;
  }
  function allRenderedControlsPending(pending) {
    for (const ctx of state.contexts.values()) {
      const root = ctx?.root; if (!root) continue;
      const wordId = cleanWordId(ctx.wordId);
      const studied = root.querySelector('.btn-studied'), review = root.querySelector('.btn-review'), attention = root.querySelector('.btn-review-attention');
      const validPilotTarget = window.WLPP1D4StudyPilot?.isActive?.() && wordId === window.WLPP1D4StudyPilot?.getStatus?.()?.wordId;
      if (projectionReviewPilot) {
        const record = effectiveRecord(wordId);
        const neutral = pageStateLabel(record) === 'neutral';
        if (studied) studied.disabled = true;
        if (review) review.disabled = pending || !state.ready || !validPilotTarget || !neutral;
        if (attention) attention.disabled = pending || !state.ready || !validPilotTarget || state.pilotReviewCreatedHere !== wordId || !Boolean(record.review);
      } else {
        if (studied) studied.disabled = pending || !state.ready || (projectionStatePilot && !validPilotTarget);
        if (review) review.disabled = projectionStatePilot || pending || !state.ready;
        if (attention && !attention.hidden) attention.disabled = projectionStatePilot || pending || !state.ready;
      }
    }
  }
  function membershipToast(eventType) {
    if (eventType === 'studied') return ['Studied for now. No special review attention is active. Tap Studied again to remove this mark, or tap Review whenever you want to bring it back into review.', 6200];
    if (eventType === 'studied_removed') return ['Studied mark removed. This card is neutral for now.', 4200];
    if (eventType === 'review') return ['Added to Review. Set attention only if you want to.', 4600];
    return ['Removed from Review. This card is neutral for now. Tap Review again whenever you want to bring it back.', 4800];
  }

  async function executePlan(plan, ctx, e5Intent = null) {
    if (!state.ready) throw new Error(state.prepareError || 'Canonical Study cutover is not ready.');
    if (state.busy) throw new Error('Another Canonical Study action is running.');
    const beforeOutbox = await countOutbox(state.db);
    if (beforeOutbox !== 0) throw new Error(`One Canonical action must be synced before another write; sync_outbox currently has ${beforeOutbox} row(s).`);
    const legacyBefore = rawLegacyString(plan.wordId), baseWrapperBefore = plan.baseWrapper ? clone(plan.baseWrapper) : null;
    state.busy = true; setStatus(`Saving WID ${plan.wordId} ${plan.eventType} → Canonical outbox…`); let cleanupNeeded = false;
    try {
      const wrote = e5Intent ? (state.e5Intents = await e5Provider().handoff(state.db,state.meta,e5Intent,plan.mutations),2) : await enqueueMutations(plan);
      if (e5Intent) e5QueueNotice(true);
      cleanupNeeded = !e5Intent; const afterOutbox = await countOutbox(state.db);
      state.overlayByWordId.set(plan.wordId, legacyRecord(plan.wordId, plan.patchedPayload));
      ctx?.refresh?.(); await nextFrames(3);
      const facade = await refreshFacade(), overlayRecord = pageRecord(plan.wordId, facade.readProgressRecord(plan.wordId)), overlayEvents = facade.readInteractionEvents();
      const eventFound = overlayEvents.some(e => String(e?.wordId || '') === plan.wordId && e?.canonicalStudyDefaultCutover === true && (String(e?.action || '') === plan.eventType || (plan.eventType === 'review' && String(e?.eventName || '') === 'review')));
      const baseWrapperDuring = await getStateRow(state.db, plan.cardId), baseUntouched = plan.creating ? baseWrapperDuring === null : stableStringify(baseWrapperDuring) === stableStringify(baseWrapperBefore);
      const rows = await getAllOutbox(state.db), ours = rows.filter(r => r?.canonicalStudyDefaultCutover === true && r?.transportEligible === true && String(r?.actionId || '') === plan.actionId);
      const identitiesOk = ours.length === 2 && ours.every(r => isUuid(r.mutationId)) && isUuid(plan.actionId) && isUuid(plan.eventId);
      const actualState = pageStateLabel(overlayRecord), ui = uiStateForContext(ctx), predicted = effectiveRecord(plan.wordId);
      const uiOk = e5Intent ? (!ctx?.root || (ui.studiedPressed === String(Boolean(predicted.known && !predicted.review)) && ui.reviewPressed === String(Boolean(predicted.review)) && ui.attentionHidden === !Boolean(predicted.review))) : expectedUiOk(plan.eventType,ui);
      const legacyUntouched = rawLegacyString(plan.wordId) === legacyBefore;
      const expectedFirstSeen = plan.creating ? ms(plan.patchedPayload.first_seen_at) : Number(plan.baseRecord.firstSeen || 0), firstSeenOk = Number(overlayRecord.firstSeen || 0) === Number(expectedFirstSeen || 0);
      const checks = [
        ['Exactly two transport-eligible Canonical mutations retained', wrote === 2 && afterOutbox === 2 && ours.length === 2, `outbox ${beforeOutbox} → ${afterOutbox}`],
        ['Production action/mutation/event identities are UUIDs', identitiesOk, `${plan.actionId} · ${ours.length} mutations`],
        ['Storage Facade overlays the pending state/event pair', Number(facade.pendingOutboxRows || 0) >= 2 && Number(facade.overlayMutationsApplied || 0) >= 2 && actualState === plan.toState && eventFound, `${actualState} · ${Number(facade.overlayMutationsApplied || 0)} applied`],
        ['Study UI immediately reflects the pending Canonical state', uiOk, `${ui.studiedText} / ${ui.reviewText} / ${ui.attentionText || 'attention hidden'}`],
        ['Canonical materialized base stays immutable until steady sync', baseUntouched, plan.creating ? 'learning_state still absent in base mirror' : 'learning_state wrapper unchanged'],
        ['Legacy localStorage is untouched by the Canonical membership/attention action', legacyUntouched, legacyUntouched ? 'byte-identical during action' : 'legacy progress changed during action'],
        [plan.creating ? 'Initial firstSeen is preserved/created explicitly' : 'Explicit firstSeen survives the Canonical patch', firstSeenOk, String(overlayRecord.firstSeen || 0)]
      ].map(([name, pass, evidence]) => ({ name, pass:Boolean(pass), evidence:String(evidence) }));
      const blocking = checks.filter(x => !x.pass).map(x => x.name), cursor = Math.max(Number(state.meta?.materializedSyncCursor ?? state.meta?.lastSyncCursor ?? 0), Number(state.cursorMeta?.lastSyncCursor || 0));
      state.report = { format:'WLP_CANONICAL_STUDY_DEFAULT_WRITE_CUTOVER', version:1, appVersion:APP_VERSION, generatedAt:new Date().toISOString(), mode:'normal-study-default-canonical-write-to-persistent-outbox', device:{ deviceKey:state.meta?.deviceKey || null, platform:/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'iPhone Safari/WebKit' : 'Windows Browser' }, authority:{ candidateKey:state.meta?.candidateKey || null, headVersion:state.meta?.headVersion || null, snapshotManifestHash:state.meta?.snapshotManifestHash || null, materializedSyncCursor:cursor, materializedManifestHash:state.meta?.materializedManifestHash || null, materializedRows:state.meta?.materializedCanonicalRowCount || null }, summary:{ defaultCutoverActive:true, wordId:plan.wordId, action:plan.eventType, fromState:plan.fromState, toState:plan.toState, initialCreate:plan.creating, outboxRowsBefore:beforeOutbox, outboxRowsAfter:afterOutbox, overlayMutationsApplied:Number(facade.overlayMutationsApplied || 0), studyUiStudied:ui.studiedText, studyUiReview:ui.reviewText, studyUiAttention:ui.attentionText, transportEligible:true, productionUuidIds:identitiesOk, baseMirrorUntouched:baseUntouched, firstSeenValid:firstSeenOk, legacyLocalStorageUntouched:legacyUntouched, cloudWrites:0, blockingIssues:blocking.length, nextPhaseEligible:blocking.length === 0, pass:blocking.length === 0 }, plan:{ actionId:plan.actionId, eventType:plan.eventType, wordId:plan.wordId, cardId:plan.cardId, fromState:plan.fromState, toState:plan.toState, mutationIds:ours.map(x => x.mutationId).sort(), eventId:plan.eventId, createdAt:plan.at }, checks, issues:{ blocking, warnings:['One pending Canonical action pair is allowed at a time; raw Canonical field representation is preserved in conflict guards, supported actions may be claimed by foreground auto-sync, and manual Cloud Shadow remains fallback.','Attention supports no level plus Light/Medium/High while Review membership stays active.','Explicit rollback remains available with ?wlpLegacyStudyAttentionWrite=1.'] }, invariants:{ normalRouteNoQueryOptIn:true, allOfficialCardsEligible:true, noLegacyMembershipAttentionWrite:legacyUntouched, indexedDbWritesRestrictedToSyncOutbox:true, pendingRowsTransportEligible:true, noCloudWrites:true, authorityBaseImmutable:baseUntouched, noConflictAutoOverwrite:true, explicitFirstSeenValid:firstSeenOk } };
      if (blocking.length) throw new Error(`Cutover verification failed: ${blocking.join('; ')}`);
      cleanupNeeded = false; state.globalPending = true; if (!e5Enabled) allRenderedControlsPending(true);
      setStatus(`PASS · WID ${plan.wordId} ${plan.eventType} is pending foreground sync.`, true, `outbox 0 → 2 · cursor ${cursor} · queued ${state.e5Intents.length} · existing Foreground Sync will ACK before next action.`);
      window.dispatchEvent(new CustomEvent('wlp-canonical-outbox-staged', { detail:{ source:'study', actionId:plan.actionId, wordId:plan.wordId, eventType:plan.eventType, mutationCount:ours.length } }));
      return { pass:true, reloading:false, eventType:plan.eventType, fromState:plan.fromState, toState:plan.toState, report:clone(state.report) };
    } catch (error) {
      const message = error?.message || String(error);
      try { if (cleanupNeeded) await cleanupMutations(plan); } catch (cleanupError) { console.error('Canonical Study cleanup failed', cleanupError); }
      if (!e5Intent) state.overlayByWordId.delete(plan.wordId); try { ctx?.refresh?.(); } catch (_) {}
      state.report = { format:'WLP_CANONICAL_STUDY_DEFAULT_WRITE_CUTOVER', version:1, appVersion:APP_VERSION, generatedAt:new Date().toISOString(), mode:'normal-study-default-canonical-write-to-persistent-outbox', summary:{ defaultCutoverActive:true, wordId:plan.wordId, action:plan.eventType, blockingIssues:1, nextPhaseEligible:false, pass:false }, issues:{ blocking:[message], warnings:['Best-effort outbox cleanup was attempted. No Cloud write or legacy progress write was intended.'] }, invariants:{ noCloudWrites:true } };
      setStatus(`BLOCKED · ${message}`, false, 'No second action should be attempted until this is understood.', { forcePanel:true });
      return { pass:false, error:message, report:clone(state.report) };
    } finally { state.busy = false; if (e5Enabled) for(const c of state.contexts.values()) {try{updateContextControls(c);}catch(_){}} const b = document.getElementById('wlp-study-attention-candidate-export'); if (b) b.disabled = !state.report; }
  }

  async function runMembershipRoundtrip(input) {
    const wordId = cleanWordId(typeof input === 'object' ? input.wordId : '');
    const action = typeof input === 'object' ? input.action : input;
    if (projectionStatePilot && (!window.WLPP1D4StudyPilot?.isActive?.() || wordId !== window.WLPP1D4StudyPilot?.getStatus?.()?.wordId || action !== (projectionReviewPilot ? 'review-toggle' : 'studied-toggle'))) return { pass:false, error:'Projection pilot blocks this membership action; only the verified first WID is eligible.' };
    const ctx = state.contexts.get(wordId) || (typeof input === 'object' ? input.ctx : null);
    if (!wordId) return { pass:false, error:'Canonical Study membership action has no WordID.' };
    try {
      if (e5Enabled) return await storeE5Intent(wordId,action);
      const plan = await buildMembershipPlan(wordId, action);
      if (projectionStatePilot && (plan.eventType !== (projectionReviewPilot ? 'review' : 'studied') || plan.fromState !== 'neutral')) return { pass:false, error:'Projection pilot may change only a neutral card to its approved state. Existing membership was not changed.' };
      const result = await executePlan(plan, ctx);
      if (result.pass) {
        if (projectionReviewPilot && plan.eventType === 'review') state.pilotReviewCreatedHere = wordId;
        const [message, duration] = membershipToast(plan.eventType); toast(message, duration);
        if (ctx?.isReviewMode && (plan.eventType === 'studied' || plan.eventType === 'review_removed')) ctx.removeFromReviewDeck?.();
      } else toast('Canonical Study action was blocked. No legacy progress write occurred.', 6200);
      return result;
    } catch (error) {
      const message = error?.message || String(error); setStatus(`BLOCKED · ${message}`, false, 'No Canonical or legacy membership write was performed.', { forcePanel:true }); toast('Canonical Study action was blocked. No legacy progress write occurred.', 6200); return { pass:false, error:message };
    }
  }

  async function runAttentionRoundtrip(input = {}) {
    if (projectionStudiedPilot) return { pass:false, error:'P1-D4 Attention writes are not enabled.' };
    const wordId = cleanWordId(input.wordId), ctx = state.contexts.get(wordId) || null;
    if (projectionReviewPilot && (!window.WLPP1D4StudyPilot?.isActive?.() || wordId !== window.WLPP1D4StudyPilot?.getStatus?.()?.wordId || state.pilotReviewCreatedHere !== wordId || !state.ready || state.globalPending || !effectiveRecord(wordId).review)) return { pass:false, error:'P1-D5 permits Attention only after this page has created and synced Review for the verified first card.' };
    if (!wordId) return { pass:false, error:'Canonical Study Attention action has no WordID.' };
    try {
      if (e5Enabled) return await storeE5Intent(wordId,'attention_set',{level:input.level,reasons:input.reasons});
      const plan = await buildAttentionPlan(wordId, input.level, input.reasons), result = await executePlan(plan, ctx || { refresh:input.refresh });
      if (result.pass) toast(plan.toLevel ? `${plan.toLevel[0].toUpperCase()}${plan.toLevel.slice(1)} attention saved.` : 'Review attention details saved.', 4200);
      else toast('Canonical Study attention was blocked. No legacy attention write occurred.', 6200);
      return result;
    } catch (error) {
      const message = error?.message || String(error); setStatus(`BLOCKED · ${message}`, false, 'No Canonical or legacy Attention write was performed.', { forcePanel:true }); toast('Canonical Study attention was blocked. No legacy attention write occurred.', 6200); return { pass:false, error:message };
    }
  }

  function updateContextControls(ctx) {
    const root = ctx?.root; if (!root) return;
    const wordId = cleanWordId(ctx.wordId), studied = root.querySelector('.btn-studied'), review = root.querySelector('.btn-review'), attention = root.querySelector('.btn-review-attention');
    if (projectionStatePilot && (wordId !== window.WLPP1D4StudyPilot?.getStatus?.()?.wordId || !window.WLPP1D4StudyPilot?.isActive?.())) {
      if (studied) studied.disabled = true;
      if (review) review.disabled = true;
      if (attention) attention.disabled = true;
      return;
    }
    if (!state.ready || (!e5Enabled && state.globalPending) || (e5Enabled && Boolean(state.e5Error))) {
      const title = state.e5Error || (state.ready ? 'Canonical Study action pending Cloud sync. Run Cloud Shadow steady sync before another write.' : `Canonical Study cutover blocked: ${state.prepareError || 'not ready'}`);
      if (studied) { studied.disabled = true; studied.title = title; }
      if (review) { review.disabled = true; review.title = title; }
      if (attention && !attention.hidden) { attention.disabled = true; attention.title = title; }
      return;
    }
    const canonical = canonicalRecord(wordId), legacy = pageRecord(wordId, rawLegacy(wordId));
    const missingWithLegacyMembership = !canonical && hasLegacyActiveMembership(legacy);
    if (projectionStudiedPilot && pageStateLabel(effectiveRecord(wordId)) !== 'neutral') {
      if (studied) { studied.disabled = true; studied.title = 'P1-D4 only permits marking a neutral card Studied; no existing status will be removed.'; }
      if (review) review.disabled = true;
      if (attention) attention.disabled = true;
      return;
    }
    if (missingWithLegacyMembership) {
      const title = 'Legacy membership exists but Canonical learning_state is absent. Default cutover blocks writes until migration is repaired or rollback is explicitly enabled.';
      if (studied) { studied.disabled = true; studied.title = title; }
      if (review) { review.disabled = true; review.title = title; }
      if (attention && !attention.hidden) { attention.disabled = true; attention.title = title; }
      return;
    }
    if (projectionReviewPilot) {
      const neutral = pageStateLabel(effectiveRecord(wordId)) === 'neutral';
      const created = state.pilotReviewCreatedHere === wordId && Boolean(canonical?.review);
      if (studied) { studied.disabled = true; studied.title = 'P1-D5 Review trial does not change Studied.'; }
      if (review) { review.disabled = !neutral; review.title = neutral ? 'Add this neutral card to Canonical Review.' : 'P1-D5 will not remove or overwrite an existing Review.'; }
      if (attention) { attention.disabled = !created; attention.title = created ? 'Set Canonical Attention for this newly reviewed card.' : 'Attention requires Review created and Cloud-synced in this page session.'; }
      return;
    }
    if (studied) { studied.disabled = false; studied.title = 'Save Studied through Canonical outbox.'; }
    if (review) { review.disabled = projectionStatePilot; review.title = projectionStatePilot ? 'P1-D4 first pilot enables Studied only.' : 'Save Review through Canonical outbox.'; }
    if (attention && !attention.hidden) { const canReview = e5Enabled ? Boolean(effectiveRecord(wordId).review) : Boolean(canonical); attention.disabled = projectionStatePilot || !canReview; attention.title = projectionStatePilot ? 'P1-D4 Attention not enabled.' : canReview ? 'Save Attention through Canonical outbox.' : 'Sync the initial Review state before setting Attention.'; }
  }

  async function afterRender(ctx = {}) {
    if (!requested) return;
    const wordId = cleanWordId(ctx.wordId); if (!wordId) return;
    state.contexts.set(wordId, ctx);
    const root = ctx.root; if (!root) return;
    const bind = (button, action) => {
      if (!button || button.dataset.wlpCanonicalDefaultCutoverBound === '1') return;
      button.dataset.wlpCanonicalDefaultCutoverBound = '1';
      button.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); void runMembershipRoundtrip({ action, wordId, ctx }); });
    };
    bind(root.querySelector('.btn-studied'), 'studied-toggle');
    bind(root.querySelector('.btn-review'), 'review-toggle');
    requestAnimationFrame(() => updateContextControls(ctx));
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type:'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `wlp-canonical-study-default-write-cutover-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function onAutoSyncComplete(event) {
    const detail = event?.detail || {};
    if (!detail.pass || !['source','receiver'].includes(String(detail.role || ''))) return;
    if (!state.db || !state.ready) {
      state.autoSyncRefreshPending = true;
      state.autoSyncRefreshDetail = clone(detail);
      return;
    }
    try {
      const outbox = await countOutbox(state.db);
      if (outbox !== 0) return;
      const wordId = cleanWordId(detail.wordId);
      if (wordId) state.overlayByWordId.delete(wordId);
      state.meta = await getMeta(state.db, META_KEY); state.cursorMeta = await getMeta(state.db, CURSOR_KEY);
      await refreshFacade(); state.globalPending = false; e5QueueNotice(false);
      for (const ctx of state.contexts.values()) { try { ctx?.refresh?.(); } catch (_) {} }
      allRenderedControlsPending(false);
      for (const ctx of state.contexts.values()) updateContextControls(ctx);
      const cursor = Math.max(Number(state.meta?.materializedSyncCursor ?? state.meta?.lastSyncCursor ?? 0), Number(state.cursorMeta?.lastSyncCursor || 0));
      if (detail.role === 'source') {
        setStatus(`PASS · WID ${String(detail.wordId || '?')} ${String(detail.eventType || 'action')} auto-sync committed at cursor ${cursor}.`, true, 'outbox 0 · Study projection refreshed · normal controls re-enabled.');
      } else {
        setStatus(`READY · Receiver pull committed at cursor ${cursor}.`, true, `WID ${String(detail.wordId || '?')} ${String(detail.eventType || 'change')} · Study projection refreshed · outbox 0.`);
      }
      state.autoSyncRefreshPending = false;
      state.autoSyncRefreshDetail = null;
      if (e5Enabled && state.e5Intents.length) setTimeout(()=>{void drainE5Intents();},120);
    } catch (error) {
      state.autoSyncRefreshPending = true;
      state.autoSyncRefreshDetail = clone(detail);
      console.warn('Canonical Study auto-sync completion refresh failed', error);
    }
  }
  window.addEventListener('wlp-canonical-auto-sync-complete', onAutoSyncComplete);
  if (e5Enabled) {
    addEventListener('online',()=>{if(!state.e5Error)void drainE5Intents();});
    addEventListener('focus',()=>{if(!state.e5Error)void drainE5Intents();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.e5Error)void drainE5Intents();});
  }
  function close() { try { state.db?.close(); } catch (_) {} }
  addEventListener('pagehide', close, { once:true });

  const api = { version:11, requested, rollbackRequested, auditRequested, e5Enabled, getE5QueueCount:()=>state.e5Intents.length, hasE5InFlight:()=>state.globalPending, prepare, isActive:() => requested, isReady:() => state.ready, getPrepareError:() => state.prepareError, readProgressKey, runAttentionRoundtrip, runMembershipRoundtrip, afterRender, getReport:() => clone(state.report) };
  window.WLPCanonicalStudyAttentionWriteCandidate = Object.freeze(api);
  if (auditRequested) makePanel();
})();
