/* WLP Stage 7 v1.8.6.119 — Classification View Card Navigation. */
(() => {
  'use strict';

  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260924-s7-classification-v186118';
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const CARD_FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const api = window.WLPClassificationMetadata;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const normalize = value => String(value ?? '').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

  const ENTRY_TYPES = [
    'word','phrase','idiom','phrasal verb','collocation','construction','term','proper noun',
    'abbreviation','initialism','interjection','contrast set','polysemy set','sentence pattern',
    'response formula','rhetorical question pattern','meme construction','discourse expression',
    'internet term','fandom term','slang expression','metaphor','verb pattern','noun phrase','adjective phrase'
  ];
  const USAGE_TAGS = [
    'formal','informal','casual','colloquial','conversational','slang','internet slang','literary',
    'academic','technical','dated','archaic','humorous','playful','figurative','evaluative','critical',
    'derogatory','disparaging','offensive','profane','vulgar','affectionate','warm','skeptical','speculative',
    'American English','British English','North American English','Gen Z'
  ];
  const TOPIC_TAGS = [
    'everyday life','business','work','workplace','travel','shopping','family','friends','relationships','dating',
    'romance','communication','education','technology','security','internet','social media','media','news','anime',
    'manga','fandom','games','law','science','research','psychology','mental health','self-help','health','wellness',
    'food','restaurants','hospitality','culture','art','fashion','music','finance','planning','decision-making'
  ];

  let masterSourceRows = [];
  let masterRows = [];
  let draftRows = [];
  let itemByKey = new Map();
  let activeKey = '';
  let working = null;
  let loadError = '';

  function parseTSV(text) {
    const table = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i++; }
        else quoted = !quoted;
        continue;
      }
      if (ch === '\t' && !quoted) { row.push(field); field = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(field);
        if (row.some(value => String(value).trim())) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(value => String(value).trim())) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(value => String(value || '').trim());
    return table.slice(1).map(cols => Object.fromEntries(headers.map((header, index) => [header, String(cols[index] ?? '').trim()])));
  }

  function readObject(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed ?? fallback;
    } catch { return fallback; }
  }

  function readDrafts() {
    const value = readObject(LOCAL_ADDITIONS_KEY, []);
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  function readOverrides() {
    const value = readObject(LOCAL_OVERRIDES_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function applyOverride(row, overrides) {
    const wid = String(row?.WordID || '').trim();
    const override = wid ? overrides[wid] : null;
    if (!override || typeof override !== 'object' || Array.isArray(override)) return {...row, __hasLocalEdit:false};
    const next = {...row, __hasLocalEdit:true};
    CARD_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(override, field)) next[field] = String(override[field] ?? '');
    });
    return next;
  }

  function itemFromMaster(row, overrides) {
    const effective = applyOverride(row, overrides);
    const wid = String(effective.WordID || '').trim();
    const key = api.makeMasterKey(wid);
    const record = api.get(key);
    const item = {
      key,
      isMaster:true,
      wid,
      localId:'',
      row:effective,
      word:String(effective.Word || '').trim() || `WID${wid}`,
      label:`WID${wid}`,
      record
    };
    item.searchText = searchText(item);
    return item;
  }

  function itemFromDraft(row, index) {
    const localId = String(row?.localId || row?.LocalID || '').trim();
    if (!localId) return null;
    const key = api.makeDraftKey(localId);
    const item = {
      key,
      isMaster:false,
      wid:'',
      localId,
      row:{...row, __hasLocalEdit:false},
      word:String(row.Word || '').trim() || 'Untitled Draft',
      label:'Draft',
      record:api.get(key),
      draftIndex:index
    };
    item.searchText = searchText(item);
    return item;
  }

  function searchText(item) {
    const row = item.row || {};
    const record = item.record || {};
    return normalize([
      item.word,
      item.label,
      item.wid ? `wid${item.wid}` : '',
      item.wid ? `wid ${item.wid}` : '',
      row['Part of Speech'], row.Definition, row['Synonym(s)'], row['Example Sentence'], row['Note(s)'], row.Category,
      ...(record.entryTypes || []), ...(record.usageTags || []), ...(record.topicTags || []), ...(record.discoveryTags || [])
    ].join(' '));
  }

  function parseWidQuery(value) {
    const match = String(value || '').trim().match(/^(?:wid\s*:?\s*)?(\d+)$/i);
    return match ? String(Number(match[1])) : '';
  }

  function shorten(value, max = 230) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
  }

  function cardHref(item) {
    if (!item) return './deck-browser.html';
    if (!item.isMaster) {
      const index = Number(item.draftIndex || 0);
      const deck = Math.floor(index / 10) + 1;
      const params = new URLSearchParams();
      params.set('draft', String(deck));
      if (item.localId) params.set('localid', item.localId);
      return `./flashcards/wlp/batch.html?${params.toString()}`;
    }
    const batch = String(item.row?.['Batch #'] || '').trim();
    const wid = String(item.wid || '').trim();
    if (!batch || !wid) return './deck-browser.html';
    const params = new URLSearchParams();
    params.set('batch', String(Number(batch) || batch));
    params.set('wordid', wid);
    return `./flashcards/wlp/batch.html?${params.toString()}`;
  }

  function refreshIndex() {
    const overrides = readOverrides();
    masterRows = masterSourceRows.map(row => itemFromMaster(row, overrides));
    draftRows = readDrafts().map(itemFromDraft).filter(Boolean);
    itemByKey = new Map([...masterRows, ...draftRows].map(item => [item.key, item]));
  }

  function classificationSummary(record) {
    const groups = [
      ['Type', record.entryTypes],
      ['Usage', record.usageTags],
      ['Topic', record.topicTags],
      ['Discovery', record.discoveryTags]
    ];
    return groups.map(([label, values]) => {
      if (!Array.isArray(values) || !values.length) return '';
      const visible = values.slice(0, label === 'Discovery' ? 4 : 3);
      const more = values.length - visible.length;
      return `<div class="classification-summary-row"><span>${esc(label)}</span><div>${visible.map(tag => `<em>${esc(tag)}</em>`).join('')}${more > 0 ? `<small>+${more}</small>` : ''}</div></div>`;
    }).join('');
  }

  function resultCard(item) {
    const row = item.row || {};
    const record = item.record || {};
    const hasData = api.hasClassification(record);
    const pos = String(row['Part of Speech'] || '').trim();
    const updated = formatDate(record.updatedAt);
    const meta = [item.label, pos, row.__hasLocalEdit ? 'Local Edit active' : '', updated ? `Updated ${updated}` : ''].filter(Boolean).join(' · ');
    const definition = shorten(row.Definition, 260);
    return `<article class="classification-result-card${item.key === activeKey ? ' is-active' : ''}" data-classification-key="${esc(item.key)}">
      <div class="classification-result-main">
        <div class="classification-result-word">${esc(item.word)}</div>
        <div class="classification-result-meta">${esc(meta)}</div>
        ${definition ? `<p class="classification-result-definition">${esc(definition)}</p>` : ''}
        ${hasData ? `<div class="classification-summary">${classificationSummary(record)}</div>` : '<p class="classification-unclassified">No Classification Metadata yet.</p>'}
      </div>
      <div class="classification-result-actions">
        <button type="button" class="classification-edit-button" data-classification-edit="${esc(item.key)}">${hasData ? 'Edit Classification' : 'Classify'}</button>
        <a class="classification-view-card" href="${esc(cardHref(item))}">View Card</a>
      </div>
      ${item.key === activeKey ? editorPanel(item) : ''}
    </article>`;
  }

  function referenceRow(label, value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    return `<div class="classification-reference-row"><span>${esc(label)}</span><p>${esc(clean)}</p></div>`;
  }

  function getLearningEntryType(item) {
    const hooks = window.WLPLearningHooks;
    if (!hooks) return '';
    try {
      const meta = item.isMaster ? hooks.getForMaster?.(item.wid) : hooks.getForDraft?.(item.localId);
      return String(meta?.entryType || '').trim();
    } catch { return ''; }
  }

  function tagField(field, title, helper, placeholder) {
    return `<section class="classification-tag-field" data-classification-field="${esc(field)}">
      <div class="classification-tag-field-head"><div><h3>${esc(title)}</h3><p>${esc(helper)}</p></div></div>
      <div class="classification-chips" data-classification-chips="${esc(field)}"></div>
      <div class="classification-add-row">
        <input type="text" data-classification-input="${esc(field)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(placeholder)}" aria-label="Add ${esc(title)}">
        <button type="button" data-classification-add="${esc(field)}">Add</button>
      </div>
      <div class="classification-suggestions" data-classification-suggestions="${esc(field)}"></div>
    </section>`;
  }

  function editorPanel(item) {
    const row = item.row || {};
    const learningType = getLearningEntryType(item);
    const workingTypes = working?.entryTypes || [];
    const showLearningImport = learningType && !workingTypes.some(value => normalize(value) === normalize(learningType));
    return `<div class="classification-editor" data-classification-editor="${esc(item.key)}">
      <div class="classification-editor-head">
        <div><span class="section-kicker">Classification</span><h2>${esc(item.word)}</h2></div>
        <button type="button" class="classification-editor-close" data-classification-close aria-label="Close Classification editor">×</button>
      </div>

      <section class="classification-reference" aria-label="Card reference">
        <div class="classification-reference-head"><div><strong>Card Reference</strong><span>Read-only · Classification does not change card text.</span></div><span class="classification-readonly-pill">Read only</span></div>
        ${referenceRow('POS', row['Part of Speech'])}
        ${referenceRow('Definition', row.Definition)}
        <details class="classification-reference-more">
          <summary>Show Synonyms, Examples, Notes & Legacy Category</summary>
          <div class="classification-reference-more-body">
            ${referenceRow('Synonyms', row['Synonym(s)'])}
            ${referenceRow('Example', row['Example Sentence'])}
            ${referenceRow('Notes', row['Note(s)'])}
            ${referenceRow('Legacy Category', row.Category)}
          </div>
        </details>
      </section>

      ${showLearningImport ? `<div class="classification-learning-type"><div><strong>Existing Learning Metadata Entry Type</strong><span>${esc(learningType)}</span></div><button type="button" data-import-learning-type="${esc(learningType)}">Use in Classification</button></div>` : ''}

      <div class="classification-fields">
        ${tagField('entryTypes', 'Entry Type', 'Structural type. Keep this comparatively controlled; multiple values are allowed when useful.', 'word, phrase, term…')}
        ${tagField('usageTags', 'Usage Tags', 'Register, tone, region, social usage, and similar characteristics.', 'casual, colloquial, BrE…')}
        ${tagField('topicTags', 'Topic Tags', 'Domains, situations, life areas, and subjects where you may want to find this card later.', 'travel, business, relationships…')}
        ${tagField('discoveryTags', 'Discovery Tags', 'Flexible search hooks: meanings, situations, functions, associations, and ways you may remember the card.', 'warning, office gossip, online shopping…')}
      </div>

      <div class="classification-save-bar">
        <p class="classification-save-status" data-classification-save-status>Saved separately from the Master and Learning Metadata.</p>
        <div class="classification-save-actions">
          <button type="button" class="classification-cancel" data-classification-close>Close</button>
          <button type="button" class="classification-save" data-classification-save>Save Classification</button>
          <button type="button" class="classification-save-view" data-classification-save-view>Save &amp; View Card</button>
        </div>
      </div>
    </div>`;
  }

  function currentSuggestions(field, query = '') {
    const staticMap = {entryTypes:ENTRY_TYPES, usageTags:USAGE_TAGS, topicTags:TOPIC_TAGS, discoveryTags:[]};
    const merged = api.uniqueTags([...(staticMap[field] || []), ...api.tagsFor(field)]);
    const chosen = new Set((working?.[field] || []).map(normalize));
    const needle = normalize(query);
    const filtered = merged.filter(tag => !chosen.has(normalize(tag)) && (!needle || normalize(tag).includes(needle)));
    return filtered.slice(0, field === 'discoveryTags' ? 10 : 14);
  }

  function refreshTagField(field, focusInput = false) {
    const panel = document.querySelector(`[data-classification-editor="${CSS.escape(activeKey)}"]`);
    if (!panel || !working) return;
    const chips = panel.querySelector(`[data-classification-chips="${field}"]`);
    const input = panel.querySelector(`[data-classification-input="${field}"]`);
    const suggestions = panel.querySelector(`[data-classification-suggestions="${field}"]`);
    if (chips) {
      const values = working[field] || [];
      chips.innerHTML = values.length
        ? values.map((tag, index) => `<span class="classification-chip">${esc(tag)}<button type="button" data-classification-remove="${esc(field)}" data-classification-index="${index}" aria-label="Remove ${esc(tag)}">×</button></span>`).join('')
        : '<span class="classification-chip-empty">None yet</span>';
    }
    if (suggestions && input) {
      const values = currentSuggestions(field, input.value);
      suggestions.innerHTML = values.length
        ? `<span class="classification-suggestions-label">Suggestions</span>${values.map(tag => `<button type="button" data-classification-suggestion="${esc(field)}" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('')}`
        : '';
    }
    if (focusInput) input?.focus();
  }

  function refreshAllFields() {
    api.ARRAY_FIELDS.forEach(field => refreshTagField(field));
  }

  function addTags(field, raw) {
    if (!working || !api.ARRAY_FIELDS.includes(field)) return;
    const values = String(raw || '').split('|').map(api.cleanTag).filter(Boolean);
    if (!values.length) return;
    working[field] = api.uniqueTags([...(working[field] || []), ...values]);
    const input = document.querySelector(`[data-classification-editor="${CSS.escape(activeKey)}"] [data-classification-input="${field}"]`);
    if (input) input.value = '';
    refreshTagField(field, true);
  }

  function workingCopy(record) {
    return {
      entryTypes:[...(record?.entryTypes || [])],
      usageTags:[...(record?.usageTags || [])],
      topicTags:[...(record?.topicTags || [])],
      discoveryTags:[...(record?.discoveryTags || [])]
    };
  }

  function openEditor(key) {
    const item = itemByKey.get(key);
    if (!item) return;
    activeKey = key;
    working = workingCopy(api.get(key));
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[data-classification-key="${CSS.escape(key)}"]`)?.scrollIntoView({block:'nearest', behavior:'smooth'});
      refreshAllFields();
    });
  }

  function closeEditor() {
    activeKey = '';
    working = null;
    render();
  }

  function saveActive() {
    const item = itemByKey.get(activeKey);
    if (!item || !working) return false;
    const saved = api.save(activeKey, {
      ...working,
      ...(item.isMaster ? {wordId:item.wid} : {localDraftId:item.localId})
    });
    item.record = saved;
    item.searchText = searchText(item);
    working = workingCopy(saved);
    const status = document.querySelector(`[data-classification-editor="${CSS.escape(activeKey)}"] [data-classification-save-status]`);
    if (status) {
      status.textContent = 'Saved on this device.';
      status.classList.add('is-saved');
      setTimeout(() => status.classList.remove('is-saved'), 1400);
    }
    syncCount();
    renderSummaryForActive();
    return true;
  }

  function saveAndViewActive() {
    const item = itemByKey.get(activeKey);
    if (!item || !working) return;
    const href = cardHref(item);
    if (!saveActive()) return;
    location.href = href;
  }

  function renderSummaryForActive() {
    const article = document.querySelector(`[data-classification-key="${CSS.escape(activeKey)}"]`);
    const item = itemByKey.get(activeKey);
    if (!article || !item) return;
    const main = article.querySelector('.classification-result-main');
    if (!main) return;
    const old = main.querySelector('.classification-summary, .classification-unclassified');
    if (!old) return;
    const record = api.get(activeKey);
    item.record = record;
    const wrap = document.createElement('div');
    if (api.hasClassification(record)) {
      wrap.className = 'classification-summary';
      wrap.innerHTML = classificationSummary(record);
    } else {
      wrap.className = 'classification-unclassified';
      wrap.textContent = 'No Classification Metadata yet.';
    }
    old.replaceWith(wrap);
  }

  function resolvedClassifiedItems() {
    return Object.entries(api.all()).map(([key, record]) => {
      const item = itemByKey.get(key);
      if (!item) return null;
      item.record = record;
      item.searchText = searchText(item);
      return item;
    }).filter(Boolean).sort((a, b) => (Date.parse(b.record?.updatedAt || '') || 0) - (Date.parse(a.record?.updatedAt || '') || 0));
  }

  function currentResults() {
    const raw = String($('classification-search')?.value || '').trim();
    const query = normalize(raw);
    const widQuery = parseWidQuery(raw);
    if (!query) return resolvedClassifiedItems().slice(0, 40);
    if (widQuery) return masterRows.filter(item => item.wid === widQuery).slice(0, 20);
    return [...masterRows, ...draftRows].filter(item => item.searchText.includes(query)).slice(0, 50);
  }

  function syncCount() {
    const pill = $('classification-count-pill');
    if (pill) {
      const count = api.count();
      pill.textContent = `${count} Classified Card${count === 1 ? '' : 's'}`;
    }
  }

  function render() {
    const list = $('classification-results');
    const empty = $('classification-empty');
    const meta = $('classification-results-meta');
    const warning = $('classification-load-warning');
    if (!list || !empty) return;

    refreshIndex();
    const raw = String($('classification-search')?.value || '').trim();
    const results = currentResults();
    syncCount();

    if (warning) {
      warning.hidden = !loadError;
      warning.textContent = loadError;
    }

    if (meta) {
      if (raw) meta.textContent = `${results.length} result${results.length === 1 ? '' : 's'} shown · up to 50 per search.`;
      else {
        const count = api.count();
        meta.textContent = count ? `Showing recently updated Classification Metadata · ${count} classified card${count === 1 ? '' : 's'} total.` : 'Search a word or WID to classify a Master card or Draft.';
      }
    }

    if (!results.length) {
      list.innerHTML = '';
      empty.hidden = false;
      const title = empty.querySelector('h2');
      const copy = empty.querySelector('p');
      if (raw) {
        if (title) title.textContent = 'No matching cards';
        if (copy) copy.textContent = 'Try another word, phrase, or WID.';
      } else {
        if (title) title.textContent = 'No Classification Metadata yet';
        if (copy) copy.textContent = 'Search for a card above, then add Entry Type, Usage, Topic, or Discovery tags.';
      }
      return;
    }

    empty.hidden = true;
    list.innerHTML = results.map(resultCard).join('');
    if (activeKey) requestAnimationFrame(refreshAllFields);
  }

  async function load() {
    if (!api) {
      loadError = 'Classification Metadata engine is unavailable.';
      render();
      return;
    }
    try {
      const response = await fetch(TSV_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`TSV ${response.status}`);
      masterSourceRows = parseTSV(await response.text());
    } catch (error) {
      console.error('Classification Master load failed:', error);
      masterSourceRows = [];
      masterRows = [];
      loadError = 'The Master TSV could not be loaded. Classification records already saved on this device remain intact.';
    }
    render();
  }

  $('classification-search')?.addEventListener('input', () => {
    activeKey = '';
    working = null;
    render();
  });
  $('classification-clear')?.addEventListener('click', () => {
    const input = $('classification-search');
    if (!input) return;
    input.value = '';
    activeKey = '';
    working = null;
    render();
    input.focus();
  });

  document.addEventListener('click', event => {
    const edit = event.target.closest('[data-classification-edit]');
    if (edit) { openEditor(edit.getAttribute('data-classification-edit')); return; }
    if (event.target.closest('[data-classification-close]')) { closeEditor(); return; }
    if (event.target.closest('[data-classification-save-view]')) { saveAndViewActive(); return; }
    if (event.target.closest('[data-classification-save]')) { saveActive(); return; }

    const add = event.target.closest('[data-classification-add]');
    if (add) {
      const field = add.getAttribute('data-classification-add');
      const input = document.querySelector(`[data-classification-editor="${CSS.escape(activeKey)}"] [data-classification-input="${field}"]`);
      addTags(field, input?.value || '');
      return;
    }

    const suggestion = event.target.closest('[data-classification-suggestion]');
    if (suggestion) {
      addTags(suggestion.getAttribute('data-classification-suggestion'), suggestion.getAttribute('data-tag'));
      return;
    }

    const remove = event.target.closest('[data-classification-remove]');
    if (remove && working) {
      const field = remove.getAttribute('data-classification-remove');
      const index = Number(remove.getAttribute('data-classification-index'));
      if (api.ARRAY_FIELDS.includes(field) && Number.isInteger(index)) {
        working[field].splice(index, 1);
        refreshTagField(field);
      }
      return;
    }

    const importButton = event.target.closest('[data-import-learning-type]');
    if (importButton) {
      addTags('entryTypes', importButton.getAttribute('data-import-learning-type'));
      importButton.closest('.classification-learning-type')?.remove();
    }
  });

  document.addEventListener('keydown', event => {
    const input = event.target.closest('[data-classification-input]');
    if (!input) return;
    const field = input.getAttribute('data-classification-input');
    if (event.key === 'Enter') {
      event.preventDefault();
      addTags(field, input.value);
    }
  });

  document.addEventListener('input', event => {
    const input = event.target.closest('[data-classification-input]');
    if (!input) return;
    refreshTagField(input.getAttribute('data-classification-input'));
  });

  window.addEventListener(api?.EVENT_NAME || 'wlp-classification-metadata-changed', () => {
    if (!activeKey) render();
    else syncCount();
  });
  window.addEventListener('storage', event => {
    if (!activeKey && [api?.STORAGE_KEY, LOCAL_ADDITIONS_KEY, LOCAL_OVERRIDES_KEY].includes(event.key)) render();
  });
  window.addEventListener('pageshow', () => { if (!activeKey) render(); });
  window.addEventListener('focus', () => { if (!activeKey) render(); });

  load();
})();
