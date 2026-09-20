(() => {
  'use strict';

  const VERSION = '1.3.0';
  const MODE_KEY = 'wlp:ai-transport-mode:v1';
  const DEFAULT_MODE = 'mock';
  const ENDPOINT = '/.netlify/functions/wlp-ai-study';
  const REQUEST_TIMEOUT_MS = 60000;
  const RETRYABLE_HTTP_STATUSES = Object.freeze([429, 503]);
  const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1500, 4000, 8000]);
  const MAX_PROVIDER_RETRY_AFTER_MS = 30000;
  const RETRY_AFTER_SAFETY_MS = 250;

  const clean = value => String(value ?? '').trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function requireContract() {
    const contract = window.WLPAIStudyContract;
    if (!contract) throw new Error('WLP AI Study Contract layer is not loaded');
    return contract;
  }

  function requireMock() {
    const mock = window.WLPAIStudyMockFlow;
    if (!mock) throw new Error('WLP AI Study Mock flow is not loaded');
    return mock;
  }

  function getMode() {
    try {
      const saved = clean(localStorage.getItem(MODE_KEY)).toLowerCase();
      if (saved === 'real' || saved === 'mock') return saved;
    } catch (_) {}
    return DEFAULT_MODE;
  }

  function setMode(mode) {
    const next = clean(mode).toLowerCase();
    if (!['mock', 'real'].includes(next)) throw new Error(`Unsupported AI transport mode: ${mode}`);
    try { localStorage.setItem(MODE_KEY, next); } catch (_) {}
    return next;
  }

  function validationError(label, validation) {
    const details = (validation?.errors || []).map(item => `${item.path || '$'}: ${item.message || 'invalid'}`).join('; ');
    const error = new Error(`${label} validation failed${details ? `: ${details}` : ''}`);
    error.code = 'WLP_AI_CONTRACT_INVALID';
    error.validation = clone(validation);
    return error;
  }

  function assertValidation(label, validation) {
    if (!validation?.valid || validation?.status === 'REJECT') throw validationError(label, validation);
    return validation;
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function getRetryDelays(options = {}) {
    if (options.retry === false) return [];
    const source = Array.isArray(options.retryDelaysMs)
      ? options.retryDelaysMs
      : DEFAULT_RETRY_DELAYS_MS;
    const cleaned = source
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0)
      .slice(0, 5);
    const requestedMax = Number(options.maxRetries);
    if (!Number.isFinite(requestedMax)) return cleaned;
    const maxRetries = Math.max(0, Math.min(5, Math.floor(requestedMax)));
    return cleaned.slice(0, maxRetries);
  }

  function providerErrorMeta(error) {
    const providerError = error?.details?.error && typeof error.details.error === 'object'
      ? error.details.error
      : {};
    const retryAfterMs = Number(providerError.retryAfterMs);
    return {
      retryable: providerError.retryable,
      retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : null,
      quotaScope: clean(providerError.quotaScope),
      provider: clean(providerError.provider),
      providerCode: clean(providerError.providerCode)
    };
  }

  function isRetryableTemporaryFailure(error) {
    const meta = providerErrorMeta(error);
    if (meta.retryable === false) return false;
    return RETRYABLE_HTTP_STATUSES.includes(Number(error?.status));
  }

  function retryDelayFor(error, retryCount, retryDelays) {
    const fallback = Number(retryDelays[retryCount] || 0);
    const meta = providerErrorMeta(error);
    if (meta.retryAfterMs == null) return fallback;
    if (meta.retryAfterMs > MAX_PROVIDER_RETRY_AFTER_MS) return null;
    return Math.max(fallback, Math.ceil(meta.retryAfterMs) + RETRY_AFTER_SAFETY_MS);
  }

  async function fetchJSON(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      let body = null;
      try { body = await response.json(); } catch (_) {}
      if (!response.ok) {
        const message = clean(body?.error?.message || body?.message) || `AI endpoint returned HTTP ${response.status}`;
        const error = new Error(message);
        error.code = clean(body?.error?.code) || 'WLP_AI_ENDPOINT_ERROR';
        error.status = response.status;
        error.details = clone(body);
        throw error;
      }
      if (!body || typeof body !== 'object') {
        const error = new Error('AI endpoint returned an empty or non-JSON response');
        error.code = 'WLP_AI_ENDPOINT_BAD_JSON';
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('AI endpoint request timed out');
        timeoutError.code = 'WLP_AI_ENDPOINT_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callRemote(kind, payload, options = {}) {
    const eventId = clean(options.eventId);
    const endpoint = clean(options.endpoint) || ENDPOINT;
    const body = {
      schemaVersion: 1,
      kind,
      payload: clone(payload)
    };
    if (kind === 'interpreter') body.eventId = eventId;

    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
    const retryDelays = getRetryDelays(options);
    let retryCount = 0;

    while (true) {
      try {
        const envelope = await fetchJSON(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
          cache: 'no-store'
        }, timeoutMs);

        if (envelope.ok !== true || !envelope.result) {
          const error = new Error(clean(envelope?.error?.message) || 'AI endpoint did not return a result');
          error.code = clean(envelope?.error?.code) || 'WLP_AI_ENDPOINT_EMPTY_RESULT';
          error.details = clone(envelope);
          throw error;
        }
        return {
          result: envelope.result,
          meta: {
            ...clone(envelope.meta || {}),
            transportRetryCount: retryCount,
            transportAttemptCount: retryCount + 1
          }
        };
      } catch (error) {
        const retryable = isRetryableTemporaryFailure(error);
        const nextDelayMs = retryable && retryCount < retryDelays.length
          ? retryDelayFor(error, retryCount, retryDelays)
          : null;
        const canRetryNow = retryable && retryCount < retryDelays.length && nextDelayMs != null;
        if (!canRetryNow) {
          if (retryable) {
            const meta = providerErrorMeta(error);
            error.retryable = meta.retryable !== false;
            error.retryCount = retryCount;
            error.attemptCount = retryCount + 1;
            error.retryDelaysMs = retryDelays.slice();
            error.retryAfterMs = meta.retryAfterMs;
            error.quotaScope = meta.quotaScope;
            error.provider = meta.provider;
            error.providerCode = meta.providerCode;
          }
          throw error;
        }

        const delayMs = nextDelayMs;
        retryCount += 1;
        await wait(delayMs);
      }
    }
  }

  async function callPlannerWriter(plannerRequest, options = {}) {
    const contract = requireContract();
    const requestValidation = contract.validatePlannerRequest(plannerRequest);
    assertValidation('Planner request', requestValidation);

    const mode = clean(options.mode || getMode()).toLowerCase();
    let response;
    let meta = { transport: mode };

    if (mode === 'mock') {
      response = requireMock().mockPlannerWriter(clone(plannerRequest));
      meta = { transport: 'mock', provider: 'local-fixture' };
    } else if (mode === 'real') {
      const remote = await callRemote('planner', plannerRequest, options);
      response = remote.result;
      meta = { transport: 'real', ...remote.meta };
    } else {
      throw new Error(`Unsupported AI transport mode: ${mode}`);
    }

    const responseValidation = contract.validatePlannerResponse(response);
    assertValidation('Planner response', responseValidation);
    return { response: clone(response), validation: clone(responseValidation), meta };
  }

  async function callInterpreterRouter(interpreterRequest, options = {}) {
    const contract = requireContract();
    const requestValidation = contract.validateInterpreterRequest(interpreterRequest);
    assertValidation('Interpreter request', requestValidation);

    const eventId = clean(options.eventId);
    if (!eventId) throw new Error('Interpreter transport requires eventId');
    const mode = clean(options.mode || getMode()).toLowerCase();
    let response;
    let meta = { transport: mode };

    if (mode === 'mock') {
      response = requireMock().mockInterpreterRouter(clone(interpreterRequest), eventId);
      meta = { transport: 'mock', provider: 'local-fixture' };
    } else if (mode === 'real') {
      const remote = await callRemote('interpreter', interpreterRequest, { ...options, eventId });
      response = remote.result;
      meta = { transport: 'real', ...remote.meta };
    } else {
      throw new Error(`Unsupported AI transport mode: ${mode}`);
    }

    const responseValidation = contract.validateInterpreterResponse(response, interpreterRequest);
    assertValidation('Interpreter response', responseValidation);
    return { response: clone(response), validation: clone(responseValidation), meta };
  }

  async function probeRealEndpoint(options = {}) {
    const endpoint = clean(options.endpoint) || ENDPOINT;
    return fetchJSON(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, kind: 'health' }),
      credentials: 'same-origin',
      cache: 'no-store'
    }, Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10000);
  }


  async function previewOutbound(kind, payload, options = {}) {
    const normalizedKind = clean(kind).toLowerCase();
    if (!['planner', 'interpreter'].includes(normalizedKind)) throw new Error(`Unsupported preview kind: ${kind}`);
    const contract = requireContract();
    if (normalizedKind === 'planner') assertValidation('Planner request', contract.validatePlannerRequest(payload));
    else assertValidation('Interpreter request', contract.validateInterpreterRequest(payload));
    const endpoint = clean(options.endpoint) || ENDPOINT;
    const body = {
      schemaVersion: 1,
      kind: 'preview',
      previewKind: normalizedKind,
      payload: clone(payload)
    };
    if (normalizedKind === 'interpreter' && clean(options.eventId)) body.eventId = clean(options.eventId);
    return fetchJSON(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store'
    }, Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10000);
  }

  async function getProviderInfo(options = {}) {
    return probeRealEndpoint(options);
  }

  async function runTransportSelfTest() {
    const data = window.WLPAIStudyData;
    const contract = requireContract();
    if (!data) throw new Error('WLP AI Study Data layer is not loaded');

    const sessionId = `transport-selftest-${Date.now().toString(36)}`;
    const candidateContext = await data.assembleCandidateContext({
      wordIds: ['6293'],
      sessionId,
      sourceMode: 'explicit',
      sourceLabel: 'AI transport self-test',
      difficulty: 'adaptive',
      maxCandidates: 1
    });
    const targetPacket = await data.assembleTargetContext('6293');
    const plannerRequest = data.buildPlannerWriterRequest({
      session: { sessionId, mode: 'ai-study', sourceMode: 'explicit', sourceLabel: 'AI transport self-test', difficulty: 'adaptive' },
      candidateContext,
      learnerSessionState: candidateContext.learnerSessionState,
      targetPackets: [targetPacket],
      plannerConstraints: { maxTargets: 1, allowMultiTarget: false, avoidRecentRouteRepetition: true, naturalnessGateRequired: true, targetNeedNotBeExplicit: true }
    });
    const planner = await callPlannerWriter(plannerRequest, { mode: 'mock' });

    const learnerResponse = {
      rawTranscript: 'spread throughout the room',
      correctedTranscript: '',
      authoritativeResponse: 'spread throughout the room',
      inputMode: 'text',
      sttCorrectedByLearner: false
    };
    const interpretationContext = await data.assembleInterpretationContext({
      wordId: '6293',
      learningOpportunity: planner.response.learningOpportunity,
      experience: {
        ...clone(planner.response.experience),
        experienceGrounding: clone(planner.response.experienceGrounding),
        messageCore: clone(planner.response.messageCore),
        communicativeFocus: clone(planner.response.communicativeFocus),
        construal: clean(planner.response.communicativeFocus?.construal),
        usageMotivation: clone(planner.response.usageMotivation)
      },
      learnerResponse
    });
    const interpreterRequest = data.buildInterpreterRouterRequest({ session: { sessionId }, interpretationContext });
    const interpreter = await callInterpreterRouter(interpreterRequest, { mode: 'mock', eventId: `transport-selftest-event-${Date.now().toString(36)}` });

    const checks = [
      { name: 'planner-through-transport-valid', pass: planner.validation?.status === 'VALID' },
      { name: 'planner-transport-is-mock', pass: planner.meta?.transport === 'mock' },
      { name: 'interpreter-through-transport-valid', pass: interpreter.validation?.status === 'VALID' },
      { name: 'interpreter-natural-neighbor', pass: interpreter.response?.interpretation?.responseClasses?.includes('natural-neighbor') },
      { name: 'interpreter-router-contrast', pass: interpreter.response?.router?.action === 'CONTRAST' },
      { name: 'contract-layer-still-present', pass: Boolean(contract?.version) }
    ];
    return { passed: checks.every(item => item.pass), checks };
  }

  window.WLPAIStudyTransport = Object.freeze({
    version: VERSION,
    endpoint: ENDPOINT,
    modeKey: MODE_KEY,
    retryPolicy: Object.freeze({ statuses: RETRYABLE_HTTP_STATUSES.slice(), delaysMs: DEFAULT_RETRY_DELAYS_MS.slice(), maxProviderRetryAfterMs: MAX_PROVIDER_RETRY_AFTER_MS }),
    getMode,
    setMode,
    callPlannerWriter,
    callInterpreterRouter,
    probeRealEndpoint,
    getProviderInfo,
    previewOutbound,
    runTransportSelfTest
  });
})();
