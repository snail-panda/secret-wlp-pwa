(() => {
  'use strict';

  const VERSION = '1.1.1';

  const ENUMS = Object.freeze({
    groundingModes: ['experiential','situational','conceptual','procedural','terminological','contrastive','discourse'],
    directions: ['world-to-expression','expression-to-world','concept-to-expression','expression-to-concept','message-to-expression','expression-to-message','neighbor-to-target','target-to-neighbor','cross-domain-transfer','cross-sense-transfer','free-composition'],
    experienceTypes: ['situational-production','reverse-reconstruction','open-description','dialogue','micro-story','contrast','continuation','cloze','reformulation','free-composition','multi-expression-composition'],
    targetVisibility: ['hidden','visible','partial'],
    responseConstraints: ['open','fixed-frame'],
    motivationStrength: ['weak','natural','strong'],
    targetNaturalness: ['merely-possible','natural','highly-natural'],
    targetCommonness: ['default-common','common','less-common-but-natural','specialized-or-marked'],
    routerActions: ['DEEPEN','BRANCH','TRANSFER','CONTRAST','REVERSE','COMPOSE','PAUSE'],
    responseClasses: ['exact-target','target-family','natural-neighbor','natural-alternative','partial-concept','form-mismatch','sense-mismatch','register-mismatch','construal-shift','unrelated','uncertain','stt-uncertain'],
    focusRelations: ['aligned','overlapping','shifted','conflicting','unclear'],
    interpretationConfidence: ['low','medium','high'],
    evidenceTypes: ['recognition','cue-based-retrieval','spontaneous-production','context-transfer','sense-transfer','reverse-reconstruction','neighbor-discrimination','free-composition','personal-anchor','form-control','construction-use'],
    routePatchActions: ['ADD_EVIDENCE','ADD_CONNECTION','STRENGTHEN_CONNECTION','ADD_NEIGHBOR','ADD_PERSONAL_ANCHOR','ADD_FAILED_ROUTE','ADD_DIAGNOSTIC_EXEMPLAR_CANDIDATE','ADD_DOMAIN'],
    profilePatchActions: ['ADD_PROFILE_OBSERVATION','ADD_STYLE_OBSERVATION','ADD_CONSTRUCTION_EVIDENCE']
  });

  const SCHEMAS = Object.freeze({
    plannerRequest: './planner-writer-request-v1.schema.json',
    plannerResponse: './planner-writer-response-v1.schema.json',
    interpreterRequest: './interpreter-router-request-v1.schema.json',
    interpreterResponse: './interpreter-router-response-v1.schema.json'
  });

  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const asArray = value => Array.isArray(value) ? value : [];
  const text = value => String(value ?? '').trim();
  const norm = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const includesEnum = (value, allowed) => allowed.includes(value);
  const push = (list, path, message) => list.push({ path, message });
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const containsWholeExpression = (haystack, needle) => {
    const h = norm(haystack);
    const n = norm(needle);
    if (!h || !n) return false;
    const rx = new RegExp(`(^|[^a-z0-9])${escapeRegExp(n).replace(/ /g, '\\s+')}([^a-z0-9]|$)`, 'i');
    return rx.test(h);
  };

  function result(errors, warnings) {
    return {
      valid: errors.length === 0,
      status: errors.length ? 'REJECT' : warnings.length ? 'VALID_WITH_WARNINGS' : 'VALID',
      errors,
      warnings
    };
  }

  function requireObject(value, path, errors) {
    if (!isObject(value)) {
      push(errors, path, 'must be an object');
      return false;
    }
    return true;
  }

  function requireString(obj, key, path, errors, minLength = 1) {
    if (!has(obj, key) || typeof obj[key] !== 'string' || text(obj[key]).length < minLength) {
      push(errors, `${path}.${key}`, `must be a string with length >= ${minLength}`);
      return false;
    }
    return true;
  }

  function requireBoolean(obj, key, path, errors) {
    if (!has(obj, key) || typeof obj[key] !== 'boolean') {
      push(errors, `${path}.${key}`, 'must be boolean');
      return false;
    }
    return true;
  }

  function requireEnum(obj, key, allowed, path, errors) {
    if (!has(obj, key) || !includesEnum(obj[key], allowed)) {
      push(errors, `${path}.${key}`, `must be one of: ${allowed.join(', ')}`);
      return false;
    }
    return true;
  }

  function requireArray(obj, key, path, errors, minItems = 0) {
    if (!has(obj, key) || !Array.isArray(obj[key]) || obj[key].length < minItems) {
      push(errors, `${path}.${key}`, `must be an array with at least ${minItems} item(s)`);
      return false;
    }
    return true;
  }

  function checkEnvelope(value, expectedContract, errors) {
    if (!requireObject(value, '$', errors)) return false;
    if (value.schemaVersion !== 1) push(errors, '$.schemaVersion', 'must equal 1');
    if (value.contract !== expectedContract) push(errors, '$.contract', `must equal ${expectedContract}`);
    requireString(value, 'requestId', '$', errors);
    return errors.length === 0;
  }

  function validatePlannerRequest(value) {
    const errors = [], warnings = [];
    checkEnvelope(value, 'planner-writer-v1.request', errors);
    if (!isObject(value)) return result(errors, warnings);

    if (requireObject(value.session, '$.session', errors)) {
      requireString(value.session, 'sessionId', '$.session', errors);
      if (value.session.mode !== 'ai-study') push(errors, '$.session.mode', 'must equal ai-study');
      requireString(value.session, 'sourceMode', '$.session', errors);
      requireString(value.session, 'difficulty', '$.session', errors);
    }
    requireObject(value.learnerSessionState, '$.learnerSessionState', errors);
    if (requireObject(value.candidateContext, '$.candidateContext', errors)) {
      requireArray(value.candidateContext, 'candidates', '$.candidateContext', errors, 1);
      if (asArray(value.candidateContext.candidates).length > 30) push(errors, '$.candidateContext.candidates', 'must contain at most 30 candidates');
    }
    if (!Array.isArray(value.targetPackets) || value.targetPackets.length < 1 || value.targetPackets.length > 3) {
      push(errors, '$.targetPackets', 'must contain 1 to 3 target packets');
    }
    if (requireObject(value.plannerConstraints, '$.plannerConstraints', errors)) {
      if (!Number.isInteger(value.plannerConstraints.maxTargets) || value.plannerConstraints.maxTargets < 1 || value.plannerConstraints.maxTargets > 3) {
        push(errors, '$.plannerConstraints.maxTargets', 'must be an integer from 1 to 3');
      }
      requireBoolean(value.plannerConstraints, 'avoidRecentRouteRepetition', '$.plannerConstraints', errors);
      requireBoolean(value.plannerConstraints, 'naturalnessGateRequired', '$.plannerConstraints', errors);
      requireBoolean(value.plannerConstraints, 'targetNeedNotBeExplicit', '$.plannerConstraints', errors);
    }
    return result(errors, warnings);
  }

  function validatePlannerResponse(value) {
    const errors = [], warnings = [];
    checkEnvelope(value, 'planner-writer-v1.response', errors);
    if (!isObject(value)) return result(errors, warnings);
    requireString(value, 'sessionId', '$', errors);

    if (requireObject(value.selectedTarget, '$.selectedTarget', errors)) {
      requireString(value.selectedTarget, 'wordId', '$.selectedTarget', errors);
      requireString(value.selectedTarget, 'target', '$.selectedTarget', errors);
      if (has(value.selectedTarget, 'targetFamily') && !Array.isArray(value.selectedTarget.targetFamily)) push(errors, '$.selectedTarget.targetFamily', 'must be an array');
    }
    if (requireObject(value.learningOpportunity, '$.learningOpportunity', errors)) {
      requireEnum(value.learningOpportunity, 'direction', ENUMS.directions, '$.learningOpportunity', errors);
      requireString(value.learningOpportunity, 'goal', '$.learningOpportunity', errors, 12);
      requireString(value.learningOpportunity, 'whyNow', '$.learningOpportunity', errors, 8);
    }
    if (requireObject(value.experienceGrounding, '$.experienceGrounding', errors)) {
      requireEnum(value.experienceGrounding, 'mode', ENUMS.groundingModes, '$.experienceGrounding', errors);
      requireString(value.experienceGrounding, 'worldState', '$.experienceGrounding', errors, 20);
    }
    if (requireObject(value.messageCore, '$.messageCore', errors)) requireString(value.messageCore, 'summary', '$.messageCore', errors, 12);
    if (requireObject(value.communicativeFocus, '$.communicativeFocus', errors)) {
      requireString(value.communicativeFocus, 'foreground', '$.communicativeFocus', errors, 4);
      requireString(value.communicativeFocus, 'speakerIntent', '$.communicativeFocus', errors, 6);
    }
    if (requireObject(value.usageMotivation, '$.usageMotivation', errors)) {
      requireString(value.usageMotivation, 'communicativeNeed', '$.usageMotivation', errors, 10);
      requireString(value.usageMotivation, 'targetContribution', '$.usageMotivation', errors, 10);
      requireString(value.usageMotivation, 'whyThisExpressionNow', '$.usageMotivation', errors, 10);
      requireEnum(value.usageMotivation, 'motivationStrength', ENUMS.motivationStrength, '$.usageMotivation', errors);
    }
    if (requireObject(value.experience, '$.experience', errors)) {
      requireString(value.experience, 'experienceId', '$.experience', errors);
      requireEnum(value.experience, 'type', ENUMS.experienceTypes, '$.experience', errors);
      requireString(value.experience, 'domain', '$.experience', errors);
      requireEnum(value.experience, 'targetVisibility', ENUMS.targetVisibility, '$.experience', errors);
      requireString(value.experience, 'prompt', '$.experience', errors, 8);
      requireString(value.experience, 'responseMode', '$.experience', errors);
      requireEnum(value.experience, 'responseConstraint', ENUMS.responseConstraints, '$.experience', errors);
      if (!has(value.experience, 'responseFrame') || typeof value.experience.responseFrame !== 'string') push(errors, '$.experience.responseFrame', 'must be a string');
      requireArray(value.experience, 'anticipatedNaturalAlternatives', '$.experience', errors, 0);
      requireArray(value.experience, 'frameCompatibleAlternatives', '$.experience', errors, 0);
      requireBoolean(value.experience, 'frameCompatibilityVerified', '$.experience', errors);
    }
    if (requireObject(value.naturalnessCheck, '$.naturalnessCheck', errors)) {
      requireEnum(value.naturalnessCheck, 'targetNaturalness', ENUMS.targetNaturalness, '$.naturalnessCheck', errors);
      requireBoolean(value.naturalnessCheck, 'targetIsNaturalForExperience', '$.naturalnessCheck', errors);
      requireBoolean(value.naturalnessCheck, 'targetIsRequired', '$.naturalnessCheck', errors);
      requireEnum(value.naturalnessCheck, 'targetCommonness', ENUMS.targetCommonness, '$.naturalnessCheck', errors);
      requireArray(value.naturalnessCheck, 'commonerAlternatives', '$.naturalnessCheck', errors, 0);
    }
    if (requireObject(value.antiRoteCheck, '$.antiRoteCheck', errors)) {
      requireBoolean(value.antiRoteCheck, 'duplicatesRecentRoute', '$.antiRoteCheck', errors);
      requireBoolean(value.antiRoteCheck, 'duplicatesRecentFrame', '$.antiRoteCheck', errors);
    }

    if (!errors.length) {
      semanticPlannerChecks(value, errors, warnings);
    }
    return result(errors, warnings);
  }

  function semanticPlannerChecks(value, errors, warnings) {
    const target = norm(value.selectedTarget?.target);
    const family = [value.selectedTarget?.target, ...asArray(value.selectedTarget?.targetFamily)].map(norm).filter(Boolean);
    const goal = norm(value.learningOpportunity?.goal);
    const promptText = text(value.experience?.prompt);
    const prompt = norm(promptText);
    const direction = value.learningOpportunity?.direction;
    const type = value.experience?.type;
    const visibility = value.experience?.targetVisibility;
    const motivation = value.usageMotivation?.motivationStrength;
    const naturalness = value.naturalnessCheck?.targetNaturalness;
    const commonness = value.naturalnessCheck?.targetCommonness;
    const commonerAlternatives = asArray(value.naturalnessCheck?.commonerAlternatives).map(text).filter(Boolean);
    const anticipatedAlternatives = asArray(value.experience?.anticipatedNaturalAlternatives).map(text).filter(Boolean);
    const frameCompatibleAlternatives = asArray(value.experience?.frameCompatibleAlternatives).map(text).filter(Boolean);
    const responseConstraint = value.experience?.responseConstraint;
    const responseFrame = text(value.experience?.responseFrame);
    const frameCompatibilityVerified = value.experience?.frameCompatibilityVerified === true;
    const semanticTerritory = asArray(value.experience?.acceptableSemanticTerritory).map(text).filter(Boolean);

    const targetOnlyPatterns = [
      /\bmake (?:the )?learner (?:say|produce|use)\b/,
      /\bget (?:the )?learner to (?:say|produce|use)\b/,
      /\bforce (?:the )?learner to (?:say|produce|use)\b/,
      /\belicit (?:the )?(?:word|target|answer)\b/
    ];
    if (targetOnlyPatterns.some(rx => rx.test(goal))) {
      push(errors, '$.learningOpportunity.goal', 'target production is framed as the goal rather than a meaningful connection');
    }

    if (naturalness === 'merely-possible' || value.naturalnessCheck?.targetIsNaturalForExperience === false) {
      push(errors, '$.naturalnessCheck', 'target must be naturally licensed by the experience, not merely possible');
    }

    const productionDirections = new Set(['world-to-expression','concept-to-expression','message-to-expression','neighbor-to-target']);
    const exploratoryTypes = new Set(['contrast','reformulation','reverse-reconstruction']);
    const productionOriented = productionDirections.has(direction) && !exploratoryTypes.has(type);
    if (productionOriented && motivation !== 'strong') {
      push(warnings, '$.usageMotivation.motivationStrength', 'production-oriented experience should normally make the target strongly motivated by the situation/message');
    }

    if (visibility === 'hidden' && value.naturalnessCheck?.targetIsRequired === true && (commonerAlternatives.length || anticipatedAlternatives.length)) {
      push(errors, '$.naturalnessCheck.targetIsRequired', 'hidden production must not require the target when natural alternatives are explicitly recognized');
    }

    const clozeLikePrompt = /_{2,}|\[\s*(?:blank|answer)\s*\]|\{\s*answer\s*\}/i.test(promptText);
    if (clozeLikePrompt && responseConstraint !== 'fixed-frame') {
      push(errors, '$.experience.responseConstraint', 'cloze/fill-in prompts must declare fixed-frame response constraint');
    }
    if (responseConstraint === 'fixed-frame') {
      const answerMarkers = (responseFrame.match(/\{answer\}/g) || []).length;
      if (answerMarkers !== 1) {
        push(errors, '$.experience.responseFrame', 'fixed-frame responseFrame must contain exactly one {answer} placeholder');
      }
      if (!frameCompatibilityVerified) {
        push(errors, '$.experience.frameCompatibilityVerified', 'fixed-frame experience must explicitly verify target and direct alternatives against the exact response frame');
      }
      const anticipatedNorm = new Set(anticipatedAlternatives.map(norm));
      const nonSubset = frameCompatibleAlternatives.filter(item => !anticipatedNorm.has(norm(item)));
      if (nonSubset.length) {
        push(errors, '$.experience.frameCompatibleAlternatives', 'frame-compatible alternatives must be a subset of anticipatedNaturalAlternatives');
      }
      const targetInFrameAlternatives = frameCompatibleAlternatives.some(item => family.some(f => f && norm(item) === f));
      if (targetInFrameAlternatives) {
        push(warnings, '$.experience.frameCompatibleAlternatives', 'frameCompatibleAlternatives should list alternatives, not repeat the selected target');
      }
    } else if (responseConstraint === 'open') {
      if (responseFrame) push(errors, '$.experience.responseFrame', 'open response must use an empty responseFrame');
      if (frameCompatibleAlternatives.length) push(errors, '$.experience.frameCompatibleAlternatives', 'open response must leave frameCompatibleAlternatives empty');
      if (!frameCompatibilityVerified) push(errors, '$.experience.frameCompatibilityVerified', 'response constraint check must be verified before returning');
    }

    if (['less-common-but-natural','specialized-or-marked'].includes(commonness) && !commonerAlternatives.length) {
      push(warnings, '$.naturalnessCheck.commonerAlternatives', 'less-common or marked targets should list any commoner natural alternatives when they exist');
    }

    if (visibility === 'hidden' && target) {
      const leaked = family.some(item => item && containsWholeExpression(prompt, item));
      if (leaked) push(errors, '$.experience.prompt', 'hidden-target experience leaks the target or target family');

      const territoryUsesTarget = semanticTerritory.some(item => family.some(f => f && containsWholeExpression(item, f)));
      if (territoryUsesTarget) {
        push(warnings, '$.experience.acceptableSemanticTerritory', 'semantic territory should describe meanings/construals rather than target-containing model answers');
      }
    }

    if (productionOriented && visibility === 'hidden' && !semanticTerritory.length) {
      push(warnings, '$.experience.acceptableSemanticTerritory', 'hidden production should normally define semantic territory so natural alternatives can be interpreted fairly');
    }

    if (promptText.length > 900) {
      push(warnings, '$.experience.prompt', 'prompt is unusually long; prefer a compact, realistic experience unless detail is instructionally necessary');
    }
    if (/\s{3,}/.test(promptText) || /([!?.,])\1{2,}/.test(promptText)) {
      push(warnings, '$.experience.prompt', 'prompt contains suspicious spacing or repeated punctuation; proofread generated wording');
    }

    if (value.antiRoteCheck?.duplicatesRecentRoute && value.antiRoteCheck?.duplicatesRecentFrame) {
      push(errors, '$.antiRoteCheck', 'experience duplicates both a recent route and a recent frame');
    } else if (value.antiRoteCheck?.duplicatesRecentRoute || value.antiRoteCheck?.duplicatesRecentFrame) {
      push(warnings, '$.antiRoteCheck', 'experience partially overlaps recent study; verify the new connection is genuinely different');
    }
  }

  function validateInterpreterRequest(value) {
    const errors = [], warnings = [];
    checkEnvelope(value, 'interpreter-router-v1.request', errors);
    if (!isObject(value)) return result(errors, warnings);
    if (requireObject(value.session, '$.session', errors)) requireString(value.session, 'sessionId', '$.session', errors);
    if (requireObject(value.target, '$.target', errors)) {
      requireString(value.target, 'wordId', '$.target', errors);
      requireArray(value.target, 'targetFamily', '$.target', errors, 1);
    }
    if (!(value.learningOpportunity === null || isObject(value.learningOpportunity))) push(errors, '$.learningOpportunity', 'must be object or null');
    if (!(value.experience === null || isObject(value.experience))) push(errors, '$.experience', 'must be object or null');
    if (requireObject(value.learnerResponse, '$.learnerResponse', errors)) {
      ['rawTranscript','correctedTranscript','authoritativeResponse'].forEach(key => {
        if (typeof value.learnerResponse[key] !== 'string') push(errors, `$.learnerResponse.${key}`, 'must be string');
      });
      requireString(value.learnerResponse, 'inputMode', '$.learnerResponse', errors);
      requireBoolean(value.learnerResponse, 'sttCorrectedByLearner', '$.learnerResponse', errors);
      if (value.learnerResponse.correctedTranscript && value.learnerResponse.authoritativeResponse !== value.learnerResponse.correctedTranscript) {
        push(errors, '$.learnerResponse.authoritativeResponse', 'must equal correctedTranscript when a learner correction exists');
      }
    }
    requireObject(value.relevantState, '$.relevantState', errors);
    return result(errors, warnings);
  }

  function validateInterpreterResponse(value, requestContext = null) {
    const errors = [], warnings = [];
    checkEnvelope(value, 'interpreter-router-v1.response', errors);
    if (!isObject(value)) return result(errors, warnings);
    requireString(value, 'sessionId', '$', errors);
    requireString(value, 'eventId', '$', errors);

    if (requireObject(value.interpretation, '$.interpretation', errors)) {
      if (requireArray(value.interpretation, 'responseClasses', '$.interpretation', errors, 1)) {
        value.interpretation.responseClasses.forEach((item, i) => {
          if (!ENUMS.responseClasses.includes(item)) push(errors, `$.interpretation.responseClasses[${i}]`, 'unsupported response class');
        });
      }
      if (!(value.interpretation.conceptMatched === null || typeof value.interpretation.conceptMatched === 'boolean')) push(errors, '$.interpretation.conceptMatched', 'must be boolean or null');
      requireBoolean(value.interpretation, 'targetProduced', '$.interpretation', errors);
      requireBoolean(value.interpretation, 'targetFamilyReached', '$.interpretation', errors);
      requireEnum(value.interpretation, 'interpretationConfidence', ENUMS.interpretationConfidence, '$.interpretation', errors);
    }
    if (requireObject(value.communicativeInterpretation, '$.communicativeInterpretation', errors)) {
      if (!(value.communicativeInterpretation.messageCoreMatched === null || typeof value.communicativeInterpretation.messageCoreMatched === 'boolean')) push(errors, '$.communicativeInterpretation.messageCoreMatched', 'must be boolean or null');
      if (typeof value.communicativeInterpretation.learnerFocus !== 'string') push(errors, '$.communicativeInterpretation.learnerFocus', 'must be string');
      if (typeof value.communicativeInterpretation.experienceFocus !== 'string') push(errors, '$.communicativeInterpretation.experienceFocus', 'must be string');
      requireEnum(value.communicativeInterpretation, 'focusRelation', ENUMS.focusRelations, '$.communicativeInterpretation', errors);
      if (!(value.communicativeInterpretation.learnerExpressionNatural === null || typeof value.communicativeInterpretation.learnerExpressionNatural === 'boolean')) push(errors, '$.communicativeInterpretation.learnerExpressionNatural', 'must be boolean or null');
    }
    if (requireObject(value.evidence, '$.evidence', errors)) {
      if (requireArray(value.evidence, 'evidenceTypes', '$.evidence', errors, 0)) {
        value.evidence.evidenceTypes.forEach((item, i) => {
          if (!ENUMS.evidenceTypes.includes(item)) push(errors, `$.evidence.evidenceTypes[${i}]`, 'unsupported evidence type');
        });
      }
      requireString(value.evidence, 'observationSummary', '$.evidence', errors, 4);
      requireBoolean(value.evidence, 'profilePromotionAllowed', '$.evidence', errors);
    }
    validateOperations(value.routePatch, '$.routePatch', ENUMS.routePatchActions, errors);
    validateOperations(value.profilePatch, '$.profilePatch', ENUMS.profilePatchActions, errors);
    if (requireObject(value.diagnosticExemplarCandidate, '$.diagnosticExemplarCandidate', errors)) {
      requireBoolean(value.diagnosticExemplarCandidate, 'retain', '$.diagnosticExemplarCandidate', errors);
      if (typeof value.diagnosticExemplarCandidate.reason !== 'string') push(errors, '$.diagnosticExemplarCandidate.reason', 'must be string');
    }
    if (requireObject(value.router, '$.router', errors)) {
      requireEnum(value.router, 'action', ENUMS.routerActions, '$.router', errors);
      requireString(value.router, 'reason', '$.router', errors, 4);
    }
    if (requireObject(value.learnerFacingResponse, '$.learnerFacingResponse', errors)) {
      if (typeof value.learnerFacingResponse.feedback !== 'string') push(errors, '$.learnerFacingResponse.feedback', 'must be string');
      requireBoolean(value.learnerFacingResponse, 'correctionNeeded', '$.learnerFacingResponse', errors);
    }

    if (!errors.length) semanticInterpreterChecks(value, requestContext, errors, warnings);
    return result(errors, warnings);
  }

  function validateOperations(patch, path, allowed, errors) {
    if (!requireObject(patch, path, errors)) return;
    if (!requireArray(patch, 'operations', path, errors, 0)) return;
    patch.operations.forEach((op, index) => {
      const base = `${path}.operations[${index}]`;
      if (!isObject(op)) { push(errors, base, 'must be an object'); return; }
      if (!allowed.includes(op.action)) push(errors, `${base}.action`, `unsupported action: ${text(op.action)}`);
      if (!isObject(op.payload)) push(errors, `${base}.payload`, 'must be an object');
    });
  }

  function semanticInterpreterChecks(value, requestContext, errors, warnings) {
    const classes = new Set(asArray(value.interpretation?.responseClasses));
    const low = value.interpretation?.interpretationConfidence === 'low';
    const sttUncertain = classes.has('stt-uncertain');
    const promotion = value.evidence?.profilePromotionAllowed === true;
    if ((low || sttUncertain) && promotion) {
      push(errors, '$.evidence.profilePromotionAllowed', 'low-confidence or STT-uncertain interpretation cannot promote learner-profile tendencies');
    }

    const naturalOnly = (classes.has('natural-neighbor') || classes.has('natural-alternative')) &&
      !classes.has('form-mismatch') && !classes.has('sense-mismatch') && !classes.has('register-mismatch');
    if (naturalOnly && value.communicativeInterpretation?.learnerExpressionNatural === true && value.learnerFacingResponse?.correctionNeeded === true) {
      push(errors, '$.learnerFacingResponse.correctionNeeded', 'a natural alternative/neighbor must not be treated as a correction-only failure');
    }

    const profileOps = asArray(value.profilePatch?.operations);
    profileOps.forEach((op, index) => {
      const p = isObject(op.payload) ? op.payload : {};
      const asked = norm(p.suggestedConfidence || p.confidence);
      if (['supported','recurring'].includes(asked)) {
        push(warnings, `$.profilePatch.operations[${index}].payload`, 'profile confidence promotion is advisory only; Merge Engine must verify distinct targets/contexts/sessions');
      }
    });

    if (requestContext && isObject(requestContext.learnerResponse)) {
      const corrected = text(requestContext.learnerResponse.correctedTranscript);
      const authoritative = text(requestContext.learnerResponse.authoritativeResponse);
      if (corrected && authoritative !== corrected) {
        push(errors, '$context.learnerResponse.authoritativeResponse', 'learner correction must be authoritative before interpretation');
      }
    }
  }

  function createPlannerRequest(input = {}) {
    return {
      schemaVersion: 1,
      contract: 'planner-writer-v1.request',
      requestId: text(input.requestId) || `plan-${Date.now().toString(36)}`,
      session: { mode: 'ai-study', ...(isObject(input.session) ? input.session : {}) },
      learnerSessionState: isObject(input.learnerSessionState) ? input.learnerSessionState : {},
      candidateContext: isObject(input.candidateContext) ? input.candidateContext : { candidates: [] },
      targetPackets: asArray(input.targetPackets),
      plannerConstraints: {
        maxTargets: 1,
        allowMultiTarget: false,
        avoidRecentRouteRepetition: true,
        naturalnessGateRequired: true,
        targetNeedNotBeExplicit: true,
        ...(isObject(input.plannerConstraints) ? input.plannerConstraints : {})
      }
    };
  }

  function createInterpreterRequest(input = {}) {
    return {
      schemaVersion: 1,
      contract: 'interpreter-router-v1.request',
      requestId: text(input.requestId) || `interp-${Date.now().toString(36)}`,
      session: isObject(input.session) ? input.session : {},
      target: isObject(input.target) ? input.target : {},
      learningOpportunity: input.learningOpportunity ?? null,
      experience: input.experience ?? null,
      learnerResponse: isObject(input.learnerResponse) ? input.learnerResponse : {},
      relevantState: isObject(input.relevantState) ? input.relevantState : {}
    };
  }

  function runSelfTest() {
    const goodPlanner = {
      schemaVersion: 1, contract: 'planner-writer-v1.response', requestId: 'self-plan-1', sessionId: 'self-session',
      selectedTarget: { wordId: '6293', target: 'diffuse', targetFamily: ['diffuse','diffused','diffusion'] },
      learningOpportunity: { direction: 'world-to-expression', goal: 'connect a gradual concentration-to-distribution change with a useful expression', whyNow: 'spread is already accessible while this connection is less established' },
      experienceGrounding: { mode: 'experiential', worldState: 'A scent starts concentrated near one spot and gradually becomes noticeable throughout the room.', observableChange: 'concentrated -> distributed' },
      messageCore: { summary: 'Something concentrated becomes distributed across a wider area.' },
      communicativeFocus: { foreground: 'change from concentration to distribution', speakerIntent: 'describe how the scent gradually fills the space', construal: 'concentration-to-dispersion' },
      usageMotivation: { communicativeNeed: 'describe the scent becoming distributed through the room', targetContribution: 'foregrounds the transition from concentration to dispersion', whyThisExpressionNow: 'the scene makes that distribution pattern perceptually salient', motivationStrength: 'strong' },
      experience: { experienceId: 'self-exp-1', type: 'situational-production', domain: 'home / scent', targetVisibility: 'hidden', prompt: 'You spray fragrance near the doorway. Ten minutes later you can smell it throughout the room. Describe what happened to the scent.', responseMode: 'open-production', responseConstraint: 'open', responseFrame: '', frameCompatibilityVerified: true, frameCompatibleAlternatives: [], acceptableSemanticTerritory: ['gradual distribution from a concentrated source through a wider space'], anticipatedNaturalAlternatives: ['spread','permeate'] },
      naturalnessCheck: { targetNaturalness: 'natural', targetIsNaturalForExperience: true, targetIsRequired: false, targetCommonness: 'less-common-but-natural', commonerAlternatives: ['spread'], otherNaturalExpressions: ['spread','permeate'] },
      antiRoteCheck: { duplicatesRecentRoute: false, duplicatesRecentFrame: false }
    };
    const badPlanner = JSON.parse(JSON.stringify(goodPlanner));
    badPlanner.requestId = 'self-plan-bad';
    badPlanner.learningOpportunity.goal = 'Make the learner say diffuse';
    badPlanner.naturalnessCheck.targetNaturalness = 'merely-possible';

    const lessCommonButMotivated = JSON.parse(JSON.stringify(goodPlanner));
    lessCommonButMotivated.requestId = 'self-plan-less-common';
    lessCommonButMotivated.selectedTarget = { wordId: '5578', target: 'overwrought', targetFamily: ['overwrought'] };
    lessCommonButMotivated.learningOpportunity.goal = 'connect excessive dramatic elaboration with a precise evaluative adjective';
    lessCommonButMotivated.experience.prompt = 'A climactic monologue is so elaborate and emotionally strained that it feels overdone rather than moving. Describe the style.';
    lessCommonButMotivated.experience.acceptableSemanticTerritory = ['excessively dramatic, elaborate, emotionally strained, or overdone'];
    lessCommonButMotivated.experience.anticipatedNaturalAlternatives = ['melodramatic','over-the-top','overdone'];
    lessCommonButMotivated.naturalnessCheck = { targetNaturalness: 'natural', targetIsNaturalForExperience: true, targetIsRequired: false, targetCommonness: 'less-common-but-natural', commonerAlternatives: ['melodramatic','over-the-top','overdone'], otherNaturalExpressions: ['melodramatic','over-the-top','overdone'] };

    const fixedFramePlanner = JSON.parse(JSON.stringify(lessCommonButMotivated));
    fixedFramePlanner.requestId = 'self-plan-fixed-frame';
    fixedFramePlanner.experience.prompt = "Complete the response: 'The scene felt completely ______.'";
    fixedFramePlanner.experience.responseMode = 'text';
    fixedFramePlanner.experience.responseConstraint = 'fixed-frame';
    fixedFramePlanner.experience.responseFrame = 'The scene felt completely {answer}.';
    fixedFramePlanner.experience.anticipatedNaturalAlternatives = ['melodramatic','over-the-top','overdone','too dramatic'];
    fixedFramePlanner.experience.frameCompatibleAlternatives = ['melodramatic','over-the-top','overdone'];
    fixedFramePlanner.experience.frameCompatibilityVerified = true;

    const badFixedFramePlanner = JSON.parse(JSON.stringify(fixedFramePlanner));
    badFixedFramePlanner.requestId = 'self-plan-bad-fixed-frame';
    badFixedFramePlanner.experience.frameCompatibleAlternatives = ['melodramatic','not-listed-semantically'];

    const forcedAlternativePlanner = JSON.parse(JSON.stringify(lessCommonButMotivated));
    forcedAlternativePlanner.requestId = 'self-plan-forced-alternative';
    forcedAlternativePlanner.naturalnessCheck.targetIsRequired = true;

    const goodInterpreter = {
      schemaVersion: 1, contract: 'interpreter-router-v1.response', requestId: 'self-int-1', sessionId: 'self-session', eventId: 'event-1',
      interpretation: { responseClasses: ['natural-neighbor'], conceptMatched: true, targetProduced: false, targetFamilyReached: false, naturalAlternativesObserved: ['spread'], formIssue: null, senseIssue: null, interpretationConfidence: 'high' },
      communicativeInterpretation: { messageCoreMatched: true, learnerFocus: 'general distribution through space', experienceFocus: 'distribution from an initially concentrated source', focusRelation: 'overlapping', learnerExpressionNatural: true },
      evidence: { evidenceTypes: ['neighbor-discrimination'], observationSummary: 'A natural broad neighbor appeared instead of the target-specific construal.', profilePromotionAllowed: true },
      routePatch: { operations: [{ action: 'ADD_NEIGHBOR', payload: { expression: 'spread', relationship: 'broad natural alternative', source: 'learner-generated' } }] },
      profilePatch: { operations: [] },
      diagnosticExemplarCandidate: { retain: true, type: 'neighbor-response', reason: 'Shows the learner’s strong general spreading route.' },
      router: { action: 'CONTRAST', reason: 'Contrast the broad neighbor with the more specific concentration-to-dispersion construal.' },
      learnerFacingResponse: { feedback: '“Spread” is completely natural here; the useful distinction is what part of the spreading event you want to foreground.', correctionNeeded: false }
    };
    const badInterpreter = JSON.parse(JSON.stringify(goodInterpreter));
    badInterpreter.requestId = 'self-int-bad';
    badInterpreter.interpretation.responseClasses = ['stt-uncertain'];
    badInterpreter.interpretation.interpretationConfidence = 'low';
    badInterpreter.evidence.profilePromotionAllowed = true;

    const checks = [
      { name: 'planner-valid', expected: 'VALID', actual: validatePlannerResponse(goodPlanner).status },
      { name: 'planner-valid-less-common-but-motivated', expected: 'VALID', actual: validatePlannerResponse(lessCommonButMotivated).status },
      { name: 'planner-valid-fixed-frame-compatible-alternatives', expected: 'VALID', actual: validatePlannerResponse(fixedFramePlanner).status },
      { name: 'planner-reject-fixed-frame-unlisted-direct-alternative', expected: 'REJECT', actual: validatePlannerResponse(badFixedFramePlanner).status },
      { name: 'planner-reject-forced-natural-alternative', expected: 'REJECT', actual: validatePlannerResponse(forcedAlternativePlanner).status },
      { name: 'planner-reject-target-only', expected: 'REJECT', actual: validatePlannerResponse(badPlanner).status },
      { name: 'interpreter-valid-natural-neighbor', expected: 'VALID', actual: validateInterpreterResponse(goodInterpreter).status },
      { name: 'interpreter-reject-low-confidence-profile-promotion', expected: 'REJECT', actual: validateInterpreterResponse(badInterpreter).status }
    ];
    return { passed: checks.every(item => item.actual === item.expected), checks };
  }

  window.WLPAIStudyContract = Object.freeze({
    version: VERSION,
    schemas: SCHEMAS,
    enums: ENUMS,
    createPlannerRequest,
    createInterpreterRequest,
    validatePlannerRequest,
    validatePlannerResponse,
    validateInterpreterRequest,
    validateInterpreterResponse,
    runSelfTest
  });
})();
