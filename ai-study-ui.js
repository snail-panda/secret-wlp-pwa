/* WLP Stage 7 — AI Study history + quick card + session insights v1.8.6.56 R2-C
   Provider-agnostic UI adapter for existing AI Study Data / Contract / Transport layers. */
(() => {
  'use strict';

  const VERSION = '1.3.0';
  const MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const SESSION_HISTORY_KEY = 'wlp:ai-study-session-history:v1';
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

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function readSessionHistory() {
    const raw = readJson(SESSION_HISTORY_KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  function saveSessionHistory(record) {
    if (!record?.sessionId || !num(record.completed)) return true;
    const history = readSessionHistory().filter(item => clean(item?.sessionId) !== clean(record.sessionId));
    history.unshift(clone(record));
    return writeJson(SESSION_HISTORY_KEY, history);
  }

  function currentTargetPacket() {
    const selectedId = clean(state.activePlanner?.result?.response?.selectedTarget?.wordId);
    const packets = Array.isArray(state.activePlanner?.request?.targetPackets) ? state.activePlanner.request.targetPackets : [];
    return packets.find(packet => clean(packet?.target?.wordId) === selectedId) || null;
  }

  function cardSnapshotFromPacket(packet, selected = null) {
    const p = packet && typeof packet === 'object' ? packet : {};
    const target = p.target && typeof p.target === 'object' ? p.target : {};
    const meta = p.learningMetadata && typeof p.learningMetadata === 'object' ? p.learningMetadata : {};
    const selectedTarget = selected && typeof selected === 'object' ? selected : {};
    return {
      wordId: clean(target.wordId || selectedTarget.wordId),
      headword: clean(target.headword || selectedTarget.target),
      pos: clean(target.pos),
      definition: clean(target.definition),
      synonyms: clean(target.synonyms),
      examples: clean(target.examples),
      notes: clean(target.notes),
      targetFamily: Array.isArray(target.targetFamily) ? target.targetFamily.map(clean).filter(Boolean).slice(0, 8) : [],
      learningMetadata: {
        senseHook: clean(meta.senseHook),
        memoryHook: clean(meta.memoryHook),
        situations: Array.isArray(meta.situations) ? meta.situations.slice(0, 3).map(item => clone(item)) : []
      }
    };
  }

  function currentCardSnapshot() {
    return cardSnapshotFromPacket(currentTargetPacket(), state.activePlanner?.result?.response?.selectedTarget || null);
  }

  function addPeekField(container, label, value) {
    const textValue = clean(value);
    if (!textValue) return;
    const row = document.createElement('div');
    row.className = 'wlp-ai-peek-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('p');
    val.textContent = textValue;
    row.append(key, val);
    container.appendChild(row);
  }

  function renderCardPeek(card, container) {
    if (!container) return;
    container.textContent = '';
    const data = card && typeof card === 'object' ? card : {};
    const head = document.createElement('div');
    head.className = 'wlp-ai-peek-head';
    const title = document.createElement('strong');
    title.textContent = clean(data.headword) || 'WLP card';
    const meta = document.createElement('small');
    meta.textContent = [clean(data.wordId) ? `WID ${clean(data.wordId)}` : '', clean(data.pos)].filter(Boolean).join(' · ');
    head.append(title, meta);
    container.appendChild(head);
    addPeekField(container, 'Definition', data.definition);
    addPeekField(container, 'Synonyms', data.synonyms);
    addPeekField(container, 'Examples', data.examples);
    addPeekField(container, 'Notes', data.notes);
    addPeekField(container, 'Sense hook', data.learningMetadata?.senseHook);
    addPeekField(container, 'Memory hook', data.learningMetadata?.memoryHook);
    const situations = Array.isArray(data.learningMetadata?.situations) ? data.learningMetadata.situations : [];
    if (situations.length) {
      const textValue = situations.map((item, index) => {
        if (typeof item === 'string') return `${index + 1}. ${clean(item)}`;
        const titleText = clean(item?.title || item?.label);
        const anchor = clean(item?.anchor || item?.situation || item?.text || item?.context || item?.example);
        return `${index + 1}. ${[titleText, anchor].filter(Boolean).join(' — ')}`;
      }).filter(Boolean).join('\n');
      addPeekField(container, 'Situations', textValue);
    }
    if (container.children.length === 1) addPeekField(container, 'Card data', 'No additional card details were available in this AI Study packet.');
  }

  function turnSnapshot(response, learnerText, turnDiagnostics = {}) {
    const planner = state.activePlanner?.result?.response || {};
    const selected = planner.selectedTarget || {};
    const exp = planner.experience || {};
    const learner = response?.learnerFacingResponse || {};
    return {
      eventId: clean(state.activePlanner?.eventId),
      completedAt: new Date().toISOString(),
      target: clean(selected.target),
      wordId: clean(selected.wordId),
      domain: clean(exp.domain),
      experienceType: clean(exp.type || planner.learningOpportunity?.direction),
      prompt: clean(exp.prompt),
      responseFrame: clean(exp.responseFrame),
      learnerResponse: clean(learnerText),
      targetFeedback: clean(learner.targetFeedback || learner.feedback || response?.evidence?.observationSummary),
      languageFeedback: clean(learner.languageFeedback),
      languageObservations: Array.isArray(learner.languageObservations) ? learner.languageObservations.map(item => ({
        category: clean(item?.category),
        assessment: clean(item?.assessment),
        summary: clean(item?.summary)
      })).filter(item => item.category && item.assessment && item.summary).slice(0, 3) : [],
      nextStep: clean(learner.nextStep),
      correctionNeeded: learner.correctionNeeded === true,
      suggestedNaturalForm: clean(learner.suggestedNaturalForm),
      responseClasses: Array.isArray(response?.interpretation?.responseClasses) ? response.interpretation.responseClasses.map(clean).filter(Boolean) : [],
      conceptMatched: response?.interpretation?.conceptMatched === true,
      targetProduced: response?.interpretation?.targetProduced === true,
      targetFamilyReached: response?.interpretation?.targetFamilyReached === true,
      learnerExpressionNatural: response?.communicativeInterpretation?.learnerExpressionNatural === true,
      diagnostics: {
        routerAction: clean(response?.router?.action),
        routerReason: clean(response?.router?.reason),
        evidenceTypes: Array.isArray(response?.evidence?.evidenceTypes) ? response.evidence.evidenceTypes.map(clean).filter(Boolean) : [],
        observationSummary: clean(response?.evidence?.observationSummary),
        plannerElapsed: num(state.activePlanner?.diagnostics?.elapsedMs),
        interpreterElapsed: num(turnDiagnostics.interpreterElapsed),
        provider: clean(turnDiagnostics.provider || state.session?.provider),
        model: clean(turnDiagnostics.model || state.session?.model)
      }
    };
  }

  function uniqueTexts(values, limit = 3) {
    const out = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach(value => {
      const textValue = clean(value);
      const key = textValue.toLowerCase();
      if (!textValue || seen.has(key) || out.length >= limit) return;
      seen.add(key);
      out.push(textValue);
    });
    return out;
  }

  const LANGUAGE_CATEGORY_LABELS = Object.freeze({
    grammar: 'grammar',
    articles: 'article choice',
    'tense-aspect': 'tense / aspect',
    number: 'singular / plural',
    prepositions: 'preposition choice',
    'word-order': 'word order',
    idiomaticity: 'idiomatic wording',
    'tone-register': 'tone / register',
    concision: 'concision',
    'sentence-packaging': 'sentence packaging',
    other: 'other language use'
  });

  function languageObservationGroups(turns) {
    const groups = new Map();
    (Array.isArray(turns) ? turns : []).forEach((turn, turnIndex) => {
      (Array.isArray(turn?.languageObservations) ? turn.languageObservations : []).forEach(item => {
        const category = clean(item?.category) || 'other';
        const assessment = clean(item?.assessment);
        const summary = clean(item?.summary);
        if (!summary || !['strength','improve'].includes(assessment)) return;
        const key = `${assessment}:${category}`;
        if (!groups.has(key)) groups.set(key, { category, assessment, summaries: [], turns: new Set() });
        const group = groups.get(key);
        group.turns.add(turnIndex);
        if (!group.summaries.some(value => value.toLowerCase() === summary.toLowerCase())) group.summaries.push(summary);
      });
    });
    return Array.from(groups.values()).map(group => ({ ...group, count: group.turns.size }));
  }

  function buildSessionInsights(turnsInput) {
    const turns = Array.isArray(turnsInput) ? turnsInput : [];
    const total = turns.length;
    if (!total) {
      return {
        whatWentWell: 'No interpreted experience was completed.',
        patterns: 'No session pattern is available yet.',
        worthRevisiting: 'Complete an experience to create reviewable learning evidence.',
        nextFocus: 'Start a new AI experience when you are ready.',
        evidenceNote: 'No completed turn means there is no learner evidence to aggregate.'
      };
    }

    const produced = turns.filter(turn => turn?.targetProduced || turn?.targetFamilyReached).length;
    const concept = turns.filter(turn => turn?.conceptMatched).length;
    const natural = turns.filter(turn => turn?.learnerExpressionNatural).length;
    const groups = languageObservationGroups(turns);
    const strengths = groups.filter(group => group.assessment === 'strength').sort((a,b) => b.count - a.count);
    const improvements = groups.filter(group => group.assessment === 'improve').sort((a,b) => b.count - a.count);

    const well = [];
    if (produced) well.push(`${produced}/${total} completed turn${total === 1 ? '' : 's'} reached the WLP target or target family.`);
    else if (concept) well.push(`${concept}/${total} completed turn${total === 1 ? '' : 's'} matched the intended concept even when the exact WLP target was not produced.`);
    if (natural) well.push(`Your response was judged natural in ${natural}/${total} completed turn${total === 1 ? '' : 's'}.`);
    strengths.slice(0, 2).forEach(group => {
      const label = LANGUAGE_CATEGORY_LABELS[group.category] || group.category;
      const sample = group.summaries[0];
      well.push(total > 1 && group.count > 1 ? `${label} was a strength in ${group.count} turns. ${sample}` : sample);
    });
    if (!well.length) well.push('The completed turn(s) created usable learning evidence even though no broad strength was promoted from this session alone.');

    let patterns = '';
    if (total === 1) {
      patterns = 'Only one turn was completed, so this is a session observation rather than a repeated pattern.';
    } else {
      const repeated = [...strengths, ...improvements].filter(group => group.count >= 2).slice(0, 3);
      patterns = repeated.length
        ? repeated.map(group => `${LANGUAGE_CATEGORY_LABELS[group.category] || group.category}: ${group.count}/${total} turns (${group.assessment === 'strength' ? 'strength' : 'worth attention'}).`).join(' ')
        : 'No language issue repeated often enough inside this session to call it a session-level pattern.';
    }

    const revisit = [];
    improvements.slice(0, 3).forEach(group => {
      const label = LANGUAGE_CATEGORY_LABELS[group.category] || group.category;
      revisit.push(`${label}: ${group.summaries[0]}`);
    });
    const mismatchCounts = new Map();
    turns.forEach(turn => (turn?.responseClasses || []).forEach(cls => {
      if (!['form-mismatch','sense-mismatch','register-mismatch'].includes(cls)) return;
      mismatchCounts.set(cls, (mismatchCounts.get(cls) || 0) + 1);
    }));
    mismatchCounts.forEach((count, cls) => {
      const label = cls === 'form-mismatch' ? 'target form / construction' : cls === 'sense-mismatch' ? 'target sense' : 'register fit';
      if (!revisit.some(text => text.toLowerCase().includes(label))) revisit.push(`${label}: appeared in ${count} completed turn${count === 1 ? '' : 's'}.`);
    });

    const nextSteps = uniqueTexts(turns.map(turn => turn?.nextStep), 2);
    return {
      whatWentWell: well.join(' '),
      patterns,
      worthRevisiting: revisit.length ? revisit.slice(0, 3).join(' ') : 'No repeated or high-priority issue stood out in the completed turn(s).',
      nextFocus: nextSteps.length ? nextSteps.join(' ') : 'Future AI Study can adapt from the saved evidence.',
      evidenceNote: total < 3
        ? 'This is session evidence, not yet a stable long-term learner tendency. Repeated patterns across future sessions can become stronger learner-profile signals.'
        : 'Session patterns are useful evidence, but long-term learner tendencies still require corroboration across multiple targets, contexts, and sessions.'
    };
  }

  function sessionRecord(session) {
    return {
      sessionId: clean(session.sessionId),
      startedAt: clean(session.startedAt),
      endedAt: new Date().toISOString(),
      source: clone(session.source),
      total: num(session.total),
      completed: num(session.completed),
      completedAll: num(session.completed) >= num(session.total),
      turns: clone(Array.isArray(session.turns) ? session.turns : []),
      insights: buildSessionInsights(session.turns),
      provider: clean(session.provider),
      model: clean(session.model),
      diagnostics: {
        successfulAICalls: num(session.successfulAICalls),
        failedAICalls: num(session.failedAICalls),
        providerAttempts: num(session.providerAttempts),
        inputTokens: num(session.inputTokens),
        outputTokens: num(session.outputTokens),
        totalTokens: num(session.totalTokens),
        plannerLatencyMs: averageSuccessfulLatency(session.plannerLatencies),
        interpreterLatencyMs: averageSuccessfulLatency(session.interpreterLatencies)
      }
    };
  }

  function formatHistoryDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Saved session';
    try { return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (_) { return date.toLocaleString(); }
  }

  function makeTurnReviewCard(turn, index, { includePeek = true } = {}) {
    const article = document.createElement('article');
    article.className = 'wlp-ai-turn-review-card';
    const head = document.createElement('div');
    head.className = 'wlp-ai-turn-review-head';
    const title = document.createElement('strong');
    title.textContent = `${index + 1}. ${clean(turn?.target) || 'AI experience'}`;
    const meta = document.createElement('small');
    meta.textContent = [clean(turn?.wordId) ? `WID ${clean(turn.wordId)}` : '', clean(turn?.experienceType).replace(/-/g, ' '), clean(turn?.domain)].filter(Boolean).join(' · ');
    head.append(title, meta);
    article.appendChild(head);
    addPeekField(article, 'Prompt', turn?.prompt);
    addPeekField(article, 'Your response', turn?.learnerResponse);
    addPeekField(article, 'Target feedback', turn?.targetFeedback);
    addPeekField(article, 'Language feedback', turn?.languageFeedback);
    addPeekField(article, 'Next step', turn?.nextStep);
    if (turn?.correctionNeeded && clean(turn?.suggestedNaturalForm)) addPeekField(article, 'Natural form', turn.suggestedNaturalForm);
    if (includePeek && clean(turn?.wordId)) {
      const actions = document.createElement('div');
      actions.className = 'wlp-ai-turn-card-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wlp-ai-quick-card-button';
      button.dataset.quickCardWordId = clean(turn.wordId);
      button.textContent = `View ${clean(turn?.target) || 'target'} card`;
      actions.appendChild(button);
      article.appendChild(actions);
    }
    return article;
  }

  function renderSessionReview(session) {
    const review = $('#wlp-ai-session-review');
    if (!review) return;
    const turns = Array.isArray(session?.turns) ? session.turns : [];
    review.hidden = !turns.length;
    if (!turns.length) return;

    const targets = $('#wlp-ai-session-targets');
    targets.textContent = '';
    uniqueTexts(turns.map(turn => clean(turn?.target)), 12).forEach((value, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wlp-ai-session-target-chip';
      chip.textContent = value;
      const turn = turns.find(item => clean(item?.target).toLowerCase() === value.toLowerCase());
      if (clean(turn?.wordId)) chip.dataset.quickCardWordId = clean(turn.wordId);
      targets.appendChild(chip);
    });

    const insights = session?.insights && typeof session.insights === 'object' ? session.insights : buildSessionInsights(turns);
    $('#wlp-ai-session-well').textContent = clean(insights.whatWentWell);
    $('#wlp-ai-session-patterns').textContent = clean(insights.patterns);
    $('#wlp-ai-session-revisit').textContent = clean(insights.worthRevisiting);
    $('#wlp-ai-session-next-focus').textContent = clean(insights.nextFocus);
    $('#wlp-ai-session-evidence-note').textContent = clean(insights.evidenceNote);

    const list = $('#wlp-ai-session-turns-list');
    list.textContent = '';
    turns.forEach((turn, index) => list.appendChild(makeTurnReviewCard(turn, index)));
  }

  function renderHistory() {
    const details = $('#wlp-ai-history');
    const list = $('#wlp-ai-history-list');
    const label = $('#wlp-ai-history-label');
    if (!details || !list) return;
    const history = readSessionHistory().slice().sort((a, b) => {
      const aTime = Date.parse(a?.endedAt || a?.startedAt || '') || 0;
      const bTime = Date.parse(b?.endedAt || b?.startedAt || '') || 0;
      return bTime - aTime;
    });
    details.hidden = !history.length;
    if (label) label.textContent = `AI Study History (${history.length})`;
    list.textContent = '';
    history.forEach(record => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wlp-ai-history-item';
      button.dataset.sessionId = clean(record.sessionId);
      const targets = uniqueTexts((record.turns || []).map(turn => turn?.target), 3).join(', ');
      const strong = document.createElement('strong');
      strong.textContent = formatHistoryDate(record.endedAt || record.startedAt);
      const meta = document.createElement('span');
      meta.textContent = `${num(record.completed)} experience${num(record.completed) === 1 ? '' : 's'}${targets ? ` · ${targets}` : ''}`;
      button.append(strong, meta);
      list.appendChild(button);
    });
  }

  function openHistorySession(sessionId) {
    const record = readSessionHistory().find(item => clean(item?.sessionId) === clean(sessionId));
    if (!record) return;
    const panel = $('#wlp-ai-history-review');
    const body = $('#wlp-ai-history-review-body');
    panel.hidden = false;
    $('#wlp-ai-history-review-title').textContent = `${formatHistoryDate(record.endedAt || record.startedAt)} · ${num(record.completed)} experience${num(record.completed) === 1 ? '' : 's'}`;
    body.textContent = '';
    const note = document.createElement('p');
    note.className = 'wlp-ai-history-summary';
    note.textContent = `Saved from ${clean(record.source?.label) || 'AI Study'}. This is the original prompt, response, feedback, and session-level review from that session.`;
    body.appendChild(note);
    const turns = Array.isArray(record.turns) ? record.turns : [];
    const insights = record.insights && typeof record.insights === 'object' ? record.insights : buildSessionInsights(turns);
    const summary = document.createElement('section');
    summary.className = 'wlp-ai-history-insights';
    [
      ['What went well', insights.whatWentWell],
      ['Patterns noticed', insights.patterns],
      ['Worth revisiting', insights.worthRevisiting],
      ['Next focus', insights.nextFocus]
    ].forEach(([label, value]) => {
      const block = document.createElement('div');
      block.className = 'wlp-ai-history-insight';
      const key = document.createElement('span');
      key.textContent = label;
      const copy = document.createElement('p');
      copy.textContent = clean(value);
      block.append(key, copy);
      summary.appendChild(block);
    });
    body.appendChild(summary);
    turns.forEach((turn, index) => body.appendChild(makeTurnReviewCard(turn, index)));
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <details class="wlp-ai-history" id="wlp-ai-history" hidden>
          <summary id="wlp-ai-history-label">AI Study History</summary>
          <div class="wlp-ai-history-list" id="wlp-ai-history-list"></div>
        </details>
        <section class="wlp-ai-history-review" id="wlp-ai-history-review" hidden>
          <div class="wlp-ai-history-review-head"><div><span class="section-kicker">Past AI Study</span><h3 id="wlp-ai-history-review-title">Session review</h3></div><button class="wlp-ai-history-close" id="wlp-ai-history-close" type="button">Close</button></div>
          <div id="wlp-ai-history-review-body"></div>
        </section>
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
          <div class="wlp-ai-feedback-head">
            <div><span class="section-kicker">Feedback</span><strong id="wlp-ai-feedback-target"></strong><small class="wlp-ai-target-id" id="wlp-ai-target-id"></small></div>
            <button class="wlp-ai-target-peek-toggle" id="wlp-ai-target-peek-toggle" type="button">View WLP card</button>
          </div>
          <div class="wlp-ai-feedback-block">
            <span class="wlp-ai-feedback-label">Target feedback</span>
            <p class="wlp-ai-feedback-text" id="wlp-ai-target-feedback"></p>
          </div>
          <div class="wlp-ai-feedback-block" id="wlp-ai-language-feedback-block">
            <span class="wlp-ai-feedback-label">Language feedback</span>
            <p class="wlp-ai-feedback-text" id="wlp-ai-language-feedback"></p>
          </div>
          <p class="wlp-ai-correction" id="wlp-ai-correction" hidden></p>
          <div class="wlp-ai-next-wrap"><small id="wlp-ai-next-note"></small><button class="wlp-ai-next-button" id="wlp-ai-next" type="button">Next experience</button></div>
          <details class="wlp-ai-diagnostics" id="wlp-ai-diagnostics">
            <summary>Detailed diagnostics</summary>
            <div class="wlp-ai-diagnostics-body">
              <div class="wlp-ai-diagnostic-row"><span>Route</span><strong class="wlp-ai-route-pill" id="wlp-ai-route-pill"></strong></div>
              <div class="wlp-ai-diagnostic-row wlp-ai-diagnostic-stack"><span>Evidence</span><div class="wlp-ai-evidence" id="wlp-ai-evidence"></div></div>
              <div class="wlp-ai-diagnostic-row wlp-ai-diagnostic-stack"><span>Router note</span><p id="wlp-ai-router-note"></p></div>
              <div class="wlp-ai-diagnostic-row wlp-ai-diagnostic-stack"><span>Observation</span><p id="wlp-ai-observation-note"></p></div>
              <div class="wlp-ai-diagnostic-row wlp-ai-diagnostic-stack"><span>Timing / provider</span><p id="wlp-ai-turn-diagnostics"></p></div>
            </div>
          </details>
        </section>
      </section>

      <section class="wlp-ai-finished" id="wlp-ai-finished" hidden>
        <div class="wlp-ai-finished-head">
          <div><span class="section-kicker">AI Study</span><h2 id="wlp-ai-finished-title">Session complete.</h2></div>
          <button class="wlp-ai-finished-close" id="wlp-ai-finished-close" type="button">Close</button>
        </div>
        <p id="wlp-ai-finished-summary">Learning evidence from each completed experience is saved so future AI Study can adapt from it.</p>
        <div class="wlp-ai-finished-stats" id="wlp-ai-finished-stats"></div>
        <section class="wlp-ai-session-review" id="wlp-ai-session-review" hidden>
          <div class="wlp-ai-session-review-block"><span class="wlp-ai-feedback-label">Targets practiced</span><div class="wlp-ai-session-targets" id="wlp-ai-session-targets"></div></div>
          <div class="wlp-ai-session-review-block"><span class="wlp-ai-feedback-label">What went well</span><p id="wlp-ai-session-well"></p></div>
          <div class="wlp-ai-session-review-block"><span class="wlp-ai-feedback-label">Patterns noticed</span><p id="wlp-ai-session-patterns"></p></div>
          <div class="wlp-ai-session-review-block"><span class="wlp-ai-feedback-label">Worth revisiting</span><p id="wlp-ai-session-revisit"></p></div>
          <div class="wlp-ai-session-review-block"><span class="wlp-ai-feedback-label">Next focus</span><p id="wlp-ai-session-next-focus"></p></div>
          <p class="wlp-ai-session-evidence-note" id="wlp-ai-session-evidence-note"></p>
          <details class="wlp-ai-session-turns"><summary>Review completed turns</summary><div id="wlp-ai-session-turns-list"></div></details>
        </section>
        <details class="wlp-ai-diagnostics wlp-ai-session-diagnostics" id="wlp-ai-finished-diagnostics">
          <summary>Detailed diagnostics</summary>
          <div class="wlp-ai-diagnostics-body" id="wlp-ai-finished-diagnostics-body"></div>
        </details>
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

  function elapsedMs(startedAt) {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    return Math.max(0, Math.round(now - startedAt));
  }

  function usageCounts(meta) {
    const usage = meta?.usage || {};
    const input = num(usage.input_tokens ?? usage.promptTokenCount ?? usage.prompt_token_count);
    const output = num(usage.output_tokens ?? usage.candidatesTokenCount ?? usage.candidates_token_count);
    const total = num(usage.total_tokens ?? usage.totalTokenCount ?? usage.total_token_count) || input + output;
    return { input, output, total };
  }

  function recordLatency(kind, ms, ok = true) {
    const session = state.session;
    if (!session) return;
    const bucket = kind === 'planner' ? session.plannerLatencies : session.interpreterLatencies;
    bucket.push({ ms, ok });
  }

  function addUsage(meta, kind, ms) {
    const session = state.session;
    if (!session) return;
    session.successfulAICalls += 1;
    const attempts = Math.max(1, num(meta?.transportAttemptCount) || 1);
    session.providerAttempts += attempts;
    session.lastCallKind = kind;
    session.provider = clean(meta?.provider || session.provider);
    session.model = clean(meta?.model || session.model);
    const usage = usageCounts(meta);
    session.inputTokens += usage.input;
    session.outputTokens += usage.output;
    session.totalTokens += usage.total;
    recordLatency(kind, ms, true);
    return attempts;
  }

  function addFailedUsage(error, kind, ms) {
    const session = state.session;
    if (!session) return 0;
    session.failedAICalls += 1;
    const attempts = Math.max(0, num(error?.attemptCount));
    if (attempts) session.providerAttempts += attempts;
    recordLatency(kind, ms, false);
    return attempts;
  }

  function averageSuccessfulLatency(entries) {
    const values = (Array.isArray(entries) ? entries : []).filter(item => item?.ok && num(item.ms) > 0).map(item => num(item.ms));
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  function formatSeconds(ms) {
    return ms > 0 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : '—';
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
    let plannerStarted = null;
    try {
      const { transport } = requireLayers();
      const built = await buildFreshPlannerRequest(state.session);
      setStatus('Creating the next adaptive experience…');
      plannerStarted = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      const plannerResult = await transport.callPlannerWriter(built.request);
      const plannerElapsed = elapsedMs(plannerStarted);
      const plannerAttempts = addUsage(plannerResult.meta, 'planner', plannerElapsed);
      state.activePlanner = {
        request: built.request,
        result: plannerResult,
        eventId: makeId('ai-study-event'),
        diagnostics: {
          elapsedMs: plannerElapsed,
          providerAttempts: plannerAttempts,
          provider: clean(plannerResult.meta?.provider),
          model: clean(plannerResult.meta?.model)
        }
      };
      const selectedId = clean(plannerResult.response?.selectedTarget?.wordId);
      if (selectedId) state.session.usedTargets[selectedId] = (state.session.usedTargets[selectedId] || 0) + 1;
      renderExperience(plannerResult);
    } catch (error) {
      if (plannerStarted != null) addFailedUsage(error, 'planner', elapsedMs(plannerStarted));
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
    let interpreterStarted = null;
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
      interpreterStarted = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      const interpreterResult = await transport.callInterpreterRouter(interpreterRequest, { eventId: state.activePlanner.eventId });
      const interpreterElapsed = elapsedMs(interpreterStarted);
      const interpreterAttempts = addUsage(interpreterResult.meta, 'interpreter', interpreterElapsed);
      const committed = data.commitInterpreterTurn({
        request: interpreterRequest,
        result: interpreterResult,
        eventId: state.activePlanner.eventId
      });
      state.session.completed += 1;
      state.session.committedEvents.push(committed.eventId);
      const turnDiagnostics = {
        interpreterElapsed,
        interpreterAttempts,
        provider: clean(interpreterResult.meta?.provider || state.activePlanner?.diagnostics?.provider),
        model: clean(interpreterResult.meta?.model || state.activePlanner?.diagnostics?.model)
      };
      state.session.turns.push(turnSnapshot(interpreterResult.response, text, turnDiagnostics));
      renderFeedback(interpreterResult.response, committed, turnDiagnostics);
    } catch (error) {
      if (interpreterStarted != null) {
        const failedAttempts = addFailedUsage(error, 'interpreter', elapsedMs(interpreterStarted));
        if (state.activePlanner?.diagnostics) {
          state.activePlanner.diagnostics.failedInterpreterCalls = num(state.activePlanner.diagnostics.failedInterpreterCalls) + 1;
          state.activePlanner.diagnostics.failedInterpreterAttempts = num(state.activePlanner.diagnostics.failedInterpreterAttempts) + failedAttempts;
        }
      }
      setStatus(formatAIError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function renderFeedback(response, committed, turnDiagnostics = {}) {
    const selected = state.activePlanner?.result?.response?.selectedTarget || {};
    const target = clean(selected.target);
    $('#wlp-ai-feedback-target').textContent = target || 'AI Study';
    $('#wlp-ai-target-id').textContent = clean(selected.wordId) ? `WID ${clean(selected.wordId)}` : '';
    const quickCardButton = $('#wlp-ai-target-peek-toggle');
    const selectedWordId = clean(selected.wordId);
    quickCardButton.hidden = !selectedWordId;
    if (selectedWordId) quickCardButton.dataset.quickCardWordId = selectedWordId;
    else delete quickCardButton.dataset.quickCardWordId;

    const learner = response?.learnerFacingResponse || {};
    const legacyFeedback = clean(learner.feedback || response?.evidence?.observationSummary || 'Response interpreted.');
    $('#wlp-ai-target-feedback').textContent = clean(learner.targetFeedback) || legacyFeedback;

    const languageFeedback = clean(learner.languageFeedback);
    const languageBlock = $('#wlp-ai-language-feedback-block');
    $('#wlp-ai-language-feedback').textContent = languageFeedback || 'No separate language-level feedback was returned for this turn.';
    languageBlock.hidden = false;

    const correction = $('#wlp-ai-correction');
    const suggested = clean(learner.suggestedNaturalForm);
    if (learner.correctionNeeded && suggested) {
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

    const action = clean(response?.router?.action || 'NEXT');
    $('#wlp-ai-route-pill').textContent = action;
    $('#wlp-ai-router-note').textContent = clean(response?.router?.reason || 'No router note returned.');
    $('#wlp-ai-observation-note').textContent = clean(response?.evidence?.observationSummary || 'No observation summary returned.');

    const plannerDiag = state.activePlanner?.diagnostics || {};
    const provider = clean(turnDiagnostics.provider || plannerDiag.provider || state.session?.provider);
    const model = clean(turnDiagnostics.model || plannerDiag.model || state.session?.model);
    const failedInterpreterAttempts = num(plannerDiag.failedInterpreterAttempts);
    const failedInterpreterCalls = num(plannerDiag.failedInterpreterCalls);
    const totalAttempts = num(plannerDiag.providerAttempts) + failedInterpreterAttempts + num(turnDiagnostics.interpreterAttempts);
    const timingParts = [
      `Planner ${formatSeconds(num(plannerDiag.elapsedMs))}`,
      `Interpreter ${formatSeconds(num(turnDiagnostics.interpreterElapsed))}`,
      `${totalAttempts || 2} provider request${(totalAttempts || 2) === 1 ? '' : 's'} this experience`
    ];
    if (failedInterpreterCalls) timingParts.push(`${failedInterpreterCalls} earlier interpreter failure${failedInterpreterCalls === 1 ? '' : 's'}`);
    if (provider || model) timingParts.push([provider, model].filter(Boolean).join(' · '));
    $('#wlp-ai-turn-diagnostics').textContent = timingParts.join(' · ');

    const nextNote = $('#wlp-ai-next-note');
    nextNote.textContent = clean(learner.nextStep) || 'This turn is saved as learning evidence. The next experience can adapt from it.';
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
      turns: [],
      successfulAICalls: 0,
      failedAICalls: 0,
      providerAttempts: 0,
      provider: '',
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      plannerLatencies: [],
      interpreterLatencies: [],
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

    const completedAll = session.completed >= session.total;
    $('#wlp-ai-finished-title').textContent = completedAll ? 'Session complete.' : 'Session saved.';
    $('#wlp-ai-finished-summary').textContent = session.completed
      ? `You completed ${session.completed} of ${session.total} planned experience${session.total === 1 ? '' : 's'}. Learning evidence from completed turns is saved so future AI Study can adapt from it.`
      : 'No interpreted experience was completed in this session.';

    const stats = $('#wlp-ai-finished-stats');
    stats.textContent = '';
    [`${session.completed} experience${session.completed === 1 ? '' : 's'}`, session.source.label].forEach(itemText => {
      const span = document.createElement('span');
      span.textContent = itemText;
      stats.appendChild(span);
    });

    const record = sessionRecord(session);
    renderSessionReview(record);
    const historySaved = session.completed ? saveSessionHistory(record) : true;
    renderHistory();
    if (!historySaved) {
      $('#wlp-ai-finished-summary').textContent += ' The learning evidence is saved, but the local AI Study History snapshot could not be written on this device.';
    }

    const diagnostics = $('#wlp-ai-finished-diagnostics-body');
    diagnostics.textContent = '';
    const plannerAvg = averageSuccessfulLatency(session.plannerLatencies);
    const interpreterAvg = averageSuccessfulLatency(session.interpreterLatencies);
    const rows = [
      ['Successful AI calls', String(session.successfulAICalls)],
      ['Provider requests', String(session.providerAttempts)],
      ['Failed requests', String(session.failedAICalls)],
      ['Average planner latency', formatSeconds(plannerAvg)],
      ['Average interpreter latency', formatSeconds(interpreterAvg)]
    ];
    if (session.provider || session.model) rows.push(['Provider', [session.provider, session.model].filter(Boolean).join(' · ')]);
    if (session.totalTokens > 0) rows.push(['Token usage', `${session.inputTokens} in · ${session.outputTokens} out · ${session.totalTokens} total`]);
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'wlp-ai-diagnostic-row';
      const key = document.createElement('span');
      key.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      row.append(key, val);
      diagnostics.appendChild(row);
    });
    state.activePlanner = null;
  }

  function resetSession({ focusStart = false, scrollStart = false } = {}) {
    state.session = null;
    state.activePlanner = null;
    $('#wlp-ai-experience').hidden = true;
    $('#wlp-ai-finished').hidden = true;
    $('#wlp-ai-start-panel').hidden = false;
    $('#wlp-ai-history-review').hidden = true;
    renderHistory();
    $('#wlp-ai-start').disabled = !state.providerReady;
    setStatus('');
    refreshProviderStatus();
    if (scrollStart) $('#wlp-ai-start-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focusStart) setTimeout(() => $('#wlp-ai-start')?.focus({ preventScroll: true }), 0);
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
    $('#wlp-ai-again')?.addEventListener('click', () => resetSession({ focusStart: true, scrollStart: true }));
    $('#wlp-ai-finished-close')?.addEventListener('click', () => resetSession({ scrollStart: true }));
    $('#wlp-ai-history-list')?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-session-id]');
      if (button) openHistorySession(button.dataset.sessionId);
    });
    $('#wlp-ai-history-close')?.addEventListener('click', () => {
      $('#wlp-ai-history-review').hidden = true;
    });
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
    renderHistory();
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
