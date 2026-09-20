/* WLP Stage 7 — AI Study UI integration v1.8.6.53 R1
   Provider-agnostic UI adapter for existing AI Study Data / Contract / Transport layers. */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const MAX_CANDIDATES = 30;
  const MAX_TARGET_PACKETS = 3;

  const state = {
    mode: 'standard',
    providerInfo: null,
    providerReady: false,
    session: null,
    activePlanner: null,
    busy: false
  };

  const $ = selector => document.querySelector(selector);
  const clean = value => String(value ?? '').trim();
  const num = value => Number(value || 0);
  const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function requireLayers() {
    const data = window.WLPAIStudyData;
    const contract = window.WLPAIStudyContract;
    const transport = window.WLPAIStudyTransport;
    if (!data || !contract || !transport) throw new Error('AI Study layers are not fully loaded. Reload Study Hub and try again.');
    return { data, contract, transport };
  }

  function readJson(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function reviewPriority(level) {
    const value = clean(level).toLowerCase();
    if (value === 'high') return 3;
    if (value === 'medium') return 2;
    if (value === 'light') return 1;
    return 0;
  }

  function reviewWordIds(limit = MAX_CANDIDATES) {
    const found = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      const wordId = clean(key.slice(PROGRESS_PREFIX.length));
      if (!wordId) continue;
      const record = readJson(key, null);
      if (!record || typeof record !== 'object') continue;
      const isReview = record.review === true || record.lastResult === 'review';
      if (!isReview) continue;
      found.push({
        wordId,
        priority: reviewPriority(record.reviewLevel),
        exposureCount: num(record.exposureCount),
        lastSeen: clean(record.lastSeen)
      });
    }
    found.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aTime = Date.parse(a.lastSeen || '') || 0;
      const bTime = Date.parse(b.lastSeen || '') || 0;
      if (aTime !== bTime) return aTime - bTime;
      if (b.exposureCount !== a.exposureCount) return b.exposureCount - a.exposureCount;
      return num(a.wordId) - num(b.wordId);
    });
    return found.slice(0, limit).map(item => item.wordId);
  }

  function getSourceMode() {
    return clean($('.study-source-tab.is-active')?.dataset.sourceMode || 'review');
  }

  function snapshotSource() {
    const mode = getSourceMode();
    if (mode === 'deck') {
      const deck = Math.max(1, Math.floor(num($('#study-deck')?.value)));
      return { mode, deck, label: `WLP${deck}` };
    }
    if (mode === 'range') {
      const start = Math.max(1, Math.floor(num($('#study-range-start')?.value)));
      const end = Math.max(1, Math.floor(num($('#study-range-end')?.value)));
      return { mode, rangeStart: start, rangeEnd: end, label: `WLP${Math.min(start, end)}–${Math.max(start, end)}` };
    }
    return { mode: 'review', label: 'Review' };
  }

  function selectedSessionSize() {
    const size = Math.floor(num($('#study-session-size')?.value));
    return [5, 10, 20].includes(size) ? size : 5;
  }

  function candidateScore(candidate, session) {
    const review = candidate?.reviewSignal || {};
    const studyQ = candidate?.studyQSignal || {};
    const metadata = candidate?.learningMetadataSignal || {};
    const route = candidate?.routeSummary || {};
    let score = 0;
    if (review.review) score += 28;
    score += reviewPriority(review.reviewLevel) * 18;
    const outcome = clean(studyQ.latestOutcome).toLowerCase();
    if (outcome === 'not yet' || outcome === 'not-yet') score += 28;
    else if (outcome === 'almost') score += 18;
    else if (outcome === 'got it' || outcome === 'got-it') score -= 4;
    score += Math.min(18, num(studyQ.recentHintsNeeded) * 3);
    if (metadata.available) score += 4;
    score += Math.min(8, num(metadata.situationCount) * 2);
    score += Math.min(12, Array.isArray(route.nextRouteHints) ? route.nextRouteHints.length * 4 : 0);
    score += Math.min(8, Array.isArray(route.learnerGeneratedNeighbors) ? route.learnerGeneratedNeighbors.length * 2 : 0);
    const usedCount = session?.usedTargets?.[clean(candidate.wordId)] || 0;
    score -= usedCount * 72;
    return score;
  }

  function rankCandidates(candidates, session) {
    return (Array.isArray(candidates) ? candidates.slice() : [])
      .sort((a, b) => {
        const delta = candidateScore(b, session) - candidateScore(a, session);
        if (delta) return delta;
        return num(a.wordId) - num(b.wordId);
      });
  }

  function injectUI() {
    const main = $('main.study-hub-main');
    const sourcePanel = $('.study-hub-panel[aria-labelledby="study-source-title"]');
    if (!main || !sourcePanel || $('#wlp-practice-mode-switch')) return;

    const switcher = document.createElement('div');
    switcher.id = 'wlp-practice-mode-switch';
    switcher.className = 'wlp-practice-mode-switch';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Practice mode');
    switcher.innerHTML = `
      <button type="button" data-wlp-practice-mode="standard" class="is-active" aria-pressed="true">Standard Practice<small>No AI required</small></button>
      <button type="button" data-wlp-practice-mode="ai" aria-pressed="false">AI Practice<small>Adaptive experiences</small></button>`;
    main.insertBefore(switcher, sourcePanel);

    const aiRoot = document.createElement('div');
    aiRoot.id = 'wlp-ai-study-root';
    aiRoot.className = 'wlp-ai-only';
    aiRoot.innerHTML = `
      <section class="wlp-ai-hero">
        <span class="section-kicker">AI Study · Adaptive Connections</span>
        <h1>Build connections, not answer keys.</h1>
        <p>WLP narrows the study material locally, then AI creates one <strong>meaningfully motivated experience</strong> at a time and adapts the next route from what you actually say.</p>
      </section>

      <section class="wlp-ai-panel" aria-labelledby="wlp-ai-method-title">
        <div class="wlp-ai-panel-head">
          <div><span class="section-kicker">Step 2</span><h2 id="wlp-ai-method-title">Adaptive AI Study</h2></div>
        </div>
        <article class="wlp-ai-method-card">
          <div class="wlp-ai-method-icon" aria-hidden="true">AI</div>
          <div class="wlp-ai-method-copy">
            <div class="wlp-ai-method-status"><span>Provider-agnostic</span><span class="wlp-ai-provider-pill" id="wlp-ai-provider-pill">Checking connection…</span></div>
            <strong>Experience → Response → Learning Route</strong>
            <p>Existing Review, Study Q, Learning Layer, route evidence, and learner-generated neighbors can guide the next experience. Natural alternatives are evidence, not automatic mistakes.</p>
          </div>
        </article>
        <div class="wlp-ai-mode-warning" id="wlp-ai-mode-warning" hidden></div>
        <p class="wlp-ai-note">Step 1 above is shared with Standard Practice. Card coverage is intentionally ignored here: AI Study can use the broader card data and learning history. A normal turn usually uses one planner call and one interpreter call.</p>
      </section>

      <section class="wlp-ai-start-panel" id="wlp-ai-start-panel">
        <button class="wlp-ai-start-button" id="wlp-ai-start" type="button">Start AI Experience</button>
        <p class="wlp-ai-start-note" id="wlp-ai-start-note">Your selected source and session size are captured when the AI session starts. Standard Practice remains fully usable without AI.</p>
      </section>

      <section class="wlp-ai-experience" id="wlp-ai-experience" hidden aria-live="polite">
        <div class="wlp-ai-experience-topline">
          <span class="wlp-ai-source-pill" id="wlp-ai-source-pill">AI Study</span>
          <div class="wlp-ai-experience-topline-right"><button class="wlp-ai-end-button" id="wlp-ai-end" type="button">End session</button><span id="wlp-ai-progress">1 / 1</span></div>
        </div>
        <div class="wlp-ai-experience-card">
          <span class="section-kicker" id="wlp-ai-experience-label">Adaptive experience</span>
          <h2 id="wlp-ai-domain" hidden></h2>
          <p class="wlp-ai-prompt" id="wlp-ai-prompt"></p>
          <p class="wlp-ai-frame" id="wlp-ai-frame" hidden></p>
          <span class="wlp-ai-visible-target" id="wlp-ai-visible-target" hidden></span>
        </div>
        <label class="wlp-ai-response-field" for="wlp-ai-response">
          <span id="wlp-ai-response-label">What would you naturally say?</span>
          <textarea id="wlp-ai-response" rows="3" placeholder="Type the expression or sentence that comes naturally."></textarea>
          <small>Do not force the WLP target. A natural alternative is useful learning evidence too.</small>
        </label>
        <div class="wlp-ai-actions">
          <button class="wlp-ai-submit-button" id="wlp-ai-submit" type="button">Interpret my response</button>
          <button class="wlp-ai-secondary-button" id="wlp-ai-no-idea" type="button">No idea</button>
        </div>
        <p class="wlp-ai-status" id="wlp-ai-status"></p>
        <section class="wlp-ai-feedback" id="wlp-ai-feedback" hidden>
          <div class="wlp-ai-feedback-head"><strong id="wlp-ai-feedback-target"></strong><span class="wlp-ai-route-pill" id="wlp-ai-route-pill"></span></div>
          <p class="wlp-ai-feedback-text" id="wlp-ai-feedback-text"></p>
          <p class="wlp-ai-correction" id="wlp-ai-correction" hidden></p>
          <div class="wlp-ai-evidence" id="wlp-ai-evidence"></div>
          <div class="wlp-ai-next-wrap"><small id="wlp-ai-next-note"></small><button class="wlp-ai-next-button" id="wlp-ai-next" type="button">Next experience</button></div>
        </section>
      </section>

      <section class="wlp-ai-finished" id="wlp-ai-finished" hidden>
        <span class="section-kicker">AI Study</span><h2>Session complete.</h2>
        <p>Each interpreted response was merged through WLP's controlled data layer. The next AI session can build from the route evidence saved here.</p>
        <div class="wlp-ai-finished-stats" id="wlp-ai-finished-stats"></div>
        <button class="wlp-ai-secondary-button" id="wlp-ai-again" type="button">Start another AI session</button>
      </section>`;
    sourcePanel.insertAdjacentElement('afterend', aiRoot);
  }

  function setMode(mode, persist = true) {
    state.mode = mode === 'ai' ? 'ai' : 'standard';
    document.body.classList.toggle('wlp-ai-study-mode', state.mode === 'ai');
    document.querySelectorAll('[data-wlp-practice-mode]').forEach(button => {
      const active = button.dataset.wlpPracticeMode === state.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (persist) {
      try { localStorage.setItem(MODE_KEY, state.mode); } catch (_) {}
    }
    if (state.mode === 'ai') refreshProviderStatus();
  }

  function setBusy(busy, message = '') {
    state.busy = Boolean(busy);
    ['#wlp-ai-start', '#wlp-ai-submit', '#wlp-ai-no-idea', '#wlp-ai-next', '#wlp-ai-end'].forEach(selector => {
      const el = $(selector);
      if (el) el.disabled = state.busy;
    });
    if (message) setStatus(message);
  }

  function setStatus(message, isError = false) {
    const el = $('#wlp-ai-status');
    if (!el) return;
    el.textContent = clean(message);
    el.classList.toggle('is-error', Boolean(isError));
  }

  function renderProviderWarning() {
    const warning = $('#wlp-ai-mode-warning');
    if (!warning) return;
    const transport = window.WLPAIStudyTransport;
    const mode = transport?.getMode?.() || 'mock';
    if (mode === 'real') {
      warning.hidden = true;
      warning.textContent = '';
      return;
    }
    warning.hidden = false;
    warning.textContent = '';
    const text = document.createTextNode('AI transport is currently in local Mock mode. The general Study Hub needs Real mode for arbitrary WLP cards.');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Use Real AI';
    button.addEventListener('click', () => {
      try {
        transport.setMode('real');
        renderProviderWarning();
        refreshProviderStatus();
      } catch (error) {
        warning.appendChild(document.createTextNode(` ${error.message}`));
      }
    });
    warning.append(text, button);
  }

  async function refreshProviderStatus() {
    const pill = $('#wlp-ai-provider-pill');
    const start = $('#wlp-ai-start');
    renderProviderWarning();
    if (!pill) return;
    pill.classList.remove('is-ready', 'is-error');
    pill.textContent = 'Checking connection…';
    try {
      const { transport } = requireLayers();
      const mode = transport.getMode();
      if (mode !== 'real') {
        state.providerInfo = { provider: 'local-fixture', model: 'mock', configured: true };
        state.providerReady = false;
        pill.textContent = 'Local mock · developer fixture';
        if (start && !state.session) start.disabled = true;
        return;
      }
      const info = await transport.getProviderInfo();
      state.providerInfo = info;
      state.providerReady = info?.ok === true && info?.configured === true;
      const provider = clean(info?.provider || 'AI');
      const model = clean(info?.model);
      pill.textContent = [provider, model].filter(Boolean).join(' · ');
      pill.classList.toggle('is-ready', state.providerReady);
      pill.classList.toggle('is-error', !state.providerReady);
      if (start && !state.session) start.disabled = !state.providerReady;
    } catch (error) {
      state.providerReady = false;
      pill.textContent = 'AI connection unavailable';
      pill.classList.add('is-error');
      if (start && !state.session) start.disabled = true;
    }
  }

  async function buildCandidateContext(session) {
    const { data } = requireLayers();
    const source = session.source;
    const base = {
      sessionId: session.sessionId,
      sourceMode: source.mode,
      sourceLabel: source.label,
      difficulty: 'adaptive',
      maxCandidates: MAX_CANDIDATES
    };
    if (source.mode === 'review') {
      const wordIds = reviewWordIds(MAX_CANDIDATES);
      if (!wordIds.length) throw new Error('No cards are currently marked Review. Choose a deck or deck range, or mark cards for Review first.');
      return data.assembleCandidateContext({ ...base, wordIds });
    }
    if (source.mode === 'deck') return data.assembleCandidateContext({ ...base, deck: source.deck });
    if (source.mode === 'range') return data.assembleCandidateContext({ ...base, rangeStart: source.rangeStart, rangeEnd: source.rangeEnd });
    throw new Error(`Unsupported AI Study source: ${source.mode}`);
  }

  async function buildFreshPlannerRequest(session) {
    const { data, contract } = requireLayers();
    const candidateContext = await buildCandidateContext(session);
    if (!candidateContext?.candidates?.length) throw new Error('No AI Study candidates were found for this source.');
    const ranked = rankCandidates(candidateContext.candidates, session);
    const packetCandidates = ranked.slice(0, MAX_TARGET_PACKETS);
    const targetPackets = await Promise.all(packetCandidates.map(item => data.assembleTargetContext(item.wordId)));
    const request = data.buildPlannerWriterRequest({
      session: {
        sessionId: session.sessionId,
        mode: 'ai-study',
        sourceMode: session.source.mode,
        sourceLabel: session.source.label,
        difficulty: 'adaptive'
      },
      candidateContext,
      learnerSessionState: candidateContext.learnerSessionState,
      targetPackets,
      plannerConstraints: {
        maxTargets: 1,
        allowMultiTarget: false,
        avoidRecentRouteRepetition: true,
        naturalnessGateRequired: true,
        targetNeedNotBeExplicit: true
      }
    });
    const validation = contract.validatePlannerRequest(request);
    if (!validation.valid) throw new Error(`Planner request rejected: ${validation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);
    return { request, rankedCandidates: ranked, targetPackets };
  }

  function addUsage(meta, kind) {
    const session = state.session;
    if (!session) return;
    session.successfulAICalls += 1;
    session.providerAttempts += Math.max(1, num(meta?.transportAttemptCount) || 1);
    session.lastCallKind = kind;
  }

  function renderExperience(plannerResult) {
    const response = plannerResult.response;
    const experience = response.experience || {};
    const selected = response.selectedTarget || {};
    $('#wlp-ai-experience').hidden = false;
    $('#wlp-ai-finished').hidden = true;
    $('#wlp-ai-feedback').hidden = true;
    $('#wlp-ai-source-pill').textContent = state.session.source.label;
    $('#wlp-ai-progress').textContent = `${state.session.completed + 1} / ${state.session.total}`;
    const domain = clean(experience.domain);
    const domainEl = $('#wlp-ai-domain');
    domainEl.textContent = domain;
    domainEl.hidden = !domain;
    $('#wlp-ai-experience-label').textContent = clean(experience.type || response.learningOpportunity?.direction || 'Adaptive experience').replace(/-/g, ' ');
    $('#wlp-ai-prompt').textContent = clean(experience.prompt);
    const frame = clean(experience.responseFrame);
    const frameEl = $('#wlp-ai-frame');
    frameEl.textContent = frame ? frame.replace(/\{answer\}/g, '______') : '';
    frameEl.hidden = !frame;
    const visibleTarget = $('#wlp-ai-visible-target');
    const visibility = clean(experience.targetVisibility).toLowerCase();
    if (visibility === 'visible') {
      visibleTarget.textContent = `Target: ${clean(selected.target)}`;
      visibleTarget.hidden = false;
    } else if (visibility === 'partial') {
      visibleTarget.textContent = `Target family: ${(selected.targetFamily || []).join(' / ')}`;
      visibleTarget.hidden = false;
    } else {
      visibleTarget.hidden = true;
      visibleTarget.textContent = '';
    }
    const responseBox = $('#wlp-ai-response');
    responseBox.value = '';
    responseBox.disabled = false;
    $('#wlp-ai-submit').hidden = false;
    $('#wlp-ai-no-idea').hidden = false;
    $('#wlp-ai-submit').disabled = false;
    $('#wlp-ai-no-idea').disabled = false;
    setStatus('');
    responseBox.focus({ preventScroll: true });
    $('#wlp-ai-experience').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadNextExperience() {
    if (!state.session || state.busy) return;
    setBusy(true, 'Building a fresh learning context locally…');
    $('#wlp-ai-feedback').hidden = true;
    try {
      const { transport } = requireLayers();
      const built = await buildFreshPlannerRequest(state.session);
      setStatus('Creating the next adaptive experience…');
      const plannerResult = await transport.callPlannerWriter(built.request);
      addUsage(plannerResult.meta, 'planner');
      state.activePlanner = {
        request: built.request,
        result: plannerResult,
        eventId: makeId('ai-study-event')
      };
      const selectedId = clean(plannerResult.response?.selectedTarget?.wordId);
      if (selectedId) state.session.usedTargets[selectedId] = (state.session.usedTargets[selectedId] || 0) + 1;
      renderExperience(plannerResult);
    } catch (error) {
      state.activePlanner = null;
      setStatus(formatAIError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function plannerExperienceForInterpreter(response) {
    const experience = response?.experience || {};
    return {
      ...clone(experience),
      experienceGrounding: clone(response?.experienceGrounding || null),
      messageCore: clone(response?.messageCore || null),
      communicativeFocus: clone(response?.communicativeFocus || null),
      construal: clean(response?.communicativeFocus?.construal),
      usageMotivation: clone(response?.usageMotivation || null)
    };
  }

  async function interpretResponse(forcedText = '') {
    if (!state.session || !state.activePlanner || state.busy) return;
    const text = clean(forcedText || $('#wlp-ai-response')?.value);
    if (!text) {
      setStatus('Type a response, or choose “No idea.”', true);
      return;
    }
    setBusy(true, 'Interpreting your response and updating the learning route…');
    try {
      const { data, transport } = requireLayers();
      const plannerResponse = state.activePlanner.result.response;
      const selected = plannerResponse.selectedTarget;
      const interpretationContext = await data.assembleInterpretationContext({
        wordId: clean(selected.wordId),
        learningOpportunity: plannerResponse.learningOpportunity,
        experience: plannerExperienceForInterpreter(plannerResponse),
        learnerResponse: { text, rawTranscript: text, inputMode: 'text' }
      });
      const interpreterRequest = data.buildInterpreterRouterRequest({
        session: { sessionId: state.session.sessionId },
        interpretationContext
      });
      const interpreterResult = await transport.callInterpreterRouter(interpreterRequest, { eventId: state.activePlanner.eventId });
      addUsage(interpreterResult.meta, 'interpreter');
      const committed = data.commitInterpreterTurn({
        request: interpreterRequest,
        result: interpreterResult,
        eventId: state.activePlanner.eventId
      });
      state.session.completed += 1;
      state.session.committedEvents.push(committed.eventId);
      renderFeedback(interpreterResult.response, committed);
    } catch (error) {
      setStatus(formatAIError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function renderFeedback(response, committed) {
    const target = clean(response?.interpretation?.targetProduced ? state.activePlanner?.result?.response?.selectedTarget?.target : state.activePlanner?.result?.response?.selectedTarget?.target);
    $('#wlp-ai-feedback-target').textContent = target || 'AI Study';
    const action = clean(response?.router?.action || 'NEXT');
    $('#wlp-ai-route-pill').textContent = action;
    $('#wlp-ai-feedback-text').textContent = clean(response?.learnerFacingResponse?.feedback || response?.evidence?.observationSummary || 'Response interpreted.');
    const correction = $('#wlp-ai-correction');
    const suggested = clean(response?.learnerFacingResponse?.suggestedNaturalForm);
    if (response?.learnerFacingResponse?.correctionNeeded && suggested) {
      correction.textContent = `Natural form: ${suggested}`;
      correction.hidden = false;
    } else {
      correction.textContent = '';
      correction.hidden = true;
    }
    const evidence = $('#wlp-ai-evidence');
    evidence.textContent = '';
    const evidenceTypes = Array.isArray(response?.evidence?.evidenceTypes) ? response.evidence.evidenceTypes : [];
    const classes = Array.isArray(response?.interpretation?.responseClasses) ? response.interpretation.responseClasses : [];
    [...classes, ...evidenceTypes].slice(0, 8).forEach(value => {
      const chip = document.createElement('span');
      chip.textContent = clean(value).replace(/-/g, ' ');
      evidence.appendChild(chip);
    });
    const nextNote = $('#wlp-ai-next-note');
    nextNote.textContent = clean(response?.router?.reason || response?.evidence?.observationSummary || 'The next experience will use the newly merged route state.');
    const nextButton = $('#wlp-ai-next');
    const done = state.session.completed >= state.session.total;
    nextButton.textContent = done ? 'Finish session' : 'Next experience';
    $('#wlp-ai-feedback').hidden = false;
    $('#wlp-ai-response').disabled = true;
    $('#wlp-ai-submit').hidden = true;
    $('#wlp-ai-no-idea').hidden = true;
    $('#wlp-ai-progress').textContent = `${state.session.completed} / ${state.session.total}`;
    setStatus(committed?.idempotent ? 'Already saved — no duplicate merge was created.' : 'Learning evidence saved to WLP.');
  }

  function formatAIError(error) {
    const parts = [clean(error?.message) || 'AI Study request failed.'];
    if (clean(error?.quotaScope) === 'daily') parts.push('Daily provider quota reached.');
    if (clean(error?.resetPolicy) === 'midnight-pacific') parts.push('Daily quota resets at midnight Pacific Time.');
    if (num(error?.attemptCount) > 1) parts.push(`Provider attempts: ${num(error.attemptCount)}.`);
    return parts.join(' ');
  }

  function beginSession() {
    if (state.busy) return;
    const transportMode = window.WLPAIStudyTransport?.getMode?.() || 'mock';
    if (transportMode !== 'real') {
      setStatus('Switch AI transport to Real mode before starting a general WLP AI Study session.', true);
      renderProviderWarning();
      return;
    }
    state.session = {
      sessionId: makeId('ai-session'),
      source: snapshotSource(),
      total: selectedSessionSize(),
      completed: 0,
      usedTargets: {},
      committedEvents: [],
      successfulAICalls: 0,
      providerAttempts: 0,
      startedAt: new Date().toISOString()
    };
    state.activePlanner = null;
    $('#wlp-ai-start-panel').hidden = true;
    $('#wlp-ai-finished').hidden = true;
    $('#wlp-ai-experience').hidden = false;
    loadNextExperience();
  }

  function finishSession() {
    if (!state.session) return;
    const session = state.session;
    $('#wlp-ai-experience').hidden = true;
    $('#wlp-ai-finished').hidden = false;
    const stats = $('#wlp-ai-finished-stats');
    stats.textContent = '';
    const items = [
      `${session.completed} experiences`,
      `${session.successfulAICalls} AI calls`,
      `${session.providerAttempts} provider attempts`,
      session.source.label
    ];
    items.forEach(text => {
      const span = document.createElement('span');
      span.textContent = text;
      stats.appendChild(span);
    });
    state.activePlanner = null;
  }

  function resetSession() {
    state.session = null;
    state.activePlanner = null;
    $('#wlp-ai-experience').hidden = true;
    $('#wlp-ai-finished').hidden = true;
    $('#wlp-ai-start-panel').hidden = false;
    $('#wlp-ai-start').disabled = !state.providerReady;
    setStatus('');
    refreshProviderStatus();
  }

  function bindEvents() {
    document.querySelectorAll('[data-wlp-practice-mode]').forEach(button => {
      button.addEventListener('click', () => setMode(button.dataset.wlpPracticeMode));
    });
    $('#wlp-ai-start')?.addEventListener('click', beginSession);
    $('#wlp-ai-submit')?.addEventListener('click', () => interpretResponse());
    $('#wlp-ai-no-idea')?.addEventListener('click', () => interpretResponse("I don't know."));
    $('#wlp-ai-next')?.addEventListener('click', () => {
      if (!state.session) return;
      if (state.session.completed >= state.session.total) finishSession();
      else loadNextExperience();
    });
    $('#wlp-ai-end')?.addEventListener('click', finishSession);
    $('#wlp-ai-again')?.addEventListener('click', resetSession);
    $('#wlp-ai-response')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') interpretResponse();
    });
  }

  function init() {
    injectUI();
    bindEvents();
    let stored = 'standard';
    try { stored = localStorage.getItem(MODE_KEY) || 'standard'; } catch (_) {}
    setMode(stored === 'ai' ? 'ai' : 'standard', false);
    window.WLPAIStudyUI = Object.freeze({
      version: VERSION,
      getMode: () => state.mode,
      getState: () => clone({
        mode: state.mode,
        providerReady: state.providerReady,
        providerInfo: state.providerInfo,
        session: state.session,
        activeTarget: state.activePlanner?.result?.response?.selectedTarget || null,
        busy: state.busy
      }),
      refreshProviderStatus,
      setMode
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
