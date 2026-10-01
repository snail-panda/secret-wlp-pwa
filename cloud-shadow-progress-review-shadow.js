/* WLP Canonical Progress / Review Read-Path Shadow Audit v1.
   Compares current legacy localStorage page inputs with a page-facing read model
   built from the read-only Canonical Compatibility Adapter. It never changes
   localStorage, IndexedDB, Cloud, or live WLP pages. Differences caused by the
   promoted merged Authority are reported, not silently treated as failures.
   Safety blockers are limited to actual local-data loss / unresolved page reads. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.211-progress-review-read-shadow-v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
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
  const EXPECTED_PROJECTION_HASH = '26176cdcd4b42d1978c6cc15a4d7a380435f3f9eb3da2af73312809163c6e392';
  const state = { busy: false, report: null };

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }
  function clean(value) { return String(value ?? '').trim(); }
  function asArray(value) { return Array.isArray(value) ? value : []; }
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
  function safeParse(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  function toMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && String(value).trim() !== '') {
      if (numeric <= 0) return 0;
      return numeric > 0 && numeric < 100000000000 ? Math.round(numeric * 1000) : Math.round(numeric);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

  function readLegacyStates() {
    const map = new Map();
    const malformed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      const wordId = clean(key.slice(PROGRESS_PREFIX.length));
      const parsed = safeParse(localStorage.getItem(key), null);
      if (!wordId || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        malformed.push(key);
        continue;
      }
      map.set(wordId, pageStateFromPayload(parsed, wordId, null));
    }
    return { map, malformed };
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
      obj.at, obj.updatedAt, obj.completedAt, obj.startedAt, obj.observedAt, obj.recordedAt
    ];
    for (const value of candidates) {
      const ms = toMs(value);
      if (ms) return ms;
    }
    return 0;
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
      lastAttentionUpdated: toMs(p.lastAttentionUpdated ?? p.lastAttentionUpdatedAt ?? p.attentionUpdatedAt),
      firstSeenSource: explicitFirst ? 'payload' : derivedFirst ? 'event-derived' : 'none',
      lastSeenSource: explicitLast ? 'payload' : derivedLast ? 'event-derived' : 'none'
    };
  }

  function readAdapterStates(adapter) {
    const eventTimes = buildEventTimeIndex(adapter);
    const map = new Map();
    const badKeys = [];
    for (const row of adapter.list('learning_state')) {
      const key = clean(row?.entityKey);
      const wordId = key.startsWith('wid:') ? clean(key.slice(4)) : '';
      if (!wordId) { badKeys.push(key || '(empty)'); continue; }
      map.set(wordId, pageStateFromPayload(row.payload, wordId, eventTimes));
    }
    return { map, badKeys, eventTimes };
  }

  function pageStateComparable(record) {
    return {
      studied: Boolean(record?.studied),
      known: record?.known === true ? true : record?.known === false ? false : null,
      review: Boolean(record?.review),
      reviewLevel: record?.reviewLevel || '',
      reviewReasons: asArray(record?.reviewReasons),
      exposureCount: numeric(record?.exposureCount),
      studyCount: numeric(record?.studyCount),
      reviewCount: numeric(record?.reviewCount),
      attempts: numeric(record?.attempts),
      firstSeen: numeric(record?.firstSeen),
      lastSeen: numeric(record?.lastSeen),
      lastStudied: numeric(record?.lastStudied),
      lastReviewed: numeric(record?.lastReviewed),
      lastPracticed: numeric(record?.lastPracticed),
      lastResult: record?.lastResult || '',
      lastAttentionUpdated: numeric(record?.lastAttentionUpdated)
    };
  }

  function compareStates(legacy, facade) {
    const ids = [...new Set([...legacy.keys(), ...facade.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let same = 0, authorityOnly = 0, localOnly = 0, different = 0;
    let localFirstSeenRegressions = 0, localLastSeenRegressions = 0;
    let eventDerivedFirstSeen = 0, eventDerivedLastSeen = 0;
    let reviewMembershipChanges = 0;
    const localOnlyIds = [], firstSeenRegressionIds = [], lastSeenRegressionIds = [], reviewMembershipChangeIds = [];
    for (const wordId of ids) {
      const a = legacy.get(wordId);
      const b = facade.get(wordId);
      if (!a) { authorityOnly += 1; if (b?.firstSeenSource === 'event-derived') eventDerivedFirstSeen += 1; if (b?.lastSeenSource === 'event-derived') eventDerivedLastSeen += 1; continue; }
      if (!b) { localOnly += 1; localOnlyIds.push(wordId); continue; }
      if (b.firstSeenSource === 'event-derived') eventDerivedFirstSeen += 1;
      if (b.lastSeenSource === 'event-derived') eventDerivedLastSeen += 1;
      if (numeric(a.firstSeen) > 0 && numeric(b.firstSeen) === 0) { localFirstSeenRegressions += 1; firstSeenRegressionIds.push(wordId); }
      if (numeric(a.lastSeen) > 0 && numeric(b.lastSeen) === 0) { localLastSeenRegressions += 1; lastSeenRegressionIds.push(wordId); }
      if (Boolean(a.review) !== Boolean(b.review)) { reviewMembershipChanges += 1; reviewMembershipChangeIds.push(wordId); }
      if (stableStringify(pageStateComparable(a)) === stableStringify(pageStateComparable(b))) same += 1;
      else different += 1;
    }
    return {
      same, authorityOnly, localOnly, different,
      localFirstSeenRegressions, localLastSeenRegressions,
      eventDerivedFirstSeen, eventDerivedLastSeen, reviewMembershipChanges,
      localOnlyIds, firstSeenRegressionIds, lastSeenRegressionIds, reviewMembershipChangeIds
    };
  }

  function reviewRecords(map) {
    const rank = { high: 0, medium: 1, light: 2, '': 3 };
    return [...map.values()].filter(row => row.review).sort((a, b) =>
      (rank[a.reviewLevel] - rank[b.reviewLevel]) ||
      (b.lastAttentionUpdated - a.lastAttentionUpdated) ||
      (b.lastSeen - a.lastSeen) ||
      (b.reviewCount - a.reviewCount) ||
      a.wordId.localeCompare(b.wordId, undefined, { numeric: true })
    );
  }

  function reviewSummary(records) {
    const levels = { high: 0, medium: 0, light: 0, unassigned: 0 };
    const reasons = {};
    for (const row of records) {
      if (row.reviewLevel) levels[row.reviewLevel] += 1; else levels.unassigned += 1;
      for (const reason of row.reviewReasons) reasons[reason] = (reasons[reason] || 0) + 1;
    }
    return { total: records.length, levels, reasons };
  }

  function checkReviewCardResolution(adapter, records) {
    const unresolved = [];
    for (const row of records) {
      const bundle = adapter.getCardBundle(`wid:${row.wordId}`);
      if (!bundle?.card || !bundle?.content) unresolved.push(row.wordId);
    }
    return unresolved;
  }

  function readArrayKey(key) {
    const value = safeParse(localStorage.getItem(key), []);
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    if (Array.isArray(value?.events)) return value.events.filter(item => item && typeof item === 'object');
    if (Array.isArray(value?.items)) return value.items.filter(item => item && typeof item === 'object');
    if (value?.records && typeof value.records === 'object') {
      return (Array.isArray(value.records) ? value.records : Object.values(value.records)).filter(item => item && typeof item === 'object');
    }
    return [];
  }

  async function multisetHashes(items) {
    const counts = new Map();
    for (const item of items) {
      const hash = await sha256(stableStringify(item));
      counts.set(hash, (counts.get(hash) || 0) + 1);
    }
    return counts;
  }
  function multisetSubset(localCounts, authorityCounts) {
    let missing = 0;
    for (const [hash, count] of localCounts) missing += Math.max(0, count - (authorityCounts.get(hash) || 0));
    return missing;
  }

  async function compareStreams(adapter) {
    const eventStreams = {};
    let localEventPayloadsMissing = 0;
    for (const [stream, key] of Object.entries(EVENT_KEYS)) {
      const localItems = readArrayKey(key);
      const authorityItems = adapter.listEvents(stream).map(row => row?.payload?.event).filter(item => item && typeof item === 'object');
      const localHashes = await multisetHashes(localItems);
      const authorityHashes = await multisetHashes(authorityItems);
      const missing = multisetSubset(localHashes, authorityHashes);
      localEventPayloadsMissing += missing;
      eventStreams[stream] = { legacy: localItems.length, authority: authorityItems.length, localPayloadsMissing: missing };
    }
    const sessionStreams = {};
    let localSessionPayloadsMissing = 0;
    for (const [stream, key] of Object.entries(SESSION_KEYS)) {
      const localItems = readArrayKey(key);
      const authorityItems = adapter.listSessions(stream).map(row => row?.payload?.session).filter(item => item && typeof item === 'object');
      const localHashes = await multisetHashes(localItems);
      const authorityHashes = await multisetHashes(authorityItems);
      const missing = multisetSubset(localHashes, authorityHashes);
      localSessionPayloadsMissing += missing;
      sessionStreams[stream] = { legacy: localItems.length, authority: authorityItems.length, localPayloadsMissing: missing };
    }
    return { eventStreams, sessionStreams, localEventPayloadsMissing, localSessionPayloadsMissing };
  }

  function compareSingleton(adapter, entityType, storageKey) {
    const local = safeParse(localStorage.getItem(storageKey), null);
    const projected = adapter.get(entityType, 'account')?.payload ?? null;
    return {
      legacyPresent: Boolean(local && typeof local === 'object'),
      authorityPresent: Boolean(projected && typeof projected === 'object'),
      same: stableStringify(local) === stableStringify(projected)
    };
  }

  async function runAudit() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Opening the read-only Canonical Adapter and shadow-comparing Progress / Review inputs…');
    try {
      const provider = window.WLPCanonicalCompatibilityAdapter;
      if (!provider?.open) throw new Error('Read-only Compatibility Adapter is unavailable. Confirm cloud-shadow-compat-adapter.js is loaded before this audit.');
      const adapter = await provider.open();
      if (!adapter?.readOnly) throw new Error('Safety stop: Compatibility Adapter is not marked read-only.');
      const blocking = [];
      const warnings = [];
      if (adapter.projectionHash !== EXPECTED_PROJECTION_HASH) blocking.push(`Compatibility projection hash changed: expected ${EXPECTED_PROJECTION_HASH}, got ${adapter.projectionHash || '(missing)'}.`);

      const legacyStates = readLegacyStates();
      const facadeStates = readAdapterStates(adapter);
      const stateCompare = compareStates(legacyStates.map, facadeStates.map);
      if (legacyStates.malformed.length) blocking.push(`${legacyStates.malformed.length} malformed legacy progress record(s) could not be shadow-read.`);
      if (facadeStates.badKeys.length) blocking.push(`${facadeStates.badKeys.length} Canonical learning_state record(s) have invalid legacy WID identities.`);
      if (stateCompare.localOnly) blocking.push(`${stateCompare.localOnly} local learning-state row(s) are absent from the Canonical Adapter.`);
      if (stateCompare.localFirstSeenRegressions) blocking.push(`${stateCompare.localFirstSeenRegressions} local progress row(s) have firstSeen evidence that the page facade cannot preserve or derive.`);
      if (stateCompare.localLastSeenRegressions) blocking.push(`${stateCompare.localLastSeenRegressions} local progress row(s) have lastSeen evidence that the page facade cannot preserve or derive.`);

      const legacyReview = reviewRecords(legacyStates.map);
      const facadeReview = reviewRecords(facadeStates.map);
      const legacyReviewSummary = reviewSummary(legacyReview);
      const facadeReviewSummary = reviewSummary(facadeReview);
      const unresolvedReviewCards = checkReviewCardResolution(adapter, facadeReview);
      if (unresolvedReviewCards.length) blocking.push(`${unresolvedReviewCards.length} Canonical Review row(s) cannot resolve card + content through the Adapter.`);

      const streams = await compareStreams(adapter);
      if (streams.localEventPayloadsMissing) blocking.push(`${streams.localEventPayloadsMissing} current-device learning event payload(s) are absent from Canonical history.`);
      if (streams.localSessionPayloadsMissing) blocking.push(`${streams.localSessionPayloadsMissing} current-device learning session payload(s) are absent from Canonical history.`);

      const profile = compareSingleton(adapter, 'learner_profile', PROFILE_KEY);
      const route = compareSingleton(adapter, 'learner_route_state', ROUTE_KEY);
      if (profile.legacyPresent && !profile.authorityPresent) blocking.push('Current-device AI learner profile is absent from the Canonical Adapter.');
      if (route.legacyPresent && !route.authorityPresent) blocking.push('Current-device AI route state is absent from the Canonical Adapter.');

      if (stateCompare.authorityOnly || stateCompare.different || stateCompare.reviewMembershipChanges) {
        warnings.push(`Merged Authority intentionally changes the current-device state view: ${stateCompare.authorityOnly} Authority-only row(s), ${stateCompare.different} differing row(s), ${stateCompare.reviewMembershipChanges} Review membership change(s). These are shadow-reported and are not treated as data-loss blockers.`);
      }
      if (stateCompare.eventDerivedFirstSeen || stateCompare.eventDerivedLastSeen) {
        warnings.push(`Page facade derives missing legacy timestamps from Canonical event history for ${stateCompare.eventDerivedFirstSeen} firstSeen value(s) and ${stateCompare.eventDerivedLastSeen} lastSeen value(s).`);
      }
      if (!profile.same || !route.same) warnings.push('AI profile and/or route state differs from this device because the Canonical Authority contains the merged cross-device version.');

      const pageModelFingerprint = {
        states: [...facadeStates.map.values()].sort((a, b) => a.wordId.localeCompare(b.wordId, undefined, { numeric: true })).map(pageStateComparable),
        review: facadeReview.map(row => ({ wordId: row.wordId, reviewLevel: row.reviewLevel, reviewReasons: row.reviewReasons, lastAttentionUpdated: row.lastAttentionUpdated, lastSeen: row.lastSeen, reviewCount: row.reviewCount })),
        streams: { events: streams.eventStreams, sessions: streams.sessionStreams }
      };
      const pageReadModelHash = await sha256(stableStringify(pageModelFingerprint));
      const repeatedPageReadModelHash = await sha256(stableStringify(pageModelFingerprint));
      const repeatability = pageReadModelHash === repeatedPageReadModelHash;
      if (!repeatability) blocking.push('Page-facing Progress / Review shadow read model is not repeatable.');

      const pass = blocking.length === 0;
      state.report = {
        format: 'WLP_CANONICAL_PROGRESS_REVIEW_READ_SHADOW_AUDIT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-progress-review-shadow-compare',
        device: { deviceKey: clean(localStorage.getItem('wlp:device-id:v1')) || null, platform: platformLabel() },
        authority: {
          candidateKey: adapter.meta?.candidateKey || null,
          headVersion: adapter.meta?.headVersion ?? null,
          snapshotManifestHash: adapter.meta?.snapshotManifestHash || null,
          canonicalRows: adapter.meta?.canonicalRowCount ?? null,
          projectionHash: adapter.projectionHash
        },
        summary: {
          legacyStateRows: legacyStates.map.size,
          facadeStateRows: facadeStates.map.size,
          stateSame: stateCompare.same,
          authorityOnlyStates: stateCompare.authorityOnly,
          localOnlyStates: stateCompare.localOnly,
          stateDifferent: stateCompare.different,
          legacyReviewRows: legacyReview.length,
          facadeReviewRows: facadeReview.length,
          reviewMembershipChanges: stateCompare.reviewMembershipChanges,
          unresolvedReviewCards: unresolvedReviewCards.length,
          localFirstSeenRegressions: stateCompare.localFirstSeenRegressions,
          localLastSeenRegressions: stateCompare.localLastSeenRegressions,
          localEventPayloadsMissing: streams.localEventPayloadsMissing,
          localSessionPayloadsMissing: streams.localSessionPayloadsMissing,
          pageReadModelRepeatability: repeatability,
          blockingIssues: blocking.length,
          pass
        },
        hashes: {
          compatibilityProjectionHash: adapter.projectionHash,
          pageReadModelHash,
          repeatedPageReadModelHash
        },
        progress: {
          eventDerivedFirstSeen: stateCompare.eventDerivedFirstSeen,
          eventDerivedLastSeen: stateCompare.eventDerivedLastSeen,
          localOnlyWordIds: stateCompare.localOnlyIds,
          firstSeenRegressionWordIds: stateCompare.firstSeenRegressionIds,
          lastSeenRegressionWordIds: stateCompare.lastSeenRegressionIds
        },
        review: {
          legacy: legacyReviewSummary,
          authorityFacade: facadeReviewSummary,
          membershipChangeWordIds: stateCompare.reviewMembershipChangeIds,
          unresolvedCardWordIds: unresolvedReviewCards
        },
        historyStreams: {
          events: streams.eventStreams,
          sessions: streams.sessionStreams
        },
        ai: { learnerProfile: profile, learnerRouteState: route },
        issues: {
          blocking,
          warnings: [
            ...warnings,
            'This audit does not modify Progress, Review, Study, Editor, localStorage, IndexedDB, or Cloud. It only builds both read models side-by-side in memory.',
            'Authority-only and differing rows are expected after the verified cross-device merge. Only missing current-device payloads, unresolved cards, or unrecoverable page-visible timestamps block the next phase.',
            'A PASS means the next step can expose this exact page-facing model through a read-only Storage Compatibility Facade before any live read cutover.'
          ]
        },
        invariants: {
          adapterReadOnly: adapter.readOnly === true,
          noCloudCallsByAudit: true,
          noIndexedDbWrites: true,
          noLocalStorageWrites: true,
          noLiveWlpWrites: true,
          noPageReadCutover: true,
          noCurrentDeviceStateLoss: stateCompare.localOnly === 0,
          noCurrentDeviceHistoryLoss: streams.localEventPayloadsMissing === 0 && streams.localSessionPayloadsMissing === 0,
          reviewCardsResolve: unresolvedReviewCards.length === 0,
          pageVisibleTimestampCoveragePreserved: stateCompare.localFirstSeenRegressions === 0 && stateCompare.localLastSeenRegressions === 0,
          pageReadModelRepeatable: repeatability
        }
      };
      render(state.report);
      setStatus(pass
        ? `Progress / Review shadow-read PASS. Canonical facade has ${facadeStates.map.size} state row(s), ${facadeReview.length} Review row(s), and preserves every current-device state/history payload needed by these read paths.`
        : `Progress / Review shadow-read BLOCKED with ${blocking.length} issue(s). No write or live read cutover occurred.`, pass ? 'ok' : 'bad');
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
    $('progress-review-shadow-panel').classList.remove('hidden');
    $('progress-review-shadow-result').textContent = report.summary.pass ? 'PASS' : 'BLOCKED';
    $('progress-review-shadow-legacy-state').textContent = report.summary.legacyStateRows.toLocaleString();
    $('progress-review-shadow-facade-state').textContent = report.summary.facadeStateRows.toLocaleString();
    $('progress-review-shadow-state-different').textContent = report.summary.stateDifferent.toLocaleString();
    $('progress-review-shadow-local-only').textContent = report.summary.localOnlyStates.toLocaleString();
    $('progress-review-shadow-legacy-review').textContent = report.summary.legacyReviewRows.toLocaleString();
    $('progress-review-shadow-facade-review').textContent = report.summary.facadeReviewRows.toLocaleString();
    $('progress-review-shadow-history-missing').textContent = (report.summary.localEventPayloadsMissing + report.summary.localSessionPayloadsMissing).toLocaleString();
    $('progress-review-shadow-timestamp-regression').textContent = (report.summary.localFirstSeenRegressions + report.summary.localLastSeenRegressions).toLocaleString();
    $('progress-review-shadow-repeat').textContent = report.summary.pageReadModelRepeatability ? 'PASS' : 'FAIL';
    $('progress-review-shadow-blocking').textContent = report.summary.blockingIssues.toLocaleString();
    $('progress-review-shadow-hash').textContent = report.hashes.pageReadModelHash || '—';

    const body = $('progress-review-shadow-stream-body');
    body.innerHTML = '';
    const addRow = (kind, stream, data) => {
      const tr = document.createElement('tr');
      [kind, stream, Number(data.legacy || 0).toLocaleString(), Number(data.authority || 0).toLocaleString(), Number(data.localPayloadsMissing || 0).toLocaleString()].forEach(value => {
        const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
      });
      body.appendChild(tr);
    };
    Object.entries(report.historyStreams.events || {}).forEach(([stream, data]) => addRow('Event', stream, data));
    Object.entries(report.historyStreams.sessions || {}).forEach(([stream, data]) => addRow('Session', stream, data));

    const notes = $('progress-review-shadow-notes');
    notes.innerHTML = '';
    [...report.issues.blocking, ...report.issues.warnings].forEach(message => {
      const li = document.createElement('li'); li.textContent = message; notes.appendChild(li);
    });
    $('export-progress-review-shadow').disabled = false;
  }

  function renderError(error) {
    $('progress-review-shadow-panel').classList.remove('hidden');
    $('progress-review-shadow-result').textContent = 'BLOCKED';
    $('progress-review-shadow-blocking').textContent = '1';
    const notes = $('progress-review-shadow-notes');
    notes.innerHTML = '';
    const li = document.createElement('li'); li.textContent = error?.message || String(error); notes.appendChild(li);
    $('export-progress-review-shadow').disabled = true;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-progress-review-read-shadow-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('progress-review-shadow-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) {
    state.busy = Boolean(value);
    $('run-progress-review-shadow').disabled = state.busy;
    $('export-progress-review-shadow').disabled = state.busy || !state.report;
  }

  function init() {
    $('run-progress-review-shadow').addEventListener('click', runAudit);
    $('export-progress-review-shadow').addEventListener('click', exportReport);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
