
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
          <select class="s7-voice-select" id="s7-default-voice" aria-label="Default Study voice">
            <option value="">System Default</option>
          </select>
          <p class="s7-option-help">Uses the English voices available on this device. You can still cycle voices from the card.</p>
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

        <p class="s7-options-autosave">Study Options v1 · saved on this device</p>
      </aside>`;
    document.body.appendChild(backdrop);
    return backdrop;
  };

  const panel = buildPanel();
  const sheet = panel.querySelector('.s7-study-options-sheet');
  const presetDescription = panel.querySelector('#s7-preset-description');
  const customPanel = panel.querySelector('#s7-custom-content');
  const voiceSelect = panel.querySelector('#s7-default-voice');
  const swipeInput = panel.querySelector('#s7-swipe-cards');

  const closePanel = () => {
    panel.hidden = true;
    document.body.classList.remove('s7-study-options-open');
  };

  const openPanel = () => {
    prefs = loadPrefs();
    syncPanel();
    populateVoices();
    panel.hidden = false;
    document.body.classList.add('s7-study-options-open');
    setTimeout(() => panel.querySelector('.s7-study-options-close')?.focus(), 0);
  };

  document.querySelectorAll('[data-study-options-launch]').forEach(button => {
    button.addEventListener('click', openPanel);
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
    if (voiceSelect) voiceSelect.value = currentVoice();
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
    const action = button.querySelector('.s7-toggle-action');
    if (action) action.textContent = expanded ? 'Hide ↑' : 'Show ↓';
    button.setAttribute('aria-expanded', String(expanded));
  };

  const ensureContentToggle = (card, el, key, label) => {
    let button = card.querySelector(`.s7-card-content-toggle[data-s7-field="${key}"]`);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 's7-card-content-toggle';
    button.dataset.s7Field = key;
    button.innerHTML = `<span>${label}</span><span class="s7-toggle-action">Show ↓</span>`;
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
      if (existing) existing.hidden = true;
      return;
    }

    if (mode === 'hidden') {
      el.classList.add('s7-card-content-hidden');
      if (existing) existing.hidden = true;
      return;
    }

    if (mode === 'shown') {
      el.classList.remove('s7-card-content-hidden');
      if (existing) existing.hidden = true;
      return;
    }

    const button = ensureContentToggle(card, el, key, label);
    button.hidden = false;
    const expanded = el.dataset.s7Expanded === 'true';
    el.classList.toggle('s7-card-content-hidden', !expanded);
    toggleText(button, expanded);
  };

  const applyCardContent = () => {
    const state = contentState();
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

  const voiceLabel = voice => {
    if (!voice) return 'System Default';
    const locale = String(voice.lang || '').replace('_','-');
    return locale ? `${voice.name} · ${locale}` : voice.name;
  };

  const getVoices = () => {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices() || [];
  };

  const populateVoices = () => {
    if (!voiceSelect) return;
    const selected = currentVoice();
    const voices = getVoices();
    const english = voices.filter(v => /^en(?:-|_)/i.test(v.lang || ''));
    const list = english.length ? english : voices;

    const unique = [];
    const seen = new Set();
    list.forEach(v => {
      if (!v?.name || seen.has(v.name)) return;
      seen.add(v.name);
      unique.push(v);
    });
    unique.sort((a,b) => a.name.localeCompare(b.name));

    voiceSelect.innerHTML = '<option value="">System Default</option>';
    unique.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = voiceLabel(voice);
      voiceSelect.appendChild(option);
    });

    if (selected && !seen.has(selected)) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = `${selected} · saved`;
      voiceSelect.appendChild(option);
    }
    voiceSelect.value = selected;
  };

  const updateVisibleVoiceLabels = () => {
    const selected = currentVoice();
    const match = getVoices().find(v => v.name === selected);
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

  voiceSelect?.addEventListener('change', () => {
    localStorage.setItem(VOICE_KEY, voiceSelect.value || '');
    updateVisibleVoiceLabels();
  });

  swipeInput?.addEventListener('change', () => {
    prefs.swipe = swipeInput.checked;
    savePrefs();
    applySwipeState();
  });

  if ('speechSynthesis' in window) {
    populateVoices();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
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
