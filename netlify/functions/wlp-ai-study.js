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
    plannerConstraints: pick(p.plannerConstraints, ['maxTargets', 'allowMultiTarget', 'avoidRecentRouteRepetition', 'naturalnessGateRequired', 'targetNeedNotBeExplicit'])
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
    return `Create one WLP learning experience from the supplied minimal context. Ground it in a meaningful situation, concept, procedure, terminology, or discourse move. The target may be elicited, but it must have a real communicative reason to be used, not merely be possible. Keep message core, communicative focus, and usage motivation aligned. Distinguish three separate judgments: targetNaturalness = whether the expression fits idiomatically in this exact experience; motivationStrength = whether this situation gives the target a meaningful communicative job; targetCommonness = whether it is a default/common choice in this register and situation. A target may be strongly motivated while still less-common-but-natural. If commoner natural alternatives exist, list them and do not mark the target required. acceptableSemanticTerritory should describe meanings/construals, not target-containing model answers. anticipatedNaturalAlternatives may include natural ways to express the same message in the scenario. Explicitly mark responseConstraint as open or fixed-frame. For open responses, responseFrame must be empty and frameCompatibleAlternatives must be empty. For fixed-frame responses, responseFrame must contain exactly one {answer} placeholder; silently substitute the target and every frameCompatibleAlternatives item into that exact frame and verify the full result is grammatical, idiomatic, and pragmatically natural. frameCompatibleAlternatives must be only the subset of anticipatedNaturalAlternatives that works without changing any other words in the frame. If a common natural alternative needs different syntax, keep it as a broader anticipated/commoner alternative but do not call it frame-compatible. If the frame would artificially exclude important natural alternatives, prefer an open response instead. Set frameCompatibilityVerified true only after this check. Respect natural alternatives and existing learner language. Avoid cosmetic repetition of recent routes. Before returning, silently proofread spelling, grammar, idiomatic wording, scenario coherence, and realistic human use; remove awkward or nonstandard phrasing without flattening a precise but less-common target into a generic alternative. Do not invent timestamps or system metadata. Return only JSON matching the response schema and preserve requestId/sessionId.`;
  }
  return `Interpret the learner response as evidence, not binary right/wrong. Use authoritativeResponse when STT was corrected. Distinguish target, target family, natural neighbor/alternative, form or sense issues, and communicative-focus shifts. For fixed-frame experiences, interpret the learner's answer inside responseFrame: an expression can be a natural semantic alternative for the scenario yet still create a form mismatch in that exact frame. frameCompatibleAlternatives are direct slot-compatible alternatives; anticipatedNaturalAlternatives can be broader semantic alternatives that may require reframing. Evidence labels must describe what the learner actually demonstrated in this turn, not what the router plans to teach next and not what a route patch stores. A hidden target does not automatically make production spontaneous. Use cue-based-retrieval for cloze, fixed-frame, direct situational/semantic prompts, or other explicit elicitation. Use spontaneous-production only when the expression emerges in an open free-composition route without direct lexical/semantic elicitation; never use it for cloze or fixed-frame tasks. Merely producing a natural neighbor or adding ADD_NEIGHBOR does not demonstrate neighbor-discrimination. Use neighbor-discrimination only when the learner actually performs an explicit contrast/discrimination task (for example a contrast experience or neighbor-to-target/target-to-neighbor route). ADD_NEIGHBOR and evidenceTypes are independent: save a useful learner-generated neighbor even when the evidence is only cue-based-retrieval. Do not punish a natural alternative or promote a learner tendency from weak/uncertain evidence. profilePromotionAllowed has a narrow meaning: it authorizes the Merge Engine to consider raising an existing learner-profile tendency above hypothesis confidence; it does not decide whether the current observation can be stored. A first observation may be proposed as an ADD_PROFILE_OBSERVATION/ADD_STYLE_OBSERVATION with suggestedConfidence=hypothesis while profilePromotionAllowed=false. If profilePatch.operations is empty, profilePromotionAllowed must be false. Set profilePromotionAllowed=true only when a profile patch explicitly requests supported or recurring confidence and the supplied relevant learner-profile evidence already shows corroboration across distinct targets, contexts, and sessions: before a supported proposal, prior counts should be at least 1/1/1; before recurring, at least 2/2/2. The Merge Engine independently rechecks final evidence counts after adding the current observation, so never assume the requested promotion will be granted. Return additive patch proposals only. Every patch operation must include a meaningful action-specific payload; never emit an empty payload. In particular, ADD_NEIGHBOR must include expression, relationship, and source. Use source=learner-generated only when that exact expression is actually present in authoritativeResponse; otherwise use another accurate provenance. ADD_CONNECTION/STRENGTHEN_CONNECTION/ADD_EVIDENCE must include from, to, and direction; ADD_PERSONAL_ANCHOR must include value or anchor plus source; ADD_FAILED_ROUTE must include route and reason; ADD_DOMAIN must include name or domain. If a natural learner-produced alternative is useful as a durable route, propose ADD_NEIGHBOR for that exact expression. choose a useful router action or PAUSE. learnerFacingResponse.suggestedNaturalForm is a correction field only: when correctionNeeded is false it must be null, and target bridges/contrasts belong in feedback/router instead. When correctionNeeded is true, provide a concrete natural form. Keep learner-facing feedback natural, silently proofread generated wording, and do not invent timestamps or system metadata. Return only JSON matching the response schema. Preserve requestId/sessionId/eventId.`;
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

function responseSchemaFor(kind) {
  return kind === 'planner' ? plannerResponseSchema : interpreterResponseSchema;
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
    const error = new Error(clean(body?.error?.message) || `OpenAI API returned HTTP ${response.status}`);
    error.code = clean(body?.error?.code) || 'WLP_AI_PROVIDER_ERROR';
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
    throw error;
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
    const error = new Error(clean(body?.error?.message) || `Gemini API returned HTTP ${response.status}`);
    error.code = clean(body?.error?.status) || 'WLP_AI_PROVIDER_ERROR';
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
    throw error;
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

function finalizeProviderOutput(kind, output) {
  const result = clone(output?.result) || {};
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
      providerSwitching: 'server-config'
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
        message: clean(error?.message) || 'AI Study server error.'
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
  finalizeProviderOutput
});
