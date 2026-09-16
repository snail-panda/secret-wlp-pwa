
(() => {
  const PREF_KEY = 'wlp:stage7:study-options:v1';
  const CARD_MODE_KEY = 'fc:cardMode';
  const VOICE_KEY = 'fc:voiceName';

  const DEFAULTS = {
    contentPreset: 'standard',
    custom: {
      example: 'shown',
      synonyms: 'shown',
      notes: 'collapsed',
      ipa: true,
      pos: true
    },
    youglish: {
      visible: true,
      accent: 'us'
    },
    swipe: true
  };

  const PRESET_DESCRIPTIONS = {
    focus: 'Definition + Examples. Synonyms and Notes stay out of the way.',
    standard: 'Definition + Examples + Synonyms, with Notes collapsed until you need them.',
    full: 'Definition, Examples, Synonyms, and Notes all stay expanded.',
    custom: 'Choose exactly what appears, collapses, or stays hidden.'
  };

  const safeParse = raw => {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  };

  const loadPrefs = () => {
    const stored = safeParse(localStorage.getItem(PREF_KEY));
    const custom = stored.custom && typeof stored.custom === 'object' ? stored.custom : {};
    return {
      contentPreset: ['focus','standard','full','custom'].includes(stored.contentPreset)
        ? stored.contentPreset : DEFAULTS.contentPreset,
      custom: {
        example: ['shown','collapsed','hidden'].includes(custom.example) ? custom.example : DEFAULTS.custom.example,
        synonyms: ['shown','collapsed','hidden'].includes(custom.synonyms) ? custom.synonyms : DEFAULTS.custom.synonyms,
        notes: ['shown','collapsed','hidden'].includes(custom.notes) ? custom.notes : DEFAULTS.custom.notes,
        ipa: typeof custom.ipa === 'boolean' ? custom.ipa : DEFAULTS.custom.ipa,
        pos: typeof custom.pos === 'boolean' ? custom.pos : DEFAULTS.custom.pos
      },
      youglish: {
        visible: typeof stored.youglish?.visible === 'boolean' ? stored.youglish.visible : DEFAULTS.youglish.visible,
        accent: ['us','uk','aus'].includes(stored.youglish?.accent) ? stored.youglish.accent : DEFAULTS.youglish.accent
      },
      swipe: typeof stored.swipe === 'boolean' ? stored.swipe : DEFAULTS.swipe
    };
  };

  let prefs = loadPrefs();

  const savePrefs = () => {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  };

  const currentMode = () => localStorage.getItem(CARD_MODE_KEY) === 'definition' ? 'definition' : 'word';
  const currentVoice = () => localStorage.getItem(VOICE_KEY) || '';

  const iconClose = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18"></path>
    </svg>`;

  const buildPanel = () => {
    const backdrop = document.createElement('div');
    backdrop.className = 's7-study-options-backdrop';
    backdrop.id = 's7-study-options';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <aside class="s7-study-options-sheet" role="dialog" aria-modal="true" aria-labelledby="s7-study-options-title">
        <header class="s7-study-options-head">
          <div>
            <span class="s7-study-options-kicker">Study</span>
            <h2 id="s7-study-options-title">Study Options</h2>
          </div>
          <button class="s7-study-options-close" type="button" aria-label="Close Study Options">${iconClose}</button>
        </header>

        <p class="s7-study-options-intro">Tune how much of each card you see and how Study behaves. Changes save automatically.</p>

        <section class="s7-options-section">
          <div class="s7-options-section-head">
            <h3>Card Content</h3>
            <small>Back side</small>
          </div>
          <div class="s7-preset-grid" role="group" aria-label="Card content preset">
            <button class="s7-preset-button" type="button" data-s7-preset="focus">Focus</button>
            <button class="s7-preset-button" type="button" data-s7-preset="standard">Standard</button>
            <button class="s7-preset-button" type="button" data-s7-preset="full">Full</button>
            <button class="s7-preset-button" type="button" data-s7-preset="custom">Custom</button>
          </div>
          <p class="s7-preset-description" id="s7-preset-description"></p>

          <div class="s7-custom-content" id="s7-custom-content" hidden>
            <div class="s7-custom-row"><span>Definition</span><span class="s7-fixed-value">Always shown</span></div>
            <label class="s7-custom-row"><span>Examples</span>
              <select data-s7-custom="example" aria-label="Examples display">
                <option value="shown">Shown</option><option value="collapsed">Collapsed</option><option value="hidden">Hidden</option>
              </select>
            </label>
            <label class="s7-custom-row"><span>Synonyms</span>
              <select data-s7-custom="synonyms" aria-label="Synonyms display">
                <option value="shown">Shown</option><option value="collapsed">Collapsed</option><option value="hidden">Hidden</option>
              </select>
            </label>
            <label class="s7-custom-row"><span>Notes</span>
              <select data-s7-custom="notes" aria-label="Notes display">
                <option value="shown">Shown</option><option value="collapsed">Collapsed</option><option value="hidden">Hidden</option>
              </select>
            </label>
            <div class="s7-custom-row">
              <span>IPA</span>
              <label class="s7-switch"><input type="checkbox" data-s7-detail="ipa"><span class="s7-switch-track"></span></label>
            </div>
            <div class="s7-custom-row">
              <span>Part of Speech</span>
              <label class="s7-switch"><input type="checkbox" data-s7-detail="pos"><span class="s7-switch-track"></span></label>
            </div>
          </div>
        </section>

        <section class="s7-options-section">
          <div class="s7-options-section-head">
            <h3>Default Study Side</h3>
            <small>Also updates the current Study</small>
          </div>
          <div class="s7-side-grid" role="group" aria-label="Default study side">
            <button class="s7-side-button" type="button" data-s7-side="word">Word First</button>
            <button class="s7-side-button" type="button" data-s7-side="definition">Definition First</button>
          </div>
        </section>

        <section class="s7-options-section">
          <div class="s7-options-section-head">
            <h3>Audio</h3>
            <small>Default voice</small>
          </div>
          <div class="s7-voice-cycle" id="s7-voice-cycle" role="group" aria-label="Default Study voice">
            <button type="button" id="s7-voice-prev" aria-label="Previous voice">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
            </button>
            <div class="s7-voice-current" id="s7-voice-current">System Default</div>
            <button type="button" id="s7-voice-next" aria-label="Next voice">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>
            </button>
          </div>
          <p class="s7-option-help">Shows WLP’s preferred English study voices available on this device. You can still cycle voices from the card.</p>
        </section>

        <section class="s7-options-section">
          <div class="s7-options-section-head">
            <h3>Pronunciation Reference</h3>
            <small>Real speech</small>
          </div>
          <div class="s7-switch-row">
            <div class="s7-switch-copy">
              <strong>Show YouGlish</strong>
              <small>Open the current headword in real-world video clips.</small>
            </div>
            <label class="s7-switch">
              <input type="checkbox" id="s7-youglish-visible">
              <span class="s7-switch-track"></span>
            </label>
          </div>
          <div class="s7-reference-accent-row" id="s7-youglish-accent-row">
            <span>Default accent</span>
            <div class="s7-reference-accent-grid" role="group" aria-label="YouGlish default accent">
              <button type="button" data-s7-youglish-accent="us">US</button>
              <button type="button" data-s7-youglish-accent="uk">UK</button>
              <button type="button" data-s7-youglish-accent="aus">AU</button>
            </div>
          </div>
        </section>

        <section class="s7-options-section">
          <div class="s7-switch-row">
            <div class="s7-switch-copy">
              <strong>Swipe to change cards</strong>
              <small>Horizontal swipe on the card. Edge swipes are ignored.</small>
            </div>
            <label class="s7-switch">
              <input type="checkbox" id="s7-swipe-cards">
              <span class="s7-switch-track"></span>
            </label>
          </div>
        </section>

        <p class="s7-options-autosave">Study Options v1.4 · saved on this device</p>
      </aside>`;
    document.body.appendChild(backdrop);
    return backdrop;
  };

  const panel = buildPanel();
  const sheet = panel.querySelector('.s7-study-options-sheet');
  const presetDescription = panel.querySelector('#s7-preset-description');
  const customPanel = panel.querySelector('#s7-custom-content');
  const voiceCurrent = panel.querySelector('#s7-voice-current');
  const voicePrev = panel.querySelector('#s7-voice-prev');
  const voiceNext = panel.querySelector('#s7-voice-next');
  const swipeInput = panel.querySelector('#s7-swipe-cards');
  const youglishVisibleInput = panel.querySelector('#s7-youglish-visible');
  const youglishAccentRow = panel.querySelector('#s7-youglish-accent-row');

  const closePanel = () => {
    panel.hidden = true;
    document.body.classList.remove('s7-study-options-open');
  };

  const openPanel = () => {
    prefs = loadPrefs();
    syncPanel();
    normalizeStoredVoice();
    panel.hidden = false;
    document.body.classList.add('s7-study-options-open');
    setTimeout(() => panel.querySelector('.s7-study-options-close')?.focus(), 0);
  };

  document.querySelectorAll('[data-study-options-launch]').forEach(button => {
    button.addEventListener('click', () => {
      const drawer = document.getElementById('app-drawer');
      const drawerBackdrop = document.querySelector('.drawer-backdrop, .app-drawer-backdrop, [data-drawer-backdrop]');
      const menuButton = document.getElementById('menu-button');

      if (drawer) {
        drawer.classList.remove('open', 'is-open', 'active');
        drawer.removeAttribute('data-open');
        drawer.setAttribute('aria-hidden', 'true');
      }
      if (drawerBackdrop) {
        drawerBackdrop.classList.remove('open', 'is-open', 'active');
        drawerBackdrop.hidden = true;
      }
      if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('drawer-open', 'menu-open');

      requestAnimationFrame(openPanel);
    });
  });
  panel.querySelector('.s7-study-options-close')?.addEventListener('click', closePanel);
  panel.addEventListener('click', event => {
    if (event.target === panel) closePanel();
  });
  sheet?.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });

  const syncPanel = () => {
    panel.querySelectorAll('[data-s7-preset]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.s7Preset === prefs.contentPreset));
    });
    presetDescription.textContent = PRESET_DESCRIPTIONS[prefs.contentPreset] || '';
    customPanel.hidden = prefs.contentPreset !== 'custom';

    panel.querySelectorAll('[data-s7-custom]').forEach(select => {
      select.value = prefs.custom[select.dataset.s7Custom] || 'shown';
    });
    panel.querySelector('[data-s7-detail="ipa"]').checked = prefs.custom.ipa;
    panel.querySelector('[data-s7-detail="pos"]').checked = prefs.custom.pos;

    const mode = currentMode();
    panel.querySelectorAll('[data-s7-side]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.s7Side === mode));
    });

    swipeInput.checked = prefs.swipe;
    if (youglishVisibleInput) youglishVisibleInput.checked = prefs.youglish.visible;
    if (youglishAccentRow) youglishAccentRow.classList.toggle('is-disabled', !prefs.youglish.visible);
    panel.querySelectorAll('[data-s7-youglish-accent]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.s7YouglishAccent === prefs.youglish.accent));
      button.disabled = !prefs.youglish.visible;
    });
    updateOptionsVoiceLabel();
  };

  const resetCollapsedState = () => {
    document.querySelectorAll('#cards .ex, #cards .syn, #cards .note').forEach(el => {
      delete el.dataset.s7Expanded;
    });
  };

  const contentState = () => {
    if (prefs.contentPreset === 'focus') {
      return { example:'shown', synonyms:'hidden', notes:'hidden', ipa:true, pos:true };
    }
    if (prefs.contentPreset === 'full') {
      return { example:'shown', synonyms:'shown', notes:'shown', ipa:true, pos:true };
    }
    if (prefs.contentPreset === 'custom') {
      return { ...prefs.custom };
    }
    return { example:'shown', synonyms:'shown', notes:'collapsed', ipa:true, pos:true };
  };

  const toggleText = (button, expanded) => {
    const verb = button.querySelector('.s7-toggle-verb');
    if (verb) verb.textContent = expanded ? 'Hide' : 'Show';
    button.setAttribute('aria-expanded', String(expanded));
  };

  const ensureContentToggle = (card, el, key, label) => {
    let button = card.querySelector(`.s7-card-content-toggle[data-s7-field="${key}"]`);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 's7-card-content-toggle';
    button.dataset.s7Field = key;
    button.innerHTML = `<span class="s7-collapse-label"><span class="s7-toggle-verb">Show</span> ${label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg></span>`;
    button.addEventListener('click', () => {
      const expanded = el.dataset.s7Expanded !== 'true';
      el.dataset.s7Expanded = String(expanded);
      el.classList.toggle('s7-card-content-hidden', !expanded);
      toggleText(button, expanded);
    });
    el.before(button);
    return button;
  };

  const applyFieldMode = (card, selector, key, label, mode) => {
    const el = card.querySelector(selector);
    if (!el) return;
    const hasContent = Boolean(String(el.textContent || '').trim());
    const existing = card.querySelector(`.s7-card-content-toggle[data-s7-field="${key}"]`);

    if (!hasContent) {
      el.classList.remove('s7-card-content-hidden');
      if (existing) {
        existing.hidden = true;
        existing.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    if (mode === 'hidden') {
      el.classList.add('s7-card-content-hidden');
      if (existing) {
        existing.hidden = true;
        existing.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    if (mode === 'shown') {
      el.classList.remove('s7-card-content-hidden');
      if (existing) {
        existing.hidden = true;
        existing.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    const button = ensureContentToggle(card, el, key, label);
    button.hidden = false;
    button.removeAttribute('aria-hidden');
    const expanded = el.dataset.s7Expanded === 'true';
    el.classList.toggle('s7-card-content-hidden', !expanded);
    toggleText(button, expanded);
  };

  const applyCardContent = () => {
    const state = contentState();
    document.body.dataset.s7ContentPreset = prefs.contentPreset;
    document.querySelectorAll('#cards .flashcard').forEach(card => {
      applyFieldMode(card, '.ex', 'example', 'Examples', state.example);
      applyFieldMode(card, '.syn', 'synonyms', 'Synonyms', state.synonyms);
      applyFieldMode(card, '.note', 'notes', 'Notes', state.notes);

      card.querySelectorAll('.ipa, .back-ipa').forEach(el => {
        el.classList.toggle('s7-card-content-hidden', state.ipa === false);
      });
      card.querySelectorAll('.pos, .back-pos').forEach(el => {
        el.classList.toggle('s7-card-content-hidden', state.pos === false);
      });
    });
  };

  const applySwipeState = () => {
    document.body.classList.toggle('s7-swipe-enabled', Boolean(prefs.swipe));
  };

  const YOUGLISH_ACCENT_LABELS = { us:'US', uk:'UK', aus:'AU' };

  const youglishUrl = (word, accent) => {
    const clean = String(word || '').trim();
    if (!clean) return 'https://youglish.com/';
    return `https://youglish.com/pronounce/${encodeURIComponent(clean)}/english/${accent}`;
  };

  const applyYouGlishState = () => {
    const visible = Boolean(prefs.youglish?.visible);
    const accent = ['us','uk','aus'].includes(prefs.youglish?.accent) ? prefs.youglish.accent : 'us';
    const accentLabel = YOUGLISH_ACCENT_LABELS[accent] || 'US';
    document.body.classList.toggle('s7-youglish-enabled', visible);

    document.querySelectorAll('#cards .flashcard').forEach(card => {
      const word = String(card.querySelector('.word')?.textContent || card.querySelector('.back-word')?.textContent || '').trim();
      card.querySelectorAll('[data-youglish]').forEach(link => {
        if (link.hidden === visible) link.hidden = !visible;
        link.href = youglishUrl(word, accent);
        const badge = link.querySelector('.s7-youglish-accent');
        if (badge && badge.textContent !== accentLabel) badge.textContent = accentLabel;
        link.setAttribute('aria-label', `Hear ${word || 'this word'} in real speech on YouGlish (${accentLabel})`);
        link.title = `Hear it in real speech on YouGlish · ${accentLabel}`;
      });
    });
  };

  const PREFERRED_VOICE_NAMES = [
    'Samantha',
    'Karen',
    'Victoria',
    'Daniel',
    'Alex',
    'Oliver',
    'Microsoft Zira Desktop',
    'Microsoft Aria',
    'Microsoft David Desktop',
    'Microsoft Guy'
  ];

  const NOVELTY_VOICE_RE = /\b(?:Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos?|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

  const voiceLabel = voice => {
    if (!voice) return 'System Default';
    const locale = String(voice.lang || '').replace('_','-');
    let region = locale;
    const match = locale.match(/^en-([A-Za-z]{2})$/i);
    if (match) {
      const code = match[1].toUpperCase();
      region = ({US:'US',GB:'UK',AU:'AU',CA:'CA',IE:'IE',NZ:'NZ',IN:'IN',ZA:'ZA'})[code] || code;
    }
    return region ? `${voice.name} · ${region}` : voice.name;
  };

  const getVoices = () => {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices() || [];
  };

  const availableStudyVoices = () => {
    const voices = getVoices();
    if (!voices.length) return [];

    const preferred = [];
    PREFERRED_VOICE_NAMES.forEach(name => {
      const exact = voices.find(v =>
        v &&
        v.name === name &&
        /^en(?:-|_)/i.test(v.lang || '')
      );
      if (exact) preferred.push(exact);
    });
    if (preferred.length) return preferred;

    /* Fallback for an unfamiliar platform: English speech voices only,
       excluding Apple's novelty/effect voices and duplicate names. */
    const nameCounts = new Map();
    voices.forEach(v => {
      if (!v?.name) return;
      nameCounts.set(v.name, (nameCounts.get(v.name) || 0) + 1);
    });
    const seen = new Set();
    return voices.filter(v => {
      if (!v?.name || !/^en(?:-|_)/i.test(v.lang || '')) return false;
      if (NOVELTY_VOICE_RE.test(v.name)) return false;
      /* app.js stores voices by name, so avoid ambiguous duplicate names
         that can resolve to the wrong locale (e.g. Eddy variants). */
      if ((nameCounts.get(v.name) || 0) > 1) return false;
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    }).slice(0, 8);
  };

  const voiceByStoredName = () => {
    const selected = currentVoice();
    if (!selected) return null;
    return availableStudyVoices().find(v => v.name === selected) || null;
  };

  const updateOptionsVoiceLabel = () => {
    if (!voiceCurrent) return;
    const selected = currentVoice();
    const match = voiceByStoredName();
    voiceCurrent.textContent = selected && match ? voiceLabel(match) : 'System Default';
  };

  const normalizeStoredVoice = () => {
    const selected = currentVoice();
    if (!selected) {
      updateOptionsVoiceLabel();
      return;
    }
    const allowed = availableStudyVoices();
    if (!allowed.length) {
      updateOptionsVoiceLabel();
      return;
    }
    if (!allowed.some(v => v.name === selected)) {
      localStorage.setItem(VOICE_KEY, allowed[0].name);
    }
    updateOptionsVoiceLabel();
    updateVisibleVoiceLabels();
  };

  const cycleOptionsVoice = direction => {
    const voices = availableStudyVoices();
    if (!voices.length) {
      localStorage.setItem(VOICE_KEY, '');
      updateOptionsVoiceLabel();
      updateVisibleVoiceLabels();
      return;
    }

    const names = ['', ...voices.map(v => v.name)];
    const cur = currentVoice();
    let index = names.indexOf(cur);

    if (index < 0) index = 0;
    const nextIndex = (index + direction + names.length) % names.length;
    localStorage.setItem(VOICE_KEY, names[nextIndex]);
    updateOptionsVoiceLabel();
    updateVisibleVoiceLabels();
  };

  const updateVisibleVoiceLabels = () => {
    const selected = currentVoice();
    const match = getVoices().find(v =>
      v &&
      v.name === selected &&
      /^en(?:-|_)/i.test(v.lang || '')
    );
    const label = voiceLabel(match || (selected ? {name:selected, lang:''} : null));
    document.querySelectorAll('.voice-control').forEach(control => {
      const detail = control.querySelector('.voice-detail');
      const button = control.querySelector('.btn-voice');
      if (detail) detail.textContent = label;
      if (button) {
        const compact = label
          .replace(/ · en-US$/i, ' · US')
          .replace(/ · en-GB$/i, ' · UK')
          .replace(/ · en-AU$/i, ' · AU');
        button.textContent = `‹ ${compact} ›`;
        button.setAttribute('aria-label', `Voice: ${compact}. Tap to switch voice.`);
      }
    });
  };

  const applyCurrentMode = mode => {
    const safeMode = mode === 'definition' ? 'definition' : 'word';
    localStorage.setItem(CARD_MODE_KEY, safeMode);
    const live = document.querySelector(`.mode-btn[data-mode="${safeMode}"]`);
    if (live && !live.classList.contains('active')) live.click();
    syncPanel();
  };

  const applyAll = () => {
    applyCardContent();
    applySwipeState();
    applyYouGlishState();
    updateVisibleVoiceLabels();
  };

  panel.querySelectorAll('[data-s7-preset]').forEach(button => {
    button.addEventListener('click', () => {
      prefs.contentPreset = button.dataset.s7Preset;
      savePrefs();
      resetCollapsedState();
      syncPanel();
      applyCardContent();
    });
  });

  panel.querySelectorAll('[data-s7-custom]').forEach(select => {
    select.addEventListener('change', () => {
      prefs.custom[select.dataset.s7Custom] = select.value;
      savePrefs();
      resetCollapsedState();
      applyCardContent();
    });
  });

  panel.querySelectorAll('[data-s7-detail]').forEach(input => {
    input.addEventListener('change', () => {
      prefs.custom[input.dataset.s7Detail] = input.checked;
      savePrefs();
      applyCardContent();
    });
  });

  panel.querySelectorAll('[data-s7-side]').forEach(button => {
    button.addEventListener('click', () => applyCurrentMode(button.dataset.s7Side));
  });

  voicePrev?.addEventListener('click', () => cycleOptionsVoice(-1));
  voiceNext?.addEventListener('click', () => cycleOptionsVoice(1));

  youglishVisibleInput?.addEventListener('change', () => {
    prefs.youglish.visible = youglishVisibleInput.checked;
    savePrefs();
    syncPanel();
    applyYouGlishState();
  });

  panel.querySelectorAll('[data-s7-youglish-accent]').forEach(button => {
    button.addEventListener('click', () => {
      prefs.youglish.accent = button.dataset.s7YouglishAccent;
      savePrefs();
      syncPanel();
      applyYouGlishState();
    });
  });

  swipeInput?.addEventListener('change', () => {
    prefs.swipe = swipeInput.checked;
    savePrefs();
    applySwipeState();
  });

  if ('speechSynthesis' in window) {
    normalizeStoredVoice();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', normalizeStoredVoice);
    }
  }

  /* Apply content rules to cards rendered later by the proven app.js. */
  const cards = document.getElementById('cards');
  let applyQueued = false;
  const queueApply = () => {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => {
      applyQueued = false;
      applyCardContent();
      applyYouGlishState();
      updateVisibleVoiceLabels();
    });
  };
  if (cards) {
    const observer = new MutationObserver(queueApply);
    observer.observe(cards, {
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      attributeFilter:['class','hidden']
    });
  }

  /* Swipe navigation: horizontal card gesture only; Safari edge swipes remain untouched. */
  let touchStart = null;
  if (cards) {
    cards.addEventListener('touchstart', event => {
      if (!prefs.swipe || event.touches.length !== 1) { touchStart = null; return; }
      const touch = event.touches[0];
      if (touch.clientX < 26 || touch.clientX > window.innerWidth - 26) { touchStart = null; return; }
      if (event.target.closest('button,a,input,select,textarea,label')) { touchStart = null; return; }
      touchStart = { x:touch.clientX, y:touch.clientY, at:Date.now() };
    }, {passive:true});

    cards.addEventListener('touchend', event => {
      if (!prefs.swipe || !touchStart || !event.changedTouches.length) { touchStart = null; return; }
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      const elapsed = Date.now() - touchStart.at;
      touchStart = null;
      if (elapsed > 900 || Math.abs(dx) < 68 || Math.abs(dx) < Math.abs(dy) * 1.35) return;

      const active = document.querySelector('#cards .flashcard.active') || document.querySelector('#cards .flashcard');
      if (!active) return;
      const source = active.querySelector(dx < 0 ? '.btn-next' : '.btn-prev');
      source?.click();
    }, {passive:true});
  }

  syncPanel();
  applyAll();

  window.WLPStudyOptions = { open:openPanel, close:closePanel };
})();
