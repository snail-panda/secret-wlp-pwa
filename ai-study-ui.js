/* WLP Stage 7 — AI Study failure classification + retry policy v1.8.6.60k R2-G.11
   Provider-agnostic UI adapter for existing AI Study Data / Contract / Transport layers. */
(() => {
  'use strict';

  const VERSION = '1.7.11';
  const MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const SESSION_HISTORY_KEY = 'wlp:ai-study-session-history:v1';
  const AI_SESSION_SIZE_KEY = 'wlp:ai-study-session-size:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const MAX_CANDIDATES = 30;
  const MAX_TARGET_PACKETS = 3;

  const PRACTICE_TYPES = Object.freeze([
    { value: 'adaptive', label: 'Adaptive · AI decides', help: 'Default. WLP chooses the experience type from your current route evidence and target context.' },
    { value: 'situational-production', label: 'Situational production', help: 'Respond naturally inside a concrete real-world situation.' },
    { value: 'open-description', label: 'Open description', help: 'Explain or describe something freely while the target remains meaningfully motivated.' },
    { value: 'cloze', label: 'Cloze', help: 'Complete one natural fixed frame with a word or expression that fits.' },
    { value: 'dialogue', label: 'Dialogue', help: 'Respond inside a short conversational exchange.' },
    { value: 'micro-story', label: 'Micro-story', help: 'Use or retrieve the target through a short story-like context.' },
    { value: 'contrast', label: 'Contrast', help: 'Distinguish the target from a close neighbor or alternative.' },
    { value: 'reformulation', label: 'Reformulation', help: 'Rewrite an idea in a more precise, natural, or target-compatible way.' },
    { value: 'free-composition', label: 'Free composition', help: 'Produce a full sentence or short passage with minimal lexical prompting.' },
    { value: 'reverse-reconstruction', label: 'Reverse reconstruction', help: 'Rebuild an expression or formulation from its intended meaning or communicative effect.' },
    { value: 'sentence-reconstruction', label: 'Sentence reconstruction', help: 'Reorder shuffled chunks into one natural sentence. Difficulty changes chunk size, distractors, and missing-word/form demands.' },
    { value: 'continuation', label: 'Continuation', help: 'Continue a sentence, thought, or exchange naturally.' }
  ]);

  const DIFFICULTIES = Object.freeze([
    { value: 'adaptive', label: 'Adaptive · AI decides', help: 'Default. WLP adjusts support from current route evidence. It normally stays near Standard and does not jump to Hell without strong prior evidence.' },
    { value: 'easy', label: 'Easy', help: 'More scaffolding, clearer cues, and simpler response demands. Sentence reconstruction uses larger meaning chunks with no distractors.' },
    { value: 'standard', label: 'Standard', help: 'Normal retrieval and production demand. Sentence reconstruction uses smaller chunks and reduces obvious capitalization clues.' },
    { value: 'hard', label: 'Hard', help: 'Less direct cueing, more form/construction control, and closer competitors. Sentence reconstruction adds distractor chunks.' },
    { value: 'hell', label: 'Hell', help: 'Maximum fair difficulty: sparse cueing, transfer and form control, competing options, and stronger production demands. Reconstruction can include distractors plus one missing word or form.' }
  ]);

  const state = {
    mode: 'standard',
    providerInfo: null,
    providerReady: false,
    session: null,
    activePlanner: null,
    busy: false,
    reconstruction: null,
    generationEpoch: 0,
    generationController: null
  };

  const $ = selector => document.querySelector(selector);
  const clean = value => String(value ?? '').trim();
  const num = value => Number(value || 0);
  const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function renderHighlightedText(element, value, terms = []) {
    if (!element) return;
    element.replaceChildren();
    const source = clean(value);
    if (!source) return;
    const candidates = (Array.isArray(terms) ? terms : [terms])
      .map(clean).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!candidates.length) {
      element.textContent = source;
      return;
    }
    const lower = source.toLowerCase();
    let cursor = 0;
    while (cursor < source.length) {
      let best = null;
      candidates.forEach(term => {
        const index = lower.indexOf(term.toLowerCase(), cursor);
        if (index < 0) return;
        if (!best || index < best.index || (index === best.index && term.length > best.length)) {
          best = { index, length: term.length };
        }
      });
      if (!best) {
        element.append(document.createTextNode(source.slice(cursor)));
        break;
      }
      if (best.index > cursor) element.append(document.createTextNode(source.slice(cursor, best.index)));
      const strong = document.createElement('strong');
      strong.textContent = source.slice(best.index, best.index + best.length);
      element.append(strong);
      cursor = best.index + best.length;
    }
  }

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

  function addPeekField(container, label, value, highlightTerms = []) {
    const textValue = clean(value);
    if (!textValue) return;
    const row = document.createElement('div');
    row.className = 'wlp-ai-peek-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('p');
    if (Array.isArray(highlightTerms) && highlightTerms.some(term => clean(term))) renderHighlightedText(val, textValue, highlightTerms);
    else val.textContent = textValue;
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

  const CLOSED_RESPONSE_TYPES = new Set(['cloze','sentence-reconstruction','reverse-reconstruction']);

  function deriveTurnOutcome(response, learnerText = '', experienceType = '') {
    const interpretation = response?.interpretation || {};
    const learner = response?.learnerFacingResponse || {};
    const classes = Array.isArray(interpretation.responseClasses) ? interpretation.responseClasses.map(clean).filter(Boolean) : [];
    const hasMismatch = learner.correctionNeeded === true || classes.some(value => ['form-mismatch','sense-mismatch','register-mismatch'].includes(value));
    const exactTarget = interpretation.targetProduced === true;
    const targetFamily = interpretation.targetFamilyReached === true;
    const conceptMatched = interpretation.conceptMatched === true;
    const natural = response?.communicativeInterpretation?.learnerExpressionNatural === true;
    const noResponse = /^i don['’]?t know\.?$/i.test(clean(learnerText));
    const closed = CLOSED_RESPONSE_TYPES.has(clean(experienceType));

    if (noResponse) return { key: 'no-response', label: 'No response', tone: 'neutral' };
    if (closed && exactTarget && natural && !hasMismatch) return { key: 'expected-natural', label: 'Expected answer / Natural', tone: 'success' };
    if (closed && !exactTarget && targetFamily && natural && !hasMismatch) return { key: 'accepted-target-form', label: 'Accepted target form / Natural', tone: 'success' };
    if (!closed && exactTarget && natural && !hasMismatch) return { key: 'target-natural', label: 'Target hit / Natural', tone: 'success' };
    if (!closed && !exactTarget && targetFamily && natural && !hasMismatch) return { key: 'target-family-natural', label: 'Target-family match / Natural', tone: 'success' };
    if (conceptMatched && natural && !hasMismatch) return { key: 'natural-alternative', label: 'Natural alternative', tone: 'alternative' };
    if ((exactTarget || targetFamily) && hasMismatch) return { key: 'target-needs-work', label: 'Target hit / Needs revision', tone: 'partial' };
    if (conceptMatched) return { key: 'meaning-needs-work', label: 'Meaning works / Needs revision', tone: 'partial' };
    return { key: 'needs-revision', label: 'Needs revision', tone: 'revise' };
  }

  function normalizedTurnOutcome(turn) {
    const stored = turn?.outcome && typeof turn.outcome === 'object' ? turn.outcome : null;
    if (stored && clean(stored.label)) return { key: clean(stored.key), label: clean(stored.label), tone: clean(stored.tone) || 'neutral' };
    if (!turn || typeof turn !== 'object') return { key: '', label: '', tone: 'neutral' };
    const classes = Array.isArray(turn.responseClasses) ? turn.responseClasses.map(clean).filter(Boolean) : [];
    const hasMismatch = turn.correctionNeeded === true || classes.some(value => ['form-mismatch','sense-mismatch','register-mismatch'].includes(value));
    const exactTarget = turn.targetProduced === true;
    const targetFamily = turn.targetFamilyReached === true;
    const conceptMatched = turn.conceptMatched === true;
    const natural = turn.learnerExpressionNatural === true;
    const noResponse = /^i don['’]?t know\.?$/i.test(clean(turn.learnerResponse));
    const closed = CLOSED_RESPONSE_TYPES.has(clean(turn.experienceType));
    if (noResponse) return { key: 'no-response', label: 'No response', tone: 'neutral' };
    if (closed && exactTarget && natural && !hasMismatch) return { key: 'expected-natural', label: 'Expected answer / Natural', tone: 'success' };
    if (closed && !exactTarget && targetFamily && natural && !hasMismatch) return { key: 'accepted-target-form', label: 'Accepted target form / Natural', tone: 'success' };
    if (!closed && exactTarget && natural && !hasMismatch) return { key: 'target-natural', label: 'Target hit / Natural', tone: 'success' };
    if (!closed && !exactTarget && targetFamily && natural && !hasMismatch) return { key: 'target-family-natural', label: 'Target-family match / Natural', tone: 'success' };
    if (conceptMatched && natural && !hasMismatch) return { key: 'natural-alternative', label: 'Natural alternative', tone: 'alternative' };
    if ((exactTarget || targetFamily) && hasMismatch) return { key: 'target-needs-work', label: 'Target hit / Needs revision', tone: 'partial' };
    if (conceptMatched) return { key: 'meaning-needs-work', label: 'Meaning works / Needs revision', tone: 'partial' };
    return { key: 'needs-revision', label: 'Needs revision', tone: 'revise' };
  }

  function makeOutcomeChip(outcome, className = 'wlp-ai-outcome-chip') {
    const info = outcome && typeof outcome === 'object' ? outcome : { label: '' };
    const chip = document.createElement('span');
    chip.className = `${className} is-${clean(info.tone) || 'neutral'}`;
    const prefix = clean(info.tone) === 'success' ? '✓ ' : clean(info.tone) === 'alternative' ? '↔ ' : clean(info.tone) === 'partial' ? '△ ' : '';
    chip.textContent = `${prefix}${clean(info.label) || 'Learning evidence saved'}`;
    return chip;
  }

  function sessionOutcome(record) {
    const turns = Array.isArray(record?.turns) ? record.turns : [];
    if (!turns.length) return null;
    if (turns.length === 1) return normalizedTurnOutcome(turns[0]);
    const outcomes = turns.map(normalizedTurnOutcome).filter(item => item.label);
    if (!outcomes.length) return null;
    const strong = outcomes.filter(item => item.tone === 'success').length;
    const alternative = outcomes.filter(item => item.tone === 'alternative').length;
    const revisit = outcomes.length - strong - alternative;
    const parts = [];
    if (strong) parts.push(`${strong} strong`);
    if (alternative) parts.push(`${alternative} alternative`);
    if (revisit) parts.push(`${revisit} revisit`);
    return { key: 'session-summary', label: parts.join(' / '), tone: revisit ? 'partial' : alternative ? 'alternative' : 'success' };
  }

  function turnSnapshot(response, learnerText, turnDiagnostics = {}) {
    const planner = state.activePlanner?.result?.response || {};
    const selected = planner.selectedTarget || {};
    const exp = planner.experience || {};
    const learner = response?.learnerFacingResponse || {};
    const outcome = deriveTurnOutcome(response, learnerText, clean(exp.type || planner.learningOpportunity?.direction));
    return {
      eventId: clean(state.activePlanner?.eventId),
      completedAt: new Date().toISOString(),
      target: clean(selected.target),
      targetFamily: Array.isArray(selected.targetFamily) ? selected.targetFamily.map(clean).filter(Boolean).slice(0, 8) : [],
      wordId: clean(selected.wordId),
      domain: clean(exp.domain),
      experienceType: clean(exp.type || planner.learningOpportunity?.direction),
      prompt: clean(clean(exp.type) === 'sentence-reconstruction' ? (parseReconstructionPrompt(exp.prompt)?.prompt || exp.prompt) : exp.prompt),
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
      modelResponse: clean(learner.modelResponse),
      responseClasses: Array.isArray(response?.interpretation?.responseClasses) ? response.interpretation.responseClasses.map(clean).filter(Boolean) : [],
      conceptMatched: response?.interpretation?.conceptMatched === true,
      targetProduced: response?.interpretation?.targetProduced === true,
      targetFamilyReached: response?.interpretation?.targetFamilyReached === true,
      learnerExpressionNatural: response?.communicativeInterpretation?.learnerExpressionNatural === true,
      outcome,
      diagnostics: {
        routerAction: clean(response?.router?.action),
        routerReason: clean(response?.router?.reason),
        evidenceTypes: Array.isArray(response?.evidence?.evidenceTypes) ? response.evidence.evidenceTypes.map(clean).filter(Boolean) : [],
        observationSummary: clean(response?.evidence?.observationSummary),
        plannerElapsed: num(state.activePlanner?.diagnostics?.elapsedMs),
        interpreterElapsed: num(turnDiagnostics.interpreterElapsed),
        provider: clean(turnDiagnostics.provider || state.session?.provider),
        model: clean(turnDiagnostics.model || state.session?.model),
        inputTokens: num(turnDiagnostics.inputTokens),
        cachedInputTokens: num(turnDiagnostics.cachedInputTokens),
        outputTokens: num(turnDiagnostics.outputTokens),
        estimatedCostUsd: Number.isFinite(turnDiagnostics.estimatedCostUsd) ? turnDiagnostics.estimatedCostUsd : null
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
        evidenceNote: 'No completed turn means there is no learning evidence to summarize from this session.'
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
    const formMismatchTurns = turns.filter(turn => (turn?.responseClasses || []).includes('form-mismatch')).length;
    if (natural) {
      if (formMismatchTurns) well.push(`The target expression itself was judged natural in ${natural}/${total} completed turn${total === 1 ? '' : 's'}, while response form or construction still needed attention in ${formMismatchTurns}/${total}.`);
      else well.push(`Your response was judged natural in ${natural}/${total} completed turn${total === 1 ? '' : 's'}.`);
    }
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
      if (!revisit.some(text => text.toLowerCase().includes(label))) revisit.push(`${label.charAt(0).toUpperCase() + label.slice(1)} still needed attention in ${count} completed turn${count === 1 ? '' : 's'}.`);
    });

    const nextSteps = uniqueTexts(turns.map(turn => turn?.nextStep), 2);
    return {
      whatWentWell: well.join(' '),
      patterns,
      worthRevisiting: revisit.length ? revisit.slice(0, 3).join(' ') : 'No repeated or high-priority issue stood out in the completed turn(s).',
      nextFocus: nextSteps.length ? nextSteps.join(' ') : 'Future AI Study can adapt from the saved evidence.',
      evidenceNote: total < 3
        ? 'Based on this session only. If the same pattern appears again in future sessions, WLP can treat it as a stronger learning signal.'
        : 'These patterns summarize this session. WLP will look for the same patterns across different words, contexts, and future sessions before treating them as longer-term tendencies.'
    };
  }

  function sessionRecord(session) {
    return {
      sessionId: clean(session.sessionId),
      startedAt: clean(session.startedAt),
      endedAt: new Date().toISOString(),
      source: clone(session.source),
      practiceType: clean(session.practiceType || 'adaptive'),
      difficulty: clean(session.difficulty || 'adaptive'),
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
        provider: clean(session.provider),
        model: clean(session.model),
        inputTokens: num(session.inputTokens),
        cachedInputTokens: num(session.cachedInputTokens),
        outputTokens: num(session.outputTokens),
        totalTokens: num(session.totalTokens),
        plannerLatencyMs: averageSuccessfulLatency(session.plannerLatencies),
        interpreterLatencyMs: averageSuccessfulLatency(session.interpreterLatencies),
        failureEvents: clone(Array.isArray(session.failureEvents) ? session.failureEvents : []),
        retryStats: clone(session.retryStats || { automaticGeneration: 0, manualGeneration: 0, manualInterpreter: 0 })
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
    const turnOutcome = normalizedTurnOutcome(turn);
    if (turnOutcome.label) head.appendChild(makeOutcomeChip(turnOutcome));
    article.appendChild(head);
    addPeekField(article, 'Prompt', turn?.prompt);
    addPeekField(article, 'Your response', turn?.learnerResponse);
    addPeekField(article, 'Target feedback', turn?.targetFeedback);
    addPeekField(article, 'Language feedback', turn?.languageFeedback);
    addPeekField(article, 'Next step', turn?.nextStep);
    const highlightTerms = [clean(turn?.target), ...(Array.isArray(turn?.targetFamily) ? turn.targetFamily.map(clean) : [])].filter(Boolean);
    if (turn?.correctionNeeded && clean(turn?.suggestedNaturalForm)) addPeekField(article, 'Natural form', turn.suggestedNaturalForm, highlightTerms);
    else if (clean(turn?.modelResponse)) addPeekField(article, clean(turn?.experienceType) === 'sentence-reconstruction' ? 'One natural answer' : 'Natural example', turn.modelResponse, highlightTerms);
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
      const typeNote = clean(record.practiceType) && clean(record.practiceType) !== 'adaptive' ? ` · ${practiceTypeLabel(clean(record.practiceType))}` : '';
      const difficultyNote = clean(record.difficulty) && clean(record.difficulty) !== 'adaptive' ? ` · ${difficultyLabel(clean(record.difficulty))}` : '';
      meta.textContent = `${num(record.completed)} experience${num(record.completed) === 1 ? '' : 's'}${targets ? ` · ${targets}` : ''}${typeNote}${difficultyNote}`;
      button.append(strong, meta);
      const historyOutcome = sessionOutcome(record);
      if (historyOutcome?.label) button.appendChild(makeOutcomeChip(historyOutcome, 'wlp-ai-history-outcome'));
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
    const historyType = clean(record.practiceType) && clean(record.practiceType) !== 'adaptive' ? ` · ${practiceTypeLabel(clean(record.practiceType))}` : '';
    const historyDifficulty = clean(record.difficulty) && clean(record.difficulty) !== 'adaptive' ? ` · ${difficultyLabel(clean(record.difficulty))}` : '';
    note.textContent = `Saved from ${clean(record.source?.label) || 'AI Study'}${historyType}${historyDifficulty}. This is the original prompt, response, feedback, and session-level review from that session.`;
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
    appendHistoryDiagnostics(body, record);
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

  function ensureSessionSizeOptions() {
    const select = $('#study-session-size');
    if (!select) return;
    [1, 3].forEach(value => {
      if ([...select.options].some(option => Number(option.value) === value)) return;
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} experience${value === 1 ? '' : 's'}`;
      const before = [...select.options].find(item => Number(item.value) > value);
      select.insertBefore(option, before || null);
    });
  }

  function savedAISessionSize() {
    try {
      const value = Math.floor(num(localStorage.getItem(AI_SESSION_SIZE_KEY)));
      return [1, 3, 5, 10, 20].includes(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function sessionSizeText(value) {
    const size = Math.max(1, Math.floor(num(value)));
    return `${size} experience${size === 1 ? '' : 's'}`;
  }

  const COST_PRICING = Object.freeze({
    'openai:gpt-5.6-luna': Object.freeze({ inputPerMillion: 0.20, cachedInputPerMillion: 0.02, outputPerMillion: 1.20, label: 'GPT-5.6 Luna', asOf: '2026-09-21' })
  });

  function costPricing(provider, model) {
    return COST_PRICING[`${clean(provider).toLowerCase()}:${clean(model).toLowerCase()}`] || null;
  }

  function estimatedCostUsd({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 } = {}, provider = '', model = '') {
    const pricing = costPricing(provider, model);
    if (!pricing) return null;
    const input = Math.max(0, num(inputTokens));
    const cached = Math.min(input, Math.max(0, num(cachedInputTokens)));
    const uncached = Math.max(0, input - cached);
    const output = Math.max(0, num(outputTokens));
    return ((uncached * pricing.inputPerMillion) + (cached * pricing.cachedInputPerMillion) + (output * pricing.outputPerMillion)) / 1000000;
  }

  function formatUsd(value, { compact = false } = {}) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    if (amount === 0) return '$0.000';
    if (compact && amount >= 1) return `$${amount.toFixed(2)}`;
    if (amount >= 1) return `$${amount.toFixed(2)}`;
    if (amount >= 0.1) return `$${amount.toFixed(3)}`;
    return `$${amount.toFixed(4)}`;
  }

  function sessionCost(sessionLike) {
    const diag = sessionLike?.diagnostics && typeof sessionLike.diagnostics === 'object' ? sessionLike.diagnostics : sessionLike || {};
    return estimatedCostUsd({
      inputTokens: diag.inputTokens,
      cachedInputTokens: diag.cachedInputTokens,
      outputTokens: diag.outputTokens
    }, clean(sessionLike?.provider || diag.provider), clean(sessionLike?.model || diag.model));
  }

  function costHistoryStats(currentRecord = null) {
    const records = readSessionHistory().slice();
    if (currentRecord?.sessionId && !records.some(item => clean(item?.sessionId) === clean(currentRecord.sessionId))) records.push(currentRecord);
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let todayCost = 0;
    let weekCost = 0;
    let totalCost = 0;
    let totalExperiences = 0;
    let matchedCost = 0;
    let matchedExperiences = 0;
    records.forEach(record => {
      const cost = sessionCost(record);
      if (!Number.isFinite(cost)) return;
      const ended = Date.parse(record?.endedAt || record?.startedAt || '') || 0;
      const completed = Math.max(0, num(record?.completed));
      totalCost += cost;
      totalExperiences += completed;
      if (ended >= today.getTime()) todayCost += cost;
      if (ended >= now - 7 * 24 * 60 * 60 * 1000) weekCost += cost;
      if (currentRecord && clean(record?.practiceType) === clean(currentRecord?.practiceType) && clean(record?.difficulty) === clean(currentRecord?.difficulty)) {
        matchedCost += cost;
        matchedExperiences += completed;
      }
    });
    return {
      todayCost,
      weekCost,
      averagePerExperience: totalExperiences ? totalCost / totalExperiences : null,
      matchedAverage: matchedExperiences ? matchedCost / matchedExperiences : null,
      totalExperiences
    };
  }

  function appendFailureDetails(container, record) {
    if (!container) return;
    const diag = record?.diagnostics && typeof record.diagnostics === 'object' ? record.diagnostics : {};
    const events = Array.isArray(diag.failureEvents) ? diag.failureEvents : [];
    const retries = diag.retryStats && typeof diag.retryStats === 'object' ? diag.retryStats : {};
    const retryTotal = num(retries.automaticGeneration) + num(retries.manualGeneration) + num(retries.manualInterpreter);
    if (!events.length && !retryTotal) return;

    const details = document.createElement('details');
    details.className = 'wlp-ai-cost-details wlp-ai-failure-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Failure & retry details';
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'wlp-ai-cost-details-body';
    const addRow = (label, value) => {
      const row = document.createElement('div');
      row.className = 'wlp-ai-cost-row';
      const key = document.createElement('span'); key.textContent = label;
      const val = document.createElement('strong'); val.textContent = value;
      row.append(key, val); body.appendChild(row);
    };

    const counts = new Map();
    events.forEach(event => {
      const key = clean(event?.category) || 'other';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    counts.forEach((count, key) => addRow(FAILURE_CATEGORY_LABELS[key] || clean(events.find(item => clean(item?.category) === key)?.label) || key, String(count)));
    if (num(retries.automaticGeneration)) addRow('Automatic generation retries', String(num(retries.automaticGeneration)));
    if (num(retries.manualGeneration)) addRow('Manual generation retries', String(num(retries.manualGeneration)));
    if (num(retries.manualInterpreter)) addRow('Manual interpretation retries', String(num(retries.manualInterpreter)));

    const note = document.createElement('p');
    note.className = 'wlp-ai-cost-note';
    note.textContent = 'Retry policy: WLP automatically regenerates only planner/reconstruction format failures (up to 3 generation attempts). Provider/network failures wait for a manual retry. Interpreter retries are manual so your response stays visible and is not silently re-submitted.';
    body.appendChild(note);
    details.appendChild(body);
    container.appendChild(details);
  }

  function appendSessionDiagnosticRows(container, record, { includeCostDetails = true } = {}) {
    if (!container) return;
    const diag = record?.diagnostics && typeof record.diagnostics === 'object' ? record.diagnostics : {};
    const estimatedSessionCost = sessionCost(record);
    const rows = [
      ['Successful AI calls', String(num(diag.successfulAICalls))],
      ['Provider requests', String(num(diag.providerAttempts))],
      ['Failed AI calls', String(num(diag.failedAICalls))],
      ['Average planner latency', formatSeconds(num(diag.plannerLatencyMs))],
      ['Average interpreter latency', formatSeconds(num(diag.interpreterLatencyMs))]
    ];
    const provider = clean(record?.provider || diag.provider);
    const model = clean(record?.model || diag.model);
    if (provider || model) rows.push(['Provider', [provider, model].filter(Boolean).join(' · ')]);
    if (num(diag.totalTokens) > 0) rows.push(['Token usage', `${num(diag.inputTokens)} in · ${num(diag.outputTokens)} out · ${num(diag.totalTokens)} total`]);
    if (num(diag.cachedInputTokens) > 0) rows.push(['Cached input', `${num(diag.cachedInputTokens)} tokens`]);
    if (Number.isFinite(estimatedSessionCost)) rows.push(['Estimated session cost', formatUsd(estimatedSessionCost)]);
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'wlp-ai-diagnostic-row';
      const key = document.createElement('span');
      key.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      row.append(key, val);
      container.appendChild(row);
    });
    appendFailureDetails(container, record);
    if (includeCostDetails) appendCostDetails(container, record);
  }

  function appendHistoryDiagnostics(container, record) {
    if (!container || !record?.diagnostics) return;
    const details = document.createElement('details');
    details.className = 'wlp-ai-diagnostics wlp-ai-history-diagnostics';
    const summary = document.createElement('summary');
    summary.textContent = 'Detailed diagnostics';
    const body = document.createElement('div');
    body.className = 'wlp-ai-diagnostics-body';
    appendSessionDiagnosticRows(body, record);
    details.append(summary, body);
    container.appendChild(details);
  }

  function appendCostDetails(container, record) {
    if (!container) return;
    const cost = sessionCost(record);
    if (!Number.isFinite(cost)) return;
    const completed = Math.max(0, num(record?.completed));
    const sessionAvg = completed ? cost / completed : null;
    const historyStats = costHistoryStats(record);
    const basis = sessionAvg ?? historyStats.averagePerExperience;
    const details = document.createElement('details');
    details.className = 'wlp-ai-cost-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Cost details & projections';
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'wlp-ai-cost-details-body';
    const addRow = (label, value) => {
      if (value == null || value === '') return;
      const row = document.createElement('div');
      row.className = 'wlp-ai-cost-row';
      const key = document.createElement('span'); key.textContent = label;
      const val = document.createElement('strong'); val.textContent = value;
      row.append(key, val); body.appendChild(row);
    };
    addRow('This session', formatUsd(cost));
    if (sessionAvg != null) addRow('Average / completed experience', formatUsd(sessionAvg));
    addRow('Today (local AI Study history)', formatUsd(historyStats.todayCost));
    addRow('Last 7 days (local AI Study history)', formatUsd(historyStats.weekCost));
    if (historyStats.averagePerExperience != null) addRow('Local history average / experience', formatUsd(historyStats.averagePerExperience));
    if (historyStats.matchedAverage != null) addRow(`${practiceTypeLabel(clean(record?.practiceType || 'adaptive'))} / ${difficultyLabel(clean(record?.difficulty || 'adaptive'))} avg`, formatUsd(historyStats.matchedAverage));
    if (basis != null) {
      addRow('5 experiences at current average', `≈ ${formatUsd(basis * 5, { compact: true })}`);
      addRow('10 experiences at current average', `≈ ${formatUsd(basis * 10, { compact: true })}`);
      addRow('10 experiences/day × 30 days', `≈ ${formatUsd(basis * 300, { compact: true })}`);
      addRow('30 experiences/day × 30 days', `≈ ${formatUsd(basis * 900, { compact: true })}`);
    }
    const note = document.createElement('p');
    note.className = 'wlp-ai-cost-note';
    const pricing = costPricing(clean(record?.provider || record?.diagnostics?.provider), clean(record?.model || record?.diagnostics?.model));
    note.textContent = pricing
      ? `Estimate from token usage reported to WLP using ${pricing.label} pricing (${formatUsd(pricing.inputPerMillion, { compact: true })}/1M input, ${formatUsd(pricing.outputPerMillion, { compact: true })}/1M output; cached input handled when reported). OpenAI Usage remains the billing source of truth.`
      : 'Estimated cost is unavailable for this provider/model. OpenAI Usage remains the billing source of truth.';
    body.appendChild(note);
    details.appendChild(body);
    container.appendChild(details);
  }

  function ensureSessionSizePreferenceUI() {
    const select = $('#study-session-size');
    const footer = select?.closest('.study-source-footer');
    if (!select || !footer || $('#wlp-ai-session-size-preference')) return;
    const box = document.createElement('div');
    box.id = 'wlp-ai-session-size-preference';
    box.className = 'wlp-ai-session-size-preference wlp-ai-only';
    box.innerHTML = `
      <label for="wlp-ai-remember-session-size">
        <input id="wlp-ai-remember-session-size" type="checkbox">
        <span id="wlp-ai-session-size-preference-label">Use this as my AI Study default</span>
      </label>
      <small id="wlp-ai-session-size-preference-status"></small>`;
    const sizeLabel = select.closest('.study-session-size');
    if (sizeLabel) sizeLabel.insertAdjacentElement('afterend', box);
    else footer.prepend(box);
  }

  function syncAISessionSizePreferenceUI() {
    ensureSessionSizeOptions();
    ensureSessionSizePreferenceUI();
    const size = selectedSessionSize();
    const saved = savedAISessionSize();
    const remember = $('#wlp-ai-remember-session-size');
    const label = $('#wlp-ai-session-size-preference-label');
    const status = $('#wlp-ai-session-size-preference-status');
    const summary = $('#wlp-ai-session-size-summary');
    const summaryText = $('#wlp-ai-session-size-summary-text');
    const useButton = $('#wlp-ai-session-size-use-current');
    if (remember) remember.checked = saved === size;
    if (label) label.textContent = `Use current choice (${sessionSizeText(size)}) as my AI Study default`;
    if (status) status.textContent = saved ? `Saved AI Study default: ${sessionSizeText(saved)}` : 'No AI Study default saved yet.';
    if (summary) summary.hidden = false;
    if (summaryText) {
      summaryText.textContent = saved
        ? `Current session: ${sessionSizeText(size)}\nAI Study default: ${sessionSizeText(saved)}`
        : `Current session: ${sessionSizeText(size)}\nAI Study default: Not set`;
    }
    if (useButton) {
      const same = saved === size;
      useButton.hidden = same;
      useButton.textContent = 'Make current choice the default';
    }
  }

  function applySavedAISessionSize() {
    ensureSessionSizeOptions();
    ensureSessionSizePreferenceUI();
    const saved = savedAISessionSize();
    const select = $('#study-session-size');
    if (saved && select) {
      select.value = String(saved);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncAISessionSizePreferenceUI();
  }

  function persistAISessionSizePreference() {
    const remember = $('#wlp-ai-remember-session-size');
    const size = selectedSessionSize();
    const saved = savedAISessionSize();
    try {
      if (remember?.checked) localStorage.setItem(AI_SESSION_SIZE_KEY, String(size));
      else if (saved === size) localStorage.removeItem(AI_SESSION_SIZE_KEY);
    } catch (_) {}
    syncAISessionSizePreferenceUI();
  }

  function setCurrentAISessionSizeAsDefault() {
    const size = selectedSessionSize();
    try { localStorage.setItem(AI_SESSION_SIZE_KEY, String(size)); } catch (_) {}
    syncAISessionSizePreferenceUI();
  }

  function selectedSessionSize() {
    const size = Math.floor(num($('#study-session-size')?.value));
    return [1, 3, 5, 10, 20].includes(size) ? size : 5;
  }


  function selectedPracticeType() {
    const value = clean($('#wlp-ai-practice-type')?.value || 'adaptive');
    return PRACTICE_TYPES.some(item => item.value === value) ? value : 'adaptive';
  }

  function practiceTypeLabel(value) {
    return PRACTICE_TYPES.find(item => item.value === value)?.label || 'Adaptive · AI decides';
  }

  function updatePracticeTypeHelp() {
    const value = selectedPracticeType();
    const help = PRACTICE_TYPES.find(item => item.value === value)?.help || '';
    const el = $('#wlp-ai-practice-type-help');
    if (el) el.textContent = help;
  }

  function selectedDifficulty() {
    const value = clean($('#wlp-ai-difficulty')?.value || 'adaptive');
    return DIFFICULTIES.some(item => item.value === value) ? value : 'adaptive';
  }

  function difficultyLabel(value) {
    return DIFFICULTIES.find(item => item.value === value)?.label || 'Adaptive · AI decides';
  }

  function updateDifficultyHelp() {
    const value = selectedDifficulty();
    const help = DIFFICULTIES.find(item => item.value === value)?.help || '';
    const el = $('#wlp-ai-difficulty-help');
    if (el) el.textContent = help;
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
    ensureSessionSizeOptions();
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
        <div class="wlp-ai-study-options">
          <div class="wlp-ai-practice-type-control">
            <label for="wlp-ai-practice-type"><span>Experience type</span><select id="wlp-ai-practice-type" aria-describedby="wlp-ai-practice-type-help">
              <option value="adaptive" selected>Adaptive · AI decides</option>
              <option value="situational-production">Situational production</option>
              <option value="open-description">Open description</option>
              <option value="cloze">Cloze</option>
              <option value="dialogue">Dialogue</option>
              <option value="micro-story">Micro-story</option>
              <option value="contrast">Contrast</option>
              <option value="reformulation">Reformulation</option>
              <option value="free-composition">Free composition</option>
              <option value="reverse-reconstruction">Reverse reconstruction</option>
              <option value="sentence-reconstruction">Sentence reconstruction</option>
              <option value="continuation">Continuation</option>
            </select></label>
            <p id="wlp-ai-practice-type-help">Default. WLP chooses the experience type from your current route evidence and target context.</p>
          </div>
          <div class="wlp-ai-practice-type-control wlp-ai-difficulty-control">
            <label for="wlp-ai-difficulty"><span>Difficulty</span><select id="wlp-ai-difficulty" aria-describedby="wlp-ai-difficulty-help">
              <option value="adaptive" selected>Adaptive · AI decides</option>
              <option value="easy">Easy</option>
              <option value="standard">Standard</option>
              <option value="hard">Hard</option>
              <option value="hell">Hell</option>
            </select></label>
            <p id="wlp-ai-difficulty-help">Default. WLP adjusts support from current route evidence and normally stays near Standard.</p>
          </div>
        </div>
        <div class="wlp-ai-session-size-summary" id="wlp-ai-session-size-summary">
          <span class="wlp-ai-session-size-summary-text" id="wlp-ai-session-size-summary-text">Current session: 10 experiences\nAI Study default: Not set</span>
          <button class="wlp-ai-session-size-use-current" id="wlp-ai-session-size-use-current" type="button">Use 10 as default</button>
        </div>
        <button class="wlp-ai-start-button" id="wlp-ai-start" type="button">Start AI Experience</button>
        <p class="wlp-ai-start-note" id="wlp-ai-start-note">Your selected source, session size, optional experience-type override, and difficulty preference are captured when the AI session starts. Standard Practice remains fully usable without AI.</p>
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
          <div class="wlp-ai-reconstruction" id="wlp-ai-reconstruction" hidden>
            <span class="wlp-ai-reconstruction-label">Arrange the chunks</span>
            <p>Tap the chunks in the order that makes one natural sentence.</p>
            <div class="wlp-ai-reconstruction-bank" id="wlp-ai-reconstruction-bank" aria-label="Available chunks"></div>
            <div class="wlp-ai-reconstruction-missing" id="wlp-ai-reconstruction-missing" hidden>
              <label for="wlp-ai-reconstruction-missing-input"><span>One word or form is missing</span><input id="wlp-ai-reconstruction-missing-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type the missing word or form"><small>Type it, then tap Add to sentence — or press Enter.</small></label>
              <button type="button" id="wlp-ai-reconstruction-missing-add">Add to sentence</button>
            </div>
            <div class="wlp-ai-reconstruction-answer-wrap">
              <span>Your sentence</span>
              <div class="wlp-ai-reconstruction-answer" id="wlp-ai-reconstruction-answer" aria-live="polite"></div>
            </div>
            <div class="wlp-ai-reconstruction-controls">
              <button type="button" id="wlp-ai-reconstruction-undo">Undo</button>
              <button type="button" id="wlp-ai-reconstruction-clear">Clear</button>
            </div>
          </div>
          <span class="wlp-ai-visible-target" id="wlp-ai-visible-target" hidden></span>
          <div class="wlp-ai-reconstruction-assist" id="wlp-ai-reconstruction-assist" hidden>
            <div class="wlp-ai-reconstruction-assist-actions">
              <div class="wlp-ai-target-hint" id="wlp-ai-target-hint" hidden>
                <button type="button" id="wlp-ai-target-hint-button">Show target</button>
                <span id="wlp-ai-target-hint-text" hidden></span>
              </div>
              <div class="wlp-ai-task-hint" id="wlp-ai-task-hint" hidden>
                <button type="button" id="wlp-ai-task-hint-button">Need a hint?</button>
              </div>
            </div>
            <div class="wlp-ai-task-hint-list" id="wlp-ai-task-hint-list" hidden></div>
          </div>
        </div>
        <div class="wlp-ai-generation-cancel-row" id="wlp-ai-generation-cancel-row" hidden><button type="button" id="wlp-ai-cancel-generation">Stop generation</button><span>Stop the pending generation. Completed turns stay saved.</span></div>
        <label class="wlp-ai-response-field" id="wlp-ai-response-field" for="wlp-ai-response">
          <span id="wlp-ai-response-label">What would you naturally say?</span>
          <textarea id="wlp-ai-response" rows="3" placeholder="Type the expression or sentence that comes naturally."></textarea>
          <small>Say what comes naturally. If another expression fits better, that is useful learning evidence too.</small>
        </label>
        <div class="wlp-ai-actions">
          <button class="wlp-ai-submit-button" id="wlp-ai-submit" type="button">Interpret my response</button>
          <button class="wlp-ai-secondary-button" id="wlp-ai-no-idea" type="button">No idea</button>
        </div>
        <p class="wlp-ai-status" id="wlp-ai-status"></p>
        <div class="wlp-ai-generation-retry" id="wlp-ai-generation-retry" hidden>
          <button class="wlp-ai-secondary-button" id="wlp-ai-retry-generation" type="button">Try generating again</button>
          <details><summary>Technical details</summary><code id="wlp-ai-generation-error-detail"></code></details>
        </div>
        <div class="wlp-ai-generation-retry" id="wlp-ai-interpreter-retry" hidden>
          <button class="wlp-ai-secondary-button" id="wlp-ai-retry-interpreter" type="button">Try interpreting again</button>
          <details><summary>Technical details</summary><code id="wlp-ai-interpreter-error-detail"></code></details>
        </div>
        <section class="wlp-ai-feedback" id="wlp-ai-feedback" hidden>
          <div class="wlp-ai-feedback-head">
            <div><span class="section-kicker">Feedback</span><strong id="wlp-ai-feedback-target"></strong><small class="wlp-ai-target-id" id="wlp-ai-target-id"></small></div>
            <button class="wlp-ai-target-peek-toggle" id="wlp-ai-target-peek-toggle" type="button">View WLP card</button>
          </div>
          <div class="wlp-ai-turn-outcome" id="wlp-ai-turn-outcome" hidden></div>
          <div class="wlp-ai-feedback-block">
            <span class="wlp-ai-feedback-label">Target feedback</span>
            <p class="wlp-ai-feedback-text" id="wlp-ai-target-feedback"></p>
          </div>
          <div class="wlp-ai-feedback-block" id="wlp-ai-language-feedback-block">
            <span class="wlp-ai-feedback-label">Language feedback</span>
            <p class="wlp-ai-feedback-text" id="wlp-ai-language-feedback"></p>
          </div>
          <div class="wlp-ai-model-response" id="wlp-ai-model-response" hidden>
            <span class="wlp-ai-feedback-label" id="wlp-ai-model-response-label">Natural example</span>
            <p class="wlp-ai-model-response-text" id="wlp-ai-model-response-text"></p>
          </div>
          <div class="wlp-ai-next-wrap"><span class="wlp-ai-next-label">Next step</span><small id="wlp-ai-next-note"></small><button class="wlp-ai-next-button" id="wlp-ai-next" type="button">Next experience</button></div>
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
        <p class="wlp-ai-finished-cost" id="wlp-ai-finished-cost" hidden></p>
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
    if (state.mode === 'ai') {
      applySavedAISessionSize();
      refreshProviderStatus();
    } else {
      syncAISessionSizePreferenceUI();
    }
  }

  function setBusy(busy, message = '') {
    state.busy = Boolean(busy);
    ['#wlp-ai-start', '#wlp-ai-submit', '#wlp-ai-no-idea', '#wlp-ai-next', '#wlp-ai-end', '#wlp-ai-reconstruction-undo', '#wlp-ai-reconstruction-clear', '#wlp-ai-retry-generation', '#wlp-ai-retry-interpreter'].forEach(selector => {
      const el = $(selector);
      if (el) el.disabled = state.busy;
    });
    if (!state.busy && state.reconstruction) {
      syncReconstructionResponse();
      if (state.reconstruction.locked) {
        const undo = $('#wlp-ai-reconstruction-undo');
        const clear = $('#wlp-ai-reconstruction-clear');
        if (undo) undo.disabled = true;
        if (clear) clear.disabled = true;
      }
    }
    if (message) setStatus(message);
  }

  function setGenerationCancelVisible(visible) {
    const row = $('#wlp-ai-generation-cancel-row');
    const button = $('#wlp-ai-cancel-generation');
    if (row) row.hidden = !visible;
    if (button) button.disabled = !visible;
  }

  function cancelActiveGeneration() {
    if (!state.session || !state.busy) return;
    const completed = num(state.session.completed);
    state.generationEpoch += 1;
    try { state.generationController?.abort?.(); } catch (_) {}
    state.generationController = null;
    state.busy = false;
    setGenerationCancelVisible(false);
    if (completed > 0) {
      finishSession();
      return;
    }
    resetSession({ scrollStart: true });
  }

  function generationStillCurrent(epoch) {
    return epoch === state.generationEpoch && Boolean(state.session);
  }

  function setStatus(message, isError = false) {
    const el = $('#wlp-ai-status');
    if (!el) return;
    el.textContent = clean(message);
    el.classList.toggle('is-error', Boolean(isError));
  }

  function hideGenerationRetry() {
    const wrap = $('#wlp-ai-generation-retry');
    if (wrap) wrap.hidden = true;
    const button = $('#wlp-ai-retry-generation');
    if (button) button.hidden = false;
    const detail = $('#wlp-ai-generation-error-detail');
    if (detail) detail.textContent = '';
  }

  function showGenerationRetry(error) {
    setGenerationCancelVisible(false);
    const info = classifyAIError(error, 'planner');
    const wrap = $('#wlp-ai-generation-retry');
    const button = $('#wlp-ai-retry-generation');
    const detail = $('#wlp-ai-generation-error-detail');
    if (detail) detail.textContent = `[${info.label}] ${formatAIError(error)}`;
    if (button) button.hidden = info.retryMode === 'blocked';
    if (wrap) wrap.hidden = false;
    const lead = info.key === 'reconstruction-contract'
      ? 'The generated reconstruction did not match WLP’s required structure.'
      : info.key === 'planner-contract'
        ? 'The generated experience did not match WLP’s planner format.'
        : info.key === 'provider-temporary' || info.key === 'network'
          ? 'The AI provider or endpoint did not complete this generation.'
          : info.key === 'provider-rate-limit'
            ? 'The AI provider is currently limiting requests.'
            : info.key === 'configuration'
              ? 'AI Study is not fully configured for this request.'
              : 'This experience could not be generated.';
    const tail = info.retryMode === 'blocked'
      ? ' Nothing from this failed generation was saved.'
      : ' Nothing from this failed generation was saved. Try generating again.';
    setStatus(`${lead}${tail}`, true);
  }

  function hideInterpreterRetry() {
    const wrap = $('#wlp-ai-interpreter-retry');
    if (wrap) wrap.hidden = true;
    const button = $('#wlp-ai-retry-interpreter');
    if (button) button.hidden = false;
    const detail = $('#wlp-ai-interpreter-error-detail');
    if (detail) detail.textContent = '';
  }

  function showInterpreterRetry(error) {
    const info = classifyAIError(error, 'interpreter');
    const wrap = $('#wlp-ai-interpreter-retry');
    const button = $('#wlp-ai-retry-interpreter');
    const detail = $('#wlp-ai-interpreter-error-detail');
    if (detail) detail.textContent = `[${info.label}] ${formatAIError(error)}`;
    if (button) button.hidden = info.retryMode === 'blocked';
    if (wrap) wrap.hidden = false;
    const lead = info.key === 'interpreter-contract'
      ? 'The AI feedback did not match WLP’s interpreter format.'
      : info.key === 'provider-temporary' || info.key === 'network'
        ? 'The AI provider or endpoint did not complete the interpretation.'
        : info.key === 'provider-rate-limit'
          ? 'The AI provider is currently limiting requests.'
          : info.key === 'configuration'
            ? 'AI Study is not fully configured for this request.'
            : 'This interpretation could not be completed.';
    const tail = info.retryMode === 'blocked'
      ? ' Your answer is still here, and nothing from the failed interpretation was saved.'
      : ' Your answer is still here, and nothing from the failed interpretation was saved. Try interpreting again.';
    setStatus(`${lead}${tail}`, true);
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

  function parseReconstructionPrompt(value) {
    const source = clean(value);
    const unitsMarker = source.match(/(?:^|\n)\s*RECONSTRUCTION_UNITS:\s*(.+?)\s*$/im);
    if (!unitsMarker) return null;
    const units = unitsMarker[1].split('||').map(clean).filter(Boolean);
    if (units.length < 3) return null;
    const distractorMarker = source.match(/(?:^|\n)\s*RECONSTRUCTION_DISTRACTORS:\s*(.+?)\s*$/im);
    const distractors = distractorMarker ? distractorMarker[1].split('||').map(clean).filter(Boolean) : [];
    const levelMarker = source.match(/(?:^|\n)\s*RECONSTRUCTION_LEVEL:\s*(easy|standard|hard|hell)\s*$/im);
    const missingMarker = source.match(/(?:^|\n)\s*RECONSTRUCTION_MISSING_REQUIRED:\s*(true|false)\s*$/im);
    const rawLevel = clean(levelMarker?.[1] || state.session?.difficulty || 'standard').toLowerCase();
    const level = ['easy','standard','hard','hell'].includes(rawLevel) ? rawLevel : 'standard';
    const missingRequired = clean(missingMarker?.[1]).toLowerCase() === 'true';
    let prompt = source;
    [unitsMarker, distractorMarker, levelMarker, missingMarker].filter(Boolean).forEach(marker => {
      prompt = prompt.replace(marker[0], '');
    });
    prompt = prompt.split(/\r?\n/).filter(line => !/\|\|/.test(line)).join('\n');
    prompt = clean(prompt.replace(/\n{3,}/g, '\n\n'));
    return { prompt, units, distractors, level, missingRequired };
  }

  function validateReconstructionAgainstSession(plannerResult) {
    const response = plannerResult?.response || {};
    const experience = response.experience || {};
    if (clean(experience.type) !== 'sentence-reconstruction') return;
    const parsed = parseReconstructionPrompt(experience.prompt);
    if (!parsed) throw new Error('Planner response validation failed: sentence reconstruction metadata could not be parsed.');
    const requested = clean(state.session?.difficulty || 'adaptive').toLowerCase();
    if (!['easy','standard','hard','hell'].includes(requested)) return;
    if (parsed.level !== requested) {
      throw new Error(`Planner response validation failed: requested ${requested} sentence reconstruction but provider returned ${parsed.level}.`);
    }
    if (['easy','standard'].includes(requested) && (parsed.distractors.length || parsed.missingRequired)) {
      throw new Error(`Planner response validation failed: ${requested} sentence reconstruction must not include distractors or a missing word/form.`);
    }
    if (requested === 'hard') {
      if (parsed.missingRequired) throw new Error('Planner response validation failed: hard sentence reconstruction must not require a missing word/form.');
      if (parsed.distractors.length < 1 || parsed.distractors.length > 2) throw new Error('Planner response validation failed: hard sentence reconstruction must include 1 to 2 distractor chunks.');
    }
    if (requested === 'hell') {
      if (!parsed.missingRequired) throw new Error('Planner response validation failed: hell sentence reconstruction must require exactly one learner-supplied missing word or form.');
      if (parsed.distractors.length < 1 || parsed.distractors.length > 3) throw new Error('Planner response validation failed: hell sentence reconstruction must include 1 to 3 distractor chunks.');
    }
  }

  function shuffleReconstructionUnits(units, distractors = []) {
    const source = [
      ...units.map((text, index) => ({ text, required: true, sourceIndex: index })),
      ...distractors.map((text, index) => ({ text, required: false, sourceIndex: index }))
    ];
    const copy = source.map((item, index) => ({
      id: `chunk-${index}-${Math.random().toString(36).slice(2, 7)}`,
      text: item.text,
      required: item.required,
      sourceIndex: item.sourceIndex
    }));
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function joinReconstructionChunks(chunks, level = 'standard') {
    let sentence = chunks.map(item => clean(item.text)).filter(Boolean).join(' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([\[(“‘])\s+/g, '$1')
      .replace(/\s+([)\]”’])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (level !== 'easy') {
      sentence = sentence.replace(/^([^A-Za-z]*)([a-z])/, (_, lead, letter) => `${lead}${letter.toUpperCase()}`);
    }
    return sentence;
  }

  function resetTargetHint() {
    const assist = $('#wlp-ai-reconstruction-assist');
    const wrap = $('#wlp-ai-target-hint');
    const button = $('#wlp-ai-target-hint-button');
    const textEl = $('#wlp-ai-target-hint-text');
    const taskWrap = $('#wlp-ai-task-hint');
    const taskButton = $('#wlp-ai-task-hint-button');
    const taskList = $('#wlp-ai-task-hint-list');
    if (assist) assist.hidden = true;
    if (wrap) wrap.hidden = true;
    if (button) { button.hidden = false; button.textContent = 'Show target'; }
    if (textEl) { textEl.hidden = true; textEl.textContent = ''; }
    if (taskWrap) taskWrap.hidden = true;
    if (taskButton) { taskButton.hidden = false; taskButton.textContent = 'Need a hint?'; }
    if (taskList) { taskList.hidden = true; taskList.replaceChildren(); }
    if (state.reconstruction) {
      state.reconstruction.targetRevealed = false;
      state.reconstruction.taskHintStage = 0;
    }
  }

  function renderTargetHint(selected = null) {
    const assist = $('#wlp-ai-reconstruction-assist');
    const wrap = $('#wlp-ai-target-hint');
    const button = $('#wlp-ai-target-hint-button');
    const textEl = $('#wlp-ai-target-hint-text');
    const target = clean(selected?.target || state.activePlanner?.result?.response?.selectedTarget?.target);
    if (!assist || !wrap || !button || !textEl || !state.reconstruction || !target) {
      if (assist) assist.hidden = true;
      if (wrap) wrap.hidden = true;
      return;
    }
    assist.hidden = false;
    if (state.reconstruction.level === 'easy') {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const revealed = state.reconstruction.targetRevealed === true;
    button.hidden = false;
    button.textContent = revealed ? 'Hide target' : 'Show target';
    textEl.textContent = `Target: ${target}`;
    textEl.hidden = !revealed;
  }

  function reconstructionTargetTerms(selected = null) {
    const target = clean(selected?.target || state.activePlanner?.result?.response?.selectedTarget?.target);
    const family = Array.isArray(selected?.targetFamily)
      ? selected.targetFamily
      : Array.isArray(state.activePlanner?.result?.response?.selectedTarget?.targetFamily)
        ? state.activePlanner.result.response.selectedTarget.targetFamily
        : [];
    return [target, ...family.map(clean)].filter(Boolean);
  }

  function chunkContainsTarget(chunk, selected = null) {
    const source = clean(chunk).toLowerCase();
    if (!source) return false;
    return reconstructionTargetTerms(selected).some(term => {
      const t = clean(term).toLowerCase();
      return t && (source === t || source.includes(t));
    });
  }

  function buildReconstructionHints(selected = null) {
    const r = state.reconstruction;
    if (!r) return [];
    const required = Array.isArray(r.requiredUnits) ? r.requiredUnits.map(clean).filter(Boolean) : [];
    const distractors = Array.isArray(r.distractors) ? r.distractors.map(clean).filter(Boolean) : [];
    if (!required.length) return [];
    const hints = [];
    const first = required[0];
    const firstLetter = first.match(/[A-Za-z]/)?.[0]?.toUpperCase();
    const targetIndex = required.findIndex(chunk => chunkContainsTarget(chunk, selected));

    if (firstLetter) hints.push(`The first required chunk begins with “${firstLetter}”.`);

    if (r.level === 'easy') {
      if (required.length >= 2) hints.push(`Keep “${required[0]}” directly before “${required[1]}”.`);
      hints.push(`The sentence begins with “${first}”.`);
      return uniqueTexts(hints, 5);
    }

    if (distractors.length) hints.push(`“${distractors[0]}” is one distractor; leave it out.`);

    if (r.level === 'hell' && r.missingRequired) {
      const targetInVisibleRequired = required.some(chunk => chunkContainsTarget(chunk, selected));
      if (!targetInVisibleRequired) hints.push('The missing word or form carries the target meaning or comes from the target word family.');
      else hints.push('The target is already visible; the missing item is a different word or form required by the sentence structure.');
      hints.push('Do not assume two visible chunks are directly adjacent: the missing item may belong between them.');
    } else if (required.length >= 2) {
      let pairIndex = targetIndex >= 0 ? Math.min(Math.max(0, targetIndex), Math.max(0, required.length - 2)) : Math.floor(Math.max(0, required.length - 2) / 2);
      if (pairIndex >= required.length - 1) pairIndex = Math.max(0, required.length - 2);
      const pairA = required[pairIndex];
      const pairB = required[pairIndex + 1];
      if (pairA && pairB) hints.push(`Keep “${pairA}” directly before “${pairB}”.`);
    }

    distractors.slice(1).forEach(item => hints.push(`Another distractor is “${item}”.`));
    hints.push(`The sentence begins with “${first}”.`);
    return uniqueTexts(hints, 8);
  }

  function renderTaskHints(selected = null) {
    const assist = $('#wlp-ai-reconstruction-assist');
    const wrap = $('#wlp-ai-task-hint');
    const button = $('#wlp-ai-task-hint-button');
    const list = $('#wlp-ai-task-hint-list');
    if (!assist || !wrap || !button || !list || !state.reconstruction) {
      if (wrap) wrap.hidden = true;
      return;
    }
    const hints = buildReconstructionHints(selected);
    if (!hints.length) {
      wrap.hidden = true;
      return;
    }
    assist.hidden = false;
    wrap.hidden = false;
    const stage = Math.max(0, Math.min(num(state.reconstruction.taskHintStage), hints.length));
    list.replaceChildren();
    hints.slice(0, stage).forEach((hint, index) => {
      const row = document.createElement('div');
      row.className = 'wlp-ai-task-hint-item';
      const label = document.createElement('b');
      label.textContent = `Hint ${index + 1}`;
      const copy = document.createElement('span');
      copy.textContent = hint;
      row.append(label, copy);
      list.append(row);
    });
    list.hidden = stage === 0;
    button.disabled = stage >= hints.length;
    button.textContent = stage === 0 ? 'Need a hint?' : stage < hints.length ? 'Give me another hint' : 'No more hints';
  }

  function reconstructionSelectedMissing() {
    return state.reconstruction?.selected?.find(item => item.userSupplied) || null;
  }

  function syncReconstructionResponse() {
    const responseBox = $('#wlp-ai-response');
    if (!responseBox) return;
    responseBox.value = joinReconstructionChunks(state.reconstruction?.selected || [], state.reconstruction?.level || 'standard');
    const submit = $('#wlp-ai-submit');
    if (submit && state.reconstruction) submit.disabled = state.reconstruction.selected.length !== state.reconstruction.requiredCount;
  }

  function reconstructionHelp(level, missingRequired, distractorCount) {
    if (level === 'easy') return 'Large meaning chunks. Use every chunk once.';
    if (level === 'hard') return `${distractorCount || 'Some'} extra chunk${distractorCount === 1 ? '' : 's'} do not belong. Build one natural sentence.`;
    if (level === 'hell') return `Extra chunks are mixed in${missingRequired ? ', and one word or form is missing' : ''}. Build one natural sentence without using every option.`;
    return 'Smaller chunks with reduced surface clues. Use every chunk once to build one natural sentence.';
  }

  function reconstructionBankText(item) {
    let value = clean(item?.text);
    const level = clean(state.reconstruction?.level || 'standard');
    if (!value || level === 'easy' || !item?.required) return value;
    const requiredTotal = Array.isArray(state.reconstruction?.requiredUnits) ? state.reconstruction.requiredUnits.length : 0;
    if (item.sourceIndex === 0) {
      value = value.replace(/^([^A-Za-z]*)([A-Z])/, (_, lead, letter) => `${lead}${letter.toLowerCase()}`);
    }
    if (requiredTotal && item.sourceIndex === requiredTotal - 1) value = value.replace(/[.!?]+$/, '');
    return value;
  }

  function renderReconstruction() {
    const wrap = $('#wlp-ai-reconstruction');
    const bank = $('#wlp-ai-reconstruction-bank');
    const answer = $('#wlp-ai-reconstruction-answer');
    if (!wrap || !bank || !answer || !state.reconstruction) return;
    wrap.hidden = false;
    const help = wrap.querySelector(':scope > p');
    if (help) help.textContent = reconstructionHelp(state.reconstruction.level, state.reconstruction.missingRequired, state.reconstruction.distractorCount);
    bank.replaceChildren();
    answer.replaceChildren();
    const selectedIds = new Set(state.reconstruction.selected.filter(item => !item.userSupplied).map(item => item.id));
    state.reconstruction.units.filter(item => !selectedIds.has(item.id)).forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wlp-ai-reconstruction-chip';
      button.dataset.reconstructionAdd = item.id;
      button.textContent = reconstructionBankText(item);
      button.disabled = Boolean(state.reconstruction.locked);
      bank.append(button);
    });
    state.reconstruction.selected.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `wlp-ai-reconstruction-chip is-selected${item.userSupplied ? ' is-user-supplied' : ''}`;
      button.dataset.reconstructionRemove = String(index);
      button.title = item.userSupplied ? 'Tap to remove your supplied word or form' : 'Tap to remove this chunk';
      button.textContent = item.text;
      button.disabled = Boolean(state.reconstruction.locked);
      answer.append(button);
    });
    if (!state.reconstruction.selected.length) {
      const empty = document.createElement('span');
      empty.className = 'wlp-ai-reconstruction-empty';
      empty.textContent = 'Your selected chunks will appear here.';
      answer.append(empty);
    }

    const missingWrap = $('#wlp-ai-reconstruction-missing');
    const missingInput = $('#wlp-ai-reconstruction-missing-input');
    const missingAdd = $('#wlp-ai-reconstruction-missing-add');
    if (missingWrap) missingWrap.hidden = !state.reconstruction.missingRequired;
    if (missingInput) {
      missingInput.disabled = Boolean(state.reconstruction.locked);
      if (missingInput.value !== state.reconstruction.missingText) missingInput.value = state.reconstruction.missingText || '';
    }
    if (missingAdd) missingAdd.disabled = Boolean(state.reconstruction.locked) || !clean(state.reconstruction.missingText) || Boolean(reconstructionSelectedMissing());

    const undo = $('#wlp-ai-reconstruction-undo');
    const clear = $('#wlp-ai-reconstruction-clear');
    if (undo) undo.disabled = Boolean(state.reconstruction.locked) || !state.reconstruction.selected.length;
    if (clear) clear.disabled = Boolean(state.reconstruction.locked) || !state.reconstruction.selected.length;
    renderTargetHint();
    renderTaskHints();
    syncReconstructionResponse();
  }

  function resetReconstruction() {
    state.reconstruction = null;
    const wrap = $('#wlp-ai-reconstruction');
    if (wrap) wrap.hidden = true;
    const missingWrap = $('#wlp-ai-reconstruction-missing');
    if (missingWrap) missingWrap.hidden = true;
    const missingInput = $('#wlp-ai-reconstruction-missing-input');
    if (missingInput) missingInput.value = '';
    const field = $('#wlp-ai-response-field');
    if (field) field.hidden = false;
    resetTargetHint();
  }

  async function buildCandidateContext(session) {
    const { data } = requireLayers();
    const source = session.source;
    const base = {
      sessionId: session.sessionId,
      sourceMode: source.mode,
      sourceLabel: source.label,
      difficulty: session.difficulty || 'adaptive',
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
        difficulty: session.difficulty || 'adaptive'
      },
      candidateContext,
      learnerSessionState: candidateContext.learnerSessionState,
      targetPackets,
      plannerConstraints: {
        maxTargets: 1,
        allowMultiTarget: false,
        avoidRecentRouteRepetition: true,
        naturalnessGateRequired: true,
        targetNeedNotBeExplicit: true,
        experienceTypeMode: session.practiceType === 'adaptive' ? 'adaptive' : 'override',
        requiredExperienceType: session.practiceType === 'adaptive' ? null : session.practiceType
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
    const details = usage.input_tokens_details || usage.prompt_tokens_details || {};
    const cachedInput = num(details.cached_tokens ?? details.cachedTokens ?? usage.cached_input_tokens ?? usage.cachedInputTokens);
    const total = num(usage.total_tokens ?? usage.totalTokenCount ?? usage.total_token_count) || input + output;
    return { input, cachedInput, output, total };
  }

  function usageSnapshot(session = state.session) {
    return {
      inputTokens: num(session?.inputTokens),
      cachedInputTokens: num(session?.cachedInputTokens),
      outputTokens: num(session?.outputTokens),
      totalTokens: num(session?.totalTokens)
    };
  }

  function usageDelta(start, session = state.session) {
    const now = usageSnapshot(session);
    return {
      inputTokens: Math.max(0, now.inputTokens - num(start?.inputTokens)),
      cachedInputTokens: Math.max(0, now.cachedInputTokens - num(start?.cachedInputTokens)),
      outputTokens: Math.max(0, now.outputTokens - num(start?.outputTokens)),
      totalTokens: Math.max(0, now.totalTokens - num(start?.totalTokens))
    };
  }

  function recordLatency(kind, ms, ok = true) {
    const session = state.session;
    if (!session) return;
    const bucket = kind === 'planner' ? session.plannerLatencies : session.interpreterLatencies;
    bucket.push({ ms, ok });
  }

  const FAILURE_CATEGORY_LABELS = Object.freeze({
    'reconstruction-contract': 'Reconstruction contract',
    'planner-contract': 'Planner format check',
    'interpreter-contract': 'Interpreter format check',
    'provider-temporary': 'Provider / endpoint temporary failure',
    'provider-rate-limit': 'Provider rate / quota limit',
    'provider-output': 'Provider output failure',
    'network': 'Network / transport failure',
    'configuration': 'Configuration failure',
    'other': 'Other failure'
  });

  function classifyAIError(error, stage = '') {
    const message = clean(error?.message || error);
    const code = clean(error?.code).toLowerCase();
    const quotaScope = clean(error?.quotaScope).toLowerCase();
    const status = num(error?.statusCode || error?.providerHttpStatus);
    const haystack = `${code} ${message}`.toLowerCase();
    const plannerStage = clean(stage).toLowerCase() === 'planner';

    if (/not configured|api[_ -]?key/.test(haystack)) {
      return { key: 'configuration', label: FAILURE_CATEGORY_LABELS.configuration, retryMode: 'blocked' };
    }
    if (quotaScope === 'daily' || /daily(?: provider)? quota|daily request limit|requests-per-day/.test(haystack)) {
      return { key: 'provider-rate-limit', label: 'Provider daily quota', retryMode: 'blocked' };
    }
    if (status === 429 || /rate limit|quota/.test(haystack)) {
      return { key: 'provider-rate-limit', label: FAILURE_CATEGORY_LABELS['provider-rate-limit'], retryMode: 'manual' };
    }
    if (/sentence[- ]reconstruction|reconstruction_(?:units|level|distractors|missing)|reconstruction metadata/.test(haystack)) {
      return { key: 'reconstruction-contract', label: FAILURE_CATEGORY_LABELS['reconstruction-contract'], retryMode: plannerStage ? 'automatic' : 'manual' };
    }
    if (/planner response validation failed|planner response rejected|planner.*(?:validation|format)/.test(haystack)) {
      return { key: 'planner-contract', label: FAILURE_CATEGORY_LABELS['planner-contract'], retryMode: 'automatic' };
    }
    if (/interpreter response validation failed|unsupported language observation|routepatch|learnerfacingresponse/.test(haystack)) {
      return { key: 'interpreter-contract', label: FAILURE_CATEGORY_LABELS['interpreter-contract'], retryMode: 'manual' };
    }
    if (status >= 500 || /http 50[0234]|endpoint returned http 50|temporarily unavailable|provider.*busy|server error/.test(haystack)) {
      return { key: 'provider-temporary', label: FAILURE_CATEGORY_LABELS['provider-temporary'], retryMode: 'manual' };
    }
    if (/failed to fetch|networkerror|network request|network failure|timed out|timeout/.test(haystack)) {
      return { key: 'network', label: FAILURE_CATEGORY_LABELS.network, retryMode: 'manual' };
    }
    if (/provider_bad_json|could not be parsed as json|no text output|provider_empty|provider_refusal|declined to produce/.test(haystack)) {
      return { key: 'provider-output', label: FAILURE_CATEGORY_LABELS['provider-output'], retryMode: 'manual' };
    }
    return { key: 'other', label: FAILURE_CATEGORY_LABELS.other, retryMode: 'manual' };
  }

  function recordFailure(error, stage, { attempts = 1, retryMode = '' } = {}) {
    const session = state.session;
    if (!session) return null;
    const info = classifyAIError(error, stage);
    const event = {
      at: new Date().toISOString(),
      stage: clean(stage) || 'unknown',
      category: info.key,
      label: info.label,
      retryMode: clean(retryMode) || info.retryMode,
      attempts: Math.max(1, num(attempts) || 1),
      message: clean(error?.message || error).slice(0, 420)
    };
    if (!Array.isArray(session.failureEvents)) session.failureEvents = [];
    session.failureEvents.push(event);
    if (session.failureEvents.length > 40) session.failureEvents.splice(0, session.failureEvents.length - 40);
    return event;
  }

  function noteRetry(kind) {
    const session = state.session;
    if (!session) return;
    if (!session.retryStats || typeof session.retryStats !== 'object') {
      session.retryStats = { automaticGeneration: 0, manualGeneration: 0, manualInterpreter: 0 };
    }
    if (Object.prototype.hasOwnProperty.call(session.retryStats, kind)) session.retryStats[kind] = num(session.retryStats[kind]) + 1;
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
    session.cachedInputTokens += usage.cachedInput;
    session.outputTokens += usage.output;
    session.totalTokens += usage.total;
    recordLatency(kind, ms, true);
    return attempts;
  }

  function addRejectedUsage(meta, kind, ms, error = null, retryMode = 'automatic') {
    const session = state.session;
    if (!session) return 0;
    session.failedAICalls += 1;
    const attempts = Math.max(1, num(meta?.transportAttemptCount) || 1);
    session.providerAttempts += attempts;
    session.lastCallKind = kind;
    session.provider = clean(meta?.provider || session.provider);
    session.model = clean(meta?.model || session.model);
    const usage = usageCounts(meta);
    session.inputTokens += usage.input;
    session.cachedInputTokens += usage.cachedInput;
    session.outputTokens += usage.output;
    session.totalTokens += usage.total;
    recordLatency(kind, ms, false);
    if (error) recordFailure(error, kind, { attempts, retryMode });
    return attempts;
  }

  function isRetryablePlannerGenerationError(error) {
    const message = clean(error?.message || error);
    return /Planner response validation failed|Planner response rejected|sentence reconstruction metadata could not be parsed/i.test(message);
  }

  function addFailedUsage(error, kind, ms, retryMode = 'manual') {
    const session = state.session;
    if (!session) return 0;
    session.failedAICalls += 1;
    const attempts = Math.max(0, num(error?.attemptCount));
    if (attempts) session.providerAttempts += attempts;
    recordLatency(kind, ms, false);
    recordFailure(error, kind, { attempts: attempts || 1, retryMode });
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

  function prepareExperienceLoading(message = 'Creating a new AI experience…') {
    hideGenerationRetry();
    hideInterpreterRetry();
    const experience = $('#wlp-ai-experience');
    if (experience) experience.hidden = false;
    $('#wlp-ai-finished').hidden = true;
    $('#wlp-ai-feedback').hidden = true;
    const outcomeEl = $('#wlp-ai-turn-outcome');
    if (outcomeEl) { outcomeEl.hidden = true; outcomeEl.textContent = ''; }
    const domainEl = $('#wlp-ai-domain');
    if (domainEl) { domainEl.textContent = ''; domainEl.hidden = true; }
    const labelEl = $('#wlp-ai-experience-label');
    if (labelEl) labelEl.textContent = 'Preparing experience';
    const promptEl = $('#wlp-ai-prompt');
    if (promptEl) promptEl.textContent = '';
    const frameEl = $('#wlp-ai-frame');
    if (frameEl) { frameEl.textContent = ''; frameEl.hidden = true; }
    const visibleTarget = $('#wlp-ai-visible-target');
    if (visibleTarget) { visibleTarget.textContent = ''; visibleTarget.hidden = true; }
    resetTargetHint();
    resetReconstruction();
    const responseBox = $('#wlp-ai-response');
    if (responseBox) { responseBox.value = ''; responseBox.disabled = true; }
    const responseField = $('#wlp-ai-response-field');
    if (responseField) responseField.hidden = true;
    const submit = $('#wlp-ai-submit');
    const noIdea = $('#wlp-ai-no-idea');
    if (submit) submit.hidden = true;
    if (noIdea) noIdea.hidden = true;
    if (state.session) {
      $('#wlp-ai-source-pill').textContent = state.session.source.label;
      $('#wlp-ai-progress').textContent = `${state.session.completed + 1} / ${state.session.total}`;
    }
    setGenerationCancelVisible(true);
    setStatus(message);
  }

  function renderExperience(plannerResult) {
    hideGenerationRetry();
    hideInterpreterRetry();
    setGenerationCancelVisible(false);
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
    const experienceLabel = clean(experience.type || response.learningOpportunity?.direction || 'Adaptive experience').replace(/-/g, ' ');
    const difficultySuffix = state.session?.difficulty && state.session.difficulty !== 'adaptive' ? ` · ${difficultyLabel(state.session.difficulty)}` : '';
    $('#wlp-ai-experience-label').textContent = `${experienceLabel}${difficultySuffix}`;
    const reconstruction = clean(experience.type) === 'sentence-reconstruction' ? parseReconstructionPrompt(experience.prompt) : null;
    $('#wlp-ai-prompt').textContent = reconstruction ? reconstruction.prompt : clean(experience.prompt);
    const frame = clean(experience.responseFrame);
    const frameEl = $('#wlp-ai-frame');
    frameEl.textContent = frame ? frame.replace(/\{answer\}/g, '______') : '';
    frameEl.hidden = !frame || Boolean(reconstruction);
    const visibleTarget = $('#wlp-ai-visible-target');
    const visibility = clean(experience.targetVisibility).toLowerCase();
    const reconstructionLevel = clean(reconstruction?.level || state.session?.difficulty || 'standard');
    const reconstructionAutoTarget = Boolean(reconstruction) && reconstructionLevel === 'easy';
    if (reconstruction) {
      if (reconstructionAutoTarget && clean(selected.target)) {
        visibleTarget.textContent = `Target: ${clean(selected.target)}`;
        visibleTarget.hidden = false;
      } else {
        visibleTarget.hidden = true;
        visibleTarget.textContent = '';
      }
    } else if (visibility === 'visible') {
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
    const responseField = $('#wlp-ai-response-field');
    if (reconstruction) {
      state.reconstruction = {
        units: shuffleReconstructionUnits(reconstruction.units, reconstruction.distractors),
        selected: [],
        locked: false,
        level: reconstruction.level,
        missingRequired: reconstruction.missingRequired,
        missingText: '',
        targetRevealed: false,
        taskHintStage: 0,
        requiredUnits: reconstruction.units.slice(),
        distractors: reconstruction.distractors.slice(),
        distractorCount: reconstruction.distractors.length,
        requiredCount: reconstruction.units.length + (reconstruction.missingRequired ? 1 : 0)
      };
      responseBox.disabled = false;
      responseField.hidden = true;
      renderReconstruction();
    } else {
      resetReconstruction();
      responseBox.disabled = false;
    }
    $('#wlp-ai-submit').hidden = false;
    $('#wlp-ai-no-idea').hidden = false;
    $('#wlp-ai-submit').disabled = Boolean(reconstruction);
    $('#wlp-ai-no-idea').disabled = false;
    setStatus('');
    responseBox.focus({ preventScroll: true });
    $('#wlp-ai-experience').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadNextExperience() {
    if (!state.session || state.busy) return;
    const generationEpoch = state.generationEpoch + 1;
    state.generationEpoch = generationEpoch;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.generationController = controller;
    const difficultyText = state.session.difficulty && state.session.difficulty !== 'adaptive' ? ` · ${difficultyLabel(state.session.difficulty)}` : '';
    prepareExperienceLoading(`Creating a new ${practiceTypeLabel(state.session.practiceType)}${difficultyText} experience…`);
    setBusy(true);
    let plannerStarted = null;
    const experienceUsageStart = usageSnapshot(state.session);
    try {
      const { transport } = requireLayers();
      const built = await buildFreshPlannerRequest(state.session);
      if (!generationStillCurrent(generationEpoch)) return;
      const maxGenerationAttempts = 3;
      let lastError = null;
      for (let generationAttempt = 1; generationAttempt <= maxGenerationAttempts; generationAttempt += 1) {
        if (!generationStillCurrent(generationEpoch) || controller?.signal?.aborted) return;
        let plannerResult = null;
        plannerStarted = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        try {
          setStatus(generationAttempt === 1
            ? 'Creating the next adaptive experience…'
            : `The previous generation missed WLP's format check. Regenerating automatically… (${generationAttempt}/${maxGenerationAttempts})`);
          plannerResult = await transport.callPlannerWriter(built.request);
          if (!generationStillCurrent(generationEpoch) || controller?.signal?.aborted) return;
          const plannerElapsed = elapsedMs(plannerStarted);
          try {
            validateReconstructionAgainstSession(plannerResult);
          } catch (validationError) {
            const willAutoRetry = generationAttempt < maxGenerationAttempts;
            addRejectedUsage(plannerResult.meta, 'planner', plannerElapsed, validationError, willAutoRetry ? 'automatic' : 'manual');
            lastError = validationError;
            if (willAutoRetry) {
              noteRetry('automaticGeneration');
              continue;
            }
            throw validationError;
          }
          const plannerAttempts = addUsage(plannerResult.meta, 'planner', plannerElapsed);
          if (!generationStillCurrent(generationEpoch)) return;
          state.activePlanner = {
            request: built.request,
            result: plannerResult,
            eventId: makeId('ai-study-event'),
            diagnostics: {
              elapsedMs: plannerElapsed,
              providerAttempts: plannerAttempts,
              provider: clean(plannerResult.meta?.provider),
              model: clean(plannerResult.meta?.model),
              generationAttempt,
              usageStart: experienceUsageStart
            }
          };
          const selectedId = clean(plannerResult.response?.selectedTarget?.wordId);
          if (selectedId) state.session.usedTargets[selectedId] = (state.session.usedTargets[selectedId] || 0) + 1;
          renderExperience(plannerResult);
          return;
        } catch (error) {
          if (!generationStillCurrent(generationEpoch) || controller?.signal?.aborted || clean(error?.name) === 'AbortError') return;
          const willAutoRetry = isRetryablePlannerGenerationError(error) && generationAttempt < maxGenerationAttempts;
          if (!plannerResult) addFailedUsage(error, 'planner', elapsedMs(plannerStarted), willAutoRetry ? 'automatic' : 'manual');
          lastError = error;
          if (willAutoRetry) {
            noteRetry('automaticGeneration');
            continue;
          }
          throw error;
        }
      }
      if (lastError) throw lastError;
    } catch (error) {
      if (!generationStillCurrent(generationEpoch) || controller?.signal?.aborted || clean(error?.name) === 'AbortError') return;
      state.activePlanner = null;
      showGenerationRetry(error);
    } finally {
      if (generationEpoch === state.generationEpoch) {
        state.generationController = null;
        setGenerationCancelVisible(false);
        setBusy(false);
      }
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
    hideInterpreterRetry();
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
      const turnUsage = usageDelta(state.activePlanner?.diagnostics?.usageStart, state.session);
      const turnProvider = clean(interpreterResult.meta?.provider || state.activePlanner?.diagnostics?.provider);
      const turnModel = clean(interpreterResult.meta?.model || state.activePlanner?.diagnostics?.model);
      const turnDiagnostics = {
        interpreterElapsed,
        interpreterAttempts,
        provider: turnProvider,
        model: turnModel,
        ...turnUsage,
        estimatedCostUsd: estimatedCostUsd(turnUsage, turnProvider, turnModel)
      };
      state.session.turns.push(turnSnapshot(interpreterResult.response, text, turnDiagnostics));
      renderFeedback(interpreterResult.response, committed, turnDiagnostics);
    } catch (error) {
      if (interpreterStarted != null) {
        const failedAttempts = addFailedUsage(error, 'interpreter', elapsedMs(interpreterStarted), 'manual');
        if (state.activePlanner?.diagnostics) {
          state.activePlanner.diagnostics.failedInterpreterCalls = num(state.activePlanner.diagnostics.failedInterpreterCalls) + 1;
          state.activePlanner.diagnostics.failedInterpreterAttempts = num(state.activePlanner.diagnostics.failedInterpreterAttempts) + failedAttempts;
        }
      }
      const failure = classifyAIError(error, 'interpreter');
      if (failure.retryMode === 'blocked') setStatus(formatAIError(error), true);
      else showInterpreterRetry(error);
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
    const outcome = deriveTurnOutcome(response, clean($('#wlp-ai-response')?.value), clean(state.activePlanner?.result?.response?.experience?.type));
    const outcomeEl = $('#wlp-ai-turn-outcome');
    if (outcomeEl) {
      outcomeEl.replaceChildren(makeOutcomeChip(outcome));
      outcomeEl.hidden = !clean(outcome.label);
    }
    const legacyFeedback = clean(learner.feedback || response?.evidence?.observationSummary || 'Response interpreted.');
    $('#wlp-ai-target-feedback').textContent = clean(learner.targetFeedback) || legacyFeedback;

    const languageFeedback = clean(learner.languageFeedback);
    const languageBlock = $('#wlp-ai-language-feedback-block');
    $('#wlp-ai-language-feedback').textContent = languageFeedback || 'No separate language-level feedback was returned for this turn.';
    languageBlock.hidden = false;

    const modelBlock = $('#wlp-ai-model-response');
    const modelLabel = $('#wlp-ai-model-response-label');
    const modelText = $('#wlp-ai-model-response-text');
    const suggested = clean(learner.suggestedNaturalForm);
    const modelResponse = clean(learner.modelResponse);
    const modelDisplay = learner.correctionNeeded && suggested ? suggested : modelResponse;
    if (modelDisplay) {
      const experienceType = clean(state.activePlanner?.result?.response?.experience?.type);
      modelLabel.textContent = learner.correctionNeeded && suggested
        ? 'Natural form'
        : experienceType === 'sentence-reconstruction'
          ? 'One natural answer'
          : 'Natural example';
      const family = Array.isArray(selected.targetFamily) ? selected.targetFamily : [];
      renderHighlightedText(modelText, modelDisplay, [target, ...family]);
      modelBlock.hidden = false;
    } else {
      modelText.textContent = '';
      modelBlock.hidden = true;
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
    if (Number.isFinite(turnDiagnostics.estimatedCostUsd)) timingParts.push(`Estimated cost ${formatUsd(turnDiagnostics.estimatedCostUsd)}`);
    if (provider || model) timingParts.push([provider, model].filter(Boolean).join(' · '));
    $('#wlp-ai-turn-diagnostics').textContent = timingParts.join(' · ');

    const nextNote = $('#wlp-ai-next-note');
    nextNote.textContent = clean(learner.nextStep) || 'This turn is saved as learning evidence. The next experience can adapt from it.';
    const nextButton = $('#wlp-ai-next');
    const done = state.session.completed >= state.session.total;
    nextButton.textContent = done ? 'Finish session' : 'Next experience';
    $('#wlp-ai-feedback').hidden = false;
    $('#wlp-ai-response').disabled = true;
    if (state.reconstruction) { state.reconstruction.locked = true; renderReconstruction(); }
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
    persistAISessionSizePreference();
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
      practiceType: selectedPracticeType(),
      difficulty: selectedDifficulty(),
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
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      plannerLatencies: [],
      interpreterLatencies: [],
      failureEvents: [],
      retryStats: { automaticGeneration: 0, manualGeneration: 0, manualInterpreter: 0 },
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
    $('#wlp-ai-finished-title').textContent = completedAll ? 'Session complete.' : session.completed ? 'Session saved.' : 'Session ended.';
    $('#wlp-ai-finished-summary').textContent = session.completed
      ? `You completed ${session.completed} of ${session.total} planned experience${session.total === 1 ? '' : 's'}. Learning evidence from completed turns is saved so future AI Study can adapt from it.`
      : 'No interpreted experience was completed, so no session review was added to AI Study History.';

    const stats = $('#wlp-ai-finished-stats');
    stats.textContent = '';
    const finishItems = [`${session.completed} experience${session.completed === 1 ? '' : 's'}`, session.source.label];
    if (session.practiceType && session.practiceType !== 'adaptive') finishItems.push(practiceTypeLabel(session.practiceType));
    if (session.difficulty && session.difficulty !== 'adaptive') finishItems.push(difficultyLabel(session.difficulty));
    finishItems.forEach(itemText => {
      const span = document.createElement('span');
      span.textContent = itemText;
      stats.appendChild(span);
    });

    const record = sessionRecord(session);
    const finishedCost = $('#wlp-ai-finished-cost');
    const estimatedSessionCost = sessionCost(record);
    if (finishedCost) {
      if (Number.isFinite(estimatedSessionCost)) {
        const avg = session.completed ? estimatedSessionCost / session.completed : null;
        finishedCost.textContent = avg != null
          ? `Estimated session cost: ${formatUsd(estimatedSessionCost)} · Average ${formatUsd(avg)} / completed experience`
          : `Estimated session cost: ${formatUsd(estimatedSessionCost)}`;
        finishedCost.hidden = false;
      } else {
        finishedCost.textContent = '';
        finishedCost.hidden = true;
      }
    }
    renderSessionReview(record);
    const historySaved = session.completed ? saveSessionHistory(record) : true;
    renderHistory();
    if (!historySaved) {
      $('#wlp-ai-finished-summary').textContent += ' The learning evidence is saved, but the local AI Study History snapshot could not be written on this device.';
    }

    const diagnostics = $('#wlp-ai-finished-diagnostics-body');
    diagnostics.textContent = '';
    appendSessionDiagnosticRows(diagnostics, record);
    state.activePlanner = null;
  }

  function resetSession({ focusStart = false, scrollStart = false } = {}) {
    state.generationEpoch += 1;
    try { state.generationController?.abort?.(); } catch (_) {}
    state.generationController = null;
    setGenerationCancelVisible(false);
    state.session = null;
    state.activePlanner = null;
    resetReconstruction();
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
    $('#wlp-ai-practice-type')?.addEventListener('change', updatePracticeTypeHelp);
    $('#wlp-ai-difficulty')?.addEventListener('change', updateDifficultyHelp);
    $('#wlp-ai-remember-session-size')?.addEventListener('change', persistAISessionSizePreference);
    $('#study-session-size')?.addEventListener('change', syncAISessionSizePreferenceUI);
    $('#wlp-ai-session-size-use-current')?.addEventListener('click', setCurrentAISessionSizeAsDefault);
    $('#wlp-ai-start')?.addEventListener('click', beginSession);
    $('#wlp-ai-cancel-generation')?.addEventListener('click', cancelActiveGeneration);
    $('#wlp-ai-retry-generation')?.addEventListener('click', () => {
      if (!state.session || state.busy) return;
      noteRetry('manualGeneration');
      loadNextExperience();
    });
    $('#wlp-ai-retry-interpreter')?.addEventListener('click', () => {
      if (!state.session || !state.activePlanner || state.busy) return;
      noteRetry('manualInterpreter');
      interpretResponse();
    });
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
    $('#wlp-ai-target-hint-button')?.addEventListener('click', () => {
      if (!state.reconstruction || state.busy || state.reconstruction.level === 'easy') return;
      state.reconstruction.targetRevealed = !state.reconstruction.targetRevealed;
      renderTargetHint();
    });
    $('#wlp-ai-task-hint-button')?.addEventListener('click', () => {
      if (!state.reconstruction || state.busy) return;
      const hints = buildReconstructionHints();
      if (!hints.length) return;
      state.reconstruction.taskHintStage = Math.min(hints.length, num(state.reconstruction.taskHintStage) + 1);
      renderTaskHints();
    });
    $('#wlp-ai-reconstruction')?.addEventListener('click', event => {
      if (!state.reconstruction || state.busy) return;
      const add = event.target.closest?.('[data-reconstruction-add]');
      if (add) {
        const item = state.reconstruction.units.find(chunk => chunk.id === add.dataset.reconstructionAdd);
        if (item && !state.reconstruction.selected.some(chunk => chunk.id === item.id)) state.reconstruction.selected.push(item);
        renderReconstruction();
        return;
      }
      const remove = event.target.closest?.('[data-reconstruction-remove]');
      if (remove) {
        const index = Number(remove.dataset.reconstructionRemove);
        if (Number.isInteger(index) && index >= 0) state.reconstruction.selected.splice(index, 1);
        renderReconstruction();
      }
    });
    $('#wlp-ai-reconstruction-undo')?.addEventListener('click', () => {
      if (!state.reconstruction || state.busy) return;
      state.reconstruction.selected.pop();
      renderReconstruction();
    });
    $('#wlp-ai-reconstruction-clear')?.addEventListener('click', () => {
      if (!state.reconstruction || state.busy) return;
      state.reconstruction.selected = [];
      renderReconstruction();
    });
    $('#wlp-ai-reconstruction-missing-input')?.addEventListener('input', event => {
      if (!state.reconstruction || state.busy) return;
      state.reconstruction.missingText = clean(event.target.value);
      const selectedMissing = reconstructionSelectedMissing();
      if (selectedMissing) selectedMissing.text = state.reconstruction.missingText;
      renderReconstruction();
    });
    $('#wlp-ai-reconstruction-missing-add')?.addEventListener('click', () => {
      if (!state.reconstruction || state.busy || !state.reconstruction.missingRequired) return;
      const value = clean(state.reconstruction.missingText);
      if (!value || reconstructionSelectedMissing()) return;
      state.reconstruction.selected.push({ id: 'user-missing', text: value, userSupplied: true, required: true });
      renderReconstruction();
    });
    $('#wlp-ai-reconstruction-missing-input')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      $('#wlp-ai-reconstruction-missing-add')?.click();
    });
    $('#wlp-ai-response')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') interpretResponse();
    });
  }

  function init() {
    injectUI();
    ensureSessionSizePreferenceUI();
    bindEvents();
    if (state.mode === 'ai') applySavedAISessionSize();
    else syncAISessionSizePreferenceUI();
    let stored = 'standard';
    try { stored = localStorage.getItem(MODE_KEY) || 'standard'; } catch (_) {}
    setMode(stored === 'ai' ? 'ai' : 'standard', false);
    updatePracticeTypeHelp();
    updateDifficultyHelp();
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
