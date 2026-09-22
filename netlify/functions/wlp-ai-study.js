'use strict';

const plannerResponseSchema = require('../../planner-writer-response-v1.schema.json');
const interpreterResponseSchema = require('../../interpreter-router-response-v1.schema.json');

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const MAX_BODY_BYTES = 512 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function clean(value) {
  return String(value ?? '').trim();
}

function parseRetryDelayMs(value) {
  const raw = clean(value);
  if (!raw) return null;
  const secondsMatch = raw.match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
  if (secondsMatch) return Math.max(0, Math.ceil(Number(secondsMatch[1]) * 1000));
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function findRetryDelayMs(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRetryDelayMs(item, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (/retry(?:After|Delay)/i.test(key)) {
      const parsed = parseRetryDelayMs(item);
      if (parsed != null) return parsed;
    }
  }
  for (const item of Object.values(value)) {
    const found = findRetryDelayMs(item, depth + 1);
    if (found != null) return found;
  }
  return null;
}

function retryDelayFromMessage(message) {
  const match = clean(message).match(/retry\s+(?:again\s+)?in\s+([0-9]+(?:\.[0-9]+)?)\s*s(?:ec(?:ond)?s?)?/i);
  return match ? Math.max(0, Math.ceil(Number(match[1]) * 1000)) : null;
}

function retryAfterMsFromProvider(response, body, message) {
  const headerValue = response?.headers?.get ? response.headers.get('retry-after') : '';
  const headerMs = parseRetryDelayMs(headerValue);
  if (headerMs != null) return headerMs;
  const detailMs = findRetryDelayMs(body?.error?.details || body?.details || body);
  if (detailMs != null) return detailMs;
  return retryDelayFromMessage(message);
}

function providerQuotaInspectionText(body, message) {
  let serialized = '';
  try { serialized = JSON.stringify(body || {}); } catch (_) {}
  return `${clean(message)} ${serialized}`.toLowerCase();
}

function quotaScopeFromProvider(message, retryAfterMs, body = null) {
  const inspection = providerQuotaInspectionText(body, message);

  // Google commonly identifies RPD quota in structured QuotaFailure details,
  // e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. Prefer those
  // semantics over a short retryDelay hint, which can still be present on a
  // daily exhaustion response.
  if (/generaterequestsperday|requestsperday|perdayperproject|requests[_ -]?per[_ -]?day|per[_ -]?day|\brpd\b|\bdaily\b/.test(inspection)) {
    return 'daily';
  }

  if (/generaterequestsperminute|requestsperminute|perminuteperproject|requests[_ -]?per[_ -]?minute|\brpm\b/.test(inspection)) {
    return 'short-window';
  }

  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return 'short-window';
  return 'unknown';
}

function normalizeProviderHttpError(provider, response, body) {
  const providerName = clean(provider) || 'provider';
  const providerHttpStatus = Number(response?.status) || 0;
  const providerMessage = clean(body?.error?.message || body?.message) || `${providerName} API returned HTTP ${providerHttpStatus || 'error'}`;
  const providerCode = clean(body?.error?.status || body?.error?.code) || 'WLP_AI_PROVIDER_ERROR';
  const retryAfterMs = retryAfterMsFromProvider(response, body, providerMessage);

  if (providerHttpStatus === 429) {
    const quotaScope = quotaScopeFromProvider(providerMessage, retryAfterMs, body);
    const retryable = quotaScope !== 'daily';
    const inspection = providerQuotaInspectionText(body, providerMessage);
    const freeTier = /free[_ -]?tier|freetier/.test(inspection);
    const resetPolicy = quotaScope === 'daily' ? 'midnight-pacific' : '';
    const waitText = Number.isFinite(retryAfterMs) ? ` Try again in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.` : ' Try again later.';
    const message = quotaScope === 'daily'
      ? `${providerName}${freeTier ? ' free-tier' : ''} daily request limit reached. Requests-per-day quotas reset at midnight Pacific Time.`
      : `${providerName} request quota/rate limit reached.${waitText}`;
    const error = new Error(message);
    error.code = 'WLP_AI_PROVIDER_RATE_LIMIT';
    error.statusCode = 429;
    error.provider = providerName;
    error.providerHttpStatus = providerHttpStatus;
    error.providerCode = providerCode;
    error.providerMessage = providerMessage;
    error.retryAfterMs = retryAfterMs;
    error.retryable = retryable;
    error.quotaScope = quotaScope;
    error.resetPolicy = resetPolicy;
    return error;
  }

  if (providerHttpStatus === 503) {
    const error = new Error(`${providerName} is temporarily unavailable or busy. Please try again later.`);
    error.code = 'WLP_AI_PROVIDER_BUSY';
    error.statusCode = 503;
    error.provider = providerName;
    error.providerHttpStatus = providerHttpStatus;
    error.providerCode = providerCode;
    error.providerMessage = providerMessage;
    error.retryAfterMs = retryAfterMs;
    error.retryable = true;
    error.quotaScope = 'temporary';
    return error;
  }

  const error = new Error(providerMessage);
  error.code = providerCode || 'WLP_AI_PROVIDER_ERROR';
  error.statusCode = providerHttpStatus >= 500 ? 503 : 502;
  error.provider = providerName;
  error.providerHttpStatus = providerHttpStatus;
  error.providerCode = providerCode;
  error.providerMessage = providerMessage;
  error.retryAfterMs = retryAfterMs;
  error.retryable = false;
  error.quotaScope = 'none';
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, limit = 1200) {
  const out = clean(value);
  return out.length > limit ? `${out.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : out;
}

function strings(value, limit = 8) {
  return arr(value).map(clean).filter(Boolean).slice(0, limit);
}

function pick(source, keys) {
  const out = {};
  const input = obj(source);
  keys.forEach(key => {
    if (input[key] !== undefined) out[key] = clone(input[key]);
  });
  return out;
}

function sanitizeSchemaForOpenAI(value) {
  if (Array.isArray(value)) return value.map(sanitizeSchemaForOpenAI);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['$schema', '$id', 'title'].includes(key)) continue;
    out[key] = sanitizeSchemaForOpenAI(item);
  }
  return out;
}

function inferJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return undefined;
}

function sanitizeSchemaForGemini(value) {
  if (Array.isArray(value)) return value.map(sanitizeSchemaForGemini);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['$schema', '$id', 'title', 'additionalProperties', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'format'].includes(key)) continue;
    if (key === 'const') {
      out.enum = [item];
      if (!out.type) out.type = inferJsonType(item);
      continue;
    }
    out[key] = sanitizeSchemaForGemini(item);
  }
  return out;
}

function validateEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  if (body.schemaVersion !== 1) return 'schemaVersion must be 1.';
  if (!['planner', 'interpreter', 'health', 'preview'].includes(body.kind)) return 'kind must be planner, interpreter, health, or preview.';
  if (body.kind === 'health') return '';
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return 'payload must be an object.';
  const effectiveKind = body.kind === 'preview' ? clean(body.previewKind) : body.kind;
  if (!['planner', 'interpreter'].includes(effectiveKind)) return 'previewKind must be planner or interpreter.';
  if (effectiveKind === 'planner' && body.payload.contract !== 'planner-writer-v1.request') return 'Planner payload contract mismatch.';
  if (effectiveKind === 'interpreter') {
    if (body.payload.contract !== 'interpreter-router-v1.request') return 'Interpreter payload contract mismatch.';
    if (!clean(body.eventId) && body.kind !== 'preview') return 'Interpreter request requires eventId.';
  }
  return '';
}

function minimizeReviewSignal(signal) {
  const s = obj(signal);
  return {
    review: Boolean(s.review),
    reviewLevel: clean(s.reviewLevel),
    reasons: strings(s.reasons, 5),
    exposureCount: Number(s.exposureCount || 0)
  };
}

function minimizeRouteSummary(route) {
  const r = obj(route);
  return {
    personalAnchors: strings(r.personalAnchors, 3).map(v => text(v, 220)),
    learnerGeneratedNeighbors: strings(r.learnerGeneratedNeighbors, 5).map(v => text(v, 160)),
    strongConnections: strings(r.strongConnections, 4).map(v => text(v, 220)),
    observedConnections: strings(r.observedConnections, 5).map(v => text(v, 220)),
    routeEvidence: arr(r.routeEvidence).slice(0, 5).map(item => ({
      type: clean(item?.type),
      observationCount: Number(item?.observationCount || 0)
    })).filter(item => item.type),
    weakOrFailedRoutes: strings(r.weakOrFailedRoutes, 3).map(v => text(v, 240)),
    nextRouteHints: arr(r.nextRouteHints).slice(0, 3).map(item => pick(item, ['action', 'reason']))
  };
}

function minimizeCandidate(candidate) {
  const c = obj(candidate);
  return {
    wordId: clean(c.wordId),
    headword: text(c.headword, 180),
    targetFamily: strings(c.targetFamily, 6),
    pos: text(c.pos, 120),
    meaningSummary: text(c.meaningSummary, 260),
    reviewSignal: minimizeReviewSignal(c.reviewSignal),
    studyQSignal: pick(c.studyQSignal, ['recentAttemptCount', 'targetHiddenExactCount', 'targetShownExactCount', 'targetUnknownVisibilityExactCount', 'targetHiddenAttemptCount', 'targetShownAttemptCount', 'targetUnknownVisibilityAttemptCount', 'latestOutcome', 'recentHintsNeeded']),
    learningMetadataSignal: pick(c.learningMetadataSignal, ['available', 'situationCount', 'hasSenseHook', 'hasMemoryHook']),
    routeSummary: minimizeRouteSummary(c.routeSummary),
    relevantLearnerPatterns: arr(c.relevantLearnerPatterns).slice(0, 3).map(item => ({
      type: text(item?.type, 100),
      description: text(item?.description, 300),
      confidence: clean(item?.confidence)
    }))
  };
}

function minimizeLearningMetadata(meta) {
  const m = obj(meta);
  const situations = arr(m.situations).slice(0, 3).map(item => {
    if (typeof item === 'string') return text(item, 900);
    const x = obj(item);
    const out = {};
    const title = text(x.title || x.label, 220);
    const anchor = text(x.anchor || x.situation || x.text || x.context || x.example, 900);
    const communicativeNeed = text(x.communicativeNeed, 420);
    if (title) out.title = title;
    if (anchor) out.anchor = anchor;
    if (communicativeNeed) out.communicativeNeed = communicativeNeed;
    return out;
  }).filter(item => typeof item === 'string' ? Boolean(clean(item)) : Object.keys(item).length > 0);

  return {
    senseHook: text(m.senseHook, 420),
    memoryHook: text(m.memoryHook, 420),
    entryType: text(m.entryType, 100),
    situations,
    communicativeNeeds: strings(m.communicativeNeeds, 4).map(v => text(v, 320)),
    alternativeExpressions: arr(m.alternativeExpressions).slice(0, 5).map(item => {
      if (typeof item === 'string') return text(item, 240);
      const x = obj(item);
      return pick(x, ['expression', 'relationship', 'note', 'usage']);
    })
  };
}

function minimizeAnchor(item) {
  const x = obj(item);
  return {
    type: clean(x.type),
    value: text(x.value, 360),
    source: clean(x.source),
    confidence: clean(x.confidence),
    persistent: x.persistent === true
  };
}

function minimizeNeighbor(item) {
  const x = obj(item);
  return {
    expression: text(x.expression, 180),
    relationship: text(x.relationship, 300),
    source: clean(x.source),
    contexts: strings(x.contexts || (x.context ? [x.context] : []), 4).map(v => text(v, 160))
  };
}

function minimizeConnection(item) {
  const x = obj(item);
  return {
    from: text(x.from, 220),
    to: text(x.to, 220),
    direction: clean(x.direction),
    evidenceSummary: {
      status: clean(x.evidenceSummary?.status),
      evidenceTypes: strings(x.evidenceSummary?.evidenceTypes, 5),
      observationCount: Number(x.evidenceSummary?.observationCount || 0),
      distinctContextCount: Number(x.evidenceSummary?.distinctContextCount || 0)
    },
    representativeEvidence: arr(x.representativeEvidence).slice(0, 1).map(ev => ({
      type: clean(ev?.type),
      learnerResponse: text(ev?.learnerResponse || ev?.excerpt, 380),
      contextSummary: text(ev?.contextSummary, 380)
    }))
  };
}

function minimizeDiagnostic(item) {
  const x = obj(item);
  return {
    type: clean(x.type),
    learnerResponse: text(x.learnerResponse || x.excerpt, 420),
    contextSummary: text(x.contextSummary || x.context, 420),
    whyImportant: text(x.whyImportant, 360)
  };
}

function minimizeTendency(item) {
  const x = obj(item);
  const evidence = obj(x.evidence);
  return {
    type: clean(x.type),
    pattern: text(x.pattern, 180),
    description: text(x.description, 360),
    confidence: clean(x.confidence),
    evidence: {
      observationCount: Number(evidence.observationCount || 0),
      distinctTargetCount: Number(evidence.distinctTargetCount || 0),
      distinctContextCount: Number(evidence.distinctContextCount || 0),
      distinctSessionCount: Number(evidence.distinctSessionCount || 0)
    },
    diagnosticExemplars: arr(x.diagnosticExemplars).slice(0, 1).map(minimizeDiagnostic)
  };
}

function minimizeConstruction(item) {
  const x = obj(item);
  return {
    pattern: text(x.pattern, 220),
    source: clean(x.source),
    learnerEvidence: {
      status: clean(x.learnerEvidence?.status),
      observations: arr(x.learnerEvidence?.observations).slice(0, 1).map(minimizeDiagnostic)
    },
    usefulness: strings(x.usefulness, 3).map(v => text(v, 240))
  };
}

function minimizeExperience(exp) {
  const e = obj(exp);
  return {
    direction: clean(e.direction),
    type: clean(e.type),
    domain: text(e.domain, 160),
    targetVisibility: clean(e.targetVisibility),
    prompt: text(e.prompt, 1200),
    responseMode: clean(e.responseMode),
    responseConstraint: clean(e.responseConstraint),
    responseFrame: text(e.responseFrame, 500),
    intendedExample: text(e.intendedExample, 1200),
    acceptableSemanticTerritory: strings(e.acceptableSemanticTerritory, 8).map(v => text(v, 360)),
    anticipatedNaturalAlternatives: strings(e.anticipatedNaturalAlternatives, 8).map(v => text(v, 180)),
    frameCompatibleAlternatives: strings(e.frameCompatibleAlternatives, 8).map(v => text(v, 180)),
    frameCompatibilityVerified: Boolean(e.frameCompatibilityVerified),
    experienceGrounding: clone(e.experienceGrounding || null),
    messageCore: clone(e.messageCore || null),
    communicativeFocus: clone(e.communicativeFocus || null),
    construal: text(e.construal, 320),
    usageMotivation: clone(e.usageMotivation || null)
  };
}

function minimizeAIEvent(item) {
  const x = obj(item);
  const lr = obj(x.learnerResponse);
  return {
    experience: minimizeExperience(x.experience),
    learnerResponse: {
      authoritativeResponse: text(lr.authoritativeResponse || lr.correctedTranscript || lr.rawTranscript, 600),
      inputMode: clean(lr.inputMode),
      sttCorrectedByLearner: Boolean(lr.sttCorrectedByLearner)
    },
    responseInterpretation: clone(x.responseInterpretation || null),
    communicativeInterpretation: clone(x.communicativeInterpretation || null),
    evidence: {
      evidenceTypes: strings(x.evidence?.evidenceTypes, 6),
      observationSummary: text(x.evidence?.observationSummary, 420)
    },
    routerDecision: pick(x.routerDecision, ['action', 'reason'])
  };
}

function minimizeTargetReadiness(value) {
  const r = obj(value);
  return {
    schemaVersion: Number(r.schemaVersion || 1),
    status: clean(r.status),
    handling: clean(r.handling),
    kind: clean(r.kind),
    resolverKind: clean(r.resolverKind),
    rawHeadword: text(r.rawHeadword, 180),
    normalizedHeadword: text(r.normalizedHeadword, 180),
    primaryTarget: text(r.primaryTarget, 180),
    practiceUnits: strings(r.practiceUnits, 8).map(v => text(v, 180)),
    targetFamily: strings(r.targetFamily, 8).map(v => text(v, 180)),
    pos: text(r.pos, 120),
    posCategories: strings(r.posCategories, 8).map(v => text(v, 80)),
    senseSelectionRequired: r.senseSelectionRequired === true,
    entryType: clean(r.entryType),
    focus: text(r.focus, 120),
    rawHeadwordLiteralTargetAllowed: r.rawHeadwordLiteralTargetAllowed !== false,
    hazards: strings(r.hazards, 10).map(v => text(v, 160)),
    guidance: strings(r.guidance, 8).map(v => text(v, 420))
  };
}

function minimizeTargetPacket(packet) {
  const p = obj(packet);
  const target = obj(p.target);
  const evidence = obj(p.learnerEvidence);
  const profile = obj(p.learnerProfile);
  const study = obj(p.studyQHistory);
  return {
    schemaVersion: 1,
    target: {
      wordId: clean(target.wordId),
      headword: text(target.headword, 180),
      targetFamily: strings(target.targetFamily, 8),
      targetKind: clean(target.targetKind),
      entryType: clean(target.entryType),
      pos: text(target.pos, 120),
      definition: text(target.definition, 900),
      synonyms: text(target.synonyms, 500),
      examples: text(target.examples, 1000),
      notes: text(target.notes, 1000)
    },
    targetReadiness: minimizeTargetReadiness(p.targetReadiness),
    learningMetadata: minimizeLearningMetadata(p.learningMetadata),
    reviewProgress: minimizeReviewSignal(p.reviewProgress),
    studyQHistory: {
      summary: pick(study.summary, ['attemptCount', 'targetExactCount', 'targetHiddenExactCount', 'targetShownExactCount', 'targetUnknownVisibilityExactCount', 'targetHiddenAttemptCount', 'targetShownAttemptCount', 'targetUnknownVisibilityAttemptCount', 'totalHintCount', 'latestOutcome', 'latestResponse']),
      recentRawAttempts: arr(study.recentRawAttempts).slice(-2).map(a => ({
        promptKind: clean(a?.promptKind),
        response: text(a?.response, 420),
        autoMatch: clean(a?.autoMatch),
        selfRating: clean(a?.selfRating),
        hintCount: Number(a?.hintCount || 0),
        targetShown: Boolean(a?.targetShown)
      }))
    },
    learnerEvidence: {
      personalAnchors: arr(evidence.personalAnchors).slice(0, 3).map(minimizeAnchor),
      learnerGeneratedNeighbors: arr(evidence.learnerGeneratedNeighbors).slice(0, 5).map(minimizeNeighbor),
      observedConnections: arr(evidence.observedConnections).slice(0, 5).map(minimizeConnection),
      routeEvidence: arr(evidence.routeEvidence).slice(0, 6).map(item => ({
        type: clean(item?.type),
        observationCount: Number(item?.observationCount || 0),
        contexts: strings(item?.contexts, 4).map(v => text(v, 160))
      })).filter(item => item.type),
      weakOrFailedRoutes: arr(evidence.weakOrFailedRoutes).slice(0, 3).map(item => ({
        route: text(item?.route, 320),
        reason: text(item?.reason, 420),
        source: clean(item?.source)
      })),
      domains: arr(evidence.domains).slice(0, 5).map(item => pick(item, ['name', 'evidence'])),
      diagnosticExemplars: arr(evidence.diagnosticExemplars).slice(0, 3).map(minimizeDiagnostic),
      nextRouteHints: arr(evidence.nextRouteHints).slice(0, 3).map(item => pick(item, ['action', 'reason']))
    },
    learnerProfile: {
      relevantTendencies: arr(profile.relevantTendencies).slice(0, 3).map(minimizeTendency),
      reusableConstructions: arr(profile.reusableConstructions).slice(0, 3).map(minimizeConstruction)
    },
    aiStudyHistory: {
      recentMeaningfulEvents: arr(p.aiStudyHistory?.recentMeaningfulEvents).slice(-3).map(minimizeAIEvent)
    },
    antiRote: {
      recentExperiences: arr(p.antiRote?.recentExperiences).slice(-6).map(item => ({
        target: text(item?.target, 180),
        domain: text(item?.domain, 160),
        direction: clean(item?.direction),
        type: clean(item?.type),
        targetVisibility: clean(item?.targetVisibility),
        promptSignature: text(item?.promptSignature, 240)
      })),
      recentDomains: strings(p.antiRote?.recentDomains, 8),
      recentDirections: strings(p.antiRote?.recentDirections, 8),
      recentPromptTypes: strings(p.antiRote?.recentPromptTypes, 8),
      targetVisibilityHistory: strings(p.antiRote?.targetVisibilityHistory, 8)
    }
  };
}

function minimizePlannerPayload(payload) {
  const p = obj(payload);
  const state = obj(p.learnerSessionState);
  const candidate = obj(p.candidateContext);
  return {
    schemaVersion: 1,
    contract: 'planner-writer-v1.request',
    requestId: clean(p.requestId),
    session: {
      sessionId: clean(p.session?.sessionId),
      mode: 'ai-study',
      sourceMode: clean(p.session?.sourceMode),
      difficulty: clean(p.session?.difficulty || 'adaptive')
    },
    learnerSessionState: {
      recentDomains: strings(state.recentDomains, 8),
      recentDirections: strings(state.recentDirections, 8),
      recentPromptTypes: strings(state.recentPromptTypes || state.recentExperienceTypes, 8),
      targetVisibilityHistory: strings(state.targetVisibilityHistory || state.recentTargetVisibility, 8),
      recentExperiences: arr(state.recentExperiences).slice(-6).map(item => ({
        target: text(item?.target, 180),
        domain: text(item?.domain, 160),
        direction: clean(item?.direction),
        type: clean(item?.type),
        targetVisibility: clean(item?.targetVisibility),
        promptSignature: text(item?.promptSignature, 240)
      }))
    },
    candidateContext: {
      candidates: arr(candidate.candidates).slice(0, 30).map(minimizeCandidate)
    },
    targetPackets: arr(p.targetPackets).slice(0, 3).map(minimizeTargetPacket),
    plannerConstraints: pick(p.plannerConstraints, ['maxTargets', 'allowMultiTarget', 'avoidRecentRouteRepetition', 'naturalnessGateRequired', 'targetNeedNotBeExplicit', 'experienceTypeMode', 'requiredExperienceType'])
  };
}

function minimizeInterpreterPayload(payload, eventId) {
  const p = obj(payload);
  const target = obj(p.target);
  const lr = obj(p.learnerResponse);
  const state = obj(p.relevantState);
  const graph = obj(state.graph);
  const profile = obj(state.learnerProfile);
  return {
    schemaVersion: 1,
    contract: 'interpreter-router-v1.request',
    requestId: clean(p.requestId),
    session: { sessionId: clean(p.session?.sessionId) },
    target: {
      wordId: clean(target.wordId),
      headword: text(target.headword || target.target, 180),
      targetFamily: strings(target.targetFamily, 8),
      pos: text(target.pos, 120)
    },
    learningOpportunity: clone(p.learningOpportunity || null),
    experience: minimizeExperience(p.experience),
    learnerResponse: {
      rawTranscript: text(lr.rawTranscript, 1200),
      correctedTranscript: text(lr.correctedTranscript, 1200),
      authoritativeResponse: text(lr.authoritativeResponse || lr.correctedTranscript || lr.rawTranscript, 1200),
      inputMode: clean(lr.inputMode),
      sttCorrectedByLearner: Boolean(lr.sttCorrectedByLearner)
    },
    relevantState: {
      graph: {
        personalAnchors: arr(graph.personalAnchors).slice(0, 3).map(minimizeAnchor),
        learnerGeneratedNeighbors: arr(graph.learnerGeneratedNeighbors).slice(0, 5).map(minimizeNeighbor),
        relevantExistingEdges: arr(graph.relevantExistingEdges).slice(0, 5).map(minimizeConnection),
        weakOrFailedRoutes: arr(graph.weakOrFailedRoutes).slice(0, 3).map(item => ({
          route: text(item?.route, 320),
          reason: text(item?.reason, 420),
          source: clean(item?.source)
        }))
      },
      learnerProfile: {
        relevantTendencies: arr(profile.relevantTendencies).slice(0, 3).map(minimizeTendency),
        reusableConstructions: arr(profile.reusableConstructions).slice(0, 3).map(minimizeConstruction)
      },
      recentEvidence: arr(state.recentEvidence).slice(-3).map(minimizeAIEvent)
    },
    eventId: clean(eventId)
  };
}

function minimizeOutbound(kind, payload, eventId) {
  if (kind === 'planner') return minimizePlannerPayload(payload);
  if (kind === 'interpreter') return minimizeInterpreterPayload(payload, eventId);
  throw new Error(`Unsupported outbound kind: ${kind}`);
}

function operationalInstructions(kind) {
  if (kind === 'planner') {
    return `Create one WLP learning experience from the supplied minimal context. Ground it in a meaningful situation, concept, procedure, terminology, or discourse move. The target may be elicited, but it must have a real communicative reason to be used, not merely be possible. Keep message core, communicative focus, and usage motivation aligned. Distinguish three separate judgments: targetNaturalness = whether the expression fits idiomatically in this exact experience; motivationStrength = whether this situation gives the target a meaningful communicative job; targetCommonness = whether it is a default/common choice in this register and situation. A target may be strongly motivated while still less-common-but-natural. If commoner natural alternatives exist, list them and do not mark the target required. acceptableSemanticTerritory should describe meanings/construals, not target-containing model answers. anticipatedNaturalAlternatives may include natural ways to express the same message in the scenario. Also populate experience.intendedExample with exactly one concise, natural, complete response you had in mind while composing this Experience. intendedExample is hidden until after the learner responds: it is a post-response reference example, NOT an answer key, NOT required wording, and must never be copied into or leaked by the prompt, hints, acceptableSemanticTerritory, or other pre-answer scaffolding. It should normally demonstrate the selected target or the grammatically appropriate target-family/construction form for the one sense chosen in this turn. For fixed-frame/cloze, intendedExample must be the complete filled sentence, not just the slot. For sentence-reconstruction, intendedExample must be the correctly ordered complete sentence. For open tasks, it must be one natural complete response that genuinely satisfies the task. Do not narrow acceptable answers or mark natural alternatives wrong merely because they differ from intendedExample. Explicitly mark responseConstraint as open or fixed-frame. For open responses, responseFrame must be empty and frameCompatibleAlternatives must be empty. For fixed-frame responses, responseFrame must contain exactly one {answer} placeholder; silently substitute the target and every frameCompatibleAlternatives item into that exact frame and verify the full result is grammatical, idiomatic, and pragmatically natural. frameCompatibleAlternatives must be only the subset of anticipatedNaturalAlternatives that works without changing any other words in the frame. If a common natural alternative needs different syntax, keep it as a broader anticipated/commoner alternative but do not call it frame-compatible. If the frame would artificially exclude important natural alternatives, prefer an open response instead. Set frameCompatibilityVerified true only after this check. Respect natural alternatives and existing learner language. Avoid cosmetic repetition of recent routes. Complex Target Readiness: each target packet may include deterministic targetReadiness metadata from WLP. Treat it as authoritative mapping guidance, not optional prose. status describes whether the card is ready, needs deterministic normalization, or should be skipped for review; handling describes how to use the safe practice units. rawHeadword may be an editorial/search label rather than literal learner language. When status=normalize, use primaryTarget/practiceUnits and ignore lookup residue, source-language glosses, or editorial labels. When handling=form-family, choose one grammatically appropriate form for selectedTarget.target and one turn; never require every form at once. When handling=variant, accept natural spelling/capitalization/presentation variants as equivalent rather than testing them as separate concepts. When handling=alternative-expression, choose one natural construction/expression for the current task unless the experience explicitly compares alternatives; never select the literal slash-joined label. When handling=contrast, selectedTarget.target must be one practiceable side; the experience may compare both expressions, but never use the literal “X vs Y” label as the target. When handling=labeled, the editorial label is metadata, not part of learner language. When handling=construction, preserve the variable-slot/constructional relationship rather than reducing the card to an isolated content word. When senseSelectionRequired=true, choose exactly one POS/sense for this turn and keep prompt, expected form, and feedback aligned to that choice. sentence-expression handling may legitimately practice the full pragmatic expression, including a natural question. status=review means deterministic cleanup could not establish a safe English/Latin-script practice unit: prefer another candidate and never invent a target. Practice Type Override: plannerConstraints.experienceTypeMode is either adaptive or override. When it is override, experience.type MUST exactly equal plannerConstraints.requiredExperienceType; choose the supplied target that makes that requested format most pedagogically natural, and never silently substitute another type. Naturalness and communicative motivation remain mandatory even under an override. Difficulty / Study Options: read session.difficulty as one of adaptive, easy, standard, hard, or hell. Difficulty changes scaffolding and production demand, never the basic requirement that the task remain fair, idiomatic, and communicatively meaningful. easy = clear concrete context, stronger semantic support, shorter/simple response demands, and no deliberate distractors; standard = normal retrieval/production demand with enough context to solve the task without giving away the answer; hard = weaker cueing, closer natural competitors, less familiar transfer, and stronger construction/form control without trick wording; hell = maximum fair difficulty, sparse cueing, cross-domain or cross-sense transfer when natural, competing plausible options, inflection/conjugation or construction control when useful, and minimal scaffolding. Do not use obscure trivia or arbitrary traps just to make a task hard. When session.difficulty=adaptive, normally generate around standard; move easier when current evidence shows unresolved form/sense problems, move harder only when recent evidence supports it, and do not choose hell automatically unless the supplied learner state shows repeated strong control. Treat the experience types distinctly: cloze MUST use responseConstraint=fixed-frame and a natural responseFrame with exactly one {answer}; open-description should invite a genuine description or explanation; dialogue should create a short conversational exchange; contrast should require an explicit distinction between the target and a close natural neighbor/alternative; reformulation should provide wording or meaning to rewrite more naturally or precisely; micro-story should ground the task in a compact story-like context; situational-production should elicit a natural utterance in a concrete situation; free-composition should require a complete sentence or short passage with minimal direct lexical prompting rather than merely asking for one named word; reverse-reconstruction should rebuild language from an intended meaning, effect, or outcome; sentence-reconstruction should make the learner reorder visible chunks into one natural complete sentence; continuation should ask the learner to continue a sentence, thought, or exchange naturally. For sentence-reconstruction specifically: set experience.type=sentence-reconstruction, targetVisibility=visible, responseMode=reconstruction, responseConstraint=open, responseFrame='', frameCompatibleAlternatives=[], and frameCompatibilityVerified=true. Put the learner-facing situation/instruction first. Then append hidden reconstruction metadata lines in this exact format: RECONSTRUCTION_LEVEL: easy|standard|hard|hell; RECONSTRUCTION_UNITS: required chunks separated by ||; optionally RECONSTRUCTION_DISTRACTORS: distractor chunks separated by ||; and RECONSTRUCTION_MISSING_REQUIRED: true|false. These metadata lines are parsed by WLP and are not shown as the task text. RECONSTRUCTION_UNITS is mandatory for every sentence-reconstruction response and must contain at least 3 and at most 12 nonempty ||-separated required chunks. Never omit this line, never replace it with bullets/JSON/commas, and never put distractors on the RECONSTRUCTION_UNITS line. Difficulty rules for sentence-reconstruction: easy = 4-6 large meaning chunks, normal capitalization/punctuation clues allowed, every chunk required, no distractors, no missing word; standard = 6-9 smaller chunks, reduce obvious sentence-initial capitalization clues where doing so does not damage proper nouns or the pronoun I, every chunk required, no distractors, no missing word; hard = 8-12 smaller chunks plus 1-2 plausible distractor chunks, no missing word, avoid capitalization giving away the first chunk; hell = 6-10 required chunks plus 1-3 plausible distractors and exactly one learner-supplied missing word or inflected form, preferably a construction-critical item or a target-family form when that creates a fair conjugation/inflection challenge. In hell, omit that one item from RECONSTRUCTION_UNITS and set RECONSTRUCTION_MISSING_REQUIRED: true; the visible Target chip may still show the lemma/family. For easy/standard set RECONSTRUCTION_MISSING_REQUIRED: false and do not include distractors. For hard set it false. For hell, do not print or reveal the missing answer anywhere. Punctuation should stay attached to a neighboring chunk. Required chunks plus the learner-supplied item, when applicable, must support one clearly natural sentence. Distractors must be plausible enough to require thought but clearly unnecessary or wrong in the intended sentence. Do not place the correct ordered sentence anywhere in the prompt. When experienceTypeMode is adaptive, choose the experience type that best serves the learner route and avoid unnecessary repetition. Before returning, silently proofread spelling, grammar, idiomatic wording, scenario coherence, and realistic human use; remove awkward or nonstandard phrasing without flattening a precise but less-common target into a generic alternative. Do not invent timestamps or system metadata. Return only JSON matching the response schema and preserve requestId/sessionId.`;
  }
  return `Interpret the learner response as evidence, not binary right/wrong. Use authoritativeResponse when STT was corrected. Distinguish target, target family, natural neighbor/alternative, form or sense issues, and communicative-focus shifts. For fixed-frame experiences, interpret the learner's answer inside responseFrame: an expression can be a natural semantic alternative for the scenario yet still create a form mismatch in that exact frame. frameCompatibleAlternatives are direct slot-compatible alternatives; anticipatedNaturalAlternatives can be broader semantic alternatives that may require reframing. Evidence labels must describe what the learner actually demonstrated in this turn, not what the router plans to teach next and not what a route patch stores. A hidden target does not automatically make production spontaneous. Use cue-based-retrieval for cloze, fixed-frame, direct situational/semantic prompts, or other explicit elicitation. Use spontaneous-production only when the expression emerges in an open free-composition route without direct lexical/semantic elicitation; never use it for cloze or fixed-frame tasks. Merely producing a natural neighbor or adding ADD_NEIGHBOR does not demonstrate neighbor-discrimination. Use neighbor-discrimination only when the learner actually performs an explicit contrast/discrimination task (for example a contrast experience or neighbor-to-target/target-to-neighbor route). ADD_NEIGHBOR and evidenceTypes are independent: save a useful learner-generated neighbor even when the evidence is only cue-based-retrieval. Do not punish a natural alternative or promote a learner tendency from weak/uncertain evidence. profilePromotionAllowed has a narrow meaning: it authorizes the Merge Engine to consider raising an existing learner-profile tendency above hypothesis confidence; it does not decide whether the current observation can be stored. A first observation may be proposed as an ADD_PROFILE_OBSERVATION/ADD_STYLE_OBSERVATION with suggestedConfidence=hypothesis while profilePromotionAllowed=false. If profilePatch.operations is empty, profilePromotionAllowed must be false. Set profilePromotionAllowed=true only when a profile patch explicitly requests supported or recurring confidence and the supplied relevant learner-profile evidence already shows corroboration across distinct targets, contexts, and sessions: before a supported proposal, prior counts should be at least 1/1/1; before recurring, at least 2/2/2. The Merge Engine independently rechecks final evidence counts after adding the current observation, so never assume the requested promotion will be granted. Return additive patch proposals only. Every patch operation must include a meaningful action-specific payload; never emit an empty payload. In particular, ADD_NEIGHBOR must include expression, relationship, and source. Use source=learner-generated only when that exact expression is actually present in authoritativeResponse; otherwise use another accurate provenance. ADD_CONNECTION/STRENGTHEN_CONNECTION/ADD_EVIDENCE must include from, to, and direction; ADD_PERSONAL_ANCHOR must include value or anchor plus source; ADD_FAILED_ROUTE must include route and reason; ADD_DOMAIN must include name or domain. If a natural learner-produced alternative is useful as a durable route, propose ADD_NEIGHBOR for that exact expression. choose a useful router action or PAUSE. learnerFacingResponse.suggestedNaturalForm is a correction field only: when correctionNeeded is false it must be null, and target bridges/contrasts belong in feedback/router instead. When correctionNeeded is true, provide a concrete natural form. For every turn, populate learnerFacingResponse.targetFeedback, learnerFacingResponse.languageFeedback, and learnerFacingResponse.nextStep in addition to the legacy feedback field. targetFeedback should explain the target expression, relevant target-family/neighbor distinctions, construction/collocation, sense, or naturalness that mattered in this specific experience. experience.intendedExample, when present, is only the Planner's hidden reference example from Call A; never use similarity to that sentence as a correctness criterion. Judge the learner's authoritativeResponse independently on meaning, grammar, idiomaticity, register, and task fit. A learner response may be fully natural even when it is phrased very differently from intendedExample. When natural alternatives exist, avoid absolute wording such as “the natural expression,” “the ideal word,” or “the only correct answer”; prefer wording such as “a very natural choice,” “a concise choice,” or a brief contrast that preserves the legitimacy of alternatives. languageFeedback must assess the learner's full authoritativeResponse as English rather than checking only the target: consider grammar, articles, tense/aspect, number, prepositions, word order, idiomaticity, tone/register, concision, and sentence packaging when relevant. Prioritize the one to three highest-value observations rather than praising a sentence too broadly or listing every possible edit. Explicitly distinguish (a) grammatical correctness, (b) grammatical-but-less-idiomatic wording, and (c) optional style/concision improvements when those distinctions matter. If a construction is possible but another is clearly more natural in this exact situation, say why briefly and give the better form. Do not call an answer fully natural merely because it is grammatical. Do not invent errors or force corrections; if the response is already natural and grammatically sound, say so briefly. For short one-word or fixed-frame answers, keep languageFeedback correspondingly brief. For sentence-reconstruction, treat the learner response as an assembled sentence from visible chunks: evaluate word order, chunk placement, construction, punctuation, and overall naturalness; successful work should normally record reverse-reconstruction evidence and, when demonstrated, form-control or construction-use. Do not label sentence-reconstruction as spontaneous-production merely because the final answer is a full sentence. For fixed-frame/cloze answers, make it explicit that the learner supplies only the slot: if surrounding words complete a construction, phrase the feedback like “In this frame, [answer] correctly completes the idiomatic construction [full construction]” rather than implying the learner should have typed the surrounding words. Also populate learnerFacingResponse.modelResponse with one concise natural model answer that fully satisfies the requested response format; this is an example, not the only correct answer. For cloze/fixed-frame, modelResponse must be the complete filled sentence, not just the slot. For dialogue, open-description, situational-production, reformulation, free-composition, micro-story, contrast, reverse-reconstruction, sentence-reconstruction, or continuation, modelResponse should be one natural complete response appropriate to that task. For sentence-reconstruction, modelResponse must be the correctly ordered complete sentence. When the learner response is already strong, modelResponse should, when genuinely useful, provide one concise additional natural option rather than merely echoing the learner or intendedExample. Do not force novelty: if no worthwhile alternative exists, a close model is acceptable. The UI may suppress modelResponse when it is effectively identical to the learner response or intendedExample. Also populate learnerFacingResponse.languageObservations with zero to three structured high-value observations from this turn. Each observation must use EXACTLY one category from grammar, articles, tense-aspect, number, prepositions, word-order, idiomaticity, tone-register, concision, sentence-packaging, or other; do not invent labels such as coordination, construction, wording, syntax, or collocation—map those ideas to the closest allowed category. assessment must be exactly strength or improve; summary must be short and concrete. Do not manufacture observations just to fill the array, and do not promote a one-turn observation into a stable learner trait. Before returning, verify every routePatch operation against its action-specific payload requirements. If an optional patch operation cannot be expressed with a valid payload, OMIT that operation instead of returning placeholder, empty, short, or wrong-typed fields. For ADD_DIAGNOSTIC_EXEMPLAR_CANDIDATE payload.retain must be a JSON boolean and reason must be a meaningful string of at least four characters. For ADD_FAILED_ROUTE, route and a meaningful reason of at least four characters are required. nextStep must be learner-facing and actionable, with no internal router labels or implementation language. A single language issue may be mentioned in languageFeedback without being promoted to a persistent learner tendency; profile promotion still requires corroborated evidence. Keep learner-facing feedback natural, silently proofread generated wording, and do not invent timestamps or system metadata. Return only JSON matching the response schema. Preserve requestId/sessionId/eventId.`;
}

function getProvider() {
  const provider = clean(process.env.WLP_AI_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  if (!['gemini', 'openai'].includes(provider)) return DEFAULT_PROVIDER;
  return provider;
}

function providerConfig(provider = getProvider()) {
  if (provider === 'openai') {
    return {
      provider,
      configured: Boolean(clean(process.env.OPENAI_API_KEY)),
      model: clean(process.env.WLP_AI_OPENAI_MODEL || process.env.WLP_AI_MODEL) || DEFAULT_OPENAI_MODEL
    };
  }
  return {
    provider: 'gemini',
    configured: Boolean(clean(process.env.GEMINI_API_KEY)),
    model: clean(process.env.WLP_AI_GEMINI_MODEL) || DEFAULT_GEMINI_MODEL
  };
}

function extractOpenAIOutputText(response) {
  const texts = [];
  const refusals = [];
  for (const item of arr(response?.output)) {
    for (const part of arr(item?.content)) {
      if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      if (part?.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal);
    }
  }
  return { text: texts.join('\n').trim(), refusal: refusals.join('\n').trim() };
}

function extractGeminiOutputText(response) {
  const texts = [];
  for (const candidate of arr(response?.candidates)) {
    for (const part of arr(candidate?.content?.parts)) {
      if (typeof part?.text === 'string') texts.push(part.text);
    }
  }
  return texts.join('\n').trim();
}

let plannerResponseSchemaExtended = null;
function plannerSchemaForRuntime() {
  if (plannerResponseSchemaExtended) return plannerResponseSchemaExtended;
  const schema = clone(plannerResponseSchema);
  const typeEnum = schema?.properties?.experience?.properties?.type?.enum;
  if (Array.isArray(typeEnum) && !typeEnum.includes('sentence-reconstruction')) typeEnum.push('sentence-reconstruction');
  plannerResponseSchemaExtended = schema;
  return plannerResponseSchemaExtended;
}

function responseSchemaFor(kind) {
  return kind === 'planner' ? plannerSchemaForRuntime() : interpreterResponseSchema;
}

function buildOpenAIRequest(kind, minimizedPayload) {
  const responseSchema = responseSchemaFor(kind);
  const schemaName = kind === 'planner' ? 'wlp_planner_writer_v1' : 'wlp_interpreter_router_v1';
  const maxOutputTokens = Number.parseInt(process.env.WLP_AI_MAX_OUTPUT_TOKENS || '8000', 10);
  return {
    model: providerConfig('openai').model,
    store: false,
    instructions: operationalInstructions(kind),
    input: JSON.stringify(minimizedPayload),
    max_output_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 8000,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        description: kind === 'planner' ? 'WLP Planner + Experience Writer response.' : 'WLP Interpreter + Router response.',
        schema: sanitizeSchemaForOpenAI(responseSchema),
        strict: false
      }
    }
  };
}

function buildGeminiRequest(kind, minimizedPayload) {
  const responseSchema = responseSchemaFor(kind);
  const maxOutputTokens = Number.parseInt(process.env.WLP_AI_MAX_OUTPUT_TOKENS || '8000', 10);
  return {
    systemInstruction: {
      parts: [{ text: operationalInstructions(kind) }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: JSON.stringify(minimizedPayload) }]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      // Use Gemini's JSON-Schema field rather than the legacy protobuf Schema field.
      // responseJsonSchema accepts JSON-Schema constructs used by our shared contract
      // (including nullable type arrays and numeric enums after const normalization).
      responseJsonSchema: sanitizeSchemaForGemini(responseSchema),
      maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 8000
    }
  };
}

async function callOpenAI(kind, minimizedPayload) {
  const config = providerConfig('openai');
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured on the server.');
    error.code = 'WLP_AI_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }
  const request = buildOpenAIRequest(kind, minimizedPayload);
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  let body;
  try { body = await response.json(); } catch (_) { body = null; }
  if (!response.ok) {
    throw normalizeProviderHttpError('openai', response, body);
  }
  const extracted = extractOpenAIOutputText(body);
  if (extracted.refusal && !extracted.text) {
    const error = new Error('The model declined to produce the requested learning contract output.');
    error.code = 'WLP_AI_PROVIDER_REFUSAL';
    error.statusCode = 422;
    throw error;
  }
  if (!extracted.text) {
    const error = new Error('OpenAI returned no text output.');
    error.code = 'WLP_AI_PROVIDER_EMPTY';
    error.statusCode = 502;
    throw error;
  }
  let result;
  try { result = JSON.parse(extracted.text); } catch (_) {
    const error = new Error('OpenAI returned output that could not be parsed as JSON.');
    error.code = 'WLP_AI_PROVIDER_BAD_JSON';
    error.statusCode = 502;
    throw error;
  }
  return {
    result,
    meta: { provider: 'openai', model: clean(body?.model || config.model), responseId: clean(body?.id), usage: body?.usage || null, stored: false, minimized: true }
  };
}

async function callGemini(kind, minimizedPayload) {
  const config = providerConfig('gemini');
  const apiKey = clean(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured on the server.');
    error.code = 'WLP_AI_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }
  const request = buildGeminiRequest(kind, minimizedPayload);
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(config.model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  let body;
  try { body = await response.json(); } catch (_) { body = null; }
  if (!response.ok) {
    throw normalizeProviderHttpError('gemini', response, body);
  }
  if (body?.promptFeedback?.blockReason) {
    const error = new Error(`Gemini blocked the prompt: ${clean(body.promptFeedback.blockReason)}`);
    error.code = 'WLP_AI_PROVIDER_REFUSAL';
    error.statusCode = 422;
    throw error;
  }
  const outputText = extractGeminiOutputText(body);
  if (!outputText) {
    const error = new Error('Gemini returned no text output.');
    error.code = 'WLP_AI_PROVIDER_EMPTY';
    error.statusCode = 502;
    throw error;
  }
  let result;
  try { result = JSON.parse(outputText); } catch (_) {
    const error = new Error('Gemini returned output that could not be parsed as JSON.');
    error.code = 'WLP_AI_PROVIDER_BAD_JSON';
    error.statusCode = 502;
    throw error;
  }
  return {
    result,
    meta: {
      provider: 'gemini',
      model: clean(body?.modelVersion || config.model),
      responseId: clean(body?.responseId),
      usage: body?.usageMetadata || null,
      minimized: true
    }
  };
}

function normalizePlannerExperienceContract(result) {
  const normalized = clone(result) || {};
  const experience = obj(normalized.experience);
  const type = clean(experience.type).toLowerCase();
  const frame = clean(experience.responseFrame);
  const placeholderCount = (frame.match(/\{answer\}/g) || []).length;
  // WLP defines cloze as a one-slot fixed-frame task. If a provider returns a
  // valid one-slot cloze frame but mislabels the response constraint, repair
  // only that metadata mismatch before the shared client contract validates it.
  if (type === 'cloze' && placeholderCount === 1) experience.responseConstraint = 'fixed-frame';
  // Provider outputs occasionally include a frame-compatible alternative that
  // was not also copied into anticipatedNaturalAlternatives. The shared
  // contract intentionally requires the former to be a subset of the latter.
  // Repair only this bookkeeping mismatch by keeping the verified intersection;
  // broader alternatives remain available through anticipatedNaturalAlternatives.
  if (clean(experience.responseConstraint).toLowerCase() === 'fixed-frame') {
    const anticipated = Array.isArray(experience.anticipatedNaturalAlternatives) ? experience.anticipatedNaturalAlternatives : [];
    const allowed = new Set(anticipated.map(item => clean(item).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
    if (Array.isArray(experience.frameCompatibleAlternatives)) {
      experience.frameCompatibleAlternatives = experience.frameCompatibleAlternatives.filter(item => allowed.has(clean(item).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')));
    }
  }
  if (type === 'sentence-reconstruction') {
    experience.targetVisibility = 'visible';
    experience.responseMode = 'reconstruction';
    experience.responseConstraint = 'open';
    experience.responseFrame = '';
    experience.frameCompatibleAlternatives = [];
    experience.frameCompatibilityVerified = true;
  }
  normalized.experience = experience;
  return normalized;
}

function normalizeInterpreterContract(result) {
  const normalized = clone(result) || {};
  const routePatch = obj(normalized.routePatch);
  const allowedSources = new Set(['learner-generated','learner-confirmed','wlp-source','ai-suggested','ai-inferred','experiment-observed']);
  const validRouteOperation = item => {
    if (!item || typeof item !== 'object') return null;
    const action = clean(item.action);
    const payload = obj(item.payload);
    if (action === 'ADD_DIAGNOSTIC_EXEMPLAR_CANDIDATE') {
      if (typeof payload.retain !== 'boolean') {
        const raw = clean(payload.retain).toLowerCase();
        if (raw === 'true') payload.retain = true;
        else if (raw === 'false') payload.retain = false;
      }
      if (typeof payload.retain !== 'boolean' || clean(payload.reason).length < 4) return null;
    } else if (action === 'ADD_FAILED_ROUTE') {
      if (!clean(payload.route) || clean(payload.reason).length < 4) return null;
    } else if (action === 'ADD_NEIGHBOR') {
      if (!clean(payload.expression) || clean(payload.relationship).length < 4 || !allowedSources.has(clean(payload.source))) return null;
    } else if (action === 'ADD_PERSONAL_ANCHOR') {
      if (!(clean(payload.value) || clean(payload.anchor)) || !allowedSources.has(clean(payload.source))) return null;
    } else if (['ADD_CONNECTION','STRENGTHEN_CONNECTION','ADD_EVIDENCE'].includes(action)) {
      if (!clean(payload.from) || !clean(payload.to) || !clean(payload.direction)) return null;
    } else if (action === 'ADD_DOMAIN') {
      if (!(clean(payload.name) || clean(payload.domain))) return null;
    } else if (!['ADD_CONNECTION','STRENGTHEN_CONNECTION','ADD_EVIDENCE','ADD_NEIGHBOR','ADD_PERSONAL_ANCHOR','ADD_FAILED_ROUTE','ADD_DIAGNOSTIC_EXEMPLAR_CANDIDATE','ADD_DOMAIN'].includes(action)) {
      return null;
    }
    return { ...item, payload };
  };
  if (Array.isArray(routePatch.operations)) {
    routePatch.operations = routePatch.operations.map(validRouteOperation).filter(Boolean);
    normalized.routePatch = routePatch;
  }

  const learner = obj(normalized.learnerFacingResponse);
  if (Array.isArray(learner.languageObservations)) {
    const categoryAliases = {
      grammar: 'grammar', syntax: 'grammar', agreement: 'grammar',
      article: 'articles', articles: 'articles', determiner: 'articles', determiners: 'articles',
      tense: 'tense-aspect', aspect: 'tense-aspect', 'tense-aspect': 'tense-aspect', tenseaspect: 'tense-aspect',
      number: 'number', plurality: 'number',
      preposition: 'prepositions', prepositions: 'prepositions',
      'word-order': 'word-order', 'word order': 'word-order', wordorder: 'word-order',
      wording: 'idiomaticity', 'word-choice': 'idiomaticity', 'word choice': 'idiomaticity', collocation: 'idiomaticity', idiomaticity: 'idiomaticity',
      tone: 'tone-register', register: 'tone-register', 'tone-register': 'tone-register',
      concision: 'concision', redundancy: 'concision',
      coordination: 'sentence-packaging', construction: 'sentence-packaging', 'sentence-structure': 'sentence-packaging', 'sentence structure': 'sentence-packaging', 'sentence-packaging': 'sentence-packaging', packaging: 'sentence-packaging',
      other: 'other'
    };
    learner.languageObservations = learner.languageObservations.slice(0, 3).map(item => {
      if (!item || typeof item !== 'object') return null;
      const rawCategory = clean(item.category).normalize('NFKC').toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
      const category = categoryAliases[rawCategory] || 'other';
      const rawAssessment = clean(item.assessment).toLowerCase();
      const assessment = rawAssessment === 'strength' ? 'strength' : rawAssessment === 'improve' ? 'improve' : null;
      const summary = clean(item.summary);
      if (!assessment || summary.length < 4) return null;
      return { category, assessment, summary };
    }).filter(Boolean);
    normalized.learnerFacingResponse = learner;
  }
  return normalized;
}

function finalizeProviderOutput(kind, output) {
  let result = clone(output?.result) || {};
  if (kind === 'planner') result = normalizePlannerExperienceContract(result);
  if (kind === 'interpreter') result = normalizeInterpreterContract(result);
  // Provider-generated timestamps are not trusted system metadata.
  // Keep response content provider-authored, but attach timing server-side.
  if (kind === 'planner' || kind === 'interpreter') delete result.generatedAt;
  return {
    result,
    meta: {
      ...obj(output?.meta),
      receivedAt: new Date().toISOString()
    }
  };
}

async function callProvider(kind, payload, eventId) {
  const minimizedPayload = minimizeOutbound(kind, payload, eventId);
  const provider = getProvider();
  const output = provider === 'openai'
    ? await callOpenAI(kind, minimizedPayload)
    : await callGemini(kind, minimizedPayload);
  return finalizeProviderOutput(kind, output);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });

  const rawBody = event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'AI Study request is too large.' } });
  }

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (_) {
    return json(400, { ok: false, error: { code: 'BAD_JSON', message: 'Request body must be valid JSON.' } });
  }

  const envelopeError = validateEnvelope(body);
  if (envelopeError) return json(400, { ok: false, error: { code: 'BAD_REQUEST', message: envelopeError } });

  if (body.kind === 'health') {
    const config = providerConfig();
    return json(200, {
      ok: true,
      service: 'wlp-ai-study',
      schemaVersion: 1,
      provider: config.provider,
      configured: config.configured,
      model: config.model,
      privacyMinimizer: 'v1.1',
      providerSwitching: 'server-config',
      providerErrorNormalization: 'v2'
    });
  }

  if (body.kind === 'preview') {
    const previewKind = clean(body.previewKind);
    return json(200, {
      ok: true,
      kind: previewKind,
      provider: getProvider(),
      minimized: true,
      outbound: minimizeOutbound(previewKind, body.payload, clean(body.eventId))
    });
  }

  try {
    const output = await callProvider(body.kind, body.payload, clean(body.eventId));
    return json(200, { ok: true, kind: body.kind, result: output.result, meta: output.meta });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(statusCode, {
      ok: false,
      error: {
        code: clean(error?.code) || 'WLP_AI_SERVER_ERROR',
        message: clean(error?.message) || 'AI Study server error.',
        provider: clean(error?.provider),
        providerHttpStatus: Number(error?.providerHttpStatus) || null,
        providerCode: clean(error?.providerCode),
        retryAfterMs: typeof error?.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null,
        retryable: error?.retryable === true,
        quotaScope: clean(error?.quotaScope) || 'none',
        resetPolicy: clean(error?.resetPolicy)
      }
    });
  }
};

exports._test = Object.freeze({
  sanitizeSchemaForOpenAI,
  sanitizeSchemaForGemini,
  validateEnvelope,
  minimizeOutbound,
  minimizePlannerPayload,
  minimizeInterpreterPayload,
  operationalInstructions,
  getProvider,
  providerConfig,
  extractOpenAIOutputText,
  extractGeminiOutputText,
  buildOpenAIRequest,
  buildGeminiRequest,
  finalizeProviderOutput,
  parseRetryDelayMs,
  retryDelayFromMessage,
  retryAfterMsFromProvider,
  providerQuotaInspectionText,
  quotaScopeFromProvider,
  normalizeProviderHttpError,
  normalizePlannerExperienceContract
});
