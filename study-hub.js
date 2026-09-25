(() => {
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const STUDYQ_EVENT_KEY = 'wlp:studyq-events:v1';
  const STUDYQ_EVENT_LIMIT = 1200;
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';
  const STUDYQ_SESSION_LIMIT = 80;
  const DECK_PICKER_MODE_KEY = 'wlp:studyq:deck-picker-mode:v1';
  const STUDYQ_SESSION_SIZE_DEFAULT_KEY = 'wlp:studyq:session-size-default:v1';
  const TEMP_STUDY_SET_KEY = 'wlp:temporary-study-set:v1';
  const STUDYQ_STANDARD_VERSION = '1.1.0';
  const $ = id => document.getElementById(id);
  const StudySpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const STUDYQ_UA = navigator.userAgent || '';
  const STUDYQ_IS_IOS = /iPad|iPhone|iPod/i.test(STUDYQ_UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STUDYQ_IS_IOS_SAFARI = STUDYQ_IS_IOS && /Safari/i.test(STUDYQ_UA) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave/i.test(STUDYQ_UA);
  const STUDYQ_IS_IOS_CHROME = STUDYQ_IS_IOS && /CriOS/i.test(STUDYQ_UA);

  let rows = [];
  let rowByWordId = new Map();
  let maxDeck = 1;
  let sourceMode = 'review';
  let coverageMode = 'all';
  let temporaryStudySet = null;
  let reviewByWordId = new Map();
  let currentPool = [];
  let sessionQueue = [];
  let sessionIndex = 0;
  let lastSessionSpec = null;
  let sessionAttempts = [];
  let currentAttempt = null;
  let currentSessionId = '';
  let currentSessionStartedAt = '';
  let currentSessionPlannedCount = 0;
  let viewingSavedSession = false;
  let deckPickerTargetId = '';
  let deckPickerMode = 'wheel';
  let deckPickerMajorRange = null;
  let deckPickerMinorRange = null;
  let studyVoiceRecognition = null;
  let studyVoiceListening = false;
  let studyVoiceTimeout = 0;
  let studyVoiceMicPrimed = false;
  const historyRatingEditGrace = new Set();
  const historyRatingNotice = new Map();

  const clean = value => String(value ?? '').trim();
  const stripInvisible = value => String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ');
  const clampDeck = value => Math.max(1, Math.min(maxDeck, Math.round(Number(value) || 1)));

  function readTemporaryStudySet() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(TEMP_STUDY_SET_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.items)) return null;
      const seen = new Set();
      const items = parsed.items.map(item => ({
        wordId: clean(item?.wordId),
        batch: clean(item?.batch),
        word: clean(item?.word)
      })).filter(item => item.wordId && !seen.has(item.wordId) && (seen.add(item.wordId), true));
      return items.length ? { ...parsed, items } : null;
    } catch { return null; }
  }

  function studySetSummaryLines(snapshot) {
    if (!snapshot) return [];
    const lines = [];
    const stages = Array.isArray(snapshot.criteria?.searchStages) ? snapshot.criteria.searchStages : [];
    stages.forEach((stage, index) => {
      const query = clean(stage?.query);
      if (!query) return;
      const scopeNames = { anywhere:'Anywhere', headword:'Headword', synonyms:'Synonyms', 'card-content':'Card Content', classification:'Classification' };
      const scope = scopeNames[stage?.scope] || 'Anywhere';
      lines.push(`Search ${index + 1}: ${query} · ${scope} · ${stage?.mode === 'any' ? 'ANY' : 'ALL'}`);
    });
    const axisNames = { entryTypes:'Entry Type', usageTags:'Usage', topicTags:'Topic', discoveryTags:'Discovery' };
    Object.entries(axisNames).forEach(([field, label]) => {
      const axis = snapshot.criteria?.axes?.[field] || {};
      const parts = [];
      if (Array.isArray(axis.include) && axis.include.length) parts.push(`+${axis.include.join(', +')}`);
      if (Array.isArray(axis.exclude) && axis.exclude.length) parts.push(`−${axis.exclude.join(', −')}`);
      if (parts.length) lines.push(`${label}: ${parts.join(' · ')}`);
    });
    if (lines.length <= 4) return lines;
    return [...lines.slice(0, 3), `+${lines.length - 3} more filters`];
  }

  function renderTemporaryStudySetSource() {
    const button = $('study-source-study-set');
    const copy = $('study-source-study-set-copy');
    const count = $('study-current-set-count');
    const summary = $('study-current-set-summary');
    const tabs = document.querySelector('.study-source-tabs');
    const available = Boolean(temporaryStudySet?.items?.length);
    if (button) button.hidden = !available;
    tabs?.classList.toggle('has-study-set', available);
    if (!available) return;
    const total = temporaryStudySet.items.length;
    if (copy) copy.textContent = `${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}`;
    if (count) count.textContent = `Current Study Set · ${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}`;
    if (summary) {
      summary.textContent = '';
      studySetSummaryLines(temporaryStudySet).forEach(line => {
        const item = document.createElement('span');
        item.textContent = line;
        summary.appendChild(item);
      });
    }
  }

  function refreshTemporaryStudySet() {
    const snapshot = readTemporaryStudySet();
    if (!snapshot) { temporaryStudySet = null; renderTemporaryStudySetSource(); return null; }
    const items = snapshot.items.filter(item => rowByWordId.has(item.wordId));
    temporaryStudySet = items.length ? { ...snapshot, items } : null;
    renderTemporaryStudySetSource();
    return temporaryStudySet;
  }


  function standardSessionSizeValue() {
    const select = $('study-session-size');
    const value = Math.max(1, Math.floor(Number(select?.value) || 10));
    return value;
  }

  function standardSessionSizeText(value) {
    const size = Math.max(1, Math.floor(Number(value) || 1));
    return `${size} ${size === 1 ? 'experience' : 'experiences'}`;
  }

  function savedStandardSessionSize() {
    try {
      const value = Math.max(0, Math.floor(Number(localStorage.getItem(STUDYQ_SESSION_SIZE_DEFAULT_KEY)) || 0));
      return value || 0;
    } catch { return 0; }
  }

  function syncStandardSessionSizePreferenceUI() {
    const remember = $('study-standard-remember-session-size');
    const label = $('study-standard-session-default-label');
    const status = $('study-standard-session-default-status');
    if (!remember || !label || !status) return;
    const size = standardSessionSizeValue();
    const saved = savedStandardSessionSize();
    remember.checked = saved === size;
    label.textContent = `Use current choice (${standardSessionSizeText(size)}) as my Standard Practice default`;
    status.textContent = saved
      ? `Saved Standard Practice default: ${standardSessionSizeText(saved)}`
      : 'No Standard Practice default saved yet.';
  }

  function applySavedStandardSessionSize() {
    const saved = savedStandardSessionSize();
    const select = $('study-session-size');
    if (saved && select) {
      const option = Array.from(select.options || []).find(item => Number(item.value) === saved);
      if (option) select.value = String(saved);
    }
    syncStandardSessionSizePreferenceUI();
  }

  function persistStandardSessionSizePreference() {
    const remember = $('study-standard-remember-session-size');
    if (!remember) return;
    const size = standardSessionSizeValue();
    const saved = savedStandardSessionSize();
    try {
      if (remember.checked) localStorage.setItem(STUDYQ_SESSION_SIZE_DEFAULT_KEY, String(size));
      else if (saved === size) localStorage.removeItem(STUDYQ_SESSION_SIZE_DEFAULT_KEY);
    } catch (_) {}
    syncStandardSessionSizePreferenceUI();
  }

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

  function readOverrides() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }

  function applyOverrides(masterRows) {
    const overrides = readOverrides();
    return masterRows.map(row => {
      const wordId = clean(row.WordID);
      const edit = overrides[wordId];
      return edit && typeof edit === 'object'
        ? { ...row, ...edit, WordID: row.WordID, 'Batch #': row['Batch #'] }
        : { ...row };
    });
  }

  function readReviewMap() {
    const out = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const wordId = clean(data.wordId || key.slice(PROGRESS_PREFIX.length));
        const isReview = data.review === true || data.lastResult === 'review';
        if (!wordId || !isReview) continue;
        const level = ['high', 'medium', 'light'].includes(clean(data.reviewLevel).toLowerCase())
          ? clean(data.reviewLevel).toLowerCase() : '';
        out.set(wordId, { ...data, wordId, reviewLevel: level });
      } catch (error) {
        console.warn('Could not read Study Q review record', key, error);
      }
    }
    return out;
  }

  function metadataFor(wordId) {
    const api = window.WLPLearningHooks;
    if (!api || typeof api.getForMaster !== 'function') return null;
    const meta = api.getForMaster(wordId);
    return meta && typeof meta === 'object' ? meta : null;
  }

  function escapeRegex(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeTargetText(value) {
    return stripInvisible(clean(value)).normalize('NFKC').replace(/\s+/g, ' ');
  }

  function simpleWordForms(value, options = {}) {
    const word = normalizeTargetText(value);
    const out = new Set([word]);
    if (!/^[A-Za-z][A-Za-z'-]{2,}$/.test(word)) return Array.from(out);
    const lower = word.toLowerCase();
    const verb = options.verb === true;
    const noun = options.noun === true;
    if (noun && !/ing$/i.test(lower)) {
      if (/(?:s|x|z|ch|sh)$/i.test(word)) out.add(`${word}es`);
      else if (/[^aeiou]y$/i.test(word)) out.add(`${word.slice(0, -1)}ies`);
      else out.add(`${word}s`);
    }
    if (verb && !/(?:ing|ed)$/i.test(lower)) {
      if (/[^aeiou]y$/i.test(word)) {
        out.add(`${word.slice(0, -1)}ies`);
        out.add(`${word.slice(0, -1)}ied`);
        out.add(`${word}ing`);
      } else {
        if (/(?:s|x|z|ch|sh|o)$/i.test(word)) out.add(`${word}es`);
        else out.add(`${word}s`);
        if (lower.endsWith('e')) {
          out.add(`${word}d`);
          out.add(`${word.slice(0, -1)}ing`);
        } else {
          out.add(`${word}ed`);
          out.add(`${word}ing`);
          if (/[^aeiou][aeiou][^aeiouwxy]$/i.test(word) && word.length <= 5) {
            out.add(`${word}${word.slice(-1)}ed`);
            out.add(`${word}${word.slice(-1)}ing`);
          }
        }
      }
    }
    return Array.from(out);
  }

  function thirdPersonForm(value) {
    const word = normalizeTargetText(value);
    if (!/^[A-Za-z][A-Za-z'-]{2,}$/.test(word)) return '';
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    if (/(?:s|x|z|ch|sh|o)$/i.test(word)) return `${word}es`;
    return `${word}s`;
  }

  function targetProfile(input) {
    const row = input && typeof input === 'object' && !Array.isArray(input) && ('Word' in input || 'Part of Speech' in input) ? input : null;
    const raw = normalizeTargetText(row ? row.Word : input);
    const pos = clean(row?.['Part of Speech']);
    const profile = {
      raw,
      pos,
      kind: 'simple',
      label: '',
      parts: [],
      accepted: [],
      leakVariants: [],
      practiceTarget: raw,
      displayTarget: raw,
      patternDisplay: '',
      genericDefinitionSafe: true
    };
    if (!raw) return profile;

    let base = raw;
    const labelMatch = raw.match(/^(.+?)\s*:\s*(synonyms?(?:\s*(?:and|&|\/)\s*near[- ]synonyms?)?|near[- ]synonyms?|usage(?:\s+notes?)?|contrast(?:s)?|related expressions?)$/i);
    if (labelMatch) {
      base = normalizeTargetText(labelMatch[1]);
      profile.kind = 'labeled';
      profile.label = normalizeTargetText(labelMatch[2]);
    }

    let rawParts = [base];
    if (/\s+(?:vs\.?|versus)\s+/i.test(base)) {
      rawParts = base.split(/\s+(?:vs\.?|versus)\s+/i).map(normalizeTargetText).filter(Boolean);
      profile.kind = 'contrast';
      profile.genericDefinitionSafe = false;
    } else if (/\s+\/\s+/.test(base)) {
      rawParts = base.split(/\s+\/\s+/).map(normalizeTargetText).filter(Boolean);
      profile.kind = 'family';
    }

    const accepted = new Set();
    const leaks = new Set();
    const posParts = pos.split(/\s*\/\s*/).map(clean).filter(Boolean);
    const partProfiles = rawParts.map((part, partIndex) => {
      const cleanPart = normalizeTargetText(part.replace(/\s*\([^)]*\)\s*/g, ' '));
      const placeholderRe = /\b(?:do\s+something|doing\s+something|something|someone|somebody|somewhere|oneself|one['’]s|someone['’]s|somebody['’]s|sth\.?|sb\.?)\b/i;
      const placeholderMatch = cleanPart.match(placeholderRe);
      let fixedPrefix = '';
      let pattern = cleanPart;
      if (placeholderMatch) {
        fixedPrefix = normalizeTargetText(cleanPart.slice(0, placeholderMatch.index).replace(/[\s,;:/-]+$/g, ''));
        pattern = cleanPart
          .replace(/\bdo\s+something\b/ig, '+ verb')
          .replace(/\bdoing\s+something\b/ig, '+ -ing')
          .replace(/\b(?:something|someone|somebody|somewhere|oneself|one['’]s|someone['’]s|somebody['’]s|sth\.?|sb\.?)\b/ig, '…')
          .replace(/\s+/g, ' ')
          .trim();
        if (fixedPrefix.split(/\s+/).filter(Boolean).length >= 2) {
          accepted.add(fixedPrefix);
          leaks.add(fixedPrefix);
          const fixedTokens = fixedPrefix.split(/\s+/);
          const firstToken = fixedTokens[0];
          const rest = fixedTokens.slice(1).join(' ');
          const thirdPerson = thirdPersonForm(firstToken);
          if (thirdPerson && normalizeAnswer(thirdPerson) !== normalizeAnswer(firstToken)) {
            const phrase = `${thirdPerson}${rest ? ` ${rest}` : ''}`;
            accepted.add(phrase);
            leaks.add(phrase);
          }
        }
      }
      if (!placeholderMatch) {
        accepted.add(cleanPart);
        leaks.add(cleanPart);
      }
      if (/^[A-Za-z][A-Za-z'-]{2,}$/.test(cleanPart)) {
        const partPos = (profile.kind === 'family' && posParts.length === rawParts.length ? posParts[partIndex] : pos).toLowerCase();
        simpleWordForms(cleanPart, { verb: partPos.includes('verb'), noun: partPos.includes('noun') }).forEach(form => { accepted.add(form); leaks.add(form); });
      }
      return { raw: part, clean: cleanPart, fixedPrefix, pattern, hasPlaceholder: Boolean(placeholderMatch), pos: profile.kind === 'family' && posParts.length === rawParts.length ? posParts[partIndex] : pos };
    });

    profile.parts = partProfiles;
    if (profile.kind === 'simple' && partProfiles[0]?.hasPlaceholder) profile.kind = 'construction';
    const first = partProfiles[0];
    profile.practiceTarget = first?.fixedPrefix || first?.clean || base;
    profile.patternDisplay = first?.pattern || profile.practiceTarget;
    profile.displayTarget = profile.kind === 'construction' ? profile.patternDisplay : profile.practiceTarget;
    if (profile.kind === 'family') {
      const firstSimple = partProfiles.find(part => !part.hasPlaceholder)?.clean;
      profile.practiceTarget = firstSimple || partProfiles[0]?.fixedPrefix || partProfiles[0]?.clean || base;
      profile.displayTarget = profile.practiceTarget;
    }
    if (profile.kind === 'contrast') {
      profile.practiceTarget = partProfiles[0]?.clean || base;
      profile.displayTarget = profile.practiceTarget;
    }
    if (profile.kind === 'labeled') {
      profile.practiceTarget = normalizeTargetText(base);
      profile.displayTarget = profile.practiceTarget;
      accepted.add(profile.practiceTarget);
      leaks.add(profile.practiceTarget);
      const posLower = pos.toLowerCase();
      simpleWordForms(profile.practiceTarget, { verb: posLower.includes('verb'), noun: posLower.includes('noun') }).forEach(form => { accepted.add(form); leaks.add(form); });
    }
    // Always retain the raw headword as a display/accepted value, but do not
    // rely on it alone for leakage detection.
    accepted.add(raw);
    profile.accepted = Array.from(accepted).filter(Boolean).sort((a, b) => b.length - a.length);
    profile.leakVariants = Array.from(leaks).filter(value => value.length >= 2).sort((a, b) => b.length - a.length);
    return profile;
  }

  function targetVariants(target) {
    const profile = target && typeof target === 'object' && Array.isArray(target.leakVariants) ? target : targetProfile(target);
    return profile.leakVariants || [];
  }

  function targetAnswerVariants(item) {
    const profile = item?.targetProfile || targetProfile(item?.row || item?.answerTarget || '');
    const out = new Set(profile.accepted || []);
    if (item?.answerTarget) out.add(clean(item.answerTarget));
    if (Array.isArray(item?.acceptedAnswers)) item.acceptedAnswers.forEach(value => out.add(clean(value)));
    return Array.from(out).filter(Boolean).sort((a, b) => b.length - a.length);
  }

  function variantPattern(variant) {
    return variant
      .split(/\s+/)
      .filter(Boolean)
      .map(token => escapeRegex(token).replace(/['’]/g, "['’]").replace(/-/g, '[-‐‑‒–—]'))
      .join('\\s+');
  }

  function matchingTargetSurfaces(value, target) {
    const text = stripInvisible(clean(value)).normalize('NFKC');
    const profile = target && typeof target === 'object' && Array.isArray(target.leakVariants) ? target : targetProfile(target);
    const matches = [];
    targetVariants(profile).forEach(variant => {
      const pattern = variantPattern(variant);
      if (!pattern) return;
      const regex = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, 'giu');
      let match;
      while ((match = regex.exec(text))) {
        matches.push({ variant, surface: match[2], index: match.index + match[1].length });
        if (!match[0].length) regex.lastIndex++;
      }
    });
    const seen = new Set();
    return matches.filter(match => {
      const key = `${normalizeAnswer(match.surface)}@${match.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.index - b.index || b.surface.length - a.surface.length);
  }

  function redactTarget(value, target) {
    let text = stripInvisible(clean(value)).normalize('NFKC');
    let changed = false;
    const profile = target && typeof target === 'object' && Array.isArray(target.leakVariants) ? target : targetProfile(target);
    if (!text || !profile.raw) return { text, changed };
    targetVariants(profile).forEach(variant => {
      const pattern = variantPattern(variant);
      if (!pattern) return;
      const regex = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, 'giu');
      text = text.replace(regex, (match, prefix) => {
        changed = true;
        return `${prefix}_____`;
      });
    });
    return { text: text.replace(/\s{2,}/g, ' ').trim(), changed };
  }

  function hasTargetLeak(value, target) {
    return redactTarget(value, target).changed;
  }

  function safePrompt(value, target) {
    const redacted = redactTarget(value, target);
    if (!meaningfulPrompt(redacted.text)) return { text: '', changed: redacted.changed };
    if (hasTargetLeak(redacted.text, target)) return { text: '', changed: true };
    return redacted;
  }

  function definitionCue(value, target) {
    const profile = target && typeof target === 'object' && Array.isArray(target.leakVariants) ? target : targetProfile(target);
    if (!profile.genericDefinitionSafe) return '';
    const redacted = safePrompt(value, profile);
    let prompt = redacted.text;
    if (!prompt || !redacted.changed) return prompt;

    let match = prompt.match(/^(Depending on context,\s*)?(?:an?\s+|the\s+)?_+\s+(?:may|can)\s+be\s+(.+)$/i);
    if (match) {
      const lead = match[1] ? 'Depending on context, ' : '';
      prompt = `${lead}possible senses include ${match[2]}`;
      return prompt.charAt(0).toUpperCase() + prompt.slice(1);
    }

    match = prompt.match(/^(?:an?\s+|the\s+)?_+\s+(?:means?|refers? to|is|are)\s+(.+)$/i);
    if (match && meaningfulPrompt(match[1])) {
      const rest = match[1].trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return prompt;
  }

  function meaningfulPrompt(value) {
    const text = clean(value).replace(/_+/g, '').replace(/[\s.,;:!?"'`()\[\]{}<>/\\|~@#$%^&*+=—–-]+/g, '');
    return text.length >= 8;
  }

  function sanitizeSituationPrompt(value, target) {
    let text = clean(value);
    if (!text) return '';

    // If a stored Situation ends with an explicit example that contains the
    // target (e.g. "The ending felt overwrought."), drop that example first.
    // This keeps Situation → Expression an open retrieval prompt instead of
    // turning it into an accidental cloze whenever possible.
    const exampleMarker = /\b(?:e\.?\s*g\.?|for example|for instance|example)\s*[:.,-]?\s*/ig;
    const matches = Array.from(text.matchAll(exampleMarker));
    for (const match of matches) {
      const trailing = text.slice(match.index);
      if (redactTarget(trailing, target).changed) {
        const before = text.slice(0, match.index).replace(/[\s,:;–—-]+$/g, '').trim();
        if (meaningfulPrompt(before)) {
          text = before;
          break;
        }
      }
    }

    return safePrompt(text, target).text;
  }

  function splitExamples(value) {
    return clean(value)
      .split(/\s+\/\s+|<br\s*\/?\s*>|\r?\n+/i)
      .map(clean)
      .filter(Boolean)
      .slice(0, 4);
  }

  function noteExcerpt(value) {
    const text = clean(value).replace(/\s+/g, ' ');
    if (text.length <= 360) return text;
    const slice = text.slice(0, 360);
    const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '));
    return `${slice.slice(0, boundary >= 160 ? boundary + 1 : 357).trim()}…`;
  }

  function baseExperience(row, meta, review) {
    const wordId = clean(row.WordID);
    const profile = targetProfile(row);
    return {
      wordId,
      row,
      meta: meta || {},
      targetProfile: profile,
      answerTarget: profile.displayTarget || profile.practiceTarget || clean(row.Word),
      acceptedAnswers: profile.accepted || [],
      alternatives: Array.isArray(meta?.alternativeExpressions) ? meta.alternativeExpressions : [],
      review: review || null
    };
  }

  function situationExperiences(row, meta, review) {
    const profile = targetProfile(row);
    const base = baseExperience(row, meta, review);
    const situations = Array.isArray(meta?.situations) ? meta.situations.filter(item => clean(item?.anchor)) : [];
    const out = [];
    situations.forEach(situation => {
      const anchor = sanitizeSituationPrompt(situation?.anchor, profile);
      if (!meaningfulPrompt(anchor)) return;
      const title = safePrompt(situation?.title, profile).text;
      const need = safePrompt(situation?.communicativeNeed, profile).text;
      out.push({
        ...base,
        kind: 'situation',
        situation,
        promptLabel: 'Situation',
        promptTitle: meaningfulPrompt(title) ? title : '',
        promptText: anchor,
        question: 'What might you naturally say?',
        responseHelp: 'Multiple answers can be natural. WLP is not treating this as a one-answer quiz.',
        communicativeNeed: meaningfulPrompt(need) ? need : ''
      });
    });
    return out;
  }

  function exampleExperiences(row, meta, review) {
    const profile = targetProfile(row);
    const base = baseExperience(row, meta, review);
    return splitExamples(row['Example Sentence']).map(example => {
      const matches = matchingTargetSurfaces(example, profile);
      // Contrast cards are useful only when this example points to one side
      // clearly. If both prestige and prestigious are present, for example,
      // skip that example instead of creating an ambiguous cloze.
      const distinct = Array.from(new Set(matches.map(match => normalizeAnswer(match.surface)).filter(Boolean)));
      if (profile.kind === 'contrast' && distinct.length !== 1) return null;
      const redacted = safePrompt(example, profile);
      if (!redacted.changed || !meaningfulPrompt(redacted.text)) return null;
      const surface = matches[0]?.surface || profile.practiceTarget || clean(row.Word);
      return {
        ...base,
        kind: 'example',
        situation: null,
        answerTarget: clean(surface),
        acceptedAnswers: profile.kind === 'contrast' ? [clean(surface)] : profile.accepted,
        promptLabel: 'Example context',
        promptTitle: '',
        promptText: redacted.text,
        question: 'What expression fits naturally here?',
        responseHelp: 'More than one answer may work. Reveal shows the WLP target for this context.',
        communicativeNeed: ''
      };
    }).filter(Boolean);
  }

  function definitionExperience(row, meta, review) {
    const profile = targetProfile(row);
    if (!profile.genericDefinitionSafe) return null;
    const prompt = definitionCue(row.Definition, profile);
    if (!meaningfulPrompt(prompt)) return null;
    return {
      ...baseExperience(row, meta, review),
      kind: 'definition',
      situation: null,
      promptLabel: 'Meaning cue',
      promptTitle: '',
      promptText: prompt,
      question: 'What word or expression matches this meaning?',
      responseHelp: 'Other expressions may fit too. Reveal shows the WLP target for this card.',
      communicativeNeed: ''
    };
  }

  function noteExperience(row, meta, review) {
    const profile = targetProfile(row);
    if (profile.kind === 'contrast') return null;
    const prompt = safePrompt(noteExcerpt(row['Note(s)']), profile).text;
    if (!meaningfulPrompt(prompt)) return null;
    return {
      ...baseExperience(row, meta, review),
      kind: 'note',
      situation: null,
      promptLabel: 'Usage clue',
      promptTitle: '',
      promptText: prompt,
      question: 'What expression is this usage note pointing to?',
      responseHelp: 'Use the clue as a starting point. Reveal shows the WLP target for this card.',
      communicativeNeed: ''
    };
  }

  function experiencesForRow(row) {
    const wordId = clean(row.WordID);
    const meta = metadataFor(wordId) || {};
    const review = reviewByWordId.get(wordId) || null;
    const situations = situationExperiences(row, meta, review);
    if (coverageMode === 'situations') return situations;
    if (situations.length) return situations;
    const examples = exampleExperiences(row, meta, review);
    if (examples.length) return examples;
    const definition = definitionExperience(row, meta, review);
    if (definition) return [definition];
    const note = noteExperience(row, meta, review);
    return note ? [note] : [];
  }

  function experiencePoolFor(mode = sourceMode) {
    let selectedRows = rows;
    if (mode === 'review') selectedRows = rows.filter(row => reviewByWordId.has(clean(row.WordID)));
    if (mode === 'deck') {
      const deck = clampDeck($('study-deck').value);
      selectedRows = rows.filter(row => Number(row['Batch #']) === deck);
    }
    if (mode === 'range') {
      let start = clampDeck($('study-range-start').value);
      let end = clampDeck($('study-range-end').value);
      if (start > end) [start, end] = [end, start];
      selectedRows = rows.filter(row => {
        const deck = Number(row['Batch #']);
        return deck >= start && deck <= end;
      });
    }
    if (mode === 'study-set') {
      selectedRows = (temporaryStudySet?.items || []).map(item => rowByWordId.get(item.wordId)).filter(Boolean);
    }

    const pool = [];
    selectedRows.forEach(row => pool.push(...experiencesForRow(row)));
    return pool;
  }

  function sourceLabel(mode = sourceMode) {
    if (mode === 'review') return 'Review';
    if (mode === 'deck') return `WLP${String(clampDeck($('study-deck').value)).padStart(3, '0')}`;
    if (mode === 'study-set') {
      const total = temporaryStudySet?.items?.length || 0;
      return total ? `Study Set · ${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}` : 'Study Set';
    }
    let start = clampDeck($('study-range-start').value), end = clampDeck($('study-range-end').value);
    if (start > end) [start, end] = [end, start];
    return `WLP${String(start).padStart(3, '0')}–${String(end).padStart(3, '0')}`;
  }

  function readRecentDecks() {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(value) ? value.map(Number).filter(deck => Number.isFinite(deck) && deck >= 1 && deck <= maxDeck) : [];
    } catch { return []; }
  }

  function readDeckPickerMode() {
    const saved = clean(localStorage.getItem(DECK_PICKER_MODE_KEY));
    return saved === 'browse' ? 'browse' : 'wheel';
  }

  function pickerMinimumDeck() {
    if (deckPickerTargetId !== 'study-range-end') return 1;
    return clampDeck($('study-range-start')?.value || 1);
  }

  function availableDeckNumbers(minimum = 1) {
    return Array.from(new Set(rows.map(row => Number(row['Batch #']) || 0).filter(deck => deck >= minimum))).sort((a, b) => a - b);
  }

  function populateDeckPickerOptions(selectedDeck = 1) {
    const select = $('study-deck-picker-select');
    if (!select) return;
    const minimum = pickerMinimumDeck();
    const decks = availableDeckNumbers(minimum);
    select.replaceChildren(...decks.map(deck => {
      const option = document.createElement('option');
      option.value = String(deck);
      option.textContent = `WLP${padDeck(deck)}`;
      return option;
    }));
    const safeSelected = Math.max(minimum, clampDeck(selectedDeck));
    if (decks.includes(safeSelected)) select.value = String(safeSelected);
    else if (decks.length) select.value = String(decks[0]);
  }

  function selectedPickerDeck() {
    const select = $('study-deck-picker-select');
    return clampDeck(select?.value || pickerMinimumDeck());
  }

  function updateDeckPickerPreview() {
    const deck = selectedPickerDeck();
    const minimum = pickerMinimumDeck();
    const preview = $('study-deck-picker-preview');
    if (preview) {
      preview.textContent = deckPickerTargetId === 'study-range-end' && minimum > 1
        ? `Range end · WLP${padDeck(deck)} (from WLP${padDeck(minimum)})`
        : `Selected · WLP${padDeck(deck)}`;
    }
    $('study-deck-picker-recent-list')?.querySelectorAll('button').forEach(button => {
      button.classList.toggle('is-selected', Number(button.dataset.deck) === deck);
    });
    renderDeckPickerBrowseSelection();
  }

  function renderDeckPickerRecent(selectedDeck) {
    const wrap = $('study-deck-picker-recent');
    const list = $('study-deck-picker-recent-list');
    if (!wrap || !list) return;
    const minimum = pickerMinimumDeck();
    const recent = readRecentDecks().filter(deck => deck >= minimum).slice(0, 8);
    list.replaceChildren();
    wrap.hidden = !recent.length;
    recent.forEach(deck => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.deck = String(deck);
      button.textContent = `WLP${padDeck(deck)}`;
      button.classList.toggle('is-selected', deck === selectedDeck);
      button.addEventListener('click', () => {
        $('study-deck-picker-select').value = String(deck);
        updateDeckPickerPreview();
      });
      list.append(button);
    });
  }

  function setDeckPickerMode(mode, { remember = true } = {}) {
    deckPickerMode = mode === 'browse' ? 'browse' : 'wheel';
    document.querySelectorAll('[data-deck-picker-mode]').forEach(button => {
      const selected = button.dataset.deckPickerMode === deckPickerMode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $('study-deck-picker-wheel').hidden = deckPickerMode !== 'wheel';
    $('study-deck-picker-browse').hidden = deckPickerMode !== 'browse';
    if (remember) {
      try { localStorage.setItem(DECK_PICKER_MODE_KEY, deckPickerMode); } catch (_) {}
    }
    if (deckPickerMode === 'browse') renderDeckPickerBrowse();
  }

  function pickerMajorFor(deck) {
    const start = Math.floor((Math.max(1, deck) - 1) / 50) * 50 + 1;
    return { start, end: Math.min(start + 49, maxDeck) };
  }

  function pickerMinorFor(deck, major) {
    const start = Math.floor((Math.max(major.start, deck) - major.start) / 10) * 10 + major.start;
    return { start, end: Math.min(start + 9, major.end) };
  }

  function resetDeckPickerBrowse(selectedDeck, focusNearSelected = false) {
    deckPickerMajorRange = null;
    deckPickerMinorRange = null;
    if (focusNearSelected) {
      deckPickerMajorRange = pickerMajorFor(selectedDeck);
      deckPickerMinorRange = pickerMinorFor(selectedDeck, deckPickerMajorRange);
    }
    renderDeckPickerBrowse();
  }

  function deckPickerRangeButton(start, end, level) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'study-deck-picker-range-card';
    button.innerHTML = `<strong>WLP${padDeck(start)}–${padDeck(end)}</strong><span>${level === 'major' ? '50-deck range' : '10-deck group'}</span>`;
    button.addEventListener('click', () => {
      if (level === 'major') {
        deckPickerMajorRange = { start, end };
        deckPickerMinorRange = null;
      } else {
        deckPickerMinorRange = { start, end };
      }
      renderDeckPickerBrowse();
    });
    return button;
  }

  function renderDeckPickerBreadcrumbs() {
    const crumbs = $('study-deck-picker-breadcrumbs');
    if (!crumbs) return;
    crumbs.replaceChildren();
    if (!deckPickerMajorRange) {
      crumbs.hidden = true;
      return;
    }
    crumbs.hidden = false;
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'All ranges';
    all.addEventListener('click', () => {
      deckPickerMajorRange = null;
      deckPickerMinorRange = null;
      renderDeckPickerBrowse();
    });
    crumbs.append(all);
    const sep = document.createElement('span');
    sep.textContent = '›';
    crumbs.append(sep);
    const major = document.createElement('button');
    major.type = 'button';
    major.textContent = `${padDeck(deckPickerMajorRange.start)}–${padDeck(deckPickerMajorRange.end)}`;
    major.addEventListener('click', () => { deckPickerMinorRange = null; renderDeckPickerBrowse(); });
    crumbs.append(major);
    if (deckPickerMinorRange) {
      const sep2 = document.createElement('span');
      sep2.textContent = '›';
      crumbs.append(sep2);
      const minor = document.createElement('span');
      minor.textContent = `${padDeck(deckPickerMinorRange.start)}–${padDeck(deckPickerMinorRange.end)}`;
      crumbs.append(minor);
    }
  }

  function renderDeckPickerBrowseSelection() {
    const selected = selectedPickerDeck();
    $('study-deck-picker-grid')?.querySelectorAll('[data-picker-deck]').forEach(button => {
      button.classList.toggle('is-selected', Number(button.dataset.pickerDeck) === selected);
    });
  }

  function renderDeckPickerBrowse() {
    const grid = $('study-deck-picker-grid');
    const meta = $('study-deck-picker-browse-meta');
    const back = $('study-deck-picker-browse-back');
    if (!grid || !meta || !back) return;
    const minimum = pickerMinimumDeck();
    grid.replaceChildren();
    renderDeckPickerBreadcrumbs();

    if (!deckPickerMajorRange) {
      meta.textContent = minimum > 1 ? `Choose a 50-deck range · WLP${padDeck(minimum)} or later` : 'Choose a 50-deck range';
      back.hidden = true;
      const firstMajorStart = Math.floor((minimum - 1) / 50) * 50 + 1;
      for (let start = firstMajorStart; start <= maxDeck; start += 50) {
        const end = Math.min(start + 49, maxDeck);
        if (end < minimum) continue;
        grid.append(deckPickerRangeButton(start, end, 'major'));
      }
      return;
    }

    back.hidden = false;
    if (!deckPickerMinorRange) {
      meta.textContent = `Choose a 10-deck group inside WLP${padDeck(deckPickerMajorRange.start)}–${padDeck(deckPickerMajorRange.end)}`;
      for (let start = deckPickerMajorRange.start; start <= deckPickerMajorRange.end; start += 10) {
        const end = Math.min(start + 9, deckPickerMajorRange.end);
        if (end < minimum) continue;
        grid.append(deckPickerRangeButton(start, end, 'minor'));
      }
      return;
    }

    meta.textContent = `Choose a deck · WLP${padDeck(deckPickerMinorRange.start)}–${padDeck(deckPickerMinorRange.end)}`;
    availableDeckNumbers(minimum)
      .filter(deck => deck >= deckPickerMinorRange.start && deck <= deckPickerMinorRange.end)
      .forEach(deck => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'study-deck-picker-deck-button';
        button.dataset.pickerDeck = String(deck);
        button.textContent = `WLP${padDeck(deck)}`;
        button.classList.toggle('is-selected', deck === selectedPickerDeck());
        button.addEventListener('click', () => {
          $('study-deck-picker-select').value = String(deck);
          updateDeckPickerPreview();
        });
        grid.append(button);
      });
  }

  function openDeckPicker(targetId) {
    const target = $(targetId);
    if (!target || !$('study-deck-picker-modal')) return;
    deckPickerTargetId = targetId;
    const minimum = pickerMinimumDeck();
    let selected = Math.max(minimum, clampDeck(target.value));
    if (targetId === 'study-range-end') selected = Math.max(selected, clampDeck($('study-range-start').value));
    const labels = {
      'study-deck': 'Choose a deck',
      'study-range-start': 'Choose range start',
      'study-range-end': 'Choose range end'
    };
    $('study-deck-picker-title').textContent = labels[targetId] || 'Choose deck';
    populateDeckPickerOptions(selected);
    renderDeckPickerRecent(selected);
    updateDeckPickerPreview();
    resetDeckPickerBrowse(selected, targetId === 'study-range-end');
    setDeckPickerMode(readDeckPickerMode(), { remember: false });
    $('study-deck-picker-modal').hidden = false;
    document.body.classList.add('study-deck-picker-open');
    if (deckPickerMode === 'wheel') setTimeout(() => $('study-deck-picker-select').focus({ preventScroll: true }), 0);
  }

  function closeDeckPicker() {
    $('study-deck-picker-modal').hidden = true;
    document.body.classList.remove('study-deck-picker-open');
    deckPickerTargetId = '';
    deckPickerMajorRange = null;
    deckPickerMinorRange = null;
  }

  function useDeckPicker() {
    if (!deckPickerTargetId) return closeDeckPicker();
    const target = $(deckPickerTargetId);
    if (!target) return closeDeckPicker();
    const deck = selectedPickerDeck();
    target.value = String(deck);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    closeDeckPicker();
  }

  function updateEligibility() {
    currentPool = experiencePoolFor();
    const entries = new Set(currentPool.map(item => item.wordId)).size;
    const experiences = currentPool.length;
    const box = $('study-eligibility');
    if (!experiences) {
      box.innerHTML = coverageMode === 'situations'
        ? '<strong>No safe saved situations here</strong><span>Try All eligible cards, another source, or add Situation metadata.</span>'
        : '<strong>No eligible card material here</strong><span>Try another source or deck.</span>';
      $('study-start').disabled = true;
      $('study-start').textContent = 'Start Experience';
      syncStandardSessionSizePreferenceUI();
      return;
    }
    const savedSituations = currentPool.filter(item => item.kind === 'situation').length;
    const cardCues = experiences - savedSituations;
    const requested = Math.max(1, Number($('study-session-size').value) || 10);
    const sessionLength = Math.min(entries, requested);
    let detail = '';
    if (coverageMode === 'situations') detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'} available · one target appears once per session`;
    else if (savedSituations && cardCues) detail = `${savedSituations} saved situations + ${cardCues} card-based cues · one target appears once per session`;
    else if (savedSituations) detail = `${savedSituations} saved ${savedSituations === 1 ? 'situation' : 'situations'} · one target appears once per session`;
    else detail = `${cardCues} card-based ${cardCues === 1 ? 'cue' : 'cues'} · one target appears once per session`;
    box.innerHTML = `<strong>${entries} eligible ${entries === 1 ? 'entry' : 'entries'} · ${sessionLength} this session</strong><span>${detail}</span>`;
    $('study-start').disabled = false;
    $('study-start').textContent = `Start ${standardSessionSizeText(sessionLength)}`;
    syncStandardSessionSizePreferenceUI();
  }

  function setSourceMode(mode) {
    const allowed = ['review', 'deck', 'range'];
    if (temporaryStudySet?.items?.length) allowed.push('study-set');
    sourceMode = allowed.includes(mode) ? mode : 'review';
    document.querySelectorAll('[data-source-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.sourceMode === sourceMode));
    document.querySelectorAll('[data-source-config]').forEach(block => { block.hidden = block.dataset.sourceConfig !== sourceMode; });
    updateEligibility();
  }

  function setCoverageMode(mode) {
    coverageMode = mode === 'situations' ? 'situations' : 'all';
    document.querySelectorAll('[data-coverage-mode]').forEach(button => {
      const active = button.dataset.coverageMode === coverageMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    updateEligibility();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function reviewRank(item) {
    return ({ high: 0, medium: 1, light: 2, '': 3 })[clean(item?.review?.reviewLevel).toLowerCase()] ?? 3;
  }

  function buildQueue(pool, size, mode) {
    const groups = new Map();
    pool.forEach(item => {
      if (!groups.has(item.wordId)) groups.set(item.wordId, []);
      groups.get(item.wordId).push(item);
    });
    let groupEntries = shuffle(Array.from(groups.entries()));
    if (mode === 'review') groupEntries.sort((a, b) => reviewRank(a[1][0]) - reviewRank(b[1][0]));
    return groupEntries
      .slice(0, Math.max(1, size))
      .map(([, items]) => shuffle(items)[0])
      .filter(Boolean);
  }

  function normalizeAnswer(value) {
    return stripInvisible(clean(value)).normalize('NFKC').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizedContains(haystack, needle) {
    const text = normalizeAnswer(haystack);
    const target = normalizeAnswer(needle);
    return Boolean(text && target && (` ${text} `).includes(` ${target} `));
  }

  function editDistance(a, b) {
    const left = String(a || ''), right = String(b || '');
    if (!left) return right.length;
    if (!right) return left.length;
    const row = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const old = row[j];
        row[j] = left[i - 1] === right[j - 1]
          ? previous
          : Math.min(previous + 1, row[j] + 1, row[j - 1] + 1);
        previous = old;
      }
    }
    return row[right.length];
  }

  function responseMatch(item, answerValue = $('study-response').value) {
    const answer = clean(answerValue);
    if (!answer) return { kind: 'blank', alternative: '', matchedTarget: '' };
    const preferred = clean(item.targetProfile?.practiceTarget || item.answerTarget || item.row?.Word);
    const candidates = targetAnswerVariants(item);
    const exact = candidates.find(candidate => normalizeAnswer(answer) === normalizeAnswer(candidate));
    if (exact) return { kind: 'target-exact', alternative: '', matchedTarget: exact };
    const contained = candidates.find(candidate => normalizedContains(answer, candidate));
    if (contained) return { kind: 'target-contained', alternative: '', matchedTarget: contained };
    const matchedAlternative = relevantAlternatives(item).find(alt => normalizedContains(answer, alt.expression));
    if (matchedAlternative) return { kind: 'alternative', alternative: clean(matchedAlternative.expression), matchedTarget: '' };
    const normalizedTarget = normalizeAnswer(preferred);
    if (/^[a-z][a-z'-]{3,}$/.test(normalizedTarget)) {
      const closeToken = normalizeAnswer(answer).split(/\s+/).find(token => Math.abs(token.length - normalizedTarget.length) <= 1 && editDistance(token, normalizedTarget) <= 1);
      if (closeToken) return { kind: 'near-target', alternative: '', matchedTarget: preferred };
    }
    return { kind: 'other', alternative: '', matchedTarget: '' };
  }

  function makeEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `studyq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readStudyEvents() {
    try {
      const value = JSON.parse(localStorage.getItem(STUDYQ_EVENT_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function readStudySessions() {
    try {
      const value = JSON.parse(localStorage.getItem(STUDYQ_SESSION_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
    } catch { return []; }
  }

  function writeStudySessions(sessions) {
    try {
      localStorage.setItem(STUDYQ_SESSION_KEY, JSON.stringify(sessions.slice(-STUDYQ_SESSION_LIMIT)));
    } catch (error) {
      console.warn('Could not save Study Q session history', error);
    }
  }

  function ratingCounts(attempts = sessionAttempts) {
    const counts = { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0, unrated: 0 };
    attempts.forEach(attempt => {
      const rating = clean(attempt?.selfRating);
      if (rating && Object.prototype.hasOwnProperty.call(counts, rating)) counts[rating]++;
      else counts.unrated++;
    });
    return counts;
  }

  function compactAttempt(attempt = {}) {
    return {
      eventId: clean(attempt.eventId),
      wordId: clean(attempt.wordId),
      batch: Number(attempt.batch) || 0,
      target: clean(attempt.target),
      cardHeadword: clean(attempt.cardHeadword),
      promptKind: clean(attempt.promptKind),
      responseText: clean(attempt.responseText),
      autoMatch: clean(attempt.autoMatch),
      matchedAlternative: clean(attempt.matchedAlternative),
      matchedTarget: clean(attempt.matchedTarget),
      selfRating: clean(attempt.selfRating),
      communicativeNeedShown: attempt.communicativeNeedShown === true,
      hintShown: attempt.hintShown === true,
      hintCount: Number(attempt.hintCount) || 0,
      hintTypes: Array.isArray(attempt.hintTypes) ? attempt.hintTypes.map(clean).filter(Boolean) : [],
      targetShown: attempt.targetShown === true,
      elapsedMs: Number(attempt.elapsedMs) || 0
    };
  }

  function compactExperience(item, attempt) {
    return {
      wordId: clean(item.wordId),
      batch: Number(item.row?.['Batch #']) || 0,
      cardHeadword: clean(item.row?.Word),
      answerTarget: clean(item.answerTarget || item.targetProfile?.practiceTarget || item.row?.Word),
      targetKind: clean(item.targetProfile?.kind),
      promptKind: clean(item.kind),
      promptLabel: clean(item.promptLabel),
      promptTitle: clean(item.promptTitle),
      promptText: clean(item.promptText).slice(0, 900),
      question: clean(item.question),
      attempt: compactAttempt(attempt)
    };
  }

  function attemptHasActivity(attempt) {
    if (!attempt || typeof attempt !== 'object') return false;
    return Boolean(
      clean(attempt.responseText) ||
      attempt.communicativeNeedShown ||
      Number(attempt.hintCount) > 0 ||
      attempt.targetShown ||
      clean(attempt.selfRating)
    );
  }

  function attemptedSessionSlices() {
    const queue = [];
    const attempts = [];
    sessionQueue.forEach((item, index) => {
      const attempt = sessionAttempts[index];
      if (!attemptHasActivity(attempt)) return;
      queue.push(item);
      attempts.push(attempt);
    });
    return { queue, attempts };
  }

  function sessionTimestampValue(session) {
    return new Date(session?.completedAt || session?.endedAt || session?.startedAt || 0).getTime() || 0;
  }


  function validStudyRating(value) {
    return ['got-it', 'almost', 'not-yet', 'no-idea'].includes(clean(value));
  }

  function latestSavedAttemptForWord(wordId, sessions = readStudySessions()) {
    const target = clean(wordId);
    if (!target) return null;
    const ordered = (Array.isArray(sessions) ? sessions.slice() : [])
      .sort((a, b) => sessionTimestampValue(b) - sessionTimestampValue(a));
    for (const session of ordered) {
      const experience = Array.isArray(session?.experiences)
        ? session.experiences.find(item => clean(item?.wordId) === target)
        : null;
      if (experience) return { session, experience, attempt: experience.attempt || {} };
    }
    return null;
  }

  function historyRatingEditPolicy(sessionId, wordId, attempt, sessions = readStudySessions()) {
    const rating = clean(attempt?.selfRating);
    const eventId = clean(attempt?.eventId);
    if (!eventId) return { editable: false, reason: 'missing-event' };
    if (!rating) return { editable: true, reason: 'unrated' };
    if (eventId && historyRatingEditGrace.has(eventId)) return { editable: true, reason: 'filled-this-view' };
    const latest = latestSavedAttemptForWord(wordId, sessions);
    const editable = Boolean(
      latest &&
      clean(latest.session?.sessionId) === clean(sessionId) &&
      clean(latest.attempt?.eventId) === eventId
    );
    return { editable, reason: editable ? 'latest' : 'older-rated' };
  }

  function updateSavedSessionRating(sessionId, eventId, rating) {
    if (!validStudyRating(rating)) return { ok: false, reason: 'invalid-rating' };
    const sessions = readStudySessions();
    const sessionIndexSaved = sessions.findIndex(item => clean(item?.sessionId) === clean(sessionId));
    if (sessionIndexSaved < 0) return { ok: false, reason: 'session-not-found' };
    const record = sessions[sessionIndexSaved];
    const experience = Array.isArray(record.experiences)
      ? record.experiences.find(item => clean(item?.attempt?.eventId) === clean(eventId))
      : null;
    if (!experience) return { ok: false, reason: 'attempt-not-found' };
    const attempt = experience.attempt || (experience.attempt = {});
    const policy = historyRatingEditPolicy(record.sessionId, experience.wordId, attempt, sessions);
    if (!policy.editable) return { ok: false, reason: policy.reason };

    const wasUnrated = !clean(attempt.selfRating);
    attempt.selfRating = rating;
    if (wasUnrated && clean(eventId)) historyRatingEditGrace.add(clean(eventId));
    record.counts = ratingCounts(record.experiences.map(item => item?.attempt || {}));
    sessions[sessionIndexSaved] = record;
    writeStudySessions(sessions);

    try {
      const events = readStudyEvents();
      const eventIndex = events.findIndex(item => clean(item?.eventId) === clean(eventId));
      if (eventIndex >= 0) {
        events[eventIndex] = { ...events[eventIndex], selfRating: rating, ratingUpdatedAt: new Date().toISOString() };
        localStorage.setItem(STUDYQ_EVENT_KEY, JSON.stringify(events.slice(-STUDYQ_EVENT_LIMIT)));
      }
    } catch (error) {
      console.warn('Could not update Study Q activity rating', error);
    }

    const liveIndex = sessionAttempts.findIndex(item => clean(item?.eventId) === clean(eventId));
    if (liveIndex >= 0) sessionAttempts[liveIndex].selfRating = rating;
    if (clean(currentAttempt?.eventId) === clean(eventId)) currentAttempt.selfRating = rating;
    historyRatingNotice.set(clean(eventId), 'Rating saved in Standard Practice history. Review attention is unchanged for now.');
    return { ok: true, reason: policy.reason, record };
  }

  function refreshOpenSessionSummary() {
    const record = readStudySessions().find(item => clean(item?.sessionId) === clean(currentSessionId));
    if (!record) return;
    const summary = sessionRatingSummary(record.counts || ratingCounts(sessionAttempts));
    $('study-finished-summary').hidden = false;
    setNumericEmphasis($('study-finished-summary'), `${summary || 'No self-check ratings'} · ${Number(record.hintCount) || 0} hints used · saved on this device.`);
  }

  function persistCurrentSession({ status = 'completed', queue = sessionQueue, attempts = sessionAttempts, plannedCount = currentSessionPlannedCount || sessionQueue.length } = {}) {
    if (!currentSessionId || !queue.length || viewingSavedSession) return null;
    const now = new Date().toISOString();
    const counts = ratingCounts(attempts);
    const decks = Array.from(new Set(queue.map(item => Number(item.row?.['Batch #']) || 0).filter(Boolean)));
    const hintCount = attempts.reduce((sum, attempt) => sum + (Number(attempt?.hintCount) || 0), 0);
    const elapsedMs = attempts.reduce((sum, attempt) => sum + (Number(attempt?.elapsedMs) || 0), 0);
    const isComplete = status === 'completed';
    const record = {
      schemaVersion: 2,
      sessionId: currentSessionId,
      status,
      startedAt: currentSessionStartedAt || now,
      completedAt: isComplete ? now : '',
      endedAt: isComplete ? '' : now,
      sourceMode: lastSessionSpec?.mode || sourceMode,
      sourceLabel: sourceLabel(lastSessionSpec?.mode || sourceMode),
      coverageMode: lastSessionSpec?.coverage || coverageMode,
      spec: lastSessionSpec ? { ...lastSessionSpec } : null,
      experienceCount: queue.length,
      plannedExperienceCount: Math.max(queue.length, Number(plannedCount) || queue.length),
      wordIds: queue.map(item => clean(item.wordId)).filter(Boolean),
      decks,
      counts,
      hintCount,
      elapsedMs,
      experiences: queue.map((item, index) => compactExperience(item, attempts[index] || {}))
    };
    const sessions = readStudySessions();
    const index = sessions.findIndex(item => item?.sessionId === currentSessionId);
    if (index >= 0) sessions[index] = record;
    else sessions.push(record);
    writeStudySessions(sessions);
    return record;
  }

  function formatSessionWhen(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function setNumericEmphasis(element, text) {
    if (!element) return;
    element.replaceChildren();
    String(text || '').split(/(\d+)/).forEach(part => {
      if (!part) return;
      if (/^\d+$/.test(part)) {
        const strong = document.createElement('strong');
        strong.className = 'study-summary-number';
        strong.textContent = part;
        element.append(strong);
      } else {
        element.append(document.createTextNode(part));
      }
    });
  }

  function sessionRatingSummary(counts = {}) {
    const parts = [];
    if (counts['got-it']) parts.push(`${counts['got-it']} Got it`);
    if (counts.almost) parts.push(`${counts.almost} Almost`);
    if (counts['not-yet']) parts.push(`${counts['not-yet']} Not yet`);
    if (counts['no-idea']) parts.push(`${counts['no-idea']} No idea`);
    if (counts.unrated) parts.push(`${counts.unrated} not rated`);
    return parts.join(' · ');
  }

  function renderRecentSessions() {
    const section = $('study-history');
    const list = $('study-history-list');
    if (!section || !list) return;
    const sessions = readStudySessions().sort((a, b) => sessionTimestampValue(b) - sessionTimestampValue(a)).slice(0, 5);
    list.replaceChildren();
    section.hidden = !sessions.length;
    sessions.forEach(session => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'study-history-item';
      button.dataset.studyqSessionId = clean(session.sessionId);
      const top = document.createElement('span');
      top.className = 'study-history-item-top';
      const source = document.createElement('strong');
      source.textContent = clean(session.sourceLabel) || 'Study Q';
      const when = document.createElement('time');
      when.textContent = formatSessionWhen(session.completedAt || session.endedAt || session.startedAt);
      top.append(source, when);
      const meta = document.createElement('small');
      const ratings = sessionRatingSummary(session.counts || {});
      const count = Number(session.experienceCount) || session.experiences?.length || 0;
      const planned = Number(session.plannedExperienceCount) || count;
      const status = clean(session.status);
      const statusText = status === 'ended-early' ? `Ended early · ${count}/${planned}` : status === 'incomplete' ? `Left early · ${count}/${planned}` : `${count} experiences`;
      setNumericEmphasis(meta, `${statusText}${ratings ? ` · ${ratings}` : ''}`);
      button.append(top, meta);
      list.append(button);
    });
  }

  function itemFromSavedExperience(snapshot) {
    const wordId = clean(snapshot?.wordId);
    const row = rowByWordId.get(wordId) || {
      WordID: wordId,
      'Batch #': Number(snapshot?.batch) || 0,
      Word: clean(snapshot?.cardHeadword || snapshot?.answerTarget)
    };
    const meta = metadataFor(wordId) || {};
    const profile = targetProfile(row);
    return {
      ...baseExperience(row, meta, reviewByWordId.get(wordId) || null),
      kind: clean(snapshot?.promptKind) || 'history',
      promptLabel: clean(snapshot?.promptLabel) || 'Experience',
      promptTitle: clean(snapshot?.promptTitle),
      promptText: clean(snapshot?.promptText),
      question: clean(snapshot?.question),
      answerTarget: clean(snapshot?.answerTarget) || profile.displayTarget || profile.practiceTarget || clean(row.Word),
      acceptedAnswers: profile.accepted || [],
      targetProfile: profile,
      communicativeNeed: ''
    };
  }

  function showSavedSession(sessionId) {
    historyRatingEditGrace.clear();
    historyRatingNotice.clear();
    const record = readStudySessions().find(item => clean(item?.sessionId) === clean(sessionId));
    if (!record || !Array.isArray(record.experiences)) return false;
    viewingSavedSession = true;
    currentSessionId = clean(record.sessionId);
    currentSessionStartedAt = clean(record.startedAt);
    lastSessionSpec = record.spec && typeof record.spec === 'object' ? { ...record.spec } : null;
    sessionQueue = record.experiences.map(itemFromSavedExperience);
    currentSessionPlannedCount = Number(record.plannedExperienceCount) || sessionQueue.length;
    sessionAttempts = record.experiences.map(experience => ({ ...experience.attempt, _elapsedBaseMs: Number(experience.attempt?.elapsedMs) || 0, _visitStartedMs: Date.now() }));
    sessionIndex = Math.max(0, sessionQueue.length - 1);
    currentAttempt = sessionAttempts[sessionIndex] || null;
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = false;
    const savedStatus = clean(record.status);
    const savedCount = Number(record.experienceCount) || sessionQueue.length;
    const savedPlanned = Number(record.plannedExperienceCount) || savedCount;
    $('study-finished').querySelector('h2').textContent = savedStatus === 'completed' || !savedStatus ? 'You finished this set.' : 'Saved partial session.';
    $('study-finished-copy').textContent = `Saved session · ${clean(record.sourceLabel) || 'Study Q'} · ${formatSessionWhen(record.completedAt || record.endedAt || record.startedAt)}${savedStatus && savedStatus !== 'completed' ? ` · ${savedCount}/${savedPlanned} experiences` : ''}.`;
    const summary = sessionRatingSummary(record.counts || ratingCounts(sessionAttempts));
    $('study-finished-summary').hidden = false;
    setNumericEmphasis($('study-finished-summary'), `${summary || 'No self-check ratings'} · ${Number(record.hintCount) || 0} hints used · saved on this device.`);
    renderFinishedDeckLinks();
    renderSessionReview();
    $('study-finished').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function persistAttempt(attempt, completed = false) {
    if (!attempt) return;
    try {
      const now = new Date().toISOString();
      attempt.updatedAt = now;
      if (completed && !attempt.completedAt) attempt.completedAt = now;
      const serializable = { ...attempt };
      delete serializable._startedMs;
      delete serializable._elapsedBaseMs;
      delete serializable._visitStartedMs;
      const events = readStudyEvents();
      const index = events.findIndex(event => event?.eventId === serializable.eventId);
      if (index >= 0) events[index] = serializable;
      else events.push(serializable);
      localStorage.setItem(STUDYQ_EVENT_KEY, JSON.stringify(events.slice(-STUDYQ_EVENT_LIMIT)));
    } catch (error) {
      console.warn('Could not save Study Q activity', error);
    }
  }

  function beginAttempt(item) {
    const now = new Date().toISOString();
    currentAttempt = {
      schemaVersion: 1,
      eventId: makeEventId(),
      startedAt: now,
      updatedAt: now,
      completedAt: '',
      wordId: item.wordId,
      batch: Number(item.row?.['Batch #']) || 0,
      target: clean(item.answerTarget || item.targetProfile?.practiceTarget || item.row?.Word),
      cardHeadword: clean(item.row?.Word),
      targetKind: clean(item.targetProfile?.kind),
      sessionId: currentSessionId,
      entryType: clean(item.meta?.entryType),
      sourceMode: lastSessionSpec?.mode || sourceMode,
      sourceLabel: sourceLabel(lastSessionSpec?.mode || sourceMode),
      coverageMode: lastSessionSpec?.coverage || coverageMode,
      promptKind: item.kind,
      situationId: clean(item.situation?.situationId),
      communicativeNeedShown: false,
      hintShown: false,
      hintCount: 0,
      hintTypes: [],
      targetShown: false,
      responseText: '',
      autoMatch: 'blank',
      matchedAlternative: '',
      selfRating: '',
      elapsedMs: 0,
      _elapsedBaseMs: 0,
      _visitStartedMs: Date.now()
    };
    sessionAttempts[sessionIndex] = currentAttempt;
  }

  function activateAttempt(item) {
    const existing = sessionAttempts[sessionIndex];
    if (!existing) {
      beginAttempt(item);
      return currentAttempt;
    }
    currentAttempt = existing;
    currentAttempt._elapsedBaseMs = Number(currentAttempt.elapsedMs) || 0;
    currentAttempt._visitStartedMs = Date.now();
    if (!Number.isFinite(Number(currentAttempt.hintCount))) currentAttempt.hintCount = currentAttempt.hintShown ? 1 : 0;
    if (!Array.isArray(currentAttempt.hintTypes)) currentAttempt.hintTypes = [];
    return currentAttempt;
  }

  function snapshotResponse(item) {
    if (!currentAttempt || !item) return;
    const answer = clean($('study-response').value).slice(0, 800);
    const match = responseMatch(item, answer);
    currentAttempt.responseText = answer;
    currentAttempt.autoMatch = match.kind;
    currentAttempt.matchedAlternative = match.alternative || '';
    currentAttempt.matchedTarget = match.matchedTarget || '';
    currentAttempt.elapsedMs = Math.max(0, (Number(currentAttempt._elapsedBaseMs) || 0) + Date.now() - (currentAttempt._visitStartedMs || Date.now()));
  }

  function setSelfRating(rating) {
    if (!currentAttempt || !['got-it', 'almost', 'not-yet', 'no-idea'].includes(rating)) return;
    const item = sessionQueue[sessionIndex];
    if (item) { snapshotResponse(item); renderCurrentAnswerReview(item); }
    currentAttempt.selfRating = rating;
    currentAttempt.elapsedMs = Math.max(0, (Number(currentAttempt._elapsedBaseMs) || 0) + Date.now() - (currentAttempt._visitStartedMs || Date.now()));
    document.querySelectorAll('[data-study-rating]').forEach(button => {
      const selected = button.dataset.studyRating === rating;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    const labels = { 'got-it': 'Got it', almost: 'Almost', 'not-yet': 'Not yet', 'no-idea': 'No idea' };
    $('study-self-check-status').textContent = `Saved locally · self-check: ${labels[rating]}.`;
    persistAttempt(currentAttempt, false);
  }

  function finalizeCurrentAttempt() {
    const item = sessionQueue[sessionIndex];
    if (!currentAttempt || !item) return;
    snapshotResponse(item);
    currentAttempt.elapsedMs = Math.max(0, (Number(currentAttempt._elapsedBaseMs) || 0) + Date.now() - (currentAttempt._visitStartedMs || Date.now()));
    persistAttempt(currentAttempt, true);
  }

  function formHintFor(item) {
    const profile = item.targetProfile || targetProfile(item.row || '');
    const entryTypeRaw = clean(item.meta?.entryType);
    const entryType = entryTypeRaw === 'conversational frame' ? 'conversational frame' : entryTypeRaw;
    const pos = clean(item.row?.['Part of Speech']);
    const practice = clean(item.answerTarget || profile.practiceTarget);
    const count = practice.split(/\s+/).filter(Boolean).length;
    const countLabel = count === 1 ? 'one word' : (count > 1 ? `${count}-word expression` : '');
    const bits = [];

    if (profile.kind === 'contrast') {
      if (countLabel) bits.push(countLabel);
      bits.push('one side of a contrast card');
    } else if (profile.kind === 'family') {
      const normalizedPractice = normalizeAnswer(practice);
      const exactPart = (profile.parts || []).find(part => normalizeAnswer(part.clean) === normalizedPractice);
      const derivedPart = exactPart || (profile.parts || []).find(part => {
        const root = normalizeAnswer(part.clean);
        return root && normalizedPractice.startsWith(root) && part.pos;
      });
      if (derivedPart?.pos) bits.push(derivedPart.pos);
      else {
        const slashPos = pos.split(/\s*\/\s*/).map(clean).filter(Boolean);
        if (slashPos.length > 1) bits.push(`form family: ${slashPos.join(' / ')}`);
        else if (entryType) bits.push(entryType);
        else bits.push('related form family');
      }
      if (countLabel) bits.push(countLabel);
    } else if (profile.kind === 'construction') {
      if (entryType) bits.push(entryType);
      else if (pos) bits.push(pos);
      if (profile.patternDisplay) bits.push(`pattern: ${profile.patternDisplay}`);
    } else if (profile.kind === 'labeled') {
      if (countLabel) bits.push(countLabel);
    } else {
      if (entryType) bits.push(entryType);
      if (pos && normalizeAnswer(pos) !== normalizeAnswer(entryType) && !/contrast/i.test(pos)) bits.push(pos);
      if (countLabel) bits.push(countLabel);
    }
    return bits.length ? `Form: ${Array.from(new Set(bits)).join(' · ')}.` : '';
  }

  function hintStepsFor(item) {
    const profile = item.targetProfile || targetProfile(item.row || '');
    const hints = [];
    const seen = new Set();
    const add = (type, text) => {
      const value = clean(text);
      const key = normalizeAnswer(value);
      if (!value || !key || seen.has(key)) return;
      seen.add(key);
      hints.push({ type, text: value });
    };

    const synonyms = safePrompt(item.row?.['Synonym(s)'], profile).text;
    if (meaningfulPrompt(synonyms)) add('related', `Related expression(s): ${synonyms}`);

    add('form', formHintFor(item));

    if (item.kind !== 'example') {
      const example = splitExamples(item.row?.['Example Sentence'])
        .map(value => ({ value, safe: safePrompt(value, profile) }))
        .find(entry => entry.safe.changed && meaningfulPrompt(entry.safe.text));
      if (example) add('example', `Example frame: ${example.safe.text}`);
    }

    const firstTarget = clean(profile.practiceTarget || item.answerTarget || profile.raw);
    const first = Array.from(firstTarget.trim())[0] || '';
    if (first) add('first-letter', `Starts with “${first}”.`);

    const sense = safePrompt(item.meta?.senseHook, profile).text;
    if (meaningfulPrompt(sense)) add('sense-hook', `Sense hook: ${sense}`);

    return hints;
  }

  function renderHintState(item) {
    const hints = hintStepsFor(item);
    const count = Math.max(0, Math.min(Number(currentAttempt?.hintCount) || 0, hints.length));
    $('study-hint-list').replaceChildren();
    hints.slice(0, count).forEach((hint, index) => {
      const row = document.createElement('div');
      row.className = 'study-hint-item';
      const label = document.createElement('b');
      label.textContent = `Hint ${index + 1}`;
      const copy = document.createElement('p');
      copy.textContent = hint.text;
      row.append(label, copy);
      $('study-hint-list').append(row);
    });
    $('study-hint-block').hidden = count === 0;
    $('study-show-hint').hidden = hints.length === 0;
    $('study-show-hint').disabled = Boolean(hints.length && count >= hints.length);
    $('study-show-hint').textContent = count === 0 ? 'Give me a hint' : (count < hints.length ? 'Give me another hint' : 'No more hints');
  }

  function showNextHint() {
    const item = sessionQueue[sessionIndex];
    if (!item || !currentAttempt) return;
    const hints = hintStepsFor(item);
    const current = Math.max(0, Number(currentAttempt.hintCount) || 0);
    if (!hints.length || current >= hints.length) return;
    const next = current + 1;
    currentAttempt.hintShown = true;
    currentAttempt.hintCount = next;
    currentAttempt.hintTypes = hints.slice(0, next).map(hint => hint.type);
    currentAttempt.hintShownAt = new Date().toISOString();
    renderHintState(item);
    persistAttempt(currentAttempt, false);
    $('study-hint-block').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function relevantAlternatives(item) {
    const situationId = clean(item.situation?.situationId);
    return (item.alternatives || []).filter(alt => {
      const ids = Array.isArray(alt?.situationIds) ? alt.situationIds.map(clean).filter(Boolean) : [];
      return clean(alt?.expression) && (!ids.length || (situationId && ids.includes(situationId)));
    });
  }

  function responseNote(item) {
    const match = responseMatch(item);
    if (match.kind === 'blank') return 'No typed response to compare. You can still self-check based on what you said or thought.';
    if (match.kind === 'target-exact') return 'Matches the stored WLP target — exact form.';
    if (match.kind === 'target-contained') return 'Your response includes the stored WLP target.';
    if (match.kind === 'alternative') return `Matches a linked natural alternative: ${match.alternative}.`;
    if (match.kind === 'near-target') return 'Very close to the stored WLP target form. You decide whether this counts for you.';
    return 'Different from the stored WLP target. Compare them, then make your own self-check.';
  }

  function selfCheckGuidance(item) {
    const match = responseMatch(item);
    if (match.kind === 'target-exact') return { exact: true, text: 'You got it — exact WLP target match. Still choose the rating that reflects how independently it came to you.' };
    if (match.kind === 'target-contained') return { exact: true, text: 'Your response includes the stored WLP target. Nice — still rate how independently it came to you.' };
    if (match.kind === 'alternative') return { exact: true, text: 'That matches a linked natural alternative. Nice — rate how solid it felt for you.' };
    if (match.kind === 'near-target') return { exact: false, text: 'Very close to the stored target form. You decide whether that feels like Almost, Got it, or something else.' };
    if (match.kind === 'other') return { exact: false, text: 'Different from the stored WLP target. Compare them, then rate what happened for you.' };
    return { exact: false, text: 'You decide. A hint, a small spelling slip, or a natural alternative does not have to become an automatic fail.' };
  }

  function updateSelfCheckGuidance(item) {
    const copy = $('study-self-check-guidance');
    const box = $('study-self-check');
    if (!copy || !box) return;
    if (!currentAttempt?.targetShown) {
      copy.textContent = 'You decide. A hint, a small spelling slip, or a natural alternative does not have to become an automatic fail.';
      box.classList.remove('is-exact');
      return;
    }
    const guidance = selfCheckGuidance(item);
    if (responseMatch(item).kind === 'target-exact') {
      copy.replaceChildren();
      const lead = document.createElement('strong');
      lead.className = 'study-match-lead';
      lead.textContent = '✓ You got it!';
      copy.append(lead, document.createTextNode(' — exact WLP target match. Still choose the rating that reflects how independently it came to you.'));
    } else {
      copy.textContent = guidance.text;
    }
    box.classList.toggle('is-exact', guidance.exact);
  }

  function renderExperience() {
    stopStudyVoice();
    const item = sessionQueue[sessionIndex];
    if (!item) return finishSession();
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = true;
    $('study-experience').hidden = false;
    $('study-experience-source').textContent = sourceLabel(lastSessionSpec?.mode || sourceMode);
    $('study-experience-progress').textContent = `${sessionIndex + 1} / ${sessionQueue.length}`;
    $('study-previous').hidden = sessionIndex <= 0;

    $('study-prompt-label').textContent = item.promptLabel || 'Situation';
    const title = clean(item.promptTitle);
    $('study-situation-title').hidden = !title;
    $('study-situation-title').textContent = title;
    $('study-situation-anchor').textContent = clean(item.promptText);
    $('study-response-question').textContent = item.question || 'What might you naturally say?';
    $('study-response-help').textContent = item.responseHelp || 'Multiple answers can be natural.';

    const attempt = activateAttempt(item);
    $('study-response').value = clean(attempt?.responseText);

    const need = clean(item.communicativeNeed);
    $('study-show-need').hidden = !need;
    $('study-need').textContent = need;
    $('study-need-block').hidden = !(need && attempt?.communicativeNeedShown);
    renderHintState(item);

    $('study-target').textContent = clean(item.answerTarget || item.targetProfile?.practiceTarget || item.row?.Word) || `WID ${item.wordId}`;
    const entryType = clean(item.meta?.entryType);
    $('study-target-type').hidden = !entryType;
    $('study-target-type').textContent = entryType ? `type: ${entryType === 'conversational frame' ? 'conv. frame' : entryType}` : '';
    $('study-response-note').hidden = true;
    $('study-response-note').textContent = '';
    $('study-answer-review').hidden = true;
    $('study-answer-text').textContent = '';
    $('study-answer-review-action').replaceChildren();

    document.querySelectorAll('[data-study-rating]').forEach(button => {
      const selected = button.dataset.studyRating === clean(attempt?.selfRating);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $('study-self-check-status').textContent = attempt?.selfRating
      ? `Saved locally · self-check: ${ratingLabel(attempt.selfRating)}.`
      : 'Not rated yet · activity is still saved locally.';

    $('study-open-card').dataset.wordId = item.wordId;
    $('study-next').textContent = sessionIndex === sessionQueue.length - 1 ? 'Finish Session' : 'Next Experience';

    const alternatives = relevantAlternatives(item);
    $('study-alternatives').hidden = !alternatives.length;
    $('study-alternative-list').innerHTML = alternatives.map(alt => {
      const note = clean(alt.note);
      return `<div class="study-alternative-item"><strong>${escapeHtml(alt.expression)}</strong>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div>`;
    }).join('');

    const targetShown = Boolean(attempt?.targetShown);
    $('study-target-reveal').hidden = !targetShown;
    if (targetShown) {
      const note = responseNote(item);
      $('study-response-note').hidden = !note;
      $('study-response-note').textContent = note;
      renderCurrentAnswerReview(item);
    }
    updateSelfCheckGuidance(item);

    $('study-experience').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }


  function padDeck(value) {
    return String(Math.max(0, Number(value) || 0)).padStart(3, '0');
  }

  function cardHrefForRow(row) {
    const deck = Number(row?.['Batch #']) || 0;
    const wordId = clean(row?.WordID);
    return deck && wordId
      ? `./flashcards/wlp/batch.html?batch=${encodeURIComponent(padDeck(deck))}&wordid=${encodeURIComponent(wordId)}&solo=1`
      : './deck-browser.html';
  }

  function exactHeadwordRows(answer) {
    const normalized = normalizeAnswer(answer);
    if (!normalized) return [];
    return rows.filter(row => {
      const profile = targetProfile(row);
      return normalizeAnswer(row?.Word) === normalized || (profile.accepted || []).some(value => normalizeAnswer(value) === normalized);
    });
  }

  function searchHrefFor(answer) {
    const query = clean(answer);
    return `./global-search.html?q=${encodeURIComponent(query)}&return=${encodeURIComponent('study-hub.html')}`;
  }

  function deckHref(deck) {
    const value = Number(deck) || 0;
    return value ? `./flashcards/wlp/batch.html?batch=${encodeURIComponent(padDeck(value))}` : './deck-browser.html';
  }

  function renderFinishedDeckLinks() {
    const decks = [];
    const seen = new Set();
    sessionQueue.forEach(item => {
      const deck = Number(item.row?.['Batch #']) || 0;
      if (!deck || seen.has(deck)) return;
      seen.add(deck);
      decks.push(deck);
    });
    const holder = $('study-finished-deck-links');
    holder.replaceChildren();
    if (!decks.length) {
      $('study-finished-decks').hidden = true;
      return;
    }
    $('study-finished-decks').hidden = false;
    $('study-finished-decks-copy').textContent = decks.length === 1
      ? 'Go straight to the deck you just practiced.'
      : 'Open any deck that appeared in this session — no need to choose it again.';
    decks.forEach((deck, index) => {
      const link = document.createElement('a');
      link.href = deckHref(deck);
      link.textContent = decks.length === 1 ? `Study WLP${padDeck(deck)}` : `WLP${padDeck(deck)}`;
      if (decks.length === 1 || index === 0) link.classList.add('is-primary');
      holder.append(link);
    });
  }

  function ratingLabel(rating) {
    return ({ 'got-it': 'Got it', almost: 'Almost', 'not-yet': 'Not yet', 'no-idea': 'No idea' })[rating] || 'Not rated';
  }

  function matchLabel(attempt) {
    const kind = clean(attempt?.autoMatch);
    if (kind === 'target-exact') return 'Matches target · exact form';
    if (kind === 'target-contained') return 'Includes the WLP target';
    if (kind === 'alternative') return attempt?.matchedAlternative ? `Linked alternative · ${attempt.matchedAlternative}` : 'Linked alternative';
    if (kind === 'near-target') return 'Very close to target form';
    if (kind === 'other') return 'Different from stored target';
    return 'No typed answer';
  }

  function appendAnswerAction(container, answer, compact = false) {
    container.replaceChildren();
    const value = clean(answer);
    if (!value) return;
    const matches = exactHeadwordRows(value);
    if (matches.length === 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.quickCardWordId = clean(matches[0].WordID);
      button.textContent = compact ? 'Open answer card' : 'Check answer card';
      container.append(button);
      return;
    }
    const link = document.createElement('a');
    link.href = searchHrefFor(value);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = matches.length > 1 ? 'Search matching cards ↗' : 'Search WLP ↗';
    container.append(link);
  }

  function renderCurrentAnswerReview(item) {
    const answer = clean($('study-response').value);
    if (!answer) {
      $('study-answer-review').hidden = true;
      $('study-answer-text').textContent = '';
      $('study-answer-review-action').replaceChildren();
      return;
    }
    $('study-answer-review').hidden = false;
    $('study-answer-text').textContent = answer;
    appendAnswerAction($('study-answer-review-action'), answer);
  }

  function quickCardField(label, value) {
    const text = clean(value);
    if (!text) return null;
    const field = document.createElement('div');
    field.className = 'study-quick-card-field';
    const title = document.createElement('span');
    title.textContent = label;
    const copy = document.createElement('p');
    copy.textContent = text;
    field.append(title, copy);
    return field;
  }

  function openQuickCard(wordId) {
    const row = rowByWordId.get(clean(wordId));
    if (!row) return;
    const meta = metadataFor(clean(wordId)) || {};
    $('study-quick-card-title').textContent = clean(row.Word) || `WID ${wordId}`;
    const deck = Number(row['Batch #']) || 0;
    $('study-quick-card-location').textContent = `${deck ? `WLP${padDeck(deck)} · ` : ''}WID${clean(row.WordID)}`;
    const metaBits = [clean(row.IPA), clean(row['Part of Speech']), clean(meta.entryType) ? `type: ${meta.entryType}` : ''].filter(Boolean);
    $('study-quick-card-meta').textContent = metaBits.join(' · ');
    const fields = [
      quickCardField('Definition', row.Definition),
      quickCardField('Synonyms', row['Synonym(s)']),
      quickCardField('Example', row['Example Sentence']),
      quickCardField('Notes', row['Note(s)']),
      quickCardField('Sense Hook', meta.senseHook),
      quickCardField('Memory Hook', meta.memoryHook)
    ].filter(Boolean);
    $('study-quick-card-fields').replaceChildren(...fields);
    $('study-quick-card-full').href = cardHrefForRow(row);
    $('study-quick-card-modal').hidden = false;
    document.body.classList.add('study-quick-card-open');
    setTimeout(() => $('study-quick-card-close').focus({ preventScroll: true }), 0);
  }

  function closeQuickCard() {
    $('study-quick-card-modal').hidden = true;
    document.body.classList.remove('study-quick-card-open');
  }

  function buildSessionRatingEditor(item, attempt) {
    const policy = historyRatingEditPolicy(currentSessionId, item.wordId, attempt);
    if (!policy.editable) return null;
    const eventId = clean(attempt?.eventId);
    const wrap = document.createElement('div');
    wrap.className = 'study-session-rating-edit';
    const title = document.createElement('span');
    title.textContent = clean(attempt?.selfRating) ? 'Change rating' : 'Rate this attempt';
    const options = document.createElement('div');
    options.className = 'study-session-rating-edit-options';
    ['got-it', 'almost', 'not-yet', 'no-idea'].forEach(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.studyHistoryRating = value;
      button.dataset.studyqSessionId = currentSessionId;
      button.dataset.studyqEventId = eventId;
      button.textContent = ratingLabel(value);
      const selected = clean(attempt?.selfRating) === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      options.append(button);
    });
    const note = document.createElement('small');
    note.textContent = historyRatingNotice.get(eventId) || (
      policy.reason === 'unrated'
        ? 'This attempt was left unrated, so you can fill it in even if the session is older.'
        : policy.reason === 'filled-this-view'
          ? 'Saved. You can still adjust it while this session review stays open.'
          : 'This is the latest Standard Practice attempt for this card, so its rating can be corrected.'
    );
    wrap.append(title, options, note);
    return wrap;
  }

  function renderSessionReview() {
    const list = $('study-session-review-list');
    list.replaceChildren();
    sessionQueue.forEach((item, index) => {
      const attempt = sessionAttempts[index] || {};
      const article = document.createElement('article');
      article.className = 'study-session-review-item';

      const top = document.createElement('div');
      top.className = 'study-session-review-top';
      const idx = document.createElement('span');
      idx.className = 'study-session-review-index';
      idx.textContent = `${index + 1} · ${item.promptLabel || item.kind || 'Experience'}`;
      const rating = document.createElement('span');
      rating.className = 'study-session-review-rating';
      if (['got-it', 'almost', 'not-yet', 'no-idea'].includes(clean(attempt.selfRating))) {
        rating.classList.add(`is-${clean(attempt.selfRating)}`);
      }
      rating.textContent = ratingLabel(attempt.selfRating);
      top.append(idx, rating);

      const prompt = document.createElement('p');
      prompt.className = 'study-session-review-prompt';
      prompt.textContent = clean(item.promptText) || 'Prompt not available.';

      const target = document.createElement('div');
      target.className = 'study-session-review-target';
      const targetWord = document.createElement('strong');
      targetWord.textContent = clean(item.answerTarget || item.targetProfile?.practiceTarget || item.row?.Word) || `WID ${item.wordId}`;
      const targetButton = document.createElement('button');
      targetButton.type = 'button';
      targetButton.dataset.quickCardWordId = item.wordId;
      targetButton.textContent = 'Open Card';
      target.append(targetWord, targetButton);

      const answerBox = document.createElement('div');
      answerBox.className = 'study-session-review-answer';
      const answerLabel = document.createElement('span');
      answerLabel.textContent = 'Your answer';
      const answerRow = document.createElement('div');
      answerRow.className = 'study-session-review-answer-row';
      const answerText = document.createElement('p');
      answerText.textContent = clean(attempt.responseText) || '—';
      const answerActions = document.createElement('div');
      answerActions.className = 'study-session-review-answer-actions';
      appendAnswerAction(answerActions, attempt.responseText, true);
      answerRow.append(answerText, answerActions);
      const match = document.createElement('div');
      match.className = 'study-session-review-match';
      const hintCount = Number(attempt.hintCount) || 0;
      if (clean(attempt?.autoMatch) === 'target-exact') {
        const matched = document.createElement('strong');
        matched.className = 'study-session-review-match-hit';
        matched.textContent = '✓ Matches target';
        match.append(matched, document.createTextNode(` · exact form${hintCount ? ` · ${hintCount} hint${hintCount === 1 ? '' : 's'}` : ''}`));
      } else {
        match.textContent = `${matchLabel(attempt)}${hintCount ? ` · ${hintCount} hint${hintCount === 1 ? '' : 's'}` : ''}`;
      }
      answerBox.append(answerLabel, answerRow, match);

      article.append(top, prompt, target, answerBox);
      const ratingEditor = buildSessionRatingEditor(item, attempt);
      if (ratingEditor) article.append(ratingEditor);
      list.append(article);
    });
    $('study-session-review').hidden = !sessionQueue.length;
  }

  function showTarget() {
    const item = sessionQueue[sessionIndex];
    if (!item) return;
    if (currentAttempt?.targetShown) {
      $('study-target-reveal').hidden = false;
      $('study-target-reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    snapshotResponse(item);
    if (currentAttempt) {
      currentAttempt.targetShown = true;
      currentAttempt.targetShownAt = new Date().toISOString();
      persistAttempt(currentAttempt, false);
    }
    const note = responseNote(item);
    $('study-response-note').hidden = !note;
    $('study-response-note').textContent = note;
    renderCurrentAnswerReview(item);
    updateSelfCheckGuidance(item);
    $('study-target-reveal').hidden = false;
    $('study-target-reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function saveCurrentAttempt(completed = false) {
    const item = sessionQueue[sessionIndex];
    if (!currentAttempt || !item) return;
    snapshotResponse(item);
    currentAttempt.elapsedMs = Math.max(0, (Number(currentAttempt._elapsedBaseMs) || 0) + Date.now() - (currentAttempt._visitStartedMs || Date.now()));
    persistAttempt(currentAttempt, completed);
  }

  function previousExperience() {
    if (sessionIndex <= 0) return;
    saveCurrentAttempt(false);
    sessionIndex--;
    renderExperience();
  }

  function nextExperience() {
    saveCurrentAttempt(true);
    if (sessionIndex >= sessionQueue.length - 1) return finishSession(false);
    sessionIndex++;
    renderExperience();
  }

  function finishSession(finalize = true) {
    if (finalize) finalizeCurrentAttempt();
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = false;
    $('study-finished').querySelector('h2').textContent = 'You finished this set.';
    $('study-finished-copy').textContent = `You worked through ${sessionQueue.length} ${sessionQueue.length === 1 ? 'experience' : 'experiences'} from ${sourceLabel(lastSessionSpec?.mode || sourceMode)}.`;
    const counts = ratingCounts(sessionAttempts);
    const summary = sessionRatingSummary(counts);
    const record = persistCurrentSession({ status: 'completed' });
    $('study-finished-summary').hidden = false;
    setNumericEmphasis($('study-finished-summary'), `${summary || 'No self-check ratings'}${record ? ` · ${record.hintCount} hints used` : ''}. Saved on this device.`);
    renderFinishedDeckLinks();
    renderSessionReview();
    renderRecentSessions();
    $('study-finished').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEndSessionDialog() {
    const modal = $('study-end-session-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('study-end-session-open');
  }

  function openEndSessionDialog() {
    if (viewingSavedSession || !sessionQueue.length) return;
    const item = sessionQueue[sessionIndex];
    if (item && currentAttempt) snapshotResponse(item);
    const attempted = attemptedSessionSlices();
    const count = attempted.queue.length;
    const planned = currentSessionPlannedCount || sessionQueue.length;
    const copy = $('study-end-session-copy');
    if (copy) {
      copy.textContent = count
        ? `${count} of ${planned} experiences have activity. End now and save that work as a partial session?`
        : 'No experience has activity yet. You can end now without saving a session.';
    }
    const save = $('study-end-session-save');
    if (save) save.textContent = count ? `End & save ${count}/${planned}` : 'End session';
    $('study-end-session-modal').hidden = false;
    document.body.classList.add('study-end-session-open');
  }

  function endSessionEarly() {
    if (viewingSavedSession) return closeEndSessionDialog();
    const item = sessionQueue[sessionIndex];
    if (item && currentAttempt) {
      snapshotResponse(item);
      if (attemptHasActivity(currentAttempt)) persistAttempt(currentAttempt, true);
    }
    const attempted = attemptedSessionSlices();
    const planned = currentSessionPlannedCount || sessionQueue.length;
    closeEndSessionDialog();

    if (!attempted.queue.length) {
      $('study-experience').hidden = true;
      $('study-finished').hidden = true;
      $('study-start-panel').hidden = false;
      renderRecentSessions();
      document.querySelector('.study-hub-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    sessionQueue = attempted.queue;
    sessionAttempts = attempted.attempts;
    sessionIndex = Math.max(0, sessionQueue.length - 1);
    currentAttempt = sessionAttempts[sessionIndex] || null;
    const record = persistCurrentSession({ status: 'ended-early', queue: sessionQueue, attempts: sessionAttempts, plannedCount: planned });
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = true;
    $('study-finished').hidden = false;
    $('study-finished').querySelector('h2').textContent = 'Session ended.';
    $('study-finished-copy').textContent = `You worked through ${sessionQueue.length} of ${planned} experiences from ${sourceLabel(lastSessionSpec?.mode || sourceMode)}.`;
    const summary = sessionRatingSummary(ratingCounts(sessionAttempts));
    $('study-finished-summary').hidden = false;
    setNumericEmphasis($('study-finished-summary'), `${summary || 'No self-check ratings'}${record ? ` · ${record.hintCount} hints used` : ''}. Partial session saved on this device.`);
    renderFinishedDeckLinks();
    renderSessionReview();
    renderRecentSessions();
    $('study-finished').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function autosavePartialSessionOnLeave() {
    if (viewingSavedSession || !currentSessionId || !$('study-experience') || $('study-experience').hidden) return;
    const item = sessionQueue[sessionIndex];
    if (item && currentAttempt) {
      snapshotResponse(item);
      if (attemptHasActivity(currentAttempt)) persistAttempt(currentAttempt, false);
    }
    const attempted = attemptedSessionSlices();
    if (!attempted.queue.length) return;
    persistCurrentSession({
      status: 'incomplete',
      queue: attempted.queue,
      attempts: attempted.attempts,
      plannedCount: currentSessionPlannedCount || sessionQueue.length
    });
  }

  function startSession() {
    updateEligibility();
    if (!currentPool.length) return;
    const size = Number($('study-session-size').value) || 10;
    lastSessionSpec = {
      mode: sourceMode,
      coverage: coverageMode,
      deck: clampDeck($('study-deck').value),
      rangeStart: clampDeck($('study-range-start').value),
      rangeEnd: clampDeck($('study-range-end').value),
      size
    };
    sessionQueue = buildQueue(currentPool, size, sourceMode);
    currentSessionPlannedCount = sessionQueue.length;
    sessionIndex = 0;
    sessionAttempts = [];
    currentAttempt = null;
    viewingSavedSession = false;
    currentSessionId = makeEventId().replace(/^studyq-/, 'studyq-session-');
    currentSessionStartedAt = new Date().toISOString();
    renderExperience();
  }

  function restoreSessionSpecAndRestart() {
    if (!lastSessionSpec) return startSession();
    sourceMode = lastSessionSpec.mode;
    coverageMode = lastSessionSpec.coverage || 'all';
    $('study-deck').value = lastSessionSpec.deck;
    $('study-range-start').value = lastSessionSpec.rangeStart;
    $('study-range-end').value = lastSessionSpec.rangeEnd;
    $('study-session-size').value = String(lastSessionSpec.size);
    setCoverageMode(coverageMode);
    setSourceMode(sourceMode);
    startSession();
  }

  function changeSet() {
    historyRatingEditGrace.clear();
    historyRatingNotice.clear();
    viewingSavedSession = false;
    $('study-finished').hidden = true;
    $('study-finished-decks').hidden = true;
    $('study-experience').hidden = true;
    $('study-start-panel').hidden = false;
    renderRecentSessions();
    document.querySelector('.study-hub-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideStudyVoiceHelp() {
    const help = $('study-response-voice-help');
    if (!help) return;
    help.hidden = true;
    help.innerHTML = '';
  }

  function studyVoiceBrowserName() {
    if (STUDYQ_IS_IOS_SAFARI) return 'Safari';
    if (STUDYQ_IS_IOS_CHROME) return 'Chrome';
    if (/Brave/i.test(STUDYQ_UA)) return 'Brave';
    if (/FxiOS|Firefox/i.test(STUDYQ_UA)) return 'Firefox';
    return 'this browser';
  }

  function showStudyVoiceHelp(message, permission = false, errorCode = '') {
    const help = $('study-response-voice-help');
    if (!help) return;
    if (permission) {
      const browser = studyVoiceBrowserName();
      const code = clean(errorCode);
      if (STUDYQ_IS_IOS_SAFARI) {
        const micLine = studyVoiceMicPrimed
          ? 'Safari was able to access the microphone, but its speech-recognition service still did not start.'
          : 'Safari could not start voice input. This does not always mean the site microphone setting is wrong.';
        help.innerHTML = `<strong>Voice input could not start in Safari.</strong><br>${micLine}${code ? ` <span class="study-voice-error-code">(${code})</span>` : ''}<br><br>Check Safari’s Page Menu → … → Website Settings → Microphone → Ask or Allow. Also check iPhone Settings → General → Keyboard → Enable Dictation.<br><br>If those are already enabled and it still fails, this can be Safari/WebKit speech-recognition behavior rather than your WLP setting. Chrome can be used for Study Q voice input for now.<br><button type="button">Dismiss</button>`;
      } else if (STUDYQ_IS_IOS_CHROME) {
        help.innerHTML = `<strong>Voice input could not start in Chrome.</strong>${code ? ` <span class="study-voice-error-code">(${code})</span>` : ''}<br>Check the site microphone prompt/permission and iPhone Settings → Apps → Chrome → Microphone. Then try Speak answer again.<br><button type="button">Dismiss</button>`;
      } else {
        help.innerHTML = `<strong>Voice input could not start in ${browser}.</strong>${code ? ` <span class="study-voice-error-code">(${code})</span>` : ''}<br>Check this browser’s microphone and speech-recognition permissions, then try again.<br><button type="button">Dismiss</button>`;
      }
      help.querySelector('button')?.addEventListener('click', hideStudyVoiceHelp);
    } else {
      help.textContent = message || 'Voice input could not hear that. Try again.';
    }
    help.hidden = false;
  }

  async function primeSafariMicrophone() {
    studyVoiceMicPrimed = false;
    if (!STUDYQ_IS_IOS_SAFARI || !navigator.mediaDevices?.getUserMedia) return { ok: true };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      studyVoiceMicPrimed = true;
      stream.getTracks().forEach(track => track.stop());
      await new Promise(resolve => setTimeout(resolve, 220));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function setStudyVoiceListening(listening) {
    studyVoiceListening = Boolean(listening);
    if (!studyVoiceListening && studyVoiceTimeout) {
      clearTimeout(studyVoiceTimeout);
      studyVoiceTimeout = 0;
    }
    const button = $('study-response-voice');
    if (!button) return;
    button.classList.toggle('is-listening', studyVoiceListening);
    button.setAttribute('aria-pressed', String(studyVoiceListening));
    button.setAttribute('aria-label', studyVoiceListening ? 'Stop voice input' : 'Speak your answer');
    button.setAttribute('title', studyVoiceListening ? 'Stop voice input' : 'Speak your answer');
    $('study-response-voice-label').textContent = studyVoiceListening ? 'Stop' : 'Speak answer';
  }

  function stopStudyVoice() {
    if (studyVoiceRecognition) {
      try { studyVoiceRecognition.abort(); } catch (_) {}
    }
    studyVoiceRecognition = null;
    setStudyVoiceListening(false);
  }

  function insertVoiceTranscript(transcript) {
    const input = $('study-response');
    const spoken = clean(transcript);
    if (!input || !spoken) return;
    const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    input.value = `${before}${lead}${spoken}${trail}${after}`;
    const caret = before.length + lead.length + spoken.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(caret, caret); } catch (_) {}
    });
  }

  function installStudyVoice() {
    const button = $('study-response-voice');
    if (!button || !StudySpeechRecognition) return;
    button.hidden = false;
    button.setAttribute('aria-pressed', 'false');

    const beginRecognition = async () => {
      hideStudyVoiceHelp();
      if (STUDYQ_IS_IOS_SAFARI) {
        const primed = await primeSafariMicrophone();
        if (!primed.ok) {
          const code = clean(primed.error?.name || primed.error?.message || 'microphone-not-available');
          showStudyVoiceHelp('', true, code);
          return;
        }
      } else {
        studyVoiceMicPrimed = false;
      }

      try {
        const recognition = new StudySpeechRecognition();
        studyVoiceRecognition = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
          hideStudyVoiceHelp();
          setStudyVoiceListening(true);
          studyVoiceTimeout = window.setTimeout(() => {
            try { recognition.stop(); } catch (_) {}
          }, 12000);
        };
        recognition.onend = () => {
          setStudyVoiceListening(false);
          studyVoiceRecognition = null;
        };
        recognition.onerror = event => {
          setStudyVoiceListening(false);
          studyVoiceRecognition = null;
          if (event?.error === 'aborted' || event?.error === 'no-speech') return;
          if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
            showStudyVoiceHelp('', true, event?.error || 'not-allowed');
            return;
          }
          showStudyVoiceHelp(`Voice input could not start (${clean(event?.error) || 'unknown error'}). Try again.`);
        };
        recognition.onresult = event => {
          const transcript = clean(event?.results?.[0]?.[0]?.transcript);
          if (!transcript) return;
          insertVoiceTranscript(transcript);
          try { recognition.stop(); } catch (_) {}
        };
        recognition.start();
      } catch (error) {
        console.error('Study Q voice input could not start:', error);
        setStudyVoiceListening(false);
        studyVoiceRecognition = null;
        showStudyVoiceHelp('', true, clean(error?.name || error?.message || 'unavailable'));
      }
    };

    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (studyVoiceListening && studyVoiceRecognition) {
        try { studyVoiceRecognition.stop(); } catch (_) {}
        return;
      }
      await beginRecognition();
    });
    window.addEventListener('pagehide', stopStudyVoice);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopStudyVoice(); });
  }

  function installEvents() {
    document.querySelectorAll('[data-source-mode]').forEach(button => button.addEventListener('click', () => setSourceMode(button.dataset.sourceMode)));
    document.querySelectorAll('[data-deck-picker-target]').forEach(button => button.addEventListener('click', () => openDeckPicker(button.dataset.deckPickerTarget)));
    document.querySelectorAll('[data-deck-picker-mode]').forEach(button => button.addEventListener('click', () => setDeckPickerMode(button.dataset.deckPickerMode)));
    $('study-deck-picker-select').addEventListener('change', updateDeckPickerPreview);
    $('study-deck-picker-browse-back').addEventListener('click', () => {
      if (deckPickerMinorRange) deckPickerMinorRange = null;
      else deckPickerMajorRange = null;
      renderDeckPickerBrowse();
    });
    $('study-deck-picker-close').addEventListener('click', closeDeckPicker);
    $('study-deck-picker-cancel').addEventListener('click', closeDeckPicker);
    $('study-deck-picker-use').addEventListener('click', useDeckPicker);
    $('study-deck-picker-modal').addEventListener('click', event => { if (event.target === $('study-deck-picker-modal')) closeDeckPicker(); });
    document.querySelectorAll('[data-coverage-mode]').forEach(button => button.addEventListener('click', () => setCoverageMode(button.dataset.coverageMode)));
    ['study-deck', 'study-range-start', 'study-range-end', 'study-session-size'].forEach(id => $(id).addEventListener('change', updateEligibility));
    ['study-deck', 'study-range-start', 'study-range-end'].forEach(id => $(id).addEventListener('input', updateEligibility));
    $('study-standard-remember-session-size')?.addEventListener('change', persistStandardSessionSizePreference);
    $('study-start').addEventListener('click', startSession);
    $('study-show-need').addEventListener('click', () => {
      $('study-need-block').hidden = false;
      if (currentAttempt) { currentAttempt.communicativeNeedShown = true; currentAttempt.communicativeNeedShownAt = new Date().toISOString(); }
    });
    $('study-show-hint').addEventListener('click', showNextHint);
    $('study-show-target').addEventListener('click', showTarget);
    $('study-response').addEventListener('input', () => {
      const item = sessionQueue[sessionIndex];
      if (!item || !currentAttempt?.targetShown) return;
      snapshotResponse(item);
      const note = responseNote(item);
      $('study-response-note').hidden = !note;
      $('study-response-note').textContent = note;
      renderCurrentAnswerReview(item);
      updateSelfCheckGuidance(item);
    });
    $('study-open-card').addEventListener('click', () => openQuickCard($('study-open-card').dataset.wordId));
    document.querySelectorAll('[data-study-rating]').forEach(button => button.addEventListener('click', () => setSelfRating(button.dataset.studyRating)));
    $('study-end-session').addEventListener('click', openEndSessionDialog);
    $('study-end-session-keep').addEventListener('click', closeEndSessionDialog);
    $('study-end-session-save').addEventListener('click', endSessionEarly);
    $('study-end-session-modal').addEventListener('click', event => { if (event.target === $('study-end-session-modal')) closeEndSessionDialog(); });
    $('study-previous').addEventListener('click', previousExperience);
    $('study-next').addEventListener('click', nextExperience);
    $('study-again').addEventListener('click', restoreSessionSpecAndRestart);
    $('study-change-set').addEventListener('click', changeSet);
    $('study-quick-card-close').addEventListener('click', closeQuickCard);
    $('study-quick-card-done').addEventListener('click', closeQuickCard);
    $('study-quick-card-modal').addEventListener('click', event => { if (event.target === $('study-quick-card-modal')) closeQuickCard(); });
    document.addEventListener('click', event => {
      const standardModeButton = event.target.closest('[data-wlp-practice-mode="standard"]');
      if (standardModeButton) setTimeout(() => { applySavedStandardSessionSize(); updateEligibility(); }, 0);

      const ratingButton = event.target.closest('[data-study-history-rating]');
      if (ratingButton) {
        const result = updateSavedSessionRating(
          ratingButton.dataset.studyqSessionId,
          ratingButton.dataset.studyqEventId,
          ratingButton.dataset.studyHistoryRating
        );
        if (result.ok) {
          renderSessionReview();
          refreshOpenSessionSummary();
          renderRecentSessions();
        }
        return;
      }

      const button = event.target.closest('[data-quick-card-word-id]');
      if (button) openQuickCard(button.dataset.quickCardWordId);
      const historyButton = event.target.closest('[data-studyq-session-id]');
      if (historyButton) showSavedSession(historyButton.dataset.studyqSessionId);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('study-end-session-modal').hidden) closeEndSessionDialog();
      else if (!$('study-deck-picker-modal').hidden) closeDeckPicker();
      else if (!$('study-quick-card-modal').hidden) closeQuickCard();
    });
    window.addEventListener('pagehide', autosavePartialSessionOnLeave);
    installStudyVoice();
  }

  function setDefaults() {
    maxDeck = Math.max(1, ...rows.map(row => Number(row['Batch #']) || 0));
    ['study-deck', 'study-range-start', 'study-range-end'].forEach(id => { $(id).max = String(maxDeck); });
    populateDeckPickerOptions();

    let recentDeck = 0;
    try {
      const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(recent) && Number.isFinite(recent[0])) recentDeck = Number(recent[0]);
    } catch {}
    const initialDeck = clampDeck(recentDeck || Number(rows[0]?.['Batch #']) || 1);
    $('study-deck').value = String(initialDeck);
    $('study-range-start').value = String(initialDeck);
    $('study-range-end').value = String(Math.min(maxDeck, initialDeck + 4));

    if (!document.body.classList.contains('wlp-ai-study-mode')) applySavedStandardSessionSize();
    else syncStandardSessionSizePreferenceUI();
    setCoverageMode('all');
    renderRecentSessions();
    refreshTemporaryStudySet();
    const requestedSource = clean(new URLSearchParams(location.search).get('source'));
    const reviewExperiences = experiencePoolFor('review');
    if (requestedSource === 'study-set' && temporaryStudySet?.items?.length) setSourceMode('study-set');
    else setSourceMode(reviewExperiences.length ? 'review' : 'deck');
  }

  function runPreProgressPolishSelfTest() {
    const checks = [];
    const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
    const oldSession = {
      sessionId: 'self-old', startedAt: '2026-01-01T00:00:00.000Z',
      experiences: [{ wordId: '419', attempt: { eventId: 'self-old-event', selfRating: '' } }]
    };
    const newSession = {
      sessionId: 'self-new', startedAt: '2026-01-02T00:00:00.000Z',
      experiences: [{ wordId: '419', attempt: { eventId: 'self-new-event', selfRating: 'got-it' } }]
    };
    const fixtures = [oldSession, newSession];
    check('session-size singular label', standardSessionSizeText(1) === '1 experience');
    check('session-size plural label', standardSessionSizeText(5) === '5 experiences');
    check('valid rating accepted', validStudyRating('almost') === true);
    check('invalid rating rejected', validStudyRating('maybe') === false);
    check('older unrated attempt is editable', historyRatingEditPolicy('self-old', '419', oldSession.experiences[0].attempt, fixtures).editable === true);
    const oldRated = { eventId: 'self-old-event', selfRating: 'not-yet' };
    check('older rated attempt is locked', historyRatingEditPolicy('self-old', '419', oldRated, fixtures).editable === false);
    check('latest rated attempt is editable', historyRatingEditPolicy('self-new', '419', newSession.experiences[0].attempt, fixtures).editable === true);
    historyRatingEditGrace.add('self-old-event');
    check('just-filled older attempt stays editable in current review', historyRatingEditPolicy('self-old', '419', oldRated, fixtures).editable === true);
    historyRatingEditGrace.delete('self-old-event');
    return { passed: checks.every(item => item.passed), checks };
  }

  window.WLPStudyQStandard = Object.freeze({
    version: STUDYQ_STANDARD_VERSION,
    runPreProgressPolishSelfTest
  });

  installEvents();
  (async () => {
    try {
      const response = await fetch(MASTER_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Master TSV ${response.status}`);
      rows = applyOverrides(parseTSV(await response.text()));
      rowByWordId = new Map(rows.map(row => [clean(row.WordID), row]).filter(([wordId]) => wordId));
      reviewByWordId = readReviewMap();
      setDefaults();
      const requestedSession = new URLSearchParams(location.search).get('session');
      if (requestedSession) showSavedSession(requestedSession);
      else if (location.hash === '#recent-sessions') $('study-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error('Study Q could not load', error);
      $('study-eligibility').innerHTML = '<strong>Study data could not be loaded</strong><span>Reload when the Master TSV is available.</span>';
      $('study-start').disabled = true;
    }
  })();
})();
