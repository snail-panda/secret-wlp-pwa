/* WLP Stage 7 — AI Study 1.9.4 + Study Set Source bridge v1.8.6.133
   Preserve the validated AI Practice 1.9.4 behavior; add only temporary Study Set source support. */
(() => {
  'use strict';

  const VERSION = '1.9.5';
  const MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const TEMP_STUDY_SET_KEY = 'wlp:temporary-study-set:v1';
  const SESSION_HISTORY_KEY = 'wlp:ai-study-session-history:v1';
  const AI_SESSION_SIZE_KEY = 'wlp:ai-study-session-size:v1';
  const AI_HINT_LIMIT_KEY = 'wlp:ai-study-hint-limit:v1';
  const DEFAULT_HINT_LIMIT = 4;
  const VALID_HINT_LIMITS = new Set([0, 2, 4, 6]);
  const PROGRESS_PREFIX = 'fc:wordid:';
  const MAX_CANDIDATES = 30;
  const MAX_TARGET_PACKETS = 3;
  const TARGET_AUDIT_MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';

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

  const OPEN_PRODUCTION_HINT_TYPES = new Set([
    'situational-production',
    'open-description',
    'dialogue',
    'micro-story',
    'free-composition',
    'continuation'
  ]);

  const PREPOSITION_WORDS = new Set([
    'about','above','across','after','against','along','among','around','at','before','behind','below','beneath','beside','between','beyond',
    'by','despite','down','during','for','from','in','inside','into','like','near','of','off','on','onto','out','outside','over','past','through',
    'throughout','to','toward','towards','under','underneath','until','up','upon','with','within','without'
  ]);

  const state = {
    mode: 'standard',
    providerInfo: null,
    providerReady: false,
    session: null,
    activePlanner: null,
    busy: false,
    reconstruction: null,
    assistance: null,
    generationEpoch: 0,
    generationController: null,
    devExactWID: ''
  };

  const $ = selector => document.querySelector(selector);
  const clean = value => String(value ?? '').trim();
  const num = value => Number(value || 0);
  const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));


  function normalizeDevExactWID(value) {
    const raw = clean(value);
    const match = raw.match(/^(?:wid\s*)?(\d+)$/i);
    if (!match) throw new Error('Exact WID test expects a numeric WordID such as 419 or WID419.');
    const normalized = String(Number(match[1]));
    if (!normalized || normalized === '0') throw new Error('Exact WID test expects a WordID greater than 0.');
    return normalized;
  }

  function exactWIDCandidates(candidates, wordId) {
    const wanted = clean(wordId);
    return (Array.isArray(candidates) ? candidates : []).filter(item => clean(item?.wordId) === wanted);
  }

  function validateExactWIDSelection(plannerResult, exactWordId) {
    const wanted = clean(exactWordId);
    if (!wanted) return true;
    const selected = clean(plannerResult?.response?.selectedTarget?.wordId);
    if (selected !== wanted) {
      throw new Error(`Planner response validation failed: exact WID test expected WID${wanted}, but the Planner selected ${selected ? `WID${selected}` : 'no WordID'}.`);
    }
    return true;
  }

  function armExactWIDTest(value) {
    if (state.busy) throw new Error('Wait for the current AI request to finish before arming an exact WID test.');
    const wordId = normalizeDevExactWID(value);
    state.devExactWID = wordId;
    setStatus(`DEV exact-WID test armed for WID${wordId}. The next generated AI Experience will use only this WLP card.`);
    return { armed: true, wordId, oneShot: true };
  }

  function clearExactWIDTest() {
    const previous = clean(state.devExactWID);
    state.devExactWID = '';
    if (previous) setStatus(`DEV exact-WID test cleared (WID${previous}).`);
    return { armed: false, previousWordId: previous || null };
  }

  function exactWIDTestState() {
    return {
      armedWordId: clean(state.devExactWID) || null,
      activeWordId: clean(state.activePlanner?.diagnostics?.exactWIDTest) || null,
      oneShot: true
    };
  }

  function runExactWIDHookSelfTest() {
    const checks = [];
    const add = (name, passed, actual = null) => checks.push({ name, passed: Boolean(passed), actual });
    try { add('normalizes-numeric', normalizeDevExactWID(419) === '419', normalizeDevExactWID(419)); } catch (error) { add('normalizes-numeric', false, clean(error?.message)); }
    try { add('normalizes-prefixed', normalizeDevExactWID('WID419') === '419', normalizeDevExactWID('WID419')); } catch (error) { add('normalizes-prefixed', false, clean(error?.message)); }
    let invalidRejected = false;
    try { normalizeDevExactWID('pit'); } catch (_) { invalidRejected = true; }
    add('rejects-non-wid-input', invalidRejected, invalidRejected);
    const sample = [{ wordId: '418' }, { wordId: '419' }, { wordId: '420' }];
    const narrowed = exactWIDCandidates(sample, '419');
    add('narrows-to-one-exact-candidate', narrowed.length === 1 && clean(narrowed[0]?.wordId) === '419', narrowed.map(item => clean(item?.wordId)));
    let exactAccepted = false;
    try { exactAccepted = validateExactWIDSelection({ response: { selectedTarget: { wordId: '419' } } }, '419') === true; } catch (_) {}
    add('accepts-exact-planner-selection', exactAccepted, exactAccepted);
    let mismatchRejected = false;
    try { validateExactWIDSelection({ response: { selectedTarget: { wordId: '420' } } }, '419'); } catch (_) { mismatchRejected = true; }
    add('rejects-planner-target-drift', mismatchRejected, mismatchRejected);
    return { passed: checks.every(item => item.passed), checks };
  }

  function createAssistanceState(initialTargetVisibility = 'hidden') {
    return {
      initialTargetVisibility: clean(initialTargetVisibility).toLowerCase() || 'hidden',
      targetRevealed: false,
      targetRevealedEver: false,
      targetRevealCount: 0,
      hintCount: 0,
      taskHintStage: 0,
      locked: false,
      hintEvents: [],
      openProductionHintPlan: [],
      clozeHintPlan: [],
      universalFallbackHintPlan: []
    };
  }

  function resetAssistanceState(initialTargetVisibility = 'hidden') {
    state.assistance = createAssistanceState(initialTargetVisibility);
    return state.assistance;
  }

  function noteTargetReveal() {
    const a = state.assistance || resetAssistanceState();
    a.targetRevealCount = num(a.targetRevealCount) + 1;
    a.targetRevealedEver = true;
  }

  function noteHintUse(kind = 'task-hint', stage = 0) {
    const a = state.assistance || resetAssistanceState();
    const normalizedKind = clean(kind) || 'task-hint';
    const normalizedStage = Math.max(1, num(stage) || 1);
    if (!Array.isArray(a.hintEvents)) a.hintEvents = [];
    const key = `${normalizedKind}:${normalizedStage}`;
    if (!a.hintEvents.some(item => `${clean(item?.kind)}:${num(item?.stage)}` === key)) {
      a.hintEvents.push({ kind: normalizedKind, stage: normalizedStage });
      a.hintCount = num(a.hintCount) + 1;
    }
  }

  function assistanceSnapshot(source = state.assistance) {
    const a = source && typeof source === 'object' ? source : createAssistanceState();
    const targetRevealed = a.targetRevealedEver === true || num(a.targetRevealCount) > 0;
    const hintCount = Math.max(0, num(a.hintCount));
    const initialTargetVisibility = clean(a.initialTargetVisibility).toLowerCase() || 'hidden';
    const support = targetRevealed
      ? 'target-assisted'
      : hintCount > 0
        ? 'hint-assisted'
        : initialTargetVisibility === 'visible'
          ? 'task-visible-target'
          : 'unaided';
    return {
      support,
      initialTargetVisibility,
      targetRevealed,
      targetRevealCount: Math.max(0, num(a.targetRevealCount)),
      hintCount,
      hintEvents: Array.isArray(a.hintEvents)
        ? a.hintEvents.map(item => ({ kind: clean(item?.kind), stage: Math.max(1, num(item?.stage) || 1) })).filter(item => item.kind).slice(0, 12)
        : []
    };
  }

  function assistanceLabel(value = assistanceSnapshot()) {
    const support = clean(value?.support || value);
    if (support === 'target-assisted') return 'Target-assisted production';
    if (support === 'hint-assisted') return 'Hint-assisted production';
    if (support === 'task-visible-target') return 'Target visible by task design';
    return 'Unaided retrieval / production';
  }

  function assistanceSummary(value = assistanceSnapshot()) {
    const snapshot = value && typeof value === 'object' && value.support ? value : assistanceSnapshot(value);
    const parts = [assistanceLabel(snapshot)];
    if (snapshot.targetRevealed) parts.push(`target revealed${snapshot.targetRevealCount > 1 ? ` ×${snapshot.targetRevealCount}` : ''}`);
    if (snapshot.hintCount) parts.push(`${snapshot.hintCount} hint${snapshot.hintCount === 1 ? '' : 's'} used`);
    return parts.join(' · ');
  }

  function effectiveInitialTargetVisibility(experienceType, plannerVisibility = 'hidden') {
    return clean(experienceType) === 'sentence-reconstruction'
      ? 'hidden'
      : (clean(plannerVisibility).toLowerCase() || 'hidden');
  }

  function runAssistanceSelfTest() {
    const cases = [
      ['unaided', createAssistanceState('hidden'), 'unaided'],
      ['task-visible', createAssistanceState('visible'), 'task-visible-target'],
      ['hint-assisted', { ...createAssistanceState('hidden'), hintCount: 1, hintEvents: [{ kind: 'reconstruction-hint', stage: 1 }] }, 'hint-assisted'],
      ['target-assisted', { ...createAssistanceState('hidden'), targetRevealedEver: true, targetRevealCount: 1 }, 'target-assisted'],
      ['target-outranks-hint', { ...createAssistanceState('hidden'), targetRevealedEver: true, targetRevealCount: 1, hintCount: 2 }, 'target-assisted']
    ];
    const checks = cases.map(([name, input, expected]) => {
      const actual = assistanceSnapshot(input).support;
      return { name, passed: actual === expected, expected, actual };
    });
    const reconstructionVisibility = effectiveInitialTargetVisibility('sentence-reconstruction', 'visible');
    checks.push({ name: 'reconstruction-starts-hidden', passed: reconstructionVisibility === 'hidden', expected: 'hidden', actual: reconstructionVisibility });
    const taskVisible = effectiveInitialTargetVisibility('reverse-reconstruction', 'visible');
    checks.push({ name: 'task-designed-visible-target-preserved', passed: taskVisible === 'visible', expected: 'visible', actual: taskVisible });
    return { passed: checks.every(item => item.passed), checks };
  }

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

  function uniqueClean(values, limit = 8) {
    const out = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach(value => {
      const text = clean(value).replace(/\s+/g, ' ');
      const key = text.toLowerCase();
      if (!text || seen.has(key) || out.length >= limit) return;
      seen.add(key);
      out.push(text);
    });
    return out;
  }

  function hasJapaneseText(value) {
    return /[\u3040-\u30ff\u3400-\u9fff]/u.test(clean(value));
  }

  function stripKnownMetaResidue(value) {
    let text = clean(value).replace(/\s+/g, ' ');
    const notes = [];
    let focus = '';
    if (!text) return { text: '', notes, focus };

    const original = text;
    text = text
      .replace(/\s*(?:日本語で|日本語|意味|とは)\s*[?？]?$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== original) notes.push('removed Japanese lookup residue');

    // Parenthetical Japanese/source glosses are metadata when a usable Latin-script
    // expression exists outside the parentheses. Keep the gloss in the card, but
    // do not ask the learner to reproduce it as part of the English target.
    const sourceGloss = text.match(/^(.+?)\s*\(([^()]*)\)\s*$/u);
    if (sourceGloss && hasJapaneseText(sourceGloss[2]) && /[A-Za-zÀ-ž]/u.test(sourceGloss[1])) {
      text = clean(sourceGloss[1]);
      notes.push('removed parenthetical source-language gloss');
    }

    // Editorial labels such as “(adjective)” or “(slang)” belong in metadata/POS,
    // not in the literal practice target.
    const editorialParen = text.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
    if (editorialParen && /^(?:adj(?:ective)?|adv(?:erb)?|noun|verb|phrase|idiom|slang|informal|formal|hyperbolic|figurative|literal|regional|dialectal|euphemistic|vulgar|medical|legal|law|chiefly\s+(?:british|american)|br(?:itish\s+)?e|am(?:erican\s+)?e|uk|us)(?:\s*[,;/&+]\s*(?:adj(?:ective)?|adv(?:erb)?|noun|verb|phrase|idiom|slang|informal|formal|hyperbolic|figurative|literal|regional|dialectal|euphemistic|vulgar|medical|legal|law|br(?:itish\s+)?e|am(?:erican\s+)?e|uk|us))*$/i.test(clean(editorialParen[2]))) {
      text = clean(editorialParen[1]);
      notes.push('removed parenthetical editorial label');
    }

    // Bare lookup residue such as “directive meaning” is safe to strip when the
    // candidate before “meaning/definition” is a single lexical item. Keep real
    // phrases such as “lose its meaning” intact.
    const bareMeaning = text.match(/^([A-Za-zÀ-ž][A-Za-zÀ-ž'’.-]*)\s+(?:meaning|definition)$/iu);
    if (bareMeaning) {
      text = clean(bareMeaning[1]);
      notes.push('removed bare meaning/definition lookup suffix');
    }

    const defineMatch = text.match(/^define\s+(.+)$/i);
    if (defineMatch) {
      text = clean(defineMatch[1]);
      notes.push('removed define-query wrapper');
    }

    // Be deliberately conservative here. “lose its meaning” is a real phrase,
    // while “disconnect meaning as a noun” is clearly a lookup wrapper.
    const meaningMatch = text.match(/^(.+?)\s+(?:meaning|definition)(?:\s+as\s+(?:a|an)\s+(.+?))?\s*([?？]?)$/i);
    if (meaningMatch) {
      const explicitFocus = clean(meaningMatch[2]);
      const explicitQuestion = Boolean(clean(meaningMatch[3]));
      if (explicitFocus || explicitQuestion) {
        text = clean(meaningMatch[1]);
        focus = explicitFocus;
        notes.push('removed meaning/definition query residue');
      }
    }

    const parentheticalMeta = text.match(/^(.+?)\s*\(([^)]*(?:why|what|how|meaning|mean|called|difference)[^)]*)\)\s*$/i);
    if (parentheticalMeta) {
      text = clean(parentheticalMeta[1]);
      notes.push('removed parenthetical meta-question');
    }

    return { text, notes, focus };
  }

  function splitContrastTarget(value) {
    return uniqueClean(clean(value).split(/\s+(?:vs\.?|versus)\s+/i), 4);
  }

  function protectVariableSlotSlashes(value) {
    return clean(value).replace(/\b(something|someone|somebody|somewhere|oneself|one['’]s|sth\.?|sb\.?)\s*\/\s*(something|someone|somebody|somewhere|oneself|one['’]s|sth\.?|sb\.?)\b/gi, (_, left, right) => `${left}∕${right}`);
  }

  function restoreProtectedSlashes(value) {
    return clean(value).replace(/∕/g, '/');
  }

  function splitOutsideParentheses(value, delimiter, { spacedOnly = false } = {}) {
    const text = String(value ?? '');
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
      if (depth !== 0 || ch !== delimiter) continue;
      if (spacedOnly) {
        const before = text[i - 1] || '';
        const after = text[i + 1] || '';
        if (!/\s/.test(before) || !/\s/.test(after)) continue;
      }
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    parts.push(text.slice(start));
    return parts.map(part => restoreProtectedSlashes(part)).map(clean).filter(Boolean);
  }

  function expandCompactSlashSegment(value) {
    const protectedSegment = protectVariableSlotSlashes(value);
    const segment = clean(protectedSegment);
    if (!segment) return [];

    const spaced = splitOutsideParentheses(segment, '/', { spacedOnly: true });
    if (spaced.length >= 2) return uniqueClean(spaced, 8);

    const pieces = splitOutsideParentheses(segment, '/');
    if (pieces.length < 2) return [restoreProtectedSlashes(segment)];

    const tokenized = pieces.map(part => part.split(/\s+/).filter(Boolean));
    // Compact alternatives at the end: “coin a word/term/phrase” →
    // “coin a word / coin a term / coin a phrase”.
    if (tokenized[0].length >= 2 && tokenized.slice(1).every(tokens => tokens.length === 1)) {
      const prefix = tokenized[0].slice(0, -1).join(' ');
      const alts = [tokenized[0].at(-1), ...tokenized.slice(1).map(tokens => tokens[0])];
      return uniqueClean(alts.map(alt => `${prefix} ${alt}`), 8);
    }

    // Compact alternatives at the beginning: “go/come to the brink” →
    // “go to the brink / come to the brink”.
    if (tokenized.at(-1).length >= 2 && tokenized.slice(0, -1).every(tokens => tokens.length === 1)) {
      const suffix = tokenized.at(-1).slice(1).join(' ');
      const alts = [...tokenized.slice(0, -1).map(tokens => tokens[0]), tokenized.at(-1)[0]];
      return uniqueClean(alts.map(alt => `${alt} ${suffix}`), 8);
    }

    // Shared prefix + compact particle/preposition: “look on/upon someone as” →
    // “look on someone as / look upon someone as”.
    if (pieces.length === 2 && tokenized[0].length >= 2 && tokenized[1].length >= 2) {
      const prefix = tokenized[0].slice(0, -1).join(' ');
      const leftAlt = tokenized[0].at(-1);
      const rightAlt = tokenized[1][0];
      const suffix = tokenized[1].slice(1).join(' ');
      if (prefix && leftAlt && rightAlt && suffix) {
        return uniqueClean([`${prefix} ${leftAlt} ${suffix}`, `${prefix} ${rightAlt} ${suffix}`], 8);
      }
    }

    return uniqueClean(pieces, 8);
  }

  function splitFamilyTarget(value) {
    const text = clean(value);
    if (!text || /https?:\/\//i.test(text) || /\band\/or\b/i.test(text)) return [];
    const protectedText = protectVariableSlotSlashes(text);
    const groups = splitOutsideParentheses(protectedText, ';');
    const parts = groups.flatMap(expandCompactSlashSegment);
    return parts.length >= 2 ? uniqueClean(parts, 8) : [];
  }

  function splitRelationNoteTarget(value, pos = '') {
    const text = clean(value);
    if (!text || !/\b(?:word[- ]?family|derivation|related\s+(?:word|form)|relationship)\b/i.test(clean(pos))) return [];
    const match = text.match(/^(.+?)\s*(?:→|->|=>|=)\s*(.+)$/);
    if (!match) return [];
    const left = stripKnownMetaResidue(match[1]).text || clean(match[1]);
    const rightRaw = stripKnownMetaResidue(match[2]).text || clean(match[2]);
    const rightFamily = splitFamilyTarget(rightRaw);
    return uniqueClean([left, ...(rightFamily.length ? rightFamily : [rightRaw])], 8).filter(isSafeEnglishPracticeUnit);
  }

  function expandVocabularyCluster(value) {
    const text = clean(value);
    const match = text.match(/^(.+?)\s+(?:vocabulary|word)\s+cluster:\s*(.+)$/i);
    if (!match) return [];
    const prefix = clean(match[1]);
    const options = splitFamilyTarget(match[2]);
    if (!prefix || options.length < 2) return [];
    return uniqueClean(options.map(option => /^\b/.test(option) ? `${prefix} ${option}` : `${prefix} ${option}`), 8);
  }

  function detectMetaQuestion(value) {
    const text = clean(value);
    if (!text || !/(?:\?|？)\s*$/.test(text)) return false;
    return /^(?:define\b|what\s+(?:does|do)\b.+\bmean\b|what\s+(?:is|are)\s+the\s+(?:meaning|definition)\b|.+\b(?:meaning|definition)\s*[?？]$)/i.test(text);
  }

  function detectSentenceExpression(value) {
    const text = clean(value);
    if (!text) return false;
    const words = text.split(/\s+/).filter(Boolean);
    return words.length >= 4 && (/[.!?]$/.test(text) || /^(?:i|you|we|they|he|she|it|there|that|this|what|why|how|who|where|when)\b/i.test(text));
  }

  function extractPosCategories(target) {
    let pos = clean(target?.pos).toLowerCase();
    if (!pos) return [];
    // “related verb: stagger” describes a neighbor, not another POS of the target.
    pos = pos.replace(/;?\s*related\s+(?:verb|noun|adjective|adverb)\s*:[^;,/]+/gi, ' ');
    const found = [];
    const tests = [
      ['noun', /\bnoun\b/i],
      ['verb', /\bverb\b/i],
      ['adjective', /\badjective\b|\badj\.?\b/i],
      ['adverb', /\badverb\b|\badv\.?\b/i],
      ['preposition', /\bpreposition\b/i],
      ['conjunction', /\bconjunction\b/i],
      ['interjection', /\binterjection\b/i],
      ['pronoun', /\bpronoun\b/i],
      ['determiner', /\bdeterminer\b/i]
    ];
    tests.forEach(([name, re]) => { if (re.test(pos)) found.push(name); });
    return uniqueClean(found, 8);
  }

  function detectMultiPos(target) {
    return extractPosCategories(target).length >= 2;
  }

  function variantKey(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function inflectionStems(value) {
    const word = clean(value).toLowerCase().replace(/[’']/g, '');
    const out = new Set([word]);
    if (!/^[a-z-]+$/.test(word)) return out;
    if (word.endsWith('ies') && word.length > 4) out.add(`${word.slice(0, -3)}y`);
    if (word.endsWith('ied') && word.length > 4) {
      out.add(`${word.slice(0, -3)}y`);
      out.add(word.slice(0, -1));
    }
    if (word.endsWith('ing') && word.length > 5) {
      const stem = word.slice(0, -3);
      out.add(stem);
      out.add(`${stem}e`);
      if (stem.length >= 2 && stem.at(-1) === stem.at(-2)) out.add(stem.slice(0, -1));
    }
    if (word.endsWith('ed') && word.length > 4) {
      const stem = word.slice(0, -2);
      out.add(stem);
      out.add(`${stem}e`);
      if (stem.length >= 2 && stem.at(-1) === stem.at(-2)) out.add(stem.slice(0, -1));
    }
    if (word.endsWith('d') && word.length > 3) out.add(word.slice(0, -1));
    if (word.endsWith('es') && word.length > 4) out.add(word.slice(0, -2));
    if (word.endsWith('s') && word.length > 3) out.add(word.slice(0, -1));
    return out;
  }

  function wordsLookInflectionRelated(a, b) {
    const aStems = inflectionStems(a);
    const bStems = inflectionStems(b);
    return Array.from(aStems).some(item => bStems.has(item));
  }

  function phrasesLookFormRelated(a, b) {
    const aa = clean(a).toLowerCase().split(/\s+/).filter(Boolean);
    const bb = clean(b).toLowerCase().split(/\s+/).filter(Boolean);
    if (!aa.length || aa.length !== bb.length) return false;
    let differences = 0;
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] === bb[i]) continue;
      if (!wordsLookInflectionRelated(aa[i], bb[i])) return false;
      differences += 1;
      if (differences > 1) return false;
    }
    return differences === 1;
  }

  function classifyFamilyHandling(units) {
    const values = uniqueClean(units, 8);
    if (values.length < 2) return 'single';
    const variantKeys = values.map(variantKey).filter(Boolean);
    if (variantKeys.length === values.length && new Set(variantKeys).size === 1) return 'variant';
    const first = values[0];
    if (values.slice(1).every(item => phrasesLookFormRelated(first, item))) return 'form-family';
    return 'alternative-expression';
  }

  function hasVariableSlot(value) {
    return /\b(?:do\s+something|doing\s+something|something|someone|somebody|somewhere|oneself|one['’]s|someone['’]s|somebody['’]s|sth\.?|sb\.?)\b/i.test(clean(value));
  }

  function isSafeEnglishPracticeUnit(value) {
    const text = clean(value);
    if (!text) return false;
    if (!/[A-Za-zÀ-ž]/u.test(text)) return false;
    if (hasJapaneseText(text) && !/^[A-Za-zÀ-ž]/u.test(text)) return false;
    return true;
  }

  function analyzeTargetReadiness(packet) {
    const p = packet && typeof packet === 'object' ? packet : {};
    const target = p.target && typeof p.target === 'object' ? p.target : {};
    const rawHeadword = clean(target.headword);
    const resolverKind = clean(target.targetKind).toLowerCase() || 'simple';
    const targetFamily = uniqueClean(target.targetFamily, 8);
    const hazards = [];
    const guidance = [];
    const metaClean = stripKnownMetaResidue(rawHeadword);
    let normalizedHeadword = metaClean.text || rawHeadword;
    let kind = resolverKind;
    let status = metaClean.notes.length ? 'normalize' : 'ready';
    let handling = 'single';
    let practiceUnits = [];
    let rawHeadwordLiteralTargetAllowed = metaClean.notes.length === 0;
    let focus = metaClean.focus;

    const contrastParts = splitContrastTarget(normalizedHeadword);
    const relationParts = splitRelationNoteTarget(normalizedHeadword, target.pos);
    const clusterParts = expandVocabularyCluster(normalizedHeadword);
    const familyParts = splitFamilyTarget(normalizedHeadword);
    const mixedLanguage = hasJapaneseText(rawHeadword);
    const metaQuery = Boolean(metaClean.notes.some(note => /query|meta-question|lookup residue/i.test(note))) || detectMetaQuestion(rawHeadword);
    const posCategories = extractPosCategories(target);
    const multiPos = posCategories.length >= 2;

    if (relationParts.length >= 2) {
      kind = 'family';
      handling = 'alternative-expression';
      practiceUnits = relationParts;
      status = 'normalize';
      rawHeadwordLiteralTargetAllowed = false;
      hazards.push('relation or word-family notation');
      guidance.push('The arrow/relation notation is metadata. Choose one real expression/form as the practice target; never ask the learner to reproduce the relation label itself.');
    } else if (clusterParts.length >= 2) {
      kind = 'family';
      handling = 'alternative-expression';
      practiceUnits = clusterParts;
      status = 'normalize';
      rawHeadwordLiteralTargetAllowed = false;
      hazards.push('editorial vocabulary-cluster label');
      guidance.push('The cluster label is editorial metadata. Choose one expanded practice unit for this turn rather than the literal cluster heading.');
    } else if (resolverKind === 'contrast' || contrastParts.length >= 2) {
      kind = 'contrast';
      handling = 'contrast';
      practiceUnits = contrastParts.length >= 2 ? contrastParts : targetFamily.slice(0, 4);
      rawHeadwordLiteralTargetAllowed = false;
      hazards.push('multi-target contrast');
      guidance.push('Treat each side as its own practice unit. A contrast experience may compare them, but selectedTarget.target must be one practiceable expression, never the literal “X vs Y” label.');
    } else if (resolverKind === 'family' || familyParts.length >= 2) {
      kind = 'family';
      practiceUnits = familyParts.length >= 2 ? familyParts : targetFamily.slice(0, 8);
      handling = classifyFamilyHandling(practiceUnits);
      rawHeadwordLiteralTargetAllowed = false;
      hazards.push(handling === 'variant' ? 'orthographic or presentation variants' : handling === 'form-family' ? 'inflectional or form family' : 'alternative expressions or constructions');
      if (handling === 'variant') guidance.push('Treat these as equivalent written/presentation variants. One natural variant is enough for a turn; do not require every spelling/capitalization form.');
      else if (handling === 'form-family') guidance.push('Choose one grammatically appropriate family form for this turn. Keep the lemma/family relationship available, but do not require every form in one answer.');
      else guidance.push('These slash-separated items are related alternatives/constructions rather than one literal answer. Choose one natural unit for the current task unless the experience explicitly compares alternatives.');
    } else if (resolverKind === 'construction' || hasVariableSlot(normalizedHeadword)) {
      kind = 'construction';
      handling = 'construction';
      practiceUnits = [normalizedHeadword];
      hazards.push('construction with variable slot');
      guidance.push('Preserve the constructional relationship and let the variable slot inflect or change naturally; do not reduce the card to an isolated content word.');
    } else if (resolverKind === 'labeled' || /\s*:\s*(?:synonyms?(?:\s*(?:and|&|\/)\s*near[- ]synonyms?)?|near[- ]synonyms?|usage(?:\s+notes?)?|contrast(?:s)?|related expressions?)\s*$/i.test(normalizedHeadword)) {
      kind = 'labeled';
      handling = 'labeled';
      const stripped = normalizedHeadword.replace(/\s*:\s*(?:synonyms?(?:\s*(?:and|&|\/)\s*near[- ]synonyms?)?|near[- ]synonyms?|usage(?:\s+notes?)?|contrast(?:s)?|related expressions?)\s*$/i, '').trim();
      normalizedHeadword = stripped || normalizedHeadword;
      practiceUnits = [normalizedHeadword];
      status = 'normalize';
      rawHeadwordLiteralTargetAllowed = false;
      hazards.push('editorial label in headword');
      guidance.push('The colon label is metadata, not learner language. Practice the underlying expression and use the label only to shape comparison/neighbor work.');
    } else {
      practiceUnits = [normalizedHeadword];
    }

    // Clean each unit separately, then exclude source-language-only units from
    // English production targets. The full card remains available as context.
    const cleanedUnitResults = practiceUnits.map(unit => stripKnownMetaResidue(unit));
    const cleanedUnits = cleanedUnitResults.map((result, index) => result.text || clean(practiceUnits[index]));
    if (cleanedUnitResults.some(result => Array.isArray(result.notes) && result.notes.length)) {
      if (status !== 'review') status = 'normalize';
      rawHeadwordLiteralTargetAllowed = false;
      guidance.push('One or more family members contained editorial/lookup residue; use the cleaned practiceUnits, not the literal annotated member text.');
    }
    const englishUnits = uniqueClean(cleanedUnits.filter(isSafeEnglishPracticeUnit), 8);
    if (mixedLanguage) {
      hazards.push('mixed-language headword');
      rawHeadwordLiteralTargetAllowed = false;
      if (englishUnits.length) {
        practiceUnits = englishUnits;
        status = 'normalize';
        guidance.push('Use the English/Latin-script practice unit and treat Japanese/source-language text as source gloss or comparison metadata, not as required learner output.');
      } else {
        practiceUnits = [];
        status = 'review';
        guidance.push('No safe English/Latin-script practice unit remained after source-language cleanup. Prefer another candidate rather than inventing an English target.');
      }
    } else {
      practiceUnits = englishUnits.length ? englishUnits : uniqueClean(cleanedUnits, 8);
    }

    if (metaQuery) {
      hazards.push('lookup/meta-query residue');
      rawHeadwordLiteralTargetAllowed = false;
      if (practiceUnits.length) {
        if (status !== 'review') status = 'normalize';
        guidance.push('Do not make the learner reproduce search-query wording. Practice the underlying expression/concept only.');
      } else {
        status = 'review';
      }
    }

    const senseSelectionRequired = multiPos;
    if (multiPos) {
      hazards.push('multiple parts of speech');
      if (handling === 'single') handling = 'sense-selection';
      guidance.push(`Choose one part of speech / sense for this turn (${posCategories.join(' / ')}) and keep the prompt, expected form, and feedback consistent with that choice. Do not test all senses at once.`);
    }

    const shortQuestionExpression = /[?？]$/.test(normalizedHeadword) && /\b(?:expression|interjection|question|utterance)\b/i.test(clean(target.pos));
    const longQuotedExpression = normalizedHeadword.split(/\s+/).filter(Boolean).length >= 4 && /\b(?:quotation|proverb(?:-like)?|saying|maxim)\b/i.test(clean(target.pos));
    if ((detectSentenceExpression(normalizedHeadword) || shortQuestionExpression || longQuotedExpression) && !metaQuery) {
      if (kind === 'simple') kind = 'sentence-expression';
      if (handling === 'single') handling = 'sentence-expression';
      hazards.push('sentence or pragmatic expression');
      guidance.push('The full sentence-like expression may itself be the legitimate target. Do not automatically extract a single content word from it.');
    }

    if (!practiceUnits.length && targetFamily.length && !mixedLanguage) practiceUnits = targetFamily.slice(0, 8);
    if (!practiceUnits.length && normalizedHeadword && !hasJapaneseText(normalizedHeadword)) practiceUnits = [normalizedHeadword];
    if (!practiceUnits.length) {
      status = 'review';
      hazards.push('no deterministic practice unit');
      guidance.push('No safe practice unit could be derived locally. Prefer another candidate rather than inventing a target.');
    }

    // Reclassify family handling after mixed-language cleanup removed source glosses.
    if (kind === 'family' && practiceUnits.length >= 2) handling = classifyFamilyHandling(practiceUnits);
    if (kind === 'family' && practiceUnits.length === 1 && handling !== 'labeled') handling = multiPos ? 'sense-selection' : 'single';
    if (kind === 'contrast' && practiceUnits.length < 2) {
      guidance.push('Only one English practice unit survived deterministic cleanup; use the other side as conceptual/source context rather than required output.');
    }

    // For constructions, the complete practice unit is the target. Do not let a
    // resolver-side lexical family candidate collapse “pit someone/something
    // against someone/something” to the isolated verb “pit”.
    const primaryTarget = clean(practiceUnits[0] || normalizedHeadword);

    return {
      schemaVersion: 2,
      status,
      handling,
      kind,
      resolverKind,
      rawHeadword,
      normalizedHeadword,
      primaryTarget,
      practiceUnits,
      targetFamily,
      pos: clean(target.pos),
      posCategories,
      senseSelectionRequired,
      entryType: clean(target.entryType),
      focus,
      rawHeadwordLiteralTargetAllowed,
      hazards: uniqueClean(hazards, 10),
      guidance: uniqueClean(guidance, 8)
    };
  }

  function annotateTargetPacketsForReadiness(packets) {
    return (Array.isArray(packets) ? packets : []).map(packet => ({
      ...packet,
      targetReadiness: analyzeTargetReadiness(packet)
    }));
  }

  function normalizeTargetKey(value) {
    return clean(value).toLowerCase().replace(/[“”"'’`]/g, '').replace(/[.?!,:;()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function validateComplexTargetSelection(plannerResult, request) {
    const selected = plannerResult?.response?.selectedTarget || {};
    const selectedId = clean(selected.wordId);
    const packets = Array.isArray(request?.targetPackets) ? request.targetPackets : [];
    const packet = packets.find(item => clean(item?.target?.wordId) === selectedId);
    const readiness = packet?.targetReadiness;
    if (!readiness || typeof readiness !== 'object') return;
    if (clean(readiness.status) === 'review' && !(Array.isArray(readiness.practiceUnits) && readiness.practiceUnits.length)) {
      throw new Error('Planner response validation failed: selected target has no safe Complex Target Readiness practice unit.');
    }
    const selectedKey = normalizeTargetKey(selected.target);
    const rawKey = normalizeTargetKey(readiness.rawHeadword);
    if (readiness.rawHeadwordLiteralTargetAllowed === false && selectedKey && rawKey && selectedKey === rawKey) {
      throw new Error(`Planner response validation failed: complex target label “${clean(readiness.rawHeadword)}” was selected literally instead of one safe practice unit.`);
    }
    if (clean(readiness.kind) === 'contrast' && /\b(?:vs\.?|versus)\b/i.test(clean(selected.target))) {
      throw new Error('Planner response validation failed: a contrast card must select one expression as selectedTarget.target, not the literal comparison label.');
    }
    if (clean(readiness.kind) === 'family' && /\//.test(clean(selected.target))) {
      throw new Error('Planner response validation failed: a family card must select one practiceable family member/form, not the slash-joined headword.');
    }
  }

  function runTargetReadinessSelfTest() {
    const packet = (headword, targetKind = 'simple', pos = '', family = []) => ({ target: { headword, targetKind, pos, targetFamily: family } });
    const cases = [
      ['simple', packet('overwrought'), r => r.status === 'ready' && r.handling === 'single' && r.primaryTarget === 'overwrought'],
      ['contrast', packet('flop vs hit', 'contrast'), r => r.status === 'ready' && r.handling === 'contrast' && r.practiceUnits.join('|') === 'flop|hit'],
      ['form-family', packet('abrogate / abrogated', 'family', 'verb; past / past participle: abrogated'), r => r.status === 'ready' && r.handling === 'form-family' && r.practiceUnits.length === 2],
      ['variant', packet("bull's-eye / bullseye", 'family', 'noun'), r => r.status === 'ready' && r.handling === 'variant'],
      ['alternative-expression', packet('get a lemon / buy a lemon', 'family', 'idiom'), r => r.status === 'ready' && r.handling === 'alternative-expression'],
      ['compact-family', packet('go/come to the brink of; bring/take to the brink', 'simple', 'idiomatic phrase family'), r => r.practiceUnits.join('|') === 'go to the brink of|come to the brink of|bring to the brink|take to the brink'],
      ['compact-multi-tail', packet('coin a word/term/phrase', 'simple', 'verb'), r => r.practiceUnits.join('|') === 'coin a word|coin a term|coin a phrase'],
      ['compact-shared-prefix', packet('look on/upon someone or something as ...', 'simple', 'phrasal pattern'), r => r.practiceUnits.join('|') === 'look on someone or something as ...|look upon someone or something as ...'],
      ['variable-slot-slash-safe', packet('be hung up on something/someone / get hung up on', 'family', 'idiom / phrasal expression'), r => r.practiceUnits.join('|') === 'be hung up on something/someone|get hung up on'],
      ['parenthetical-slash-safe', packet('be terminal (slang/hyperbolic)', 'simple', 'slang / source-dependent adjective use'), r => r.status === 'normalize' && r.primaryTarget === 'be terminal' && r.practiceUnits.length === 1],
      ['relation-note', packet('irk → irritation / annoyance (noun)', 'simple', 'word-family note'), r => r.status === 'normalize' && r.practiceUnits.join('|') === 'irk|irritation|annoyance'],
      ['vocabulary-cluster', packet('STEM vocabulary cluster: fields / disciplines / education / workforce / sector', 'family', 'noun phrase cluster'), r => r.status === 'normalize' && r.practiceUnits.join('|') === 'STEM fields|STEM disciplines|STEM education|STEM workforce|STEM sector'],
      ['family-lookup-echo', packet('directive / directive meaning', 'family', 'noun; adjective'), r => r.status === 'normalize' && r.practiceUnits.join('|') === 'directive'],
      ['construction', packet('blow something out of proportion', 'construction', 'verb phrase'), r => r.status === 'ready' && r.handling === 'construction'],
      ['implicit-construction', packet('set someone off', 'simple', 'phrasal verb'), r => r.status === 'ready' && r.kind === 'construction' && r.handling === 'construction'],
      ['labeled', packet('ledge: synonyms and near-synonyms', 'labeled', 'noun'), r => r.status === 'normalize' && r.handling === 'labeled' && r.primaryTarget === 'ledge'],
      ['japanese-residue', packet('hyperosmia 日本語で', 'simple', 'noun'), r => r.status === 'normalize' && r.primaryTarget === 'hyperosmia'],
      ['mixed-gloss', packet('a mixed bag (玉石混交)', 'simple', 'idiom'), r => r.status === 'normalize' && r.primaryTarget === 'a mixed bag'],
      ['meaning-query', packet('disconnect meaning as a noun', 'simple', 'noun'), r => r.status === 'normalize' && r.primaryTarget === 'disconnect' && r.focus === 'noun'],
      ['real-meaning-phrase', packet('lose its meaning', 'simple', 'phrase'), r => r.status === 'ready' && r.primaryTarget === 'lose its meaning'],
      ['parenthetical-query', packet("garden-path sentence (why 'garden path'?)", 'simple', 'noun'), r => r.status === 'normalize' && r.primaryTarget === 'garden-path sentence'],
      ['conversational-question', packet('Why come to me about it?', 'simple', 'conversational expression'), r => r.status === 'ready' && r.kind === 'sentence-expression'],
      ['short-question-expression', packet("What's the tea?", 'simple', 'slang expression'), r => r.status === 'ready' && r.kind === 'sentence-expression' && r.handling === 'sentence-expression'],
      ['sentence-expression', packet("You don't want to know.", 'simple', 'pragmatic expression'), r => r.status === 'ready' && r.kind === 'sentence-expression'],
      ['multi-pos-sense-selection', packet('stable', 'simple', 'noun / adjective / verb'), r => r.status === 'ready' && r.handling === 'sense-selection' && r.senseSelectionRequired === true],
      ['related-pos-not-multi', packet('staggering', 'simple', 'adjective; related verb: stagger'), r => r.status === 'ready' && r.senseSelectionRequired === false],
      ['bilingual-contrast', packet('logogram vs phonogram (表意文字 vs 表音文字)', 'contrast', 'linguistics contrast'), r => r.status === 'normalize' && r.handling === 'contrast' && r.practiceUnits.join('|') === 'logogram|phonogram'],
      ['construction-slot-primary', packet('pit someone/something against someone/something', 'simple', 'verb phrase', ['pit']), r => r.kind === 'construction' && r.handling === 'construction' && r.primaryTarget === 'pit someone/something against someone/something'],
      ['construction-slot-primary-ellipsis', packet('take someone/something for ...', 'simple', 'verb phrase', ['take']), r => r.kind === 'construction' && r.primaryTarget === 'take someone/something for ...'],
      ['long-quotation-expression', packet('greatest glory in living lies not in never falling but in rising every time we fall', 'simple', 'quotation / proverb-like saying'), r => r.kind === 'sentence-expression' && r.handling === 'sentence-expression'],
      ['japanese-only-review', packet('蛙化現象: coined in 2004 → popularized from around 2019', 'simple', 'etymology / usage history'), r => r.status === 'review']
    ];
    const checks = cases.map(([name, input, test]) => {
      const result = analyzeTargetReadiness(input);
      let passed = false;
      try { passed = Boolean(test(result)); } catch (_) {}
      return { name, passed, result };
    });
    return { passed: checks.every(item => item.passed), checks };
  }

  function parseAuditTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i], next = source[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i += 1; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i += 1;
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
    return table.slice(1).map(cols => Object.fromEntries(headers.map((header, index) => [header, clean(cols[index])])));
  }

  function readinessAuditSuspicionReasons(readiness, target) {
    const raw = clean(readiness?.rawHeadword || target?.headword);
    const handling = clean(readiness?.handling);
    const reasons = [];
    if (!raw) return ['empty headword'];

    const slashParts = splitOutsideParentheses(protectVariableSlotSlashes(raw), '/', { spacedOnly: true });
    const caseOnlySlashVariant = slashParts.length >= 2 && new Set(slashParts.map(variantKey).filter(Boolean)).size === 1;
    if (/\//.test(raw) && !['variant','form-family','alternative-expression','construction'].includes(handling) && !caseOnlySlashVariant) reasons.push('unclassified slash structure');
    if (/\b(?:vs\.?|versus)\b/i.test(raw) && handling !== 'contrast') reasons.push('unclassified comparison marker');
    if (/:/.test(raw) && !['labeled','construction'].includes(handling) && clean(readiness?.status) !== 'normalize') reasons.push('unclassified colon structure');
    if (/[()]/.test(raw) && clean(readiness?.status) === 'ready' && !/\((?:s|es)\)/i.test(raw)) reasons.push('unclassified parenthetical material');
    if (/[?？]/.test(raw) && clean(readiness?.kind) !== 'sentence-expression') reasons.push('question-mark headword not classified as expression');
    if (hasJapaneseText(raw) && clean(readiness?.status) === 'ready') reasons.push('mixed-language text left ready');
    if (/\b(?:meaning|definition|define|synonyms?|difference)\b/i.test(raw) && clean(readiness?.status) === 'ready') reasons.push('lookup/meta wording left ready');
    if (/\s(?:—|–|->|→|=)\s/.test(raw)) reasons.push('relation separator');
    if (raw.split(/\s+/).filter(Boolean).length >= 10 && !['sentence-expression','construction','alternative-expression','form-family','variant','contrast'].includes(handling)) reasons.push('very long unclassified headword');
    return uniqueClean(reasons, 12);
  }

  function incrementAuditCount(bucket, key) {
    const name = clean(key) || '(blank)';
    bucket[name] = Number(bucket[name] || 0) + 1;
  }

  function compactAuditSample(wordId, target, readiness, extra = {}) {
    return {
      wordId: clean(wordId),
      headword: clean(target?.headword || readiness?.rawHeadword),
      pos: clean(target?.pos || readiness?.pos),
      resolverKind: clean(readiness?.resolverKind),
      kind: clean(readiness?.kind),
      status: clean(readiness?.status),
      handling: clean(readiness?.handling),
      senseSelectionRequired: readiness?.senseSelectionRequired === true,
      posCategories: Array.isArray(readiness?.posCategories) ? readiness.posCategories.slice(0, 8) : [],
      primaryTarget: clean(readiness?.primaryTarget),
      practiceUnits: Array.isArray(readiness?.practiceUnits) ? readiness.practiceUnits.slice(0, 8) : [],
      hazards: Array.isArray(readiness?.hazards) ? readiness.hazards.slice(0, 8) : [],
      ...extra
    };
  }

  async function runTargetReadinessAudit(options = {}) {
    const { data } = requireLayers();
    if (!data || typeof data.assembleTargetContext !== 'function') {
      throw new Error('AI Study Data Layer does not expose assembleTargetContext().');
    }

    const sampleLimit = Math.max(5, Math.min(50, Math.floor(num(options.sampleLimit) || 20)));
    const batchSize = Math.max(10, Math.min(100, Math.floor(num(options.batchSize) || 40)));
    const response = await fetch(TARGET_AUDIT_MASTER_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load WLP master for readiness audit (HTTP ${response.status}).`);
    const masterRows = parseAuditTSV(await response.text());
    const wordIds = uniqueClean(masterRows.map(row => row.WordID), 20000);
    if (!wordIds.length) throw new Error('Readiness audit found no WordID values in the WLP master.');

    const report = {
      schemaVersion: 1,
      audit: 'complex-target-readiness-v4',
      uiVersion: VERSION,
      source: TARGET_AUDIT_MASTER_URL,
      totalMasterCards: wordIds.length,
      audited: 0,
      failed: 0,
      counts: { status: {}, handling: {}, kind: {}, resolverKind: {}, hazards: {} },
      senseSelectionRequiredCount: 0,
      readyButSuspiciousCount: 0,
      samples: { review: [], normalize: [], guided: [], readyButSuspicious: [], failures: [] }
    };

    const addSample = (group, sample) => {
      if (!Array.isArray(report.samples[group]) || report.samples[group].length >= sampleLimit) return;
      report.samples[group].push(sample);
    };

    for (let start = 0; start < wordIds.length; start += batchSize) {
      const slice = wordIds.slice(start, start + batchSize);
      const outcomes = await Promise.all(slice.map(async wordId => {
        try {
          const packet = await data.assembleTargetContext(wordId);
          const readiness = analyzeTargetReadiness(packet);
          return { ok: true, wordId, packet, readiness };
        } catch (error) {
          return { ok: false, wordId, error: clean(error?.message || error) };
        }
      }));

      outcomes.forEach(item => {
        if (!item.ok) {
          report.failed += 1;
          addSample('failures', { wordId: clean(item.wordId), error: item.error });
          return;
        }
        report.audited += 1;
        const target = item.packet?.target || {};
        const readiness = item.readiness || {};
        incrementAuditCount(report.counts.status, readiness.status);
        incrementAuditCount(report.counts.handling, readiness.handling);
        incrementAuditCount(report.counts.kind, readiness.kind);
        incrementAuditCount(report.counts.resolverKind, readiness.resolverKind);
        (Array.isArray(readiness.hazards) ? readiness.hazards : []).forEach(hazard => incrementAuditCount(report.counts.hazards, hazard));
        if (readiness.senseSelectionRequired === true) report.senseSelectionRequiredCount += 1;

        const status = clean(readiness.status);
        if (status === 'review') addSample('review', compactAuditSample(item.wordId, target, readiness));
        else if (status === 'normalize') addSample('normalize', compactAuditSample(item.wordId, target, readiness));
        if (status === 'ready' && !['single','sentence-expression'].includes(clean(readiness.handling))) addSample('guided', compactAuditSample(item.wordId, target, readiness));

        if (status === 'ready') {
          const suspicionReasons = readinessAuditSuspicionReasons(readiness, target);
          if (suspicionReasons.length) {
            report.readyButSuspiciousCount += 1;
            addSample('readyButSuspicious', compactAuditSample(item.wordId, target, readiness, { suspicionReasons }));
          }
        }
      });

      if (options.logProgress !== false && (start === 0 || start + batchSize >= wordIds.length || (start + batchSize) % 500 < batchSize)) {
        console.info(`[WLP Target Readiness Audit] ${Math.min(start + batchSize, wordIds.length)} / ${wordIds.length}`);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const sortCounts = bucket => Object.fromEntries(Object.entries(bucket).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    report.counts.status = sortCounts(report.counts.status);
    report.counts.handling = sortCounts(report.counts.handling);
    report.counts.kind = sortCounts(report.counts.kind);
    report.counts.resolverKind = sortCounts(report.counts.resolverKind);
    report.counts.hazards = sortCounts(report.counts.hazards);
    report.summary = [
      `Audited ${report.audited}/${report.totalMasterCards} master cards; ${report.failed} failed to inspect.`,
      `Status: ${Object.entries(report.counts.status).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}.`,
      `Handling: ${Object.entries(report.counts.handling).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}.`,
      `Sense-selection required: ${report.senseSelectionRequiredCount}.`,
      `Ready-but-suspicious: ${report.readyButSuspiciousCount}.`,
      'No provider/AI calls were made; this audit is local/read-only.'
    ].join(' ');
    console.info('[WLP Target Readiness Audit] complete', report.summary);
    return report;
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

  function normalizeFeedbackText(value) {
    return clean(value).normalize('NFKC').toLowerCase().replace(/[\s\u2018\u2019\u201c\u201d"'.,!?;:()\[\]{}-]+/g, ' ').trim();
  }

  function sameFeedbackText(a, b) {
    const left = normalizeFeedbackText(a);
    const right = normalizeFeedbackText(b);
    return Boolean(left && right && left === right);
  }

  function feedbackTokenOverlap(a, b) {
    const left = normalizeFeedbackText(a).split(' ').filter(Boolean);
    const right = normalizeFeedbackText(b).split(' ').filter(Boolean);
    if (left.length < 5 || right.length < 5) return 0;
    const aSet = new Set(left);
    const bSet = new Set(right);
    let shared = 0;
    aSet.forEach(token => { if (bSet.has(token)) shared += 1; });
    return shared / Math.max(1, Math.min(aSet.size, bSet.size));
  }

  function meaningfullyDistinctFeedbackOption(candidate, references = []) {
    const value = clean(candidate);
    if (!value) return false;
    return !(Array.isArray(references) ? references : [references]).some(reference => {
      if (!clean(reference)) return false;
      if (sameFeedbackText(value, reference)) return true;
      return feedbackTokenOverlap(value, reference) >= 0.82;
    });
  }

  const FEEDBACK_ROUTE_STOPWORDS = new Set([
    'a','an','the','and','or','but','if','then','than','that','this','these','those','of','to','for','from','in','on','at','by','with','without','as','while','when','where','who','whom','whose','which','is','are','was','were','be','been','being','am','do','does','did','have','has','had','can','could','will','would','shall','should','may','might','must','it','its','they','them','their','theirs','he','him','his','she','her','hers','we','us','our','ours','you','your','yours','i','me','my','mine','one','ones','some','any'
  ]);

  function feedbackRouteToken(token) {
    let value = clean(token).toLowerCase();
    if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) value = value.slice(0, -1);
    return value;
  }

  function feedbackContentTokenSet(value) {
    const tokens = normalizeFeedbackText(value).split(' ').map(feedbackRouteToken).filter(token => token && !FEEDBACK_ROUTE_STOPWORDS.has(token));
    return new Set(tokens);
  }

  function meaningfullyDistinctExplicitNaturalOption(candidate, references = []) {
    const value = clean(candidate);
    if (!value) return false;
    const list = Array.isArray(references) ? references : [references];
    for (const reference of list) {
      if (!clean(reference)) continue;
      if (sameFeedbackText(value, reference)) return false;
      if (feedbackTokenOverlap(value, reference) < 0.82) continue;
      const candidateTokens = feedbackContentTokenSet(value);
      const referenceTokens = feedbackContentTokenSet(reference);
      const candidateOnly = [...candidateTokens].filter(token => !referenceTokens.has(token));
      const referenceOnly = [...referenceTokens].filter(token => !candidateTokens.has(token));
      // High-overlap options are still useful when they substitute a real content
      // route (for example pits -> sets), but not when they merely add/drop a
      // determiner, modifier, or other cosmetic wording.
      if (!(candidateOnly.length && referenceOnly.length)) return false;
    }
    return true;
  }

  function feedbackExampleBundle(plannerResponse, response, learnerText = '') {
    const planner = plannerResponse && typeof plannerResponse === 'object' ? plannerResponse : {};
    const experience = planner.experience && typeof planner.experience === 'object' ? planner.experience : {};
    const learner = response?.learnerFacingResponse || {};
    const rawLearner = clean(learnerText);
    const correctionNeeded = learner.correctionNeeded === true;
    const natural = response?.communicativeInterpretation?.learnerExpressionNatural === true;
    const noResponse = /^i don['’]?t know\.?$/i.test(rawLearner);
    const testLabelOnly = /^target\s*:/i.test(rawLearner);
    const intendedExample = clean(experience.intendedExample);
    const suggestedNaturalForm = clean(learner.suggestedNaturalForm);
    const modelResponse = clean(learner.modelResponse);
    const showYourAnswer = Boolean(rawLearner && natural && !correctionNeeded && !noResponse && !testLabelOnly);
    const explicitOptions = uniqueClean(Array.isArray(learner.naturalOptions) ? learner.naturalOptions : [], 3);
    const naturalOptions = [];
    explicitOptions.forEach(option => {
      if (naturalOptions.length >= 3) return;
      const references = [rawLearner, intendedExample, suggestedNaturalForm, ...naturalOptions];
      if (meaningfullyDistinctExplicitNaturalOption(option, references)) naturalOptions.push(option);
    });
    if (naturalOptions.length < 3 && modelResponse) {
      const references = [rawLearner, intendedExample, suggestedNaturalForm, ...naturalOptions];
      if (meaningfullyDistinctFeedbackOption(modelResponse, references)) naturalOptions.push(modelResponse);
    }
    return {
      yourAnswer: showYourAnswer ? rawLearner : '',
      intendedExample,
      naturalForm: correctionNeeded ? suggestedNaturalForm : '',
      naturalOptions
    };
  }

  function renderHighlightedOptions(element, options = [], terms = []) {
    if (!element) return;
    element.replaceChildren();
    (Array.isArray(options) ? options : []).forEach((option, index, all) => {
      const line = document.createElement('span');
      if (all.length > 1) line.append(document.createTextNode(`${index + 1}. `));
      const content = document.createElement('span');
      renderHighlightedText(content, option, terms);
      line.append(content);
      element.append(line);
      if (index < all.length - 1) element.append(document.createElement('br'));
    });
  }

  function runFeedbackLayerSelfTest() {
    const planner = { experience: { intendedExample: 'The podcast is on hiatus while the host recovers.' } };
    const natural = {
      communicativeInterpretation: { learnerExpressionNatural: true },
      learnerFacingResponse: {
        correctionNeeded: false,
        suggestedNaturalForm: null,
        modelResponse: 'The podcast is temporarily on hold while the host recovers.',
        naturalOptions: [
          'The show is taking a temporary break while the host recovers.',
          'New episodes are paused until the host is back on their feet.'
        ]
      }
    };
    const nearDuplicate = JSON.parse(JSON.stringify(natural));
    nearDuplicate.learnerFacingResponse.naturalOptions = ['The podcast is on hiatus while one of the hosts recovers.'];
    nearDuplicate.learnerFacingResponse.modelResponse = '';
    const corrected = {
      communicativeInterpretation: { learnerExpressionNatural: false },
      learnerFacingResponse: {
        correctionNeeded: true,
        suggestedNaturalForm: 'The podcast is on hiatus while the host recovers.',
        modelResponse: 'The podcast is taking a temporary break.',
        naturalOptions: ['New episodes are paused while the host recovers.']
      }
    };
    const testLabel = JSON.parse(JSON.stringify(natural));
    const many = JSON.parse(JSON.stringify(natural));
    many.learnerFacingResponse.naturalOptions = [
      'The show is taking a temporary break while the host recovers.',
      'New episodes are paused until the host is back on their feet.',
      'The podcast has been put on hold during the host’s recovery.',
      'The series is temporarily inactive while the host recovers.'
    ];
    many.learnerFacingResponse.modelResponse = '';
    const legacy = JSON.parse(JSON.stringify(natural));
    legacy.learnerFacingResponse.naturalOptions = [];
    legacy.learnerFacingResponse.modelResponse = 'The show is temporarily paused while the host recovers.';
    const lexicalPlanner = { experience: { intendedExample: 'The policy pits permanent staff against contract workers.' } };
    const lexicalRoute = JSON.parse(JSON.stringify(natural));
    lexicalRoute.learnerFacingResponse.modelResponse = '';
    lexicalRoute.learnerFacingResponse.naturalOptions = ['The policy sets permanent staff against contract workers.'];
    const a = feedbackExampleBundle(planner, natural, 'The podcast is currently on hiatus while the host recovers.');
    const b = feedbackExampleBundle(planner, nearDuplicate, 'The podcast is currently on hiatus while the host recovers.');
    const c = feedbackExampleBundle(planner, corrected, 'The podcast is in hiatus while the host recovers.');
    const d = feedbackExampleBundle(planner, testLabel, 'Target: hiatus');
    const e = feedbackExampleBundle(planner, many, 'The podcast is currently on hiatus while the host recovers.');
    const f = feedbackExampleBundle(planner, legacy, 'The podcast is currently on hiatus while the host recovers.');
    const g = feedbackExampleBundle(lexicalPlanner, lexicalRoute, 'The policy pits permanent staff against contract workers.');
    const checks = [
      { name: 'natural-learner-answer-is-repeated', passed: Boolean(a.yourAnswer), result: a },
      { name: 'planner-intended-answer-is-preserved', passed: a.intendedExample === planner.experience.intendedExample, result: a },
      { name: 'multiple-distinct-natural-options-are-preserved', passed: a.naturalOptions.length >= 2, result: a },
      { name: 'near-copy-of-intended-answer-is-suppressed', passed: b.naturalOptions.length === 0, result: b },
      { name: 'correction-shows-natural-revision', passed: c.naturalForm === corrected.learnerFacingResponse.suggestedNaturalForm, result: c },
      { name: 'correction-can-also-preserve-distinct-natural-options', passed: c.naturalOptions.length >= 1, result: c },
      { name: 'correction-options-stay-distinct-from-revision', passed: c.naturalOptions.every(option => meaningfullyDistinctFeedbackOption(option, [c.naturalForm])), result: c },
      { name: 'debug-target-label-is-not-presented-as-natural-answer', passed: !d.yourAnswer, result: d },
      { name: 'natural-options-are-capped-at-three', passed: e.naturalOptions.length === 3, result: e },
      { name: 'legacy-model-response-remains-a-fallback', passed: f.naturalOptions.includes(legacy.learnerFacingResponse.modelResponse), result: f },
      { name: 'high-overlap-lexical-route-is-preserved', passed: g.naturalOptions.includes('The policy sets permanent staff against contract workers.'), result: g }
    ];
    return { passed: checks.every(item => item.passed), checks };
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
      intendedExample: clean(exp.intendedExample),
      learnerResponse: clean(learnerText),
      assistance: assistanceSnapshot(),
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
      naturalOptions: feedbackExampleBundle(planner, response, learnerText).naturalOptions,
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
        estimatedCostUsd: Number.isFinite(turnDiagnostics.estimatedCostUsd) ? turnDiagnostics.estimatedCostUsd : null,
        targetReadinessStatus: clean(state.activePlanner?.diagnostics?.targetReadiness?.status),
        targetReadinessKind: clean(state.activePlanner?.diagnostics?.targetReadiness?.kind),
        targetReadinessHazards: Array.isArray(state.activePlanner?.diagnostics?.targetReadiness?.hazards) ? state.activePlanner.diagnostics.targetReadiness.hazards.map(clean).filter(Boolean).slice(0, 8) : []
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
    const supportCounts = turns.reduce((acc, turn) => {
      const support = clean(turn?.assistance?.support);
      if (support) acc[support] = (acc[support] || 0) + 1;
      return acc;
    }, {});
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
    const assistedParts = [];
    if (supportCounts['target-assisted']) assistedParts.push(`${supportCounts['target-assisted']} target-revealed`);
    if (supportCounts['hint-assisted']) assistedParts.push(`${supportCounts['hint-assisted']} hint-assisted`);
    if (supportCounts['unaided']) assistedParts.push(`${supportCounts['unaided']} unaided`);
    if (supportCounts['task-visible-target']) assistedParts.push(`${supportCounts['task-visible-target']} target-visible by task design`);
    if (assistedParts.length) well.push(`Support used across completed turns: ${assistedParts.join(', ')}.`);

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
      hintLimit: normalizeHintLimit(session.hintLimit, DEFAULT_HINT_LIMIT),
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
    if (turn?.assistance) addPeekField(article, 'Assistance', assistanceSummary(turn.assistance));
    addPeekField(article, 'Target feedback', turn?.targetFeedback);
    addPeekField(article, 'Language feedback', turn?.languageFeedback);
    addPeekField(article, 'Next step', turn?.nextStep);
    const highlightTerms = [clean(turn?.target), ...(Array.isArray(turn?.targetFamily) ? turn.targetFamily.map(clean) : [])].filter(Boolean);
    if (clean(turn?.intendedExample)) addPeekField(article, 'One intended answer', turn.intendedExample, highlightTerms);
    if (turn?.correctionNeeded && clean(turn?.suggestedNaturalForm)) addPeekField(article, 'A natural revision of your answer', turn.suggestedNaturalForm, highlightTerms);
    const storedOptions = Array.isArray(turn?.naturalOptions) ? turn.naturalOptions.map(clean).filter(Boolean).slice(0, 3) : [];
    const fallbackOptions = storedOptions.length ? storedOptions : feedbackExampleBundle(
      { experience: { intendedExample: turn?.intendedExample } },
      {
        learnerFacingResponse: {
          correctionNeeded: turn?.correctionNeeded === true,
          suggestedNaturalForm: turn?.suggestedNaturalForm || null,
          modelResponse: turn?.modelResponse,
          naturalOptions: []
        },
        communicativeInterpretation: { learnerExpressionNatural: turn?.learnerExpressionNatural === true }
      },
      turn?.learnerResponse
    ).naturalOptions;
    fallbackOptions.forEach((option, optionIndex) => addPeekField(article, fallbackOptions.length > 1 ? `Natural option ${optionIndex + 1}` : 'Another natural option', option, highlightTerms));
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

  function currentStudySetWordIds() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(TEMP_STUDY_SET_KEY) || 'null');
      const seen = new Set();
      return (Array.isArray(parsed?.items) ? parsed.items : [])
        .map(item => clean(item?.wordId))
        .filter(wordId => wordId && !seen.has(wordId) && (seen.add(wordId), true));
    } catch (_) {
      return [];
    }
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
    if (mode === 'study-set') {
      const wordIds = currentStudySetWordIds();
      return { mode, wordIds, label: `Study Set · ${wordIds.length} ${wordIds.length === 1 ? 'card' : 'cards'}` };
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

  function normalizeHintLimit(value, fallback = DEFAULT_HINT_LIMIT) {
    const limit = Math.floor(num(value));
    return VALID_HINT_LIMITS.has(limit) ? limit : fallback;
  }

  function selectedHintLimit() {
    return normalizeHintLimit($('#wlp-ai-hint-limit')?.value, DEFAULT_HINT_LIMIT);
  }

  function savedHintLimit() {
    try { return normalizeHintLimit(localStorage.getItem(AI_HINT_LIMIT_KEY), DEFAULT_HINT_LIMIT); }
    catch (_) { return DEFAULT_HINT_LIMIT; }
  }

  function applySavedHintLimit() {
    const select = $('#wlp-ai-hint-limit');
    if (!select) return;
    select.value = String(savedHintLimit());
  }

  function persistHintLimit() {
    const limit = selectedHintLimit();
    try { localStorage.setItem(AI_HINT_LIMIT_KEY, String(limit)); } catch (_) {}
  }

  function activeHintLimit() {
    return normalizeHintLimit(state.session?.hintLimit, selectedHintLimit());
  }

  function limitHints(hints, limit = activeHintLimit()) {
    const list = Array.isArray(hints) ? hints.slice() : [];
    return list.slice(0, Math.max(0, normalizeHintLimit(limit, DEFAULT_HINT_LIMIT)));
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
          <div class="wlp-ai-practice-type-control wlp-ai-hint-limit-control">
            <label for="wlp-ai-hint-limit"><span>Hints available</span><select id="wlp-ai-hint-limit" aria-describedby="wlp-ai-hint-limit-help">
              <option value="0">No hints</option>
              <option value="2">Up to 2</option>
              <option value="4" selected>Up to 4 · default</option>
              <option value="6">Up to 6</option>
            </select></label>
            <p id="wlp-ai-hint-limit-help">Sets the maximum available hints, not the difficulty. Sentence Reconstruction keeps its existing hint wording and order; this setting only caps how many can be shown. Show target stays separate.</p>
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
          <div class="wlp-ai-model-response" id="wlp-ai-your-answer" hidden>
            <span class="wlp-ai-feedback-label">Your answer</span>
            <p class="wlp-ai-model-response-text" id="wlp-ai-your-answer-text"></p>
          </div>
          <div class="wlp-ai-model-response" id="wlp-ai-intended-answer" hidden>
            <span class="wlp-ai-feedback-label">One intended answer</span>
            <p class="wlp-ai-model-response-text" id="wlp-ai-intended-answer-text"></p>
          </div>
          <div class="wlp-ai-model-response" id="wlp-ai-natural-revision" hidden>
            <span class="wlp-ai-feedback-label">A natural revision of your answer</span>
            <p class="wlp-ai-model-response-text" id="wlp-ai-natural-revision-text"></p>
          </div>
          <div class="wlp-ai-model-response" id="wlp-ai-model-response" hidden>
            <span class="wlp-ai-feedback-label" id="wlp-ai-model-response-label">Another natural option</span>
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
    ['#wlp-ai-start', '#wlp-ai-submit', '#wlp-ai-no-idea', '#wlp-ai-next', '#wlp-ai-end', '#wlp-ai-reconstruction-undo', '#wlp-ai-reconstruction-clear', '#wlp-ai-target-hint-button', '#wlp-ai-task-hint-button', '#wlp-ai-retry-generation', '#wlp-ai-retry-interpreter'].forEach(selector => {
      const el = $(selector);
      if (el) el.disabled = state.busy;
    });
    if (!state.busy && state.assistance?.locked) {
      const targetHint = $('#wlp-ai-target-hint-button');
      const taskHint = $('#wlp-ai-task-hint-button');
      if (targetHint) targetHint.disabled = true;
      if (taskHint) taskHint.disabled = true;
    }
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

  function syncAssistancePanelVisibility() {
    const assist = $('#wlp-ai-reconstruction-assist');
    if (!assist) return;
    const targetWrap = $('#wlp-ai-target-hint');
    const taskWrap = $('#wlp-ai-task-hint');
    const taskList = $('#wlp-ai-task-hint-list');
    const hasVisibleControl = Boolean(targetWrap && !targetWrap.hidden) || Boolean(taskWrap && !taskWrap.hidden) || Boolean(taskList && !taskList.hidden);
    assist.hidden = !hasVisibleControl;
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
    if (state.assistance) {
      state.assistance.targetRevealed = false;
      state.assistance.taskHintStage = 0;
    }
    if (state.reconstruction) {
      state.reconstruction.targetRevealed = false;
      state.reconstruction.taskHintStage = 0;
    }
  }

  function renderTargetHint(selected = null) {
    const wrap = $('#wlp-ai-target-hint');
    const button = $('#wlp-ai-target-hint-button');
    const textEl = $('#wlp-ai-target-hint-text');
    const target = clean(selected?.target || state.activePlanner?.result?.response?.selectedTarget?.target);
    if (!wrap || !button || !textEl || !target) {
      if (wrap) wrap.hidden = true;
      syncAssistancePanelVisibility();
      return;
    }
    const initialVisibility = clean(state.assistance?.initialTargetVisibility).toLowerCase() || 'hidden';
    const targetIsTaskVisible = !state.reconstruction && initialVisibility === 'visible';
    if (targetIsTaskVisible) {
      // Universal Target support: the target is already part of the task, so keep
      // the support control present without treating it as learner-requested help.
      wrap.hidden = false;
      button.hidden = false;
      button.disabled = true;
      button.textContent = 'Target shown';
      textEl.textContent = `Target: ${target}`;
      textEl.hidden = true;
      syncAssistancePanelVisibility();
      return;
    }
    wrap.hidden = false;
    const revealed = state.assistance?.targetRevealed === true;
    button.hidden = false;
    button.disabled = state.assistance?.locked === true;
    button.textContent = revealed ? 'Hide target' : 'Show target';
    textEl.textContent = `Target: ${target}`;
    textEl.hidden = !revealed;
    syncAssistancePanelVisibility();
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

  function currentExperienceType() {
    return clean(state.activePlanner?.result?.response?.experience?.type).toLowerCase();
  }

  function isOpenProductionHintType(experienceType = currentExperienceType()) {
    return OPEN_PRODUCTION_HINT_TYPES.has(clean(experienceType).toLowerCase());
  }

  function isClozeHintType(experienceType = currentExperienceType()) {
    return clean(experienceType).toLowerCase() === 'cloze';
  }

  function targetWordTokens(target) {
    return clean(target).match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  }

  function variableSlotCount(target) {
    let source = clean(target);
    let count = 0;
    const grouped = /\b(?:(?:someone|somebody)\s*\/\s*something|something\s*\/\s*(?:someone|somebody)|(?:someone|somebody)\s+or\s+something|something\s+or\s+(?:someone|somebody))\b/gi;
    source = source.replace(grouped, () => {
      count += 1;
      return ' __slot__ ';
    });
    const matches = source.match(/\b(?:someone|somebody|something|somewhere|oneself|yourself|himself|herself|itself|ourselves|themselves|one['’]s|someone['’]s|somebody['’]s)\b/gi) || [];
    return count + matches.length;
  }

  function hintCandidate(category, family, strength, textValue) {
    const value = clean(textValue);
    if (!value) return null;
    return {
      category: clean(category),
      family: clean(family || category),
      strength: Math.max(1, Math.min(4, Math.floor(num(strength) || 1))),
      text: value
    };
  }

  function targetShapeHint(target, readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    const kind = clean(readiness?.kind).toLowerCase();
    const words = targetWordTokens(target);
    const slots = variableSlotCount(target);

    if (handling === 'construction' || kind === 'construction' || slots > 0) return 'The target is a construction rather than an isolated word.';
    if (handling === 'sentence-expression' || kind === 'sentence-expression') return 'The target is a whole expression or sentence.';
    if (words.length <= 1) return 'The target is a single word.';
    return `The target is a ${words.length}-word expression.`;
  }

  function targetPosHint(readiness = {}) {
    const pos = Array.isArray(readiness?.posCategories) ? readiness.posCategories.map(clean).filter(Boolean) : [];
    if (pos.length !== 1) return '';
    return `It functions as a ${pos[0]}.`;
  }

  function targetSlotHint(target) {
    const slots = variableSlotCount(target);
    if (!slots) return '';
    return `The construction has ${slots} variable slot${slots === 1 ? '' : 's'} to fit the situation.`;
  }

  function targetPrepositionHint(target, readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    const slots = variableSlotCount(target);
    if (handling !== 'construction' && slots < 1) return '';
    const lowerWords = targetWordTokens(target).map(word => word.toLowerCase());
    return lowerWords.some(word => PREPOSITION_WORDS.has(word))
      ? 'A fixed preposition is part of the construction.'
      : '';
  }

  function targetConnectorHint(target, readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    if (handling === 'construction' || variableSlotCount(target) > 0) return '';
    const lowerWords = targetWordTokens(target).map(word => word.toLowerCase());
    if (lowerWords.length < 2) return '';
    const connector = lowerWords.find(word => PREPOSITION_WORDS.has(word));
    if (!connector) return '';
    if (connector === 'like' || connector === 'as') return 'A fixed comparison word is part of the expression.';
    return 'A fixed linking or prepositional word is part of the expression.';
  }

  function targetRegisterHint(target) {
    const archaicMarkers = new Set(['thee','thou','thy','thine','ye','shalt','wilt']);
    const lowerWords = targetWordTokens(target).map(word => word.toLowerCase());
    return lowerWords.some(word => archaicMarkers.has(word))
      ? 'The expression contains an archaic pronoun or form.'
      : '';
  }

  function targetLengthHint(target) {
    const words = targetWordTokens(target);
    if (words.length !== 1) return '';
    const letters = clean(target).replace(/[^A-Za-z]/g, '');
    return letters.length >= 4 ? `The word has ${letters.length} letters.` : '';
  }

  function targetInitialHint(target) {
    const match = clean(target).match(/[A-Za-z]/);
    if (!match) return '';
    const words = targetWordTokens(target);
    return `${words.length > 1 ? 'The first fixed word' : 'It'} begins with “${match[0].toUpperCase()}”.`;
  }

  function targetEndingHint(target) {
    const letters = clean(target).replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) return '';
    return `It ends with “${letters.slice(-1).toUpperCase()}”.`;
  }

  function targetFamilyHint(readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    if (handling === 'form-family') return 'This source card contains related forms; use the form that fits the sentence you want to produce.';
    if (handling === 'variant') return 'This source card contains equivalent spelling or form variants.';
    if (handling === 'alternative-expression') return 'This source card contains more than one usable expression; the current experience is built around one of them.';
    if (handling === 'contrast') return 'The source card contrasts neighboring expressions; this experience is built around one side of that contrast.';
    return '';
  }

  function targetLeakTerms(target, readiness = {}) {
    return uniqueTexts([
      clean(target),
      ...(Array.isArray(readiness?.practiceUnits) ? readiness.practiceUnits.map(clean) : []),
      ...(Array.isArray(readiness?.targetFamily) ? readiness.targetFamily.map(clean) : [])
    ], 16).filter(term => term.length >= 3);
  }

  function textLeaksTarget(value, target, readiness = {}) {
    const source = clean(value).toLowerCase();
    if (!source) return false;
    return targetLeakTerms(target, readiness).some(term => {
      const needle = clean(term).toLowerCase();
      return needle && source.includes(needle);
    });
  }

  function semanticFocusHint(context = {}, target = '', readiness = {}) {
    const source = clean(
      context?.communicativeFocus?.foreground
      || context?.messageCore?.summary
      || context?.experience?.acceptableSemanticTerritory?.[0]
    );
    if (!source || source.length > 180 || textLeaksTarget(source, target, readiness)) return '';
    return `Focus on wording that foregrounds this idea: ${source.replace(/[.!?]+$/, '')}.`;
  }

  function nearbyAlternative(context = {}, target = '') {
    const candidates = [
      ...(Array.isArray(context?.naturalnessCheck?.commonerAlternatives) ? context.naturalnessCheck.commonerAlternatives : []),
      ...(Array.isArray(context?.experience?.anticipatedNaturalAlternatives) ? context.experience.anticipatedNaturalAlternatives : [])
    ].map(clean).filter(Boolean);
    const targetKey = clean(target).toLowerCase();
    return candidates.find(item => item.toLowerCase() !== targetKey) || '';
  }

  function neighborInitialHint(context = {}, target = '') {
    const neighbor = nearbyAlternative(context, target);
    const match = clean(neighbor).match(/[A-Za-z]/);
    return match ? `A nearby natural alternative begins with “${match[0].toUpperCase()}”.` : '';
  }

  function namedNeighborHint(context = {}, target = '') {
    const neighbor = nearbyAlternative(context, target);
    return neighbor ? `One nearby natural alternative is “${neighbor}”.` : '';
  }

  function stringHash(value) {
    let hash = 2166136261;
    const source = String(value ?? '');
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hintStrengthCaps(difficulty = 'standard', count = DEFAULT_HINT_LIMIT) {
    const level = clean(difficulty).toLowerCase() || 'standard';
    const presets = {
      easy: [2, 3, 4, 4, 4, 4],
      standard: [1, 2, 3, 4, 4, 4],
      hard: [1, 1, 2, 3, 4, 4],
      hell: [1, 1, 2, 3, 3, 4],
      adaptive: [1, 2, 3, 4, 4, 4]
    };
    const source = presets[level] || presets.standard;
    return Array.from({ length: Math.max(0, count) }, (_, index) => source[Math.min(index, source.length - 1)]);
  }

  function openProductionHintCandidates({ target = '', readiness = {}, context = {} } = {}) {
    const value = clean(target);
    if (!value) return [];
    const candidates = [
      hintCandidate('target-shape', 'core', 1, targetShapeHint(value, readiness)),
      hintCandidate('part-of-speech', 'core', 1, targetPosHint(readiness)),
      hintCandidate('variable-slots', 'structure', 2, targetSlotHint(value)),
      hintCandidate('fixed-preposition', 'structure', 2, targetPrepositionHint(value, readiness)),
      hintCandidate('fixed-connector', 'structure', 2, targetConnectorHint(value, readiness)),
      hintCandidate('register-marker', 'register', 2, targetRegisterHint(value)),
      hintCandidate('family-handling', 'structure', 2, targetFamilyHint(readiness)),
      hintCandidate('letter-count', 'lexical', 2, targetLengthHint(value)),
      hintCandidate('semantic-focus', 'semantic', 3, semanticFocusHint(context, value, readiness)),
      hintCandidate('initial-letter', 'lexical', 3, targetInitialHint(value)),
      hintCandidate('ending-letter', 'lexical', 3, targetEndingHint(value)),
      hintCandidate('neighbor-initial', 'neighbor', 3, neighborInitialHint(context, value)),
      hintCandidate('named-neighbor', 'neighbor', 4, namedNeighborHint(context, value))
    ].filter(Boolean);

    const seen = new Set();
    return candidates.filter(candidate => {
      const key = `${candidate.category}:${candidate.text.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function recentHintCategories() {
    return Array.isArray(state.session?.recentHintCategories)
      ? state.session.recentHintCategories.map(clean).filter(Boolean).slice(-8)
      : [];
  }

  function rememberHintCategory(category) {
    if (!state.session || !clean(category)) return;
    if (!Array.isArray(state.session.recentHintCategories)) state.session.recentHintCategories = [];
    state.session.recentHintCategories.push(clean(category));
    if (state.session.recentHintCategories.length > 12) state.session.recentHintCategories.splice(0, state.session.recentHintCategories.length - 12);
  }

  function selectOpenProductionHintPlan({ target = '', readiness = {}, difficulty = 'standard', experienceType = 'open-description', context = {}, hintLimit = DEFAULT_HINT_LIMIT, seed = '', recentCategories = [] } = {}) {
    const type = clean(experienceType).toLowerCase();
    if (!OPEN_PRODUCTION_HINT_TYPES.has(type)) return [];
    const limit = normalizeHintLimit(hintLimit, DEFAULT_HINT_LIMIT);
    if (!limit) return [];

    const candidates = openProductionHintCandidates({ target, readiness, context });
    if (!candidates.length) return [];
    const caps = hintStrengthCaps(difficulty, limit);
    const recent = recentCategories.map(clean).filter(Boolean);
    const chosen = [];
    const usedCategories = new Set();
    const usedFamilies = new Map();

    function candidateScore(candidate, stageIndex) {
      const recentIndex = recent.lastIndexOf(candidate.category);
      const recentPenalty = recentIndex >= 0 ? 240 - Math.min(160, (recent.length - 1 - recentIndex) * 30) : 0;
      const familyCount = usedFamilies.get(candidate.family) || 0;
      const repeatPenalty = candidate.family === 'neighbor' ? 220 : candidate.family === 'lexical' ? 65 : 35;
      const familyPenalty = familyCount * repeatPenalty;
      // Prefer the least revealing clue that still adds a new axis.
      // Difficulty controls when stronger clues become eligible; it does not force them early.
      const strengthPenalty = candidate.strength * 28;
      const level = clean(difficulty).toLowerCase() || 'standard';
      const standardNeighborPenalty = ['standard', 'adaptive'].includes(level) ? (candidate.category === 'neighbor-initial' ? 65 : candidate.category === 'named-neighbor' ? 110 : 0) : 0;
      const seeded = stringHash(`${seed}|${stageIndex}|${candidate.category}|${candidate.text}`) % 31;
      return recentPenalty + familyPenalty + strengthPenalty + standardNeighborPenalty + seeded;
    }

    let previousStrength = 1;
    for (let stage = 0; stage < limit; stage += 1) {
      const cap = caps[stage] || 4;
      let eligible = candidates.filter(candidate => !usedCategories.has(candidate.category) && candidate.strength <= cap && candidate.strength >= previousStrength);
      if (!eligible.length) {
        eligible = candidates.filter(candidate => !usedCategories.has(candidate.category) && candidate.strength >= previousStrength);
      }
      if (!eligible.length) {
        eligible = candidates.filter(candidate => !usedCategories.has(candidate.category));
      }
      if (!eligible.length) break;

      // Hint 1 always stays in the low-leakage band when such a clue exists.
      if (stage === 0) {
        const lowLeakage = eligible.filter(candidate => candidate.strength === 1);
        if (lowLeakage.length) eligible = lowLeakage;
      }

      eligible.sort((a, b) => {
        const delta = candidateScore(a, stage) - candidateScore(b, stage);
        if (delta) return delta;
        return a.category.localeCompare(b.category);
      });

      const selected = eligible[0];
      chosen.push(selected);
      previousStrength = Math.max(previousStrength, selected.strength);
      usedCategories.add(selected.category);
      usedFamilies.set(selected.family, (usedFamilies.get(selected.family) || 0) + 1);
    }

    return chosen;
  }

  function buildOpenProductionHintPlan(selected = null) {
    const assistance = state.assistance || resetAssistanceState();
    if (Array.isArray(assistance.openProductionHintPlan) && assistance.openProductionHintPlan.length) return assistance.openProductionHintPlan;

    const response = state.activePlanner?.result?.response || {};
    const experience = response.experience || {};
    const target = clean(selected?.target || response.selectedTarget?.target);
    const plan = selectOpenProductionHintPlan({
      target,
      readiness: state.activePlanner?.diagnostics?.targetReadiness || {},
      difficulty: state.session?.difficulty || 'standard',
      experienceType: experience.type,
      context: response,
      hintLimit: activeHintLimit(),
      seed: `${state.session?.sessionId || 'session'}|${state.session?.completed || 0}|${clean(response.selectedTarget?.wordId)}|${target}`,
      recentCategories: recentHintCategories()
    });
    assistance.openProductionHintPlan = plan;
    return plan;
  }

  function buildOpenProductionHints(selected = null) {
    return buildOpenProductionHintPlan(selected).map(item => item.text);
  }

  function isUniversalFallbackHintType(experienceType = currentExperienceType()) {
    const type = clean(experienceType).toLowerCase();
    if (!type || type === 'sentence-reconstruction') return false;
    return !isOpenProductionHintType(type) && !isClozeHintType(type);
  }

  function selectUniversalFallbackHintPlan({ target = '', readiness = {}, difficulty = 'standard', experienceType = '', context = {}, hintLimit = DEFAULT_HINT_LIMIT, seed = '', recentCategories = [] } = {}) {
    if (!isUniversalFallbackHintType(experienceType)) return [];
    // Reuse the already-tested low-leakage generic candidate/ordering logic, but
    // only as a fallback. Dedicated Reconstruction, Cloze, and Open Production
    // hint profiles continue to win before this function is ever considered.
    return selectOpenProductionHintPlan({
      target,
      readiness,
      difficulty,
      experienceType: 'open-description',
      context,
      hintLimit,
      seed: `${seed}|fallback|${clean(experienceType).toLowerCase()}`,
      recentCategories
    });
  }

  function buildUniversalFallbackHintPlan(selected = null) {
    const assistance = state.assistance || resetAssistanceState();
    if (Array.isArray(assistance.universalFallbackHintPlan) && assistance.universalFallbackHintPlan.length) return assistance.universalFallbackHintPlan;

    const response = state.activePlanner?.result?.response || {};
    const experience = response.experience || {};
    const target = clean(selected?.target || response.selectedTarget?.target);
    const plan = selectUniversalFallbackHintPlan({
      target,
      readiness: state.activePlanner?.diagnostics?.targetReadiness || {},
      difficulty: state.session?.difficulty || 'standard',
      experienceType: experience.type,
      context: response,
      hintLimit: activeHintLimit(),
      seed: `${state.session?.sessionId || 'session'}|${state.session?.completed || 0}|${clean(response.selectedTarget?.wordId)}|${target}`,
      recentCategories: recentHintCategories()
    });
    assistance.universalFallbackHintPlan = plan;
    return plan;
  }

  function buildUniversalFallbackHints(selected = null) {
    return buildUniversalFallbackHintPlan(selected).map(item => item.text);
  }

  function runUniversalSupportSelfTest() {
    const readiness = { kind: 'simple', handling: 'single', posCategories: ['adjective'] };
    const context = {
      communicativeFocus: { foreground: 'a mismatch between two things that should fit together' },
      experience: { anticipatedNaturalAlternatives: ['incongruous'] }
    };
    const unsupported = ['contrast', 'reformulation', 'reverse-reconstruction', 'multi-expression-composition'];
    const checks = unsupported.map(type => {
      const result = selectUniversalFallbackHintPlan({
        target: 'discordant', readiness, difficulty: 'standard', experienceType: type,
        context, hintLimit: 4, seed: `fallback-${type}`, recentCategories: []
      });
      return {
        name: `fallback-${type}`,
        passed: result.length > 0 && result.every(item => !item.text.toLowerCase().includes('discordant')),
        result
      };
    });
    [
      ['open-description', 'dedicated-open-production-not-replaced'],
      ['cloze', 'dedicated-cloze-not-replaced'],
      ['sentence-reconstruction', 'dedicated-reconstruction-not-replaced']
    ].forEach(([type, name]) => {
      const result = selectUniversalFallbackHintPlan({
        target: 'discordant', readiness, difficulty: 'standard', experienceType: type,
        context, hintLimit: 4, seed: `protected-${type}`, recentCategories: []
      });
      checks.push({ name, passed: result.length === 0, result });
    });
    const zero = selectUniversalFallbackHintPlan({
      target: 'discordant', readiness, difficulty: 'standard', experienceType: 'contrast',
      context, hintLimit: 0, seed: 'fallback-zero', recentCategories: []
    });
    checks.push({ name: 'fallback-respects-no-hints-setting', passed: zero.length === 0, result: zero });
    return { passed: checks.every(item => item.passed), checks };
  }

  function clozeGrammarHint(readiness = {}) {
    const pos = Array.isArray(readiness?.posCategories) ? readiness.posCategories.map(clean).filter(Boolean) : [];
    const handling = clean(readiness?.handling).toLowerCase();
    if (handling === 'construction' || pos.includes('verb')) return 'Make the head verb agree with the subject before the blank.';
    return 'Use the grammatical form that fits the surrounding sentence.';
  }

  function clozeConstructionHint(target, readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    if (handling !== 'construction' && variableSlotCount(target) < 1) return '';
    return 'The blank needs the complete construction for this sentence, not just the isolated head word.';
  }

  function clozeRoleHint(target, readiness = {}) {
    const handling = clean(readiness?.handling).toLowerCase();
    const slots = variableSlotCount(target);
    if (handling !== 'construction' && slots < 1) return '';
    if (slots >= 2) return 'The construction needs two sides or roles to be filled from the situation.';
    if (slots === 1) return 'The construction includes one variable role that must be filled from the situation.';
    return '';
  }

  function clozeHintCandidates({ target = '', readiness = {}, context = {} } = {}) {
    const value = clean(target);
    if (!value) return [];
    const candidates = [
      hintCandidate('cloze-grammar', 'grammar', 1, clozeGrammarHint(readiness)),
      hintCandidate('target-shape', 'core', 1, targetShapeHint(value, readiness)),
      hintCandidate('part-of-speech', 'core', 1, targetPosHint(readiness)),
      hintCandidate('cloze-construction', 'structure', 2, clozeConstructionHint(value, readiness)),
      hintCandidate('variable-roles', 'structure', 2, clozeRoleHint(value, readiness)),
      hintCandidate('fixed-preposition', 'structure', 2, targetPrepositionHint(value, readiness)),
      hintCandidate('fixed-connector', 'structure', 2, targetConnectorHint(value, readiness)),
      hintCandidate('family-handling', 'structure', 2, targetFamilyHint(readiness)),
      hintCandidate('letter-count', 'lexical', 2, targetLengthHint(value)),
      hintCandidate('semantic-focus', 'semantic', 3, semanticFocusHint(context, value, readiness)),
      hintCandidate('initial-letter', 'lexical', 3, targetInitialHint(value)),
      hintCandidate('ending-letter', 'lexical', 3, targetEndingHint(value)),
      hintCandidate('neighbor-initial', 'neighbor', 4, neighborInitialHint(context, value)),
      hintCandidate('named-neighbor', 'neighbor', 4, namedNeighborHint(context, value))
    ].filter(Boolean);
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = `${candidate.category}:${candidate.text.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function selectClozeHintPlan({ target = '', readiness = {}, difficulty = 'standard', experienceType = 'cloze', context = {}, hintLimit = DEFAULT_HINT_LIMIT, seed = '' } = {}) {
    if (!isClozeHintType(experienceType)) return [];
    const limit = normalizeHintLimit(hintLimit, DEFAULT_HINT_LIMIT);
    if (!limit) return [];
    const candidates = clozeHintCandidates({ target, readiness, context });
    if (!candidates.length) return [];
    const caps = hintStrengthCaps(difficulty, limit);
    const chosen = [];
    const usedCategories = new Set();
    const usedFamilies = new Map();
    const priority = {
      'cloze-grammar': 0,
      'cloze-construction': -12,
      'variable-roles': -8,
      'fixed-preposition': 12,
      'fixed-connector': 14,
      'target-shape': 18,
      'part-of-speech': 20,
      'family-handling': 24,
      'semantic-focus': 34,
      'letter-count': 46,
      'initial-letter': 56,
      'ending-letter': 62,
      'neighbor-initial': 100,
      'named-neighbor': 130
    };
    let previousStrength = 1;
    for (let stage = 0; stage < limit; stage += 1) {
      const cap = caps[stage] || 4;
      let eligible = candidates.filter(candidate => !usedCategories.has(candidate.category) && candidate.strength <= cap && candidate.strength >= previousStrength);
      if (!eligible.length) eligible = candidates.filter(candidate => !usedCategories.has(candidate.category) && candidate.strength >= previousStrength);
      if (!eligible.length) eligible = candidates.filter(candidate => !usedCategories.has(candidate.category));
      if (!eligible.length) break;
      if (stage === 0) {
        const grammarFirst = eligible.filter(candidate => candidate.category === 'cloze-grammar');
        if (grammarFirst.length) eligible = grammarFirst;
        else {
          const low = eligible.filter(candidate => candidate.strength === 1);
          if (low.length) eligible = low;
        }
      }
      eligible.sort((a, b) => {
        const familyPenaltyA = (usedFamilies.get(a.family) || 0) * (a.family === 'neighbor' ? 160 : 26);
        const familyPenaltyB = (usedFamilies.get(b.family) || 0) * (b.family === 'neighbor' ? 160 : 26);
        const scoreA = (priority[a.category] ?? 70) + a.strength * 24 + familyPenaltyA + (stringHash(`${seed}|${stage}|${a.category}|${a.text}`) % 13);
        const scoreB = (priority[b.category] ?? 70) + b.strength * 24 + familyPenaltyB + (stringHash(`${seed}|${stage}|${b.category}|${b.text}`) % 13);
        return scoreA - scoreB || a.category.localeCompare(b.category);
      });
      const selected = eligible[0];
      chosen.push(selected);
      previousStrength = Math.max(previousStrength, selected.strength);
      usedCategories.add(selected.category);
      usedFamilies.set(selected.family, (usedFamilies.get(selected.family) || 0) + 1);
    }
    return chosen;
  }

  function buildClozeHintPlan(selected = null) {
    const assistance = state.assistance || resetAssistanceState();
    if (Array.isArray(assistance.clozeHintPlan) && assistance.clozeHintPlan.length) return assistance.clozeHintPlan;
    const response = state.activePlanner?.result?.response || {};
    const experience = response.experience || {};
    const target = clean(selected?.target || response.selectedTarget?.target);
    const plan = selectClozeHintPlan({
      target,
      readiness: state.activePlanner?.diagnostics?.targetReadiness || {},
      difficulty: state.session?.difficulty || 'standard',
      experienceType: experience.type,
      context: response,
      hintLimit: activeHintLimit(),
      seed: `${state.session?.sessionId || 'session'}|${state.session?.completed || 0}|${clean(response.selectedTarget?.wordId)}|${target}`
    });
    assistance.clozeHintPlan = plan;
    return plan;
  }

  function buildClozeHints(selected = null) {
    return buildClozeHintPlan(selected).map(item => item.text);
  }

  function runClozeHintSelfTest() {
    const constructionReadiness = { kind: 'construction', handling: 'construction', posCategories: ['verb'] };
    const context = {
      communicativeFocus: { foreground: 'opposition between two groups' },
      experience: { type: 'cloze', anticipatedNaturalAlternatives: ['set the two groups against each other'] }
    };
    const standard = selectClozeHintPlan({
      target: 'pit someone/something against someone/something', readiness: constructionReadiness,
      difficulty: 'standard', experienceType: 'cloze', context, hintLimit: 4, seed: 'wid419'
    });
    const simple = selectClozeHintPlan({
      target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] },
      difficulty: 'standard', experienceType: 'cloze', context: {}, hintLimit: 4, seed: 'simple'
    });
    const checks = [
      { name: 'standard-cloze-has-four-hints', passed: standard.length === 4, result: standard },
      { name: 'construction-cloze-starts-with-grammar-fit', passed: standard[0]?.category === 'cloze-grammar', result: standard[0] },
      { name: 'construction-cloze-includes-role-or-structure-help', passed: standard.some(item => ['cloze-construction','variable-roles','fixed-preposition'].includes(item.category)), result: standard },
      { name: 'construction-cloze-does-not-reveal-full-target', passed: standard.every(item => !item.text.includes('pit someone/something against someone/something')), result: standard },
      { name: 'simple-cloze-also-has-hints', passed: simple.length >= 2, result: simple },
      { name: 'cloze-hint-limit-two', passed: selectClozeHintPlan({ target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'cloze', hintLimit: 2, seed: 'two' }).length === 2, result: true },
      { name: 'cloze-hint-limit-zero', passed: selectClozeHintPlan({ target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'cloze', hintLimit: 0, seed: 'zero' }).length === 0, result: true },
      { name: 'non-cloze-type-is-untouched', passed: selectClozeHintPlan({ target: 'hiatus', readiness: {}, difficulty: 'standard', experienceType: 'open-description', hintLimit: 4, seed: 'not-cloze' }).length === 0, result: true }
    ];
    return { passed: checks.every(item => item.passed), checks };
  }

  function runOpenProductionHintSelfTest() {
    const context = {
      communicativeFocus: { foreground: 'a feeling gradually spreading throughout an entire room' },
      naturalnessCheck: { commonerAlternatives: ['spread'] },
      experience: { anticipatedNaturalAlternatives: ['spread', 'fill'] }
    };
    const cases = [
      {
        name: 'standard-varied-four',
        input: { target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, difficulty: 'standard', experienceType: 'open-description', context, hintLimit: 4, seed: 'std-1', recentCategories: [] },
        test: plan => plan.length === 4 && plan[0].strength === 1 && new Set(plan.map(h => h.category)).size === plan.length
      },
      {
        name: 'easy-can-strengthen-earlier',
        input: { target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, difficulty: 'easy', experienceType: 'situational-production', context, hintLimit: 4, seed: 'easy-1', recentCategories: [] },
        test: plan => plan.length === 4 && plan[0].strength === 1 && Math.max(...plan.slice(0, 2).map(h => h.strength)) <= 3
      },
      {
        name: 'hell-first-hint-low-leakage',
        input: { target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, difficulty: 'hell', experienceType: 'dialogue', context, hintLimit: 4, seed: 'hell-1', recentCategories: [] },
        test: plan => plan.length === 4 && plan[0].strength === 1 && plan[1].strength <= 1
      },
      {
        name: 'construction-preserves-structure-clues',
        input: { target: 'pit someone/something against someone/something', readiness: { kind: 'construction', handling: 'construction', posCategories: ['verb'] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 6, seed: 'construction', recentCategories: [] },
        test: plan => plan.some(h => h.category === 'variable-slots') && plan.some(h => h.category === 'fixed-preposition') && plan.every(h => !h.text.includes('pit someone/something against someone/something'))
      },
      {
        name: 'rotation-avoids-recent-first-category',
        input: { target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 4, seed: 'rotate', recentCategories: ['target-shape'] },
        test: plan => plan.length >= 1 && plan[0].category !== 'target-shape'
      },
      {
        name: 'hint-limit-two',
        input: { target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 2, seed: 'two', recentCategories: [] },
        test: plan => plan.length === 2
      },
      {
        name: 'hint-limit-zero',
        input: { target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 0, seed: 'zero', recentCategories: [] },
        test: plan => plan.length === 0
      },
      {
        name: 'whole-expression',
        input: { target: "You don't want to know.", readiness: { kind: 'sentence-expression', handling: 'sentence-expression', posCategories: [] }, difficulty: 'standard', experienceType: 'dialogue', context: {}, hintLimit: 4, seed: 'whole', recentCategories: [] },
        test: plan => plan.some(h => h.text.includes('whole expression or sentence'))
      },
      {
        name: 'archaic-expression-has-register-option',
        input: { target: 'fare thee well', readiness: { kind: 'simple', handling: 'single', posCategories: [] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 6, seed: 'archaic', recentCategories: [] },
        test: plan => openProductionHintCandidates({ target: 'fare thee well', readiness: { kind: 'simple', handling: 'single', posCategories: [] }, context: {} }).some(h => h.category === 'register-marker')
      },
      {
        name: 'comparison-expression-has-structure-option',
        input: { target: 'age like milk', readiness: { kind: 'simple', handling: 'single', posCategories: [] }, difficulty: 'standard', experienceType: 'open-description', context: {}, hintLimit: 6, seed: 'comparison', recentCategories: [] },
        test: plan => openProductionHintCandidates({ target: 'age like milk', readiness: { kind: 'simple', handling: 'single', posCategories: [] }, context: {} }).some(h => h.category === 'fixed-connector')
      },
      {
        name: 'neighbor-can-stay-partial-before-explicit',
        input: { target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, difficulty: 'standard', experienceType: 'open-description', context, hintLimit: 4, seed: 'neighbor-partial', recentCategories: [] },
        test: plan => {
          const candidates = openProductionHintCandidates({ target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, context });
          const partial = candidates.find(h => h.category === 'neighbor-initial');
          const explicit = candidates.find(h => h.category === 'named-neighbor');
          return Boolean(partial && explicit && partial.strength < explicit.strength);
        }
      },
      {
        name: 'standard-neighbor-initial-is-lower-priority',
        input: { target: 'permeate', readiness: { kind: 'simple', handling: 'single', posCategories: ['verb'] }, difficulty: 'standard', experienceType: 'open-description', context, hintLimit: 4, seed: 'std-neighbor-low-priority', recentCategories: [] },
        test: plan => {
          const index = plan.findIndex(h => h.category === 'neighbor-initial');
          return index === -1 || index >= 3;
        }
      },
      {
        name: 'non-open-type-untouched',
        input: { target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'standard', experienceType: 'cloze', context: {}, hintLimit: 4, seed: 'cloze', recentCategories: [] },
        test: plan => plan.length === 0
      },
      {
        name: 'sentence-reconstruction-untouched',
        input: { target: 'hiatus', readiness: { kind: 'simple', handling: 'single', posCategories: ['noun'] }, difficulty: 'easy', experienceType: 'sentence-reconstruction', context: {}, hintLimit: 6, seed: 'recon', recentCategories: [] },
        test: plan => plan.length === 0
      },
      {
        name: 'reconstruction-limit-does-not-invent-hints',
        testOnly: true,
        test: () => limitHints(['A', 'B', 'C'], 6).join('|') === 'A|B|C' && limitHints(['A', 'B', 'C'], 2).join('|') === 'A|B'
      }
    ];
    const checks = cases.map(item => {
      if (item.testOnly) {
        const passed = Boolean(item.test());
        return { name: item.name, passed, result: passed };
      }
      const result = selectOpenProductionHintPlan(item.input);
      return { name: item.name, passed: Boolean(item.test(result)), result };
    });
    return { passed: checks.every(item => item.passed), checks };
  }

  function renderTaskHints(selected = null) {
    const wrap = $('#wlp-ai-task-hint');
    const button = $('#wlp-ai-task-hint-button');
    const list = $('#wlp-ai-task-hint-list');
    if (!wrap || !button || !list) return;

    const isReconstruction = Boolean(state.reconstruction);
    const isOpenProduction = !isReconstruction && isOpenProductionHintType();
    const isCloze = !isReconstruction && isClozeHintType();
    const isUniversalFallback = !isReconstruction && !isOpenProduction && !isCloze && isUniversalFallbackHintType();
    if (!isReconstruction && !isOpenProduction && !isCloze && !isUniversalFallback) {
      wrap.hidden = true;
      list.hidden = true;
      list.replaceChildren();
      syncAssistancePanelVisibility();
      return;
    }

    const hints = isReconstruction
      ? limitHints(buildReconstructionHints(selected), activeHintLimit())
      : isCloze
        ? buildClozeHints(selected)
        : isOpenProduction
          ? buildOpenProductionHints(selected)
          : buildUniversalFallbackHints(selected);
    if (!hints.length) {
      wrap.hidden = true;
      list.hidden = true;
      list.replaceChildren();
      syncAssistancePanelVisibility();
      return;
    }

    wrap.hidden = false;
    const rawStage = isReconstruction ? state.reconstruction.taskHintStage : state.assistance?.taskHintStage;
    const stage = Math.max(0, Math.min(num(rawStage), hints.length));
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
    button.disabled = state.assistance?.locked === true || stage >= hints.length;
    button.textContent = stage === 0 ? 'Need a hint?' : stage < hints.length ? 'Give me another hint' : 'No more hints';
    syncAssistancePanelVisibility();
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
    const exactWordId = clean(state.devExactWID);
    if (exactWordId) {
      const context = await data.assembleCandidateContext({ ...base, wordIds: [exactWordId] });
      const exact = exactWIDCandidates(context?.candidates, exactWordId);
      if (!exact.length) throw new Error(`DEV exact-WID test could not find WID${exactWordId} in the current WLP data.`);
      return { ...context, candidates: exact };
    }
    if (source.mode === 'review') {
      const wordIds = reviewWordIds(MAX_CANDIDATES);
      if (!wordIds.length) throw new Error('No cards are currently marked Review. Choose a deck or deck range, or mark cards for Review first.');
      return data.assembleCandidateContext({ ...base, wordIds });
    }
    if (source.mode === 'deck') return data.assembleCandidateContext({ ...base, deck: source.deck });
    if (source.mode === 'range') return data.assembleCandidateContext({ ...base, rangeStart: source.rangeStart, rangeEnd: source.rangeEnd });
    if (source.mode === 'study-set') {
      const wordIds = Array.isArray(source.wordIds) ? source.wordIds.map(clean).filter(Boolean) : [];
      if (!wordIds.length) throw new Error('The temporary Study Set is no longer available. Build the set again, then return to Practice.');
      return data.assembleCandidateContext({ ...base, wordIds });
    }
    throw new Error(`Unsupported AI Study source: ${source.mode}`);
  }

  async function buildFreshPlannerRequest(session) {
    const { data, contract } = requireLayers();
    const exactWordId = clean(state.devExactWID);
    const candidateContext = await buildCandidateContext(session);
    if (!candidateContext?.candidates?.length) throw new Error('No AI Study candidates were found for this source.');
    const ranked = exactWordId ? exactWIDCandidates(candidateContext.candidates, exactWordId) : rankCandidates(candidateContext.candidates, session);
    if (exactWordId && !ranked.length) throw new Error(`DEV exact-WID test could not prepare WID${exactWordId} as a Planner candidate.`);
    const packetCandidates = ranked.slice(0, exactWordId ? 1 : MAX_TARGET_PACKETS);
    const assembledTargetPackets = await Promise.all(packetCandidates.map(item => data.assembleTargetContext(item.wordId)));
    const targetPackets = annotateTargetPacketsForReadiness(assembledTargetPackets);
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
    request.targetPackets = targetPackets;
    const validation = contract.validatePlannerRequest(request);
    if (!validation.valid) throw new Error(`Planner request rejected: ${validation.errors.map(item => `${item.path}: ${item.message}`).join('; ')}`);
    return { request, rankedCandidates: ranked, targetPackets, exactWordId: exactWordId || null };
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
    resetAssistanceState();
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
    const visibility = clean(experience.targetVisibility).toLowerCase() || 'hidden';
    const initialTargetVisibility = effectiveInitialTargetVisibility(clean(experience.type), visibility);
    resetAssistanceState(initialTargetVisibility);
    if (reconstruction) {
      // R2-I.1: even Easy reconstruction begins with the target hidden.
      // Learners can reveal it manually without ending the production task.
      visibleTarget.hidden = true;
      visibleTarget.textContent = '';
    } else if (visibility === 'visible') {
      // Some task designs legitimately use the target as the stimulus.
      // That is task-visible, not learner-requested assistance.
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
      renderTargetHint(selected);
      renderTaskHints(selected);
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
            validateComplexTargetSelection(plannerResult, built.request);
            validateExactWIDSelection(plannerResult, built.exactWordId);
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
              usageStart: experienceUsageStart,
              targetReadiness: clone((built.request.targetPackets || []).find(packet => clean(packet?.target?.wordId) === clean(plannerResult.response?.selectedTarget?.wordId))?.targetReadiness || null),
              exactWIDTest: built.exactWordId || null
            }
          };
          const selectedId = clean(plannerResult.response?.selectedTarget?.wordId);
          if (selectedId) state.session.usedTargets[selectedId] = (state.session.usedTargets[selectedId] || 0) + 1;
          if (built.exactWordId && clean(state.devExactWID) === clean(built.exactWordId)) state.devExactWID = '';
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
      usageMotivation: clone(response?.usageMotivation || null),
      learnerAssistance: assistanceSnapshot()
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
    if (state.assistance) state.assistance.locked = true;
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

    const plannerResponse = state.activePlanner?.result?.response || {};
    const learnerText = clean($('#wlp-ai-response')?.value);
    const examples = feedbackExampleBundle(plannerResponse, response, learnerText);
    const family = Array.isArray(selected.targetFamily) ? selected.targetFamily : [];
    const highlightTerms = [target, ...family];

    const yourAnswerBlock = $('#wlp-ai-your-answer');
    const yourAnswerText = $('#wlp-ai-your-answer-text');
    if (examples.yourAnswer) {
      renderHighlightedText(yourAnswerText, examples.yourAnswer, highlightTerms);
      yourAnswerBlock.hidden = false;
    } else {
      yourAnswerText.textContent = '';
      yourAnswerBlock.hidden = true;
    }

    const intendedBlock = $('#wlp-ai-intended-answer');
    const intendedText = $('#wlp-ai-intended-answer-text');
    if (examples.intendedExample) {
      renderHighlightedText(intendedText, examples.intendedExample, highlightTerms);
      intendedBlock.hidden = false;
    } else {
      intendedText.textContent = '';
      intendedBlock.hidden = true;
    }

    const revisionBlock = $('#wlp-ai-natural-revision');
    const revisionText = $('#wlp-ai-natural-revision-text');
    if (examples.naturalForm) {
      renderHighlightedText(revisionText, examples.naturalForm, highlightTerms);
      revisionBlock.hidden = false;
    } else {
      revisionText.textContent = '';
      revisionBlock.hidden = true;
    }

    const modelBlock = $('#wlp-ai-model-response');
    const modelLabel = $('#wlp-ai-model-response-label');
    const modelText = $('#wlp-ai-model-response-text');
    if (examples.naturalOptions.length) {
      modelLabel.textContent = examples.naturalOptions.length > 1 ? 'Other natural options' : 'Another natural option';
      renderHighlightedOptions(modelText, examples.naturalOptions, highlightTerms);
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
    const supportChip = document.createElement('span');
    supportChip.textContent = assistanceLabel(assistanceSnapshot()).toLowerCase();
    evidence.appendChild(supportChip);

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
    const readinessStatus = clean(plannerDiag.targetReadiness?.status);
    const readinessKind = clean(plannerDiag.targetReadiness?.kind);
    if (readinessStatus || readinessKind) timingParts.push(`Target readiness ${[readinessKind, readinessStatus].filter(Boolean).join(' / ')}`);
    if (clean(plannerDiag.exactWIDTest)) timingParts.push(`Exact WID test WID${clean(plannerDiag.exactWIDTest)}`);
    timingParts.push(`Support ${assistanceLabel(assistanceSnapshot())}`);
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
      hintLimit: selectedHintLimit(),
      recentHintCategories: [],
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
    state.assistance = null;
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
    $('#wlp-ai-hint-limit')?.addEventListener('change', persistHintLimit);
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
      if (!state.activePlanner || state.busy || state.assistance?.locked) return;
      const assistance = state.assistance || resetAssistanceState();
      assistance.targetRevealed = !assistance.targetRevealed;
      if (assistance.targetRevealed) noteTargetReveal();
      if (state.reconstruction) state.reconstruction.targetRevealed = assistance.targetRevealed;
      renderTargetHint();
    });
    $('#wlp-ai-task-hint-button')?.addEventListener('click', () => {
      if (state.busy || state.assistance?.locked) return;
      if (state.reconstruction) {
        const hints = buildReconstructionHints();
        if (!hints.length) return;
        const nextStage = Math.min(hints.length, num(state.reconstruction.taskHintStage) + 1);
        state.reconstruction.taskHintStage = nextStage;
        noteHintUse('reconstruction-hint', nextStage);
        renderTaskHints();
        return;
      }
      if (isClozeHintType()) {
        const plan = buildClozeHintPlan();
        if (!plan.length) return;
        const assistance = state.assistance || resetAssistanceState();
        const nextStage = Math.min(plan.length, num(assistance.taskHintStage) + 1);
        assistance.taskHintStage = nextStage;
        const currentHint = plan[nextStage - 1] || {};
        noteHintUse(`cloze:${clean(currentHint.category) || 'hint'}`, nextStage);
        renderTaskHints();
        return;
      }
      if (isOpenProductionHintType()) {
        const plan = buildOpenProductionHintPlan();
        if (!plan.length) return;
        const assistance = state.assistance || resetAssistanceState();
        const nextStage = Math.min(plan.length, num(assistance.taskHintStage) + 1);
        assistance.taskHintStage = nextStage;
        const currentHint = plan[nextStage - 1] || {};
        noteHintUse(`open-production:${clean(currentHint.category) || 'hint'}`, nextStage);
        rememberHintCategory(currentHint.category);
        renderTaskHints();
        return;
      }
      if (!isUniversalFallbackHintType()) return;
      const plan = buildUniversalFallbackHintPlan();
      if (!plan.length) return;
      const assistance = state.assistance || resetAssistanceState();
      const nextStage = Math.min(plan.length, num(assistance.taskHintStage) + 1);
      assistance.taskHintStage = nextStage;
      const currentHint = plan[nextStage - 1] || {};
      noteHintUse(`fallback:${clean(currentHint.category) || 'hint'}`, nextStage);
      rememberHintCategory(currentHint.category);
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
    applySavedHintLimit();
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
        exactWIDTest: exactWIDTestState(),
        busy: state.busy
      }),
      refreshProviderStatus,
      setMode,
      analyzeTargetReadiness: packet => clone(analyzeTargetReadiness(packet)),
      runTargetReadinessSelfTest,
      runTargetReadinessAudit,
      runAssistanceSelfTest,
      runOpenProductionHintSelfTest,
      runClozeHintSelfTest,
      runUniversalSupportSelfTest,
      runFeedbackLayerSelfTest,
      runExactWIDHookSelfTest,
      armExactWIDTest,
      clearExactWIDTest,
      getExactWIDTest: () => clone(exactWIDTestState()),
      getOpenProductionHintPlan: () => clone(buildOpenProductionHintPlan()),
      getClozeHintPlan: () => clone(buildClozeHintPlan()),
      getUniversalFallbackHintPlan: () => clone(buildUniversalFallbackHintPlan()),
      getAssistance: () => clone(assistanceSnapshot())
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
