(() => {
  'use strict';

  const VERSION = '1.1.0';
  const FIXTURE_WORD_ID = '6293';
  const FIXTURE_TARGET = 'diffuse';

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const norm = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const makeId = prefix => {
    try {
      if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    } catch (_) {}
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  function requireLayers() {
    const data = window.WLPAIStudyData;
    const contract = window.WLPAIStudyContract;
    if (!data) throw new Error('WLP AI Study Data layer is not loaded');
    if (!contract) throw new Error('WLP AI Study Contract layer is not loaded');
    return { data, contract };
  }

  function targetFromPacket(packet) {
    const target = packet?.target || {};
    return {
      wordId: clean(target.wordId),
      target: clean(target.headword || target.target),
      targetFamily: Array.isArray(target.targetFamily) ? target.targetFamily.map(clean).filter(Boolean) : []
    };
  }

  function assertDiffuseFixture(packet) {
    const selected = targetFromPacket(packet);
    if (selected.wordId !== FIXTURE_WORD_ID || norm(selected.target) !== FIXTURE_TARGET) {
      throw new Error(`Mock v0.1 currently supports only WordID ${FIXTURE_WORD_ID} (${FIXTURE_TARGET})`);
    }
    return selected;
  }

  function mockPlannerWriter(plannerRequest) {
    const { contract } = requireLayers();
    const requestValidation = contract.validatePlannerRequest(plannerRequest);
    if (!requestValidation.valid) throw new Error(`Mock planner received invalid request: ${requestValidation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);

    const packet = plannerRequest.targetPackets?.[0];
    const selected = assertDiffuseFixture(packet);
    const sessionId = clean(plannerRequest.session?.sessionId);
    if (!sessionId) throw new Error('Mock planner requires session.sessionId');

    const response = {
      schemaVersion: 1,
      contract: 'planner-writer-v1.response',
      requestId: clean(plannerRequest.requestId),
      sessionId,
      selectedTarget: selected,
      learningOpportunity: {
        direction: 'world-to-expression',
        goal: 'build a direct connection between a perceptible concentration-to-distribution change and the expression used to describe that change',
        missingOrWeakConnection: 'a real scent-distribution event -> diffuse without relying on a dictionary-style cue',
        whyNow: 'the mock turn tests whether WLP can preserve a meaningful situation, accept a natural neighbor, and merge the resulting evidence'
      },
      experienceGrounding: {
        mode: 'experiential',
        worldState: 'You spray a little fragrance near the doorway. Ten minutes later, the smell is no longer concentrated there; it is noticeable throughout the room.',
        observableChange: 'concentrated near one point -> gradually distributed through the room',
        whyThisMatters: 'the physical change itself supplies the semantic structure instead of a definition paraphrase'
      },
      messageCore: {
        summary: 'Something initially concentrated becomes gradually distributed across a wider space.'
      },
      communicativeFocus: {
        foreground: 'the change from local concentration to wider distribution',
        background: 'the fragrance was sprayed from a particular starting point',
        speakerIntent: 'describe what happened to the scent over time',
        construal: 'concentration-to-dispersion'
      },
      usageMotivation: {
        communicativeNeed: 'describe the scent becoming distributed away from its initially concentrated source',
        discourseTrigger: 'the listener is asked what happened between the initial spray and the later room-wide smell',
        perspectiveShift: 'one concentrated source -> distributed presence across the room',
        targetContribution: 'diffuse can foreground the movement from concentration toward dispersion rather than merely state that the smell is present',
        whyThisExpressionNow: 'the scene makes the concentration-to-distribution change perceptually salient, so the target has a real communicative job here',
        motivationStrength: 'strong'
      },
      experience: {
        experienceId: makeId('mock-exp'),
        type: 'situational-production',
        domain: 'home / scent',
        targetVisibility: 'hidden',
        prompt: 'You spray a little fragrance near the doorway. Ten minutes later, you can smell it throughout the room. Describe what happened to the scent.',
        responseMode: 'open-production',
        responseConstraint: 'open',
        responseFrame: '',
        frameCompatibilityVerified: true,
        acceptableSemanticTerritory: ['gradual spreading through space', 'distribution away from a concentrated source'],
        anticipatedNaturalAlternatives: ['spread', 'permeate'],
        frameCompatibleAlternatives: []
      },
      naturalnessCheck: {
        targetNaturalness: 'natural',
        targetIsNaturalForExperience: true,
        targetIsRequired: false,
        targetCommonness: 'less-common-but-natural',
        commonerAlternatives: ['spread'],
        otherNaturalExpressions: ['spread', 'permeate']
      },
      antiRoteCheck: {
        duplicatesRecentRoute: false,
        duplicatesRecentFrame: false,
        notes: 'Mock fixture intentionally uses one stable, meaningful scene to verify the data path; production AI must consult the live anti-rote window.'
      }
    };

    const validation = contract.validatePlannerResponse(response);
    if (!validation.valid) throw new Error(`Mock planner produced invalid response: ${validation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);
    return response;
  }

  function createPendingEvent(plannerResponse, learnerResponse, eventId = '') {
    const { data } = requireLayers();
    const selected = plannerResponse.selectedTarget;
    const response = learnerResponse || {};
    return data.saveAIStudyEvent({
      eventId: clean(eventId) || makeId('mock-event'),
      sessionId: clean(plannerResponse.sessionId),
      wordId: clean(selected.wordId),
      target: {
        wordId: clean(selected.wordId),
        headword: clean(selected.target),
        targetFamily: clone(selected.targetFamily || [])
      },
      learningOpportunity: clone(plannerResponse.learningOpportunity),
      experienceGrounding: clone(plannerResponse.experienceGrounding),
      messageCore: clone(plannerResponse.messageCore),
      communicativeFocus: clone(plannerResponse.communicativeFocus),
      usageMotivation: clone(plannerResponse.usageMotivation),
      experience: {
        direction: clean(plannerResponse.learningOpportunity?.direction),
        ...clone(plannerResponse.experience),
        experienceGrounding: clone(plannerResponse.experienceGrounding),
        messageCore: clone(plannerResponse.messageCore),
        communicativeFocus: clone(plannerResponse.communicativeFocus),
        construal: clean(plannerResponse.communicativeFocus?.construal),
        usageMotivation: clone(plannerResponse.usageMotivation)
      },
      learnerResponse: {
        rawTranscript: clean(response.rawTranscript || response.text),
        correctedTranscript: clean(response.correctedTranscript),
        inputMode: clean(response.inputMode || 'text'),
        sttCorrectedByLearner: Boolean(response.sttCorrectedByLearner)
      },
      metadata: {
        mockFlow: true,
        plannerRequestId: clean(plannerResponse.requestId),
        plannerContract: clean(plannerResponse.contract)
      }
    });
  }

  function mockInterpreterRouter(interpreterRequest, eventId) {
    const { contract } = requireLayers();
    const requestValidation = contract.validateInterpreterRequest(interpreterRequest);
    if (!requestValidation.valid) throw new Error(`Mock interpreter received invalid request: ${requestValidation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);

    const authoritative = clean(interpreterRequest.learnerResponse?.authoritativeResponse);
    const normalized = norm(authoritative);
    const targetFamily = (interpreterRequest.target?.targetFamily || []).map(norm).filter(Boolean);
    const targetProduced = targetFamily.some(target => target && (normalized === target || normalized.includes(target)));
    const spreadObserved = /(^|\W)spread(?:s|ing)?(\W|$)/i.test(authoritative);
    const permeateObserved = /(^|\W)permeat(?:e|es|ed|ing)(\W|$)/i.test(authoritative);

    let responseClasses;
    let conceptMatched;
    let naturalAlternativesObserved = [];
    let learnerFocus;
    let focusRelation;
    let learnerExpressionNatural;
    let evidenceTypes;
    let observationSummary;
    let routeOperations = [];
    let router;
    let feedback;

    if (targetProduced) {
      responseClasses = ['exact-target'];
      conceptMatched = true;
      learnerFocus = 'the scent changes from locally concentrated to distributed through the room';
      focusRelation = 'aligned';
      learnerExpressionNatural = true;
      evidenceTypes = ['spontaneous-production'];
      observationSummary = 'The hidden target was produced in a scene grounded in concentration-to-distribution rather than a definition cue.';
      routeOperations = [
        {
          action: 'ADD_CONNECTION',
          payload: {
            from: 'world:scent-concentration-to-distribution',
            to: 'expression:diffuse',
            direction: 'world-to-expression',
            evidenceType: 'spontaneous-production',
            evidenceSummary: { status: 'observed', evidenceTypes: ['spontaneous-production'] },
            representativeEvidence: [{ type: 'spontaneous-production', learnerResponse: authoritative, contextSummary: 'scent gradually spreads from one spot through a room', whyImportant: 'direct world-to-expression retrieval with the target hidden' }]
          }
        },
        { action: 'ADD_DOMAIN', payload: { name: 'home / scent', evidence: 'observed' } }
      ];
      router = { action: 'PAUSE', reason: 'The mock has captured the intended world-to-expression evidence; no extra repetition is needed for this verification turn.' };
      feedback = 'That works naturally here. The useful connection is the scent moving from a concentrated starting point into a more distributed state.';
    } else if (spreadObserved || permeateObserved) {
      const alternatives = [];
      if (spreadObserved) alternatives.push('spread');
      if (permeateObserved) alternatives.push('permeate');
      responseClasses = ['natural-neighbor'];
      conceptMatched = true;
      naturalAlternativesObserved = alternatives;
      learnerFocus = spreadObserved ? 'general spreading through the room' : 'the scent filling or penetrating the room throughout';
      focusRelation = 'overlapping';
      learnerExpressionNatural = true;
      evidenceTypes = ['neighbor-discrimination'];
      observationSummary = `A natural neighboring route (${alternatives.join(', ')}) expressed the scene without producing the target.`;
      routeOperations = alternatives.map(expression => ({
        action: 'ADD_NEIGHBOR',
        payload: {
          expression,
          relationship: expression === 'spread' ? 'broad natural alternative for distribution through space' : 'natural neighbor emphasizing presence throughout a space',
          source: 'learner-generated',
          context: 'home / scent'
        }
      }));
      routeOperations.push({ action: 'ADD_DOMAIN', payload: { name: 'home / scent', evidence: 'neighbor-route-observed' } });
      router = { action: 'CONTRAST', reason: 'The learner already has a natural neighboring route, so the next useful move would contrast what diffuse foregrounds rather than mark the answer wrong.' };
      feedback = `“${alternatives[0]}” is natural here. The useful distinction is that “diffuse” can foreground the change from a more concentrated source toward wider distribution.`;
    } else {
      responseClasses = ['partial-concept'];
      conceptMatched = null;
      learnerFocus = 'unclear from this response';
      focusRelation = 'unclear';
      learnerExpressionNatural = null;
      evidenceTypes = [];
      observationSummary = 'The response does not provide enough evidence to classify the target route or a stable neighboring route.';
      router = { action: 'BRANCH', reason: 'Use a different grounded situation or a light follow-up rather than force the target from insufficient evidence.' };
      feedback = 'That gives me only partial evidence about the connection, so I would shift the situation rather than force one target answer.';
    }

    const response = {
      schemaVersion: 1,
      contract: 'interpreter-router-v1.response',
      requestId: clean(interpreterRequest.requestId),
      sessionId: clean(interpreterRequest.session?.sessionId),
      eventId: clean(eventId),
      interpretation: {
        responseClasses,
        conceptMatched,
        targetProduced,
        targetFamilyReached: targetProduced,
        naturalAlternativesObserved,
        formIssue: null,
        senseIssue: null,
        interpretationConfidence: targetProduced || naturalAlternativesObserved.length ? 'high' : 'medium'
      },
      communicativeInterpretation: {
        messageCoreMatched: conceptMatched,
        learnerFocus,
        experienceFocus: 'the change from a concentrated source to wider distribution through the room',
        focusRelation,
        learnerExpressionNatural
      },
      evidence: {
        evidenceTypes,
        observationSummary,
        profilePromotionAllowed: false
      },
      routePatch: { operations: routeOperations },
      profilePatch: { operations: [] },
      diagnosticExemplarCandidate: {
        retain: Boolean(targetProduced || naturalAlternativesObserved.length),
        type: targetProduced ? 'spontaneous-production' : naturalAlternativesObserved.length ? 'neighbor-response' : 'diagnostic',
        reason: targetProduced
          ? 'Shows direct retrieval from a meaningful hidden-target situation.'
          : naturalAlternativesObserved.length
            ? 'Shows the learner’s existing natural route for the same world event.'
            : 'Insufficiently diagnostic for long-term retention.',
        learnerResponse: authoritative,
        contextSummary: 'scent gradually becomes distributed from one spot throughout a room'
      },
      router,
      learnerFacingResponse: {
        feedback,
        correctionNeeded: false
      }
    };

    const validation = contract.validateInterpreterResponse(response, interpreterRequest);
    if (!validation.valid) throw new Error(`Mock interpreter produced invalid response: ${validation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);
    return response;
  }

  function snapshotStorage(keys) {
    return Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
  }

  function restoreStorage(snapshot) {
    Object.entries(snapshot).forEach(([key, value]) => {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
  }

  async function runMockTurn(options = {}) {
    const { data, contract } = requireLayers();
    const persist = options.persist === true;
    const keys = [data.keys.events, data.keys.routeState, data.keys.learnerProfile];
    const snapshot = persist ? null : snapshotStorage(keys);
    const sessionId = clean(options.sessionId) || makeId('mock-session');
    const learnerResponse = {
      rawTranscript: clean(options.rawTranscript || options.response || 'spread throughout the room'),
      correctedTranscript: clean(options.correctedTranscript),
      inputMode: clean(options.inputMode || 'text'),
      sttCorrectedByLearner: Boolean(options.sttCorrectedByLearner)
    };

    try {
      const candidateContext = await data.assembleCandidateContext({
        wordIds: [FIXTURE_WORD_ID],
        sessionId,
        sourceMode: 'explicit',
        sourceLabel: 'AI Study mock fixture',
        difficulty: 'adaptive',
        maxCandidates: 1
      });
      const targetPacket = await data.assembleTargetContext(FIXTURE_WORD_ID);
      const plannerRequest = data.buildPlannerWriterRequest({
        session: { sessionId, mode: 'ai-study', sourceMode: 'explicit', sourceLabel: 'AI Study mock fixture', difficulty: 'adaptive' },
        candidateContext,
        learnerSessionState: candidateContext.learnerSessionState,
        targetPackets: [targetPacket],
        plannerConstraints: { maxTargets: 1, allowMultiTarget: false, avoidRecentRouteRepetition: true, naturalnessGateRequired: true, targetNeedNotBeExplicit: true }
      });
      const plannerRequestValidation = contract.validatePlannerRequest(plannerRequest);
      const plannerResponse = mockPlannerWriter(plannerRequest);
      const plannerResponseValidation = contract.validatePlannerResponse(plannerResponse);

      const event = createPendingEvent(plannerResponse, learnerResponse, clean(options.eventId));
      const interpretationContext = await data.assembleInterpretationContext({
        wordId: FIXTURE_WORD_ID,
        learningOpportunity: plannerResponse.learningOpportunity,
        experience: {
          ...clone(plannerResponse.experience),
          experienceGrounding: clone(plannerResponse.experienceGrounding),
          messageCore: clone(plannerResponse.messageCore),
          communicativeFocus: clone(plannerResponse.communicativeFocus),
          construal: clean(plannerResponse.communicativeFocus?.construal),
          usageMotivation: clone(plannerResponse.usageMotivation)
        },
        learnerResponse
      });
      const interpreterRequest = data.buildInterpreterRouterRequest({
        session: { sessionId },
        interpretationContext
      });
      const interpreterRequestValidation = contract.validateInterpreterRequest(interpreterRequest);
      const interpreterResponse = mockInterpreterRouter(interpreterRequest, event.eventId);
      const interpreterResponseValidation = contract.validateInterpreterResponse(interpreterResponse, interpreterRequest);
      const merged = data.mergeInterpreterResult(event.eventId, interpreterResponse);
      const routeRecord = merged.routeState.records[`wid:${FIXTURE_WORD_ID}`] || null;

      return {
        ok: true,
        persist,
        sessionId,
        planner: {
          request: plannerRequest,
          requestValidation: plannerRequestValidation,
          response: plannerResponse,
          responseValidation: plannerResponseValidation
        },
        event: clone(merged.event),
        interpreter: {
          request: interpreterRequest,
          requestValidation: interpreterRequestValidation,
          response: interpreterResponse,
          responseValidation: interpreterResponseValidation
        },
        mergedState: {
          routeRecord: clone(routeRecord),
          learnerProfile: clone(merged.learnerProfile)
        }
      };
    } finally {
      if (snapshot) restoreStorage(snapshot);
    }
  }

  async function runEndToEndSelfTest() {
    const result = await runMockTurn({ persist: false, response: 'spread throughout the room' });
    const route = result.mergedState.routeRecord || {};
    const neighbors = Array.isArray(route.learnerGeneratedNeighbors) ? route.learnerGeneratedNeighbors : [];
    const exemplars = Array.isArray(route.diagnosticExemplars) ? route.diagnosticExemplars : [];
    const routeHints = Array.isArray(route.nextRouteHints) ? route.nextRouteHints : [];
    const profile = result.mergedState.learnerProfile || {};
    const checks = [
      { name: 'planner-request-valid', pass: result.planner.requestValidation.status === 'VALID' },
      { name: 'planner-response-valid', pass: result.planner.responseValidation.status === 'VALID' },
      { name: 'event-saved-before-interpretation', pass: Boolean(result.event?.eventId) && result.event?.interpretationStatus === 'interpreted' },
      { name: 'interpreter-request-valid', pass: result.interpreter.requestValidation.status === 'VALID' },
      { name: 'interpreter-response-valid', pass: result.interpreter.responseValidation.status === 'VALID' },
      { name: 'natural-neighbor-merged', pass: neighbors.some(item => norm(item.expression) === 'spread') },
      { name: 'diagnostic-exemplar-retained', pass: exemplars.some(item => norm(item.type).includes('neighbor')) },
      { name: 'router-hint-merged', pass: routeHints.some(item => clean(item.action) === 'CONTRAST') },
      { name: 'no-profile-trait-created-from-neighbor-only-turn', pass: (profile.productionTendencies || []).length === 0 && (profile.styleTendencies || []).length === 0 }
    ];
    return {
      passed: checks.every(check => check.pass),
      checks,
      summary: {
        target: FIXTURE_TARGET,
        learnerResponse: 'spread throughout the room',
        interpretedAs: result.interpreter.response.interpretation.responseClasses,
        routerAction: result.interpreter.response.router.action,
        storageRestored: true
      }
    };
  }

  window.WLPAIStudyMockFlow = Object.freeze({
    version: VERSION,
    fixture: Object.freeze({ wordId: FIXTURE_WORD_ID, target: FIXTURE_TARGET }),
    mockPlannerWriter,
    mockInterpreterRouter,
    runMockTurn,
    runEndToEndSelfTest
  });
})();
