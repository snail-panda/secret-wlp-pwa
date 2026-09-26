/* WLP Stage 7 v1.8.6.144 — Manual Learning Sync engine (transport-independent). */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const FORMAT = 'WLP_LEARNING_SYNC';
  const SCHEMA_VERSION = 1;
  const FULL_BACKUP_FORMAT = 'WLP_LOCAL_DATA_BACKUP';
  const DEVICE_ID_KEY = 'wlp:device-id:v1';
  const ROLLBACK_KEY = 'wlp:learning-sync-rollback:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';

  const KEYS = Object.freeze({
    standardEvents: 'wlp:studyq-events:v1',
    standardSessions: 'wlp:studyq-sessions:v1',
    aiEvents: 'wlp:ai-study-events:v1',
    aiSessions: 'wlp:ai-study-session-history:v1',
    aiRouteState: 'wlp:ai-route-state:v1',
    aiLearnerProfile: 'wlp:ai-learner-profile:v1',
    activityEvents: 'wlp:stage7:activity-events:v1',
    interactionEvents: 'wlp:stage7:interaction-events:v1',
    practiceEvents: 'wlp:stage7:practice-events:v1'
  });

  const LIMITS = Object.freeze({
    standardEvents: 1200,
    standardSessions: 80,
    aiEvents: 2400,
    activityEvents: 5000,
    interactionEvents: 5000
  });

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const array = value => Array.isArray(value) ? value : [];

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value ?? '');
      return parsed == null ? clone(fallback) : parsed;
    } catch (_) {
      return clone(fallback);
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  const stableStringify = value => JSON.stringify(stableValue(value));

  function timestampValue(...values) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const parsed = Date.parse(String(value || ''));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function eventRevisionTimestamp(event) {
    return timestampValue(
      event?.ratingUpdatedAt,
      event?.updatedAt,
      event?.completedAt,
      event?.endedAt,
      event?.observedAt,
      event?.committedAt,
      event?.createdAt,
      event?.timestamp,
      event?.startedAt
    );
  }

  function standardOccurrenceTimestamp(event) {
    return timestampValue(event?.completedAt, event?.startedAt, event?.occurredAt, event?.createdAt, event?.timestamp, event?.updatedAt);
  }

  function aiOccurrenceTimestamp(event) {
    return timestampValue(event?.createdAt, event?.observedAt, event?.timestamp, event?.committedAt, event?.updatedAt);
  }

  function genericOccurrenceTimestamp(event) {
    return timestampValue(event?.timestamp, event?.createdAt, event?.completedAt, event?.startedAt, event?.updatedAt);
  }

  function sessionTimestamp(session) {
    return timestampValue(session?.completedAt, session?.endedAt, session?.updatedAt, session?.startedAt);
  }

  function makeDeviceId() {
    try {
      if (crypto?.randomUUID) return `device-${crypto.randomUUID()}`;
    } catch (_) {}
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function deviceId() {
    let id = clean(localStorage.getItem(DEVICE_ID_KEY));
    if (id) return id;
    id = makeDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  function readArrayKey(key) {
    const value = safeParse(localStorage.getItem(key), []);
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  function readProgressMap() {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PROGRESS_PREFIX)) continue;
      const record = safeParse(localStorage.getItem(key), null);
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const wordId = clean(record.wordId || key.slice(PROGRESS_PREFIX.length));
      if (!wordId) continue;
      out[wordId] = { ...record, wordId };
    }
    return out;
  }

  function currentData() {
    return {
      standardEvents: readArrayKey(KEYS.standardEvents),
      standardSessions: readArrayKey(KEYS.standardSessions),
      aiEvents: readArrayKey(KEYS.aiEvents),
      aiSessions: readArrayKey(KEYS.aiSessions),
      activityEvents: readArrayKey(KEYS.activityEvents),
      interactionEvents: readArrayKey(KEYS.interactionEvents),
      practiceEvents: readArrayKey(KEYS.practiceEvents),
      progress: readProgressMap()
    };
  }

  function countsOf(data) {
    const d = object(data);
    return {
      standardEvents: array(d.standardEvents).length,
      standardSessions: array(d.standardSessions).length,
      aiEvents: array(d.aiEvents).length,
      aiSessions: array(d.aiSessions).length,
      activityEvents: array(d.activityEvents).length,
      interactionEvents: array(d.interactionEvents).length,
      practiceEvents: array(d.practiceEvents).length,
      progressRecords: Object.keys(object(d.progress)).length
    };
  }

  function buildSnapshot() {
    const data = currentData();
    return {
      format: FORMAT,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceDeviceId: deviceId(),
      scope: [
        'standard-practice-history',
        'ai-practice-history',
        'card-activity',
        'review-progress-current-state'
      ],
      counts: countsOf(data),
      data
    };
  }

  function parseStorageArray(storage, key) {
    const raw = storage?.[key];
    if (typeof raw !== 'string') return [];
    const value = safeParse(raw, []);
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  function progressFromBackupStorage(storage) {
    const out = {};
    Object.entries(object(storage)).forEach(([key, raw]) => {
      if (!key.startsWith(PROGRESS_PREFIX) || typeof raw !== 'string') return;
      const record = safeParse(raw, null);
      if (!record || typeof record !== 'object' || Array.isArray(record)) return;
      const wordId = clean(record.wordId || key.slice(PROGRESS_PREFIX.length));
      if (wordId) out[wordId] = { ...record, wordId };
    });
    return out;
  }

  function normalizeData(data) {
    const d = object(data);
    return {
      standardEvents: array(d.standardEvents).filter(item => item && typeof item === 'object'),
      standardSessions: array(d.standardSessions).filter(item => item && typeof item === 'object'),
      aiEvents: array(d.aiEvents).filter(item => item && typeof item === 'object'),
      aiSessions: array(d.aiSessions).filter(item => item && typeof item === 'object'),
      activityEvents: array(d.activityEvents).filter(item => item && typeof item === 'object'),
      interactionEvents: array(d.interactionEvents).filter(item => item && typeof item === 'object'),
      practiceEvents: array(d.practiceEvents).filter(item => item && typeof item === 'object'),
      progress: Object.fromEntries(Object.entries(object(d.progress)).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)))
    };
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('This file does not contain valid WLP learning data.');
    }

    if (value.format === FORMAT) {
      if (Number(value.version) !== SCHEMA_VERSION) throw new Error(`Unsupported Learning Sync version: ${value.version ?? 'unknown'}.`);
      return {
        format: FORMAT,
        version: SCHEMA_VERSION,
        exportedAt: clean(value.exportedAt),
        sourceDeviceId: clean(value.sourceDeviceId),
        sourceFormat: FORMAT,
        data: normalizeData(value.data)
      };
    }

    if (value.format === FULL_BACKUP_FORMAT) {
      const storage = object(value.storage);
      return {
        format: FORMAT,
        version: SCHEMA_VERSION,
        exportedAt: clean(value.exportedAt),
        sourceDeviceId: '',
        sourceFormat: FULL_BACKUP_FORMAT,
        data: {
          standardEvents: parseStorageArray(storage, KEYS.standardEvents),
          standardSessions: parseStorageArray(storage, KEYS.standardSessions),
          aiEvents: parseStorageArray(storage, KEYS.aiEvents),
          aiSessions: parseStorageArray(storage, KEYS.aiSessions),
          activityEvents: parseStorageArray(storage, KEYS.activityEvents),
          interactionEvents: parseStorageArray(storage, KEYS.interactionEvents),
          practiceEvents: parseStorageArray(storage, KEYS.practiceEvents),
          progress: progressFromBackupStorage(storage)
        }
      };
    }

    throw new Error('Choose a WLP Learning Sync JSON or a WLP Full Local Backup JSON.');
  }

  function identityFor(item, idFields = []) {
    for (const field of idFields) {
      const value = clean(item?.[field]);
      if (value) return `${field}:${value}`;
    }
    return `legacy:${stableStringify(item)}`;
  }

  function mergeRecordArrays(localList, incomingList, options = {}) {
    const idFields = array(options.idFields);
    const occurrence = typeof options.occurrence === 'function' ? options.occurrence : genericOccurrenceTimestamp;
    const limit = Number(options.limit) || 0;
    const map = new Map();
    const stats = { added: 0, incomingNewer: 0, localNewer: 0, same: 0, conflicts: 0, truncated: 0 };

    array(localList).forEach((item, index) => {
      map.set(identityFor(item, idFields), { item: clone(item), source: 'local', index });
    });

    array(incomingList).forEach((incoming, index) => {
      const key = identityFor(incoming, idFields);
      const prior = map.get(key);
      if (!prior) {
        map.set(key, { item: clone(incoming), source: 'incoming', index: array(localList).length + index });
        stats.added += 1;
        return;
      }
      const a = stableStringify(prior.item);
      const b = stableStringify(incoming);
      if (a === b) {
        stats.same += 1;
        return;
      }
      const localTime = eventRevisionTimestamp(prior.item);
      const incomingTime = eventRevisionTimestamp(incoming);
      if (incomingTime > localTime) {
        map.set(key, { item: clone(incoming), source: 'incoming', index: prior.index });
        stats.incomingNewer += 1;
      } else if (localTime > incomingTime) {
        stats.localNewer += 1;
      } else {
        stats.conflicts += 1;
      }
    });

    let items = Array.from(map.values()).map(entry => entry.item);
    items.sort((a, b) => occurrence(a) - occurrence(b) || identityFor(a, idFields).localeCompare(identityFor(b, idFields)));
    if (limit > 0 && items.length > limit) {
      stats.truncated = items.length - limit;
      items = items.slice(-limit);
    }
    return { items, stats };
  }

  function overlayStandardAttempt(attempt, event) {
    if (!event) return clone(attempt || {});
    const next = { ...clone(attempt || {}) };
    [
      'eventId','wordId','batch','target','cardHeadword','promptKind','responseText','autoMatch',
      'matchedAlternative','matchedTarget','selfRating','communicativeNeedShown','hintShown',
      'hintCount','hintTypes','targetShown','elapsedMs'
    ].forEach(field => {
      if (Object.prototype.hasOwnProperty.call(event, field)) next[field] = clone(event[field]);
    });
    return next;
  }

  function sessionExperienceIdentity(experience) {
    const eventId = clean(experience?.attempt?.eventId);
    if (eventId) return `eventId:${eventId}`;
    return `legacy:${stableStringify(experience)}`;
  }

  function mergeStandardSessionPair(localSession, incomingSession, standardEventMap) {
    const localTime = sessionTimestamp(localSession);
    const incomingTime = sessionTimestamp(incomingSession);
    const newer = incomingTime > localTime ? incomingSession : localSession;
    const older = newer === incomingSession ? localSession : incomingSession;
    const base = { ...clone(older), ...clone(newer) };
    const experienceMap = new Map();
    [...array(localSession?.experiences), ...array(incomingSession?.experiences)].forEach(experience => {
      const key = sessionExperienceIdentity(experience);
      const prior = experienceMap.get(key);
      if (!prior) {
        experienceMap.set(key, clone(experience));
        return;
      }
      const eventId = clean(experience?.attempt?.eventId);
      const event = eventId ? standardEventMap.get(eventId) : null;
      if (event) {
        experienceMap.set(key, { ...prior, ...clone(experience), attempt: overlayStandardAttempt({ ...prior.attempt, ...experience.attempt }, event) });
      }
    });
    const experiences = Array.from(experienceMap.values()).map(experience => {
      const eventId = clean(experience?.attempt?.eventId);
      const event = eventId ? standardEventMap.get(eventId) : null;
      return event ? { ...experience, attempt: overlayStandardAttempt(experience.attempt, event) } : experience;
    });
    const counts = { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0, unrated: 0 };
    let hintCount = 0;
    let elapsedMs = 0;
    experiences.forEach(experience => {
      const attempt = object(experience?.attempt);
      const rating = clean(attempt.selfRating);
      if (Object.prototype.hasOwnProperty.call(counts, rating)) counts[rating] += 1;
      else counts.unrated += 1;
      hintCount += Number(attempt.hintCount || (attempt.hintShown ? 1 : 0)) || 0;
      elapsedMs += Number(attempt.elapsedMs) || 0;
    });
    return {
      ...base,
      experienceCount: experiences.length,
      plannedExperienceCount: Math.max(Number(localSession?.plannedExperienceCount) || 0, Number(incomingSession?.plannedExperienceCount) || 0, experiences.length),
      wordIds: Array.from(new Set(experiences.map(item => clean(item?.wordId || item?.attempt?.wordId)).filter(Boolean))),
      decks: Array.from(new Set(experiences.map(item => Number(item?.batch) || 0).filter(Boolean))),
      counts,
      hintCount,
      elapsedMs,
      experiences
    };
  }

  function mergeStandardSessions(localSessions, incomingSessions, mergedStandardEvents) {
    const eventMap = new Map(array(mergedStandardEvents).map(event => [clean(event?.eventId), event]).filter(([id]) => id));
    const localMap = new Map();
    array(localSessions).forEach(session => localMap.set(identityFor(session, ['sessionId']), clone(session)));
    const stats = { added: 0, merged: 0, same: 0, truncated: 0 };
    array(incomingSessions).forEach(session => {
      const key = identityFor(session, ['sessionId']);
      const prior = localMap.get(key);
      if (!prior) {
        localMap.set(key, clone(session));
        stats.added += 1;
        return;
      }
      if (stableStringify(prior) === stableStringify(session)) {
        stats.same += 1;
        return;
      }
      localMap.set(key, mergeStandardSessionPair(prior, session, eventMap));
      stats.merged += 1;
    });
    let items = Array.from(localMap.values());
    items = items.map(session => {
      const experiences = array(session.experiences).map(experience => {
        const eventId = clean(experience?.attempt?.eventId);
        const event = eventId ? eventMap.get(eventId) : null;
        return event ? { ...experience, attempt: overlayStandardAttempt(experience.attempt, event) } : experience;
      });
      if (!experiences.length) return session;
      const counts = { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0, unrated: 0 };
      let hintCount = 0, elapsedMs = 0;
      experiences.forEach(experience => {
        const attempt = object(experience?.attempt);
        const rating = clean(attempt.selfRating);
        if (Object.prototype.hasOwnProperty.call(counts, rating)) counts[rating] += 1;
        else counts.unrated += 1;
        hintCount += Number(attempt.hintCount || (attempt.hintShown ? 1 : 0)) || 0;
        elapsedMs += Number(attempt.elapsedMs) || 0;
      });
      return { ...session, counts, hintCount, elapsedMs, experiences };
    });
    items.sort((a, b) => sessionTimestamp(a) - sessionTimestamp(b) || identityFor(a, ['sessionId']).localeCompare(identityFor(b, ['sessionId'])));
    if (items.length > LIMITS.standardSessions) {
      stats.truncated = items.length - LIMITS.standardSessions;
      items = items.slice(-LIMITS.standardSessions);
    }
    return { items, stats };
  }

  function aiTurnIdentity(turn) {
    const eventId = clean(turn?.eventId);
    return eventId ? `eventId:${eventId}` : `legacy:${stableStringify(turn)}`;
  }

  function mergeAISessionPair(localSession, incomingSession) {
    const localTime = sessionTimestamp(localSession);
    const incomingTime = sessionTimestamp(incomingSession);
    const newer = incomingTime > localTime ? incomingSession : localSession;
    const older = newer === incomingSession ? localSession : incomingSession;
    const merged = { ...clone(older), ...clone(newer) };
    const turnMap = new Map();
    [...array(localSession?.turns), ...array(incomingSession?.turns)].forEach(turn => {
      const key = aiTurnIdentity(turn);
      const prior = turnMap.get(key);
      if (!prior || eventRevisionTimestamp(turn) > eventRevisionTimestamp(prior)) turnMap.set(key, clone(turn));
    });
    if (turnMap.size || Array.isArray(localSession?.turns) || Array.isArray(incomingSession?.turns)) {
      merged.turns = Array.from(turnMap.values()).sort((a, b) => eventRevisionTimestamp(a) - eventRevisionTimestamp(b) || aiTurnIdentity(a).localeCompare(aiTurnIdentity(b)));
      merged.completed = Math.max(Number(localSession?.completed) || 0, Number(incomingSession?.completed) || 0, merged.turns.length);
      merged.total = Math.max(Number(localSession?.total) || 0, Number(incomingSession?.total) || 0, merged.completed);
      if ('completedAll' in localSession || 'completedAll' in incomingSession || 'completedAll' in merged) {
        merged.completedAll = merged.total > 0 ? merged.completed >= merged.total : Boolean(merged.completedAll);
      }
    }
    return merged;
  }

  function mergeAISessions(localSessions, incomingSessions) {
    const map = new Map();
    const stats = { added: 0, merged: 0, same: 0 };
    array(localSessions).forEach(session => map.set(identityFor(session, ['sessionId']), clone(session)));
    array(incomingSessions).forEach(session => {
      const key = identityFor(session, ['sessionId']);
      const prior = map.get(key);
      if (!prior) {
        map.set(key, clone(session));
        stats.added += 1;
      } else if (stableStringify(prior) === stableStringify(session)) {
        stats.same += 1;
      } else {
        map.set(key, mergeAISessionPair(prior, session));
        stats.merged += 1;
      }
    });
    const items = Array.from(map.values()).sort((a, b) => sessionTimestamp(a) - sessionTimestamp(b) || identityFor(a, ['sessionId']).localeCompare(identityFor(b, ['sessionId'])));
    return { items, stats };
  }

  function positiveMin(...values) {
    const nums = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
    return nums.length ? Math.min(...nums) : 0;
  }

  function relevantStateTimeline(wordId, localRecord, incomingRecord, interactionEvents) {
    const timeline = [];
    const addPseudo = (record, source) => {
      const r = object(record);
      const lastReviewed = Number(r.lastReviewed) || 0;
      const lastStudied = Number(r.lastStudied) || 0;
      const lastAttentionUpdated = Number(r.lastAttentionUpdated) || 0;
      if (lastReviewed > 0 && (r.review === true || clean(r.lastResult) === 'review')) {
        timeline.push({ timestamp: lastReviewed, action: 'review', source: `progress-${source}`, pseudo: true });
      }
      if (lastStudied > 0 && (r.known === true || clean(r.lastResult) === 'studied')) {
        timeline.push({ timestamp: lastStudied, action: 'studied', source: `progress-${source}`, pseudo: true });
      }
      if (lastAttentionUpdated > 0 && (r.review === true || clean(r.reviewLevel) || array(r.reviewReasons).length)) {
        timeline.push({
          timestamp: lastAttentionUpdated,
          action: 'attention_set',
          source: `progress-${source}`,
          level: clean(r.reviewLevel).toLowerCase(),
          reasons: array(r.reviewReasons).map(value => clean(value).toLowerCase()).filter(Boolean),
          pseudo: true
        });
      }
    };
    addPseudo(localRecord, 'local');
    addPseudo(incomingRecord, 'incoming');
    const actions = new Set(['review', 'review_removed', 'studied', 'studied_removed', 'attention_set']);
    array(interactionEvents).forEach(event => {
      if (clean(event?.wordId) !== wordId || !actions.has(clean(event?.action))) return;
      timeline.push({
        timestamp: Number(event.timestamp) || timestampValue(event.timestamp),
        action: clean(event.action),
        source: clean(event.source),
        level: clean(event.level).toLowerCase(),
        reasons: array(event.reasons).map(value => clean(value).toLowerCase()).filter(Boolean),
        pseudo: false
      });
    });
    timeline.sort((a, b) => (a.timestamp - b.timestamp) || (Number(a.pseudo) - Number(b.pseudo)) || a.action.localeCompare(b.action));
    return timeline;
  }

  function countWordEvents(events, wordId, predicate) {
    let count = 0;
    array(events).forEach(event => {
      if (clean(event?.wordId) === wordId && predicate(event)) count += 1;
    });
    return count;
  }

  function mergeProgressRecord(wordId, localRecord, incomingRecord, mergedActivity, mergedInteractions) {
    const a = object(localRecord);
    const b = object(incomingRecord);
    const aAuthority = Math.max(Number(a.lastReviewed) || 0, Number(a.lastStudied) || 0, Number(a.lastAttentionUpdated) || 0);
    const bAuthority = Math.max(Number(b.lastReviewed) || 0, Number(b.lastStudied) || 0, Number(b.lastAttentionUpdated) || 0);
    const base = bAuthority > aAuthority ? { ...a, ...b } : { ...b, ...a };
    const out = { ...base, wordId };

    out.firstSeen = positiveMin(a.firstSeen, b.firstSeen) || Number(a.firstSeen || b.firstSeen || 0);
    out.lastSeen = Math.max(Number(a.lastSeen) || 0, Number(b.lastSeen) || 0);
    out.lastReviewed = Math.max(Number(a.lastReviewed) || 0, Number(b.lastReviewed) || 0);
    out.lastStudied = Math.max(Number(a.lastStudied) || 0, Number(b.lastStudied) || 0);
    out.lastAttentionUpdated = Math.max(Number(a.lastAttentionUpdated) || 0, Number(b.lastAttentionUpdated) || 0);

    const derivedExposure = countWordEvents(mergedActivity, wordId, event => clean(event?.type) === 'study' && clean(event?.action) === 'encounter');
    const derivedStudied = countWordEvents(mergedInteractions, wordId, event => clean(event?.action) === 'studied');
    const derivedReview = countWordEvents(mergedInteractions, wordId, event => clean(event?.action) === 'review');
    out.exposureCount = Math.max(Number(a.exposureCount) || 0, Number(b.exposureCount) || 0, derivedExposure);
    out.studyCount = Math.max(Number(a.studyCount) || 0, Number(b.studyCount) || 0, derivedStudied);
    out.reviewCount = Math.max(Number(a.reviewCount) || 0, Number(b.reviewCount) || 0, derivedReview);
    out.attempts = Math.max(Number(a.attempts) || 0, Number(b.attempts) || 0, out.studyCount + out.reviewCount);

    let known = aAuthority >= bAuthority ? Boolean(a.known) : Boolean(b.known);
    let review = aAuthority >= bAuthority ? Boolean(a.review) : Boolean(b.review);
    let lastResult = clean(aAuthority >= bAuthority ? a.lastResult : b.lastResult);
    let reviewLevel = clean((Number(a.lastAttentionUpdated) || 0) >= (Number(b.lastAttentionUpdated) || 0) ? a.reviewLevel : b.reviewLevel).toLowerCase();
    let reviewReasons = array((Number(a.lastAttentionUpdated) || 0) >= (Number(b.lastAttentionUpdated) || 0) ? a.reviewReasons : b.reviewReasons).map(value => clean(value).toLowerCase()).filter(Boolean);

    relevantStateTimeline(wordId, a, b, mergedInteractions).forEach(event => {
      const action = event.action;
      if (action === 'review') {
        known = false; review = true; lastResult = 'review';
        out.lastReviewed = Math.max(out.lastReviewed, event.timestamp || 0);
      } else if (action === 'review_removed') {
        known = false; review = false; lastResult = 'neutral'; reviewLevel = ''; reviewReasons = [];
      } else if (action === 'studied') {
        known = true; review = false; lastResult = 'studied'; reviewLevel = ''; reviewReasons = [];
        out.lastStudied = Math.max(out.lastStudied, event.timestamp || 0);
      } else if (action === 'studied_removed') {
        known = false; review = false; lastResult = 'neutral'; reviewLevel = ''; reviewReasons = [];
      } else if (action === 'attention_set') {
        known = false; review = true;
        reviewLevel = ['high','medium','light'].includes(event.level) ? event.level : '';
        reviewReasons = event.reasons;
        out.lastAttentionUpdated = Math.max(out.lastAttentionUpdated, event.timestamp || 0);
      }
    });

    out.known = known;
    out.review = review;
    out.lastResult = lastResult || (review ? 'review' : known ? 'studied' : clean(base.lastResult));
    out.reviewLevel = review ? reviewLevel : '';
    out.reviewReasons = review ? Array.from(new Set(reviewReasons)) : [];
    return out;
  }

  function mergeProgress(localProgress, incomingProgress, mergedActivity, mergedInteractions) {
    const a = object(localProgress);
    const b = object(incomingProgress);
    const ids = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter(Boolean);
    const progress = {};
    let added = 0, changed = 0, same = 0;
    ids.forEach(wordId => {
      const localRecord = a[wordId];
      const incomingRecord = b[wordId];
      if (localRecord && incomingRecord && stableStringify(localRecord) === stableStringify(incomingRecord)) {
        progress[wordId] = clone(localRecord);
        same += 1;
        return;
      }
      if (localRecord && !incomingRecord) {
        progress[wordId] = clone(localRecord);
        same += 1;
        return;
      }
      if (!localRecord && incomingRecord) {
        progress[wordId] = clone(incomingRecord);
        added += 1;
        return;
      }
      const merged = mergeProgressRecord(wordId, localRecord, incomingRecord, mergedActivity, mergedInteractions);
      progress[wordId] = merged;
      changed += 1;
    });
    return { progress, stats: { added, changed, same } };
  }

  function mergeData(localData, incomingData) {
    const local = normalizeData(localData);
    const incoming = normalizeData(incomingData);

    const standardEvents = mergeRecordArrays(local.standardEvents, incoming.standardEvents, {
      idFields: ['eventId'], occurrence: standardOccurrenceTimestamp, limit: LIMITS.standardEvents
    });
    const standardSessions = mergeStandardSessions(local.standardSessions, incoming.standardSessions, standardEvents.items);
    const aiEvents = mergeRecordArrays(local.aiEvents, incoming.aiEvents, {
      idFields: ['eventId'], occurrence: aiOccurrenceTimestamp, limit: LIMITS.aiEvents
    });
    const aiSessions = mergeAISessions(local.aiSessions, incoming.aiSessions);
    const activityEvents = mergeRecordArrays(local.activityEvents, incoming.activityEvents, {
      idFields: ['eventId'], occurrence: genericOccurrenceTimestamp, limit: LIMITS.activityEvents
    });
    const interactionEvents = mergeRecordArrays(local.interactionEvents, incoming.interactionEvents, {
      idFields: ['eventId'], occurrence: genericOccurrenceTimestamp, limit: LIMITS.interactionEvents
    });
    const practiceEvents = mergeRecordArrays(local.practiceEvents, incoming.practiceEvents, {
      idFields: ['eventId'], occurrence: genericOccurrenceTimestamp
    });
    const progress = mergeProgress(local.progress, incoming.progress, activityEvents.items, interactionEvents.items);

    return {
      data: {
        standardEvents: standardEvents.items,
        standardSessions: standardSessions.items,
        aiEvents: aiEvents.items,
        aiSessions: aiSessions.items,
        activityEvents: activityEvents.items,
        interactionEvents: interactionEvents.items,
        practiceEvents: practiceEvents.items,
        progress: progress.progress
      },
      stats: {
        standardEvents: standardEvents.stats,
        standardSessions: standardSessions.stats,
        aiEvents: aiEvents.stats,
        aiSessions: aiSessions.stats,
        activityEvents: activityEvents.stats,
        interactionEvents: interactionEvents.stats,
        practiceEvents: practiceEvents.stats,
        progress: progress.stats
      }
    };
  }

  function signatureOfData(data) {
    return stableStringify(normalizeData(data));
  }

  function totalConflicts(stats) {
    return ['standardEvents','aiEvents','activityEvents','interactionEvents','practiceEvents']
      .reduce((sum, key) => sum + (Number(stats?.[key]?.conflicts) || 0), 0);
  }

  function totalAdded(stats) {
    return (Number(stats?.standardEvents?.added) || 0) +
      (Number(stats?.standardSessions?.added) || 0) +
      (Number(stats?.aiEvents?.added) || 0) +
      (Number(stats?.aiSessions?.added) || 0) +
      (Number(stats?.activityEvents?.added) || 0) +
      (Number(stats?.interactionEvents?.added) || 0) +
      (Number(stats?.practiceEvents?.added) || 0) +
      (Number(stats?.progress?.added) || 0);
  }

  function totalUpdated(stats) {
    return (Number(stats?.standardEvents?.incomingNewer) || 0) +
      (Number(stats?.standardSessions?.merged) || 0) +
      (Number(stats?.aiEvents?.incomingNewer) || 0) +
      (Number(stats?.aiSessions?.merged) || 0) +
      (Number(stats?.progress?.changed) || 0);
  }

  function compareSnapshot(input) {
    const incoming = normalizeSnapshot(input);
    const local = currentData();
    const merged = mergeData(local, incoming.data);
    return {
      format: FORMAT,
      version: SCHEMA_VERSION,
      exportedAt: incoming.exportedAt,
      sourceDeviceId: incoming.sourceDeviceId,
      sourceFormat: incoming.sourceFormat,
      currentDeviceId: deviceId(),
      beforeCounts: countsOf(local),
      incomingCounts: countsOf(incoming.data),
      afterCounts: countsOf(merged.data),
      stats: merged.stats,
      totalAdded: totalAdded(merged.stats),
      totalUpdated: totalUpdated(merged.stats),
      totalConflicts: totalConflicts(merged.stats),
      changed: signatureOfData(local) !== signatureOfData(merged.data),
      baselineSignature: signatureOfData(local),
      mergedData: merged.data
    };
  }

  function rawLearningState() {
    const raw = { values: {}, progress: {} };
    Object.values(KEYS).forEach(key => { raw.values[key] = localStorage.getItem(key); });
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRESS_PREFIX)) raw.progress[key] = localStorage.getItem(key);
    }
    return raw;
  }

  function restoreRawLearningState(rawState) {
    const raw = object(rawState);
    Object.values(KEYS).forEach(key => {
      const value = object(raw.values)[key];
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    const progressKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRESS_PREFIX)) progressKeys.push(key);
    }
    progressKeys.forEach(key => localStorage.removeItem(key));
    Object.entries(object(raw.progress)).forEach(([key, value]) => {
      if (key.startsWith(PROGRESS_PREFIX) && typeof value === 'string') localStorage.setItem(key, value);
    });
  }

  function writeMergedData(data) {
    const d = normalizeData(data);
    localStorage.setItem(KEYS.standardEvents, JSON.stringify(d.standardEvents));
    localStorage.setItem(KEYS.standardSessions, JSON.stringify(d.standardSessions));
    localStorage.setItem(KEYS.aiEvents, JSON.stringify(d.aiEvents));
    localStorage.setItem(KEYS.aiSessions, JSON.stringify(d.aiSessions));
    localStorage.setItem(KEYS.activityEvents, JSON.stringify(d.activityEvents));
    localStorage.setItem(KEYS.interactionEvents, JSON.stringify(d.interactionEvents));
    localStorage.setItem(KEYS.practiceEvents, JSON.stringify(d.practiceEvents));

    const progressKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRESS_PREFIX)) progressKeys.push(key);
    }
    progressKeys.forEach(key => localStorage.removeItem(key));
    Object.entries(d.progress).forEach(([wordId, record]) => {
      localStorage.setItem(`${PROGRESS_PREFIX}${wordId}`, JSON.stringify({ ...record, wordId }));
    });
  }

  function rebuildAIDerivedState() {
    const api = window.WLPAIStudyData;
    if (!api || typeof api.rebuildDerivedState !== 'function') {
      throw new Error('AI Study data engine is not available. Learning Sync did not change local data.');
    }
    return api.rebuildDerivedState();
  }

  function applyMerge(plan) {
    if (!plan || plan.format !== FORMAT || Number(plan.version) !== SCHEMA_VERSION || !plan.mergedData) {
      throw new Error('Learning Sync preview is not valid. Choose the file again.');
    }
    if (signatureOfData(currentData()) !== plan.baselineSignature) {
      throw new Error('Learning data changed after the preview. Choose the Sync file again before merging.');
    }
    if (!plan.changed) return { changed: false, counts: countsOf(currentData()), stats: plan.stats };

    const beforeRaw = rawLearningState();
    const rollback = {
      savedAt: new Date().toISOString(),
      source: 'before-learning-sync',
      beforeRaw,
      afterSignature: ''
    };
    localStorage.setItem(ROLLBACK_KEY, JSON.stringify(rollback));

    try {
      writeMergedData(plan.mergedData);
      rebuildAIDerivedState();
      const afterSignature = signatureOfData(currentData());
      rollback.afterSignature = afterSignature;
      localStorage.setItem(ROLLBACK_KEY, JSON.stringify(rollback));
      return { changed: true, counts: countsOf(currentData()), stats: plan.stats, afterSignature };
    } catch (error) {
      try { restoreRawLearningState(beforeRaw); } catch (_) {}
      localStorage.removeItem(ROLLBACK_KEY);
      throw new Error(`Learning Sync could not be completed safely: ${error?.message || 'storage write failed'}`);
    }
  }

  function readRollback() {
    const value = safeParse(localStorage.getItem(ROLLBACK_KEY), null);
    return value && typeof value === 'object' && value.beforeRaw ? value : null;
  }

  function undoLastMerge() {
    const rollback = readRollback();
    if (!rollback) throw new Error('No Learning Sync rollback is available.');
    const currentSignature = signatureOfData(currentData());
    if (rollback.afterSignature && currentSignature !== rollback.afterSignature) {
      throw new Error('Learning data changed after that merge, so WLP will not roll it back over newer study activity.');
    }
    restoreRawLearningState(rollback.beforeRaw);
    localStorage.removeItem(ROLLBACK_KEY);
    return { restored: true, counts: countsOf(currentData()) };
  }

  function rollbackAvailable() {
    return Boolean(readRollback());
  }

  function runSelfTest() {
    const local = normalizeData({
      standardEvents: [
        { eventId:'std-1', startedAt:'2026-09-20T10:00:00Z', updatedAt:'2026-09-20T10:01:00Z', wordId:'1', selfRating:'almost' }
      ],
      standardSessions: [{ sessionId:'s1', startedAt:'2026-09-20T10:00:00Z', completedAt:'2026-09-20T10:02:00Z', experiences:[{ wordId:'1', attempt:{ eventId:'std-1', wordId:'1', selfRating:'almost' } }] }],
      aiEvents: [{ eventId:'ai-1', createdAt:'2026-09-20T11:00:00Z', updatedAt:'2026-09-20T11:00:00Z', wordId:'1' }],
      activityEvents: [{ timestamp:1000, type:'study', action:'encounter', wordId:'1' }],
      interactionEvents: [{ timestamp:2000, action:'review', wordId:'1' }, { timestamp:2100, action:'attention_set', wordId:'1', level:'high', reasons:['usage'] }],
      progress: { '1':{ wordId:'1', review:true, known:false, reviewLevel:'high', reviewReasons:['usage'], lastReviewed:2000, lastAttentionUpdated:2100, exposureCount:1, reviewCount:1, attempts:1 } }
    });
    const incoming = normalizeData({
      standardEvents: [
        { eventId:'std-1', startedAt:'2026-09-20T10:00:00Z', updatedAt:'2026-09-20T10:01:00Z', ratingUpdatedAt:'2026-09-21T10:00:00Z', wordId:'1', selfRating:'got-it' },
        { eventId:'std-2', startedAt:'2026-09-21T12:00:00Z', updatedAt:'2026-09-21T12:01:00Z', wordId:'2', selfRating:'not-yet' }
      ],
      standardSessions: [{ sessionId:'s1', startedAt:'2026-09-20T10:00:00Z', completedAt:'2026-09-20T10:02:00Z', experiences:[{ wordId:'1', attempt:{ eventId:'std-1', wordId:'1', selfRating:'almost' } }] }],
      aiEvents: [{ eventId:'ai-2', createdAt:'2026-09-21T11:00:00Z', updatedAt:'2026-09-21T11:00:00Z', wordId:'2' }],
      activityEvents: [{ timestamp:3000, type:'study', action:'encounter', wordId:'1' }],
      interactionEvents: [{ timestamp:4000, action:'attention_set', wordId:'1', level:'light', reasons:['context'] }],
      progress: { '1':{ wordId:'1', review:true, known:false, reviewLevel:'light', reviewReasons:['context'], lastReviewed:2000, lastAttentionUpdated:4000, exposureCount:2, reviewCount:1, attempts:1 } }
    });
    const merged = mergeData(local, incoming);
    const std1 = merged.data.standardEvents.find(event => event.eventId === 'std-1');
    const sessionAttempt = merged.data.standardSessions[0]?.experiences?.[0]?.attempt;
    const p1 = merged.data.progress['1'];
    const results = [
      ['standard union', merged.data.standardEvents.length === 2],
      ['newer rating revision wins', std1?.selfRating === 'got-it'],
      ['session rating follows merged event', sessionAttempt?.selfRating === 'got-it'],
      ['ai union', merged.data.aiEvents.length === 2],
      ['activity union', merged.data.activityEvents.length === 2],
      ['attention chronology wins', p1?.reviewLevel === 'light' && p1?.review === true],
      ['exposure union is not double-counted', p1?.exposureCount === 2]
    ].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
    return { passed: results.every(item => item.ok), passedCount: results.filter(item => item.ok).length, total: results.length, results };
  }

  window.WLPLearningSync = Object.freeze({
    version: VERSION,
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    keys: KEYS,
    rollbackKey: ROLLBACK_KEY,
    deviceId,
    buildSnapshot,
    normalizeSnapshot,
    compareSnapshot,
    applyMerge,
    undoLastMerge,
    rollbackAvailable,
    currentCounts: () => countsOf(currentData()),
    runSelfTest
  });
})();
