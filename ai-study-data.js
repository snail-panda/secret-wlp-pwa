(() => {
  'use strict';

  const VERSION = '1.1.3';
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const LEARNING_META_KEY = 'wlp:learning-meta:v2';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';

  const AI_EVENT_KEY = 'wlp:ai-study-events:v1';
  const AI_ROUTE_KEY = 'wlp:ai-route-state:v1';
  const AI_PROFILE_KEY = 'wlp:ai-learner-profile:v1';

  const AI_EVENT_LIMIT = 2400;
  const ROUTE_EXEMPLAR_LIMIT = 5;
  const PROFILE_EXEMPLAR_LIMIT = 5;
  const RAW_TARGET_EVENT_LIMIT = 5;
  const RAW_STUDYQ_LIMIT = 3;
  const ANTI_ROTE_WINDOW = 10;

  const PROVENANCE = new Set([
    'learner-generated',
    'learner-confirmed',
    'wlp-source',
    'ai-suggested',
    'ai-inferred',
    'experiment-observed'
  ]);

  const ROUTER_ACTIONS = new Set([
    'DEEPEN', 'BRANCH', 'TRANSFER', 'CONTRAST', 'REVERSE', 'COMPOSE', 'PAUSE'
  ]);

  const clean = value => String(value ?? '').trim();
  const nowIso = () => new Date().toISOString();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeKey = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const array = value => Array.isArray(value) ? value : [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const uniqueStrings = values => Array.from(new Set(array(values).map(clean).filter(Boolean)));
  const uniqueNormalized = values => {
    const seen = new Set();
    const out = [];
    array(values).forEach(value => {
      const text = clean(value);
      const key = normalizeKey(text);
      if (!text || !key || seen.has(key)) return;
      seen.add(key);
      out.push(text);
    });
    return out;
  };
  const makeId = prefix => {
    try {
      if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    } catch (_) {}
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };
  const safeJsonParse = (value, fallback) => {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? clone(fallback) : parsed;
    } catch (_) {
      return clone(fallback);
    }
  };
  const readJson = (key, fallback) => safeJsonParse(localStorage.getItem(key) || '', fallback);
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const clampText = (value, max = 600) => {
    const text = clean(value);
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
  };
  const normalizeProvenance = value => PROVENANCE.has(clean(value)) ? clean(value) : 'ai-inferred';
  const normalizeRouterAction = value => {
    const action = clean(value).toUpperCase();
    return ROUTER_ACTIONS.has(action) ? action : '';
  };
  const normalizeConfidence = value => {
    const v = clean(value).toLowerCase();
    return ['high', 'medium', 'low'].includes(v) ? v : 'medium';
  };
  const normalizeTargetVisibility = value => {
    const v = clean(value).toLowerCase();
    if (['hidden', 'visible', 'partial'].includes(v)) return v;
    if (value === true) return 'visible';
    if (value === false) return 'hidden';
    return 'hidden';
  };

  function parseTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i], next = source[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i++; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(field);
        if (row.some(value => clean(value))) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(value => clean(value))) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(clean);
    return table.slice(1).map(cols => Object.fromEntries(headers.map((header, index) => [header, clean(cols[index])] )));
  }

  let masterRowsPromise = null;

  function readOverrides() {
    const value = readJson(LOCAL_OVERRIDES_KEY, {});
    return object(value);
  }

  function applyOverrides(masterRows) {
    const overrides = readOverrides();
    return masterRows.map(row => {
      const wordId = clean(row.WordID);
      const edit = object(overrides[wordId]);
      return Object.keys(edit).length
        ? { ...row, ...edit, WordID: row.WordID, 'Batch #': row['Batch #'] }
        : { ...row };
    });
  }

  async function getMasterRows(options = {}) {
    if (options.refresh === true) masterRowsPromise = null;
    if (!masterRowsPromise) {
      masterRowsPromise = fetch(MASTER_URL, { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`Master TSV ${response.status}`);
          return response.text();
        })
        .then(text => applyOverrides(parseTSV(text)))
        .catch(error => {
          masterRowsPromise = null;
          throw error;
        });
    }
    return clone(await masterRowsPromise);
  }

  function learningMetadataFor(wordId) {
    const id = clean(wordId);
    const api = window.WLPLearningHooks;
    if (api && typeof api.getForMaster === 'function') {
      try {
        const meta = api.getForMaster(id);
        if (meta && typeof meta === 'object') return clone(meta);
      } catch (_) {}
    }

    const root = readJson(LEARNING_META_KEY, {});
    const records = object(root.records || root);
    return clone(records[`wid:${id}`] || records[id] || null);
  }

  function readProgressRecord(wordId) {
    const id = clean(wordId);
    if (!id) return null;
    const record = readJson(`${PROGRESS_PREFIX}${id}`, null);
    return record && typeof record === 'object' ? record : null;
  }

  function readAIEvents() {
    const events = readJson(AI_EVENT_KEY, []);
    return Array.isArray(events) ? events : [];
  }

  function readRouteState() {
    const root = readJson(AI_ROUTE_KEY, null);
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return { schemaVersion: 1, updatedAt: '', records: {} };
    }
    return {
      schemaVersion: 1,
      updatedAt: clean(root.updatedAt),
      records: object(root.records)
    };
  }

  function readLearnerProfile() {
    const root = readJson(AI_PROFILE_KEY, null);
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return {
        schemaVersion: 1,
        updatedAt: '',
        productionTendencies: [],
        reusableConstructions: [],
        styleTendencies: []
      };
    }
    return {
      schemaVersion: 1,
      updatedAt: clean(root.updatedAt),
      productionTendencies: array(root.productionTendencies),
      reusableConstructions: array(root.reusableConstructions),
      styleTendencies: array(root.styleTendencies)
    };
  }

  function readStudyQEvents() {
    const events = readJson(STUDYQ_EVENT_KEY, []);
    return Array.isArray(events) ? events : [];
  }

  function readStudyQSessions() {
    const sessions = readJson(STUDYQ_SESSION_KEY, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  function resolveTarget(row) {
    const raw = clean(row?.Word || row?.headword || row?.target);
    const pos = clean(row?.['Part of Speech'] || row?.pos);
    const labelMatch = raw.match(/^(.+?)\s*:\s*(synonyms?(?:\s*(?:and|&|\/)\s*near[- ]synonyms?)?|near[- ]synonyms?|usage(?:\s+notes?)?|contrast(?:s)?|related expressions?)$/i);
    const base = clean(labelMatch ? labelMatch[1] : raw);
    let kind = labelMatch ? 'labeled' : 'simple';
    let parts = [base];
    if (/\s+(?:vs\.?|versus)\s+/i.test(base)) {
      parts = base.split(/\s+(?:vs\.?|versus)\s+/i).map(clean).filter(Boolean);
      kind = 'contrast';
    } else if (/\s+\/\s+/.test(base)) {
      parts = base.split(/\s+\/\s+/).map(clean).filter(Boolean);
      kind = 'family';
    }

    const family = [];
    parts.forEach(part => {
      const withoutParen = clean(part.replace(/\s*\([^)]*\)\s*/g, ' '));
      if (!withoutParen) return;
      family.push(withoutParen);
      const fixed = clean(withoutParen.replace(/\b(?:do\s+something|doing\s+something|something|someone|somebody|somewhere|oneself|one['’]s|someone['’]s|somebody['’]s|sth\.?|sb\.?)\b.*$/i, ''));
      if (fixed && fixed !== withoutParen) family.push(fixed);
    });

    return {
      raw,
      target: family[0] || base || raw,
      targetFamily: uniqueNormalized(family.length ? family : [raw]),
      targetKind: kind,
      pos
    };
  }

  function authoritativeResponse(event) {
    const response = object(event?.learnerResponse);
    return clean(response.correctedTranscript || response.authoritativeResponse || response.rawTranscript || response.text || event?.responseText);
  }

  function normalizeEvent(input) {
    const event = object(input);
    const target = object(event.target);
    const learnerResponse = object(event.learnerResponse);
    const corrected = clean(learnerResponse.correctedTranscript);
    const raw = clean(learnerResponse.rawTranscript || learnerResponse.text || event.responseText);
    const wordId = clean(event.wordId || target.wordId);
    const createdAt = clean(event.createdAt || event.timestamp) || nowIso();
    return {
      schemaVersion: 1,
      eventId: clean(event.eventId) || makeId('aievent'),
      createdAt,
      updatedAt: clean(event.updatedAt) || createdAt,
      sessionId: clean(event.sessionId),
      wordId,
      target: {
        wordId,
        headword: clean(target.headword || event.headword || event.targetText || event.target),
        targetFamily: uniqueNormalized(target.targetFamily),
        partOfSpeech: clean(target.partOfSpeech || target.pos),
        targetKind: clean(target.targetKind)
      },
      experience: {
        direction: clean(event.experience?.direction || event.learningOpportunity?.direction),
        type: clean(event.experience?.type),
        domain: clean(event.experience?.domain),
        targetVisibility: normalizeTargetVisibility(event.experience?.targetVisibility ?? event.experience?.targetVisible),
        targetVisible: normalizeTargetVisibility(event.experience?.targetVisibility ?? event.experience?.targetVisible) === 'visible',
        prompt: clampText(event.experience?.prompt, 1200),
        responseMode: clean(event.experience?.responseMode),
        responseConstraint: clean(event.experience?.responseConstraint),
        responseFrame: clampText(event.experience?.responseFrame, 1200),
        acceptableSemanticTerritory: uniqueStrings(event.experience?.acceptableSemanticTerritory),
        anticipatedNaturalAlternatives: uniqueStrings(event.experience?.anticipatedNaturalAlternatives),
        frameCompatibleAlternatives: uniqueStrings(event.experience?.frameCompatibleAlternatives),
        frameCompatibilityVerified: Boolean(event.experience?.frameCompatibilityVerified),
        experienceGrounding: clone(event.experience?.experienceGrounding || event.experienceGrounding || null),
        messageCore: clone(event.experience?.messageCore || event.messageCore || null),
        communicativeFocus: clone(event.experience?.communicativeFocus || event.communicativeFocus || null),
        construal: clone(event.experience?.construal || event.communicativeFocus?.construal || null),
        usageMotivation: clone(event.experience?.usageMotivation || event.usageMotivation || null)
      },
      learnerResponse: {
        rawTranscript: raw,
        correctedTranscript: corrected,
        authoritativeResponse: corrected || raw,
        inputMode: clean(learnerResponse.inputMode || 'text'),
        sttCorrectedByLearner: Boolean(corrected || learnerResponse.sttCorrectedByLearner)
      },
      interpretationStatus: clean(event.interpretationStatus || 'pending'),
      interpreterResult: event.interpreterResult ? clone(event.interpreterResult) : null,
      metadata: clone(object(event.metadata))
    };
  }

  function eventImportance(event) {
    let score = 0;
    const result = object(event.interpreterResult);
    const interpretation = object(result.responseInterpretation || result.observation || result.interpretation);
    const routePatch = routePatchFrom(result);
    const profilePatch = profilePatchFrom(result);
    const response = object(event.learnerResponse);

    if (!event.interpreterResult || event.interpretationStatus === 'pending') score += 90;
    if (response.sttCorrectedByLearner) score += 100;
    if (interpretation.targetProduced === true && interpretation.spontaneous === true) score += 95;
    if (interpretation.evidenceType === 'spontaneous-production') score += 95;
    if (interpretation.evidenceType === 'reverse-reconstruction') score += 90;
    if (interpretation.evidenceType === 'context-transfer' || interpretation.evidenceType === 'sense-transfer') score += 88;
    if (interpretation.naturalAlternative === true) score += 75;
    if (interpretation.formIssue) score += 72;
    if (array(routePatch.addPersonalAnchors).length) score += 100;
    if (array(routePatch.addNeighbors).length) score += 82;
    if (array(routePatch.addFailedRoutes).length) score += 86;
    if (array(routePatch.diagnosticExemplarCandidates).length || object(result.diagnosticExemplarCandidate).retain === true) score += 80;
    if (array(object(result.evidence).evidenceTypes).some(type => ['spontaneous-production', 'reverse-reconstruction', 'context-transfer', 'sense-transfer', 'free-composition'].includes(clean(type)))) score += 90;
    if (array(profilePatch.candidateTendencies).length) score += 78;
    if (array(profilePatch.constructionEvidence).length) score += 70;
    if (array(profilePatch.styleTendencies).length) score += 70;
    if (interpretation.targetProduced === true) score += 25;
    return score;
  }

  function compactEventLog(events) {
    if (events.length <= AI_EVENT_LIMIT) return events;
    const latestKeep = Math.min(700, Math.floor(AI_EVENT_LIMIT * 0.35));
    const latest = events.slice(-latestKeep);
    const latestIds = new Set(latest.map(event => event.eventId));
    const older = events.slice(0, Math.max(0, events.length - latestKeep));
    const scored = older
      .map((event, index) => ({ event, index, score: eventImportance(event) }))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, Math.max(0, AI_EVENT_LIMIT - latest.length))
      .sort((a, b) => a.index - b.index)
      .map(item => item.event);
    return [...scored, ...latest.filter(event => !latestIds.has('__never__'))];
  }

  function saveAIStudyEvent(input) {
    const event = normalizeEvent(input);
    if (!event.wordId) throw new Error('AI Study event requires wordId');
    const events = readAIEvents();
    const existingIndex = events.findIndex(item => clean(item.eventId) === event.eventId);
    if (existingIndex >= 0) events[existingIndex] = event;
    else events.push(event);
    writeJson(AI_EVENT_KEY, compactEventLog(events));
    return clone(event);
  }

  function findEvent(eventId) {
    const id = clean(eventId);
    return readAIEvents().find(event => clean(event.eventId) === id) || null;
  }

  function applyUserCorrection(eventId, correctedTranscript) {
    const id = clean(eventId);
    const corrected = clean(correctedTranscript);
    if (!id || !corrected) throw new Error('eventId and correctedTranscript are required');
    const events = readAIEvents();
    const index = events.findIndex(event => clean(event.eventId) === id);
    if (index < 0) throw new Error(`AI Study event not found: ${id}`);
    const event = normalizeEvent(events[index]);
    event.learnerResponse.correctedTranscript = corrected;
    event.learnerResponse.authoritativeResponse = corrected;
    event.learnerResponse.sttCorrectedByLearner = true;
    event.interpretationStatus = 'stale-after-correction';
    event.interpreterResult = null;
    event.updatedAt = nowIso();
    events[index] = event;
    writeJson(AI_EVENT_KEY, events);
    rebuildDerivedState();
    return clone(event);
  }

  function normalizeExemplar(candidate, event, fallbackType = 'diagnostic') {
    const payload = object(candidate);
    const response = authoritativeResponse(event);
    return {
      exemplarId: clean(payload.exemplarId) || makeId('ex'),
      eventId: clean(event.eventId),
      type: clean(payload.type || fallbackType),
      learnerResponse: clampText(payload.learnerResponse || response, 500),
      contextSummary: clampText(payload.contextSummary || event.experience?.prompt || event.experience?.domain, 500),
      whyImportant: clampText(payload.whyImportant || payload.reason, 500),
      source: normalizeProvenance(payload.source || 'experiment-observed'),
      observedAt: clean(payload.observedAt || event.createdAt)
    };
  }

  const exemplarScore = exemplar => {
    const type = normalizeKey(exemplar?.type);
    if (type.includes('personal-anchor')) return 100;
    if (type.includes('spontaneous')) return 96;
    if (type.includes('reverse')) return 92;
    if (type.includes('sense-transfer') || type.includes('context-transfer')) return 90;
    if (type.includes('failed') || type.includes('naturalness')) return 88;
    if (type.includes('stt')) return 86;
    if (type.includes('neighbor')) return 82;
    if (type.includes('form') || type.includes('valency') || type.includes('pos')) return 78;
    if (type.includes('exact')) return 25;
    return 60;
  };

  function mergeExemplars(existing, incoming, limit) {
    const map = new Map();
    [...array(existing), ...array(incoming)].forEach(item => {
      const ex = object(item);
      const key = [normalizeKey(ex.type), normalizeKey(ex.learnerResponse), normalizeKey(ex.contextSummary)].join('|');
      if (!key.replaceAll('|', '')) return;
      const prev = map.get(key);
      if (!prev || exemplarScore(ex) >= exemplarScore(prev)) map.set(key, ex);
    });
    return Array.from(map.values())
      .sort((a, b) => exemplarScore(b) - exemplarScore(a) || clean(b.observedAt).localeCompare(clean(a.observedAt)))
      .slice(0, limit);
  }

  function blankRouteRecord(event) {
    return {
      wordId: clean(event.wordId),
      target: clean(event.target?.headword),
      targetFamily: uniqueNormalized(event.target?.targetFamily),
      personalAnchors: [],
      learnerGeneratedNeighbors: [],
      connections: [],
      weakOrFailedRoutes: [],
      domains: [],
      diagnosticExemplars: [],
      nextRouteHints: [],
      updatedAt: clean(event.updatedAt || event.createdAt)
    };
  }

  function mergePersonalAnchor(record, incoming, event) {
    const item = object(incoming);
    const value = clean(item.value || item.anchor);
    if (!value) return;
    const key = `${normalizeKey(item.type || 'personal-experience')}|${normalizeKey(value)}`;
    const found = record.personalAnchors.find(anchor => `${normalizeKey(anchor.type)}|${normalizeKey(anchor.value)}` === key);
    if (found) {
      found.lastUsefulAt = clean(item.lastUsefulAt || event.createdAt || found.lastUsefulAt);
      found.useCount = Number(found.useCount || 0) + Number(item.useCount || 1);
      found.helpfulCount = Number(found.helpfulCount || 0) + Number(item.helpfulCount || 0);
      if (normalizeConfidence(item.confidence) === 'high') found.confidence = 'high';
      found.persistent = found.persistent !== false;
      return;
    }
    record.personalAnchors.push({
      anchorId: clean(item.anchorId) || makeId('anchor'),
      type: clean(item.type || 'personal-experience'),
      value,
      source: normalizeProvenance(item.source || 'learner-generated'),
      confidence: normalizeConfidence(item.confidence || 'high'),
      persistent: item.persistent !== false,
      firstObservedAt: clean(item.firstObservedAt || event.createdAt),
      lastUsefulAt: clean(item.lastUsefulAt || event.createdAt),
      useCount: Number(item.useCount || 1),
      helpfulCount: Number(item.helpfulCount || 0)
    });
  }

  function mergeNeighbor(record, incoming, event) {
    const item = object(incoming);
    const expression = clean(item.expression);
    if (!expression) return;
    const key = normalizeKey(expression);
    const found = record.learnerGeneratedNeighbors.find(neighbor => normalizeKey(neighbor.expression) === key);
    const contexts = uniqueStrings([...(array(item.contexts)), clean(item.context || event.experience?.domain)].filter(Boolean));
    if (found) {
      found.lastObservedAt = clean(item.lastObservedAt || event.createdAt || found.lastObservedAt);
      found.observationCount = Number(found.observationCount || 0) + Number(item.observationCount || 1);
      found.contexts = uniqueStrings([...(array(found.contexts)), ...contexts]);
      if (item.relationship) found.relationship = clean(item.relationship);
      if (item.source) found.source = normalizeProvenance(item.source);
      return;
    }
    record.learnerGeneratedNeighbors.push({
      expression,
      relationship: clean(item.relationship),
      source: normalizeProvenance(item.source || 'learner-generated'),
      firstObservedAt: clean(item.firstObservedAt || event.createdAt),
      lastObservedAt: clean(item.lastObservedAt || event.createdAt),
      observationCount: Number(item.observationCount || 1),
      contexts
    });
  }

  function connectionKey(connection) {
    const item = object(connection);
    return clean(item.connectionId) || [normalizeKey(item.from), normalizeKey(item.to), normalizeKey(item.direction)].join('|');
  }

  function mergeConnection(record, incoming, event) {
    const item = object(incoming);
    if (!clean(item.from) || !clean(item.to)) return;
    const key = connectionKey(item);
    let found = record.connections.find(connection => connectionKey(connection) === key);
    const evidence = object(item.evidenceSummary || item.evidence);
    const evidenceTypes = uniqueStrings([...(array(evidence.evidenceTypes)), clean(item.evidenceType)].filter(Boolean));
    const incomingExemplars = array(item.representativeEvidence).map(candidate => normalizeExemplar(candidate, event, clean(item.evidenceType || 'diagnostic')));
    if (!found) {
      found = {
        connectionId: clean(item.connectionId) || makeId('conn'),
        from: clean(item.from),
        to: clean(item.to),
        direction: clean(item.direction),
        evidenceSummary: {
          status: clean(evidence.status || 'observed'),
          evidenceTypes,
          observationCount: Number(evidence.observationCount || 1),
          distinctContextCount: Number(evidence.distinctContextCount || 1),
          lastObservedAt: clean(evidence.lastObservedAt || event.createdAt)
        },
        representativeEvidence: mergeExemplars([], incomingExemplars, 3),
        counterEvidence: array(item.counterEvidence).map(candidate => normalizeExemplar(candidate, event, 'counter-evidence')),
        trajectory: clean(item.trajectory)
      };
      record.connections.push(found);
      return;
    }
    found.evidenceSummary = object(found.evidenceSummary);
    found.evidenceSummary.status = clean(evidence.status || found.evidenceSummary.status || 'observed');
    found.evidenceSummary.evidenceTypes = uniqueStrings([...(array(found.evidenceSummary.evidenceTypes)), ...evidenceTypes]);
    found.evidenceSummary.observationCount = Number(found.evidenceSummary.observationCount || 0) + Number(evidence.observationCount || 1);
    found.evidenceSummary.distinctContextCount = Math.max(Number(found.evidenceSummary.distinctContextCount || 0), Number(evidence.distinctContextCount || 1));
    found.evidenceSummary.lastObservedAt = clean(evidence.lastObservedAt || event.createdAt || found.evidenceSummary.lastObservedAt);
    found.representativeEvidence = mergeExemplars(found.representativeEvidence, incomingExemplars, 3);
    found.counterEvidence = mergeExemplars(found.counterEvidence, array(item.counterEvidence).map(candidate => normalizeExemplar(candidate, event, 'counter-evidence')), 3);
    if (item.trajectory) found.trajectory = clean(item.trajectory);
  }

  function mergeFailedRoute(record, incoming, event) {
    const item = object(incoming);
    const route = clean(item.route);
    if (!route) return;
    const key = normalizeKey(route);
    const found = record.weakOrFailedRoutes.find(existing => normalizeKey(existing.route) === key);
    if (found) {
      found.lastObservedAt = clean(item.lastObservedAt || event.createdAt);
      found.observationCount = Number(found.observationCount || 0) + 1;
      if (item.reason) found.reason = clean(item.reason);
      return;
    }
    record.weakOrFailedRoutes.push({
      route,
      reason: clean(item.reason),
      source: normalizeProvenance(item.source || 'experiment-observed'),
      retain: item.retain !== false,
      firstObservedAt: clean(item.firstObservedAt || event.createdAt),
      lastObservedAt: clean(item.lastObservedAt || event.createdAt),
      observationCount: 1
    });
  }

  function mergeDomain(record, incoming, event) {
    const item = typeof incoming === 'string' ? { name: incoming } : object(incoming);
    const name = clean(item.name || item.domain);
    if (!name) return;
    const key = normalizeKey(name);
    const found = record.domains.find(domain => normalizeKey(domain.name) === key);
    if (found) {
      found.observationCount = Number(found.observationCount || 0) + 1;
      found.lastObservedAt = clean(item.lastObservedAt || event.createdAt);
      if (item.evidence) found.evidence = clean(item.evidence);
      return;
    }
    record.domains.push({
      name,
      evidence: clean(item.evidence || 'observed'),
      observationCount: 1,
      firstObservedAt: clean(item.firstObservedAt || event.createdAt),
      lastObservedAt: clean(item.lastObservedAt || event.createdAt)
    });
  }

  function routePatchFrom(result) {
    const patch = object(result?.routePatch);
    const operations = array(patch.operations);
    if (!operations.length) return patch;
    const normalized = {
      addPersonalAnchors: [],
      addNeighbors: [],
      addConnections: [],
      addEvidence: [],
      addFailedRoutes: [],
      addDomains: [],
      diagnosticExemplarCandidates: []
    };
    operations.forEach(operation => {
      const op = object(operation);
      const payload = object(op.payload);
      switch (clean(op.action)) {
        case 'ADD_PERSONAL_ANCHOR': normalized.addPersonalAnchors.push(payload); break;
        case 'ADD_NEIGHBOR': normalized.addNeighbors.push(payload); break;
        case 'ADD_CONNECTION': normalized.addConnections.push(payload); break;
        case 'STRENGTHEN_CONNECTION': normalized.addConnections.push(payload); break;
        case 'ADD_EVIDENCE': normalized.addEvidence.push(payload); break;
        case 'ADD_FAILED_ROUTE': normalized.addFailedRoutes.push(payload); break;
        case 'ADD_DOMAIN': normalized.addDomains.push(payload); break;
        case 'ADD_DIAGNOSTIC_EXEMPLAR_CANDIDATE': normalized.diagnosticExemplarCandidates.push(payload); break;
      }
    });
    return normalized;
  }

  function profilePatchFrom(result) {
    const patch = object(result?.profilePatch);
    const operations = array(patch.operations);
    if (!operations.length) return patch;
    const normalized = { candidateTendencies: [], styleTendencies: [], constructionEvidence: [] };
    operations.forEach(operation => {
      const op = object(operation);
      const payload = object(op.payload);
      switch (clean(op.action)) {
        case 'ADD_PROFILE_OBSERVATION': normalized.candidateTendencies.push(payload); break;
        case 'ADD_STYLE_OBSERVATION': normalized.styleTendencies.push(payload); break;
        case 'ADD_CONSTRUCTION_EVIDENCE': normalized.constructionEvidence.push(payload); break;
      }
    });
    return normalized;
  }

  function applyRoutePatch(record, event, result) {
    const patch = routePatchFrom(result);
    array(patch.addPersonalAnchors).forEach(item => mergePersonalAnchor(record, item, event));
    array(patch.addNeighbors).forEach(item => mergeNeighbor(record, item, event));
    array(patch.addConnections).forEach(item => mergeConnection(record, item, event));
    array(patch.addEvidence).forEach(item => mergeConnection(record, item, event));
    array(patch.addFailedRoutes).forEach(item => mergeFailedRoute(record, item, event));
    array(patch.addDomains).forEach(item => mergeDomain(record, item, event));

    const topLevelDiagnostic = object(result.diagnosticExemplarCandidate);
    const diagnosticCandidates = [
      ...array(patch.diagnosticExemplarCandidates),
      ...(topLevelDiagnostic.retain === true ? [topLevelDiagnostic] : [])
    ];
    const exemplars = diagnosticCandidates
      .filter(item => object(item).retain !== false)
      .map(item => normalizeExemplar(item, event, clean(item.type || 'diagnostic')));
    record.diagnosticExemplars = mergeExemplars(record.diagnosticExemplars, exemplars, ROUTE_EXEMPLAR_LIMIT);

    const router = object(result.routerDecision || result.router);
    const action = normalizeRouterAction(router.action);
    if (action) {
      record.nextRouteHints = [
        { action, reason: clampText(router.reason, 400), observedAt: clean(event.createdAt) },
        ...array(record.nextRouteHints).filter(item => normalizeRouterAction(item.action) !== action)
      ].slice(0, 5);
    }
    record.updatedAt = clean(event.updatedAt || event.createdAt || nowIso());
  }

  function tendencyKey(item) {
    const value = object(item);
    return [normalizeKey(value.type), normalizeKey(value.pattern || value.description)].join('|');
  }

  function profileConfidence(existing, requested, evidence, allowPromotion = false) {
    const current = clean(existing || 'hypothesis');
    const ask = clean(requested || current);
    if (!allowPromotion) return ['supported', 'recurring'].includes(current) ? current : 'hypothesis';
    const targets = Number(evidence.distinctTargetCount || 0);
    const contexts = Number(evidence.distinctContextCount || 0);
    const sessions = Number(evidence.distinctSessionCount || 0);
    if (ask === 'recurring' && targets >= 3 && contexts >= 3 && sessions >= 3) return 'recurring';
    if (['recurring', 'supported'].includes(ask) && targets >= 2 && contexts >= 2 && sessions >= 2) return current === 'recurring' ? 'recurring' : 'supported';
    return ['supported', 'recurring'].includes(current) ? current : 'hypothesis';
  }

  function mergeTendency(list, incoming, event, defaultType = 'production', allowPromotion = false) {
    const item = object(incoming);
    const description = clean(item.description || item.pattern);
    if (!description) return;
    const key = tendencyKey({ type: item.type || defaultType, pattern: item.pattern, description });
    let found = list.find(existing => tendencyKey(existing) === key);
    const context = clean(item.context || event.experience?.domain || event.experience?.type);
    const sessionId = clean(event.sessionId || item.sessionId);
    const wordId = clean(event.wordId || item.targetWordId);
    const exemplarCandidate = object(item.diagnosticExemplar || item.exemplar);
    const exemplar = normalizeExemplar({
      ...exemplarCandidate,
      type: clean(exemplarCandidate.type || item.type || defaultType),
      learnerResponse: exemplarCandidate.learnerResponse || authoritativeResponse(event),
      contextSummary: exemplarCandidate.contextSummary || context,
      whyImportant: exemplarCandidate.whyImportant || item.whyImportant
    }, event, clean(item.type || defaultType));

    if (!found) {
      found = {
        patternId: clean(item.patternId) || makeId('prod'),
        type: clean(item.type || defaultType),
        pattern: clean(item.pattern),
        description,
        confidence: 'hypothesis',
        evidence: {
          observationCount: 0,
          distinctTargetCount: 0,
          distinctContextCount: 0,
          distinctSessionCount: 0,
          targetIds: [],
          contexts: [],
          sessionIds: []
        },
        diagnosticExemplars: [],
        usefulScaffolds: uniqueStrings(item.usefulScaffolds),
        firstObservedAt: clean(event.createdAt),
        lastObservedAt: clean(event.createdAt)
      };
      list.push(found);
    }

    const evidence = object(found.evidence);
    evidence.observationCount = Number(evidence.observationCount || 0) + 1;
    evidence.targetIds = uniqueStrings([...(array(evidence.targetIds)), wordId].filter(Boolean));
    evidence.contexts = uniqueStrings([...(array(evidence.contexts)), context].filter(Boolean));
    evidence.sessionIds = uniqueStrings([...(array(evidence.sessionIds)), sessionId].filter(Boolean));
    evidence.distinctTargetCount = evidence.targetIds.length;
    evidence.distinctContextCount = evidence.contexts.length;
    evidence.distinctSessionCount = evidence.sessionIds.length;
    found.evidence = evidence;
    found.confidence = profileConfidence(found.confidence, item.suggestedConfidence || item.confidence, evidence, allowPromotion);
    found.diagnosticExemplars = mergeExemplars(found.diagnosticExemplars, [exemplar], PROFILE_EXEMPLAR_LIMIT);
    found.usefulScaffolds = uniqueStrings([...(array(found.usefulScaffolds)), ...(array(item.usefulScaffolds))]);
    found.lastObservedAt = clean(event.createdAt);
  }

  function constructionKey(item) {
    return normalizeKey(object(item).pattern || object(item).construction);
  }

  function mergeConstruction(list, incoming, event) {
    const item = object(incoming);
    const pattern = clean(item.pattern || item.construction);
    if (!pattern) return;
    let found = list.find(existing => constructionKey(existing) === normalizeKey(pattern));
    const status = clean(item.learnerStatus || item.status || 'unconfirmed');
    const evidence = normalizeExemplar({
      type: 'construction-use',
      learnerResponse: item.learnerResponse || authoritativeResponse(event),
      contextSummary: item.context || event.experience?.domain,
      whyImportant: item.whyImportant || `Evidence for reusable construction: ${pattern}`,
      source: item.source || 'ai-suggested'
    }, event, 'construction-use');
    if (!found) {
      found = {
        constructionId: clean(item.constructionId) || makeId('const'),
        pattern,
        source: normalizeProvenance(item.source || 'ai-suggested'),
        learnerEvidence: { status, observations: [] },
        usefulness: uniqueStrings(item.usefulness),
        firstObservedAt: clean(event.createdAt),
        lastObservedAt: clean(event.createdAt)
      };
      list.push(found);
    }
    found.learnerEvidence = object(found.learnerEvidence);
    const observations = array(found.learnerEvidence.observations);
    if (status !== 'unconfirmed' || item.retainEvidence === true) observations.push(evidence);
    found.learnerEvidence.observations = mergeExemplars([], observations, PROFILE_EXEMPLAR_LIMIT);
    if (['observed', 'learner-confirmed', 'spontaneous'].includes(status)) found.learnerEvidence.status = status;
    else if (!found.learnerEvidence.status) found.learnerEvidence.status = 'unconfirmed';
    found.usefulness = uniqueStrings([...(array(found.usefulness)), ...(array(item.usefulness))]);
    found.lastObservedAt = clean(event.createdAt);
  }

  function applyProfilePatch(profile, event, result, options = {}) {
    const patch = profilePatchFrom(result);
    const allowPromotion = options.allowPromotion === true;
    array(patch.candidateTendencies).forEach(item => mergeTendency(profile.productionTendencies, item, event, 'production', allowPromotion));
    array(patch.styleTendencies).forEach(item => mergeTendency(profile.styleTendencies, item, event, 'style', allowPromotion));
    array(patch.constructionEvidence).forEach(item => mergeConstruction(profile.reusableConstructions, item, event));
    profile.updatedAt = clean(event.updatedAt || event.createdAt || nowIso());
  }

  function rebuildDerivedState() {
    const events = readAIEvents();
    const route = { schemaVersion: 1, updatedAt: nowIso(), records: {} };
    const profile = {
      schemaVersion: 1,
      updatedAt: nowIso(),
      productionTendencies: [],
      reusableConstructions: [],
      styleTendencies: []
    };

    events.forEach(raw => {
      const event = normalizeEvent(raw);
      if (!event.interpreterResult || event.interpretationStatus === 'stale-after-correction') return;
      const interpretation = object(event.interpreterResult?.interpretation || event.interpreterResult?.responseInterpretation || event.interpreterResult?.observation);
      const confidence = normalizeConfidence(interpretation.interpretationConfidence || event.interpreterResult?.interpretationConfidence);
      const classes = new Set(array(interpretation.responseClasses).map(clean));
      const evidence = object(event.interpreterResult?.evidence);
      const promotionFlag = evidence.profilePromotionAllowed ?? event.interpreterResult?.profilePromotionAllowed;
      const canRecordProfileObservation = confidence !== 'low' && !classes.has('stt-uncertain');
      const allowProfilePromotion = canRecordProfileObservation && promotionFlag === true;
      const key = `wid:${event.wordId}`;
      if (!route.records[key]) route.records[key] = blankRouteRecord(event);
      applyRoutePatch(route.records[key], event, event.interpreterResult);
      if (canRecordProfileObservation) applyProfilePatch(profile, event, event.interpreterResult, { allowPromotion: allowProfilePromotion });
    });

    writeJson(AI_ROUTE_KEY, route);
    writeJson(AI_PROFILE_KEY, profile);
    return { routeState: clone(route), learnerProfile: clone(profile) };
  }

  function mergeInterpreterResult(eventId, interpreterResult) {
    const id = clean(eventId);
    if (!id) throw new Error('eventId is required');
    const result = object(interpreterResult);
    if (!Object.keys(result).length) throw new Error('interpreterResult is required');
    if (result.contract && window.WLPAIStudyContract?.validateInterpreterResponse) {
      const eventsForValidation = readAIEvents();
      const existingForValidation = eventsForValidation.find(item => clean(item.eventId) === id);
      const normalizedForValidation = existingForValidation ? normalizeEvent(existingForValidation) : null;
      const validationContext = normalizedForValidation ? {
        learningOpportunity: { direction: clean(normalizedForValidation.experience?.direction) },
        experience: clone(normalizedForValidation.experience),
        learnerResponse: clone(normalizedForValidation.learnerResponse)
      } : null;
      const validation = window.WLPAIStudyContract.validateInterpreterResponse(result, validationContext);
      if (!validation.valid) {
        const details = validation.errors.map(item => `${item.path}: ${item.message}`).join('; ');
        throw new Error(`Interpreter contract rejected: ${details}`);
      }
    }
    const events = readAIEvents();
    const index = events.findIndex(event => clean(event.eventId) === id);
    if (index < 0) throw new Error(`AI Study event not found: ${id}`);
    const event = normalizeEvent(events[index]);
    event.interpreterResult = clone(result);
    event.interpretationStatus = 'interpreted';
    event.updatedAt = nowIso();
    events[index] = event;
    writeJson(AI_EVENT_KEY, compactEventLog(events));
    const derived = rebuildDerivedState();
    return { event: clone(event), ...derived };
  }

  function studyQEvidence(wordId) {
    const id = clean(wordId);
    const events = readStudyQEvents().filter(event => clean(event.wordId) === id);
    const exactEvents = events.filter(event => clean(event.autoMatch) === 'target-exact');
    const shownAttempts = events.filter(event => event.targetShown === true).length;
    const hiddenAttempts = events.filter(event => event.targetShown === false).length;
    const unknownVisibilityAttempts = events.length - shownAttempts - hiddenAttempts;
    const shownExact = exactEvents.filter(event => event.targetShown === true).length;
    const hiddenExact = exactEvents.filter(event => event.targetShown === false).length;
    const unknownVisibilityExact = exactEvents.length - shownExact - hiddenExact;
    const hintCount = events.reduce((sum, event) => sum + Number(event.hintCount || (event.hintShown ? 1 : 0)), 0);
    const latest = events[events.length - 1] || null;
    return {
      summary: {
        attemptCount: events.length,
        targetExactCount: exactEvents.length,
        targetHiddenExactCount: hiddenExact,
        targetShownExactCount: shownExact,
        targetUnknownVisibilityExactCount: unknownVisibilityExact,
        targetHiddenAttemptCount: hiddenAttempts,
        targetShownAttemptCount: shownAttempts,
        targetUnknownVisibilityAttemptCount: unknownVisibilityAttempts,
        totalHintCount: hintCount,
        latestOutcome: clean(latest?.selfRating || latest?.autoMatch),
        latestResponse: clampText(latest?.responseText, 250)
      },
      recentRawAttempts: events.slice(-RAW_STUDYQ_LIMIT).map(event => ({
        eventId: clean(event.eventId),
        promptKind: clean(event.promptKind),
        response: clampText(event.responseText, 400),
        autoMatch: clean(event.autoMatch),
        selfRating: clean(event.selfRating),
        hintCount: Number(event.hintCount || (event.hintShown ? 1 : 0)),
        targetShown: Boolean(event.targetShown),
        elapsedMs: Number(event.elapsedMs || 0),
        completedAt: clean(event.completedAt || event.updatedAt)
      }))
    };
  }

  function meaningfulAIEventsFor(wordId, limit = RAW_TARGET_EVENT_LIMIT) {
    const id = clean(wordId);
    const candidates = readAIEvents().filter(event => clean(event.wordId) === id);
    return candidates
      .map((event, index) => ({ event, index, score: eventImportance(event) }))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, limit)
      .sort((a, b) => a.index - b.index)
      .map(item => {
        const event = normalizeEvent(item.event);
        return {
          eventId: event.eventId,
          createdAt: event.createdAt,
          experience: clone(event.experience),
          learnerResponse: clone(event.learnerResponse),
          interpretationStatus: event.interpretationStatus,
          responseInterpretation: clone(event.interpreterResult?.interpretation || event.interpreterResult?.responseInterpretation || event.interpreterResult?.observation || null),
          communicativeInterpretation: clone(event.interpreterResult?.communicativeInterpretation || null),
          routerDecision: clone(event.interpreterResult?.router || event.interpreterResult?.routerDecision || null)
        };
      });
  }

  function antiRoteWindow() {
    const events = readAIEvents().slice(-ANTI_ROTE_WINDOW).map(normalizeEvent);
    return {
      recentExperiences: events.map(event => ({
        wordId: event.wordId,
        target: clean(event.target?.headword),
        domain: clean(event.experience?.domain),
        direction: clean(event.experience?.direction),
        type: clean(event.experience?.type),
        targetVisibility: normalizeTargetVisibility(event.experience?.targetVisibility ?? event.experience?.targetVisible),
        promptSignature: clampText(event.experience?.prompt, 180),
        experienceGrounding: clone(event.experience?.experienceGrounding || null),
        messageCore: clone(event.experience?.messageCore || null),
        communicativeFocus: clone(event.experience?.communicativeFocus || null),
        construal: clone(event.experience?.construal || null),
        usageMotivation: clone(event.experience?.usageMotivation || null)
      })),
      recentDomains: uniqueStrings(events.map(event => event.experience?.domain)),
      recentDirections: uniqueStrings(events.map(event => event.experience?.direction)),
      recentPromptTypes: uniqueStrings(events.map(event => event.experience?.type)),
      targetVisibilityHistory: events.map(event => normalizeTargetVisibility(event.experience?.targetVisibility ?? event.experience?.targetVisible))
    };
  }

  function compactRouteSummary(record) {
    const route = object(record);
    return {
      personalAnchors: array(route.personalAnchors).slice(0, 4).map(item => clean(item.value)).filter(Boolean),
      learnerGeneratedNeighbors: array(route.learnerGeneratedNeighbors).slice(0, 6).map(item => clean(item.expression)).filter(Boolean),
      strongConnections: array(route.connections)
        .filter(item => ['repeated', 'strong'].includes(clean(item.evidenceSummary?.status)))
        .slice(0, 4)
        .map(item => `${clean(item.from)} → ${clean(item.to)}`),
      observedConnections: array(route.connections).slice(0, 6).map(item => `${clean(item.from)} → ${clean(item.to)}`),
      weakOrFailedRoutes: array(route.weakOrFailedRoutes).slice(0, 3).map(item => clean(item.route)).filter(Boolean),
      nextRouteHints: array(route.nextRouteHints).slice(0, 3)
    };
  }

  function relevantProfileSummary(profile, row, routeRecord) {
    const pos = normalizeKey(row?.['Part of Speech']);
    const target = normalizeKey(row?.Word);
    const neighbors = new Set(array(routeRecord?.learnerGeneratedNeighbors).map(item => normalizeKey(item.expression)));
    const all = [...array(profile.productionTendencies), ...array(profile.styleTendencies)];
    return all.filter(item => {
      const haystack = normalizeKey([item.type, item.pattern, item.description].join(' '));
      return (pos && haystack.includes(pos)) || (target && haystack.includes(target)) || Array.from(neighbors).some(value => value && haystack.includes(value));
    }).slice(0, 5).map(item => ({
      patternId: clean(item.patternId),
      type: clean(item.type),
      description: clean(item.description),
      confidence: clean(item.confidence),
      evidence: {
        observationCount: Number(item.evidence?.observationCount || 0),
        distinctTargetCount: Number(item.evidence?.distinctTargetCount || 0),
        distinctContextCount: Number(item.evidence?.distinctContextCount || 0),
        distinctSessionCount: Number(item.evidence?.distinctSessionCount || 0)
      }
    }));
  }

  function reviewSignal(wordId) {
    const record = readProgressRecord(wordId);
    if (!record) return { review: false, reviewLevel: '', reasons: [], exposureCount: 0, lastSeen: '' };
    return {
      review: record.review === true || record.lastResult === 'review',
      reviewLevel: clean(record.reviewLevel),
      reasons: uniqueStrings(record.reviewReasons),
      exposureCount: Number(record.exposureCount || 0),
      lastSeen: record.lastSeen || ''
    };
  }

  async function assembleCandidateContext(options = {}) {
    const rows = await getMasterRows();
    const routeState = readRouteState();
    const profile = readLearnerProfile();
    const maxCandidates = Math.max(1, Math.min(30, Number(options.maxCandidates || 30)));
    const wantedIds = new Set(uniqueStrings(options.wordIds).map(normalizeKey));
    const deck = Number(options.deck || 0);
    const rangeStart = Number(options.rangeStart || 0);
    const rangeEnd = Number(options.rangeEnd || 0);

    let selected = rows.filter(row => {
      const id = normalizeKey(row.WordID);
      if (wantedIds.size) return wantedIds.has(id);
      const batch = Number(row['Batch #'] || 0);
      if (deck) return batch === deck;
      if (rangeStart && rangeEnd) return batch >= Math.min(rangeStart, rangeEnd) && batch <= Math.max(rangeStart, rangeEnd);
      return false;
    }).slice(0, maxCandidates);

    const candidates = selected.map(row => {
      const wordId = clean(row.WordID);
      const target = resolveTarget(row);
      const studyQ = studyQEvidence(wordId);
      const route = routeState.records[`wid:${wordId}`] || {};
      const meta = learningMetadataFor(wordId);
      return {
        wordId,
        headword: clean(row.Word),
        targetFamily: target.targetFamily,
        pos: clean(row['Part of Speech']),
        meaningSummary: clampText(row.Definition, 220),
        reviewSignal: reviewSignal(wordId),
        studyQSignal: {
          recentAttemptCount: studyQ.summary.attemptCount,
          targetHiddenExactCount: studyQ.summary.targetHiddenExactCount,
          targetShownExactCount: studyQ.summary.targetShownExactCount,
          targetUnknownVisibilityExactCount: studyQ.summary.targetUnknownVisibilityExactCount,
          targetHiddenAttemptCount: studyQ.summary.targetHiddenAttemptCount,
          targetShownAttemptCount: studyQ.summary.targetShownAttemptCount,
          targetUnknownVisibilityAttemptCount: studyQ.summary.targetUnknownVisibilityAttemptCount,
          latestOutcome: studyQ.summary.latestOutcome,
          recentHintsNeeded: studyQ.recentRawAttempts.reduce((sum, item) => sum + item.hintCount, 0)
        },
        learningMetadataSignal: {
          available: Boolean(meta),
          situationCount: array(meta?.situations).length,
          hasSenseHook: Boolean(clean(meta?.senseHook)),
          hasMemoryHook: Boolean(clean(meta?.memoryHook))
        },
        routeSummary: compactRouteSummary(route),
        relevantLearnerPatterns: relevantProfileSummary(profile, row, route)
      };
    });

    return {
      schemaVersion: 1,
      session: {
        sessionId: clean(options.sessionId),
        sourceMode: clean(options.sourceMode || (deck ? 'deck' : rangeStart ? 'range' : wantedIds.size ? 'explicit' : 'unknown')),
        sourceLabel: clean(options.sourceLabel),
        difficulty: clean(options.difficulty || 'adaptive')
      },
      learnerSessionState: antiRoteWindow(),
      candidates
    };
  }

  function normalizeLearningMetadata(meta) {
    if (!meta) return null;
    return {
      senseHook: clean(meta.senseHook),
      memoryHook: clean(meta.memoryHook),
      entryType: clean(meta.entryType),
      situations: array(meta.situations).map(item => clone(item)),
      communicativeNeeds: uniqueStrings(meta.communicativeNeeds || meta.communicativeNeed ? (Array.isArray(meta.communicativeNeeds) ? meta.communicativeNeeds : [meta.communicativeNeed]) : []),
      alternativeExpressions: array(meta.alternativeExpressions).map(item => clone(item))
    };
  }

  async function assembleTargetContext(wordId, options = {}) {
    const id = clean(wordId);
    if (!id) throw new Error('wordId is required');
    const rows = await getMasterRows();
    const row = rows.find(item => clean(item.WordID) === id);
    if (!row) throw new Error(`Master card not found for WordID ${id}`);
    const target = resolveTarget(row);
    const routeState = readRouteState();
    const route = routeState.records[`wid:${id}`] || blankRouteRecord({ wordId: id, target: { headword: row.Word, targetFamily: target.targetFamily } });
    const profile = readLearnerProfile();
    const studyQ = studyQEvidence(id);
    const progress = reviewSignal(id);
    const metadata = normalizeLearningMetadata(learningMetadataFor(id));

    return {
      schemaVersion: 1,
      target: {
        wordId: id,
        headword: clean(row.Word),
        targetFamily: target.targetFamily,
        targetKind: target.targetKind,
        entryType: clean(metadata?.entryType),
        pos: clean(row['Part of Speech']),
        definition: clean(row.Definition),
        synonyms: clean(row['Synonym(s)']),
        examples: clean(row['Example Sentence']),
        notes: clean(row['Note(s)']),
        category: clean(row.Category),
        source: clean(row.Source)
      },
      learningMetadata: metadata,
      reviewProgress: progress,
      studyQHistory: studyQ,
      learnerEvidence: {
        personalAnchors: clone(route.personalAnchors || []),
        learnerGeneratedNeighbors: clone(route.learnerGeneratedNeighbors || []),
        observedConnections: clone(route.connections || []),
        weakOrFailedRoutes: clone(route.weakOrFailedRoutes || []),
        domains: clone(route.domains || []),
        diagnosticExemplars: clone(route.diagnosticExemplars || []),
        nextRouteHints: clone(route.nextRouteHints || [])
      },
      learnerProfile: {
        relevantTendencies: relevantProfileSummary(profile, row, route),
        reusableConstructions: clone(profile.reusableConstructions || [])
      },
      aiStudyHistory: {
        recentMeaningfulEvents: meaningfulAIEventsFor(id, Number(options.maxRawAIEvents || RAW_TARGET_EVENT_LIMIT))
      },
      antiRote: antiRoteWindow()
    };
  }

  async function assembleInterpretationContext(input = {}) {
    const wordId = clean(input.wordId || input.target?.wordId);
    if (!wordId) throw new Error('wordId is required');
    const targetContext = await assembleTargetContext(wordId, { maxRawAIEvents: 3 });
    const response = object(input.learnerResponse);
    const corrected = clean(response.correctedTranscript);
    const raw = clean(response.rawTranscript || response.text);
    return {
      schemaVersion: 1,
      target: {
        wordId,
        headword: targetContext.target.headword,
        targetFamily: targetContext.target.targetFamily,
        pos: targetContext.target.pos
      },
      learningOpportunity: clone(input.learningOpportunity || null),
      experience: clone(input.experience || null),
      learnerResponse: {
        rawTranscript: raw,
        correctedTranscript: corrected,
        authoritativeResponse: corrected || raw,
        inputMode: clean(response.inputMode || 'text'),
        sttCorrectedByLearner: Boolean(corrected || response.sttCorrectedByLearner)
      },
      relevantGraphState: {
        personalAnchors: targetContext.learnerEvidence.personalAnchors,
        learnerGeneratedNeighbors: targetContext.learnerEvidence.learnerGeneratedNeighbors,
        relevantExistingEdges: targetContext.learnerEvidence.observedConnections,
        weakOrFailedRoutes: targetContext.learnerEvidence.weakOrFailedRoutes
      },
      relevantLearnerProfile: targetContext.learnerProfile,
      recentRelatedEvidence: targetContext.aiStudyHistory.recentMeaningfulEvents.slice(-3)
    };
  }

  function buildPlannerWriterRequest(input = {}) {
    const contract = window.WLPAIStudyContract;
    if (!contract?.createPlannerRequest) throw new Error('AI Study Contract layer is not loaded');
    const candidateContext = object(input.candidateContext);
    const request = contract.createPlannerRequest({
      ...input,
      session: Object.keys(object(input.session)).length ? input.session : candidateContext.session,
      learnerSessionState: Object.keys(object(input.learnerSessionState)).length ? input.learnerSessionState : candidateContext.learnerSessionState,
      candidateContext,
      targetPackets: array(input.targetPackets)
    });
    const validation = contract.validatePlannerRequest(request);
    if (!validation.valid) {
      const details = validation.errors.map(item => `${item.path}: ${item.message}`).join('; ');
      throw new Error(`Planner request rejected: ${details}`);
    }
    return request;
  }

  function buildInterpreterRouterRequest(input = {}) {
    const contract = window.WLPAIStudyContract;
    if (!contract?.createInterpreterRequest) throw new Error('AI Study Contract layer is not loaded');
    const context = object(input.interpretationContext || input.context || input);
    const relevantState = Object.keys(object(input.relevantState)).length ? input.relevantState : {
      graph: clone(context.relevantGraphState || {}),
      learnerProfile: clone(context.relevantLearnerProfile || {}),
      recentEvidence: clone(context.recentRelatedEvidence || [])
    };
    const request = contract.createInterpreterRequest({
      ...input,
      session: Object.keys(object(input.session)).length ? input.session : { sessionId: clean(input.sessionId || context.sessionId || input.experience?.sessionId) },
      target: context.target || input.target,
      learningOpportunity: context.learningOpportunity ?? input.learningOpportunity ?? null,
      experience: context.experience ?? input.experience ?? null,
      learnerResponse: context.learnerResponse || input.learnerResponse,
      relevantState
    });
    const validation = contract.validateInterpreterRequest(request);
    if (!validation.valid) {
      const details = validation.errors.map(item => `${item.path}: ${item.message}`).join('; ');
      throw new Error(`Interpreter request rejected: ${details}`);
    }
    return request;
  }

  function exportSnapshot() {
    return {
      format: 'WLP_AI_STUDY_DATA_SNAPSHOT',
      version: 1,
      exportedAt: nowIso(),
      events: readAIEvents(),
      routeState: readRouteState(),
      learnerProfile: readLearnerProfile()
    };
  }

  function getStorageSummary() {
    const events = readAIEvents();
    const route = readRouteState();
    const profile = readLearnerProfile();
    return {
      eventCount: events.length,
      routeRecordCount: Object.keys(route.records).length,
      productionTendencyCount: profile.productionTendencies.length,
      reusableConstructionCount: profile.reusableConstructions.length,
      styleTendencyCount: profile.styleTendencies.length
    };
  }

  window.WLPAIStudyData = Object.freeze({
    version: VERSION,
    keys: Object.freeze({
      events: AI_EVENT_KEY,
      routeState: AI_ROUTE_KEY,
      learnerProfile: AI_PROFILE_KEY
    }),
    provenance: Object.freeze(Array.from(PROVENANCE)),
    routerActions: Object.freeze(Array.from(ROUTER_ACTIONS)),
    saveAIStudyEvent,
    findEvent,
    applyUserCorrection,
    mergeInterpreterResult,
    rebuildDerivedState,
    readAIEvents: () => clone(readAIEvents()),
    readRouteState: () => clone(readRouteState()),
    readLearnerProfile: () => clone(readLearnerProfile()),
    assembleCandidateContext,
    assembleTargetContext,
    assembleInterpretationContext,
    buildPlannerWriterRequest,
    buildInterpreterRouterRequest,
    exportSnapshot,
    getStorageSummary
  });
})();
