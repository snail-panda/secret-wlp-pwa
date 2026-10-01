/* WLP Canonical Storage Compatibility Facade v1.
   Exposes a read-only, page-facing Progress / Review storage contract over the
   already-installed Canonical Compatibility Adapter. It does not replace
   localStorage, write IndexedDB, contact Cloud, or wire any live WLP page.
   The audit verifies typed-reader/storage-surface parity, deterministic open,
   cloning isolation, Review card resolution, and current-device payload coverage. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.225-storage-compat-facade-outbox-overlay-v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const EXPECTED_CANDIDATE_KEY = 'v2:5af226161d437e7941ea21807f78972e4b0c9fafd353832e8128f4cb89d06283';
  const EXPECTED_HEAD_VERSION = 2;
  const EXPECTED_MIGRATION_VERSION = '3';
  const EXPECTED_MANIFEST = 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3';
  const EXPECTED_PROGRESS_ROWS = 111;
  const EVENT_KEYS = Object.freeze({
    standard: 'wlp:studyq-events:v1',
    ai: 'wlp:ai-study-events:v1',
    activity: 'wlp:stage7:activity-events:v1',
    interaction: 'wlp:stage7:interaction-events:v1',
    practice: 'wlp:stage7:practice-events:v1',
    'quick-review': 'wlp:review-quick-events:v1'
  });
  const SESSION_KEYS = Object.freeze({
    standard: 'wlp:studyq-sessions:v1',
    ai: 'wlp:ai-study-session-history:v1'
  });
  const PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const ROUTE_KEY = 'wlp:ai-route-state:v1';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const OUTBOX_STORE = 'sync_outbox';
  const CARD_STORE = 'cards';
  const STATE_STORE = 'learning_state';
  const EVENT_STORE = 'learning_events';
  const state = { busy: false, report: null };

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }
  function clean(value) { return String(value ?? '').trim(); }
  function asArray(value) { return Array.isArray(value) ? value : []; }
  function safeParse(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        if (value[key] !== undefined) out[key] = stableValue(value[key]);
      });
      return out;
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(stableValue(value)); }
  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }
  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });
  }
  async function readPendingOverlayContext(adapter) {
    if (!('indexedDB' in window)) throw new Error('Storage facade overlay blocked: IndexedDB is unavailable.');
    let db = null;
    try {
      db = await new Promise((resolve, reject) => {
        let rejectedForUpgrade = false;
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => { rejectedForUpgrade = true; try { request.transaction.abort(); } catch (_) {} };
        request.onsuccess = () => {
          if (rejectedForUpgrade) { request.result.close(); reject(new Error('Storage facade overlay blocked: wlp-cloud-v1 does not already exist at schema version 1.')); return; }
          const candidate = request.result;
          const required = [OUTBOX_STORE, CARD_STORE, STATE_STORE, EVENT_STORE];
          const missing = required.filter(name => !candidate.objectStoreNames.contains(name));
          if (missing.length) { candidate.close(); reject(new Error(`Storage facade overlay blocked: missing store(s): ${missing.join(', ')}.`)); return; }
          resolve(candidate);
        };
        request.onerror = () => reject(request.error || new Error('Storage facade overlay could not open wlp-cloud-v1.'));
        request.onblocked = () => reject(new Error('Storage facade overlay open is blocked by another WLP page.'));
      });
      const tx = db.transaction([OUTBOX_STORE, CARD_STORE, STATE_STORE, EVENT_STORE], 'readonly');
      const [outboxRows, cardWrappers, stateWrappers, eventWrappers] = await Promise.all([
        requestPromise(tx.objectStore(OUTBOX_STORE).getAll()),
        requestPromise(tx.objectStore(CARD_STORE).getAll()),
        requestPromise(tx.objectStore(STATE_STORE).getAll()),
        requestPromise(tx.objectStore(EVENT_STORE).getAll())
      ]);
      await transactionDone(tx);
      const pending = (outboxRows || []).filter(row => /pending$/i.test(String(row?.status || ''))).sort((a, b) => {
        const at = toMs(a?.createdAt), bt = toMs(b?.createdAt);
        if (at !== bt) return at - bt;
        return String(a?.mutationId || '').localeCompare(String(b?.mutationId || ''));
      });
      return {
        pending,
        cardsById: new Map((cardWrappers || []).map(wrapper => [String(wrapper?.rowKey || ''), wrapper])),
        statesById: new Map((stateWrappers || []).map(wrapper => [String(wrapper?.rowKey || ''), wrapper])),
        eventIds: new Set((eventWrappers || []).map(wrapper => String(wrapper?.rowKey || ''))),
        adapterMeta: clone(adapter?.meta || {})
      };
    } finally {
      if (db) db.close();
    }
  }
  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  function boolOrNull(value) { return typeof value === 'boolean' ? value : null; }
  function normalizedLevel(value) {
    const level = clean(value).toLowerCase();
    return ['high', 'medium', 'light'].includes(level) ? level : '';
  }
  function normalizedReasons(value) {
    return asArray(value).map(item => clean(item).toLowerCase()).filter(Boolean);
  }
  function toMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = Number(value);
    if (Number.isFinite(number) && String(value).trim() !== '') {
      if (number <= 0) return 0;
      return number < 100000000000 ? Math.round(number * 1000) : Math.round(number);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function firstWordId(value) {
    const obj = value && typeof value === 'object' ? value : {};
    const candidates = [
      obj.wordId, obj.wordID, obj.word_id, obj.wid, obj.cardWordId, obj.targetWordId,
      obj.card?.wordId, obj.card?.wordID, obj.target?.wordId, obj.target?.wordID,
      obj.result?.wordId, obj.route?.wordId, obj.context?.wordId,
      obj.attempt?.wordId, obj.attempt?.wordID
    ];
    for (const candidate of candidates) {
      const id = clean(candidate);
      if (id) return id;
    }
    return '';
  }
  function eventTimeMs(event) {
    const obj = event && typeof event === 'object' ? event : {};
    const candidates = [
      obj.occurredAt, obj.occurred_at, obj.timestamp, obj.createdAt, obj.created_at,
      obj.at, obj.updatedAt, obj.completedAt, obj.startedAt, obj.observedAt,
      obj.recordedAt, obj.committedAt, obj.interpretedAt, obj.receivedAt
    ];
    for (const value of candidates) {
      const ms = toMs(value);
      if (ms) return ms;
    }
    return 0;
  }
  function sessionTimeMs(session) {
    const obj = session && typeof session === 'object' ? session : {};
    const candidates = [obj.startedAt, obj.started_at, obj.createdAt, obj.created_at, obj.timestamp, obj.endedAt, obj.completedAt, obj.updatedAt];
    for (const value of candidates) {
      const ms = toMs(value);
      if (ms) return ms;
    }
    return 0;
  }
  function fallbackIndex(entityKey) {
    const match = String(entityKey || '').match(/:index:(\d+):/);
    return match ? Number(match[1]) : null;
  }
  function sortStreamRecords(rows, payloadName, timeFn) {
    return [...rows].sort((a, b) => {
      const ai = fallbackIndex(a?.entityKey), bi = fallbackIndex(b?.entityKey);
      if (ai !== null && bi !== null) return ai - bi;
      const at = timeFn(a?.payload?.[payloadName]), bt = timeFn(b?.payload?.[payloadName]);
      if (at !== bt) return at - bt;
      if (ai !== null && bi === null) return -1;
      if (ai === null && bi !== null) return 1;
      return String(a?.entityKey || '').localeCompare(String(b?.entityKey || ''), undefined, { numeric: true });
    });
  }

  function buildEventTimeIndex(adapter) {
    const firstByWordId = new Map();
    const lastByWordId = new Map();
    for (const row of adapter.listEvents()) {
      const event = row?.payload?.event;
      const wordId = firstWordId(event);
      const timestamp = eventTimeMs(event);
      if (!wordId || !timestamp) continue;
      const first = firstByWordId.get(wordId) || 0;
      const last = lastByWordId.get(wordId) || 0;
      if (!first || timestamp < first) firstByWordId.set(wordId, timestamp);
      if (!last || timestamp > last) lastByWordId.set(wordId, timestamp);
    }
    return { firstByWordId, lastByWordId };
  }

  function pageStateFromPayload(payload, wordId, eventTimes) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const explicitFirst = toMs(p.firstSeen ?? p.first_seen_at);
    const explicitLast = toMs(p.lastSeen ?? p.last_seen_at);
    const derivedFirst = eventTimes?.firstByWordId?.get(wordId) || 0;
    const derivedLast = eventTimes?.lastByWordId?.get(wordId) || 0;
    const reviewLevel = normalizedLevel(p.reviewLevel ?? p.attention ?? p.reviewAttention ?? p.level);
    const result = clean(p.lastResult ?? p.result).toLowerCase();
    const review = p.review === true || Boolean(reviewLevel) || result === 'review';
    const known = boolOrNull(p.known);
    const studied = p.studied === true || known === true || result === 'studied';
    return {
      ...clone(p),
      wordId,
      studied,
      known,
      review,
      reviewLevel,
      reviewReasons: normalizedReasons(p.reviewReasons ?? p.reasons),
      exposureCount: numeric(p.exposureCount ?? p.exposures),
      studyCount: numeric(p.studyCount),
      reviewCount: numeric(p.reviewCount),
      attempts: numeric(p.attempts ?? p.attemptCount),
      firstSeen: explicitFirst || derivedFirst,
      lastSeen: explicitLast || derivedLast,
      lastStudied: toMs(p.lastStudied ?? p.lastStudiedAt ?? p.last_studied_at),
      lastReviewed: toMs(p.lastReviewed ?? p.lastReviewedAt ?? p.last_reviewed_at ?? p.attentionUpdatedAt),
      lastPracticed: toMs(p.lastPracticed ?? p.lastPracticedAt ?? p.last_practiced_at),
      lastResult: clean(p.lastResult ?? p.result),
      lastAttentionUpdated: toMs(p.lastAttentionUpdated ?? p.lastAttentionUpdatedAt ?? p.attentionUpdatedAt)
    };
  }

  function buildProgressRecords(adapter) {
    const eventTimes = buildEventTimeIndex(adapter);
    const records = [];
    for (const row of adapter.list('learning_state')) {
      const key = clean(row?.entityKey);
      const wordId = key.startsWith('wid:') ? clean(key.slice(4)) : '';
      if (!wordId) throw new Error(`Storage facade blocked: invalid learning_state legacy identity ${key || '(empty)'}.`);
      records.push(pageStateFromPayload(row.payload, wordId, eventTimes));
    }
    records.sort((a, b) => a.wordId.localeCompare(b.wordId, undefined, { numeric: true }));
    return records;
  }

  function buildReviewRecords(progressRecords) {
    const rank = { high: 0, medium: 1, light: 2, '': 3 };
    return progressRecords.filter(row => row.review).map(clone).sort((a, b) =>
      (rank[a.reviewLevel] - rank[b.reviewLevel]) ||
      (numeric(b.lastAttentionUpdated) - numeric(a.lastAttentionUpdated)) ||
      (numeric(b.lastSeen) - numeric(a.lastSeen)) ||
      (numeric(b.reviewCount) - numeric(a.reviewCount)) ||
      a.wordId.localeCompare(b.wordId, undefined, { numeric: true })
    );
  }

  function buildStreamMaps(adapter) {
    const events = new Map();
    const sessions = new Map();
    for (const stream of Object.keys(EVENT_KEYS)) {
      const rows = sortStreamRecords(adapter.listEvents(stream), 'event', eventTimeMs);
      events.set(stream, rows.map(row => clone(row?.payload?.event)).filter(item => item && typeof item === 'object'));
    }
    for (const stream of Object.keys(SESSION_KEYS)) {
      const rows = sortStreamRecords(adapter.listSessions(stream), 'session', sessionTimeMs);
      sessions.set(stream, rows.map(row => clone(row?.payload?.session)).filter(item => item && typeof item === 'object'));
    }
    return { events, sessions };
  }

  function applyCanonicalStatePatchToPageRecord(baseRecord, patch, wordId) {
    const next = { ...clone(baseRecord || {}), wordId };
    const mapping = {
      known: 'known', review: 'review', review_level: 'reviewLevel', review_reasons: 'reviewReasons',
      exposure_count: 'exposureCount', study_count: 'studyCount', review_count: 'reviewCount', attempt_count: 'attempts',
      first_seen_at: 'firstSeen', last_seen_at: 'lastSeen', last_studied_at: 'lastStudied', last_reviewed_at: 'lastReviewed',
      last_practiced_at: 'lastPracticed', last_result: 'lastResult', last_attention_updated_at: 'lastAttentionUpdated',
      revision: 'revision', updated_at: 'updatedAt', studied: 'studied'
    };
    for (const [source, target] of Object.entries(mapping)) {
      if (!Object.prototype.hasOwnProperty.call(patch || {}, source)) continue;
      const value = patch[source];
      if (['first_seen_at','last_seen_at','last_studied_at','last_reviewed_at','last_practiced_at','last_attention_updated_at'].includes(source)) next[target] = toMs(value);
      else next[target] = clone(value);
    }
    return pageStateFromPayload(next, wordId, null);
  }

  function verifyMutationAuthority(mutation, adapter) {
    const base = mutation?.baseAuthority || {};
    if (String(base.candidateKey || '') !== String(adapter.meta?.candidateKey || '')) throw new Error(`Pending mutation ${mutation?.mutationId || '(unknown)'} targets a different Authority candidate.`);
    if (Number(base.headVersion || 0) !== Number(adapter.meta?.headVersion || 0)) throw new Error(`Pending mutation ${mutation?.mutationId || '(unknown)'} targets a different Authority Head version.`);
    if (String(base.snapshotManifestHash || '') !== String(adapter.meta?.snapshotManifestHash || '')) throw new Error(`Pending mutation ${mutation?.mutationId || '(unknown)'} targets a different Authority manifest.`);
  }

  function applyPendingOverlay(adapter, overlayContext, progressByWordId, streams) {
    const pending = overlayContext?.pending || [];
    const seenStateRows = new Set();
    const seenEventRows = new Set();
    const actionIds = new Set();
    let stateApplied = 0, eventApplied = 0;
    for (const mutation of pending) {
      verifyMutationAuthority(mutation, adapter);
      if (mutation?.actionId) actionIds.add(String(mutation.actionId));
      const kind = String(mutation?.mutationKind || '');
      const table = String(mutation?.tableName || '');
      const rowKey = String(mutation?.rowKey || '');
      if (!rowKey) throw new Error(`Pending mutation ${mutation?.mutationId || '(unknown)'} has no rowKey.`);
      if (kind === 'patch' && table === STATE_STORE) {
        if (seenStateRows.has(rowKey)) throw new Error(`Multiple pending learning_state patches for ${rowKey} are not supported yet; refusing ambiguous overlay.`);
        seenStateRows.add(rowKey);
        const wrapper = overlayContext.statesById.get(rowKey);
        const cardWrapper = overlayContext.cardsById.get(rowKey);
        if (!wrapper || !cardWrapper) throw new Error(`Pending learning_state patch ${mutation?.mutationId || '(unknown)'} cannot resolve its Canonical base/card.`);
        if (String(mutation?.precondition?.payloadHash || '') !== String(wrapper?.payloadHash || '')) throw new Error(`Pending learning_state patch ${mutation?.mutationId || '(unknown)'} base payload hash no longer matches Authority v2.`);
        for (const [field, expected] of Object.entries(mutation?.precondition?.fields || {})) {
          const actual = Object.prototype.hasOwnProperty.call(wrapper?.payload || {}, field) ? wrapper.payload[field] : null;
          if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`Pending learning_state patch ${mutation?.mutationId || '(unknown)'} conflict guard failed for ${field}.`);
        }
        const wordId = clean(cardWrapper?.payload?.word_id);
        const current = progressByWordId.get(wordId);
        if (!wordId || !current) throw new Error(`Pending learning_state patch ${mutation?.mutationId || '(unknown)'} cannot resolve page-facing WordID.`);
        progressByWordId.set(wordId, applyCanonicalStatePatchToPageRecord(current, mutation?.patch || {}, wordId));
        stateApplied += 1;
        continue;
      }
      if (kind === 'append' && table === EVENT_STORE) {
        if (seenEventRows.has(rowKey)) throw new Error(`Duplicate pending learning_event append ${rowKey}.`);
        seenEventRows.add(rowKey);
        if (mutation?.precondition?.rowMustBeAbsent !== true) throw new Error(`Pending learning_event append ${mutation?.mutationId || '(unknown)'} is missing rowMustBeAbsent guard.`);
        if (overlayContext.eventIds.has(rowKey)) throw new Error(`Pending learning_event append ${mutation?.mutationId || '(unknown)'} conflicts with an existing Canonical event.`);
        const canonicalEvent = mutation?.payload || {};
        if (String(canonicalEvent?.event_id || '') !== rowKey) throw new Error(`Pending learning_event append ${mutation?.mutationId || '(unknown)'} row identity mismatch.`);
        const stream = String(canonicalEvent?.source_stream || '');
        if (!streams.events.has(stream)) throw new Error(`Pending learning_event append ${mutation?.mutationId || '(unknown)'} uses unsupported stream ${stream || '(empty)'}.`);
        const legacyEvent = canonicalEvent?.payload;
        if (!legacyEvent || typeof legacyEvent !== 'object') throw new Error(`Pending learning_event append ${mutation?.mutationId || '(unknown)'} has no page-facing payload.`);
        streams.events.get(stream).push(clone(legacyEvent));
        streams.events.get(stream).sort((a, b) => eventTimeMs(a) - eventTimeMs(b) || stableStringify(a).localeCompare(stableStringify(b)));
        eventApplied += 1;
        continue;
      }
      throw new Error(`Pending mutation ${mutation?.mutationId || '(unknown)'} uses unsupported overlay operation ${table || '(table)'}/${kind || '(kind)'}.`);
    }
    return { pendingRows: pending.length, applied: stateApplied + eventApplied, stateApplied, eventApplied, actionIds: [...actionIds].sort() };
  }

  function buildStorageFacade(adapter, overlayContext) {
    if (!adapter?.readOnly) throw new Error('Storage facade safety stop: underlying Canonical Adapter is not read-only.');
    if (String(adapter.meta?.candidateKey || '') !== EXPECTED_CANDIDATE_KEY) throw new Error('Storage facade safety stop: mirror candidate is not ACTIVE Authority v2.');
    if (Number(adapter.meta?.headVersion || 0) !== EXPECTED_HEAD_VERSION) throw new Error('Storage facade safety stop: mirror Head version is not 2.');
    if (String(adapter.meta?.migrationVersion || '') !== EXPECTED_MIGRATION_VERSION) throw new Error('Storage facade safety stop: mirror migration version is not 3.');
    if (String(adapter.meta?.snapshotManifestHash || '') !== EXPECTED_MANIFEST) throw new Error('Storage facade safety stop: mirror manifest is not ACTIVE Authority v2.');

    const baseProgressRecords = buildProgressRecords(adapter);
    const progressByWordId = new Map(baseProgressRecords.map(row => [row.wordId, clone(row)]));
    const streams = buildStreamMaps(adapter);
    const overlay = applyPendingOverlay(adapter, overlayContext, progressByWordId, streams);
    const progressRecords = [...progressByWordId.values()].sort((a, b) => a.wordId.localeCompare(b.wordId, undefined, { numeric: true }));
    const explicitFirstSeenRows = progressRecords.filter(row => Number(row.firstSeen || 0) > 0).length;
    if (progressRecords.length !== EXPECTED_PROGRESS_ROWS || explicitFirstSeenRows !== EXPECTED_PROGRESS_ROWS) throw new Error(`Storage facade firstSeen coverage mismatch: expected ${EXPECTED_PROGRESS_ROWS}/${EXPECTED_PROGRESS_ROWS}, got ${explicitFirstSeenRows}/${progressRecords.length}.`);
    const reviewRecords = buildReviewRecords(progressRecords);
    const profile = clone(adapter.get('learner_profile', 'account')?.payload || {});
    const route = clone(adapter.get('learner_route_state', 'account')?.payload || {});
    const keys = [
      ...progressRecords.map(row => `${PROGRESS_PREFIX}${row.wordId}`),
      ...Object.values(EVENT_KEYS), ...Object.values(SESSION_KEYS), PROFILE_KEY, ROUTE_KEY
    ];
    const uniqueKeys = [...new Set(keys)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const rawValueForKey = key => {
      const storageKey = String(key || '');
      if (storageKey.startsWith(PROGRESS_PREFIX)) {
        const wordId = clean(storageKey.slice(PROGRESS_PREFIX.length));
        const row = progressByWordId.get(wordId);
        return row ? JSON.stringify(clone(row)) : null;
      }
      const eventStream = Object.entries(EVENT_KEYS).find(([, value]) => value === storageKey)?.[0];
      if (eventStream) return JSON.stringify(clone(streams.events.get(eventStream) || []));
      const sessionStream = Object.entries(SESSION_KEYS).find(([, value]) => value === storageKey)?.[0];
      if (sessionStream) return JSON.stringify(clone(streams.sessions.get(sessionStream) || []));
      if (storageKey === PROFILE_KEY) return JSON.stringify(clone(profile));
      if (storageKey === ROUTE_KEY) return JSON.stringify(clone(route));
      return null;
    };

    const api = {
      version: 1,
      readOnly: true,
      source: overlay.pendingRows ? 'wlp-cloud-v1+sync_outbox-overlay' : 'wlp-cloud-v1',
      projectionHash: adapter.projectionHash,
      explicitFirstSeenRows,
      pendingOutboxRows: overlay.pendingRows,
      overlayMutationsApplied: overlay.applied,
      overlayStateMutationsApplied: overlay.stateApplied,
      overlayEventMutationsApplied: overlay.eventApplied,
      overlayActionIds: clone(overlay.actionIds),
      meta: clone(adapter.meta),
      length: uniqueKeys.length,
      key: index => uniqueKeys[Number(index)] ?? null,
      keys: () => clone(uniqueKeys),
      getItem: key => rawValueForKey(key),
      readProgressRecords: () => clone(progressRecords),
      readProgressRecord: wordId => clone(progressByWordId.get(clean(wordId)) || {}),
      readReviewRecords: () => clone(reviewRecords),
      readPracticeEvents: () => clone(streams.events.get('practice') || []),
      readInteractionEvents: () => clone(streams.events.get('interaction') || []),
      readActivityEvents: () => clone(streams.events.get('activity') || []),
      readStudyQEvents: () => clone(streams.events.get('standard') || []),
      readStudyQSessions: () => clone(streams.sessions.get('standard') || []),
      readAIStudyEvents: () => clone(streams.events.get('ai') || []),
      readAISessions: () => clone(streams.sessions.get('ai') || []),
      readQuickReviewEvents: () => clone(streams.events.get('quick-review') || []),
      readAIRouteState: () => clone(route),
      readAILearnerProfile: () => clone(profile),
      getCardBundle: wordId => clone(adapter.getCardBundle(`wid:${clean(wordId)}`))
    };
    return Object.freeze(api);
  }

  function readLocalArray(key) {
    const value = safeParse(localStorage.getItem(key), []);
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    if (Array.isArray(value?.events)) return value.events.filter(item => item && typeof item === 'object');
    if (Array.isArray(value?.items)) return value.items.filter(item => item && typeof item === 'object');
    if (value?.records && typeof value.records === 'object') {
      return (Array.isArray(value.records) ? value.records : Object.values(value.records)).filter(item => item && typeof item === 'object');
    }
    return [];
  }

  async function payloadHashList(items) {
    const out = [];
    for (const item of items) out.push(await sha256(stableStringify(item)));
    return out;
  }
  function missingFromMultiset(localHashes, authorityHashes) {
    const counts = new Map();
    authorityHashes.forEach(hash => counts.set(hash, (counts.get(hash) || 0) + 1));
    let missing = 0;
    localHashes.forEach(hash => {
      const count = counts.get(hash) || 0;
      if (count > 0) counts.set(hash, count - 1); else missing += 1;
    });
    return missing;
  }

  async function auditCurrentDeviceCoverage(facade) {
    let missingEventPayloads = 0;
    let missingSessionPayloads = 0;
    const eventStreams = {};
    const eventReaders = {
      standard: facade.readStudyQEvents,
      ai: facade.readAIStudyEvents,
      activity: facade.readActivityEvents,
      interaction: facade.readInteractionEvents,
      practice: facade.readPracticeEvents,
      'quick-review': facade.readQuickReviewEvents
    };
    for (const [stream, key] of Object.entries(EVENT_KEYS)) {
      const local = readLocalArray(key);
      const canonical = eventReaders[stream]();
      const missing = missingFromMultiset(await payloadHashList(local), await payloadHashList(canonical));
      missingEventPayloads += missing;
      eventStreams[stream] = { legacy: local.length, facade: canonical.length, localPayloadsMissing: missing };
    }
    const sessionStreams = {};
    const sessionReaders = { standard: facade.readStudyQSessions, ai: facade.readAISessions };
    for (const [stream, key] of Object.entries(SESSION_KEYS)) {
      const local = readLocalArray(key);
      const canonical = sessionReaders[stream]();
      const missing = missingFromMultiset(await payloadHashList(local), await payloadHashList(canonical));
      missingSessionPayloads += missing;
      sessionStreams[stream] = { legacy: local.length, facade: canonical.length, localPayloadsMissing: missing };
    }
    return { eventStreams, sessionStreams, missingEventPayloads, missingSessionPayloads };
  }

  async function facadeFingerprint(facade) {
    return sha256(stableStringify({
      projectionHash: facade.projectionHash,
      progress: facade.readProgressRecords(),
      review: facade.readReviewRecords(),
      events: {
        standard: facade.readStudyQEvents(), ai: facade.readAIStudyEvents(), activity: facade.readActivityEvents(),
        interaction: facade.readInteractionEvents(), practice: facade.readPracticeEvents(), quickReview: facade.readQuickReviewEvents()
      },
      sessions: { standard: facade.readStudyQSessions(), ai: facade.readAISessions() },
      profile: facade.readAILearnerProfile(),
      route: facade.readAIRouteState()
    }));
  }

  async function openFacadeInternal() {
    const provider = window.WLPCanonicalCompatibilityAdapter;
    if (!provider?.open) throw new Error('Storage facade blocked: Canonical Compatibility Adapter is unavailable.');
    const adapter = await provider.open();
    const overlayContext = await readPendingOverlayContext(adapter);
    return buildStorageFacade(adapter, overlayContext);
  }

  async function runAudit() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Opening the read-only Storage Compatibility Facade and verifying its page-facing contract…');
    try {
      const first = await openFacadeInternal();
      const second = await openFacadeInternal();
      const blocking = [];
      const warnings = [];

      const firstHash = await facadeFingerprint(first);
      const secondHash = await facadeFingerprint(second);
      const openRepeatability = firstHash === secondHash;
      if (!openRepeatability) blocking.push('Storage facade repeated open produced a different page-facing snapshot hash.');

      const progress = first.readProgressRecords();
      const review = first.readReviewRecords();
      const unresolvedReviewCards = review.filter(row => {
        const bundle = first.getCardBundle(row.wordId);
        return !bundle?.card || !bundle?.content;
      }).map(row => row.wordId);
      if (unresolvedReviewCards.length) blocking.push(`${unresolvedReviewCards.length} Review row(s) cannot resolve card + content through the facade.`);

      let storageParityMismatches = 0;
      for (const row of progress) {
        const parsed = safeParse(first.getItem(`${PROGRESS_PREFIX}${row.wordId}`), null);
        if (stableStringify(parsed) !== stableStringify(first.readProgressRecord(row.wordId))) storageParityMismatches += 1;
      }
      const storageContracts = [
        [EVENT_KEYS.standard, first.readStudyQEvents], [EVENT_KEYS.ai, first.readAIStudyEvents],
        [EVENT_KEYS.activity, first.readActivityEvents], [EVENT_KEYS.interaction, first.readInteractionEvents],
        [EVENT_KEYS.practice, first.readPracticeEvents], [EVENT_KEYS['quick-review'], first.readQuickReviewEvents],
        [SESSION_KEYS.standard, first.readStudyQSessions], [SESSION_KEYS.ai, first.readAISessions],
        [PROFILE_KEY, first.readAILearnerProfile], [ROUTE_KEY, first.readAIRouteState]
      ];
      for (const [key, reader] of storageContracts) {
        if (stableStringify(safeParse(first.getItem(key), null)) !== stableStringify(reader())) storageParityMismatches += 1;
      }
      if (storageParityMismatches) blocking.push(`${storageParityMismatches} storage-like getItem contract mismatch(es) were found against typed facade readers.`);

      const beforeIsolation = await facadeFingerprint(first);
      const mutableProgress = first.readProgressRecords();
      if (mutableProgress[0]) { mutableProgress[0].wordId = '__mutated__'; mutableProgress[0].reviewReasons = ['__mutated__']; }
      const mutableEvents = first.readAIStudyEvents();
      if (mutableEvents[0]) mutableEvents[0].__mutated = true;
      const mutableProfile = first.readAILearnerProfile();
      mutableProfile.__mutated = true;
      const afterIsolation = await facadeFingerprint(first);
      const mutationIsolation = beforeIsolation === afterIsolation;
      if (!mutationIsolation) blocking.push('Storage facade returned a live mutable reference instead of an isolated clone.');

      const coverage = await auditCurrentDeviceCoverage(first);
      if (coverage.missingEventPayloads) blocking.push(`${coverage.missingEventPayloads} current-device event payload(s) are absent from the Storage Compatibility Facade.`);
      if (coverage.missingSessionPayloads) blocking.push(`${coverage.missingSessionPayloads} current-device session payload(s) are absent from the Storage Compatibility Facade.`);

      const writeMethodNames = ['setItem','removeItem','clear','write','save','set','delete','put','append','update'];
      const exposedWriteMethods = writeMethodNames.filter(name => typeof first[name] === 'function');
      if (exposedWriteMethods.length) blocking.push(`Read-only facade unexpectedly exposes write method(s): ${exposedWriteMethods.join(', ')}.`);
      if (!first.readOnly) blocking.push('Storage Compatibility Facade is not marked read-only.');
      if (first.explicitFirstSeenRows !== EXPECTED_PROGRESS_ROWS) blocking.push('Storage Compatibility Facade does not expose exact firstSeen for all 111 learning_state rows.');

      if (review.length !== 25) warnings.push(`Canonical Review membership currently resolves to ${review.length} row(s), not the previously observed 25.`);
      warnings.push('Progress uses the Canonical facade by default since v222; Review still uses legacy localStorage. Pending sync_outbox mutations are now overlaid read-only when their Authority and conflict guards match.');
      warnings.push('UI preferences, Local Overrides, Editor data, Review writes, Cloud transport, acknowledgement, and conflict resolution remain outside this facade.');

      const pass = blocking.length === 0;
      const report = {
        format: 'WLP_CANONICAL_STORAGE_COMPATIBILITY_FACADE_AUDIT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-page-storage-facade-contract-audit',
        device: { deviceKey: window.WLPCloudShadowSupabase?.getState?.().deviceKey || null, platform: platformLabel() },
        authority: {
          candidateKey: first.meta?.candidateKey || null,
          headVersion: first.meta?.headVersion ?? null,
          snapshotManifestHash: first.meta?.snapshotManifestHash || null,
          canonicalRows: first.meta?.canonicalRowCount ?? null,
          projectionHash: first.projectionHash
        },
        summary: {
          progressRecords: progress.length,
          reviewRecords: review.length,
          standardEvents: first.readStudyQEvents().length,
          standardSessions: first.readStudyQSessions().length,
          aiEvents: first.readAIStudyEvents().length,
          aiSessions: first.readAISessions().length,
          activityEvents: first.readActivityEvents().length,
          interactionEvents: first.readInteractionEvents().length,
          practiceEvents: first.readPracticeEvents().length,
          quickReviewEvents: first.readQuickReviewEvents().length,
          explicitFirstSeenRows: first.explicitFirstSeenRows,
          pendingOutboxRows: first.pendingOutboxRows,
          overlayMutationsApplied: first.overlayMutationsApplied,
          supportedStorageKeys: first.length,
          storageParityMismatches,
          unresolvedReviewCards: unresolvedReviewCards.length,
          currentDeviceEventPayloadsMissing: coverage.missingEventPayloads,
          currentDeviceSessionPayloadsMissing: coverage.missingSessionPayloads,
          openRepeatability,
          mutationIsolation,
          writeMethodsExposed: exposedWriteMethods.length,
          blockingIssues: blocking.length,
          pass
        },
        hashes: {
          facadeSnapshotHash: firstHash,
          repeatedFacadeSnapshotHash: secondHash,
          compatibilityProjectionHash: first.projectionHash,
          projectionContract: 'authority-v2-explicit-first-seen-at'
        },
        api: {
          version: first.version,
          readOnly: first.readOnly,
          source: first.source,
          methods: [
            'key','keys','getItem','readProgressRecords','readProgressRecord','readReviewRecords',
            'readPracticeEvents','readInteractionEvents','readActivityEvents','readStudyQEvents','readStudyQSessions',
            'readAIStudyEvents','readAISessions','readQuickReviewEvents','readAIRouteState','readAILearnerProfile','getCardBundle'
          ],
          writeMethodsExposed: exposedWriteMethods,
          valuesReturnedAsClones: mutationIsolation
        },
        historyStreams: { events: coverage.eventStreams, sessions: coverage.sessionStreams },
        issues: { blocking, warnings, unresolvedReviewCards },
        invariants: {
          canonicalAdapterReadOnly: true,
          facadeReadOnly: first.readOnly === true,
          noCloudCallsByFacade: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noLiveWlpWrites: true,
          progressDefaultReadCutoverCompatible: true,
          noReviewReadCutover: true,
          activeAuthorityV2MirrorRequired: String(first.meta?.snapshotManifestHash || '') === EXPECTED_MANIFEST,
          explicitFirstSeenComplete: first.explicitFirstSeenRows === EXPECTED_PROGRESS_ROWS,
          storageTypedReaderParity: storageParityMismatches === 0,
          currentDeviceHistoryCovered: coverage.missingEventPayloads === 0 && coverage.missingSessionPayloads === 0,
          reviewCardsResolve: unresolvedReviewCards.length === 0,
          mutationIsolationVerified: mutationIsolation,
          facadeOpenRepeatable: openRepeatability,
          noWriteMethodsExposed: exposedWriteMethods.length === 0
        }
      };
      state.report = report;
      render(report);
      setStatus(pass
        ? `Storage Compatibility Facade PASS. ${progress.length.toLocaleString()} Progress row(s), ${review.length.toLocaleString()} Review row(s), and ${first.overlayMutationsApplied} pending overlay mutation(s) are available through the deterministic read-only page contract.`
        : `Storage Compatibility Facade BLOCKED with ${blocking.length} issue(s). No live page or storage write occurred.`, pass ? 'ok' : 'bad');
    } catch (error) {
      state.report = null;
      renderError(error);
      setStatus(error?.message || String(error), 'bad');
    } finally {
      setBusy(false);
    }
  }

  function platformLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) return 'iPhone Safari/WebKit';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    return navigator.platform || 'Browser';
  }

  function render(report) {
    $('storage-compat-facade-panel').classList.remove('hidden');
    $('storage-compat-facade-result').textContent = report.summary.pass ? 'PASS' : 'BLOCKED';
    $('storage-compat-facade-progress').textContent = report.summary.progressRecords.toLocaleString();
    $('storage-compat-facade-review').textContent = report.summary.reviewRecords.toLocaleString();
    $('storage-compat-facade-events').textContent = (report.summary.standardEvents + report.summary.aiEvents + report.summary.activityEvents + report.summary.interactionEvents + report.summary.practiceEvents + report.summary.quickReviewEvents).toLocaleString();
    $('storage-compat-facade-sessions').textContent = (report.summary.standardSessions + report.summary.aiSessions).toLocaleString();
    $('storage-compat-facade-keys').textContent = report.summary.supportedStorageKeys.toLocaleString();
    $('storage-compat-facade-parity').textContent = report.summary.storageParityMismatches === 0 ? 'PASS' : 'FAIL';
    $('storage-compat-facade-isolation').textContent = report.summary.mutationIsolation ? 'PASS' : 'FAIL';
    $('storage-compat-facade-repeat').textContent = report.summary.openRepeatability ? 'PASS' : 'FAIL';
    $('storage-compat-facade-blocking').textContent = report.summary.blockingIssues.toLocaleString();
    $('storage-compat-facade-hash').textContent = report.hashes.facadeSnapshotHash || '—';

    const body = $('storage-compat-facade-stream-body');
    body.innerHTML = '';
    const addRow = (kind, stream, data) => {
      const tr = document.createElement('tr');
      [kind, stream, Number(data.legacy || 0).toLocaleString(), Number(data.facade || 0).toLocaleString(), Number(data.localPayloadsMissing || 0).toLocaleString()].forEach(value => {
        const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
      });
      body.appendChild(tr);
    };
    Object.entries(report.historyStreams.events || {}).forEach(([stream, data]) => addRow('Event', stream, data));
    Object.entries(report.historyStreams.sessions || {}).forEach(([stream, data]) => addRow('Session', stream, data));

    const notes = $('storage-compat-facade-notes');
    notes.innerHTML = '';
    [...report.issues.blocking, ...report.issues.warnings].forEach(message => {
      const li = document.createElement('li'); li.textContent = message; notes.appendChild(li);
    });
    $('export-storage-compat-facade').disabled = false;
  }

  function renderError(error) {
    $('storage-compat-facade-panel').classList.remove('hidden');
    $('storage-compat-facade-result').textContent = 'BLOCKED';
    $('storage-compat-facade-blocking').textContent = '1';
    const notes = $('storage-compat-facade-notes');
    notes.innerHTML = '';
    const li = document.createElement('li'); li.textContent = error?.message || String(error); notes.appendChild(li);
    $('export-storage-compat-facade').disabled = true;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-storage-compat-facade-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('storage-compat-facade-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) {
    state.busy = Boolean(value);
    $('run-storage-compat-facade').disabled = state.busy;
    $('export-storage-compat-facade').disabled = state.busy || !state.report;
  }

  function init() {
    window.WLPCanonicalStorageCompatibilityFacade = Object.freeze({
      version: 1,
      readOnly: true,
      open: openFacadeInternal
    });
    const run = $('run-storage-compat-facade');
    const exportButton = $('export-storage-compat-facade');
    if (run) run.addEventListener('click', runAudit);
    if (exportButton) exportButton.addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
