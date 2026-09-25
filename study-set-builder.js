/* WLP Stage 7 v1.8.6.130 — Progressive metadata search + match reasons. */
(() => {
  'use strict';

  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const LOCAL_OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const TEMP_SET_KEY = 'wlp:temporary-study-set:v1';
  const BUILDER_STATE_KEY = 'wlp:study-set-builder-state:v1';
  const PREVIEW_LIMIT = 60;
  const COLLAPSED_TAG_LIMIT = 12;
  const api = window.WLPClassificationMetadata;
  const $ = id => document.getElementById(id);
  const AXES = [
    {field:'entryTypes', title:'Entry Type', placeholder:'Find Entry Type tags…'},
    {field:'usageTags', title:'Usage', placeholder:'Find Usage tags…'},
    {field:'topicTags', title:'Topic', placeholder:'Find Topic tags…'},
    {field:'discoveryTags', title:'Discovery', placeholder:'Find Discovery tags…'}
  ];
  const CARD_FIELDS = ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'];
  const TAXONOMY = {
    entryTypes:[
      'word','phrase','idiom','phrasal verb','collocation','construction','term','proper noun',
      'abbreviation','initialism','interjection','contrast set','polysemy set','sentence pattern',
      'response formula','rhetorical question pattern','meme construction','discourse expression',
      'internet term','fandom term','slang expression','nonce formation','verb pattern','noun phrase','adjective phrase'
    ],
    usageTags:[
      'formal','informal','casual','colloquial','conversational','slang','internet slang','literary',
      'academic','technical','dated','archaic','humorous','playful','figurative','evaluative','critical',
      'derogatory','disparaging','offensive','profane','vulgar','affectionate','warm','skeptical','speculative',
      'American English','British English','North American English','Gen Z','softening','ironic'
    ],
    topicTags:[
      'everyday life','business','work','workplace','travel','shopping','family','friends','relationships','dating',
      'romance','communication','education','technology','security','internet','social media','media','news','anime',
      'manga','fandom','games','law','science','research','psychology','mental health','self-help','health','wellness',
      'food','restaurants','hospitality','culture','art','fashion','music','finance','planning','decision-making',
      'language learning','testing','assessment','performance','entertainment','sports','problem-solving'
    ],
    discoveryTags:[
      'agreement','disagreement','soft correction','criticism','softened criticism','complaint','warning',
      'reassurance','encouragement','support','suggestion','recommendation','boundary-setting','expressing need','self-assessment',
      'uncertainty','speculation','possibility','lack of knowledge','hedging','impression','perception','subjective judgment','evaluation',
      'loyalty','betrayal','social trust','social approval','nonconformity','solidarity',
      'prevention','containment','removal','release','resolution','iteration','trial and error','minor adjustment','improvement','incremental improvement',
      'excessive emotion','emotional intensity','maximum effort','commitment','determination',
      'early stage','premature judgment','too soon to tell','prelude','precursor','escalation','continuity','building on success',
      'exploiting rules','gaming the system','loopholes','metric optimization','score vs ability'
    ]
  };

  let rows = [];
  let currentMatches = [];
  let searchStageSnapshots = [];
  let classificationRecords = {};
  const tagQueries = Object.fromEntries(AXES.map(axis => [axis.field, '']));
  const expandedAxes = new Set();

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const fold = value => clean(value).toLocaleLowerCase('en-US');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sortTags = values => [...values].sort((a,b) => a.localeCompare(b, undefined, {sensitivity:'base'}));

  function blankAxis() { return {include:[], exclude:[], mode:'any'}; }
  function blankSearchStage() { return {query:'', mode:'all'}; }
  function blankState() {
    return {searchStages:[blankSearchStage()], axes:Object.fromEntries(AXES.map(axis => [axis.field, blankAxis()]))};
  }

  function normalizeState(raw) {
    const next = blankState();
    const rawStages = Array.isArray(raw?.searchStages) && raw.searchStages.length
      ? raw.searchStages
      : (clean(raw?.search) ? [{query:raw.search, mode:'all'}] : []);
    next.searchStages = rawStages.length
      ? rawStages.map(stage => ({query:clean(stage?.query), mode:stage?.mode === 'any' ? 'any' : 'all'}))
      : [blankSearchStage()];
    AXES.forEach(axis => {
      const source = raw?.axes?.[axis.field] || {};
      next.axes[axis.field] = {
        include: api?.uniqueTags?.(Array.isArray(source.include) ? source.include : []) || [],
        exclude: api?.uniqueTags?.(Array.isArray(source.exclude) ? source.exclude : []) || [],
        mode: source.mode === 'all' ? 'all' : 'any'
      };
    });
    return next;
  }

  function loadState() {
    try { return normalizeState(JSON.parse(sessionStorage.getItem(BUILDER_STATE_KEY) || 'null')); }
    catch { return blankState(); }
  }

  let state = loadState();

  function saveState() {
    try { sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(state)); } catch {}
  }

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
        row = []; field = ''; continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(value => String(value).trim())) table.push(row);
    if (!table.length) return [];
    const header = table[0].map(value => String(value || '').trim());
    return table.slice(1).map(cols => {
      const obj = {};
      header.forEach((name, index) => { obj[name] = String(cols[index] ?? '').trim(); });
      return obj;
    });
  }

  function readOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_OVERRIDES_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function applyOverrides(sourceRows) {
    const overrides = readOverrides();
    return sourceRows.map(row => {
      const wid = clean(row.WordID);
      const override = wid ? overrides[wid] : null;
      if (!override || typeof override !== 'object' || Array.isArray(override)) return {...row};
      const next = {...row};
      CARD_FIELDS.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(override, field)) next[field] = String(override[field] ?? '');
      });
      return next;
    });
  }

  function emptyClassification() {
    return {entryTypes:[],usageTags:[],topicTags:[],discoveryTags:[]};
  }

  function refreshClassificationCache() {
    classificationRecords = api?.all?.() || {};
  }

  function classificationFor(row) {
    const wid = clean(row?.WordID);
    if (!wid || !api) return emptyClassification();
    return classificationRecords[api.makeMasterKey(wid)] || emptyClassification();
  }

  function searchableFields(row, record) {
    return [
      {label:'Word', value:row.Word},
      {label:'IPA', value:row.IPA},
      {label:'Part of Speech', value:row['Part of Speech']},
      {label:'Definition', value:row.Definition},
      {label:'Synonyms', value:row['Synonym(s)']},
      {label:'Example', value:row['Example Sentence']},
      {label:'Notes', value:row['Note(s)']},
      {label:'Category', value:row.Category},
      {label:'Source', value:row.Source},
      {label:'Entry Type', value:(record.entryTypes || []).join(' | ')},
      {label:'Usage', value:(record.usageTags || []).join(' | ')},
      {label:'Topic', value:(record.topicTags || []).join(' | ')},
      {label:'Discovery', value:(record.discoveryTags || []).join(' | ')}
    ];
  }

  function searchTerms(query) {
    const seen = new Set();
    return String(query || '').split(',').map(clean).filter(term => {
      const key = fold(term);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function termLocations(row, record, term) {
    const needle = fold(term);
    if (!needle) return [];
    return searchableFields(row, record)
      .filter(field => fold(field.value).includes(needle))
      .map(field => field.label);
  }

  function rowPassesSearchStage(row, stage) {
    const terms = searchTerms(stage?.query);
    if (!terms.length) return true;
    const record = classificationFor(row);
    const matches = terms.map(term => termLocations(row, record, term).length > 0);
    return stage?.mode === 'any' ? matches.some(Boolean) : matches.every(Boolean);
  }

  function hasSearchCriteria() {
    return state.searchStages.some(stage => searchTerms(stage.query).length);
  }

  function hasCriteria() {
    if (hasSearchCriteria()) return true;
    return AXES.some(axis => {
      const selection = state.axes[axis.field];
      return selection.include.length || selection.exclude.length;
    });
  }

  function recordPassesAxis(record, field) {
    const selection = state.axes[field];
    const values = new Set((record[field] || []).map(fold));
    const include = selection.include.map(fold);
    const exclude = selection.exclude.map(fold);
    if (exclude.some(tag => values.has(tag))) return false;
    if (!include.length) return true;
    return selection.mode === 'all'
      ? include.every(tag => values.has(tag))
      : include.some(tag => values.has(tag));
  }

  function computeSearchStages() {
    let candidates = rows.slice();
    searchStageSnapshots = state.searchStages.map((stage, index) => {
      const inputCount = candidates.length;
      const terms = searchTerms(stage.query);
      if (terms.length) candidates = candidates.filter(row => rowPassesSearchStage(row, stage));
      return {
        index,
        inputCount,
        count:candidates.length,
        terms,
        mode:stage.mode === 'any' ? 'any' : 'all'
      };
    });
    return candidates;
  }

  function computeMatches() {
    const searchMatches = computeSearchStages();
    currentMatches = searchMatches.filter(row => {
      const record = classificationFor(row);
      return AXES.every(axis => recordPassesAxis(record, axis.field));
    });
  }

  function matchReasonForRow(row) {
    const record = classificationFor(row);
    return state.searchStages.map((stage, index) => {
      const terms = searchTerms(stage.query);
      if (!terms.length) return null;
      const matchedTerms = terms.map(term => {
        const locations = termLocations(row, record, term);
        return locations.length ? {term, locations} : null;
      }).filter(Boolean);
      if (!matchedTerms.length) return null;
      return {index, matchedTerms};
    }).filter(Boolean);
  }

  function tagState(field, tag) {
    const selection = state.axes[field];
    const key = fold(tag);
    if (selection.include.some(value => fold(value) === key)) return 'include';
    if (selection.exclude.some(value => fold(value) === key)) return 'exclude';
    return 'neutral';
  }

  function cycleTag(field, tag) {
    const selection = state.axes[field];
    const key = fold(tag);
    const current = tagState(field, tag);
    selection.include = selection.include.filter(value => fold(value) !== key);
    selection.exclude = selection.exclude.filter(value => fold(value) !== key);
    if (current === 'neutral') selection.include.push(tag);
    else if (current === 'include') selection.exclude.push(tag);
    saveState();
    renderAll();
  }

  function setAxisMode(field, mode) {
    state.axes[field].mode = mode === 'all' ? 'all' : 'any';
    saveState();
    renderAll();
  }

  function allAxisTags(field) {
    const canonical = TAXONOMY[field] || [];
    const used = api?.tagsFor?.(field) || [];
    return sortTags(api?.uniqueTags?.([...canonical, ...used]) || [...canonical, ...used]);
  }

  function renderSearchStages() {
    const root = $('study-set-search-stages');
    if (!root) return;
    root.innerHTML = state.searchStages.map((stage, index) => {
      const snapshot = searchStageSnapshots[index] || {inputCount:index ? (searchStageSnapshots[index - 1]?.count || rows.length) : rows.length, count:rows.length, terms:searchTerms(stage.query)};
      const title = index === 0 ? 'Search All Metadata' : `Search within ${snapshot.inputCount.toLocaleString()} cards`;
      const termCount = snapshot.terms.length;
      const countLabel = termCount ? `${snapshot.count.toLocaleString()} cards` : `${snapshot.inputCount.toLocaleString()} available`;
      return `<section class="study-set-search-stage" data-study-set-search-stage="${index}">
        <div class="study-set-search-stage-head">
          <div><span class="study-set-kicker">Search ${index + 1}</span><h3>${esc(title)}</h3></div>
          <div class="study-set-search-stage-side"><span class="study-set-search-stage-count">${esc(countLabel)}</span>${index > 0 ? `<button type="button" class="study-set-search-stage-remove" data-study-set-search-remove="${index}" aria-label="Remove Search ${index + 1}">Remove</button>` : ''}</div>
        </div>
        <label class="study-set-search-field">
          <span>Separate terms with commas. Each term can match anywhere in card text or metadata.</span>
          <input type="search" autocomplete="off" spellcheck="false" value="${esc(stage.query)}" data-study-set-search-input="${index}" placeholder="${index === 0 ? 'e.g. give, phrasal verb' : 'e.g. business, communication'}" aria-label="Search ${index + 1} terms">
        </label>
        <div class="study-set-search-mode" role="group" aria-label="Search ${index + 1} match mode">
          <span>Match terms:</span>
          <button type="button" data-study-set-search-mode="all" data-study-set-search-mode-index="${index}" class="${stage.mode !== 'any' ? 'is-active' : ''}">ALL</button>
          <button type="button" data-study-set-search-mode="any" data-study-set-search-mode-index="${index}" class="${stage.mode === 'any' ? 'is-active' : ''}">ANY</button>
          <small>${stage.mode === 'any' ? 'One or more terms may match.' : 'Every term in this step must match.'}</small>
        </div>
      </section>`;
    }).join('');

    const lastIndex = state.searchStages.length - 1;
    const lastSnapshot = searchStageSnapshots[lastIndex];
    const lastHasTerms = searchTerms(state.searchStages[lastIndex]?.query).length > 0;
    const refine = $('study-set-add-refine');
    if (refine) {
      refine.hidden = !lastHasTerms || !lastSnapshot || lastSnapshot.count === 0;
      refine.textContent = lastSnapshot ? `+ Refine these ${lastSnapshot.count.toLocaleString()} cards` : '+ Refine these cards';
    }
  }

  function renderAxes() {
    const root = $('study-set-axis-list');
    if (!root || !api) return;
    root.innerHTML = AXES.map(axis => {
      const tags = allAxisTags(axis.field);
      const query = fold(tagQueries[axis.field]);
      const filtered = tags.filter(tag => !query || fold(tag).includes(query));
      const includeCount = state.axes[axis.field].include.length;
      const isExpanded = expandedAxes.has(axis.field);
      let visible = filtered;
      if (!query && !isExpanded && filtered.length > COLLAPSED_TAG_LIMIT) {
        const selected = [...state.axes[axis.field].include, ...state.axes[axis.field].exclude];
        visible = api.uniqueTags([...filtered.slice(0, COLLAPSED_TAG_LIMIT), ...selected.filter(tag => filtered.some(value => fold(value) === fold(tag)))]);
      }
      const buttons = visible.map(tag => {
        const status = tagState(axis.field, tag);
        const marker = status === 'include' ? '+' : status === 'exclude' ? '−' : '·';
        const label = status === 'include' ? `Included: ${tag}. Activate to exclude.` : status === 'exclude' ? `Excluded: ${tag}. Activate to clear.` : `${tag}. Activate to include.`;
        return `<button type="button" class="study-set-tag${status === 'include' ? ' is-include' : status === 'exclude' ? ' is-exclude' : ''}" data-study-set-tag-field="${esc(axis.field)}" data-study-set-tag="${esc(tag)}" aria-label="${esc(label)}"><span class="study-set-tag-marker" aria-hidden="true">${marker}</span><span>${esc(tag)}</span></button>`;
      }).join('');
      const showToggle = !query && filtered.length > COLLAPSED_TAG_LIMIT;
      return `<section class="study-set-axis" data-study-set-axis="${esc(axis.field)}">
        <div class="study-set-axis-head"><div><span class="study-set-kicker">Classification</span><h2>${esc(axis.title)}</h2></div><span class="study-set-axis-count">${tags.length} tag${tags.length === 1 ? '' : 's'}</span></div>
        <input class="study-set-axis-search" type="search" autocomplete="off" spellcheck="false" value="${esc(tagQueries[axis.field])}" data-study-set-tag-search="${esc(axis.field)}" placeholder="${esc(axis.placeholder)}" aria-label="${esc(axis.placeholder)}">
        ${tags.length ? `<div class="study-set-suggestion-guide"><strong>Suggested Tags</strong><small>Use the field above to find a tag, or choose below. Tap a tag to cycle: Include (+) → Exclude (−) → Off.</small></div><div class="study-set-axis-tags">${buttons || '<span class="study-set-axis-empty">No tags match this search.</span>'}</div>${showToggle ? `<div class="study-set-axis-tag-footer"><small>${isExpanded ? 'All available tags are shown.' : `Showing ${Math.min(COLLAPSED_TAG_LIMIT, filtered.length)} suggested tags.`}</small><button type="button" class="study-set-show-all" data-study-set-show-all="${esc(axis.field)}">${isExpanded ? 'Show less' : `Show all ${filtered.length}`}</button></div>` : ''}` : '<p class="study-set-axis-empty">No tags are available in this axis yet.</p>'}
        <div class="study-set-axis-mode" ${includeCount > 1 ? '' : 'hidden'}><span>Included tags match:</span><button type="button" data-study-set-mode="any" data-study-set-mode-field="${esc(axis.field)}" class="${state.axes[axis.field].mode === 'any' ? 'is-active' : ''}">ANY</button><button type="button" data-study-set-mode="all" data-study-set-mode-field="${esc(axis.field)}" class="${state.axes[axis.field].mode === 'all' ? 'is-active' : ''}">ALL</button></div>
      </section>`;
    }).join('');
  }

  function renderActiveFilters() {
    const root = $('study-set-active-chips');
    if (!root) return;
    const chips = [];
    state.searchStages.forEach((stage, index) => {
      const terms = searchTerms(stage.query);
      if (terms.length) chips.push(`<span class="study-set-filter-chip is-search">Search ${index + 1} · ${stage.mode.toUpperCase()}: ${esc(terms.join(', '))}</span>`);
    });
    AXES.forEach(axis => {
      const selection = state.axes[axis.field];
      selection.include.forEach(tag => chips.push(`<span class="study-set-filter-chip">+ ${esc(axis.title)}: ${esc(tag)}</span>`));
      selection.exclude.forEach(tag => chips.push(`<span class="study-set-filter-chip is-exclude">− ${esc(axis.title)}: ${esc(tag)}</span>`));
      if (selection.include.length > 1) chips.push(`<span class="study-set-filter-chip">${esc(axis.title)} include = ${selection.mode.toUpperCase()}</span>`);
    });
    root.innerHTML = chips.length ? chips.join('') : '<span class="study-set-empty-inline">No filters yet.</span>';
    const clear = $('study-set-clear');
    if (clear) clear.disabled = !chips.length;
  }

  function classificationTags(record) {
    return AXES.flatMap(axis => (record[axis.field] || []).map(tag => ({axis:axis.title, tag})));
  }

  function renderResults() {
    const count = $('study-set-match-count');
    const note = $('study-set-result-note');
    const list = $('study-set-results');
    const start = $('study-set-start');
    const startNote = $('study-set-start-note');
    const active = hasCriteria();
    if (!count || !note || !list || !start || !startNote) return;

    if (!active) {
      count.innerHTML = `<strong>${rows.length.toLocaleString()} cards</strong><span>Master cards available</span>`;
      note.textContent = 'Add a search term or Classification filter to build a temporary set.';
      list.innerHTML = '';
      start.disabled = true;
      start.textContent = 'Study These Cards';
      startNote.textContent = 'Choose at least one search term or filter. The temporary set stays separate from your Master and saved Classification Metadata.';
      return;
    }

    count.innerHTML = `<strong>${currentMatches.length.toLocaleString()} matched</strong><span>${currentMatches.length === 1 ? 'card' : 'cards'} in this temporary set</span>`;
    note.textContent = currentMatches.length ? `Showing ${Math.min(PREVIEW_LIMIT, currentMatches.length).toLocaleString()} of ${currentMatches.length.toLocaleString()} matched cards below.` : 'No cards match the current criteria.';
    const preview = currentMatches.slice(0, PREVIEW_LIMIT);
    list.innerHTML = preview.map(row => {
      const record = classificationFor(row);
      const tags = classificationTags(record).slice(0, 8);
      const reasons = matchReasonForRow(row);
      const reasonHtml = reasons.length ? `<div class="study-set-result-match"><strong>Why it matched</strong>${reasons.map(reason => `<div class="study-set-result-match-stage"><span>Search ${reason.index + 1}</span>${reason.matchedTerms.map(item => { const shown = item.locations.slice(0,3); const extra = item.locations.length > 3 ? ` +${item.locations.length - 3}` : ''; return `<small><b>${esc(item.term)}</b> → ${esc(shown.join(' · '))}${extra}</small>`; }).join('')}</div>`).join('')}</div>` : '';
      return `<article class="study-set-result">
        <div class="study-set-result-top"><span class="study-set-result-word">${esc(row.Word || '(untitled)')}</span><span class="study-set-result-id">WID${esc(row.WordID)} · WLP${esc(String(Number(row['Batch #']) || row['Batch #']).padStart(3,'0'))}</span></div>
        ${clean(row.Definition) ? `<p class="study-set-result-definition">${esc(clean(row.Definition).slice(0,220))}${clean(row.Definition).length > 220 ? '…' : ''}</p>` : ''}
        ${reasonHtml}
        ${tags.length ? `<div class="study-set-result-tags">${tags.map(item => `<span>${esc(item.tag)}</span>`).join('')}</div>` : ''}
      </article>`;
    }).join('') + (currentMatches.length > PREVIEW_LIMIT ? `<p class="study-set-result-more">${(currentMatches.length - PREVIEW_LIMIT).toLocaleString()} more matched cards are included in the set.</p>` : '');

    start.disabled = currentMatches.length === 0;
    start.textContent = currentMatches.length === 1 ? 'Study This Card' : `Study These ${currentMatches.length.toLocaleString()} Cards`;
    startNote.textContent = currentMatches.length ? 'Starts the matched cards as one temporary set. Previous / Next follows this set even when cards come from different WLP decks.' : 'Adjust the filters to get at least one matched card.';
  }

  function renderAll() {
    computeMatches();
    renderSearchStages();
    renderAxes();
    renderActiveFilters();
    renderResults();
  }

  function clearAll() {
    state = blankState();
    AXES.forEach(axis => { tagQueries[axis.field] = ''; });
    expandedAxes.clear();
    saveState();
    renderAll();
    document.querySelector('[data-study-set-search-input="0"]')?.focus();
  }

  function startStudySet() {
    if (!hasCriteria() || !currentMatches.length) return;
    const items = currentMatches.map(row => ({
      wordId: clean(row.WordID),
      batch: clean(row['Batch #']),
      word: clean(row.Word)
    })).filter(item => item.wordId && item.batch);
    if (!items.length) return;
    const snapshot = {version:1, createdAt:new Date().toISOString(), criteria:state, items};
    try { sessionStorage.setItem(TEMP_SET_KEY, JSON.stringify(snapshot)); }
    catch {
      const note = $('study-set-start-note');
      if (note) { note.textContent = 'This browser could not save the temporary study set.'; note.classList.add('study-set-error'); }
      return;
    }
    const first = items[0];
    const params = new URLSearchParams();
    params.set('batch', String(Number(first.batch) || first.batch).padStart(3, '0'));
    params.set('wordid', first.wordId);
    params.set('solo', '1');
    params.set('studyset', '1');
    params.set('from', 'study-set');
    params.set('return', '../../study-set-builder.html');
    location.href = `./flashcards/wlp/batch.html?${params.toString()}`;
  }

  async function load() {
    if (!api) {
      $('study-set-match-count').innerHTML = '<strong>Unavailable</strong><span>Classification Metadata engine did not load.</span>';
      $('study-set-result-note').textContent = 'Classification Metadata is required for Build a Study Set.';
      return;
    }
    try {
      const response = await fetch(TSV_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`TSV ${response.status}`);
      rows = applyOverrides(parseTSV(await response.text())).filter(row => clean(row.WordID) && clean(row['Batch #']));
      refreshClassificationCache();
      renderAll();
    } catch (error) {
      console.error('Study Set Master load failed:', error);
      $('study-set-match-count').innerHTML = '<strong>Load failed</strong><span>The Master TSV could not be read.</span>';
      $('study-set-result-note').textContent = 'Your Classification Metadata was not changed.';
      $('study-set-results').innerHTML = '';
      $('study-set-start').disabled = true;
    }
  }

  $('study-set-clear')?.addEventListener('click', clearAll);
  $('study-set-add-refine')?.addEventListener('click', () => {
    const last = searchStageSnapshots[searchStageSnapshots.length - 1];
    if (!last || !last.terms.length || last.count === 0) return;
    state.searchStages.push(blankSearchStage());
    saveState();
    renderAll();
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-study-set-search-input="${state.searchStages.length - 1}"]`);
      input?.focus();
    });
  });
  $('study-set-start')?.addEventListener('click', startStudySet);

  document.addEventListener('click', event => {
    const searchMode = event.target.closest('[data-study-set-search-mode]');
    if (searchMode) {
      const index = Number(searchMode.getAttribute('data-study-set-search-mode-index'));
      if (Number.isInteger(index) && state.searchStages[index]) {
        state.searchStages[index].mode = searchMode.getAttribute('data-study-set-search-mode') === 'any' ? 'any' : 'all';
        saveState();
        renderAll();
      }
      return;
    }
    const removeSearch = event.target.closest('[data-study-set-search-remove]');
    if (removeSearch) {
      const index = Number(removeSearch.getAttribute('data-study-set-search-remove'));
      if (Number.isInteger(index) && index > 0 && state.searchStages[index]) {
        state.searchStages.splice(index, 1);
        saveState();
        renderAll();
      }
      return;
    }
    const tag = event.target.closest('[data-study-set-tag]');
    if (tag) {
      const field = tag.getAttribute('data-study-set-tag-field');
      const value = tag.getAttribute('data-study-set-tag');
      if (AXES.some(axis => axis.field === field) && value) cycleTag(field, value);
      return;
    }
    const showAll = event.target.closest('[data-study-set-show-all]');
    if (showAll) {
      const field = showAll.getAttribute('data-study-set-show-all');
      if (expandedAxes.has(field)) expandedAxes.delete(field);
      else expandedAxes.add(field);
      renderAxes();
      return;
    }
    const mode = event.target.closest('[data-study-set-mode]');
    if (mode) setAxisMode(mode.getAttribute('data-study-set-mode-field'), mode.getAttribute('data-study-set-mode'));
  });

  document.addEventListener('input', event => {
    const searchInput = event.target.closest('[data-study-set-search-input]');
    if (searchInput) {
      const index = Number(searchInput.getAttribute('data-study-set-search-input'));
      if (!Number.isInteger(index) || !state.searchStages[index]) return;
      state.searchStages[index].query = searchInput.value;
      saveState();
      computeMatches();
      renderActiveFilters();
      renderResults();

      if (index < state.searchStages.length - 1) {
        renderSearchStages();
        requestAnimationFrame(() => {
          const next = document.querySelector(`[data-study-set-search-input="${index}"]`);
          if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
        });
        return;
      }

      const stageCount = searchStageSnapshots[index];
      const countEl = searchInput.closest('.study-set-search-stage')?.querySelector('.study-set-search-stage-count');
      if (countEl && stageCount) countEl.textContent = searchTerms(searchInput.value).length ? `${stageCount.count.toLocaleString()} cards` : `${stageCount.inputCount.toLocaleString()} available`;
      const refine = $('study-set-add-refine');
      if (refine) {
        refine.hidden = !searchTerms(searchInput.value).length || !stageCount || stageCount.count === 0;
        if (stageCount) refine.textContent = `+ Refine these ${stageCount.count.toLocaleString()} cards`;
      }
      return;
    }

    const input = event.target.closest('[data-study-set-tag-search]');
    if (!input) return;
    const field = input.getAttribute('data-study-set-tag-search');
    if (!AXES.some(axis => axis.field === field)) return;
    tagQueries[field] = input.value;
    renderAxes();
    requestAnimationFrame(() => {
      const next = document.querySelector(`[data-study-set-tag-search="${CSS.escape(field)}"]`);
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    });
  });

  window.addEventListener(api?.EVENT_NAME || 'wlp-classification-metadata-changed', () => {
    refreshClassificationCache();
    renderAll();
  });
  window.addEventListener('storage', event => {
    if (event.key === api?.STORAGE_KEY) {
      refreshClassificationCache();
      renderAll();
    } else if (event.key === LOCAL_OVERRIDES_KEY) {
      renderAll();
    }
  });
  window.addEventListener('pageshow', () => {
    if (!rows.length) return;
    refreshClassificationCache();
    renderAll();
  });

  load();
})();
