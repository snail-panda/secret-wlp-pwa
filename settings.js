(() => {
  'use strict';

  const STUDY_PREF_KEY = 'wlp:stage7:study-options:v1';
  const CARD_MODE_KEY = 'fc:cardMode';
  const VOICE_KEY = 'fc:voiceName';
  const PRACTICE_MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const STANDARD_SIZE_KEY = 'wlp:studyq:session-size-default:v1';
  const AI_SIZE_KEY = 'wlp:ai-study-session-size:v1';
  const AI_HINT_KEY = 'wlp:ai-study-hint-limit:v1';
  const PROGRESS_OPTIONS_KEY = 'wlp:stage7:progress-options:v1';
  const ROLE_KEY = 'wlp:ui-role:v2';
  const SESSION_ROLE_KEY = 'wlp:session-admin:v1';

  const STUDY_DEFAULTS = {
    contentPreset: 'standard',
    custom: { example:'shown', synonyms:'shown', notes:'collapsed', ipa:true, pos:true },
    youglish: { visible:true, accent:'us' },
    referenceTools: { external:true, google:true, images:true, jp:true },
    readAloud: {
      defaultTarget:'example',
      targets:{ definition:true, example:true, synonyms:true, notes:true, all:true }
    },
    display: { helperLabels:true, shuffle:true, recording:true },
    swipe:true
  };

  const PRESET_DESCRIPTIONS = {
    focus: 'Definition + Examples. Synonyms and Notes stay out of the way.',
    standard: 'Definition + Examples + Synonyms, with Notes collapsed until you need them.',
    full: 'Definition, Examples, Synonyms, and Notes all stay expanded.',
    custom: 'Choose exactly what appears, collapses, or stays hidden.'
  };

  const PROGRESS_OPTIONS = {
    Overview: [
      ['overview.map', 'Vocabulary Map'],
      ['overview.review', 'Review Attention'],
      ['overview.sources', 'Learning Sources'],
      ['overview.next', 'Next Move'],
      ['overview.recent', 'Recent Activity']
    ],
    Landscape: [
      ['landscape.coverage', 'Overall Coverage'],
      ['landscape.deckmap', 'Deck Coverage Map'],
      ['landscape.review', 'Review Attention'],
      ['landscape.connections', 'Practice Connections']
    ],
    Paths: [
      ['paths.paths', 'Learning Paths'],
      ['paths.focus', 'Focus for Today'],
      ['paths.recent', 'Recently Practiced'],
      ['paths.motto', 'Paths Motto']
    ],
    Activity: [
      ['activity.period', 'Time Window'],
      ['activity.source', 'Evidence Source'],
      ['activity.snapshot', 'Activity Snapshot'],
      ['activity.studyq', 'Standard Practice'],
      ['activity.ai', 'AI Practice'],
      ['activity.trend', 'Activity Over Time'],
      ['activity.mix', 'Activity Mix'],
      ['activity.timeline', 'Timeline']
    ]
  };

  const PREFERRED_VOICE_NAMES = [
    'Samantha','Karen','Victoria','Daniel','Alex','Oliver',
    'Microsoft Zira Desktop','Microsoft Aria','Microsoft David Desktop','Microsoft Guy'
  ];
  const NOVELTY_VOICE_RE = /\b(?:Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos?|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

  const $ = id => document.getElementById(id);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const safeParse = raw => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } };

  let studyPrefs = loadStudyPrefs();

  function loadStudyPrefs() {
    const stored = safeParse(localStorage.getItem(STUDY_PREF_KEY));
    const custom = stored.custom && typeof stored.custom === 'object' ? stored.custom : {};
    return {
      contentPreset: ['focus','standard','full','custom'].includes(stored.contentPreset) ? stored.contentPreset : STUDY_DEFAULTS.contentPreset,
      custom: {
        example: ['shown','collapsed','hidden'].includes(custom.example) ? custom.example : STUDY_DEFAULTS.custom.example,
        synonyms: ['shown','collapsed','hidden'].includes(custom.synonyms) ? custom.synonyms : STUDY_DEFAULTS.custom.synonyms,
        notes: ['shown','collapsed','hidden'].includes(custom.notes) ? custom.notes : STUDY_DEFAULTS.custom.notes,
        ipa: typeof custom.ipa === 'boolean' ? custom.ipa : STUDY_DEFAULTS.custom.ipa,
        pos: typeof custom.pos === 'boolean' ? custom.pos : STUDY_DEFAULTS.custom.pos
      },
      youglish: {
        visible: typeof stored.youglish?.visible === 'boolean' ? stored.youglish.visible : STUDY_DEFAULTS.youglish.visible,
        accent: ['us','uk','aus'].includes(stored.youglish?.accent) ? stored.youglish.accent : STUDY_DEFAULTS.youglish.accent
      },
      referenceTools: {
        external: typeof stored.referenceTools?.external === 'boolean' ? stored.referenceTools.external : STUDY_DEFAULTS.referenceTools.external,
        google: typeof stored.referenceTools?.google === 'boolean' ? stored.referenceTools.google : STUDY_DEFAULTS.referenceTools.google,
        images: typeof stored.referenceTools?.images === 'boolean' ? stored.referenceTools.images : STUDY_DEFAULTS.referenceTools.images,
        jp: typeof stored.referenceTools?.jp === 'boolean' ? stored.referenceTools.jp : STUDY_DEFAULTS.referenceTools.jp
      },
      readAloud: {
        defaultTarget: ['definition','example','synonyms','notes'].includes(stored.readAloud?.defaultTarget) ? stored.readAloud.defaultTarget : STUDY_DEFAULTS.readAloud.defaultTarget,
        targets: {
          definition: typeof stored.readAloud?.targets?.definition === 'boolean' ? stored.readAloud.targets.definition : STUDY_DEFAULTS.readAloud.targets.definition,
          example: typeof stored.readAloud?.targets?.example === 'boolean' ? stored.readAloud.targets.example : STUDY_DEFAULTS.readAloud.targets.example,
          synonyms: typeof stored.readAloud?.targets?.synonyms === 'boolean' ? stored.readAloud.targets.synonyms : STUDY_DEFAULTS.readAloud.targets.synonyms,
          notes: typeof stored.readAloud?.targets?.notes === 'boolean' ? stored.readAloud.targets.notes : STUDY_DEFAULTS.readAloud.targets.notes,
          all: typeof stored.readAloud?.targets?.all === 'boolean' ? stored.readAloud.targets.all : STUDY_DEFAULTS.readAloud.targets.all
        }
      },
      display: {
        helperLabels: typeof stored.display?.helperLabels === 'boolean' ? stored.display.helperLabels : STUDY_DEFAULTS.display.helperLabels,
        shuffle: typeof stored.display?.shuffle === 'boolean' ? stored.display.shuffle : STUDY_DEFAULTS.display.shuffle,
        recording: typeof stored.display?.recording === 'boolean' ? stored.display.recording : STUDY_DEFAULTS.display.recording
      },
      swipe: typeof stored.swipe === 'boolean' ? stored.swipe : STUDY_DEFAULTS.swipe
    };
  }

  function saveStudyPrefs() {
    const stored = safeParse(localStorage.getItem(STUDY_PREF_KEY));
    const merged = {
      ...stored,
      ...studyPrefs,
      custom: { ...(stored.custom || {}), ...studyPrefs.custom },
      youglish: { ...(stored.youglish || {}), ...studyPrefs.youglish },
      referenceTools: { ...(stored.referenceTools || {}), ...studyPrefs.referenceTools },
      readAloud: {
        ...(stored.readAloud || {}),
        ...studyPrefs.readAloud,
        targets: { ...(stored.readAloud?.targets || {}), ...studyPrefs.readAloud.targets }
      },
      display: { ...(stored.display || {}), ...studyPrefs.display }
    };
    localStorage.setItem(STUDY_PREF_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
    renderStudy();
    renderSummaries();
    renderResources();
  }

  function activeSectionFromHash() {
    const key = String(location.hash || '').replace(/^#/, '').toLowerCase();
    return ['general','study','practice','progress','resources','data'].includes(key) ? key : 'general';
  }

  function showSection(section, pushHash = true) {
    const safe = ['general','study','practice','progress','resources','data'].includes(section) ? section : 'general';
    $$('[data-settings-section]').forEach(button => button.classList.toggle('is-active', button.dataset.settingsSection === safe));
    $$('[data-settings-panel]').forEach(panel => {
      const active = panel.dataset.settingsPanel === safe;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if (pushHash && location.hash !== `#${safe}`) history.replaceState(null, '', `#${safe}`);
    window.scrollTo({ top:0, behavior:'auto' });
  }

  function currentRole() {
    return localStorage.getItem(ROLE_KEY) === 'admin' || sessionStorage.getItem(SESSION_ROLE_KEY) === 'admin' ? 'admin' : 'guest';
  }

  function renderRole() {
    const admin = currentRole() === 'admin';
    if ($('settings-role-chip')) $('settings-role-chip').textContent = admin ? 'Admin' : 'Guest';
    if ($('settings-authoring-state')) $('settings-authoring-state').textContent = admin ? 'Available in Admin mode' : 'Locked in Guest mode';
    if ($('settings-editor-access')) $('settings-editor-access').textContent = admin ? 'Admin mode available' : 'Admin access required';
  }

  function currentStudyMode() {
    return localStorage.getItem(CARD_MODE_KEY) === 'definition' ? 'definition' : 'word';
  }

  function renderStudy() {
    studyPrefs = loadStudyPrefs();
    $$('[data-settings-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsPreset === studyPrefs.contentPreset)));
    if ($('study-preset-value')) $('study-preset-value').textContent = studyPrefs.contentPreset.charAt(0).toUpperCase() + studyPrefs.contentPreset.slice(1);
    if ($('study-preset-description')) $('study-preset-description').textContent = PRESET_DESCRIPTIONS[studyPrefs.contentPreset] || '';
    if ($('study-custom-panel')) $('study-custom-panel').hidden = studyPrefs.contentPreset !== 'custom';
    $$('[data-settings-custom]').forEach(select => { select.value = studyPrefs.custom[select.dataset.settingsCustom]; });
    $$('[data-settings-detail]').forEach(input => { input.checked = Boolean(studyPrefs.custom[input.dataset.settingsDetail]); });

    const mode = currentStudyMode();
    $$('[data-settings-side]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsSide === mode)));
    if ($('study-side-value')) $('study-side-value').textContent = mode === 'definition' ? 'Definition First' : 'Word First';

    $$('[data-settings-display]').forEach(input => { input.checked = Boolean(studyPrefs.display[input.dataset.settingsDisplay]); });
    $$('[data-settings-reference]').forEach(input => { input.checked = Boolean(studyPrefs.referenceTools[input.dataset.settingsReference]); });
    $$('[data-settings-read-target]').forEach(input => { input.checked = Boolean(studyPrefs.readAloud.targets[input.dataset.settingsReadTarget]); });
    if ($('settings-read-default')) $('settings-read-default').value = studyPrefs.readAloud.defaultTarget;
    if ($('settings-youglish-visible')) $('settings-youglish-visible').checked = studyPrefs.youglish.visible;
    $$('[data-settings-accent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsAccent === studyPrefs.youglish.accent)));
    if ($('youglish-value')) $('youglish-value').textContent = studyPrefs.youglish.visible ? `YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}` : 'YouGlish · Hidden';
    if ($('settings-swipe')) $('settings-swipe').checked = studyPrefs.swipe;
    renderVoiceSelect();
  }

  function voiceLabel(voice) {
    if (!voice) return 'System default';
    const locale = String(voice.lang || '').replace('_','-');
    const match = locale.match(/^en-([A-Za-z]{2})$/i);
    let region = locale;
    if (match) {
      const code = match[1].toUpperCase();
      region = ({US:'US',GB:'UK',AU:'AU',CA:'CA',IE:'IE',NZ:'NZ',IN:'IN',ZA:'ZA'})[code] || code;
    }
    return region ? `${voice.name} · ${region}` : voice.name;
  }

  function availableStudyVoices() {
    if (!('speechSynthesis' in window)) return [];
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return [];
    const preferred = [];
    PREFERRED_VOICE_NAMES.forEach(name => {
      const exact = voices.find(v => v?.name === name && /^en(?:-|_)/i.test(v.lang || ''));
      if (exact) preferred.push(exact);
    });
    if (preferred.length) return preferred;
    const counts = new Map();
    voices.forEach(v => { if (v?.name) counts.set(v.name, (counts.get(v.name) || 0) + 1); });
    const seen = new Set();
    return voices.filter(v => {
      if (!v?.name || !/^en(?:-|_)/i.test(v.lang || '')) return false;
      if (NOVELTY_VOICE_RE.test(v.name)) return false;
      if ((counts.get(v.name) || 0) > 1 || seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    }).slice(0, 8);
  }

  function renderVoiceSelect() {
    const select = $('settings-study-voice');
    if (!select) return;
    const current = localStorage.getItem(VOICE_KEY) || '';
    const voices = availableStudyVoices();
    const options = ['<option value="">System default</option>'];
    voices.forEach(voice => options.push(`<option value="${escapeAttr(voice.name)}">${escapeHtml(voiceLabel(voice))}</option>`));
    if (current && !voices.some(v => v.name === current)) options.push(`<option value="${escapeAttr(current)}">${escapeHtml(current)} · saved</option>`);
    select.innerHTML = options.join('');
    select.value = current;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  function readProgressPrefs() {
    const parsed = safeParse(localStorage.getItem(PROGRESS_OPTIONS_KEY));
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function renderProgressOptions() {
    const host = $('settings-progress-options');
    if (!host) return;
    const saved = readProgressPrefs();
    host.innerHTML = Object.entries(PROGRESS_OPTIONS).map(([group, items]) => `
      <section class="settings-progress-group">
        <h3>${escapeHtml(group)}</h3>
        ${items.map(([key,label]) => `<label class="settings-switch-row"><span><strong>${escapeHtml(label)}</strong></span><input type="checkbox" data-settings-progress-option="${escapeAttr(key)}" ${saved[key] === false ? '' : 'checked'}></label>`).join('')}
      </section>`).join('');
    $$('[data-settings-progress-option]').forEach(input => input.addEventListener('change', () => {
      const next = readProgressPrefs();
      next[input.dataset.settingsProgressOption] = input.checked;
      localStorage.setItem(PROGRESS_OPTIONS_KEY, JSON.stringify(next));
      renderSummaries();
    }));
  }

  function renderPractice() {
    const mode = localStorage.getItem(PRACTICE_MODE_KEY) === 'ai' ? 'ai' : 'standard';
    if ($('settings-practice-mode')) $('settings-practice-mode').value = mode;
    if ($('practice-mode-value')) $('practice-mode-value').textContent = mode === 'ai' ? 'AI Practice' : 'Standard Practice';

    const standard = Number(localStorage.getItem(STANDARD_SIZE_KEY));
    if ($('settings-standard-size')) $('settings-standard-size').value = [5,10,20].includes(standard) ? String(standard) : '';
    const ai = Number(localStorage.getItem(AI_SIZE_KEY));
    if ($('settings-ai-size')) $('settings-ai-size').value = [1,3,5,10,20].includes(ai) ? String(ai) : '';
    const hintRaw = localStorage.getItem(AI_HINT_KEY);
    const hints = hintRaw == null ? 4 : Number(hintRaw);
    if ($('settings-ai-hints')) $('settings-ai-hints').value = [0,2,4,6].includes(hints) ? String(hints) : '4';
  }

  function renderResources() {
    const host = $('settings-resource-readout');
    if (!host) return;
    const entries = [
      ['External Reference', studyPrefs.referenceTools.external],
      ['Google', studyPrefs.referenceTools.google],
      ['Images', studyPrefs.referenceTools.images],
      ['JP Reference', studyPrefs.referenceTools.jp],
      [`YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}`, studyPrefs.youglish.visible]
    ];
    host.innerHTML = entries.map(([label,on]) => `<div class="settings-resource-pill"><span>${escapeHtml(label)}</span><em>${on ? 'Shown' : 'Hidden'}</em></div>`).join('');
    const count = entries.filter(([,on]) => on).length;
    if ($('resources-reference-count')) $('resources-reference-count').textContent = `${count} enabled`;
  }

  function renderSummaries() {
    const mode = currentStudyMode();
    if ($('summary-study')) $('summary-study').textContent = `${studyPrefs.contentPreset.charAt(0).toUpperCase() + studyPrefs.contentPreset.slice(1)} · ${mode === 'definition' ? 'Definition First' : 'Word First'}`;
    const practiceMode = localStorage.getItem(PRACTICE_MODE_KEY) === 'ai' ? 'AI Practice' : 'Standard Practice';
    if ($('summary-practice')) $('summary-practice').textContent = practiceMode;
    const progressSaved = readProgressPrefs();
    const hiddenCount = Object.values(progressSaved).filter(value => value === false).length;
    if ($('summary-progress')) $('summary-progress').textContent = hiddenCount ? `${hiddenCount} panel${hiddenCount === 1 ? '' : 's'} hidden` : 'Default dashboard';
    if ($('summary-resources')) $('summary-resources').textContent = studyPrefs.youglish.visible ? `YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}` : 'YouGlish hidden';
  }

  function bindStudy() {
    $$('[data-settings-preset]').forEach(button => button.addEventListener('click', () => {
      studyPrefs.contentPreset = button.dataset.settingsPreset;
      saveStudyPrefs();
    }));
    $$('[data-settings-custom]').forEach(select => select.addEventListener('change', () => {
      studyPrefs.custom[select.dataset.settingsCustom] = select.value;
      saveStudyPrefs();
    }));
    $$('[data-settings-detail]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.custom[input.dataset.settingsDetail] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-side]').forEach(button => button.addEventListener('click', () => {
      localStorage.setItem(CARD_MODE_KEY, button.dataset.settingsSide === 'definition' ? 'definition' : 'word');
      window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
      renderStudy();
      renderSummaries();
    }));
    $$('[data-settings-display]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.display[input.dataset.settingsDisplay] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-reference]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.referenceTools[input.dataset.settingsReference] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-read-target]').forEach(input => input.addEventListener('change', () => {
      const key = input.dataset.settingsReadTarget;
      if (key === 'all') {
        studyPrefs.readAloud.targets.all = input.checked;
      } else {
        const keys = ['definition','example','synonyms','notes'];
        const next = { ...studyPrefs.readAloud.targets, [key]:input.checked };
        if (!keys.some(candidate => next[candidate])) {
          input.checked = true;
          return;
        }
        studyPrefs.readAloud.targets[key] = input.checked;
        if (!studyPrefs.readAloud.targets[studyPrefs.readAloud.defaultTarget]) {
          studyPrefs.readAloud.defaultTarget = keys.find(candidate => studyPrefs.readAloud.targets[candidate]) || 'example';
        }
      }
      saveStudyPrefs();
    }));
    $('settings-read-default')?.addEventListener('change', event => {
      const key = event.target.value;
      if (!studyPrefs.readAloud.targets[key]) studyPrefs.readAloud.targets[key] = true;
      studyPrefs.readAloud.defaultTarget = key;
      saveStudyPrefs();
    });
    $('settings-youglish-visible')?.addEventListener('change', event => {
      studyPrefs.youglish.visible = event.target.checked;
      saveStudyPrefs();
    });
    $$('[data-settings-accent]').forEach(button => button.addEventListener('click', () => {
      studyPrefs.youglish.accent = button.dataset.settingsAccent;
      saveStudyPrefs();
    }));
    $('settings-swipe')?.addEventListener('change', event => {
      studyPrefs.swipe = event.target.checked;
      saveStudyPrefs();
    });
    $('settings-study-voice')?.addEventListener('change', event => {
      localStorage.setItem(VOICE_KEY, event.target.value || '');
      window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
      renderVoiceSelect();
    });
    $('open-study-options')?.addEventListener('click', () => window.WLPStudyOptions?.open?.());
  }

  function bindPractice() {
    $('settings-practice-mode')?.addEventListener('change', event => {
      const value = event.target.value === 'ai' ? 'ai' : 'standard';
      localStorage.setItem(PRACTICE_MODE_KEY, value);
      renderPractice();
      renderSummaries();
    });
    $('settings-standard-size')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      if ([5,10,20].includes(value)) localStorage.setItem(STANDARD_SIZE_KEY, String(value));
      else localStorage.removeItem(STANDARD_SIZE_KEY);
      renderPractice();
    });
    $('settings-ai-size')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      if ([1,3,5,10,20].includes(value)) localStorage.setItem(AI_SIZE_KEY, String(value));
      else localStorage.removeItem(AI_SIZE_KEY);
      renderPractice();
    });
    $('settings-ai-hints')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      localStorage.setItem(AI_HINT_KEY, String([0,2,4,6].includes(value) ? value : 4));
      renderPractice();
    });
  }

  function init() {
    $$('[data-settings-section]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.settingsSection)));
    $$('[data-settings-jump]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.settingsJump)));
    window.addEventListener('hashchange', () => showSection(activeSectionFromHash(), false));

    bindStudy();
    bindPractice();
    renderStudy();
    renderPractice();
    renderProgressOptions();
    renderResources();
    renderRole();
    renderSummaries();
    showSection(activeSectionFromHash(), false);

    $('settings-progress-reset')?.addEventListener('click', () => {
      localStorage.removeItem(PROGRESS_OPTIONS_KEY);
      renderProgressOptions();
      renderSummaries();
    });

    window.addEventListener('wlp:study-options-changed', () => {
      studyPrefs = loadStudyPrefs();
      renderStudy();
      renderResources();
      renderSummaries();
    });
    window.addEventListener('storage', () => {
      studyPrefs = loadStudyPrefs();
      renderStudy();
      renderPractice();
      renderProgressOptions();
      renderResources();
      renderRole();
      renderSummaries();
    });

    const roleLabel = $('role-label');
    if (roleLabel) new MutationObserver(() => { renderRole(); }).observe(roleLabel, { childList:true, subtree:true, characterData:true });

    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', renderVoiceSelect);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
